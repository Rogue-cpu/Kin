import { callRoutes } from './calls.mjs';
import { decodeAttachment } from './chat-attachments.mjs';
import { randomUUID } from 'node:crypto';

// Every member must still be approved by every other member in this profile.
const CONNECTED = `NOT EXISTS (SELECT 1 FROM kin_chat_members a JOIN kin_chat_members b ON a.chat_id=b.chat_id AND a.user_id<b.user_id WHERE a.chat_id=c.id AND NOT EXISTS (SELECT 1 FROM kin_connections r WHERE r.profile_kind=c.profile_kind AND r.status='accepted' AND ((r.requester=a.user_id AND r.recipient=b.user_id) OR (r.recipient=a.user_id AND r.requester=b.user_id))))`;
export const CHAT_ACCESS = `c.profile_kind=$2 AND EXISTS(SELECT 1 FROM kin_chat_members m WHERE m.chat_id=c.id AND m.user_id=$1) AND ${CONNECTED}`;

export function chatRoutes({ transaction, limited, deny, text, id, iceConfig, giphyKey }) {
  async function authorize(client,user,kind,chat) {
    const row=(await client.query(`SELECT c.* FROM kin_chats c WHERE c.id=$3 AND ${CHAT_ACCESS} FOR UPDATE`,[user,kind,chat])).rows[0];
    deny(!row,404,'This conversation is unavailable. All members must remain approved connections.');
    return row;
  }
  async function participants(client,chat,kind,user) {
    return (await client.query(`SELECT u.id,u.handle,CASE WHEN $2='personal' THEN u.personal ELSE u.character END AS profile FROM kin_chat_members m JOIN kin_users u ON u.id=m.user_id WHERE m.chat_id=$1 ORDER BY u.handle`,[chat,kind])).rows.map(r=>({id:r.id,self:r.id===user,handle:r.handle,name:r.profile.name,portrait:r.profile.portrait||''}));
  }
  const calls=callRoutes({transaction,limited,deny,text,id,authorize,participants,iceConfig});
  return async ({req,route,url,body,user,kind,send,res})=>{
    if(req.method==='GET'&&route==='/api/giphy/config'){send(200,{apiKey:giphyKey,enabled:!!giphyKey});return true;}
    if(await calls({req,route,url,body,user,kind,send}))return true;
    if(req.method==='GET'&&/^\/api\/chat-media\/[a-f0-9-]{36}$/.test(route)){
      const assetId=id(route.split('/')[3]);
      const asset=await transaction(async client=>{
        const row=(await client.query('SELECT a.* FROM kin_chat_assets a JOIN kin_messages m ON m.attachment_id=a.id WHERE a.id=$1',[assetId])).rows[0];
        deny(!row,404,'That attachment is unavailable.');
        const chat=(await client.query('SELECT profile_kind FROM kin_chats WHERE id=$1',[row.chat_id])).rows[0];
        await authorize(client,user.id,chat.profile_kind,row.chat_id);return row;
      });
      const bytes=Buffer.from(asset.bytes),size=bytes.length,range=req.headers.range;
      let first=0,last=size-1;
      if(range){
        const parsed=/^bytes=(\d*)-(\d*)$/.exec(range);
        if(parsed&&(parsed[1]||parsed[2])){
          first=parsed[1]?Number(parsed[1]):Math.max(0,size-Number(parsed[2]));
          last=parsed[1]&&parsed[2]?Math.min(size-1,Number(parsed[2])):size-1;
        }else first=-1;
        if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first<0||first>=size||last<first){res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return true;}
      }
      res.writeHead(range?206:200,{'Content-Type':asset.mime,'Content-Length':last-first+1,'Content-Disposition':'inline','Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${first}-${last}/${size}`}:{})});res.end(bytes.subarray(first,last+1));return true;
    }
    if(route!=='/api/chats'&&!/^\/api\/chats\/[a-f0-9-]{36}\/messages$/.test(route))return false;
    if(req.method==='GET'&&route==='/api/chats') {
      const chats=await transaction(async client=>{
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        const rows=(await client.query(`SELECT c.id,c.title,c.is_group,c.created_at,(SELECT CASE WHEN giphy_id IS NOT NULL AND body='' THEN 'GIF' WHEN attachment_id IS NOT NULL AND body='' THEN 'Attachment' ELSE body END FROM kin_messages WHERE chat_id=c.id ORDER BY seq DESC LIMIT 1) AS preview,(SELECT created_at FROM kin_messages WHERE chat_id=c.id ORDER BY seq DESC LIMIT 1) AS updated_at FROM kin_chats c WHERE ${CHAT_ACCESS} ORDER BY COALESCE((SELECT max(seq) FROM kin_messages WHERE chat_id=c.id),0) DESC,c.created_at DESC LIMIT 100`,[user.id,kind])).rows;
        for(const c of rows)c.members=await participants(client,c.id,kind,user.id);
        return rows;
      });send(200,{chats});return true;
    }
    if(req.method==='POST'&&route==='/api/chats') {
      await limited(`chat-create:${user.id}`,20,3600);
      deny(!Array.isArray(body.members)||body.members.length<1||body.members.length>9,400,'Choose between 1 and 9 approved connections.');
      const members=[user.id,...body.members.map(id)];
      deny(new Set(members).size!==members.length,400,'Choose each connection once.');
      const title=text(body.title||'',80), group=members.length>2;
      const chat=await transaction(async client=>{
        // Lock users in a stable order to avoid duplicate direct chats under concurrency.
        await client.query('SELECT id FROM kin_users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[members]);
        for(let i=0;i<members.length;i++)for(let j=i+1;j<members.length;j++) {
          const approved=(await client.query(`SELECT id FROM kin_connections WHERE profile_kind=$3 AND status='accepted' AND ((requester=$1 AND recipient=$2) OR (recipient=$1 AND requester=$2)) FOR SHARE`,[members[i],members[j],kind])).rows.length;
          deny(!approved,403,'Everyone in a chat must be approved connections with one another in this profile.');
        }
        if(!group){const existing=(await client.query(`SELECT c.id FROM kin_chats c WHERE c.profile_kind=$3 AND NOT c.is_group AND EXISTS(SELECT 1 FROM kin_chat_members WHERE chat_id=c.id AND user_id=$1) AND EXISTS(SELECT 1 FROM kin_chat_members WHERE chat_id=c.id AND user_id=$2)`,[members[0],members[1],kind])).rows[0];if(existing)return existing.id;}
        const chatId=randomUUID();
        await client.query('INSERT INTO kin_chats(id,profile_kind,creator,title,is_group) VALUES($1,$2,$3,$4,$5)',[chatId,kind,user.id,group?title:'',group]);
        for(const member of members)await client.query('INSERT INTO kin_chat_members(chat_id,user_id) VALUES($1,$2)',[chatId,member]);
        return chatId;
      });send(201,{id:chat});return true;
    }
    const chat=id(route.split('/')[3]);
    if(req.method==='GET') {
      const around=url.searchParams.has('around')?id(url.searchParams.get('around')):null;
      const raw=url.searchParams.get('before');deny(around&&raw!==null,400,'Choose one history cursor.');deny(raw!==null&&!/^[1-9][0-9]{0,17}$/.test(raw),400,'Invalid message cursor.');
      const result=await transaction(async client=>{
        const conversation=await authorize(client,user.id,kind,chat);
        if(around)deny(!(await client.query('SELECT id FROM kin_messages WHERE id=$1 AND chat_id=$2',[around,chat])).rows.length,404,'Original message unavailable.');
        const rows=(await client.query(`SELECT m.seq::text,m.id,m.sender,m.body,m.created_at,m.giphy_id AS "giphyId",CASE WHEN original.id IS NULL THEN NULL ELSE json_build_object('id',original.id,'sender',original.sender,'body',left(original.body,180),'attachmentType',CASE WHEN original.giphy_id IS NOT NULL THEN 'image/giphy' ELSE original_asset.mime END) END AS "replyTo",CASE WHEN a.id IS NULL THEN NULL ELSE json_build_object('url','/api/chat-media/'||a.id::text,'mime',a.mime,'duration',a.duration) END AS attachment FROM kin_messages m LEFT JOIN kin_chat_assets a ON a.id=m.attachment_id LEFT JOIN kin_messages original ON original.id=m.reply_to AND original.chat_id=m.chat_id LEFT JOIN kin_chat_assets original_asset ON original_asset.id=original.attachment_id WHERE m.chat_id=$1 AND ($3::uuid IS NULL OR m.seq<=(SELECT seq FROM kin_messages WHERE id=$3 AND chat_id=$1)) AND ($2::bigint IS NULL OR m.seq<$2::bigint) ORDER BY m.seq DESC LIMIT 101`,[chat,raw,around])).rows;
        const more=rows.length>100;const messages=rows.slice(0,100).reverse().map(r=>({...r,self:r.sender===user.id}));
        return {id:chat,title:conversation.title,isGroup:conversation.is_group,members:await participants(client,chat,kind,user.id),messages,hasMore:more,anchored:!!around};
      });send(200,result);return true;
    }
    if(req.method==='POST') {
      await limited(`chat-send:${user.id}`,60,60);
      const content=text(body.text||'',4000), messageId=id(body.id), replyToId=body.replyToId==null?null:id(body.replyToId);
      const giphyId=body.giphyId==null?null:body.giphyId;deny(giphyId!==null&&(typeof giphyId!=='string'||!/^[A-Za-z0-9]{1,64}$/.test(giphyId)),400,'Invalid GIPHY identifier.');
      deny(giphyId&&body.attachment,400,'Choose a GIF or a file attachment, not both.');
      const attachment=body.attachment?decodeAttachment(body.attachment,deny):null;
      deny(!content&&!attachment&&!giphyId,400,'Write a message or choose an attachment.');
      await transaction(async client=>{
        await authorize(client,user.id,kind,chat);
        const previous=(await client.query('SELECT m.sender,m.chat_id,m.body,m.reply_to,m.giphy_id,a.fingerprint FROM kin_messages m LEFT JOIN kin_chat_assets a ON a.id=m.attachment_id WHERE m.id=$1',[messageId])).rows[0];
        if(previous){deny(previous.sender!==user.id||previous.chat_id!==chat||previous.body!==content||(previous.giphy_id||null)!==giphyId||(previous.reply_to||null)!==replyToId||(previous.fingerprint||null)!==(attachment?.fingerprint||null),409,'That message identifier is already used.');return;}
        if(replyToId)deny(!(await client.query('SELECT id FROM kin_messages WHERE id=$1 AND chat_id=$2',[replyToId,chat])).rows.length,404,'Original message unavailable in this conversation.');
        let assetId=null;
        if(attachment){assetId=randomUUID();await client.query('INSERT INTO kin_chat_assets(id,chat_id,owner,mime,bytes,fingerprint,duration) VALUES($1,$2,$3,$4,$5,$6,$7)',[assetId,chat,user.id,attachment.mime,attachment.bytes,attachment.fingerprint,attachment.duration]);}
        await client.query('INSERT INTO kin_messages(id,chat_id,sender,body,attachment_id,reply_to,giphy_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[messageId,chat,user.id,content,assetId,replyToId,giphyId]);
      });send(201,{ok:true});return true;
    }
    deny(true,405,'Method not supported.');
  };
}
