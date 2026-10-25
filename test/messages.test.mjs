import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApplication} from '../server.mjs';
import {testDatabase} from './database.mjs';

test('private direct and group messages enforce membership and profile boundaries',async t=>{
  const db=await testDatabase(),origin='http://localhost:3000',invite='local-chat-test-invitation-code';
  const server=await createApplication({db,origin,registrationCode:invite,production:false});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await db.end();});
  async function request(route,user,data,kind='roleplay',source=origin){
    const response=await fetch(base+route,{method:data?'POST':'GET',headers:{'X-Kin-Profile':kind,...(user?{Cookie:user.cookie}:{}),...(data?{Origin:source,'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')};
  }
  async function register(handle){const r=await request('/api/auth/register',null,{handle,password:'local secure chat password!',inviteCode:invite});assert.equal(r.status,201);const user={cookie:r.cookie.split(';')[0],handle};user.id=(await db.query('SELECT id FROM kin_users WHERE handle=$1',[handle])).rows[0].id;return user;}
  const alice=await register('chat_alice'),bob=await register('chat_bob'),carol=await register('chat_carol'),outsider=await register('chat_outsider');
  const action=(user,type,data,kind='roleplay')=>request('/api/actions',user,{actions:[{type,data}]},kind);
  async function connect(a,b,kind='roleplay'){assert.equal((await action(a,'request',{handle:b.handle},kind)).status,200);assert.equal((await action(b,'accept',{id:a.id},kind)).status,200);}
  let direct,group,personal;
  await t.test('anonymous, pending and unconnected users cannot create chats',async()=>{
    assert.equal((await request('/api/chats')).status,401);
    assert.equal((await request('/api/chats',alice,{members:[bob.id]})).status,403);
    await action(alice,'request',{handle:bob.handle});
    assert.equal((await request('/api/chats',alice,{members:[bob.id]})).status,403);
    await action(bob,'accept',{id:alice.id});
    assert.equal((await request('/api/chats',alice,{members:[alice.id]})).status,400);
  });
  await t.test('direct conversations are reused even when both users start them',async()=>{
    const created=await request('/api/chats',alice,{members:[bob.id],profileKind:'personal'});assert.equal(created.status,201);direct=created.body.id;
    const again=await request('/api/chats',bob,{members:[alice.id]});assert.equal(again.body.id,direct);
    assert.equal((await request('/api/chats',alice)).body.chats.length,1);
    assert.equal((await request('/api/chats',outsider)).body.chats.length,0);
  });
  await t.test('messages use the signed-in author and retries are idempotent',async()=>{
    const payload={id:randomUUID(),text:'*Alice enters the arena.*',sender:bob.id};
    assert.equal((await request(`/api/chats/${direct}/messages`,alice,payload)).status,201);
    assert.equal((await request(`/api/chats/${direct}/messages`,alice,payload)).status,201);
    const data=(await request(`/api/chats/${direct}/messages`,bob)).body;
    assert.equal(data.messages.length,1);assert.equal(data.messages[0].sender,alice.id);assert.equal(data.messages[0].self,false);
    assert.equal((await request(`/api/chats/${direct}/messages`,bob,{...payload,text:'forged'})).status,409);
    assert.equal((await request(`/api/chats/${direct}/messages`,alice,{id:randomUUID(),text:' '})).status,400);
  });
  await t.test('outsiders and the other profile cannot read or send using a known chat id',async()=>{
    for(const user of [outsider,carol]){assert.equal((await request(`/api/chats/${direct}/messages`,user)).status,404);assert.equal((await request(`/api/chats/${direct}/messages`,user,{id:randomUUID(),text:'intrusion'})).status,404);}
    assert.equal((await request(`/api/chats/${direct}/messages`,alice,undefined,'personal')).status,404);
    assert.equal((await request(`/api/chats/${direct}/messages`,alice,{id:randomUUID(),text:'wrong profile'},'personal')).status,404);
    assert.equal((await request('/api/chats',alice,undefined,'personal')).body.chats.length,0);
  });
  await t.test('cross-origin sends fail before message writes',async()=>{
    assert.equal((await request(`/api/chats/${direct}/messages`,alice,{id:randomUUID(),text:'csrf'},'roleplay','https://elsewhere.example')).status,403);
  });
  await t.test('a group requires every pair to be approved connections',async()=>{
    await connect(alice,carol);
    assert.equal((await request('/api/chats',alice,{members:[bob.id,carol.id],title:'The next match'})).status,403);
    await connect(bob,carol);
    const result=await request('/api/chats',alice,{members:[bob.id,carol.id],title:'The next match'});assert.equal(result.status,201);group=result.body.id;
    assert.equal((await request(`/api/chats/${group}/messages`,bob,{id:randomUUID(),text:'Ready for the next scene?'})).status,201);
    const data=(await request(`/api/chats/${group}/messages`,carol)).body;assert.equal(data.members.length,3);assert.equal(data.title,'The next match');assert.equal(data.isGroup,true);assert.equal(data.messages[0].body,'Ready for the next scene?');
  });
  await t.test('personal conversations and author names remain separate',async()=>{
    await connect(alice,bob,'personal');
    const result=await request('/api/chats',alice,{members:[bob.id]},'personal');personal=result.body.id;assert.notEqual(personal,direct);
    await request(`/api/chats/${personal}/messages`,alice,{id:randomUUID(),text:'A real life hello.'},'personal');
    const data=(await request(`/api/chats/${personal}/messages`,bob,undefined,'personal')).body;assert.equal(data.members.find(m=>m.id===alice.id).name,'Your name');assert.equal(data.messages.length,1);
    assert.equal((await request(`/api/chats/${personal}/messages`,bob)).status,404);
  });
  await t.test('message history is paginated without missing older messages',async()=>{
    for(let i=0;i<105;i++)await db.query('INSERT INTO kin_messages(id,chat_id,sender,body) VALUES($1,$2,$3,$4)',[randomUUID(),direct,alice.id,'Page message '+i]);
    const latest=(await request(`/api/chats/${direct}/messages`,alice)).body;assert.equal(latest.messages.length,100);assert.equal(latest.hasMore,true);
    const older=(await request(`/api/chats/${direct}/messages?before=${latest.messages[0].seq}`,alice)).body;assert.equal(older.messages.length,6);assert.equal(older.hasMore,false);
    assert.equal(new Set([...older.messages,...latest.messages].map(m=>m.id)).size,106);
    assert.equal((await request(`/api/chats/${direct}/messages?before=bad`,alice)).status,400);
  });
  await t.test('removing a connection revokes direct and affected group history and sending',async()=>{
    await action(alice,'remove',{id:bob.id});
    for(const [chat,user] of [[direct,alice],[direct,bob],[group,carol]]){assert.equal((await request(`/api/chats/${chat}/messages`,user)).status,404);assert.equal((await request(`/api/chats/${chat}/messages`,user,{id:randomUUID(),text:'no longer allowed'})).status,404);}
    assert.equal((await request('/api/chats',alice)).body.chats.length,0);
    assert.equal((await request(`/api/chats/${personal}/messages`,alice,undefined,'personal')).status,200);
  });
});
