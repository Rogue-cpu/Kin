'use strict';
(() => {
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon=name=>`<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  let kind='',generation=0,timer=null,active=null,incoming=null,stream=null,dialog=null,banner=null,loading=false,starting=false,cursor='0',selfId='',config=null,callStart=0;
  let characterId=null,identity='';
  const peers=new Map(),requests=new Set();
  async function api(path,data){
    const version=generation,controller=new AbortController();requests.add(controller);const timeout=setTimeout(()=>controller.abort(),12000);
    try{const response=await fetch(path,{method:data?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{'X-Kin-Profile':kind,...(kind==='roleplay'&&characterId?{'X-Kin-Character':characterId}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined,signal:controller.signal});const result=await response.json();
      if(version!==generation)throw new DOMException('Call changed','AbortError');
      if(!response.ok){const error=new Error(result.error||'The call could not connect.');error.status=response.status;throw error;}return result;
    }finally{clearTimeout(timeout);requests.delete(controller);}
  }
  function status(message){const el=dialog?.querySelector('.call-status');if(el)el.textContent=message;}
  function cleanup(){
    generation++;for(const request of requests)request.abort();requests.clear();
    for(const peer of peers.values())peer.pc.close();peers.clear();
    stream?.getTracks().forEach(track=>track.stop());stream=null;dialog?.close();dialog?.remove();dialog=null;
    active=null;starting=false;loading=false;cursor='0';selfId='';config=null;callStart=0;
  }
  function leave(){
    const call=active,profile=kind,character=characterId;cleanup();
    if(call)fetch(`/api/calls/${call.id}/leave`,{method:'POST',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'application/json','X-Kin-Profile':profile,...(profile==='roleplay'&&character?{'X-Kin-Character':character}:{})},body:'{}'}).catch(()=>{});
  }
  function close(){leave();clearInterval(timer);timer=null;kind='';characterId=null;identity='';incoming=null;banner?.remove();banner=null;}
  function sync(state){
    const next=state.profileKind||'roleplay',key=next+':'+(state.characterId||'')+':'+(state.accountHandle||state.profile.handle);if(identity===key&&timer)return;close();kind=next;characterId=state.characterId||null;identity=key;timer=setInterval(tick,1500);tick();
  }
  function showIncoming(call){
    if(incoming?.id===call?.id)return;incoming=call;banner?.remove();banner=null;if(!call)return;
    const other=call.members.find(m=>m.id===call.caller)?.name||'Your connection';
    banner=document.createElement('aside');banner.className='incoming-call';banner.setAttribute('role','alert');
    banner.innerHTML=`<span class="incoming-call-icon">${icon(call.video?'video':'phone')}</span><div><strong>${esc(call.title||other)}</strong><span>Incoming ${call.video?'video':'voice'} call · ${kind==='personal'?'Personal':'Roleplay'}</span></div><button class="call-accept">Answer</button><button class="call-decline">Decline</button><p class="incoming-call-error" role="status"></p>`;
    banner.querySelector('.call-accept').onclick=()=>join(call.id).catch(e=>{if(e.name!=='AbortError'&&banner)banner.querySelector('.incoming-call-error').textContent=permissionError(e);});
    banner.querySelector('.call-decline').onclick=async()=>{try{await api(`/api/calls/${call.id}/decline`,{});showIncoming(null);}catch(e){if(banner)banner.querySelector('.incoming-call-error').textContent=e.message;}};
    document.body.append(banner);
  }
  const permissionError=e=>e.name==='NotAllowedError'?'Allow microphone and camera access in your browser to join.':e.name==='NotFoundError'?'No microphone or camera was found. Connect one and try again.':e.message||'The call could not start.';
  async function getStream(video){
    if(!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection)throw new Error('Calls need a current browser with microphone access.');
    return navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:video?{width:{ideal:640},height:{ideal:480},facingMode:'user'}:false});
  }
  async function start(chat,video){
    if(active||starting)throw new Error('Finish the current call first.');
    if(window.KinMessages?.busy)throw new Error('Finish your recording or upload before starting a call.');
    starting=true;const version=generation;let media,created;
    try{
      media=await getStream(video);if(version!==generation){media.getTracks().forEach(t=>t.stop());return;}
      const result=await api(`/api/chats/${chat}/calls`,{video});
      created=result.id;
      await join(result.id,media);media=null;
    }catch(e){media?.getTracks().forEach(t=>t.stop());if(created&&!active)api(`/api/calls/${created}/leave`,{}).catch(()=>{});throw new Error(permissionError(e));}
    finally{if(version===generation)starting=false;}
  }
  async function join(id,provided=null){
    if(active)return;if(starting&&!provided)return;
    if(!provided&&window.KinMessages?.busy)throw new Error('Finish your voice recording or upload before answering.');
    starting=true;const version=generation;let media=provided;
    try{
      const call=await api(`/api/calls/${id}`);
      if(media&&!!media.getVideoTracks().length!==call.video){media.getTracks().forEach(t=>t.stop());media=null;}
      media=media||await getStream(call.video);
      if(version!==generation){media.getTracks().forEach(t=>t.stop());return;}
      config=await api('/api/call-config');
      await api(`/api/calls/${id}/join`,{});
      active=call;stream=media;media=null;selfId=call.members.find(m=>m.self).id;callStart=Date.now();showIncoming(null);showDialog();
      await pollCall();
    }catch(e){media?.getTracks().forEach(t=>t.stop());if(active?.id===id)leave();throw e;}
    finally{if(version===generation)starting=false;}
  }
  function showDialog(){
    dialog=document.createElement('dialog');dialog.className='kin-call-dialog';dialog.setAttribute('aria-labelledby','kin-call-title');
    const names=active.title||active.members.filter(m=>!m.self).map(m=>m.name).join(', ');
    dialog.innerHTML=`<header><span>${kind==='personal'?'PERSONAL':'ROLEPLAY'} · ${active.video?'VIDEO CALL':'VOICE CALL'}</span><h2 id="kin-call-title">${esc(names)}</h2><p class="call-status" role="status">Waiting for someone to answer…</p></header><div class="call-videos"><div class="call-tile local-call-tile"><video autoplay muted playsinline aria-label="Your camera preview"></video><span>You</span></div></div><p class="call-network-note" role="status"></p><div class="call-controls"><button data-call-mute aria-label="Mute microphone" aria-pressed="false">${icon('mic')}<span>Mute</span></button>${active.video?`<button data-call-camera aria-label="Turn camera off" aria-pressed="false">${icon('video')}<span>Camera</span></button>`:''}<button data-call-audio hidden>Enable sound</button><button class="call-hangup" data-call-hangup aria-label="Leave call">${icon('phone')}<span>Leave</span></button></div>`;
    const video=dialog.querySelector('.local-call-tile video');video.srcObject=stream;if(!active.video)video.hidden=true;
    if(!active.video)dialog.querySelector('.local-call-tile').classList.add('voice-only');
    dialog.querySelector('[data-call-mute]').onclick=event=>{const muted=stream.getAudioTracks().some(t=>t.enabled);stream.getAudioTracks().forEach(t=>t.enabled=!muted);const button=event.currentTarget;button.setAttribute('aria-pressed',String(muted));button.querySelector('span').textContent=muted?'Unmute':'Mute';button.setAttribute('aria-label',muted?'Unmute microphone':'Mute microphone');};
    dialog.querySelector('[data-call-camera]')?.addEventListener('click',event=>{const off=stream.getVideoTracks().some(t=>t.enabled);stream.getVideoTracks().forEach(t=>t.enabled=!off);event.currentTarget.setAttribute('aria-pressed',String(off));event.currentTarget.setAttribute('aria-label',off?'Turn camera on':'Turn camera off');});
    dialog.querySelector('[data-call-hangup]').onclick=leave;
    dialog.querySelector('[data-call-audio]').onclick=async event=>{for(const video of dialog.querySelectorAll('.remote-call-tile video'))try{await video.play();}catch{}event.currentTarget.hidden=true;};
    dialog.addEventListener('cancel',event=>{event.preventDefault();leave();});document.body.append(dialog);dialog.showModal();
  }
  async function signal(target,type,data){if(!active)return;return api(`/api/calls/${active.id}/signal`,{target,type,data});}
  function peerFor(id){
    if(peers.has(id))return peers.get(id);
    const pc=new RTCPeerConnection({iceServers:config.iceServers});const peer={pc,candidates:[],offered:false,session:active.peerSessions?.[id]};peers.set(id,peer);
    for(const track of stream.getTracks())pc.addTrack(track,stream);
    pc.onicecandidate=event=>{if(peers.get(id)!==peer)return;if(event.candidate)signal(id,'candidate',event.candidate.toJSON()).catch(e=>{if(e.name!=='AbortError')status('Connection interrupted. Trying again…');});};
    pc.ontrack=event=>{
      if(!dialog)return;let tile=dialog.querySelector(`[data-peer="${id}"]`);
      if(!tile){const member=active.members.find(m=>m.id===id);tile=document.createElement('div');tile.className='call-tile remote-call-tile'+(active.video?'':' voice-only');tile.dataset.peer=id;tile.innerHTML=`<video autoplay playsinline aria-label="${esc(member?.name||'Call member')}"></video><span>${esc(member?.name||'Call member')}</span>`;dialog.querySelector('.call-videos').append(tile);}
      const video=tile.querySelector('video'),remote=event.streams[0]||new MediaStream(pc.getReceivers().map(r=>r.track));if(video.srcObject!==remote)video.srcObject=remote;if(!active.video)video.classList.add('audio-only');video.play().catch(error=>{if(error.name==='NotAllowedError')dialog?.querySelector('[data-call-audio]')?.removeAttribute('hidden');});
    };
    pc.onconnectionstatechange=()=>{
      if(pc.connectionState==='failed'){status('The call could not connect on this network.');const note=dialog?.querySelector('.call-network-note');if(note)note.textContent=config.relayConfigured?'Try another network or restart the call.':'Try another network, or ask your host to enable the calling relay.';}
      else if(pc.connectionState==='connected')status('Connected');
    };
    return peer;
  }
  async function processSignal(message){
    if(!active||message.sender===selfId)return;
    const peer=peerFor(message.sender),pc=peer.pc;
    if(message.type==='candidate'){
      if(pc.remoteDescription)await pc.addIceCandidate(message.payload);else peer.candidates.push(message.payload);
    }else{
      await pc.setRemoteDescription(message.payload);
      for(const candidate of peer.candidates)await pc.addIceCandidate(candidate);peer.candidates=[];
      if(message.type==='offer'){await pc.setLocalDescription(await pc.createAnswer());await signal(message.sender,'answer',pc.localDescription.toJSON());}
    }
  }
  async function pollCall(){
    if(!active)return;const call=active.id;const data=await api(`/api/calls/${call}?after=${cursor}`);if(active?.id!==call)return;active=data;
    for(const [id,peer] of peers)if(!data.peers.includes(id)||peer.session!==data.peerSessions?.[id]){peer.pc.close();peers.delete(id);dialog?.querySelector(`[data-peer="${id}"]`)?.remove();}
    for(const id of data.peers){if(id===selfId)continue;const peer=peerFor(id);if(selfId<id&&!peer.offered){peer.offered=true;await peer.pc.setLocalDescription(await peer.pc.createOffer());await signal(id,'offer',peer.pc.localDescription.toJSON());}}
    for(const message of data.signals){await processSignal(message);cursor=message.seq;}
    const connected=Array.from(peers.values()).filter(p=>p.pc.connectionState==='connected').length;
    if(connected)status(`Connected · ${connected+1} people`);
    else if(Date.now()-callStart>45000&&!data.peers.some(id=>id!==selfId))status('No answer yet. You can leave and try again later.');
  }
  async function tick(){
    if(loading||starting||!kind)return;loading=true;const version=generation;
    try{
      if(active)await pollCall();
      else if(!document.hidden){const data=await api('/api/calls');showIncoming(data.calls.find(c=>c.members.some(m=>m.self&&m.id!==c.caller))||null);}
    }catch(e){if(version!==generation)return;if(e.status===401){close();return;}if([403,404,410].includes(e.status)){leave();showIncoming(null);}else if(e.name!=='AbortError')status('Connection interrupted. Reconnecting…');}
    finally{if(version===generation)loading=false;}
  }
  window.addEventListener('pagehide',()=>{leave();});
  window.KinCalls={sync,close,start,leave,get busy(){return starting||!!active;}};
})();
