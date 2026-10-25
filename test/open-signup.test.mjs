import test from 'node:test';
import assert from 'node:assert/strict';
import {createApplication} from '../server.mjs';
import {testDatabase} from './database.mjs';

test('open signup welcomes writers without weakening private account access',async t=>{
  const db=await testDatabase(),origin='http://localhost:3000';
  const server=await createApplication({db,origin,registrationMode:'open',production:false});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await db.end();});
  async function req(path,data,cookie,requestOrigin=origin){const response=await fetch(base+path,{method:data?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(data?{'Content-Type':'application/json',Origin:requestOrigin}:{})},body:data?JSON.stringify(data):undefined});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  assert.deepEqual((await req('/api/config')).body,{accounts:true,inviteOnly:false,defaultProfile:'roleplay'});
  const credentials={handle:'open_writer',password:'an open signup secure password!'};
  assert.equal((await req('/api/auth/register',credentials,null,'https://other.example')).status,403);
  assert.equal((await req('/api/auth/register',{...credentials,password:'short'})).status,400);
  const joined=await req('/api/auth/register',credentials);
  assert.equal(joined.status,201);assert.ok(joined.body.recoveryCode);
  assert.equal((await req('/api/state')).status,401);
  assert.equal((await req('/api/state',undefined,joined.cookie)).status,200);
  assert.equal((await req('/api/auth/register',credentials)).status,409);
  assert.equal((await req('/api/auth/login',credentials)).status,200);
  const recovered=await req('/api/auth/recover',{...credentials,password:'replacement open signup password!',recoveryCode:joined.body.recoveryCode});
  assert.equal(recovered.status,200);assert.equal((await req('/api/state',undefined,joined.cookie)).status,401);
  assert.equal((await req('/api/state',undefined,recovered.cookie)).status,200);
  await assert.rejects(createApplication({db,origin,registrationMode:'invalid',production:false}),/REGISTRATION_MODE/);
  await assert.rejects(createApplication({db,origin,production:false}),/REGISTRATION_CODE/);
});
