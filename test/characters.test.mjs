import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createApplication} from '../server.mjs';
import {testDatabase} from './database.mjs';

test('multiple roleplay identities share authentication and isolate social data',async t=>{
  const db=await testDatabase(),origin='http://localhost:3000',invite='multiple-roleplay-test-invitation';
  const server=await createApplication({db,origin,registrationCode:invite,production:false,callConfig:{iceServers:[],relayConfigured:false}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await db.end();});
  async function req(route,user,data,character=null,kind='roleplay'){
    const response=await fetch(base+route,{method:data?'POST':'GET',headers:{'X-Kin-Profile':kind,...(user?{Cookie:user.cookie}:{}),...(character?{'X-Kin-Character':character}:{}),...(data?{Origin:origin,'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
    return {status:response.status,body:response.headers.get('content-type')?.includes('application/json')?await response.json():Buffer.from(await response.arrayBuffer()),cookie:response.headers.get('set-cookie')};
  }
  async function register(handle){const r=await req('/api/auth/register',null,{handle,password:'characters private test password!',inviteCode:invite});assert.equal(r.status,201);return {handle,cookie:r.cookie.split(';')[0],recovery:r.body.recoveryCode,id:(await db.query('SELECT id FROM kin_users WHERE handle=$1',[handle])).rows[0].id};}
  const a=await register('character_alice'),b=await register('character_bob'),out=await register('character_outsider');
  const act=(u,type,data,character=null,kind='roleplay')=>req('/api/actions',u,{actions:[{type,data}]},character,kind);
  const state=async(u,character=null,kind='roleplay')=>(await req('/api/state',u,undefined,character,kind)).body;
  const make=(name,handle)=>({name,handle,fandom:'The Vampire Diaries',role:'Fan character'});
  let damon,dean,rhea,photo,portrait,chat,chatAsset,call;
  const image='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,0,0,255,217]).toString('base64');
  await t.test('authenticated writers create additional characters with unique usernames',async()=>{
    assert.equal((await req('/api/characters',null,make('No login','no_login'))).status,401);
    damon=(await req('/api/characters',a,make('Damon AU','alice_damon'))).body.id;dean=(await req('/api/characters',a,make('Dean AU','alice_dean'))).body.id;rhea=(await req('/api/characters',b,make('Rhea AU','bob_rhea'))).body.id;
    assert.ok(damon&&dean&&rhea);assert.equal((await req('/api/characters',b,make('Duplicate','alice_damon'))).status,409);
    assert.equal((await req('/api/characters',a,make('Invalid','bad handle'))).status,400);
    const own=await state(a);assert.equal(own.profiles.length,4);assert.equal(own.profiles.filter(p=>p.kind==='roleplay').length,3);assert.equal(own.accountHandle,a.handle);assert.equal(own.characterId,a.id);
  });
  await t.test('selected identities must belong to the signed-in account and be roleplay',async()=>{
    assert.equal((await req('/api/state',out,undefined,damon)).status,403);
    assert.equal((await req('/api/state',a,undefined,randomUUID())).status,403);
    assert.equal((await req('/api/state',a,undefined,damon,'personal')).status,400);
    assert.equal((await act(out,'request',{handle:'alice_damon'},null,'personal')).status,404);
    assert.equal((await state(a,damon)).profile.handle,'alice_damon');assert.equal((await state(a,dean)).profile.name,'Dean AU');
    assert.equal((await state(a,null,'personal')).profile.name,'Your name');
  });
  await t.test('additional usernames cannot be used as independent password or recovery accounts',async()=>{
    assert.equal((await req('/api/auth/login',null,{handle:'alice_damon',password:'characters private test password!'})).status,401);
    assert.equal((await req('/api/auth/recover',null,{handle:'alice_damon',password:'a replacement secure password!',recoveryCode:a.recovery})).status,401);
  });
  await t.test('profile edits, portraits and posts stay with the selected character',async()=>{
    const data={name:'Damon Salvatore AU',fandom:'The Vampire Diaries',role:'Vampire',bio:'A private alternate timeline.',pronouns:'he/him',location:'',backstory:'Mystic Falls',boundaries:'Ask before a scene.',portrait:image};
    const updated=await act(a,'profile',data,damon);assert.equal(updated.status,200);portrait=updated.body.profile.portrait;
    const created=await act(a,'post',{id:'damon-only',caption:'Damon’s first scene.',mode:'ic',audience:'all',image,alt:'A roleplay photo',author:a.id},damon);assert.equal(created.status,200);photo=created.body.posts[0].image;
    await act(a,'post',{id:'dean-only',caption:'Dean’s hunting scene.',mode:'ic',audience:'all',image:'',alt:''},dean);
    await act(a,'post',{id:'primary-only',caption:'My original character.',mode:'ic',audience:'all',image:'',alt:''});
    assert.deepEqual((await state(a,damon)).posts.map(p=>p.id),['damon-only']);assert.deepEqual((await state(a,dean)).posts.map(p=>p.id),['dean-only']);assert.deepEqual((await state(a)).posts.map(p=>p.id),['primary-only']);
    assert.equal((await state(a)).profile.name,'Your character');assert.equal((await state(a,null,'personal')).posts.length,0);
    assert.equal((await req(portrait,a)).status,200);assert.equal((await req(photo,b)).status,404);
    assert.equal((await act(a,'post',{id:'wrong-photo',caption:'Cannot borrow another character’s media.',mode:'ic',audience:'all',image:photo,alt:'No'},dean)).status,403);
  });
  await t.test('characters approve their own connections and do not publish their owner links',async()=>{
    assert.equal((await act(a,'request',{handle:'bob_rhea'},damon)).status,200);assert.equal((await state(b)).requests.length,0);
    assert.equal((await state(b,rhea)).requests[0].handle,'alice_damon');assert.equal((await act(b,'accept',{id:damon},rhea)).status,200);
    const viewer=await state(b,rhea);assert.equal(viewer.people[0].id,damon);assert.equal(viewer.people[0].handle,'alice_damon');assert.equal(JSON.stringify(viewer).includes(a.id),false);
    assert.equal(viewer.posts[0].id,'damon-only');assert.equal((await state(b)).posts.length,0);assert.equal((await state(a,dean)).people.length,0);
    assert.equal((await req(photo,b)).status,200);assert.equal((await req(portrait,b)).status,200);assert.equal((await req(photo,out)).status,404);
  });
  await t.test('replies, bookmarks and likes use the active character identity',async()=>{
    assert.equal((await act(b,'reply',{id:'damon-only',text:'Rhea answers.',mode:'ic'},rhea)).status,200);
    assert.equal((await act(b,'reply',{id:'damon-only',text:'Wrong identity.',mode:'ic'})).status,404);
    await act(b,'like',{id:'damon-only',value:true},rhea);await act(b,'bookmark',{id:'damon-only',value:true},rhea);
    const post=(await state(a,damon)).posts[0];assert.equal(post.comments[0].name,'Rhea AU');assert.equal(post.likes,1);assert.equal((await state(b,rhea)).posts[0].saved,true);
    assert.equal((await act(a,'delete-post',{id:'damon-only'},dean)).status,404);
  });
  await t.test('notifications stay in their character inboxes',async()=>{
    const notices=(await req('/api/notifications',a,undefined,damon)).body.notifications;assert.ok(notices.some(n=>n.type==='like'));assert.ok(notices.some(n=>n.type==='comment'));assert.equal(notices.find(n=>n.type==='comment').actor.handle,'bob_rhea');
    assert.equal((await req('/api/notifications',a)).body.notifications.length,0);assert.equal((await req('/api/notifications',a,undefined,dean)).body.notifications.length,0);
  });
  await t.test('direct messages and chat attachments authorize the selected characters',async()=>{
    const result=await req('/api/chats',a,{members:[rhea]},damon);assert.equal(result.status,201);chat=result.body.id;
    assert.equal((await req('/api/chats',a)).body.chats.length,0);assert.equal((await req('/api/chats',a,undefined,dean)).body.chats.length,0);
    assert.equal((await req(`/api/chats/${chat}/messages`,a)).status,404);assert.equal((await req(`/api/chats/${chat}/messages`,a,undefined,dean)).status,404);
    assert.equal((await req(`/api/chats/${chat}/messages`,a,{id:randomUUID(),text:'Hello from Damon.',attachment:{data:image,duration:0}},damon)).status,201);
    const data=(await req(`/api/chats/${chat}/messages`,b,undefined,rhea)).body;assert.equal(data.messages[0].sender,damon);assert.equal(data.members.find(m=>m.id===damon).name,'Damon Salvatore AU');chatAsset=data.messages[0].attachment.url;
    assert.equal((await req(chatAsset,b)).status,200);assert.equal((await req(chatAsset,out)).status,404);
  });
  await t.test('calls ring only the selected participants',async()=>{
    const created=await req(`/api/chats/${chat}/calls`,a,{video:false},damon);assert.equal(created.status,201);call=created.body.id;
    assert.equal((await req('/api/calls',b)).body.calls.length,0);assert.equal((await req('/api/calls',b,undefined,rhea)).body.calls[0].id,call);
    assert.equal((await req(`/api/calls/${call}`,a,undefined,dean)).status,404);
    assert.equal((await req(`/api/calls/${call}/join`,a,{},damon)).status,200);assert.equal((await req(`/api/calls/${call}/join`,b,{},rhea)).status,200);
    assert.deepEqual((await req(`/api/calls/${call}`,a,undefined,damon)).body.peers.sort(),[damon,rhea].sort());
    await req(`/api/calls/${call}/leave`,a,{},damon);
  });
  await t.test('removing one character connection revokes its media, chat and activity',async()=>{
    await act(a,'remove',{id:rhea},damon);assert.equal((await req(photo,b)).status,404);assert.equal((await req(chatAsset,b)).status,404);assert.equal((await req(`/api/chats/${chat}/messages`,b,undefined,rhea)).status,404);
    assert.equal((await req('/api/notifications',a,undefined,damon)).body.notifications.length,0);assert.equal((await state(a,dean)).posts[0].id,'dean-only');
  });
  await t.test('schema reruns preserve primary and additional profiles, posts, and login sessions',async()=>{
    await db.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));assert.equal((await state(a,damon)).profile.name,'Damon Salvatore AU');assert.equal((await state(a)).posts[0].id,'primary-only');assert.equal((await state(a,dean)).posts[0].id,'dean-only');
    assert.equal((await req('/api/state',a)).status,200);
  });
  await t.test('the account character limit is enforced under the owner lock',async()=>{
    for(let i=0;i<17;i++)await db.query('INSERT INTO kin_users(id,handle,password_hash,recovery_hash,character,owner_id) VALUES($1,$2,$3,$4,$5::jsonb,$6)',[randomUUID(),'limit_character_'+i,'managed','unused',JSON.stringify({name:'Extra '+i,fandom:'WWE',role:'Fan character',bio:'',portrait:''}),a.id]);
    assert.equal((await req('/api/characters',a,make('Too many','over_character_limit'))).status,400);
    assert.equal((await state(a)).profiles.filter(p=>p.kind==='roleplay').length,20);
  });
  await t.test('main-account recovery revokes character access for old sessions and preserves the roster',async()=>{
    const recovered=await req('/api/auth/recover',null,{handle:a.handle,password:'a replacement character login password!',recoveryCode:a.recovery});assert.equal(recovered.status,200);
    assert.equal((await req('/api/state',a,undefined,damon)).status,401);a.cookie=recovered.cookie.split(';')[0];
    const restored=await state(a,damon);assert.equal(restored.profile.name,'Damon Salvatore AU');assert.equal(restored.profiles.filter(p=>p.kind==='roleplay').length,20);
  });
});
