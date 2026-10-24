'use strict';
(() => {
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let callbacks, active = false, generation = 0, refreshing = false, busy = false;
  let gate, timer;
  async function api(path, data) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: data === undefined ? {} : {'Content-Type':'application/json'}, body: data === undefined ? undefined : JSON.stringify(data), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) { const error = new Error(result.error || 'Kin could not complete that request.'); error.status = response.status; throw error; }
      return result;
    } catch(error) {
      if(error.name === 'AbortError') throw new Error('The connection timed out. Refresh before trying again.');
      if(error instanceof TypeError) throw new Error('Kin could not connect. Check your connection and try again.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function toggleApp(show) {
    document.body.classList.toggle('accounts-locked', !show);
    document.body.classList.remove('auth-loading');
    gate.hidden = show;
    if (show) gate.replaceChildren();
  }
  function clearPrivateView() {
    active = false; generation += 1;
    callbacks.onLock();
    document.getElementById('modal').close();
    document.getElementById('modal-content').replaceChildren();
    document.getElementById('view-content').replaceChildren();
    document.getElementById('sidebar-people').replaceChildren();
    document.querySelector('.account-button strong').textContent = 'Your character';
    document.querySelectorAll('.self-avatar').forEach(avatar => { const blank = document.createElement('span'); blank.className = avatar.className; blank.textContent = 'YC'; avatar.replaceWith(blank); });
  }
  function authScreen(mode = 'login', message = '') {
    clearPrivateView(); toggleApp(false);
    const register = mode === 'register', recover = mode === 'recover';
    gate.innerHTML = `<div class="auth-card"><a class="brand" href="/">kin<span class="brand-flower">✳</span></a><p class="eyebrow">YOUR CHARACTERS. YOUR STORIES.</p><h1>${register ? 'Your next chapter starts here.' : recover ? 'Find your way back.' : 'Welcome back, writer.'}</h1><p class="auth-description">${register ? 'Create your writer account, then become your character. Your profile stays inside your approved circle.' : recover ? 'Use the recovery code you saved when you joined. This replaces your password and signs out your other sessions.' : 'Sign in to your characters, your cast, and the stories you share.'}</p><form id="auth-form"><label class="field-label" for="auth-handle">Writer handle</label><input class="field-input" id="auth-handle" name="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="your_writer_handle">${register ? '<label class="field-label" for="auth-invite">Invite code</label><input class="field-input" id="auth-invite" required maxlength="256" autocomplete="off" placeholder="The code shared by your host">' : ''}${recover ? '<label class="field-label" for="auth-recovery">Recovery code</label><input class="field-input" id="auth-recovery" required maxlength="128" autocomplete="off">' : ''}<label class="field-label" for="auth-password">${recover ? 'New password' : 'Password'}</label><input class="field-input" id="auth-password" name="password" type="password" required minlength="12" maxlength="128" autocomplete="${register || recover ? 'new-password' : 'current-password'}"><p class="small-note">${register || recover ? 'Use at least 12 characters. Save your recovery code somewhere safe.' : 'Your writer handle is separate from your character name.'}</p><p id="auth-error" class="form-error" role="alert">${escape(message)}</p><button class="button button-primary auth-submit" type="submit">${register ? 'Create account' : recover ? 'Reset password' : 'Sign in'}</button></form><div class="auth-links">${mode !== 'login' ? '<button class="text-button" data-auth="login">Back to sign in</button>' : '<button class="text-button" data-auth="register">Have an invite? Join Kin</button><button class="text-button" data-auth="recover">Recover your account</button>'}</div><p class="auth-footnote">Unofficial fan roleplay · Not affiliated with featured franchises.</p></div>`;
    gate.querySelectorAll('[data-auth]').forEach(button => { button.onclick = () => { if(!busy)authScreen(button.dataset.auth); }; });
    document.getElementById('auth-form').onsubmit = async event => {
      event.preventDefault(); if(busy)return;
      busy = true; const form = event.target; const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
      const error = document.getElementById('auth-error'); error.textContent = '';
      try {
        const data = {handle:document.getElementById('auth-handle').value.trim().toLowerCase(), password:document.getElementById('auth-password').value};
        if(register)data.inviteCode=document.getElementById('auth-invite').value.trim();
        if(recover)data.recoveryCode=document.getElementById('auth-recovery').value.trim();
        const result = await api(`/api/auth/${register ? 'register' : recover ? 'recover' : 'login'}`,data);
        form.reset();
        if(result.recoveryCode) recoveryScreen(result.recoveryCode);
        else await enter();
      } catch(problem) { error.textContent = problem.message; }
      finally { busy = false; submit.disabled = false; }
    };
  }
  function recoveryScreen(code) {
    gate.innerHTML = `<div class="auth-card"><p class="eyebrow">KEEP YOUR WAY BACK IN</p><h1>Save your recovery code.</h1><p class="auth-description">This code can reset your password. Store it in your password manager or download a copy. It is shown only once and replaced whenever you recover your account.</p><code class="recovery-code">${escape(code)}</code><button class="button button-secondary auth-submit" id="download-recovery">Download recovery code</button><label class="recovery-confirm"><input type="checkbox" id="recovery-confirm"> I have saved my recovery code.</label><p class="form-error" id="recovery-error" role="alert"></p><button class="button button-primary auth-submit" id="recovery-continue" disabled>Meet your character</button></div>`;
    document.getElementById('download-recovery').onclick=()=>{
      const url=URL.createObjectURL(new Blob([`Kin account recovery code\n\n${code}\n\nKeep this private. This code grants access to reset your account password.\n`],{type:'text/plain'}));
      const link=document.createElement('a');link.href=url;link.download='kin-recovery-code.txt';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    document.getElementById('recovery-confirm').onchange=event=>{document.getElementById('recovery-continue').disabled=!event.target.checked;};
    document.getElementById('recovery-continue').onclick=async()=>{if(busy)return;busy=true;try{await enter();}catch(error){document.getElementById('recovery-error').textContent=error.message;}finally{busy=false;}};
  }
  async function enter() {
    const next=await api('/api/state'); active=true;generation+=1;
    callbacks.onState(next);toggleApp(true);
  }
  function diff(before, after) {
    const actions=[];
    if(JSON.stringify(before.profile)!==JSON.stringify(after.profile))actions.push({type:'profile',data:after.profile});
    const oldPosts=new Map(before.posts.map(post=>[post.id,post]));
    const newPosts=new Map(after.posts.map(post=>[post.id,post]));
    for(const post of after.posts){
      const old=oldPosts.get(post.id);
      if(!old){actions.push({type:'post',data:post});continue;}
      if(old.liked!==post.liked)actions.push({type:'like',data:{id:post.id,value:post.liked}});
      if(old.saved!==post.saved)actions.push({type:'bookmark',data:{id:post.id,value:post.saved}});
      for(const comment of post.comments.slice(old.comments.length))actions.push({type:'reply',data:{id:post.id,text:comment.text,mode:comment.mode}});
    }
    for(const old of before.posts)if(old.author==='self'&&!newPosts.has(old.id))actions.push({type:'delete-post',data:{id:old.id}});
    for(const request of before.requests)if(!after.requests.some(next=>next.id===request.id))actions.push({type:after.people.some(next=>next.id===request.id)?'accept':'decline',data:{id:request.id}});
    for(const old of before.people){
      const next=after.people.find(person=>person.id===old.id);
      if(!next)actions.push({type:'remove',data:{id:old.id}});
      else if(old.group!==next.group)actions.push({type:'circle',data:{id:old.id,group:next.group}});
    }
    if(!actions.length)throw new Error('No account changes to save.');
    return actions;
  }
  async function refresh() {
    if(!active||refreshing||busy||callbacks.isBusy()||document.getElementById('modal').open)return;
    const revision=generation;refreshing=true;
    try {const next=await api('/api/state');if(active&&revision===generation&&!callbacks.isBusy())callbacks.onRefresh(next);}
    catch(error){if(error.status===401)authScreen('login',error.message);else throw error;}
    finally{refreshing=false;}
  }
  window.KinAccount={
    get active(){return active;},
    async boot(hooks){
      callbacks=hooks;gate=document.getElementById('account-gate');
      if(location.protocol==='file:'){toggleApp(true);callbacks.onDemo();return;}
      try {
        const config=await api('/api/config');if(!config.accounts)throw new Error('Accounts are not configured.');
        try{await enter();}catch(error){if(error.status===401)authScreen();else throw error;}
        timer=setInterval(()=>{if(document.visibilityState==='visible')refresh().catch(()=>{});},30000);
      }catch(error){clearPrivateView();toggleApp(false);gate.innerHTML=`<div class="auth-card"><h1>Kin is taking a moment.</h1><p class="auth-description">${escape(error.message)}</p><button class="button button-primary" id="account-retry">Try again</button></div>`;document.getElementById('account-retry').onclick=()=>location.reload();}
    },
    async save(before,after){generation+=1;return api('/api/actions',{actions:diff(before,after)});},
    async act(type,data){generation+=1;const next=await api('/api/actions',{actions:[{type,data}]});callbacks.onRefresh(next);return next;},
    refresh,
    async logout(){if(busy||callbacks.isBusy())return;busy=true;try{await api('/api/auth/logout',{});authScreen();}finally{busy=false;}},
    expired(message){authScreen('login',message);}
  };
})();
