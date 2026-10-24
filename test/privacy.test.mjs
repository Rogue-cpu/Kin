import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../server.mjs';
import { testDatabase } from './database.mjs';

test('private accounts enforce authorization and preserve roleplay actions', async t => {
  const db=await testDatabase();
  const origin='http://localhost:3000',invite='test-invitation-code-at-least-24-characters';
  const server=await createApplication({db,origin,registrationCode:invite,production:false});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await db.end();});
  async function request(route,{user,data,requestOrigin=origin}={}){
    const response=await fetch(base+route,{method:data===undefined?'GET':'POST',headers:{...(user?{Cookie:user.cookie}:{}),...(data===undefined?{}:{'Content-Type':'application/json',Origin:requestOrigin})},body:data===undefined?undefined:JSON.stringify(data)});
    const result=response.headers.get('content-type')?.startsWith('application/json')?await response.json():Buffer.from(await response.arrayBuffer());
    return {status:response.status,body:result,cookie:response.headers.get('set-cookie'),headers:response.headers};
  }
  async function register(handle){const response=await request('/api/auth/register',{data:{handle,password:'a strong test password!',inviteCode:invite}});assert.equal(response.status,201);return {handle,cookie:response.cookie.split(';')[0],recovery:response.body.recoveryCode};}
  async function action(user,type,data){return request('/api/actions',{user,data:{actions:[{type,data}]}});}
  const profile=(name,fandom='Supernatural')=>({name,fandom,role:'Hunter',pronouns:'they/them',bio:'Sample fan roleplay',backstory:'An alternate universe.',boundaries:'Ask before major plot changes.',portrait:''});

  await t.test('unauthenticated readers and cross-origin writes are denied',async()=>{
    assert.equal((await request('/api/state')).status,401);
    assert.equal((await request('/api/auth/register',{requestOrigin:'https://other.example',data:{}})).status,403);
    assert.equal((await request('/api/auth/register',{data:{handle:'intruder',password:'a strong test password!',inviteCode:'wrong'}})).status,403);
  });
  const alice=await register('alice_writer'),bob=await register('bob_writer'),eve=await register('eve_writer');
  let alicePost='post-alice-secret',mediaUrl,bobId,aliceId;
  await t.test('accounts use HttpOnly sessions and expose no hashes',async()=>{
    const response=await request('/api/auth/login',{data:{handle:alice.handle,password:'a strong test password!'}});
    assert.match(response.cookie,/HttpOnly/);assert.match(response.cookie,/SameSite=Lax/);
    alice.cookie=response.cookie.split(';')[0];
    const next=(await request('/api/state',{user:alice})).body;
    assert.equal(next.posts.length,0);assert.equal(next.people.length,0);assert.equal(next.profile.handle,alice.handle);
    assert.doesNotMatch(JSON.stringify(next),/password_hash|recovery_hash|token_hash/);
    assert.equal((await action(alice,'profile',profile('Dean AU'))).status,200);
    assert.equal((await action(bob,'profile',profile('Sam AU'))).status,200);
    assert.equal((await action(alice,'post',{id:alicePost,caption:'A private scene.',mode:'ic',audience:'cast',image:'',alt:''})).status,200);
  });
  await t.test('pending requests grant no access to posts or photos',async()=>{
    assert.equal((await action(bob,'request',{handle:alice.handle})).status,200);
    const aliceState=(await request('/api/state',{user:alice})).body;
    bobId=aliceState.requests[0].id;
    assert.equal((await request('/api/state',{user:bob})).body.posts.length,0);
    assert.equal((await action(bob,'reply',{id:alicePost,text:'I should not see this.',mode:'ic'})).status,404);
    assert.equal((await action(eve,'like',{id:alicePost,value:true})).status,404);
  });
  await t.test('only the recipient can approve a connection',async()=>{
    assert.equal((await action(bob,'accept',{id:bobId})).status,404);
    const accepted=await action(alice,'accept',{id:bobId});assert.equal(accepted.status,200);
    const bobState=(await request('/api/state',{user:bob})).body;
    assert.equal(bobState.posts.length,1);aliceId=bobState.people[0].id;
  });
  await t.test('circle restrictions use the author assignment, not the viewer assignment',async()=>{
    assert.equal((await action(alice,'circle',{id:bobId,group:'partners'})).status,200);
    assert.equal((await request('/api/state',{user:bob})).body.posts.length,0);
    assert.equal((await action(bob,'circle',{id:aliceId,group:'cast'})).status,200);
    assert.equal((await request('/api/state',{user:bob})).body.posts.length,0);
    assert.equal((await action(alice,'circle',{id:bobId,group:'cast'})).status,200);
    assert.equal((await request('/api/state',{user:bob})).body.posts.length,1);
  });
  await t.test('replies, likes, and bookmarks use the authenticated writer',async()=>{
    const response=await action(bob,'reply',{id:alicePost,text:'Let’s plan this scene.',mode:'ooc',name:'Forged Author'});
    assert.equal(response.status,200);assert.equal(response.body.posts[0].comments[0].name,'Sam AU');
    assert.equal(response.body.posts[0].comments[0].mode,'ooc');
    assert.equal((await action(bob,'like',{id:alicePost,value:true})).body.posts[0].liked,true);
    assert.equal((await action(bob,'bookmark',{id:alicePost,value:true})).body.posts[0].saved,true);
    assert.equal((await request('/api/state',{user:alice})).body.posts[0].saved,false);
    assert.equal((await action(bob,'delete-post',{id:alicePost})).status,404);
  });
  await t.test('media requires the same connection and audience permissions',async()=>{
    const image='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,0,0,255,217]).toString('base64');
    const response=await action(alice,'post',{id:'post-photo',caption:'A private photo scene.',mode:'ic',audience:'cast',image,alt:'Test JPEG bytes'});
    assert.equal(response.status,200);mediaUrl=response.body.posts.find(post=>post.id==='post-photo').image;
    assert.equal((await request(mediaUrl,{user:bob})).status,200);
    assert.equal((await request(mediaUrl,{user:eve})).status,404);
    assert.equal((await request(mediaUrl)).status,401);
  });
  await t.test('failed action batches roll back earlier writes',async()=>{
    const response=await request('/api/actions',{user:alice,data:{actions:[{type:'post',data:{id:'post-rollback',caption:'Must roll back.',mode:'ic',audience:'all',image:'',alt:''}},{type:'unsupported'}]}});
    assert.equal(response.status,400);
    assert.equal((await request('/api/state',{user:alice})).body.posts.some(post=>post.id==='post-rollback'),false);
  });
  await t.test('removal revokes post, reply, bookmark, and media access',async()=>{
    assert.equal((await action(alice,'remove',{id:bobId})).status,200);
    const next=(await request('/api/state',{user:bob})).body;assert.equal(next.posts.length,0);assert.equal(next.people.length,0);
    assert.equal((await request(mediaUrl,{user:bob})).status,404);
    assert.equal((await action(bob,'reply',{id:alicePost,text:'No longer allowed.',mode:'ic'})).status,404);
  });
  await t.test('recovery codes are single-use and revoke previous sessions',async()=>{
    const previousCookie=alice.cookie;
    const response=await request('/api/auth/recover',{data:{handle:alice.handle,password:'a replacement password!',recoveryCode:alice.recovery}});
    assert.equal(response.status,200);assert.notEqual(response.body.recoveryCode,alice.recovery);
    assert.equal((await request('/api/state',{user:{cookie:previousCookie}})).status,401);
    assert.equal((await request('/api/auth/recover',{data:{handle:alice.handle,password:'a replacement password!',recoveryCode:alice.recovery}})).status,401);
    alice.cookie=response.cookie.split(';')[0];
    assert.equal((await request('/api/state',{user:alice})).status,200);
    assert.equal((await request('/api/auth/login',{data:{handle:alice.handle,password:'a strong test password!'}})).status,401);
  });
  await t.test('logout invalidates the server session',async()=>{
    assert.equal((await request('/api/auth/logout',{user:alice,data:{}})).status,200);
    assert.equal((await request('/api/state',{user:alice})).status,401);
  });
  await t.test('authentication attempts are limited in the database',async()=>{
    for(let i=0;i<10;i++)await request('/api/auth/login',{data:{handle:'nonexistent',password:'a strong test password!'}});
    assert.equal((await request('/api/auth/login',{data:{handle:'nonexistent',password:'a strong test password!'}})).status,429);
  });
});
