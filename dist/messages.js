'use strict';
(() => {
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon=name=>`<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  let root=null,context=null,kind='',epoch=0,timer=null,active=null,thread=null,chats=[],busy=false,loading=false,requestVersion=0;
  const pending=new Set();
  let giphySelection=null,gifChoices=new Map(),gifOffset=0,gifQuery='';
  let attachment=null,attachmentKey='',recorder=null,recordStream=null,recordTimer=null,recordStart=0;
  let mediaGeneration=0,selectedReply=null,gifDialog=null,gifSearchTimer=null,gifSearchVersion=0;
  const portrait=member=>/^\/api\/media\/[a-f0-9-]{36}$/.test(member.portrait||'')?`<img src="${esc(member.portrait)}" alt="">`:`<span>${esc(member.name.trim().split(/\s+/).slice(0,2).map(p=>p[0]).join('').toUpperCase())}</span>`;
  const title=chat=>chat.title||chat.members.filter(m=>!m.self).map(m=>m.name).join(', ')||'Conversation';
  const avatar=chat=>`<span class="chat-avatar">${chat.is_group||chat.isGroup?icon('people'):portrait(chat.members.find(m=>!m.self)||chat.members[0])}</span>`;
  async function api(path,data) {
    const revision=epoch,controller=new AbortController();pending.add(controller);
    const timeout=setTimeout(()=>controller.abort(),15000);
    try {
      const response=await fetch(path,{method:data?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{'X-Kin-Profile':kind,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
      const result=await response.json();
      if(revision!==epoch||!root?.isConnected)throw new DOMException('View changed','AbortError');
      if(response.status===401){window.KinAccount.expired('Sign in to read your messages.');throw new DOMException('Signed out','AbortError');}
      if(!response.ok){const error=new Error(result.error||'Messages could not load.');error.status=response.status;throw error;}
      return result;
    }catch(error){
      if(error.name==='AbortError'&&revision===epoch&&root?.isConnected)throw new Error('Messages timed out. Your draft is still here; try sending again.');
      throw error;
    }finally{clearTimeout(timeout);pending.delete(controller);}
  }
  function error(message){const el=root?.querySelector('.chat-error');if(el)el.textContent=message;}
  function close(){window.KinGiphy.reset();closeGifPicker();selectedReply=null;clearMedia();epoch++;requestVersion++;clearInterval(timer);timer=null;for(const controller of pending)controller.abort();pending.clear();root=null;context=null;thread=null;chats=[];active=null;kind='';busy=false;loading=false;}
  function paintInbox(){
    const list=root.querySelector('.chat-list');
    list.innerHTML=chats.length?chats.map(c=>`<button class="chat-list-item ${active===c.id?'selected':''}" data-chat="${c.id}">${avatar(c)}<span><strong>${esc(title(c))}</strong><small>${esc(c.preview||'Start the conversation')}</small></span>${icon('arrow')}</button>`).join(''):'<div class="chat-empty"><h3>Your conversations start here</h3><p>Choose an approved connection to say hello or start a scene.</p><button class="button" data-chat-new>New message</button></div>';
  }
  async function refresh(){
    if(loading||busy||!root||document.hidden)return;loading=true;const revision=epoch;
    try {const data=await api('/api/chats');chats=data.chats;paintInbox();if(active)await loadThread(false);}
    catch(e){if(e.name!=='AbortError'){if(e.status===404||e.status===403){clearMedia();selectedReply=null;active=null;thread=null;root.querySelector('.chat-pane').innerHTML='<div class="chat-empty"><p>This conversation is no longer available.</p></div>';root.classList.remove('thread-open');}error(e.message||'Connection interrupted. Try again.');}}
    finally{if(revision===epoch)loading=false;}
  }
  function render(container,state){
    if(root===container.querySelector('.messenger')&&kind===state.profileKind){context=state;return;}
    close();root=document.createElement('section');root.className='messenger';root.setAttribute('aria-label','Private messages');context=state;kind=state.profileKind||'roleplay';
    root.innerHTML=`<aside class="chat-inbox"><header><div><span class="chat-mode">${kind==='personal'?'PERSONAL':'ROLEPLAY'}</span><h2>Messages</h2></div><button class="icon-button" data-chat-new aria-label="New message">${icon('plus')}</button></header><div class="chat-list"><p class="chat-loading">Loading conversations…</p></div></aside><section class="chat-pane"><div class="chat-empty"><span class="chat-empty-icon">${icon('comment')}</span><h2>Your people. Your conversations.</h2><p>A quick hello, a new plot, a whole group story.</p><button class="button button-primary" data-chat-new>Send a message</button></div></section><p class="chat-error" role="status"></p>`;
    container.replaceChildren(root);
    root.addEventListener('click',async event=>{
      const button=event.target.closest('button');if(!button||busy)return;
      try{
        if(button.dataset.startCall!==undefined){await window.KinCalls.start(active,button.dataset.startCall==='video');}
        else if(button.hasAttribute('data-giphy-retry')){const holder=button.closest('.giphy-message');delete holder.dataset.giphyState;window.KinGiphy.hydrate(root);}
        else if(button.hasAttribute('data-chat-gif'))showGifPicker();
        else if(button.hasAttribute('data-chat-photo'))root.querySelector('#chat-photo').click();
        else if(button.hasAttribute('data-chat-record'))await recordVoice();
        else if(button.hasAttribute('data-record-stop')){if(recorder?.state==='recording')recorder.stop();}
        else if(button.hasAttribute('data-media-remove')){clearMedia();paintAttachment();}
        else if(button.dataset.messageReply){selectedReply=thread?.messages.find(m=>m.id===button.dataset.messageReply)||null;paintReply();root.querySelector('#chat-text')?.focus();}
        else if(button.hasAttribute('data-reply-cancel')){selectedReply=null;paintReply();}
        else if(button.dataset.replyJump){await jumpToMessage(button.dataset.replyJump);}
        else if(button.hasAttribute('data-chat-latest')){if(recorder)throw new Error('Finish your recording first.');requestVersion++;await loadThread(true);}
        else if(button.hasAttribute('data-chat-new')){selectedReply=null;clearMedia();newChat();}
        else if(button.dataset.chat){selectedReply=null;clearMedia();active=button.dataset.chat;thread=null;requestVersion++;root.classList.add('thread-open');root.querySelector('.chat-pane').innerHTML='<p class="chat-loading">Opening conversation…</p>';paintInbox();await loadThread(true);}
        else if(button.hasAttribute('data-chat-back')){selectedReply=null;clearMedia();active=null;thread=null;requestVersion++;root.classList.remove('thread-open');root.querySelector('.chat-pane').innerHTML='<div class="chat-empty"><h2>Your messages</h2><p>Choose a conversation or start a new message.</p><button class="button button-primary" data-chat-new>New message</button></div>';paintInbox();}
        else if(button.hasAttribute('data-chat-older'))await older();
        else if(button.hasAttribute('data-chat-retry'))await refresh();
      }catch(e){if(e.name!=='AbortError'){if(e.status===404||e.status===403){thread=null;active=null;root.querySelector('.chat-pane').innerHTML='<div class="chat-empty"><p>Conversation unavailable.</p></div>';root.classList.remove('thread-open');}error(e.message);}}
    });
    root.addEventListener('change',event=>{if(event.target.id==='chat-photo'&&event.target.files[0])(event.target.files[0].type==='image/gif'?chooseGif:choosePhoto)(event.target.files[0]);});
    root.addEventListener('paste',event=>{const file=Array.from(event.clipboardData?.files||[]).find(f=>f.type==='image/gif');if(file){event.preventDefault();chooseGif(file);}});
    root.addEventListener('submit',event=>{event.preventDefault();const form=event.target;if(form.id==='chat-compose')send(form);if(form.id==='chat-create')create(form);});
    root.addEventListener('keydown',event=>{if(event.target.id==='chat-text'&&event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();event.target.form.requestSubmit();}});
    refresh();timer=setInterval(refresh,3000);
  }
  function newChat(){
    selectedReply=null;
    active=null;thread=null;requestVersion++;root.classList.add('thread-open');error('');
    const people=context.people;
    root.querySelector('.chat-pane').innerHTML=`<header class="chat-header"><button class="icon-button" data-chat-back aria-label="Back to inbox">${icon('arrow')}</button><h2>New message</h2></header><form id="chat-create"><p>Choose up to 9 people. Everyone must be approved connections with each other in this ${kind==='personal'?'personal':'roleplay'} profile.</p><label class="field-label" for="chat-title">Group name (optional)</label><input class="field-input" id="chat-title" maxlength="80" placeholder="Your group story"><fieldset><legend>Send to</legend>${people.length?people.map(p=>`<label class="chat-recipient"><input type="checkbox" name="member" value="${p.id}"><span class="chat-avatar">${portrait(p)}</span><span><strong>${esc(p.name)}</strong><small>@${esc(p.handle)}</small></span></label>`).join(''):'<p>Approve a connection in Your people before starting a chat.</p>'}</fieldset><button class="button button-primary" type="submit" ${people.length?'':'disabled'}>Start conversation</button></form>`;
  }
  async function create(form){
    if(busy)return;const members=Array.from(form.querySelectorAll('[name=member]:checked'),e=>e.value);
    if(!members.length||members.length>9){error('Choose between 1 and 9 connections.');return;}
    busy=true;const revision=epoch;const button=form.querySelector('[type=submit]');button.disabled=true;error('');
    try{const result=await api('/api/chats',{members,title:form.querySelector('#chat-title').value});active=result.id;thread=null;await loadThread(true);}
    catch(e){if(e.name!=='AbortError')error(e.message);}
    finally{if(revision===epoch){busy=false;button.disabled=false;refresh();}}
  }
  function messageHTML(message,members){
    const sender=members.find(m=>m.id===message.sender)||{name:'Member',portrait:''};
    return `<div class="chat-message ${message.self?'outgoing':'incoming'}" data-message="${message.id}">${message.self?'':`<span class="message-avatar">${portrait(sender)}</span>`}<div>${message.self?'':`<span class="message-author">${esc(sender.name)}</span>`}${message.replyTo?quoteHTML(message.replyTo,members):''}${message.giphyId?window.KinGiphy.html(message.giphyId):''}${message.attachment?attachmentHTML(message.attachment):''}${message.body?`<p class="message-bubble">${esc(message.body)}</p>`:''}<div class="message-meta"><time datetime="${esc(message.created_at)}">${esc(new Date(message.created_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))}</time><button type="button" class="message-reply-button" data-message-reply="${message.id}" aria-label="Reply to ${esc(message.self?'your message':sender.name)}">Reply</button></div></div></div>`;
  }
  function messageList(data){
    let date='';return data.messages.map(m=>{const next=new Date(m.created_at).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'}),stamp=next===date?'':`<div class="chat-date">${esc(next)}</div>`;date=next;return stamp+messageHTML(m,data.members);}).join('');
  }
  async function loadThread(initial,around=null){
    if(!initial&&thread?.anchored){await api(`/api/chats/${active}/messages?around=${thread.messages.at(-1).id}`);return;}
    const chat=active,version=requestVersion;if(!chat)return;
    const data=await api(`/api/chats/${chat}/messages${around?'?around='+encodeURIComponent(around):''}`);if(chat!==active||version!==requestVersion)return;
    const pane=root.querySelector('.chat-pane');
    if(!thread||initial){
      const oldField=pane.querySelector('#chat-text'),draft=oldField?.value||'',retryId=oldField?.dataset.messageId,retryContent=oldField?.dataset.content;
      thread=data;
      pane.innerHTML=`<header class="chat-header"><button class="icon-button" data-chat-back aria-label="Back to inbox">${icon('arrow')}</button>${avatar(data)}<div><h2>${esc(title(data))}</h2><p>${data.isGroup?data.members.length+' members':'Private conversation'} · ${kind==='personal'?'Personal':'Roleplay'}</p></div><div class="chat-call-actions"><button class="icon-button" data-start-call="audio" aria-label="Start voice call">${icon('phone')}</button><button class="icon-button" data-start-call="video" aria-label="Start video call">${icon('video')}</button></div></header><div class="chat-history" role="log" aria-label="Messages" aria-live="polite"><div class="chat-older">${data.anchored?'<button data-chat-latest>Return to latest messages</button>':''}${data.hasMore?'<button data-chat-older>Load earlier messages</button>':''}</div><p class="chat-start">${data.isGroup?'A private group for '+data.members.map(m=>esc(m.name)).join(', '):'Your conversation with '+esc(data.members.find(m=>!m.self)?.name||'your connection')}<br><span>Only members can read this chat.</span></p><div class="chat-message-list">${messageList(data)}</div></div><form id="chat-compose"><label class="sr-only" for="chat-text">Message</label><div class="chat-reply-preview" aria-live="polite"></div><div class="chat-attachment-preview" aria-live="polite"></div><input id="chat-photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden><div class="message-composer"><button type="button" class="composer-tool" data-chat-photo aria-label="Attach photo">${icon('image')}</button><textarea id="chat-text" required maxlength="4000" rows="1" placeholder="${kind==='personal'?'Message…':'Write a message or start a scene…'}"></textarea><button type="button" class="composer-tool gif-tool" data-chat-gif aria-label="Choose a GIF">GIF</button><button type="button" class="composer-tool" data-chat-record aria-label="Record voice message">${icon('mic')}</button><button type="submit" aria-label="Send message">${icon('arrow')}</button></div><small>Enter to send · Shift + Enter for a new line</small></form>`;
      const newField=pane.querySelector('#chat-text');newField.value=draft;if(retryId){newField.dataset.messageId=retryId;newField.dataset.content=retryContent;}paintReply();paintAttachment();
      const history=pane.querySelector('.chat-history');history.scrollTop=history.scrollHeight;
    }else{
      const history=pane.querySelector('.chat-history');if(!history)return;
      const bottom=history.scrollHeight-history.scrollTop-history.clientHeight<90;
      const known=new Set(thread.messages.map(m=>m.id));const added=data.messages.filter(m=>!known.has(m.id));
      if(added.length){thread.messages.push(...added);pane.querySelector('.chat-message-list').insertAdjacentHTML('beforeend',added.map(m=>messageHTML(m,data.members)).join(''));if(bottom||added.some(m=>m.self))history.scrollTop=history.scrollHeight;}
      // Repaint names without replacing the composer or a draft.
      pane.querySelector('.chat-header h2').textContent=title(data);thread.members=data.members;
    }
    window.KinGiphy.hydrate(root);
  }
  async function older(){
    if(!thread?.messages.length||busy)return;busy=true;const revision=epoch,chat=active,version=requestVersion;
    try{const data=await api(`/api/chats/${chat}/messages?before=${thread.messages[0].seq}`);if(active!==chat||version!==requestVersion)return;
      const history=root.querySelector('.chat-history'),height=history.scrollHeight;
      thread.messages=[...data.messages,...thread.messages];thread.hasMore=data.hasMore;
      root.querySelector('.chat-message-list').innerHTML=messageList(thread);root.querySelector('.chat-older').innerHTML=(thread.anchored?'<button data-chat-latest>Return to latest messages</button>':'')+(data.hasMore?'<button data-chat-older>Load earlier messages</button>':'');history.scrollTop+=history.scrollHeight-height;window.KinGiphy.hydrate(root);
    }catch(e){if(e.name!=='AbortError')error(e.message);}finally{if(revision===epoch)busy=false;}
  }
  async function send(form){
    const field=form.querySelector('textarea'),content=field.value.trim();if((!content&&!attachment&&!giphySelection)||busy||recorder||!active)return;
    busy=true;const revision=epoch,chat=active;const button=form.querySelector('[type=submit]');button.disabled=true;error('');
    const media=attachment,giphy=giphySelection,mediaKey=attachmentKey,reply=selectedReply,draftKey=JSON.stringify([content,attachmentKey,selectedReply?.id||null]);
    // Keep an id on the draft so a retry after a lost response cannot duplicate it.
    if(field.dataset.content!==draftKey){field.dataset.messageId=crypto.randomUUID();field.dataset.content=draftKey;}
    try{await api(`/api/chats/${chat}/messages`,{id:field.dataset.messageId,text:content,attachment:media,giphyId:giphy?.id||null,replyToId:reply?.id||null});if(selectedReply?.id===reply?.id){selectedReply=null;paintReply();}if(attachmentKey===mediaKey){clearMedia();paintAttachment();}if(field.value.trim()===content){field.value='';delete field.dataset.messageId;delete field.dataset.content;}await loadThread(!!thread?.anchored);root.querySelector('#chat-text')?.focus();}
    catch(e){if(e.name!=='AbortError')error(e.message);}
    finally{if(revision===epoch){busy=false;button.disabled=false;}}
  }
  function quoteText(message){return message.body|| (message.giphyId||message.attachmentType==='image/giphy'?'GIF':message.attachmentType==='image/gif'||message.attachment?.mime==='image/gif'?'GIF':message.attachmentType==='image/jpeg'||message.attachment?.mime==='image/jpeg'?'Photo':message.attachmentType?.startsWith('audio/')||message.attachment?.mime?.startsWith('audio/')?'Voice message':'Message');}
  function quoteHTML(quote,members){
    const author=members.find(m=>m.id===quote.sender);
    return `<button type="button" class="quoted-message" data-reply-jump="${esc(quote.id)}" aria-label="View original message"><strong>${esc(author?.self?'You':author?.name||'Member')}</strong><span>${esc(quoteText(quote).slice(0,180))}</span></button>`;
  }
  function paintReply(){
    const preview=root?.querySelector('.chat-reply-preview');if(!preview)return;
    if(!selectedReply){preview.replaceChildren();return;}
    const author=thread.members.find(m=>m.id===selectedReply.sender);
    preview.innerHTML=`<div><strong>Replying to ${esc(author?.self?'yourself':author?.name||'Member')}</strong><span>${esc(quoteText(selectedReply).slice(0,180))}</span></div><button type="button" data-reply-cancel aria-label="Cancel reply">${icon('close')}</button>`;
  }
  async function jumpToMessage(id){
    let original=Array.from(root.querySelectorAll('[data-message]')).find(el=>el.dataset.message===id);
    if(!original){if(recorder)throw new Error('Finish your recording before viewing earlier messages.');requestVersion++;await loadThread(true,id);original=Array.from(root.querySelectorAll('[data-message]')).find(el=>el.dataset.message===id);}
    if(original){original.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});original.classList.add('reply-highlight');setTimeout(()=>original.classList.remove('reply-highlight'),1800);}
  }

  function attachmentHTML(media){
    if(!/^\/api\/chat-media\/[a-f0-9-]{36}$/.test(media.url))return '';
    return ['image/jpeg','image/gif'].includes(media.mime)?`<a class="chat-photo-link" href="${esc(media.url)}" target="_blank" rel="noopener"><img class="chat-photo-message ${media.mime==='image/gif'?'chat-gif-message':''}" src="${esc(media.url)}" alt="${media.mime==='image/gif'?'Animated GIF':'Photo'} shared in this conversation" loading="lazy"></a>`:`<div class="chat-voice-message">${icon('mic')}<audio controls preload="none" src="${esc(media.url)}" aria-label="Voice message"></audio><span>${media.duration}s</span></div>`;
  }
  function clearMedia(){
    mediaGeneration++;clearInterval(recordTimer);recordTimer=null;
    if(recorder){recorder.onstop=null;if(recorder.state==='recording')recorder.stop();recorder=null;}
    recordStream?.getTracks().forEach(t=>t.stop());recordStream=null;attachment=null;giphySelection=null;attachmentKey='';
  }
  function paintAttachment(){
    const preview=root?.querySelector('.chat-attachment-preview');if(!preview)return;
    const field=root.querySelector('#chat-text');field.required=!(attachment||giphySelection);
    if(giphySelection){preview.innerHTML=`<img src="${esc(window.KinGiphy.rendition(giphySelection))}" alt="${esc(giphySelection.title||'Selected GIPHY GIF')}" referrerpolicy="no-referrer"><span>GIF from GIPHY</span><button type="button" data-media-remove aria-label="Remove GIF">${icon('close')}</button>`;return;}
    preview.innerHTML=attachment?`${attachment.data.startsWith('data:image/')?`<img src="${attachment.data}" alt="${attachment.data.startsWith('data:image/gif')?'Selected animated GIF':'Selected photo'}">`:`<audio controls src="${attachment.data}" aria-label="Preview voice recording"></audio><span>${attachment.duration}s voice note</span>`}<button type="button" data-media-remove aria-label="Remove attachment">${icon('close')}</button>`:'';
  }
  const asDataURL=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('The attachment could not be read.'));r.readAsDataURL(blob);});
  async function choosePhoto(file){
    if(busy||recorder)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10485760){error('Choose a JPEG, PNG, or WebP photo up to 10 MB.');return;}
    clearMedia();const revision=epoch,mediaRevision=mediaGeneration;busy=true;error('');
    try{
      const bitmap=await createImageBitmap(file),scale=Math.min(1,1400/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.84));if(!blob||blob.size>3145728)throw new Error('That photo is too large. Choose a smaller one.');
      const data=await asDataURL(blob);if(revision!==epoch||mediaRevision!==mediaGeneration)return;
      attachment={data,duration:0};attachmentKey=crypto.randomUUID();paintAttachment();
    }catch(e){if(revision===epoch)error(e.message||'That image could not be opened.');}finally{if(revision===epoch)busy=false;}
  }
  async function recordVoice(){
    if(busy||recorder)return;if(window.KinCalls.busy){error('Finish your call before recording a voice note.');return;}
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){error('Voice recording is unavailable in this browser. Try a current Chrome or Safari browser.');return;}
    clearMedia();const revision=epoch,mediaRevision=mediaGeneration;busy=true;error('');
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(revision!==epoch||mediaRevision!==mediaGeneration){stream.getTracks().forEach(t=>t.stop());return;}
      recordStream=stream;const mime=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
      if(!mime)throw new Error('This browser cannot record a supported voice format.');
      recorder=new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:64000});const chunks=[];let bytes=0;
      recorder.ondataavailable=event=>{if(event.data.size){chunks.push(event.data);bytes+=event.data.size;if(bytes>3000000&&recorder?.state==='recording')recorder.stop();}};
      recorder.onerror=()=>{clearMedia();paintAttachment();error('Recording stopped. Please try again.');};
      recorder.onstop=async()=>{
        const seconds=Math.min(60,Math.max(1,Math.round((Date.now()-recordStart)/1000))),blob=new Blob(chunks,{type:mime.split(';')[0]});
        clearInterval(recordTimer);recordTimer=null;stream.getTracks().forEach(t=>t.stop());recordStream=null;recorder=null;
        try{if(!blob.size||blob.size>3145728)throw new Error('This recording could not be saved. Try a shorter note.');const data=await asDataURL(blob);if(revision!==epoch||mediaRevision!==mediaGeneration)return;attachment={data,duration:seconds};attachmentKey=crypto.randomUUID();paintAttachment();}catch(e){if(revision===epoch)error(e.message);}
      };
      recordStart=Date.now();recorder.start(250);
      const preview=root.querySelector('.chat-attachment-preview');preview.innerHTML=`<span class="recording-dot"></span><span data-record-time>Recording · 0:00</span><button type="button" data-record-stop>Stop</button><button type="button" data-media-remove>Cancel</button>`;
      recordTimer=setInterval(()=>{const seconds=Math.floor((Date.now()-recordStart)/1000);const label=root?.querySelector('[data-record-time]');if(label)label.textContent='Recording · 0:'+String(seconds).padStart(2,'0');if(seconds>=60&&recorder?.state==='recording')recorder.stop();},250);
    }catch(e){clearMedia();paintAttachment();if(revision===epoch)error(e.name==='NotAllowedError'?'Allow microphone access in your browser to record a voice note.':e.message||'No microphone was found.');}
    finally{if(revision===epoch)busy=false;}
  }

  function closeGifPicker(){if(gifDialog)mediaGeneration++;gifChoices.clear();gifSearchVersion++;clearTimeout(gifSearchTimer);gifSearchTimer=null;gifDialog?.close();gifDialog?.remove();gifDialog=null;}
  function showGifPicker(){
    if(busy||recorder){error('Finish your recording or upload before choosing a GIF.');return;}if(gifDialog)return;
    gifDialog=document.createElement('dialog');gifDialog.className='kin-gif-picker';gifDialog.setAttribute('aria-labelledby','gif-picker-title');
    gifDialog.innerHTML=`<header><div><span>GIPHY</span><h2 id="gif-picker-title">Find the perfect GIF</h2></div><button type="button" data-gif-close aria-label="Close GIF picker">${icon('close')}</button></header><label class="sr-only" for="gif-search">Search GIPHY</label><input id="gif-search" type="search" maxlength="50" placeholder="Search GIPHY…" autocomplete="off"><div class="gif-categories" role="group" aria-label="GIF searches"><button type="button" data-gif-query="">Trending</button><button type="button" data-gif-query="WWE">WWE</button><button type="button" data-gif-query="The Vampire Diaries">TVD</button><button type="button" data-gif-query="Supernatural">Supernatural</button><button type="button" data-gif-query="Twilight">Twilight</button></div><p class="gif-picker-error" role="alert"></p><p class="gif-picker-status" role="status"></p><div class="gif-results" aria-label="GIPHY search results"></div><button type="button" class="gif-more" data-gif-more hidden>More GIFs</button><footer><a href="https://giphy.com/" target="_blank" rel="noopener noreferrer"><img class="giphy-attribution" src="/giphy-attribution.png" alt="Powered by GIPHY" width="150"></a><button type="button" data-gif-upload>Upload a GIF</button><input type="file" id="gif-upload-file" accept="image/gif" hidden></footer><p class="gif-provider-note">Searches and GIFs load from GIPHY.</p>`;
    const picker=gifDialog;
    picker.addEventListener('cancel',event=>{event.preventDefault();closeGifPicker();root?.querySelector('[data-chat-gif]')?.focus();});
    picker.addEventListener('input',event=>{if(event.target.id==='gif-search'){clearTimeout(gifSearchTimer);gifSearchVersion++;gifSearchTimer=setTimeout(()=>searchGifs(event.target.value),650);}});
    picker.addEventListener('keydown',event=>{if(event.target.id==='gif-search'&&event.key==='Enter'){event.preventDefault();clearTimeout(gifSearchTimer);searchGifs(event.target.value);}});
    picker.addEventListener('change',event=>{if(event.target.id==='gif-upload-file'&&event.target.files[0])chooseGif(event.target.files[0]);});
    picker.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button)return;
      if(button.hasAttribute('data-gif-close')){closeGifPicker();root?.querySelector('[data-chat-gif]')?.focus();return;}if(busy||recorder)return;
      if(button.hasAttribute('data-gif-upload')){picker.querySelector('#gif-upload-file').click();return;}
      if(button.hasAttribute('data-gif-query')){picker.querySelector('#gif-search').value=button.dataset.gifQuery;searchGifs(button.dataset.gifQuery);return;}
      if(button.hasAttribute('data-gif-more')){searchGifs(gifQuery,true);return;}
      if(button.dataset.giphyChoice){const gif=gifChoices.get(button.dataset.giphyChoice);if(!gif||!window.KinGiphy.rendition(gif))return;clearMedia();giphySelection=gif;attachmentKey=crypto.randomUUID();closeGifPicker();paintAttachment();root.querySelector('#chat-text')?.focus();}
    });
    document.body.append(picker);picker.showModal();searchGifs('');
  }
  async function searchGifs(query,append=false){
    clearTimeout(gifSearchTimer);const picker=gifDialog,version=++gifSearchVersion;if(!picker)return;
    if(!append){gifQuery=query;gifOffset=0;gifChoices.clear();picker.querySelector('.gif-results').replaceChildren();}
    picker.querySelector('.gif-picker-status').textContent='Searching GIPHY…';picker.querySelector('[data-gif-more]').hidden=true;
    try{
      const result=await window.KinGiphy.search(query,append?gifOffset:0);if(picker!==gifDialog||version!==gifSearchVersion)return;
      const gifs=Array.isArray(result.data)?result.data:[];
      for(const gif of gifs)if(window.KinGiphy.idOK(gif.id))gifChoices.set(gif.id,gif);
      // Keep GIPHY's order and every result; an unusable rendition gets a disabled placeholder.
      picker.querySelector('.gif-results').insertAdjacentHTML('beforeend',gifs.map(gif=>{const preview=window.KinGiphy.rendition(gif,true),selectable=window.KinGiphy.idOK(gif.id)&&window.KinGiphy.rendition(gif);return `<button type="button" data-giphy-choice="${esc(gif.id)}" aria-label="Choose ${esc(gif.title||'GIPHY GIF')}" ${selectable?'':'disabled'}>${preview?`<img src="${esc(preview)}" alt="${esc(gif.title||'Animated GIF')}" loading="lazy" referrerpolicy="no-referrer">`:'<span>GIF unavailable</span>'}<span>${esc(gif.title||'GIF')}</span></button>`;}).join(''));
      gifOffset=Number(result.pagination?.offset||0)+Number(result.pagination?.count??gifs.length);
      picker.querySelector('[data-gif-more]').hidden=!(gifs.length&&gifOffset<Number(result.pagination?.total_count||0)&&gifOffset<(query.trim()?4999:499));
      picker.querySelector('.gif-picker-status').textContent=gifs.length?'Choose a GIF to preview before sending.':'No GIFs found. Try another search.';
    }catch(e){if(picker===gifDialog&&version===gifSearchVersion)picker.querySelector('.gif-picker-status').textContent=e.message||'GIPHY could not load. Try again.';}
  }

  async function chooseGif(file){
    if(busy||recorder)return;
    const picker=gifDialog,showError=message=>{if(picker&&picker===gifDialog)picker.querySelector('.gif-picker-error').textContent=message;else error(message);};
    if(file.size>3145728){showError('Choose a GIF up to 3 MB.');return;}
    clearMedia();paintAttachment();const revision=epoch,mediaRevision=mediaGeneration;busy=true;error('');
    try{
      const header=await file.slice(0,6).text();if(!['GIF87a','GIF89a'].includes(header))throw new Error('Choose an actual .gif file.');
      const data=await asDataURL(new Blob([file],{type:'image/gif'})),image=new Image();image.src=data;await image.decode();
      if(image.naturalWidth>1600||image.naturalHeight>1600)throw new Error('Choose a GIF up to 1600 × 1600 pixels.');
      if(revision!==epoch||mediaRevision!==mediaGeneration)return;
      attachment={data,duration:0};attachmentKey=crypto.randomUUID();closeGifPicker();paintAttachment();root.querySelector('#chat-text')?.focus();
    }catch(e){if(revision===epoch)showError(e.message||'This GIF could not be opened. Try another file.');}
    finally{if(revision===epoch)busy=false;}
  }

  window.KinMessages={render,close,startWith(id){if(!root)return;newChat();const input=Array.from(root.querySelectorAll('[name=member]')).find(input=>input.value===id);if(input)input.checked=true;},get busy(){return busy||!!recorder;}};
})();
