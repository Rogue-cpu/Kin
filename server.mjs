import { iceConfiguration } from './calls.mjs';
import { chatRoutes } from './messages.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const derive = promisify(scrypt);
const hash = value => createHash('sha256').update(value).digest('hex');
const FANDOMS = ['WWE','The Vampire Diaries','Supernatural','Twilight','Original / Other'];
const SESSION_SECONDS = 7 * 24 * 3600;
let activeHashes = 0;
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const deny = (condition, status, message) => { if (condition) throw new HttpError(status, message); };
const text = (value, max, required = false) => {
  deny(typeof value !== 'string', 400, 'Invalid text field.');
  const trimmed = value.trim();
  deny(trimmed.length > max || (required && !trimmed), 400, `Text must be ${required ? '1' : '0'}–${max} characters.`);
  return trimmed;
};
const choice = (value, choices) => { deny(!choices.includes(value), 400, 'Invalid choice.'); return value; };
const id = value => { deny(typeof value !== 'string' || !/^[a-f0-9-]{36}$/i.test(value), 400, 'Invalid identifier.'); return value; };
const postId = value => { deny(typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value), 400, 'Invalid post identifier.'); return value; };

async function derivePassword(password, salt) {
  deny(activeHashes >= 4, 429, 'Sign-in is busy. Please try again in a moment.');
  activeHashes += 1;
  try { return Buffer.from(await derive(password, salt, 64)); }
  finally { activeHashes -= 1; }
}
async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await derivePassword(password, salt)).toString('hex')}`;
}
async function passwordMatches(password, encoded) {
  const [salt, expected] = encoded.split(':');
  const candidate = await derivePassword(password, salt);
  const stored = Buffer.from(expected, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}
function passwordInput(value) { deny(typeof value !== 'string' || value.length < 12 || value.length > 128, 400, 'Use a password between 12 and 128 characters.'); return value; }

// p.author and p.audience refer only to the fixed SQL alias, never client SQL.
const CAN_READ = `(p.profile_kind=$2 AND (p.author=$1 OR EXISTS (
  SELECT 1 FROM kin_connections c WHERE c.status='accepted' AND c.profile_kind=p.profile_kind
  AND ((c.requester=p.author AND c.recipient=$1 AND (p.audience='all' OR p.audience=c.requester_circle))
    OR (c.recipient=p.author AND c.requester=$1 AND (p.audience='all' OR p.audience=c.recipient_circle)))
)))`;
const CAN_READ_MEDIA = CAN_READ.replace('p.profile_kind=$2', 'p.profile_kind=m.profile_kind');

export function resolveAppOrigin(rawOrigin, railwayDomain) {
  const configured = typeof rawOrigin === 'string' ? rawOrigin.trim() : '';
  const value = configured || (typeof railwayDomain === 'string' && railwayDomain.trim() ? 'https://' + railwayDomain.trim() : '');
  const message = 'Set APP_ORIGIN to the public app address, such as https://kin-production.up.railway.app, without a path, query, or fragment. Railway can also supply RAILWAY_PUBLIC_DOMAIN.';
  let parsed;
  try { parsed = new URL(value); } catch { throw new HttpError(500, message); }
  deny(!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname.split('/').some(Boolean) || parsed.search || parsed.hash, 500, message);
  return parsed.origin;
}

export async function createApplication({ db, origin, registrationCode, production = true, migrate = true, callConfig = null }) {
  deny(!db, 500, 'Database is required.');
  origin = resolveAppOrigin(origin);
  deny(production && !origin.startsWith('https://'), 500, 'Production requires an HTTPS origin.');
  deny(typeof registrationCode !== 'string' || registrationCode.length < 24, 500, 'Set a REGISTRATION_CODE of at least 24 characters.');
  if (migrate) await db.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  const dummyHash = await passwordHash(randomBytes(32).toString('hex'));
  const query = (sql, values = []) => db.query(sql, values);
  const cookie = (token, maxAge = SESSION_SECONDS) => `kin_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${production ? '; Secure' : ''}`;

  async function transaction(work) {
    const client = await db.connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async function limited(key, max, seconds) {
    const result = await query(`INSERT INTO kin_limits(key,attempts,resets_at) VALUES($1,1,now()+$2*interval '1 second')
      ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN kin_limits.resets_at<now() THEN 1 ELSE kin_limits.attempts+1 END,
      resets_at=CASE WHEN kin_limits.resets_at<now() THEN excluded.resets_at ELSE kin_limits.resets_at END RETURNING attempts`, [key, seconds]);
    deny(result.rows[0].attempts > max, 429, 'Too many attempts. Please try again later.');
  }
  async function session(req) {
    const token = /(?:^|;\s*)kin_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    deny(!token, 401, 'Sign in to continue.');
    const result = await query('SELECT u.id,u.handle,u.character FROM kin_sessions s JOIN kin_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()', [hash(token)]);
    deny(!result.rows[0], 401, 'Your session has ended. Please sign in again.');
    return { ...result.rows[0], tokenHash: hash(token) };
  }
  async function newSession(client, userId) {
    const token = randomBytes(32).toString('hex');
    await client.query(`INSERT INTO kin_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+$3*interval '1 second')`, [hash(token), userId, SESSION_SECONDS]);
    return token;
  }
  function characterView(row, viewer) {
    const character = row.status === 'pending' ? { ...row.character, portrait: '' } : row.character;
    return { ...character, id: row.id === viewer ? 'self' : row.id, handle: row.handle, initials: character.name.split(/\s+/).slice(0,2).map(part => part[0]).join('').toUpperCase(), group: row.circle || 'cast', label: character.fandom };
  }
  async function stateFor(userId, kind = 'roleplay') {
    // A transaction keeps profile, membership, and the feed in one database snapshot.
    return transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const own = (await client.query('SELECT id,handle,character,personal FROM kin_users WHERE id=$1', [userId])).rows[0];
      deny(!own, 401, 'Sign in to continue.');
      const connections = (await client.query(`SELECT c.id connection_id,c.requester,c.recipient,c.status,
        CASE WHEN c.requester=$1 THEN c.requester_circle ELSE c.recipient_circle END circle,
        u.id,u.handle,CASE WHEN $2='personal' THEN u.personal ELSE u.character END AS "character" FROM kin_connections c JOIN kin_users u ON u.id=CASE WHEN c.requester=$1 THEN c.recipient ELSE c.requester END
        WHERE c.profile_kind=$2 AND (c.requester=$1 OR c.recipient=$1) ORDER BY c.created_at`, [userId, kind])).rows;
      const rows = (await client.query(`SELECT p.*,
        (SELECT count(*)::int FROM kin_likes l WHERE l.post_id=p.id AND l.user_id<>$1) likes,
        EXISTS(SELECT 1 FROM kin_likes l WHERE l.post_id=p.id AND l.user_id=$1) liked,
        EXISTS(SELECT 1 FROM kin_bookmarks b WHERE b.post_id=p.id AND b.user_id=$1) saved
        FROM kin_posts p WHERE ${CAN_READ} ORDER BY p.created_at DESC LIMIT 200`, [userId, kind])).rows;
      const replies = rows.length ? (await client.query(`SELECT r.*,CASE WHEN $2='personal' THEN u.personal->>'name' ELSE u.character->>'name' END name FROM kin_replies r JOIN kin_users u ON u.id=r.author WHERE r.post_id=ANY($1::text[]) ORDER BY r.created_at,r.id`, [rows.map(row => row.id), kind])).rows : [];
      return {
        version: 1, live: true, profileKind: kind,
        profile: { ...(kind === 'personal' ? own.personal : own.character), handle: own.handle },
        profiles: [{kind:'personal',name:own.personal.name,portrait:own.personal.portrait},{kind:'roleplay',name:own.character.name,portrait:own.character.portrait}],
        people: connections.filter(row => row.status === 'accepted').map(row => characterView(row, userId)),
        requests: connections.filter(row => row.status === 'pending' && row.recipient === userId).map(row => characterView(row, userId)),
        outgoing: connections.filter(row => row.status === 'pending' && row.requester === userId).map(row => ({ id: row.id, name: row.character.name, handle: row.handle })), invitations: [],
        posts: rows.map(row => ({ id: row.id, author: row.author === userId ? 'self' : row.author, created: new Date(row.created_at).getTime(), audience: row.audience, mode: row.mode, image: row.image_id ? `/api/media/${row.image_id}` : '', alt: row.alt, caption: row.caption, likes: row.likes, liked: row.liked, saved: row.saved, comments: replies.filter(reply => reply.post_id === row.id).map(reply => ({ id: reply.id, name: reply.name, text: reply.body, mode: reply.mode })) }))
      };
    });
  }
  async function canReadPost(client, viewer, value, kind) {
    const result = await client.query(`SELECT p.* FROM kin_posts p WHERE p.id=$3 AND ${CAN_READ}`, [viewer, kind, postId(value)]);
    deny(!result.rows[0], 404, 'That post is unavailable.');
    return result.rows[0];
  }
  async function saveImage(client, owner, value, kind) {
    if (!value) return null;
    const existing = /^\/api\/media\/([a-f0-9-]{36})$/.exec(value);
    if (existing) {
      deny(!(await client.query('SELECT id FROM kin_media WHERE id=$1 AND owner=$2 AND profile_kind=$3', [existing[1], owner, kind])).rows.length, 403, 'That photo belongs to another profile.');
      return existing[1];
    }
    deny(typeof value !== 'string' || value.length > 2800000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value), 400, 'Use a JPEG photo smaller than 2 MB.');
    const bytes = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
    deny(bytes.length > 2097152 || bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255, 400, 'Invalid JPEG photo.');
    const mediaId = randomUUID();
    await client.query('INSERT INTO kin_media(id,owner,bytes,profile_kind) VALUES($1,$2,$3,$4)', [mediaId, owner, bytes, kind]);
    return mediaId;
  }
  async function applyAction(client, userId, action, kind) {
    deny(!action || typeof action !== 'object', 400, 'Invalid action.');
    const data = action.data || {};
    switch (action.type) {
      case 'profile': {
        const portraitId = await saveImage(client, userId, data.portrait, kind);
        const personal = kind === 'personal';
        const character = { name: text(data.name,60,true), bio: text(data.bio,300), fandom: personal ? 'Personal' : choice(data.fandom,FANDOMS), role: personal ? 'Personal profile' : text(data.role,100), pronouns: text(data.pronouns,40), location: text(data.location || '',100), backstory: personal ? '' : text(data.backstory,3000), boundaries: personal ? '' : text(data.boundaries,1000), portrait: portraitId ? `/api/media/${portraitId}` : '' };
        const column = personal ? 'personal' : 'character';
        await client.query(`UPDATE kin_users SET ${column}=$2::jsonb WHERE id=$1`, [userId, JSON.stringify(character)]); break;
      }
      case 'post': {
        const imageId = await saveImage(client,userId,data.image,kind);
        const caption=text(data.caption,5000,true), alt=text(data.alt || '',250);
        deny(imageId && !alt,400,'Add a photo description.');
        await client.query('INSERT INTO kin_posts(id,author,caption,mode,audience,image_id,alt,profile_kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[postId(data.id),userId,caption,kind === 'personal' ? 'ic' : choice(data.mode,['ic','ooc']),choice(data.audience,['all','cast','partners']),imageId,alt,kind]); break;
      }
      case 'delete-post': {
        const removed = await client.query('DELETE FROM kin_posts WHERE id=$1 AND author=$2 AND profile_kind=$3 RETURNING id',[postId(data.id),userId,kind]);
        deny(!removed.rows.length,404,'That post is unavailable.'); break;
      }
      case 'like': case 'bookmark': {
        await canReadPost(client,userId,data.id,kind);
        deny(typeof data.value !== 'boolean',400,'Invalid toggle.');
        const table=action.type==='like' ? 'kin_likes' : 'kin_bookmarks';
        if (data.value) await client.query(`INSERT INTO ${table}(user_id,post_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[userId,data.id]);
        else await client.query(`DELETE FROM ${table} WHERE user_id=$1 AND post_id=$2`,[userId,data.id]); break;
      }
      case 'reply': {
        await canReadPost(client,userId,data.id,kind);
        await client.query('INSERT INTO kin_replies(id,post_id,author,body,mode) VALUES($1,$2,$3,$4,$5)',[randomUUID(),data.id,userId,text(data.text,2000,true),choice(data.mode,['ic','ooc'])]); break;
      }
      case 'request': {
        const handle=text(data.handle,24,true).toLowerCase().replace(/^@/,'');
        const target=(await client.query('SELECT id FROM kin_users WHERE handle=$1',[handle])).rows[0];
        deny(!target || target.id===userId,404,'No available account with that handle.');
        const existing=await client.query('SELECT id FROM kin_connections WHERE profile_kind=$3 AND ((requester=$1 AND recipient=$2) OR (requester=$2 AND recipient=$1))',[userId,target.id,kind]);
        deny(existing.rows.length,409,'A connection or request already exists.');
        await client.query('INSERT INTO kin_connections(id,requester,recipient,profile_kind) VALUES($1,$2,$3,$4)',[randomUUID(),userId,target.id,kind]); break;
      }
      case 'accept': {
        const result=await client.query("UPDATE kin_connections SET status='accepted' WHERE requester=$1 AND recipient=$2 AND status='pending' AND profile_kind=$3 RETURNING id",[id(data.id),userId,kind]);
        deny(!result.rows.length,404,'That request is unavailable.'); break;
      }
      case 'decline': {
        await client.query("DELETE FROM kin_connections WHERE requester=$1 AND recipient=$2 AND status='pending' AND profile_kind=$3",[id(data.id),userId,kind]); break;
      }
      case 'remove': {
        await client.query('DELETE FROM kin_connections WHERE profile_kind=$3 AND ((requester=$1 AND recipient=$2) OR (requester=$2 AND recipient=$1))',[userId,id(data.id),kind]); break;
      }
      case 'circle': {
        const result=await client.query(`UPDATE kin_connections SET requester_circle=CASE WHEN requester=$1 THEN $3 ELSE requester_circle END,recipient_circle=CASE WHEN recipient=$1 THEN $3 ELSE recipient_circle END WHERE status='accepted' AND profile_kind=$4 AND ((requester=$1 AND recipient=$2) OR (requester=$2 AND recipient=$1)) RETURNING id`,[userId,id(data.id),choice(data.group,['cast','partners']),kind]);
        deny(!result.rows.length,404,'That connection is unavailable.'); break;
      }
      default: throw new HttpError(400,'Unsupported action.');
    }
  }

  async function jsonBody(req) {
    deny(!String(req.headers['content-type'] || '').startsWith('application/json'),415,'Send JSON.');
    let size=0; const chunks=[];
    for await (const chunk of req) { size+=chunk.length; deny(size>6000000,413,'That upload is too large.'); chunks.push(chunk); }
    try { const data=JSON.parse(Buffer.concat(chunks).toString()); deny(!data || Array.isArray(data) || typeof data!=='object',400,'Invalid request.'); return data; }
    catch(error) { if(error instanceof HttpError)throw error; throw new HttpError(400,'Invalid JSON.'); }
  }
  const handleChats=chatRoutes({transaction,limited,deny,text,id,iceConfig:()=>iceConfiguration(callConfig)});
  const server=http.createServer(async (req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Permissions-Policy','camera=(self), microphone=(self)');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; media-src 'self' blob: data:; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://images.unsplash.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    try {
      const url=new URL(req.url,'http://localhost'); const route=url.pathname;
      if(req.method==='GET' && route==='/api/health') { await query('SELECT 1'); send(200,{ok:true});return; }
      if(req.method==='GET' && route==='/api/config') {send(200,{accounts:true,inviteOnly:true});return;}
      if(req.method==='POST') deny(req.headers.origin!==origin,403,'Open Kin in its own browser tab before continuing.');
      const body=req.method==='POST' ? await jsonBody(req) : null;
      if(req.method==='POST' && ['/api/auth/register','/api/auth/login','/api/auth/recover'].includes(route)) {
        const handle=text(body.handle,24,true).toLowerCase();
        deny(!/^[a-z0-9_]{3,24}$/.test(handle),400,'Use a handle with 3–24 lowercase letters, numbers, or underscores.');
        // Account limits cannot be bypassed by forging forwarding headers.
        await limited(`auth:${route}:${handle}`,10,900);
        await limited(`auth-network:${req.socket.remoteAddress}`,150,900);
        const password=passwordInput(body.password);
        if(route==='/api/auth/register') {
          deny(typeof body.inviteCode!=='string' || !timingSafeEqual(Buffer.from(hash(body.inviteCode)),Buffer.from(hash(registrationCode))),403,'That invite code is not valid.');
          const userId=randomUUID(),recoveryCode=randomBytes(24).toString('hex');
          const encoded=await passwordHash(password);
          const character={name:'Your character',fandom:'Original / Other',role:'Original character',pronouns:'',bio:'',backstory:'',boundaries:'Ask before controlling my character or deciding a storyline outcome.',portrait:''};
          const token=await transaction(async client=>{await client.query('INSERT INTO kin_users(id,handle,password_hash,recovery_hash,character) VALUES($1,$2,$3,$4,$5::jsonb)',[userId,handle,encoded,hash(recoveryCode),JSON.stringify(character)]);return newSession(client,userId);});
          res.setHeader('Set-Cookie',cookie(token));send(201,{recoveryCode});return;
        }
        const account=(await query('SELECT id,password_hash,recovery_hash FROM kin_users WHERE handle=$1',[handle])).rows[0];
        if(route==='/api/auth/recover') {
          const recovery=text(body.recoveryCode,128,true);
          deny(!account || !timingSafeEqual(Buffer.from(hash(recovery)),Buffer.from(account.recovery_hash)),401,'That handle or recovery code is not valid.');
          const nextRecovery=randomBytes(24).toString('hex'),encoded=await passwordHash(password);
          const token=await transaction(async client=>{await client.query('SELECT id FROM kin_users WHERE id=$1 FOR UPDATE',[account.id]);
            // Recheck under lock: recovery codes are single-use even for simultaneous requests.
            const current=(await client.query('SELECT recovery_hash FROM kin_users WHERE id=$1',[account.id])).rows[0];
            deny(current.recovery_hash!==hash(recovery),401,'That recovery code has already been used.');
            await client.query('UPDATE kin_users SET password_hash=$2,recovery_hash=$3 WHERE id=$1',[account.id,encoded,hash(nextRecovery)]);await client.query('DELETE FROM kin_sessions WHERE user_id=$1',[account.id]);return newSession(client,account.id);});
          res.setHeader('Set-Cookie',cookie(token));send(200,{recoveryCode:nextRecovery});return;
        }
        const correct=await passwordMatches(password,account?.password_hash || dummyHash);
        deny(!account || !correct,401,'That handle or password is not valid.');
        const token=await transaction(client=>newSession(client,account.id));
        res.setHeader('Set-Cookie',cookie(token));send(200,{ok:true});return;
      }
      if(route.startsWith('/api/')) {
        const user=await session(req);
        if(req.method==='POST' && route==='/api/auth/logout') {await query('DELETE FROM kin_sessions WHERE token_hash=$1',[user.tokenHash]);res.setHeader('Set-Cookie',cookie('',0));send(200,{ok:true});return;}
        const kind=choice(req.headers['x-kin-profile'] || 'roleplay',['roleplay','personal']);
        if(await handleChats({req,route,url,body,user,kind,send,res}))return;
        if(req.method==='GET' && route==='/api/state') {send(200,await stateFor(user.id,kind));return;}
        if(req.method==='POST' && route==='/api/actions') {
          deny(!Array.isArray(body.actions) || body.actions.length<1 || body.actions.length>20,400,'Invalid changes.');
          await limited(`writes:${user.id}`,180,60);
          if(body.actions.some(action=>action?.type==='request'))await limited(`requests:${user.id}`,20,3600);
          await transaction(async client=>{for(const action of body.actions)await applyAction(client,user.id,action,kind);});
          send(200,await stateFor(user.id,kind));return;
        }
        if(req.method==='GET' && route.startsWith('/api/media/')) {
          const mediaId=id(route.slice('/api/media/'.length));
          const found=await query(`SELECT m.bytes FROM kin_media m WHERE m.id=$2 AND (m.owner=$1
            OR EXISTS(SELECT 1 FROM kin_posts p WHERE p.image_id=m.id AND ${CAN_READ_MEDIA})
            OR EXISTS(SELECT 1 FROM kin_users u JOIN kin_connections c ON ((c.requester=u.id AND c.recipient=$1) OR (c.recipient=u.id AND c.requester=$1)) WHERE c.status='accepted' AND c.profile_kind=m.profile_kind AND (CASE WHEN m.profile_kind='personal' THEN u.personal ELSE u.character END)->>'portrait'=('/api/media/'||m.id::text)))`,[user.id,mediaId]);
          deny(!found.rows[0],404,'That photo is unavailable.');res.writeHead(200,{'Content-Type':'image/jpeg'});res.end(Buffer.from(found.rows[0].bytes));return;
        }
        throw new HttpError(404,'Not found.');
      }
      deny(req.method!=='GET' && req.method!=='HEAD',405,'Method not allowed.');
      const assets={'/calls.js':['calls.js','text/javascript'],'/calls.css':['calls.css','text/css'],'/messages.js':['messages.js','text/javascript'],'/messages.css':['messages.css','text/css'],'/':['index.html','text/html'],'/index.html':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/accounts.js':['accounts.js','text/javascript'],'/accounts.css':['accounts.css','text/css'],'/profiles.css':['profiles.css','text/css'],'/login-friends.jpg':['login-friends.jpg','image/jpeg'],'/login-portrait.jpg':['login-portrait.jpg','image/jpeg'],'/login-story.jpg':['login-story.jpg','image/jpeg'],'/styles.css':['styles.css','text/css']};
      const asset=assets[route];deny(!asset,404,'Not found.');
      const bytes=await readFile(new URL(`./dist/${asset[0]}`,import.meta.url));
      res.writeHead(200,{'Content-Type':`${asset[1]}; charset=utf-8`});res.end(req.method==='HEAD' ? undefined : bytes);
    } catch(error) {
      if(res.headersSent) {res.end();return;}
      if(error.code==='23505')send(409,{error:'That handle or item already exists. Refresh and try again.'});
      else if(error instanceof HttpError)send(error.status,{error:error.message});
      else { console.error('Kin request failed:',error.code || error.name);send(500,{error:'Kin could not complete that request. Please try again.'}); }
    }
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  return server;
}

if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  const {default:pg}=await import('pg');
  const db=new pg.Pool({connectionString:process.env.DATABASE_URL,max:10,connectionTimeoutMillis:10000,idleTimeoutMillis:30000});
  try {
    if(!process.env.DATABASE_URL)throw new Error('Set DATABASE_URL to the Railway Postgres reference.');
    const server=await createApplication({db,origin:resolveAppOrigin(process.env.APP_ORIGIN, process.env.RAILWAY_PUBLIC_DOMAIN),registrationCode:process.env.REGISTRATION_CODE,production:process.env.NODE_ENV==='production'});
    const port=Number(process.env.PORT || 3000);server.listen(port,'0.0.0.0',()=>console.log(`Kin is listening on port ${port}`));
    const stop=()=>{server.close(()=>db.end().then(()=>process.exit(0)));setTimeout(()=>process.exit(1),10000).unref();};process.on('SIGTERM',stop);process.on('SIGINT',stop);
  }catch(error){console.error(error.message);await db.end();process.exitCode=1;}
}
