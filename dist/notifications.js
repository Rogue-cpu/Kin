'use strict';
(() => {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon=name=>`<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  let context=null,callbacks=null,sessionKey='',epoch=0,viewEpoch=0,listVersion=0,countVersion=0,root=null,timer=null,items=[],onlyUnread=false,hasMore=false,count=0,loading=false,busy=false;
  const pending=new Set();
  function badge(next){count=next;document.querySelectorAll('[data-notification-count]').forEach(el=>{el.hidden=!count;el.textContent=count>99?'99+':String(count);});document.querySelectorAll('[data-view="notifications"]').forEach(button=>button.setAttribute('aria-label',count?`Notifications, ${count} unread`:'Notifications'));if(root){const button=root.querySelector('[data-activity-read-all]');if(button)button.disabled=!count||busy;}}
  async function api(path,data){
    const revision=epoch,controller=new AbortController();pending.add(controller);const timeout=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(path,{method:data?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{'X-Kin-Profile':context.profileKind||'roleplay',...(data?{'Content-Type':'application/json'}:{})},signal:controller.signal,body:data?JSON.stringify(data):undefined});
      const result=await response.json();if(revision!==epoch)throw new DOMException('Profile changed','AbortError');
      if(response.status===401){window.KinAccount.expired('Sign in to see your activity.');throw new DOMException('Signed out','AbortError');}
      if(!response.ok){const error=new Error(result.error||'Activity could not load.');error.status=response.status;throw error;}return result;
    }catch(e){if(e.name==='AbortError'&&revision===epoch)throw new Error('Activity took too long to load. Try again.');throw e;}
    finally{clearTimeout(timeout);pending.delete(controller);}
  }
  function clearView(){if(!root)return;viewEpoch++;root=null;items=[];hasMore=false;loading=false;}
  function stop(){epoch++;viewEpoch++;for(const request of pending)request.abort();pending.clear();clearInterval(timer);timer=null;context=null;sessionKey='';callbacks=null;root=null;items=[];loading=false;busy=false;onlyUnread=false;badge(0);}
  function sync(state,hooks){
    const key=(state.profileKind||'roleplay')+':'+state.profile.handle;if(sessionKey===key){context=state;callbacks=hooks;return;}
    stop();sessionKey=key;context=state;callbacks=hooks;timer=setInterval(poll,15000);poll();
  }
  async function poll(){if(!context||loading||busy||document.hidden)return;if(root){await load(false);return;}const version=countVersion;try{const result=await api('/api/notifications/unread');if(version===countVersion)badge(result.unreadCount);}catch{}}
  function status(message){const el=root?.querySelector('.activity-error');if(el)el.textContent=message;}
  const safePhoto=value=>/^\/api\/media\/[a-f0-9-]{36}$/.test(value||'');
  function avatar(actor){return safePhoto(actor.portrait)?`<img src="${esc(actor.portrait)}" alt="" loading="lazy">`:`<span>${esc(actor.name.trim().split(/\s+/).slice(0,2).map(p=>p[0]).join('').toUpperCase())}</span>`;}
  function age(value){const minutes=Math.max(0,Math.floor((Date.now()-new Date(value))/60000));return minutes<1?'now':minutes<60?minutes+'m':minutes<1440?Math.floor(minutes/60)+'h':Math.floor(minutes/1440)+'d';}
  function description(item){return item.type==='like'?'liked your '+(item.thumbnail?'photo.':'post.'):item.type==='comment'?'commented: '+item.excerpt:item.type==='comment_reply'?'replied to your comment: '+item.excerpt:item.type==='request'?'wants to connect with you.':'accepted your connection request.';}
  function paint(){
    if(!root)return;const today=new Date();today.setHours(0,0,0,0);const yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);
    const groups=[{name:'New',items:[]},{name:'Yesterday',items:[]},{name:'Earlier',items:[]}];
    for(const item of items){const date=new Date(item.createdAt);groups[date>=today?0:date>=yesterday?1:2].items.push(item);}
    root.querySelector('.activity-list').innerHTML=items.length?groups.filter(g=>g.items.length).map(group=>`<section class="activity-group"><h3>${group.name}</h3>${group.items.map(item=>`<article class="activity-row ${item.read?'':'activity-unread'}" data-notification="${item.id}"><span class="activity-avatar">${avatar(item.actor)}</span><div class="activity-copy"><button type="button" class="activity-open" data-activity-open="${item.id}"><strong>${esc(item.actor.handle||item.actor.name)}</strong> ${esc(description(item))} <time datetime="${esc(item.createdAt)}">${age(item.createdAt)}</time></button>${['comment','comment_reply'].includes(item.type)?`<div class="activity-inline-actions"><button type="button" data-activity-reply="${item.id}">Reply</button>${item.connected?`<button type="button" data-activity-message="${item.id}">Message</button>`:''}</div>`:''}${item.type==='request'?`<div class="activity-request-actions"><button type="button" class="activity-approve" data-activity-approve="${item.id}">Approve</button><button type="button" data-activity-decline="${item.id}">Decline</button></div>`:''}</div>${item.postId?`<button type="button" class="activity-thumbnail" data-activity-open="${item.id}" aria-label="Open post">${safePhoto(item.thumbnail)?`<img src="${esc(item.thumbnail)}" alt="Post thumbnail" loading="lazy">`:icon('comment')}</button>`:item.type==='accepted'?'<span class="activity-connected">Connected</span>':''}${!item.read?'<span class="activity-unread-dot" aria-label="Unread"></span>':''}</article>`).join('')}</section>`).join(''):`<div class="activity-empty">${icon('bell')}<h3>${onlyUnread?'You’re all caught up':'Your activity starts here'}</h3><p>${onlyUnread?'You have no unread notifications.':'Likes, replies, and connection requests will appear here.'}</p></div>`;
    root.querySelector('[data-activity-more]').hidden=!hasMore;badge(count);
  }
  async function load(append=false){
    if(loading||!root)return;loading=true;const revision=epoch,view=viewEpoch,version=++listVersion;
    try{const query=new URLSearchParams();if(onlyUnread)query.set('unread','true');if(append&&items.length)query.set('before',items.at(-1).seq);
      const result=await api('/api/notifications?'+query);if(view!==viewEpoch||version!==listVersion||!root?.isConnected)return;
      items=append?[...items,...result.notifications]:result.notifications;hasMore=result.hasMore;badge(result.unreadCount);status('');paint();
    }catch(e){if(e.name!=='AbortError'&&view===viewEpoch){status(e.message||'Activity could not load.');if(!items.length&&root)root.querySelector('.activity-list').innerHTML='<button class="activity-retry" type="button" data-activity-refresh>Try again</button>';}}
    finally{if(revision===epoch&&view===viewEpoch&&version===listVersion)loading=false;}
  }
  async function mark(item){if(item.read)return;const result=await api('/api/notifications/read',{ids:[item.id]});item.read=true;badge(result.unreadCount);}
  function render(container){
    if(root===container.querySelector('.activity-root')&&root)return;
    clearView();root=document.createElement('section');root.className='activity-root';root.setAttribute('aria-label','Notifications');
    root.innerHTML=`<header class="activity-header"><button type="button" class="icon-button" data-view="feed" aria-label="Back to feed">${icon('arrow')}</button><h2>Notifications</h2><button type="button" data-activity-read-all>Mark all read</button></header><div class="activity-tabs" role="group" aria-label="Activity filter"><button type="button" data-activity-filter="all" aria-pressed="${!onlyUnread}">All</button><button type="button" data-activity-filter="unread" aria-pressed="${onlyUnread}">Unread</button><button type="button" data-activity-refresh aria-label="Refresh activity">Refresh</button></div><p class="activity-error" role="status"></p><div class="activity-list"><p class="activity-loading">Loading activity…</p></div><button type="button" class="activity-more" data-activity-more hidden>Load earlier activity</button>`;
    container.replaceChildren(root);badge(count);
    root.addEventListener('click',async event=>{
      const button=event.target.closest('button');if(!button||busy||button.dataset.view)return;
      if(button.hasAttribute('data-activity-filter')){onlyUnread=button.dataset.activityFilter==='unread';root.querySelectorAll('[data-activity-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));items=[];viewEpoch++;loading=false;load(false);return;}
      if(button.hasAttribute('data-activity-refresh')){load(false);return;}
      if(button.hasAttribute('data-activity-more')){load(true);return;}
      const item=items.find(n=>n.id===(button.dataset.activityOpen||button.dataset.activityReply||button.dataset.activityMessage||button.dataset.activityApprove||button.dataset.activityDecline));
      const view=viewEpoch,revision=epoch;busy=true;listVersion++;countVersion++;loading=false;button.disabled=true;badge(count);status('');
      try{
        if(button.hasAttribute('data-activity-read-all')){if(items.length){const result=await api('/api/notifications/read',{all:true,through:items[0].seq});badge(result.unreadCount);await load(false);}return;}
        if(!item)return;
        await mark(item);
        if(view!==viewEpoch||!root?.isConnected)return;
        if(button.hasAttribute('data-activity-approve')||button.hasAttribute('data-activity-decline')){await window.KinAccount.act(button.hasAttribute('data-activity-approve')?'accept':'decline',{id:item.actor.id});await load(false);}
        else if(button.hasAttribute('data-activity-message'))callbacks.onMessage(item.actor.id);
        else if(item.postId){const next=await api('/api/state?post='+encodeURIComponent(item.postId));if(view===viewEpoch&&root?.isConnected)callbacks.onPost(next,item,button.hasAttribute('data-activity-reply'));}
        else callbacks.onPeople();
      }catch(e){if(e.name!=='AbortError'&&view===viewEpoch){status(e.message);if([403,404].includes(e.status))await load(false);}}
      finally{if(revision===epoch){busy=false;if(view===viewEpoch&&root){button.disabled=false;badge(count);}}}
    });load(false);
  }
  window.KinNotifications={sync,render,clearView,stop,refresh:poll,get busy(){return busy;}};
})();
