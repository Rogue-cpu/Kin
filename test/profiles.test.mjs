import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createApplication} from '../server.mjs';
import {testDatabase} from './database.mjs';

test('personal and roleplay profiles have independent content and permissions',async t=>{
  const db=await testDatabase(),origin='http://localhost:3000',invite='test-invitation-code-for-two-profiles';
  const server=await createApplication({db,origin,registrationCode:invite,production:false});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await db.end();});
  async function request(route,user,kind='roleplay',data){
    const response=await fetch(base+route,{method:data?'POST':'GET',headers:{'X-Kin-Profile':kind,...(user?{Cookie:user.cookie}:{}),...(data?{Origin:origin,'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
    const body=response.headers.get('content-type')?.startsWith('application/json')?await response.json():Buffer.from(await response.arrayBuffer());
    return {status:response.status,body,cookie:response.headers.get('set-cookie')};
  }
  const action=(user,kind,type,data)=>request('/api/actions',user,kind,{actions:[{type,data}]});
  const state=async(user,kind)=>(await request('/api/state',user,kind)).body;
  const profile=(name,fandom='Supernatural')=>({name,fandom,role:'Hunter',bio:'A private profile.',pronouns:'they/them',location:'',backstory:'Private character story',boundaries:'Discuss plot changes first.',portrait:''});
  const image='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,0,0,255,217]).toString('base64');
  async function register(handle){const response=await request('/api/auth/register',null,'roleplay',{handle,password:'a very strong test password!',inviteCode:invite});assert.equal(response.status,201);return {cookie:response.cookie.split(';')[0],handle};}
  const alice=await register('alice_dual'),bob=await register('bob_dual');
  let aliceId,bobId,personalImage,roleplayImage,personalAvatar;
  await t.test('one login reads two separate profiles and edits do not bleed',async()=>{
    assert.equal((await action(alice,'roleplay','profile',profile('Alice Hunter'))).status,200);
    assert.equal((await action(alice,'personal','profile',{...profile('Alice Real'),location:'Chicago'})).status,200);
    assert.equal((await action(bob,'roleplay','profile',profile('Bob Hunter'))).status,200);
    assert.equal((await action(bob,'personal','profile',profile('Bob Real'))).status,200);
    const real=await state(alice,'personal'),rp=await state(alice,'roleplay');
    assert.equal(real.profile.name,'Alice Real');assert.equal(real.profile.fandom,'Personal');assert.equal(real.profile.backstory,'');assert.equal(real.profile.location,'Chicago');
    assert.equal(rp.profile.name,'Alice Hunter');assert.equal(rp.profile.backstory,'Private character story');assert.equal(real.profiles.length,2);
    assert.equal((await request('/api/state',alice,'invalid')).status,400);
  });
  await t.test('posts stay in their selected context even if a body forges a different kind',async()=>{
    const real=await action(alice,'personal','post',{id:'personal-only',caption:'My real life.',mode:'ooc',audience:'cast',image,alt:'A personal photo',profile_kind:'roleplay'});
    assert.equal(real.status,200);personalImage=real.body.posts[0].image;assert.equal(real.body.posts[0].mode,'ic');
    const rp=await action(alice,'roleplay','post',{id:'roleplay-only',caption:'A hunting scene.',mode:'ic',audience:'all',image,alt:'A roleplay photo'});
    assert.equal(rp.status,200);roleplayImage=rp.body.posts[0].image;
    assert.deepEqual((await state(alice,'personal')).posts.map(p=>p.id),['personal-only']);
    assert.deepEqual((await state(alice,'roleplay')).posts.map(p=>p.id),['roleplay-only']);
    assert.equal((await action(alice,'roleplay','delete-post',{id:'personal-only'})).status,404);
    assert.equal((await action(alice,'roleplay','post',{id:'reused-image',caption:'Wrong profile.',mode:'ic',audience:'all',image:personalImage,alt:'Wrong profile image'})).status,403);
  });
  await t.test('roleplay approval does not authorize personal posts, replies, or photos',async()=>{
    assert.equal((await action(bob,'roleplay','request',{handle:alice.handle})).status,200);
    bobId=(await state(alice,'roleplay')).requests[0].id;
    assert.equal((await action(alice,'roleplay','accept',{id:bobId})).status,200);
    const rp=await state(bob,'roleplay');aliceId=rp.people[0].id;
    assert.deepEqual(rp.posts.map(p=>p.id),['roleplay-only']);assert.equal(rp.people[0].name,'Alice Hunter');
    assert.equal((await state(bob,'personal')).people.length,0);assert.equal((await state(bob,'personal')).posts.length,0);
    assert.equal((await request(personalImage,bob)).status,404);
    assert.equal((await request(roleplayImage,bob)).status,200);
    assert.equal((await action(bob,'roleplay','reply',{id:'personal-only',text:'Not allowed.',mode:'ic'})).status,404);
    assert.equal((await action(bob,'personal','bookmark',{id:'personal-only',value:true})).status,404);
  });
  await t.test('personal avatars cannot be read through a roleplay connection',async()=>{
    const result=await action(alice,'personal','profile',{...profile('Alice Real'),portrait:image});assert.equal(result.status,200);personalAvatar=result.body.profile.portrait;
    assert.equal((await request(personalAvatar,bob)).status,404);
    assert.equal((await action(alice,'roleplay','profile',{...profile('Alice Hunter'),portrait:personalAvatar})).status,403);
  });
  await t.test('the same two writers can connect separately in both profiles',async()=>{
    assert.equal((await action(bob,'personal','request',{handle:alice.handle})).status,200);
    assert.equal((await action(alice,'roleplay','accept',{id:bobId})).status,404);
    assert.equal((await state(alice,'personal')).requests.length,1);
    assert.equal((await action(alice,'personal','accept',{id:bobId})).status,200);
    const real=await state(bob,'personal');assert.equal(real.people[0].name,'Alice Real');assert.equal(real.people[0].backstory,'');
    assert.deepEqual(real.posts.map(p=>p.id),['personal-only']);assert.equal((await request(personalAvatar,bob)).status,200);
    assert.equal((await db.query('SELECT count(*)::int count FROM kin_connections')).rows[0].count,2);
    // A second startup migration must work after duplicate account pairs exist in different profiles.
    await db.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
    assert.equal((await state(bob,'personal')).posts.length,1);
  });
  await t.test('replies and bookmarks use the active identity and remain separated',async()=>{
    const real=await action(bob,'personal','reply',{id:'personal-only',text:'Love this photo.',mode:'ic'});assert.equal(real.status,200);assert.equal(real.body.posts[0].comments[0].name,'Bob Real');
    const rp=await action(bob,'roleplay','reply',{id:'roleplay-only',text:'Back to the hunt.',mode:'ic'});assert.equal(rp.status,200);assert.equal(rp.body.posts[0].comments[0].name,'Bob Hunter');
    assert.equal((await action(bob,'personal','bookmark',{id:'personal-only',value:true})).body.posts[0].saved,true);
    assert.equal((await state(bob,'roleplay')).posts[0].saved,false);
    assert.equal((await action(bob,'personal','like',{id:'roleplay-only',value:true})).status,404);
  });
  await t.test('personal circle changes do not change roleplay permissions',async()=>{
    assert.equal((await action(alice,'personal','circle',{id:bobId,group:'partners'})).status,200);
    assert.equal((await state(bob,'personal')).posts.length,0);
    assert.equal((await state(bob,'roleplay')).posts.length,1);
    assert.equal((await request(personalImage,bob)).status,404);
    assert.equal((await request(roleplayImage,bob)).status,200);
  });
  await t.test('removing a personal connection keeps the roleplay relationship',async()=>{
    assert.equal((await action(alice,'personal','remove',{id:bobId})).status,200);
    assert.equal((await state(bob,'personal')).people.length,0);
    assert.equal((await state(bob,'roleplay')).people.length,1);
    assert.equal((await request(personalAvatar,bob)).status,404);
    assert.equal((await request(roleplayImage,bob)).status,200);
  });
});

test('upgrade preserves existing character, post, connection, image, and session',async t=>{
  const db=await testDatabase();
  const schema=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
  const legacy=schema.split('-- Existing accounts')[0]+"CREATE UNIQUE INDEX kin_connection_pair ON kin_connections(least(requester,recipient),greatest(requester,recipient));\nCOMMIT;";
  await db.query(legacy);
  const owner=randomUUID(),friend=randomUUID(),photo=randomUUID(),token='a'.repeat(64);
  for(const [user,name] of [[owner,'Existing Character'],[friend,'Existing Friend']])await db.query('INSERT INTO kin_users(id,handle,password_hash,recovery_hash,character) VALUES($1,$2,$3,$4,$5)',[user,'old_'+user.slice(0,8),'unused','unused',JSON.stringify({name,fandom:'Twilight',bio:'Existing bio',portrait:''})]);
  await db.query('INSERT INTO kin_media(id,owner,bytes) VALUES($1,$2,$3)',[photo,owner,Buffer.from([255,216,255,217])]);
  await db.query("INSERT INTO kin_posts(id,author,caption,mode,audience,image_id,alt) VALUES('legacy-post',$1,'Existing writing.','ic','all',$2,'Existing photo')",[owner,photo]);
  await db.query("INSERT INTO kin_connections(id,requester,recipient,status) VALUES($1,$2,$3,'accepted')",[randomUUID(),owner,friend]);
  await db.query("INSERT INTO kin_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",[createHash('sha256').update(token).digest('hex'),owner]);
  const server=await createApplication({db,origin:'http://localhost:3000',registrationCode:'migration-test-code-at-least-24',production:false});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await db.end();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers={Cookie:'kin_session='+token};
  const rp=await (await fetch(base+'/api/state',{headers})).json();
  assert.equal(rp.profile.name,'Existing Character');assert.equal(rp.posts[0].caption,'Existing writing.');assert.equal(rp.people[0].name,'Existing Friend');assert.equal(rp.posts[0].image,'/api/media/'+photo);
  const real=await (await fetch(base+'/api/state',{headers:{...headers,'X-Kin-Profile':'personal'}})).json();
  assert.equal(real.profile.name,'Your name');assert.equal(real.posts.length,0);assert.equal(real.people.length,0);
});
