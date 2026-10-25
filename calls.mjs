import {randomUUID,createHmac} from 'node:crypto';
import {CHAT_ACCESS} from './messages.mjs';

export function iceConfiguration(override=null){
  if(override)return override;
  const iceServers=[{urls:'stun:stun.l.google.com:19302'}];
  const urls=(process.env.TURN_URLS||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(urls.length&&urls.every(s=>/^turns?:[^\s]+$/.test(s))&&process.env.TURN_SHARED_SECRET){
    const username=String(Math.floor(Date.now()/1000)+3600)+':kin';
    iceServers.push({urls,username,credential:createHmac('sha1',process.env.TURN_SHARED_SECRET).update(username).digest('base64')});
  }else if(urls.length&&urls.every(s=>/^turns?:[^\s]+$/.test(s))&&process.env.TURN_USERNAME&&process.env.TURN_PASSWORD){
    iceServers.push({urls,username:process.env.TURN_USERNAME,credential:process.env.TURN_PASSWORD});
  }
  return {iceServers,relayConfigured:iceServers.length>1};
}

export function callRoutes({transaction,limited,deny,text,id,authorize,participants,iceConfig}){
  async function callFor(client,user,kind,callId){
    const call=(await client.query('SELECT * FROM kin_calls WHERE id=$1 FOR UPDATE',[callId])).rows[0];
    deny(!call,404,'Call unavailable.');await authorize(client,user,kind,call.chat_id);
    deny(call.ended_at||new Date(call.expires_at).getTime()<Date.now()||new Date(call.created_at).getTime()<Date.now()-7200000,410,'This call has ended.');
    return call;
  }
  async function joined(client,user,call){
    deny(!(await client.query("SELECT 1 FROM kin_call_members WHERE call_id=$1 AND user_id=$2 AND state='joined' AND seen_at>now()-interval '45 seconds'",[call,user])).rows.length,403,'Join the call first.');
  }
  return async({req,route,url,body,user,kind,send})=>{
    if(route==='/api/call-config'&&req.method==='GET'){send(200,iceConfig());return true;}
    if(route==='/api/calls'&&req.method==='GET'){
      const calls=await transaction(async client=>{
        const rows=(await client.query(`SELECT k.id,k.chat_id,k.video,k.caller,k.created_at,c.title,c.is_group FROM kin_calls k JOIN kin_chats c ON c.id=k.chat_id WHERE ${CHAT_ACCESS} AND k.ended_at IS NULL AND k.expires_at>now() AND k.created_at>now()-interval '2 hours' AND NOT EXISTS(SELECT 1 FROM kin_call_members m WHERE m.call_id=k.id AND m.user_id=$1 AND m.state IN ('left','declined')) ORDER BY k.created_at DESC LIMIT 10`,[user.id,kind])).rows;
        for(const c of rows)c.members=await participants(client,c.chat_id,kind,user.id);return rows;
      });send(200,{calls});return true;
    }
    if(req.method==='POST'&&/^\/api\/chats\/[a-f0-9-]{36}\/calls$/.test(route)){
      await limited(`call-start:${user.id}`,15,3600);const chat=id(route.split('/')[3]);deny(typeof body.video!=='boolean',400,'Choose voice or video.');
      const callId=await transaction(async client=>{
        await authorize(client,user.id,kind,chat);
        await client.query("DELETE FROM kin_calls WHERE expires_at<now()-interval '1 day'");
        const existing=(await client.query("SELECT id FROM kin_calls WHERE chat_id=$1 AND ended_at IS NULL AND expires_at>now() AND created_at>now()-interval '2 hours' ORDER BY created_at DESC LIMIT 1",[chat])).rows[0];
        if(existing)return existing.id;
        const cid=randomUUID();await client.query('INSERT INTO kin_calls(id,chat_id,caller,video) VALUES($1,$2,$3,$4)',[cid,chat,user.id,body.video]);return cid;
      });send(201,{id:callId});return true;
    }
    const match=/^\/api\/calls\/([a-f0-9-]{36})(?:\/(join|leave|decline|signal))?$/.exec(route);if(!match)return false;
    const cid=id(match[1]),action=match[2];
    if(req.method==='GET'&&!action){
      const cursor=url.searchParams.get('after')||'0';deny(!/^[0-9]{1,18}$/.test(cursor),400,'Invalid signal cursor.');
      const result=await transaction(async client=>{
        const call=await callFor(client,user.id,kind,cid);
        const member=(await client.query('SELECT state FROM kin_call_members WHERE call_id=$1 AND user_id=$2',[cid,user.id])).rows[0];
        const signals=member?.state==='joined'?(await client.query('SELECT seq::text,sender,type,payload FROM kin_call_signals s WHERE call_id=$1 AND recipient=$2 AND s.seq>$3::bigint ORDER BY s.seq LIMIT 200',[cid,user.id,cursor])).rows:[];
        if(member?.state==='joined'){
          await client.query('UPDATE kin_call_members SET seen_at=now() WHERE call_id=$1 AND user_id=$2',[cid,user.id]);
          await client.query("UPDATE kin_calls SET expires_at=now()+interval '60 seconds' WHERE id=$1",[cid]);
        }
        const joinedMembers=(await client.query("SELECT user_id,joined_at FROM kin_call_members WHERE call_id=$1 AND state='joined' AND seen_at>now()-interval '45 seconds' ORDER BY user_id",[cid])).rows;
        return {...call,members:await participants(client,call.chat_id,kind,user.id),peers:joinedMembers.map(r=>r.user_id),peerSessions:Object.fromEntries(joinedMembers.map(r=>[r.user_id,r.joined_at])),signals};
      });send(200,result);return true;
    }
    if(req.method==='POST'&&action){
      await limited(`call-write:${user.id}`,600,60);
      await transaction(async client=>{
        const call=await callFor(client,user.id,kind,cid);
        if(action==='join'){
          const elsewhere=(await client.query("SELECT 1 FROM kin_call_members m JOIN kin_calls c ON c.id=m.call_id WHERE m.user_id=$1 AND m.call_id<>$2 AND m.state='joined' AND m.seen_at>now()-interval '45 seconds' AND c.ended_at IS NULL AND c.expires_at>now()",[user.id,cid])).rows.length;
          deny(elsewhere,409,'You are already in another call. Leave that call first.');
          await client.query('DELETE FROM kin_call_signals WHERE call_id=$1 AND (sender=$2 OR recipient=$2)',[cid,user.id]);
          await client.query("INSERT INTO kin_call_members(call_id,user_id,state) VALUES($1,$2,'joined') ON CONFLICT(call_id,user_id) DO UPDATE SET state='joined',seen_at=now(),joined_at=now()",[cid,user.id]);
          await client.query("UPDATE kin_calls SET expires_at=now()+interval '60 seconds' WHERE id=$1",[cid]);return;
        }
        if(action==='leave'||action==='decline'){
          await client.query('INSERT INTO kin_call_members(call_id,user_id,state) VALUES($1,$2,$3) ON CONFLICT(call_id,user_id) DO UPDATE SET state=$3,seen_at=now()',[cid,user.id,action==='leave'?'left':'declined']);
          const group=(await client.query('SELECT is_group FROM kin_chats WHERE id=$1',[call.chat_id])).rows[0].is_group;
          const left=(await client.query("SELECT 1 FROM kin_call_members WHERE call_id=$1 AND state='joined' AND seen_at>now()-interval '45 seconds'",[cid])).rows.length;
          if(!group||!left)await client.query('UPDATE kin_calls SET ended_at=now() WHERE id=$1',[cid]);return;
        }
        await joined(client,user.id,cid);
        const recipient=id(body.target);deny(recipient===user.id,400,'Choose another call member.');await joined(client,recipient,cid);
        deny(!['offer','answer','candidate'].includes(body.type),400,'Invalid call signal.');
        const payload=body.data;deny(!payload||typeof payload!=='object'||Array.isArray(payload)||JSON.stringify(payload).length>40000,400,'Invalid call signal.');
        if(body.type==='candidate')deny(typeof payload.candidate!=='string'||payload.candidate.length>3000,400,'Invalid connection candidate.');
        else deny(payload.type!==body.type||typeof payload.sdp!=='string'||payload.sdp.length>35000,400,'Invalid session description.');
        await client.query('INSERT INTO kin_call_signals(call_id,sender,recipient,type,payload) VALUES($1,$2,$3,$4,$5::jsonb)',[cid,user.id,recipient,body.type,JSON.stringify(payload)]);
      });send(200,{ok:true});return true;
    }
    deny(true,405,'Method not supported.');
  };
}
