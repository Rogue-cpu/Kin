'use strict';
(() => {
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let configPromise=null,generation=0;const controllers=new Set();
  const idOK=id=>typeof id==='string'&&/^[A-Za-z0-9]{1,64}$/.test(id);
  const mediaURL=value=>{try{const u=new URL(value);return u.protocol==='https:'&&u.hostname.endsWith('.giphy.com')&&!u.username&&!u.password&&!u.port?value:'';}catch{return '';}};
  async function configuration(){
    if(!configPromise)configPromise=fetch('/api/giphy/config',{credentials:'same-origin',cache:'no-store'}).then(async res=>{if(!res.ok)throw new Error('Sign in again to use GIPHY.');return res.json();}).catch(error=>{configPromise=null;throw error;});
    const config=await configPromise;if(!config.enabled)throw new Error('GIPHY is not connected yet. Your host needs to finish the GIPHY setup.');return config;
  }
  async function request(path,parameters={}){
    const version=generation,config=await configuration();if(version!==generation)throw new DOMException('View changed','AbortError');
    const url=new URL('https://api.giphy.com/v1/gifs'+path);url.searchParams.set('api_key',config.apiKey);url.searchParams.set('rating','pg-13');for(const [key,value]of Object.entries(parameters))url.searchParams.set(key,String(value));
    const controller=new AbortController();controllers.add(controller);const timeout=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(url,{credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
      if(version!==generation)throw new DOMException('View changed','AbortError');
      if(response.status===429)throw new Error('GIPHY’s request limit has been reached. Try again later.');
      if([401,403].includes(response.status))throw new Error('The GIPHY key needs attention. Ask your host to check the setup.');
      if(!response.ok)throw new Error('GIPHY could not load. Please try again.');const result=await response.json();
      if(version!==generation)throw new DOMException('View changed','AbortError');return result;
    }catch(e){if(e.name==='TypeError')throw new Error('Could not reach GIPHY. Check your connection and try again.');if(e.name==='AbortError'&&version===generation)throw new Error('GIPHY took too long to respond. Try again.');throw e;}
    finally{clearTimeout(timeout);controllers.delete(controller);}
  }
  function rendition(gif,preview=false){return mediaURL(preview?gif.images?.fixed_height?.url||gif.images?.fixed_width?.url||gif.images?.original?.url:gif.images?.downsized?.url||gif.images?.original?.url);}
  function html(id){return `<div class="giphy-message" data-giphy-id="${esc(id)}"><span>Loading GIF from GIPHY…</span></div>`;}
  async function hydrate(container){
    const version=generation,holders=Array.from(container.querySelectorAll('.giphy-message:not([data-giphy-state])'));if(!holders.length)return;
    holders.forEach(h=>h.dataset.giphyState='loading');const ids=[...new Set(holders.map(h=>h.dataset.giphyId).filter(idOK))];
    for(let start=0;start<ids.length;start+=100){const batch=ids.slice(start,start+100);let data,error;
      try{const response=await request('',{ids:batch.join(',')});data=Array.isArray(response.data)?response.data:[];}catch(e){if(e.name==='AbortError')return;error=e;data=[];}
      if(version!==generation||!container.isConnected)return;
      for(const holder of holders.filter(h=>batch.includes(h.dataset.giphyId))){
        if(!holder.isConnected)continue;const gif=data.find(g=>g.id===holder.dataset.giphyId),url=gif&&rendition(gif);
        if(!url){holder.dataset.giphyState='failed';holder.innerHTML=`<span>${esc(error?.message||'This GIF is no longer available.')}</span><button type="button" data-giphy-retry>Retry</button>`;continue;}
        holder.dataset.giphyState='loaded';holder.innerHTML=`<a href="https://giphy.com/gifs/${esc(gif.id)}" target="_blank" rel="noopener noreferrer"><img class="chat-photo-message chat-gif-message" src="${esc(url)}" alt="${esc(gif.title||'Animated GIF from GIPHY')}" loading="lazy" referrerpolicy="no-referrer"></a><a class="giphy-message-attribution" href="https://giphy.com/" target="_blank" rel="noopener noreferrer"><img src="/giphy-attribution.png" alt="Powered by GIPHY" width="100"></a>`;
        holder.querySelector('.chat-gif-message').onerror=()=>{holder.dataset.giphyState='failed';holder.innerHTML='<span>This GIF could not load.</span><button type="button" data-giphy-retry>Retry</button>';};
      }
    }
  }
  function reset(){generation++;for(const controller of controllers)controller.abort();controllers.clear();configPromise=null;}
  window.KinGiphy={html,hydrate,reset,rendition,idOK,async search(query='',offset=0){return request(query.trim()?'/search':'/trending',{...(query.trim()?{q:query}:{}),limit:12,offset});}};
})();
