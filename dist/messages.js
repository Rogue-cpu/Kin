'use strict';
(() => {
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon=name=>`<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  let root=null,context=null,kind='',epoch=0,timer=null,active=null,thread=null,chats=[],busy=false,loading=false,requestVersion=0;
  const pending=new Set();
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
  function close(){epoch++;requestVersion++;clearInterval(timer);timer=null;for(const controller of pending)controller.abort();pending.clear();root=null;context=null;thread=null;chats=[];active=null;kind='';busy=false;loading=false;}
  function paintInbox(){
    const list=root.querySelector('.chat-list');
    list.innerHTML=chats.length?chats.map(c=>`<button class="chat-list-item ${active===c.id?'selected':''}" data-chat="${c.id}">${avatar(c)}<span><strong>${esc(title(c))}</strong><small>${esc(c.preview||'Start the conversation')}</small></span>${icon('arrow')}</button>`).join(''):'<div class="chat-empty"><h3>Your conversations start here</h3><p>Choose an approved connection to say hello or start a scene.</p><button class="button" data-chat-new>New message</button></div>';
  }
  async function refresh(){
    if(loading||busy||!root||document.hidden)return;loading=true;const revision=epoch;
    try {const data=await api('/api/chats');chats=data.chats;paintInbox();if(active)await loadThread(false);}
    catch(e){if(e.name!=='AbortError'){if(e.status===404||e.status===403){active=null;thread=null;root.querySelector('.chat-pane').innerHTML='<div class="chat-empty"><p>This conversation is no longer available.</p></div>';root.classList.remove('thread-open');}error(e.message||'Connection interrupted. Try again.');}}
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
        if(button.hasAttribute('data-chat-new'))newChat();
        else if(button.dataset.chat){active=button.dataset.chat;thread=null;requestVersion++;root.classList.add('thread-open');root.querySelector('.chat-pane').innerHTML='<p class="chat-loading">Opening conversation…</p>';paintInbox();await loadThread(true);}
        else if(button.hasAttribute('data-chat-back')){active=null;thread=null;requestVersion++;root.classList.remove('thread-open');root.querySelector('.chat-pane').innerHTML='<div class="chat-empty"><h2>Your messages</h2><p>Choose a conversation or start a new message.</p><button class="button button-primary" data-chat-new>New message</button></div>';paintInbox();}
        else if(button.hasAttribute('data-chat-older'))await older();
        else if(button.hasAttribute('data-chat-retry'))await refresh();
      }catch(e){if(e.name!=='AbortError'){if(e.status===404||e.status===403){thread=null;active=null;root.querySelector('.chat-pane').innerHTML='<div class="chat-empty"><p>Conversation unavailable.</p></div>';root.classList.remove('thread-open');}error(e.message);}}
    });
    root.addEventListener('submit',event=>{event.preventDefault();const form=event.target;if(form.id==='chat-compose')send(form);if(form.id==='chat-create')create(form);});
    root.addEventListener('keydown',event=>{if(event.target.id==='chat-text'&&event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();event.target.form.requestSubmit();}});
    refresh();timer=setInterval(refresh,3000);
  }
  function newChat(){
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
    return `<div class="chat-message ${message.self?'outgoing':'incoming'}" data-message="${message.id}">${message.self?'':`<span class="message-avatar">${portrait(sender)}</span>`}<div>${message.self?'':`<span class="message-author">${esc(sender.name)}</span>`}<p class="message-bubble">${esc(message.body)}</p><time datetime="${esc(message.created_at)}">${esc(new Date(message.created_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))}</time></div></div>`;
  }
  function messageList(data){
    let date='';return data.messages.map(m=>{const next=new Date(m.created_at).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'}),stamp=next===date?'':`<div class="chat-date">${esc(next)}</div>`;date=next;return stamp+messageHTML(m,data.members);}).join('');
  }
  async function loadThread(initial){
    const chat=active,version=requestVersion;if(!chat)return;
    const data=await api(`/api/chats/${chat}/messages`);if(chat!==active||version!==requestVersion)return;
    const pane=root.querySelector('.chat-pane');
    if(!thread||initial){
      thread=data;
      pane.innerHTML=`<header class="chat-header"><button class="icon-button" data-chat-back aria-label="Back to inbox">${icon('arrow')}</button>${avatar(data)}<div><h2>${esc(title(data))}</h2><p>${data.isGroup?data.members.length+' members':'Private conversation'} · ${kind==='personal'?'Personal':'Roleplay'}</p></div></header><div class="chat-history" role="log" aria-label="Messages" aria-live="polite"><div class="chat-older">${data.hasMore?'<button data-chat-older>Load earlier messages</button>':''}</div><p class="chat-start">${data.isGroup?'A private group for '+data.members.map(m=>esc(m.name)).join(', '):'Your conversation with '+esc(data.members.find(m=>!m.self)?.name||'your connection')}<br><span>Only members can read this chat.</span></p><div class="chat-message-list">${messageList(data)}</div></div><form id="chat-compose"><label class="sr-only" for="chat-text">Message</label><div class="message-composer"><textarea id="chat-text" required maxlength="4000" rows="1" placeholder="${kind==='personal'?'Message…':'Write a message or start a scene…'}"></textarea><button type="submit" aria-label="Send message">${icon('arrow')}</button></div><small>Enter to send · Shift + Enter for a new line</small></form>`;
      const history=pane.querySelector('.chat-history');history.scrollTop=history.scrollHeight;
    }else{
      const history=pane.querySelector('.chat-history');if(!history)return;
      const bottom=history.scrollHeight-history.scrollTop-history.clientHeight<90;
      const known=new Set(thread.messages.map(m=>m.id));const added=data.messages.filter(m=>!known.has(m.id));
      if(added.length){thread.messages.push(...added);pane.querySelector('.chat-message-list').insertAdjacentHTML('beforeend',added.map(m=>messageHTML(m,data.members)).join(''));if(bottom||added.some(m=>m.self))history.scrollTop=history.scrollHeight;}
      // Repaint names without replacing the composer or a draft.
      pane.querySelector('.chat-header h2').textContent=title(data);thread.members=data.members;
    }
  }
  async function older(){
    if(!thread?.messages.length||busy)return;busy=true;const revision=epoch,chat=active,version=requestVersion;
    try{const data=await api(`/api/chats/${chat}/messages?before=${thread.messages[0].seq}`);if(active!==chat||version!==requestVersion)return;
      const history=root.querySelector('.chat-history'),height=history.scrollHeight;
      thread.messages=[...data.messages,...thread.messages];thread.hasMore=data.hasMore;
      root.querySelector('.chat-message-list').innerHTML=messageList(thread);root.querySelector('.chat-older').innerHTML=data.hasMore?'<button data-chat-older>Load earlier messages</button>':'';history.scrollTop+=history.scrollHeight-height;
    }catch(e){if(e.name!=='AbortError')error(e.message);}finally{if(revision===epoch)busy=false;}
  }
  async function send(form){
    const field=form.querySelector('textarea'),content=field.value.trim();if(!content||busy||!active)return;
    busy=true;const revision=epoch,chat=active;const button=form.querySelector('button');button.disabled=true;error('');
    // Keep an id on the draft so a retry after a lost response cannot duplicate it.
    if(field.dataset.content!==content){field.dataset.messageId=crypto.randomUUID();field.dataset.content=content;}
    try{await api(`/api/chats/${chat}/messages`,{id:field.dataset.messageId,text:content});if(field.value.trim()===content){field.value='';delete field.dataset.messageId;delete field.dataset.content;}await loadThread(false);field.focus();}
    catch(e){if(e.name!=='AbortError')error(e.message);}
    finally{if(revision===epoch){busy=false;button.disabled=false;}}
  }
  window.KinMessages={render,close,startWith(id){if(!root)return;newChat();const input=Array.from(root.querySelectorAll('[name=member]')).find(input=>input.value===id);if(input)input.checked=true;},get busy(){return busy;}};
})();
