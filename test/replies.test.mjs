import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createApplication} from '../server.mjs';
import {testDatabase} from './database.mjs';

test('message and post replies preserve context and private access',async t=>{
  const db=await testDatabase(),origin='http://localhost:3000',invite='local-replies-invitation-code';
  const server=await createApplication({db,origin,registrationCode:invite,production:false,callConfig:{iceServers:[],relayConfigured:false}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await db.end();});
  async function req(route,user,data,kind='roleplay'){
    const res=await fetch(base+route,{method:data?'POST':'GET',headers:{'X-Kin-Profile':kind,...(user?{Cookie:user.cookie}:{}),...(data?{Origin:origin,'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
    return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')};
  }
  async function register(handle){const r=await req('/api/auth/register',null,{handle,password:'a private replies test password!',inviteCode:invite});return {handle,cookie:r.cookie.split(';')[0],id:(await db.query('SELECT id FROM kin_users WHERE handle=$1',[handle])).rows[0].id};}
  const a=await register('reply_alice'),b=await register('reply_bob'),out=await register('reply_outsider');
  const action=(user,type,data,kind='roleplay')=>req('/api/actions',user,{actions:[{type,data}]},kind);
  await action(a,'request',{handle:b.handle});await action(b,'accept',{id:a.id});
  const chat=(await req('/api/chats',a,{members:[b.id]})).body.id;
  const group=(await req('/api/chats',a,{members:[b.id,out.id]}));assert.equal(group.status,403);
  const original=randomUUID(),answer=randomUUID();
  const photo={data:'data:image/jpeg;base64,'+Buffer.from([255,216,255,224,0,0,255,217]).toString('base64'),duration:0};
  const messages=(user,chatId=chat,kind='roleplay')=>req(`/api/chats/${chatId}/messages`,user,undefined,kind);
  await t.test('message replies quote the actual original, never client-supplied text',async()=>{
    assert.equal((await req(`/api/chats/${chat}/messages`,a,{id:original,text:'The original private message.'})).status,201);
    const payload={id:answer,text:'A reply to that message.',replyToId:original,replyTo:{body:'forged quote'}};
    assert.equal((await req(`/api/chats/${chat}/messages`,b,payload)).status,201);assert.equal((await req(`/api/chats/${chat}/messages`,b,payload)).status,201);
    const data=(await messages(a)).body.messages;assert.equal(data.length,2);assert.deepEqual(data[1].replyTo,{id:original,sender:a.id,body:'The original private message.',attachmentType:null});
    assert.equal((await req(`/api/chats/${chat}/messages`,b,{...payload,replyToId:null})).status,409);
    assert.equal((await req(`/api/chats/${chat}/messages`,b,{id:randomUUID(),text:'Unknown target',replyToId:randomUUID()})).status,404);
  });
  await t.test('attachment messages can be quoted without exposing their binary content',async()=>{
    const imageId=randomUUID();await req(`/api/chats/${chat}/messages`,a,{id:imageId,attachment:photo});
    await req(`/api/chats/${chat}/messages`,b,{id:randomUUID(),text:'Nice photo!',replyToId:imageId});
    const quote=(await messages(a)).body.messages.at(-1).replyTo;assert.equal(quote.attachmentType,'image/jpeg');assert.equal(quote.body,'');assert.equal(quote.url,undefined);
  });
  await t.test('cross-chat, cross-profile and outsider reply targets are denied',async()=>{
    await action(a,'request',{handle:out.handle});await action(out,'accept',{id:a.id});const other=(await req('/api/chats',a,{members:[out.id]})).body.id;
    assert.equal((await req(`/api/chats/${other}/messages`,a,{id:randomUUID(),text:'Wrong conversation',replyToId:original})).status,404);
    assert.equal((await req(`/api/chats/${chat}/messages`,out,{id:randomUUID(),text:'Intrusion',replyToId:original})).status,404);
    assert.equal((await req(`/api/chats/${chat}/messages`,a,{id:randomUUID(),text:'Wrong profile',replyToId:original},'personal')).status,404);
    assert.equal((await req(`/api/chats/${other}/messages?around=${original}`,a)).status,404);
  });
  await t.test('an original can be opened even when it is outside the latest history page',async()=>{
    for(let i=0;i<105;i++)await db.query('INSERT INTO kin_messages(id,chat_id,sender,body) VALUES($1,$2,$3,$4)',[randomUUID(),chat,a.id,'Later '+i]);
    assert.equal((await messages(a)).body.messages.some(m=>m.id===original),false);
    const anchored=await req(`/api/chats/${chat}/messages?around=${original}`,a);assert.equal(anchored.status,200);assert.equal(anchored.body.anchored,true);assert.equal(anchored.body.messages.at(-1).id,original);
    assert.equal((await req(`/api/chats/${chat}/messages?around=${original}`,out)).status,404);
  });
  let parent;
  await t.test('posts support top-level replies and replies to individual comments',async()=>{
    for(const postId of ['reply-post','other-reply-post'])await action(a,'post',{id:postId,caption:'A post to reply to.',mode:'ic',audience:'all',image:'',alt:''});
    const first=await action(b,'reply',{id:'reply-post',text:'The first comment.',mode:'ooc'});assert.equal(first.status,200);parent=first.body.posts.find(p=>p.id==='reply-post').comments[0].id;
    const result=await action(a,'reply',{id:'reply-post',text:'A reply to Bob.',mode:'ic',parentReplyId:parent});assert.equal(result.status,200);
    const comments=result.body.posts.find(p=>p.id==='reply-post').comments;assert.equal(comments.length,2);assert.deepEqual(comments[1].replyTo,{id:parent,name:'Your character',text:'The first comment.'});
  });
  await t.test('comment replies cannot reference another post or inaccessible profile',async()=>{
    assert.equal((await action(a,'reply',{id:'other-reply-post',text:'Wrong post.',mode:'ic',parentReplyId:parent})).status,404);
    assert.equal((await action(out,'reply',{id:'reply-post',text:'No access.',mode:'ic',parentReplyId:parent})).status,200);
    // This writer is now approved by the author, but still cannot use a different post's parent.
    assert.equal((await action(out,'reply',{id:'other-reply-post',text:'Wrong parent.',mode:'ic',parentReplyId:parent})).status,404);
    assert.equal((await action(a,'reply',{id:'reply-post',text:'Wrong profile.',mode:'ic',parentReplyId:parent},'personal')).status,404);
  });
  await t.test('schema reruns preserve existing messages and reply links',async()=>{
    await db.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
    assert.equal((await db.query('SELECT reply_to FROM kin_messages WHERE id=$1',[answer])).rows[0].reply_to,original);
    assert.equal((await req('/api/state',a)).body.posts.find(p=>p.id==='reply-post').comments[1].replyTo.id,parent);
  });
  await t.test('removing a connection revokes access to the original and its quotes',async()=>{
    await action(a,'remove',{id:b.id});assert.equal((await messages(b)).status,404);assert.equal((await req(`/api/chats/${chat}/messages?around=${original}`,b)).status,404);
    assert.equal((await action(b,'reply',{id:'reply-post',text:'Access removed.',mode:'ic',parentReplyId:parent})).status,404);
  });
});
