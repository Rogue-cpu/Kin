import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApplication} from '../server.mjs';
import {testDatabase} from './database.mjs';

test('chat photos, recordings, and call signaling stay private',async t=>{
  const db=await testDatabase(),origin='http://localhost:3000',invite='local-media-calls-invite-code';
  const server=await createApplication({db,origin,registrationCode:invite,production:false,callConfig:{iceServers:[],relayConfigured:false}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await db.end();});
  async function req(route,user,data,kind='roleplay',source=origin){
    const response=await fetch(base+route,{method:data?'POST':'GET',headers:{'X-Kin-Profile':kind,...(user?{Cookie:user.cookie}:{}),...(data?{Origin:source,'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
    return {status:response.status,headers:response.headers,body:response.headers.get('content-type')?.includes('application/json')?await response.json():Buffer.from(await response.arrayBuffer())};
  }
  async function register(handle){const r=await req('/api/auth/register',null,{handle,password:'test voice call secure password!',inviteCode:invite});return {handle,cookie:r.headers.get('set-cookie').split(';')[0],id:(await db.query('SELECT id FROM kin_users WHERE handle=$1',[handle])).rows[0].id};}
  const a=await register('media_alice'),b=await register('media_bob'),c=await register('media_carol'),outsider=await register('media_outsider');
  const action=(user,type,data,kind='roleplay')=>req('/api/actions',user,{actions:[{type,data}]},kind);
  for(const [first,second] of [[a,b],[b,c],[a,c]]){await action(first,'request',{handle:second.handle});await action(second,'accept',{id:first.id});}
  const direct=(await req('/api/chats',a,{members:[b.id]})).body.id;
  const group=(await req('/api/chats',a,{members:[b.id,c.id],title:'Group call'})).body.id;
  const photo={data:'data:image/jpeg;base64,'+Buffer.from([255,216,255,224,1,2,255,217]).toString('base64'),duration:0};
  const voice={data:'data:audio/webm;base64,'+Buffer.from([26,69,223,163,1,2,3,4]).toString('base64'),duration:3};
  let photoUrl,voiceUrl,call;
  await t.test('attachments are stored once and returned as private URLs',async()=>{
    for(const attachment of [photo,voice]){
      const payload={id:randomUUID(),text:'',attachment};assert.equal((await req(`/api/chats/${direct}/messages`,a,payload)).status,201);assert.equal((await req(`/api/chats/${direct}/messages`,a,payload)).status,201);
    }
    const messages=(await req(`/api/chats/${direct}/messages`,b)).body.messages;assert.equal(messages.length,2);photoUrl=messages[0].attachment.url;voiceUrl=messages[1].attachment.url;
    assert.equal((await req(photoUrl,b)).headers.get('content-type'),'image/jpeg');assert.equal((await req(voiceUrl,b)).headers.get('content-type'),'audio/webm');
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM kin_chat_assets')).rows[0].n,2);
    const ranged=await fetch(base+voiceUrl,{headers:{Cookie:b.cookie,Range:'bytes=0-3'}});assert.equal(ranged.status,206);assert.equal((await ranged.arrayBuffer()).byteLength,4);
    assert.equal((await fetch(base+voiceUrl,{headers:{Cookie:b.cookie,Range:'bytes=999999-'}})).status,416);
  });
  await t.test('outsiders and anonymous readers cannot retrieve attachment bytes',async()=>{
    for(const url of [photoUrl,voiceUrl]){assert.equal((await req(url)).status,401);assert.equal((await req(url,outsider)).status,404);assert.equal((await req(url,c)).status,404);}
    assert.equal((await req(`/api/chats/${direct}/messages`,a,{id:randomUUID(),attachment:photo},'personal')).status,404);
  });
  await t.test('invalid file types, signatures, durations and forged media references are rejected',async()=>{
    for(const attachment of [{data:'data:image/svg+xml;base64,PHN2Zz4=',duration:0},{...voice,duration:61},{...voice,duration:0},{...photo,data:voice.data.replace('audio/webm','image/jpeg')},{data:photoUrl,duration:0}])assert.equal((await req(`/api/chats/${direct}/messages`,a,{id:randomUUID(),attachment})).status,400);
  });
  await t.test('only authenticated users receive calling configuration',async()=>{
    assert.equal((await req('/api/call-config')).status,401);assert.deepEqual((await req('/api/call-config',a)).body,{iceServers:[],relayConfigured:false});
  });
  await t.test('a call rings only chat members in the matching profile',async()=>{
    assert.equal((await req(`/api/chats/${direct}/calls`,outsider,{video:false})).status,404);
    const result=await req(`/api/chats/${direct}/calls`,a,{video:true});assert.equal(result.status,201);call=result.body.id;
    assert.equal((await req('/api/calls',b)).body.calls[0].id,call);assert.equal((await req('/api/calls',c)).body.calls.length,0);assert.equal((await req('/api/calls',b,undefined,'personal')).body.calls.length,0);
    assert.equal((await req(`/api/calls/${call}`,outsider)).status,404);assert.equal((await req(`/api/calls/${call}`,b,undefined,'personal')).status,404);
  });
  await t.test('signaling requires both participants to join and cannot target an outsider',async()=>{
    const payload={target:b.id,type:'offer',data:{type:'offer',sdp:'v=0\r\n'}};
    assert.equal((await req(`/api/calls/${call}/signal`,a,payload)).status,403);
    assert.equal((await req(`/api/calls/${call}/join`,a,{})).status,200);
    assert.equal((await req(`/api/calls/${call}/signal`,a,payload)).status,403);
    assert.equal((await req(`/api/calls/${call}/join`,b,{})).status,200);
    assert.equal((await req(`/api/calls/${call}/signal`,a,{...payload,target:outsider.id})).status,403);
    assert.equal((await req(`/api/calls/${call}/signal`,a,payload,'roleplay','https://elsewhere.example')).status,403);
    assert.equal((await req(`/api/calls/${call}/signal`,a,payload)).status,200);
    const result=(await req(`/api/calls/${call}`,b)).body;assert.deepEqual(result.peers.sort(),[a.id,b.id].sort());assert.equal(result.signals.length,1);assert.equal(result.signals[0].sender,a.id);assert.equal(result.signals[0].type,'offer');
    assert.equal((await req(`/api/calls/${call}?after=${result.signals[0].seq}`,b)).body.signals.length,0);assert.equal((await req(`/api/calls/${call}`,a)).body.signals.length,0);
  });
  await t.test('leaving ends a direct call and clears incoming invitations',async()=>{
    assert.equal((await req(`/api/calls/${call}/leave`,a,{})).status,200);assert.equal((await req(`/api/calls/${call}`,b)).status,410);assert.equal((await req('/api/calls',b)).body.calls.length,0);
  });
  await t.test('group calls permit all members to join and continue after one leaves',async()=>{
    call=(await req(`/api/chats/${group}/calls`,a,{video:false})).body.id;
    for(const user of [a,b,c])assert.equal((await req(`/api/calls/${call}/join`,user,{})).status,200);
    assert.equal((await req(`/api/calls/${call}`,b)).body.peers.length,3);
    await req(`/api/calls/${call}/leave`,a,{});assert.equal((await req(`/api/calls/${call}`,c)).body.peers.length,2);
    assert.equal((await req(`/api/calls/${call}/join`,outsider,{})).status,404);
  });
  await t.test('expired calls cannot be joined or signaled',async()=>{
    await db.query("UPDATE kin_calls SET expires_at=now()-interval '1 second' WHERE id=$1",[call]);assert.equal((await req(`/api/calls/${call}/join`,a,{})).status,410);assert.equal((await req(`/api/calls/${call}`,b)).status,410);
  });
  await t.test('removing a connection revokes attachments and live call signaling',async()=>{
    call=(await req(`/api/chats/${direct}/calls`,a,{video:false})).body.id;await req(`/api/calls/${call}/join`,a,{});await req(`/api/calls/${call}/join`,b,{});
    await action(a,'remove',{id:b.id});
    assert.equal((await req(photoUrl,b)).status,404);assert.equal((await req(voiceUrl,a)).status,404);assert.equal((await req(`/api/calls/${call}`,a)).status,404);assert.equal((await req('/api/calls',b)).body.calls.length,0);
  });
});
