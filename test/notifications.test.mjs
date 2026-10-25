import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createApplication} from '../server.mjs';
import {testDatabase} from './database.mjs';

test('activity notifications follow real events, read state, and profile permissions',async t=>{
  const db=await testDatabase(),origin='http://localhost:3000',invite='notification-test-invitation-code';
  const server=await createApplication({db,origin,registrationCode:invite,production:false});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await db.end();});
  async function req(route,user,data,kind='roleplay',source=origin){const res=await fetch(base+route,{method:data?'POST':'GET',headers:{'X-Kin-Profile':kind,...(user?{Cookie:user.cookie}:{}),...(data?{Origin:source,'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')};}
  async function register(handle){const r=await req('/api/auth/register',null,{handle,password:'private notifications password!',inviteCode:invite});return {handle,cookie:r.cookie.split(';')[0],id:(await db.query('SELECT id FROM kin_users WHERE handle=$1',[handle])).rows[0].id};}
  const a=await register('activity_alice'),b=await register('activity_bob'),c=await register('activity_carol');
  const act=(u,type,data,kind='roleplay')=>req('/api/actions',u,{actions:[{type,data}]},kind),list=async(u,kind='roleplay')=>(await req('/api/notifications',u,undefined,kind)).body;
  const post=(postId,audience='all')=>({id:postId,caption:'An activity test post.',mode:'ic',audience,image:'',alt:''});
  const count=async(u,kind='roleplay')=>(await req('/api/notifications/unread',u,undefined,kind)).body.unreadCount;
  let parentId;
  await t.test('anonymous readers and cross-origin marking are denied',async()=>{
    assert.equal((await req('/api/notifications')).status,401);assert.equal((await req('/api/notifications/unread')).status,401);
    assert.equal((await req('/api/notifications/read',a,{ids:[]},'roleplay','https://other.example')).status,403);
  });
  await t.test('pending requests become actionable activity and approvals notify the requester',async()=>{
    await act(b,'request',{handle:a.handle});let activity=await list(a);assert.equal(activity.notifications.length,1);assert.equal(activity.unreadCount,1);assert.equal(activity.notifications[0].type,'request');assert.equal(activity.notifications[0].actor.portrait,'');
    await act(a,'accept',{id:b.id});assert.equal((await list(a)).notifications.length,0);assert.equal(await count(a),0);activity=await list(b);assert.equal(activity.notifications[0].type,'accepted');assert.equal(activity.notifications[0].connected,true);
  });
  await t.test('likes deduplicate, self activity and bookmarks stay out, unlikes remove activity',async()=>{
    await act(a,'post',post('activity-post','cast'));await act(a,'like',{id:'activity-post',value:true});assert.equal(await count(a),0);
    await act(b,'like',{id:'activity-post',value:true});await act(b,'like',{id:'activity-post',value:true});assert.equal((await list(a)).notifications.length,1);assert.equal((await list(a)).notifications[0].type,'like');
    await act(b,'bookmark',{id:'activity-post',value:true});assert.equal(await count(a),1);
    await act(b,'like',{id:'activity-post',value:false});assert.equal(await count(a),0);await act(b,'like',{id:'activity-post',value:true});
  });
  await t.test('comments notify the post author and quoted replies notify the comment author once',async()=>{
    const response=await act(b,'reply',{id:'activity-post',text:'A comment from Bob.',mode:'ooc'});parentId=response.body.posts.find(p=>p.id==='activity-post').comments[0].id;
    let activity=await list(a);assert.equal(activity.notifications[0].type,'comment');assert.equal(activity.notifications[0].excerpt,'A comment from Bob.');assert.equal(activity.notifications[0].replyId,parentId);
    await act(a,'reply',{id:'activity-post',text:'Answering Bob.',mode:'ic',parentReplyId:parentId});activity=await list(b);assert.equal(activity.notifications.filter(n=>n.type==='comment_reply').length,1);assert.equal(activity.notifications[0].excerpt,'Answering Bob.');
    assert.equal((await list(a)).notifications.length,2);
  });
  await t.test('shared-post replies do not expose unconnected actors’ portraits',async()=>{
    await act(c,'request',{handle:a.handle});await act(a,'accept',{id:c.id});
    await act(c,'reply',{id:'activity-post',text:'A reply from another scene partner.',mode:'ic',parentReplyId:parentId});
    const notification=(await list(b)).notifications.find(n=>n.actor.id===c.id);assert.equal(notification.type,'comment_reply');assert.equal(notification.connected,false);assert.equal(notification.actor.portrait,'');assert.equal(notification.actor.handle,'');
  });
  await t.test('reads are scoped to the recipient, profile, and snapshot cutoff',async()=>{
    const mine=await list(a),bob=await list(b);await req('/api/notifications/read',a,{ids:[bob.notifications[0].id]});assert.equal(await count(b),bob.unreadCount);
    await req('/api/notifications/read',a,{ids:[mine.notifications[0].id]},'personal');assert.equal(await count(a),mine.unreadCount);
    const cutoff=mine.notifications[0].seq;await act(b,'reply',{id:'activity-post',text:'Arrived after the read snapshot.',mode:'ic'});
    await req('/api/notifications/read',a,{all:true,through:cutoff});assert.equal(await count(a),1);assert.equal((await req('/api/notifications?unread=true',a)).body.notifications.length,1);
    const latest=(await list(a)).notifications[0];await req('/api/notifications/read',a,{ids:[latest.id]});assert.equal(await count(a),0);
  });
  await t.test('personal events and connections are independent of roleplay activity',async()=>{
    await act(b,'request',{handle:a.handle},'personal');await act(a,'accept',{id:b.id},'personal');await act(a,'post',post('personal-activity'),'personal');await act(b,'reply',{id:'personal-activity',text:'A real life reply.',mode:'ic'},'personal');
    assert.equal((await list(a,'personal')).notifications.length,1);assert.equal((await list(a)).notifications.some(n=>n.excerpt==='A real life reply.'),false);assert.equal(await count(a,'personal'),1);
  });
  await t.test('circle changes revoke activity when the actor or recipient loses the post',async()=>{
    await act(a,'circle',{id:b.id,group:'partners'});assert.equal((await list(a)).notifications.some(n=>n.actor.id===b.id&&n.postId==='activity-post'),false);assert.equal((await list(b)).notifications.some(n=>n.postId==='activity-post'),false);
    assert.equal((await req('/api/state?post=activity-post',b)).status,404);
    await act(a,'circle',{id:b.id,group:'cast'});
  });
  await t.test('activity pages paginate without duplicates and schema reruns preserve read state',async()=>{
    for(let i=0;i<55;i++)await act(b,'reply',{id:'activity-post',text:'More activity '+i,mode:'ic'});
    const first=await list(a);assert.equal(first.notifications.length,50);assert.equal(first.hasMore,true);
    const second=(await req('/api/notifications?before='+first.notifications.at(-1).seq,a)).body;assert.ok(second.notifications.length>0);assert.equal(new Set([...first.notifications,...second.notifications].map(n=>n.id)).size,first.notifications.length+second.notifications.length);
    await req('/api/notifications/read',a,{ids:[first.notifications[0].id]});const unread=await count(a);
    await db.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));assert.equal(await count(a),unread);
  });
  await t.test('notification targets can open beyond the latest 200 feed posts',async()=>{
    await act(a,'post',post('old-notification-target'));await db.query("UPDATE kin_posts SET created_at=now()-interval '1 year' WHERE id='old-notification-target'");
    for(let i=0;i<205;i++)await db.query("INSERT INTO kin_posts(id,author,caption,mode,audience,profile_kind) VALUES($1,$2,'Filler','ic','all','roleplay')",['activity-filler-'+i,a.id]);
    assert.equal((await req('/api/state',b)).body.posts.some(p=>p.id==='old-notification-target'),false);
    assert.equal((await req('/api/state?post=old-notification-target',b)).body.posts.some(p=>p.id==='old-notification-target'),true);
    assert.equal((await req('/api/state?post=old-notification-target',b,undefined,'personal')).status,404);
  });
  await t.test('deleting posts, removing connections and cancelling requests remove stale activity',async()=>{
    await act(a,'delete-post',{id:'activity-post'});assert.equal((await list(a)).notifications.some(n=>n.postId==='activity-post'),false);
    await act(a,'remove',{id:b.id});assert.equal((await list(b)).notifications.some(n=>n.actor.id===a.id),false);assert.equal(await count(a,'personal'),1);
    await act(b,'request',{handle:a.handle});assert.equal((await list(a)).notifications.some(n=>n.type==='request'&&n.actor.id===b.id),true);assert.equal((await act(b,'remove',{id:a.id})).status,200);assert.equal((await list(a)).notifications.some(n=>n.type==='request'&&n.actor.id===b.id),false);
  });
});
