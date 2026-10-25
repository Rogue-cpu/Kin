import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createApplication} from '../server.mjs';
import {gifBytes} from '../qa/gif-fixture.mjs';
import {validGif} from '../gif-validation.mjs';
import {testDatabase} from './database.mjs';

test('GIF picker and private animated attachments',async t=>{
  const db=await testDatabase(),origin='http://localhost:3000',invite='local-gif-testing-invitation-code';
  const server=await createApplication({db,origin,registrationCode:invite,production:false,callConfig:{iceServers:[],relayConfigured:false},giphyKey:'unit-test-giphy-key'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await db.end();});
  async function req(route,user,data,kind='roleplay'){
    const res=await fetch(base+route,{method:data?'POST':'GET',headers:{'X-Kin-Profile':kind,...(user?{Cookie:user.cookie}:{}),...(data?{Origin:origin,'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
    return {status:res.status,headers:res.headers,body:res.headers.get('content-type')?.includes('application/json')?await res.json():Buffer.from(await res.arrayBuffer())};
  }
  async function register(handle){const r=await req('/api/auth/register',null,{handle,password:'GIF attachments private password!',inviteCode:invite});return {handle,cookie:r.headers.get('set-cookie').split(';')[0],id:(await db.query('SELECT id FROM kin_users WHERE handle=$1',[handle])).rows[0].id};}
  const a=await register('gif_alice'),b=await register('gif_bob'),out=await register('gif_outsider');
  const action=(user,type,data)=>req('/api/actions',user,{actions:[{type,data}]});
  await action(a,'request',{handle:b.handle});await action(b,'accept',{id:a.id});
  const chat=(await req('/api/chats',a,{members:[b.id]})).body.id;
  let asset;
  await t.test('GIPHY configuration is available only to authenticated clients',async()=>{
    assert.equal(validGif(gifBytes('love')),true);
    assert.equal((await req('/api/giphy/config')).status,401);
    const config=await req('/api/giphy/config',a);assert.deepEqual(config.body,{enabled:true,apiKey:'unit-test-giphy-key'});assert.equal(config.headers.get('cache-control'),'no-store');
  });
  const bytes=gifBytes('love'),payload={id:randomUUID(),attachment:{data:'data:image/gif;base64,'+bytes.toString('base64'),duration:0}};
  await t.test('sending preserves the complete animation and deduplicates retries',async()=>{
    assert.equal((await req(`/api/chats/${chat}/messages`,a,payload)).status,201);assert.equal((await req(`/api/chats/${chat}/messages`,a,payload)).status,201);
    const messages=(await req(`/api/chats/${chat}/messages`,b)).body.messages;assert.equal(messages.length,1);assert.equal(messages[0].attachment.mime,'image/gif');asset=messages[0].attachment.url;
    const media=await req(asset,b);assert.equal(media.headers.get('content-type'),'image/gif');assert.equal(Buffer.compare(media.body,bytes),0);
  });
  await t.test('GIFs can be quoted in message replies',async()=>{
    await req(`/api/chats/${chat}/messages`,b,{id:randomUUID(),text:'Love that reaction.',replyToId:payload.id});
    const reply=(await req(`/api/chats/${chat}/messages`,a)).body.messages.at(-1);assert.equal(reply.replyTo.attachmentType,'image/gif');assert.equal(reply.replyTo.id,payload.id);
  });
  await t.test('GIPHY messages persist identifiers rather than media URLs or assets',async()=>{
    const message={id:randomUUID(),giphyId:'ExampleGif123',giphyUrl:'https://media.giphy.com/never-store-this.gif'};
    assert.equal((await req(`/api/chats/${chat}/messages`,a,message)).status,201);assert.equal((await req(`/api/chats/${chat}/messages`,a,message)).status,201);
    const history=(await req(`/api/chats/${chat}/messages`,b)).body.messages,original=history.find(m=>m.id===message.id);assert.equal(original.giphyId,'ExampleGif123');assert.equal(original.attachment,null);assert.equal(JSON.stringify(history).includes('never-store-this'),false);
    assert.equal((await db.query('SELECT count(*)::integer n FROM kin_chat_assets')).rows[0].n,1);
    assert.equal((await req(`/api/chats/${chat}/messages`,a,{...message,giphyId:'AnotherGif'})).status,409);
    await req(`/api/chats/${chat}/messages`,b,{id:randomUUID(),text:'A GIPHY reply',replyToId:message.id});assert.equal((await req(`/api/chats/${chat}/messages`,a)).body.messages.at(-1).replyTo.attachmentType,'image/giphy');
    assert.equal((await req(`/api/chats/${chat}/messages`,a,{id:randomUUID(),giphyId:'https://evil.example/file'})).status,400);
    assert.equal((await req(`/api/chats/${chat}/messages`,a,{id:randomUUID(),giphyId:'ExampleGif123',attachment:payload.attachment})).status,400);
    assert.equal((await req(`/api/chats/${chat}/messages`,out,{id:randomUUID(),giphyId:'ExampleGif123'})).status,404);
  });
  await t.test('invalid, truncated, oversized and excessively large GIFs are rejected',async()=>{
    const dimensions=Buffer.from(bytes);dimensions.writeUInt16LE(2000,6);
    for(const bad of [Buffer.from('GIF89a'),bytes.subarray(0,bytes.length-1),dimensions])assert.equal((await req(`/api/chats/${chat}/messages`,a,{id:randomUUID(),attachment:{data:'data:image/gif;base64,'+bad.toString('base64'),duration:0}})).status,400);
    assert.equal((await req(`/api/chats/${chat}/messages`,a,{id:randomUUID(),attachment:{data:'data:image/gif;base64,'+Buffer.alloc(3145729).toString('base64'),duration:0}})).status,413);
  });
  await t.test('GIF messages and media preserve connection and profile isolation',async()=>{
    assert.equal((await req(asset)).status,401);assert.equal((await req(asset,out)).status,404);
    assert.equal((await req(`/api/chats/${chat}/messages`,a,{...payload,id:randomUUID()},'personal')).status,404);
    await db.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));assert.equal((await req(asset,b)).status,200);
    await action(a,'remove',{id:b.id});assert.equal((await req(asset,b)).status,404);assert.equal((await req(`/api/chats/${chat}/messages`,b)).status,404);
  });
});
