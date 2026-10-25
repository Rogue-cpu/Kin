'use strict';

(() => {
  const KEY = 'kin.roleplay.v1';
  const FANDOMS = ['WWE', 'The Vampire Diaries', 'Supernatural', 'Twilight', 'Original / Other'];
  const svg = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const seed = () => ({
    version: 1,
    profile: { name: 'Your character', bio: 'Every character has a story. Make this one yours.', fandom: 'Original / Other', role: 'Original character', pronouns: '', backstory: '', boundaries: 'Ask before starting a new storyline or controlling my character.', portrait: '' },
    people: [
      { id: 'june', name: 'Dean Winchester', initials: 'DW', group: 'cast', label: 'Supernatural', fandom: 'Supernatural', role: 'Hunter', bio: 'Another highway. Another thing that goes bump in the night.', backstory: 'A fan-written version of Dean, following a new case with the cast.', boundaries: 'Discuss major injuries and plot twists first.' },
      { id: 'daniel', name: 'Damon Salvatore', initials: 'DS', group: 'cast', label: 'The Vampire Diaries', fandom: 'The Vampire Diaries', role: 'Vampire · Mystic Falls', bio: 'Mystic Falls has a way of making quiet evenings interesting.', backstory: 'A fan-written alternate timeline in Mystic Falls.', boundaries: 'Ask before adding my character to a new pairing.' },
      { id: 'emma', name: 'Bella Swan', initials: 'BS', group: 'cast', label: 'Twilight', fandom: 'Twilight', role: 'Resident of Forks', bio: 'Rain in Forks. Some things never change.', backstory: 'A fan-written Bella exploring a new chapter in Forks.', boundaries: 'Plot together before changing established relationships.' },
      { id: 'maya', name: 'Rhea Ripley', initials: 'RR', group: 'partners', label: 'WWE', fandom: 'WWE', role: 'Wrestling persona', bio: 'The next chapter starts when the bell rings.', backstory: 'An unofficial fan portrayal of a WWE persona, writing original match storylines.', boundaries: 'Agree on match outcomes together. Keep real-life information out of the story.' },
      { id: 'oliver', name: 'Rowan Vale', initials: 'RV', group: 'partners', label: 'Original / Other', fandom: 'Original / Other', role: 'Original character · Traveler', bio: 'A stranger at the crossroads, carrying a story of their own.', backstory: 'An original character available for crossover plots.', boundaries: 'Crossovers welcome. Ask before controlling my actions.' }
    ],
    requests: [
      { id: 'sophie', name: 'Elena Gilbert', initials: 'EG', group: 'cast', label: 'The Vampire Diaries', fandom: 'The Vampire Diaries', role: 'Mystic Falls resident', bio: 'Everyone has a story worth telling.', backstory: 'A fan-written Elena in an alternate timeline.', boundaries: 'Check in before major plot changes.' },
      { id: 'alex', name: 'Sam Winchester', initials: 'SW', group: 'partners', label: 'Supernatural', fandom: 'Supernatural', role: 'Hunter · Researcher', bio: 'There is probably a book about this.', backstory: 'A fan-written Sam investigating a new case.', boundaries: 'Plan major story events together.' }
    ],
    invitations: [],
    posts: [
      { id: 'night-drive', author: 'june', created: Date.now() - 42 * 60000, audience: 'cast', mode: 'ic', image: 'https://images.unsplash.com/photo-1472396961693-142e6e269027?auto=format&fit=crop&w=1200&q=85', alt: 'A forest at the edge of a new hunting case', location: 'Somewhere off the highway', caption: '*Dean folds the map and glances toward the tree line.*\n\n"Tell me somebody remembered the salt."\n\nThe radio crackles. For a second, a voice answers that none of them recognize.', likes: 8, liked: false, saved: false, comments: [{ name: 'Rowan Vale', mode: 'ic', text: '*Rowan sets a canvas bag on the hood.* "Salt, yes. A plan? That part was yours."' }] },
      { id: 'mystic-falls', author: 'daniel', created: Date.now() - 3 * 3600000, audience: 'all', mode: 'ic', image: '', alt: '', location: '', caption: '*The front door of the boarding house stands open. Damon leans against its frame, an unread letter in his hand.*\n\n"If this is another invitation to a town event, I am moving."\n\nHe turns the envelope over. His name is written in a handwriting he has not seen in a century.', likes: 5, liked: false, saved: false, comments: [] },
      { id: 'forks', author: 'emma', created: Date.now() - 5 * 3600000, audience: 'cast', mode: 'ic', image: '', alt: '', location: '', caption: '*Bella pauses at the edge of the trail. The rain has stopped, but something moves between the trees.*\n\n"I know you are there."\n\nFor once, she is not sure who she hopes will answer.', likes: 6, liked: false, saved: false, comments: [] },
      { id: 'next-match', author: 'maya', created: Date.now() - 7 * 3600000, audience: 'all', mode: 'ooc', image: '', alt: '', location: '', caption: 'OOC: Anyone up for writing a rivalry leading into a big match? We can plan the promos and agree on the finish together. Open to original wrestling characters too!', likes: 4, liked: false, saved: false, comments: [{ name: 'Rowan Vale', mode: 'ooc', text: 'I would love to brainstorm an entrance and a first promo!' }] }
    ]
  });

  let state;
  let storageAvailable = true;
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? JSON.parse(raw) : seed();
    if (state.version !== 1 || !state.profile || !['people', 'requests', 'invitations', 'posts'].every((key) => Array.isArray(state[key]))) throw new Error('Invalid saved data');
  } catch {
    state = seed();
    storageAvailable = false;
  }
  let view = 'feed';
  let filter = 'all';
  let personFilter = null;
  let fandomFilter = 'all';
  let search = '';
  const openComments = new Set();
  const content = document.getElementById('view-content');
  const modal = document.getElementById('modal');
  const modalContent = document.getElementById('modal-content');
  let toastTimer;
  let modalRevision = 0;
  let saving = false;
  let profileLayout = 'grid';
  let profileCollection = 'all';
  let viewedProfile = 'self';
  const accounts = window.KinAccount;
  const safeImage = value => /^data:image\/jpeg;base64,/.test(value || '') || /^\/api\/media\/[a-f0-9-]{36}$/.test(value || '');

  function toast(message) {
    const element = document.getElementById('toast');
    element.textContent = message;
    element.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('visible'), 4200);
  }

  async function commit(change) {
    if (saving) return false;
    const previous = JSON.stringify(state);
    change();
    if (accounts.active) {
      saving = true;
      document.querySelector('.app-shell').inert = true;
      document.querySelector('.mobile-nav').inert = true;
      modal.inert = true;
      try { state = await accounts.save(JSON.parse(previous), state); return true; }
      catch (error) { state = JSON.parse(previous); if (error.status === 401) accounts.expired(error.message); toast(error.message + ' Refresh before trying again.'); return false; }
      finally { saving = false; document.querySelector('.app-shell').inert = false; document.querySelector('.mobile-nav').inert = false; modal.inert = false; }
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      storageAvailable = true;
      return true;
    } catch {
      state = JSON.parse(previous);
      toast('Couldn’t save. Browser storage may be full or unavailable. Export your data in Settings.');
      return false;
    }
  }

  function person(id) {
    if (id === 'self') return { ...state.profile, id: 'self', initials: initials(state.profile.name), group: 'self' };
    return state.people.find((item) => item.id === id);
  }
  function initials(name) { return name.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase(); }
  function avatar(who, extra = '') {
    const classes = `avatar ${who.id === 'self' ? 'self-avatar' : `avatar-${escape(who.id)}`} ${extra}`;
    if (safeImage(who.portrait)) return `<img class="${classes}" src="${escape(who.portrait)}" alt=""/>`;
    return `<span class="${classes}" aria-hidden="true">${escape(who.initials)}</span>`;
  }
  function audienceLabel(value) { return (isPersonal() ? {all:'Approved connections',cast:'Close friends',partners:'Family'} : {all:'Approved connections',cast:'Story cast',partners:'Writing partners'})[value] || 'Approved connections'; }
  function modeLabel(mode) { return isPersonal() ? 'Personal' : mode === 'ooc' ? 'OOC · Writer note' : 'IC · In character'; }
  function fandomOptions(selected, includeAll = false) { return `${includeAll ? '<option value="all">All fandoms</option>' : ''}${FANDOMS.map((fandom) => `<option value="${escape(fandom)}" ${selected === fandom ? 'selected' : ''}>${escape(fandom)}</option>`).join('')}`; }
  function ago(timestamp) {
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
    return `${Math.floor(minutes / 1440)}d ago`;
  }
  function visiblePosts() { return state.posts.filter((post) => post.author === 'self' || person(post.author)).sort((a, b) => b.created - a.created); }
  function empty(title, message, action = '') { return `<div class="empty-state">${svg('leaf')}<h2>${escape(title)}</h2><p>${escape(message)}</p>${action}</div>`; }

  function renderChrome() {
    document.body.classList.toggle('profile-screen', view === 'profile');
    document.body.classList.toggle('messages-screen', view === 'messages');
    if(view !== 'messages') window.KinMessages.close();
    const self = person('self');
    document.querySelectorAll('.self-avatar').forEach((element) => { element.outerHTML = avatar(self, element.classList.contains('avatar-xs') ? 'avatar-xs' : ''); });
    document.querySelector('.account-button strong').textContent = self.name;
    if (accounts.active) document.querySelector('.prototype-notice').textContent = 'Signed in as @' + state.profile.handle + ' · Private accounts · Saved to Kin';
    const count = document.getElementById('request-count');
    count.textContent = state.requests.length;
    count.hidden = !state.requests.length;
    document.getElementById('sidebar-people').innerHTML = state.people.slice(0, 4).map((who) => `<div class="sidebar-person">${avatar(who)}<div><strong>${escape(who.name)}</strong><small>${escape(who.label)}</small></div><span class="person-dot" title="Approved connection"></span></div>`).join('');
    document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
    const headings = {
      messages: ['YOUR CONVERSATIONS', 'Messages', 'Private chats with your approved connections.'],
      feed: ['YOUR CHARACTERS. YOUR STORIES.', 'Step into the story', 'Familiar worlds. Original plots. Written together.'],
      people: ['FIND YOUR SCENE PARTNERS', 'Every story needs a cast', 'Approve connections and build your roleplay circle.'],
      saved: ['STORIES TO COME BACK TO', 'Keep your place', 'Saved scenes, plot ideas, and posts worth revisiting.'],
      profile: ['THE PERSON YOU PLAY', 'Meet your character', 'A character profile, a backstory, and room for a new chapter.'],
      settings: ['GOOD STORIES START WITH TRUST', 'Your space, your boundaries', 'Clear rules, character labels, and a say in your stories.']
    };
    const heading = headings[view];
    document.getElementById('page-eyebrow').textContent = heading[0];
    document.getElementById('page-title').innerHTML = `${escape(heading[1])}<span>.</span>`;
    document.getElementById('page-description').textContent = heading[2];
    content.setAttribute('aria-label', heading[1]);
    document.querySelector('.account-button small').textContent = accounts.active ? '@' + state.profile.handle : 'Unofficial fan roleplay';
    renderProfileSwitcher();
    if (accounts.active && document.querySelector('.right-footer span')) document.querySelector('.right-footer span').textContent = 'Kin private beta · Unofficial fan portrayals';
  }

  function renderPost(post) {
    const who = person(post.author);
    const expanded = openComments.has(post.id);
    const imageSafe = safeImage(post.image) || (!accounts.active && /^https:\/\/images\.unsplash\.com\//.test(post.image));
    return `<article class="post" data-post="${escape(post.id)}">
      <header class="post-header">${avatar(who)}<div><button class="post-author" data-person="${escape(who.id)}">${escape(who.name)}</button><div class="post-meta">${escape(who.fandom || 'Original / Other')}<span>·</span>${escape(ago(post.created))}</div></div><span class="post-audience ${post.mode === 'ooc' ? 'mode-ooc' : ''}">${modeLabel(post.mode)}</span></header>
      ${imageSafe ? `<div class="post-image-wrap"><img class="post-image" src="${escape(post.image)}" alt="${escape(post.alt || 'Photo shared by ' + who.name)}" loading="lazy">${post.location ? `<span class="image-caption">${escape(post.location)}</span>` : ''}</div>` : ''}
      <div class="post-actions"><button class="icon-button ${post.liked ? 'liked' : ''}" data-action="like" data-id="${escape(post.id)}" aria-label="${post.liked ? 'Unlike' : 'Like'} post" aria-pressed="${post.liked}">${svg('heart')}</button><button class="icon-button" data-action="comments" data-id="${escape(post.id)}" aria-label="Comment on post" aria-expanded="${expanded}">${svg('comment')}</button><button class="icon-button save-action ${post.saved ? 'saved' : ''}" data-action="save" data-id="${escape(post.id)}" aria-label="${post.saved ? 'Unsave' : 'Save'} post" aria-pressed="${post.saved}">${svg('bookmark')}</button></div>
      <p class="post-likes">${post.likes + Number(post.liked)} ${post.likes + Number(post.liked) === 1 ? 'like' : 'likes'}${post.liked ? ' · including you' : ''}<span class="post-visibility">${svg('lock')}${audienceLabel(post.audience)}</span></p>
      <p class="post-caption"><strong>${escape(who.name.split(' ')[0])}</strong>${escape(post.caption)}</p>
      <button class="comments-toggle" data-action="comments" data-id="${escape(post.id)}" aria-expanded="${expanded}">${expanded ? 'Hide replies' : post.comments.length ? `Read ${post.comments.length === 1 ? 'the reply' : `all ${post.comments.length} replies`}` : 'Write the next line'}</button>${post.author === 'self' ? `<button class="delete-button" data-action="delete" data-id="${escape(post.id)}">Delete post</button>` : ''}
      ${expanded ? `<div class="post-comments">${post.comments.map((comment) => `<p class="comment"><strong>${escape(comment.name)}</strong><span class="reply-mode">${comment.mode === 'ooc' ? 'OOC' : 'IC'}</span>${escape(comment.text)}</p>`).join('')}<form class="comment-form" data-comment-form="${escape(post.id)}">${avatar(person('self'), 'avatar-xs')}<select name="mode" aria-label="Reply as character or writer"><option value="ic" ${post.mode !== 'ooc' ? 'selected' : ''}>IC</option><option value="ooc" ${post.mode === 'ooc' ? 'selected' : ''}>OOC</option></select><input name="comment" aria-label="Your roleplay reply" placeholder="Continue the scene…" maxlength="2000" required autocomplete="off"><button type="submit">Reply</button></form></div>` : ''}
    </article>`;
  }

  function renderFeed() {
    if(isPersonal()){renderPersonalFeed();return;}
    const people = state.people.slice(0, 5);
    let posts = visiblePosts().filter((post) => (filter === 'all' || post.mode === filter) && (fandomFilter === 'all' || person(post.author).fandom === fandomFilter));
    if (personFilter) posts = posts.filter((post) => post.author === personFilter);
    content.innerHTML = `<div class="fandom-intro"><span class="pill">FAN ROLEPLAY</span><span>WWE · The Vampire Diaries · Supernatural · Twilight</span></div><div class="people-strip" aria-label="Filter by character"><button class="person-bubble" data-action="edit-profile"><span class="bubble-ring">${avatar(person('self'))}</span>Your character</button>${people.map((who) => `<button class="person-bubble ${personFilter === who.id ? 'selected-person' : ''}" data-action="filter-person" data-id="${escape(who.id)}" aria-pressed="${personFilter === who.id}"><span class="bubble-ring">${avatar(who)}</span>${escape(who.name.split(' ')[0])}</button>`).join('')}</div>
      <div class="feed-toolbar"><div class="tabs" role="group" aria-label="Post mode filters">${[['all', 'All posts'], ['ic', 'In character'], ['ooc', 'Out of character']].map(([key, label]) => `<button class="tab ${filter === key ? 'active' : ''}" data-filter="${key}" aria-pressed="${filter === key}">${label}</button>`).join('')}</div><label class="fandom-filter"><span class="sr-only">Filter by fandom</span><select id="fandom-filter">${fandomOptions(fandomFilter, true)}</select></label></div>
      ${personFilter ? `<button class="clear-filter" data-action="clear-person">Showing ${escape(person(personFilter)?.name || 'one person')} · Clear filter ×</button>` : ''}
      <div class="compose-card">${avatar(person('self'))}<button class="compose-prompt" data-action="create">What happens next, ${escape(state.profile.name.split(' ')[0])}?</button><button class="compose-image" data-action="create" aria-label="Create a roleplay post">${svg('plus')}</button></div><p class="feed-order">Chronological feed · Newest posts first</p>
      ${posts.length ? posts.map(renderPost).join('') + `<div class="end-feed">${svg('leaf')}<div>The next chapter is yours.</div><p>Start a scene. Leave room for someone to reply.</p></div>` : empty('A new story starts here', 'No posts match these filters yet. Try another fandom or write the opening scene.', '<button class="button button-primary" data-action="create">Write a post</button>')}`;
  }

  function renderPeople() {
    if(isPersonal()){renderPersonalPeople();return;}
    const matching = state.people.filter((who) => who.name.toLowerCase().includes(search.toLowerCase()));
    content.innerHTML = `${state.requests.length ? `<section class="content-card"><div class="card-title-row"><h2>New scene partners?</h2><span class="pill">${state.requests.length} requests</span></div><p>Sample connection requests. Check character profiles and discuss boundaries before writing together.</p>${state.requests.map((who) => `<div class="person-row">${avatar(who)}<div><strong>${escape(who.name)}</strong><p>${escape(who.label)} · Fan roleplay</p></div><div class="row-actions"><button class="button button-secondary" data-action="accept" data-id="${escape(who.id)}">Approve</button><button class="button" data-action="decline" data-id="${escape(who.id)}">Decline</button></div></div>`).join('')}</section>` : ''}
      <section class="content-card"><div class="card-title-row"><h2>Your cast <span class="pill">${state.people.length}</span></h2><button class="text-button" data-action="invite">+ Invite a writer</button></div><label class="field-label" for="people-search">Find a character</label><input id="people-search" class="search-input" placeholder="Search by character name…" value="${escape(search)}" autocomplete="off"><div id="people-list">${peopleRows(matching)}</div></section>
      ${state.invitations.length ? `<section class="content-card"><h2>Invitation drafts</h2><p>Saved on this browser. These have not been sent.</p>${state.invitations.map((invite) => `<div class="person-row"><div><strong>${escape(invite.name)}</strong><p>${escape(invite.email)}</p></div><div class="row-actions"><button class="button" data-action="cancel-invite" data-id="${escape(invite.id)}">Remove</button></div></div>`).join('')}</section>` : ''}`;
  }
  function peopleRows(people) {
    return people.length ? people.map((who) => `<div class="person-row">${avatar(who)}<div><button class="post-author" data-person="${escape(who.id)}">${escape(who.name)}</button><p>${escape(isPersonal()?(who.location || 'Personal profile'):who.fandom)}</p></div><div class="row-actions"><select aria-label="Circle for ${escape(who.name)}" data-group="${escape(who.id)}"><option value="cast" ${who.group === 'cast' ? 'selected' : ''}>${audienceLabel('cast')}</option><option value="partners" ${who.group === 'partners' ? 'selected' : ''}>${audienceLabel('partners')}</option></select><button class="icon-button" data-action="remove-person" data-id="${escape(who.id)}" aria-label="Remove ${escape(who.name)}">${svg('close')}</button></div></div>`).join('') : '<p class="small-note">No characters match that name.</p>';
  }

  function renderProfile() { renderSocialProfile(); }

  function connectWriter() {
    showModal('Connect with a writer', `<form id="connection-form"><p class="modal-help">Ask your friend for their writer handle. They’ll need to approve your request before you can read each other’s posts.</p><label class="field-label" for="connection-handle">Their writer handle</label><input class="field-input" id="connection-handle" required minlength="3" maxlength="25" placeholder="@writer_handle" autocomplete="off"><p class="form-error" id="connection-error" role="alert"></p><div class="form-footer"><small>Your handle: @${escape(state.profile.handle)}</small><button class="button button-primary" type="submit">Send request</button></div></form>`);
    if (isPersonal()) { document.getElementById('modal-title').textContent='Connect with a friend'; document.querySelector('#connection-form .modal-help').textContent='Use your friend’s account handle. Approve personal connections separately from roleplay connections.'; }
    document.getElementById('connection-form').onsubmit = async event => {
      event.preventDefault(); const submit=event.target.querySelector('[type="submit"]');submit.disabled=true;
      try { await accounts.act('request',{handle:document.getElementById('connection-handle').value.trim().replace(/^@/,'')});modal.close();navigate('people');toast('Request sent. Your friend can approve it from Your cast.'); }
      catch(error) { document.getElementById('connection-error').textContent=error.message; }
      finally {submit.disabled=false;}
    };
  }
  function renderAccountSettings() {
    content.innerHTML=`<section class="content-card"><h2>Your Kin account</h2><p>Signed in as <strong>@${escape(state.profile.handle)}</strong>. Your password and recovery code are never included in your profile or writing export.</p><div class="setting-actions"><button class="button button-secondary" data-action="refresh">Refresh feed</button><button class="button" data-action="export">Export visible writing</button><button class="button" data-action="logout">Sign out</button></div></section><section class="content-card"><h2>Private sharing. Clear boundaries.</h2><div class="settings-section"><h3>Two separate profiles, one login</h3><p>Your personal and roleplay profiles have separate names, photos, posts, bookmarks, and connections. Approve people separately in each profile. Choose the active profile before posting. The same account handle is used to connect in both profiles.</p></div><div class="settings-section"><h3>Characters are unofficial fan portrayals</h3><p>Kin is not affiliated with WWE or the featured series. Character names and writer identities stay separate. Use IC for scenes and OOC for planning or checking boundaries.</p></div><div class="settings-section"><h3>Your way back in</h3><p>Keep the recovery code you saved when joining. Reset a forgotten password from the sign-in screen using your handle and recovery code. Recovery signs out previous sessions and issues a new code.</p></div><div class="settings-section"><h3>Connections can change</h3><p>Removing a connection stops future access to your profile, posts, and photos. People can still keep copies of content they already viewed.</p></div><div class="settings-section"><h3>This first private beta</h3><p>A personal profile and a roleplay profile per account, invite-only sign-up, and the latest 200 visible posts in each feed. Email recovery and a staffed moderation and appeals process are not available yet.</p></div></section>`;
  }

  function isPersonal() { return state.profileKind === 'personal'; }
  function renderProfileSwitcher() {
    document.body.classList.toggle('profile-personal', isPersonal());
    if (!accounts.active) return;
    let bar = document.getElementById('profile-mode-bar');
    if (!bar) { bar = document.createElement('div'); bar.id = 'profile-mode-bar'; document.querySelector('.page-heading').before(bar); }
    bar.className = 'profile-mode-bar';
    bar.innerHTML = `<div class="active-identity">${avatar(person('self'))}<div><span class="identity-label">${isPersonal() ? 'PERSONAL PROFILE' : 'ROLEPLAY PROFILE'}</span><strong>${escape(state.profile.name)}</strong></div></div><label class="profile-switch-label"><span class="sr-only">Switch between personal and roleplay profiles</span><select id="profile-switch"><option value="personal" ${isPersonal() ? 'selected' : ''}>Personal · ${escape(state.profiles?.find(p=>p.kind==='personal')?.name || 'Your life')}</option><option value="roleplay" ${!isPersonal() ? 'selected' : ''}>Roleplay · ${escape(state.profiles?.find(p=>p.kind==='roleplay')?.name || 'Your character')}</option></select></label>`;
    document.querySelector('.sidebar [data-view="profile"]>span:last-child').textContent = isPersonal() ? 'Your profile' : 'Your character';
    document.querySelector('.sidebar nav [data-view="people"]>span:first-of-type').textContent = isPersonal() ? 'Your people' : 'Your cast';
    document.querySelector('.mobile-nav [data-view="profile"]').setAttribute('aria-label',isPersonal()?'Your personal profile':'Your character');
    document.querySelector('.mobile-nav [data-view="people"]').setAttribute('aria-label',isPersonal()?'Your people':'Your cast');
    document.querySelector('.brand-caption').textContent = isPersonal() ? 'Your life. Your people.' : 'Stay in character.';
    document.querySelector('.sidebar-note p').innerHTML = isPersonal() ? 'Everyday moments.<br>People who matter.' : 'Familiar worlds.<br>Unwritten stories.';
    document.querySelector('.sidebar-note>span:last-child').innerHTML = isPersonal() ? 'For the little things<br>and the people in your life.' : 'For the characters you love<br>and the ones you create.';
    document.querySelector('.welcome-card .eyebrow').textContent = isPersonal() ? 'A SPACE FOR YOUR EVERYDAY' : 'THE NEXT CHAPTER IS YOURS';
    document.querySelector('.create-button').innerHTML = svg('plus') + (isPersonal() ? ' Share a post' : ' Write a post');
    document.querySelector('.prototype-notice').textContent = `@${state.profile.handle} · ${isPersonal()?'Personal':'Roleplay'} profile · Only approved connections`;
    document.querySelector('.welcome-card h2').innerHTML = isPersonal() ? 'Your life.<br>Your people.' : 'Familiar worlds.<br>New stories.';
    document.querySelector('.welcome-card>p:not(.eyebrow)').textContent = isPersonal() ? 'Everyday photos, little updates, and the people you choose to share them with.' : 'Play your character and write the next chapter with your cast.';
    document.querySelector('.welcome-card .handwritten').textContent = isPersonal() ? 'Edit your personal profile ↗' : 'Edit your character ↗';
    document.querySelector('.connections-panel h2').textContent = isPersonal() ? 'Your people' : 'Your cast';
    document.querySelector('.invite-link').innerHTML = svg('plus') + (isPersonal() ? ' Connect with a friend' : ' Connect with a writer');
    document.querySelector('.trust-note h3').textContent = 'One login. Two separate profiles.';
    document.querySelector('.trust-note p').textContent = 'Separate names, posts, avatars, and connections. Choose your profile before sharing.';
    document.querySelector('.main-footer').textContent = isPersonal() ? 'Little moments. Real connections.' : 'Your characters. Your stories. Unofficial fan roleplay.';
    document.querySelector('.right-footer').textContent = isPersonal() ? 'Your personal life, shared with your approved people. Kin private beta.' : 'Fan-made stories. Unofficial portrayals. Kin private beta.';
    if (isPersonal()) {
      const headings = {messages:['YOUR CONVERSATIONS','Messages','Private chats with your approved connections.'],feed:['YOUR EVERYDAY, SHARED','Life looks good on you','Photos, updates, and familiar faces.'],people:['YOUR INNER CIRCLE','The people in your life','Approve the people you want to share with.'],profile:['YOUR PERSONAL SPACE','A little more you','Your photos, your updates, your real life.'],saved:['KEEP THE LITTLE THINGS','Saved for later','Photos and updates you want to revisit.'],settings:['YOUR ACCOUNT, YOUR CHOICES','Make yourself at home','Two profiles. One secure sign-in.']};
      const heading = headings[view];
      document.getElementById('page-eyebrow').textContent=heading[0];
      document.getElementById('page-title').innerHTML=heading[1]+'<span>.</span>';
      document.getElementById('page-description').textContent=heading[2];
    }
  }
  function renderPersonalFeed() {
    let posts=visiblePosts().filter(post=>filter==='all'||(post.author==='self' ? post.audience==='all'||post.audience===filter : person(post.author).group===filter));
    if(personFilter)posts=posts.filter(post=>post.author===personFilter);
    content.innerHTML=`<div class="people-strip"><button class="person-bubble" data-action="create"><span class="bubble-ring">${avatar(person('self'))}</span>Your update</button>${state.people.slice(0,5).map(who=>`<button class="person-bubble" data-action="filter-person" data-id="${escape(who.id)}"><span class="bubble-ring">${avatar(who)}</span>${escape(who.name.split(' ')[0])}</button>`).join('')}</div><div class="feed-toolbar"><div class="tabs" role="group" aria-label="Personal feed filters">${[['all','All posts'],['cast','Close friends'],['partners','Family']].map(([key,label])=>`<button class="tab ${filter===key?'active':''}" data-filter="${key}" aria-pressed="${filter===key}">${label}</button>`).join('')}</div><button class="text-button" data-action="refresh">Refresh ↻</button></div>${personFilter?'<button class="clear-filter" data-action="clear-person">Show all your people ×</button>':''}<div class="compose-card">${avatar(person('self'))}<button class="compose-prompt" data-action="create">A photo, a little update, a moment to share…</button><button class="compose-image" data-action="create" aria-label="Add a post">${svg('image')}</button></div><p class="feed-order">Your personal feed · Latest first</p>${posts.length?posts.map(renderPost).join('')+`<div class="end-feed">${svg('check')}<div>You’re all caught up.</div><p>More life. More moments to share.</p></div>`:empty('Make this space your own','Share your first personal post, then connect with friends by writer handle. Personal connections are approved separately from roleplay.','<button class="button button-primary" data-action="create">Share a post</button>')}`;
  }
  function renderSocialProfile() {
    const self=person(viewedProfile)||person('self'), own=self.id==='self', allPosts=visiblePosts().filter(post=>post.author===self.id);
    const collections=[{id:'all',label:'All posts',icon:'image',posts:allPosts},{id:'photos',label:'Photos',icon:'image',posts:allPosts.filter(p=>p.image)},...(!isPersonal()?[{id:'ic',label:'In character',icon:'leaf',posts:allPosts.filter(p=>p.mode==='ic')},{id:'ooc',label:'Writer notes',icon:'comment',posts:allPosts.filter(p=>p.mode==='ooc')}]:[])];
    const selected=collections.find(c=>c.id===profileCollection)||collections[0], posts=selected.posts;
    const safePhoto=post=>post&&(safeImage(post.image)||(!accounts.active&&post.image.startsWith('https://images.unsplash.com/')));
    content.innerHTML=`<section class="social-profile" aria-label="${isPersonal()?'Personal':'Roleplay'} profile"><header class="social-profile-top"><button class="icon-button" data-view="feed" aria-label="Back to feed">${svg('arrow')}</button><h2>${escape(self.handle || state.profile.handle || 'your_handle')}</h2><span class="profile-private" title="Private profile">${svg('lock')}<span>Private</span></span><div class="profile-settings"><button class="icon-button" data-view="settings" aria-label="Settings & trust">${svg('settings')}</button></div></header><div class="profile-overview"><div class="profile-avatar-ring">${avatar(self)}</div><div class="social-stats"><span><strong>${allPosts.length}</strong>posts</span>${own?`<button data-view="people"><strong>${state.people.length}</strong>connections</button>`:`<span class="approved-stat">${svg('check')}<span>connected</span></span>`}<span><strong>${allPosts.filter(p=>p.image).length}</strong>photos</span></div></div><div class="social-bio"><div class="social-display-name"><h3>${escape(self.name)}</h3>${self.pronouns?`<span>${escape(self.pronouns)}</span>`:''}</div><p class="social-category">${isPersonal()?escape(self.location||'Personal profile'):`${escape(self.fandom)} · ${escape(self.role||'Character')}`}</p><p class="profile-bio">${escape(self.bio|| (isPersonal()?'A few words about you.':'Every character has a story.'))}</p><p class="social-disclosure">${svg(isPersonal()?'lock':'leaf')}${isPersonal()?'Personal · Approved connections only':'Fan roleplay · Unofficial portrayal'}</p></div><div class="social-actions">${own?`<button class="button" data-action="edit-profile">${isPersonal()?'Edit profile':'Edit character'}</button><button class="button" data-action="create">${isPersonal()?'Add a post':'New scene'}</button><button class="button" data-action="invite" aria-label="Connect by handle">${svg('people')}</button>`:`<button class="button" data-view="people">Connected ${svg('check')}</button><button class="button" data-action="message-person" data-id="${escape(self.id)}">Message</button><button class="button" data-action="invite" aria-label="Connect by handle">${svg('people')}</button>`}</div>${!isPersonal()?`<details class="character-details social-boundaries"><summary>Backstory & writer boundaries</summary><h3>Backstory</h3><p>${escape(self.backstory||'Add your character’s backstory.')}</p><h3>Writer boundaries · OOC</h3><p>${escape(self.boundaries||'Discuss preferences before starting a scene.')}</p></details>`:''}<div class="profile-collections" role="group" aria-label="Filter profile posts">${collections.map(c=>{const cover=c.posts.find(safePhoto);return `<button class="profile-collection ${selected.id===c.id?'selected':''}" data-collection="${c.id}" aria-pressed="${selected.id===c.id}"><span class="collection-cover">${cover?`<img src="${escape(cover.image)}" alt="" loading="lazy">`:svg(c.icon)}</span><span>${c.label}</span></button>`;}).join('')}</div><div class="profile-post-toolbar"><h2 class="sr-only">${escape(selected.label)}</h2><div class="profile-grid-tabs" role="group" aria-label="Profile post layout"><button class="${profileLayout==='grid'?'active':''}" data-layout="grid" aria-label="Photo grid" aria-pressed="${profileLayout==='grid'}"><span aria-hidden="true">▦</span></button><button class="${profileLayout==='list'?'active':''}" data-layout="list" aria-label="Post feed" aria-pressed="${profileLayout==='list'}">${svg('image')}</button></div></div>${posts.length?(profileLayout==='list'?posts.map(renderPost).join(''):`<div class="photo-grid">${posts.map(post=>`<button class="photo-tile ${safePhoto(post)?'':'text-tile'}" data-action="open-post" data-id="${escape(post.id)}" aria-label="Open post: ${escape(post.caption.slice(0,100))}">${safePhoto(post)?`<img src="${escape(post.image)}" alt="${escape(post.alt||'Photo shared by '+self.name)}" loading="lazy">`:`<span>${svg(isPersonal()?'comment':'leaf')}<span>${escape(post.caption.slice(0,160))}</span></span>`}<span class="tile-overlay">${svg('heart')}${post.likes+Number(post.liked)} ${svg('comment')}${post.comments.length}</span></button>`).join('')}</div>`):empty(allPosts.length?'No posts here yet':isPersonal()?'Your life starts here':'Write your opening scene',allPosts.length?'Posts in this collection will appear here.':isPersonal()?'Share a photo or a little moment from your day.':'Share a character update, scene starter, or OOC plot idea.',own?'<button class="button button-primary" data-action="create">'+(isPersonal()?'Share a post':'Write a post')+'</button>':'')}</section>`;
  }

  function personalEditor() {
    const self=state.profile;
    return `<form id="profile-form"><p class="modal-help">This is your personal profile. Your character, roleplay posts, and roleplay connections stay separate.</p><label class="field-label" for="profile-name">Your name</label><input class="field-input" id="profile-name" maxlength="60" required value="${escape(self.name)}"><div hidden><select id="profile-fandom"><option>Personal</option></select><input id="profile-role" value="Personal profile"><textarea id="profile-backstory"></textarea><textarea id="profile-boundaries"></textarea></div><label class="field-label" for="profile-pronouns">Pronouns (optional)</label><input class="field-input" id="profile-pronouns" maxlength="40" value="${escape(self.pronouns||'')}" placeholder="e.g. she/her"><label class="field-label" for="profile-location">Location (optional)</label><input class="field-input" id="profile-location" maxlength="100" value="${escape(self.location||'')}" placeholder="Your city or somewhere you call home"><label class="field-label" for="profile-portrait">Profile photo</label><div class="portrait-editor"><span id="portrait-preview">${avatar(person('self'))}</span><input id="profile-portrait" type="file" accept="image/jpeg,image/png,image/webp"><button class="text-button" type="button" id="remove-portrait">Use initials</button></div><p class="small-note">JPEG, PNG, or WebP · Up to 10 MB</p><label class="field-label" for="profile-bio">Bio</label><textarea class="field-input" id="profile-bio" maxlength="300" placeholder="A little about you…">${escape(self.bio)}</textarea><div class="form-error" id="profile-error" role="alert"></div><div class="form-footer"><small>Your personal profile · Private</small><button class="button button-primary" id="profile-submit" type="submit">Save profile</button></div></form>`;
  }
  function renderPersonalPeople() {
    content.innerHTML=`${state.requests.length?`<section class="content-card"><div class="card-title-row"><h2>Connection requests</h2><span class="pill">${state.requests.length}</span></div><p>These people are requesting access to your personal profile.</p>${state.requests.map(who=>`<div class="person-row">${avatar(who)}<div><strong>${escape(who.name)}</strong><p>@${escape(who.handle)}</p></div><div class="row-actions"><button class="button button-secondary" data-action="accept" data-id="${escape(who.id)}">Approve</button><button class="button" data-action="decline" data-id="${escape(who.id)}">Decline</button></div></div>`).join('')}</section>`:''}<section class="content-card"><div class="card-title-row"><h2>Your people <span class="pill">${state.people.length}</span></h2><button class="text-button" data-action="invite">+ Connect</button></div><label class="field-label" for="people-search">Find your people</label><input class="search-input" id="people-search" value="${escape(search)}" placeholder="Search by name…"><div id="people-list">${peopleRows(state.people.filter(who=>who.name.toLowerCase().includes(search.toLowerCase())))}</div></section>`;
  }
  function showPersonalPerson(who) {
    showModal('Personal profile',`<div class="person-profile-detail">${avatar(who)}<h3>${escape(who.name)}</h3><p>@${escape(who.handle)}</p><p>${escape(who.bio)}</p><span class="pill">Personal · Approved connection</span>${who.location?`<p>${escape(who.location)}</p>`:''}</div><button class="button button-secondary" id="see-person" style="width:100%">See posts ${svg('arrow')}</button>`);
    document.getElementById('see-person').onclick=()=>{modal.close();view='feed';filter='all';personFilter=who.id;fandomFilter='all';render();window.scrollTo({top:0});};
  }

  function renderSettings() {
    if (accounts.active) { renderAccountSettings(); return; }
    content.innerHTML = `<section class="content-card"><h2>Built for people who write together</h2><div class="settings-section"><h3>A character is a character</h3><p>Profiles are clearly marked as unofficial fan roleplay. A WWE portrayal is a fan interpretation of an on-screen persona, not an official wrestler account. Kin is not affiliated with WWE or the featured series.</p></div><div class="settings-section"><h3>Keep the writer and the character separate</h3><p>Use IC for scenes and character updates. Use OOC for plotting, checking in, and discussing boundaries. Ask before controlling another character or deciding an outcome for them.</p></div><div class="settings-section"><h3>Your circle, your choice</h3><p>The intended app will require approved connections. Audience choices include your story cast, writing partners, or all approved connections.</p></div><div class="settings-section"><h3>Clear explanations and fair appeals</h3><p>The planned moderation process will distinguish labeled roleplay from deceptive impersonation, explain rule violations, and offer an appeal route. Serious safety issues may require immediate action.</p></div><div class="settings-section"><h3>Your writing belongs with you</h3><p>Export your locally saved character, posts, photos, and replies whenever you like. The feed stays chronological.</p></div></section>
      <section class="content-card"><h2>About this prototype</h2><p>This is a single-user demo with sample fan portrayals. Changes stay in this browser. There is no sign-in, server, real invitation delivery, or enforced access control yet. Audience labels demonstrate the planned behavior.</p><p>Real multi-user roleplay needs authentication, server-side permissions, secure uploads, real invitations, and a moderation and appeals service before launch.</p><p class="small-note">Browser storage: ${storageAvailable ? 'available' : 'unavailable or unreadable'}. Clearing browser data removes local changes. Sample photos and fonts load from external services. Your earlier photo-sharing demo data uses a separate storage key and is untouched.</p><div class="setting-actions"><button class="button button-secondary" data-action="export">Export my writing</button><button class="button" data-action="reset">Reset roleplay demo</button></div></section>`;
  }

  function render() {
    renderChrome();
    if(view === 'messages') window.KinMessages.render(content,state);
    else if (view === 'feed') renderFeed();
    else if (view === 'people') {
      renderPeople();
      if(accounts.active) {
        const bar=document.createElement('section');bar.className='content-card';
        bar.innerHTML='<h2>'+(isPersonal()?'Connect with a friend':'Connect with a writer')+'</h2><p>Your handle is <strong>@'+escape(state.profile.handle)+'</strong>. Share it with people you know. Personal and roleplay connections are approved separately.</p><button class="button button-secondary" data-action="invite">Connect by handle</button>'+(state.outgoing?.length ? '<h3 class="subheading">Waiting for approval</h3>'+state.outgoing.map(who=>'<div class="person-row"><div><strong>'+escape(who.name)+'</strong><p>@'+escape(who.handle)+'</p></div><button class="text-button" data-action="cancel-request" data-id="'+escape(who.id)+'">Cancel request</button></div>').join('') : '');
        content.prepend(bar);
        content.querySelectorAll('.content-card>p').forEach(p=>{if(p.textContent.startsWith('Sample connection'))p.textContent='Approve writers you know and discuss boundaries before starting a scene.';});
      }
    }
    else if (view === 'profile') renderProfile();
    else if (view === 'settings') renderSettings();
    else {
      const posts = visiblePosts().filter((post) => post.saved);
      content.innerHTML = posts.length ? posts.map(renderPost).join('') : empty(isPersonal()?'Save a little moment':'Keep your place in the story', isPersonal()?'Bookmark a photo or update to find it here. Personal and roleplay saved posts stay separate.':'Bookmark a scene or plot idea to find it here. Your saved list is just for you.', '<button class="button button-secondary" data-view="feed">Explore your feed</button>');
    }
  }

  function navigate(next) {
    if (!['feed', 'people', 'saved', 'profile', 'settings', 'messages'].includes(next)) return;
    view = next;
    if(next === 'profile') {profileCollection = 'all';viewedProfile='self';}
    if (next === 'feed') { filter = 'all'; personFilter = null; fandomFilter = 'all'; }
    render();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function showModal(title, html) {
    modalRevision += 1;
    document.getElementById('modal-title').textContent = title;
    modalContent.innerHTML = html;
    modal.showModal();
  }
  function confirmAction(title, text, label, callback) {
    showModal(title, `<p class="modal-help">${escape(text)}</p><div class="form-footer"><button class="button" id="confirm-cancel">Cancel</button><button class="button button-primary" id="confirm-action">${escape(label)}</button></div>`);
    document.getElementById('confirm-cancel').onclick = () => modal.close();
    document.getElementById('confirm-action').onclick = async () => { if (await callback() !== false) { modal.close(); render(); } };
  }

  function createPost() {
    showModal('Write the next chapter', `<form id="post-form"><p class="posting-as">${avatar(person('self'), 'avatar-xs')}Posting as <strong>${escape(state.profile.name)}</strong><span class="reply-mode">FAN ROLEPLAY</span></p><label class="field-label" for="post-mode">Character or writer?</label><select class="field-input" id="post-mode"><option value="ic">IC · In character</option><option value="ooc">OOC · Writer note / plotting</option></select><label class="field-label" for="post-caption">Your post</label><textarea class="field-input scene-input" id="post-caption" maxlength="5000" placeholder="Set the scene, speak as your character, or share a plot idea…" required></textarea><label class="upload-zone compact-upload" id="upload-zone">${svg('image')}<span>Add a photo (optional)</span><small>JPEG, PNG, or WebP · up to 10 MB</small><input id="photo-input" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Add an optional photo"></label><button class="text-button" type="button" id="remove-photo" hidden>Remove photo</button><div id="photo-description-field" hidden><label class="field-label" for="photo-description">Photo description</label><input class="field-input" id="photo-description" maxlength="250" placeholder="Describe the photo for people using screen readers"></div><label class="field-label" for="post-audience">Who can see this?</label><select class="field-input" id="post-audience"><option value="all">All approved connections</option><option value="cast">${audienceLabel('cast')}</option><option value="partners">${audienceLabel('partners')}</option></select><p class="small-note">Fan roleplay, not an official account. Audience selection is a preview; this demo stays in your browser.</p><div class="form-error" id="post-error" role="alert"></div><div class="form-footer"><small>Leave room for the next writer.</small><button class="button button-primary" type="submit" id="share-submit">Publish post ${svg('arrow')}</button></div></form>`);
    if(accounts.active) document.querySelector('#post-form .small-note').textContent='Posting to your '+(isPersonal()?'personal':'roleplay')+' profile. Only approved connections in your chosen audience can read this.';
    if(isPersonal()){document.getElementById('modal-title').textContent='New personal post';document.querySelector('[for=post-mode]').hidden=true;document.getElementById('post-mode').hidden=true;document.getElementById('post-mode').value='ic';document.getElementById('post-caption').placeholder='Share a photo or a little life update…';document.getElementById('share-submit').textContent='Share post';document.querySelector('#post-audience [value=cast]').textContent='Close friends';document.querySelector('#post-audience [value=partners]').textContent='Family';}
    let dataUrl = null;
    let loadVersion = 0;
    const revision = modalRevision;
    const error = document.getElementById('post-error');
    const submit = document.getElementById('share-submit');
    document.getElementById('photo-input').onchange = async (event) => {
      const version = ++loadVersion;
      const file = event.target.files[0];
      dataUrl = null;
      submit.disabled = Boolean(file);
      error.textContent = '';
      document.querySelector('.upload-preview')?.remove();
      document.getElementById('photo-description-field').hidden = true;
      document.getElementById('photo-description').required = false;
      document.getElementById('remove-photo').hidden = !file;
      if (!file) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { error.textContent = 'Choose a JPEG, PNG, or WebP photo smaller than 10 MB, or remove it to publish text only.'; return; }
      try {
        const result = await resizePhoto(file);
        if (version !== loadVersion || !modal.open || revision !== modalRevision) return;
        dataUrl = result;
        const preview = document.createElement('img');
        preview.className = 'upload-preview';
        preview.alt = 'Your selected photo';
        preview.src = result;
        document.getElementById('upload-zone').prepend(preview);
        document.getElementById('photo-description-field').hidden = false;
        document.getElementById('photo-description').required = true;
        submit.disabled = false;
      } catch { error.textContent = 'That image couldn’t be opened. Try another photo.'; }
    };
    document.getElementById('remove-photo').onclick = () => {
      loadVersion += 1;
      dataUrl = null;
      document.getElementById('photo-input').value = '';
      document.querySelector('.upload-preview')?.remove();
      document.getElementById('photo-description-field').hidden = true;
      document.getElementById('photo-description').required = false;
      document.getElementById('remove-photo').hidden = true;
      error.textContent = '';
      submit.disabled = false;
    };
    document.getElementById('post-form').onsubmit = async (event) => {
      event.preventDefault();
      const audience = document.getElementById('post-audience').value;
      const post = { id: `post-${makeId()}`, author: 'self', created: Date.now(), audience, mode: document.getElementById('post-mode').value, image: dataUrl || '', alt: dataUrl ? document.getElementById('photo-description').value.trim() : '', caption: document.getElementById('post-caption').value.trim(), likes: 0, liked: false, saved: false, comments: [] };
      if (!post.caption) { error.textContent = 'Write a scene, a character update, or a plot idea first.'; return; }
      if (dataUrl && !post.alt) { error.textContent = 'Add a short photo description.'; return; }
      if (await commit(() => state.posts.unshift(post))) {
        modal.close(); navigate('feed'); toast(accounts.active ? 'Post shared with your chosen audience.' : 'Your roleplay post is saved in this browser.');
      } else { error.textContent = 'Your post wasn’t saved. Export your data or try a smaller photo.'; }
    };
  }

  function makeId() {
    return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  async function resizePhoto(file, maxSize = 1400) {
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = objectUrl; });
      const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.8);
    } finally { URL.revokeObjectURL(objectUrl); }
  }

  function invite() {
    if (accounts.active) { connectWriter(); return; }
    showModal('Invite a writer', `<p class="modal-help">Who would you like to write with? Save an invitation draft for now. Sending invitations will be available once real accounts are connected.</p><form id="invite-form"><label class="field-label" for="invite-name">Their name</label><input class="field-input" id="invite-name" maxlength="70" required placeholder="A writer you know"><label class="field-label" for="invite-email">Their email</label><input class="field-input" id="invite-email" type="email" maxlength="254" required placeholder="hello@example.com"><div class="form-error" id="invite-error" role="alert"></div><div class="form-footer"><small>Draft only · no email will be sent</small><button class="button button-primary" type="submit">Save draft</button></div></form>`);
    document.getElementById('invite-form').onsubmit = async (event) => {
      event.preventDefault();
      const name = document.getElementById('invite-name').value.trim();
      const email = document.getElementById('invite-email').value.trim().toLowerCase();
      if (!name) { document.getElementById('invite-error').textContent = 'Enter their name.'; return; }
      if (state.invitations.some((item) => item.email === email)) { document.getElementById('invite-error').textContent = 'You already have a draft for this email.'; return; }
      if (await commit(() => state.invitations.push({ id: makeId(), name, email }))) { modal.close(); navigate('people'); toast('Invitation draft saved. No email was sent.'); }
    };
  }

  function editProfile() {
    const self = state.profile;
    if(isPersonal())showModal('Edit your personal profile',personalEditor());
    else showModal('Who will you play?', `<form id="profile-form"><p class="modal-help">Play a canon character, a WWE persona, or an original character. Your profile will always be labeled as unofficial fan roleplay.</p><label class="field-label" for="profile-name">Character name</label><input class="field-input" id="profile-name" value="${escape(self.name)}" maxlength="60" required placeholder="e.g. Katherine Pierce"><div class="form-columns"><div><label class="field-label" for="profile-fandom">Fandom</label><select class="field-input" id="profile-fandom">${fandomOptions(self.fandom)}</select></div><div><label class="field-label" for="profile-pronouns">Character pronouns</label><input class="field-input" id="profile-pronouns" value="${escape(self.pronouns || '')}" maxlength="40" placeholder="e.g. she/her"></div></div><label class="field-label" for="profile-role">Role / character type</label><input class="field-input" id="profile-role" value="${escape(self.role || '')}" maxlength="100" placeholder="Vampire, hunter, wrestler, original character…"><label class="field-label" for="profile-portrait">Character avatar (optional)</label><div class="portrait-editor"><span id="portrait-preview">${avatar(person('self'))}</span><input id="profile-portrait" type="file" accept="image/jpeg,image/png,image/webp"><button class="text-button" type="button" id="remove-portrait">Use initials</button></div><p class="small-note">Choose an image you have permission to use. JPEG, PNG, or WebP, up to 10 MB.</p><label class="field-label" for="profile-bio">Profile bio</label><textarea class="field-input" id="profile-bio" maxlength="300">${escape(self.bio)}</textarea><label class="field-label" for="profile-backstory">Backstory / alternate universe</label><textarea class="field-input" id="profile-backstory" maxlength="3000" placeholder="Where does your version of this character’s story begin?">${escape(self.backstory || '')}</textarea><label class="field-label" for="profile-boundaries">Writer boundaries · OOC</label><textarea class="field-input" id="profile-boundaries" maxlength="1000" placeholder="What should scene partners check with you about first?">${escape(self.boundaries || '')}</textarea><div class="form-error" id="profile-error" role="alert"></div><div class="form-footer"><small>Character identity, separate from real life.</small><button class="button button-primary" type="submit" id="profile-submit">Save character</button></div></form>`);
    let portrait = self.portrait || '';
    let portraitLoad = 0;
    let portraitInvalid = false;
    const revision = modalRevision;
    const error = document.getElementById('profile-error');
    const submit = document.getElementById('profile-submit');
    document.getElementById('profile-portrait').onchange = async (event) => {
      const file = event.target.files[0];
      const load = ++portraitLoad;
      error.textContent = '';
      portraitInvalid = false;
      submit.disabled = false;
      if (!file) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { error.textContent = 'Choose a JPEG, PNG, or WebP avatar smaller than 10 MB, or select Use initials.'; portraitInvalid = true; return; }
      submit.disabled = true;
      try {
        const image = await resizePhoto(file, 400);
        if (!modal.open || revision !== modalRevision || load !== portraitLoad) return;
        portrait = image;
        document.getElementById('portrait-preview').innerHTML = avatar({ ...person('self'), portrait });
      } catch { if (load === portraitLoad) { portraitInvalid = true; error.textContent = 'That avatar could not be opened. Choose another or select Use initials.'; } }
      finally { if (revision === modalRevision && load === portraitLoad) submit.disabled = false; }
    };
    document.getElementById('remove-portrait').onclick = () => {
      portraitLoad += 1;
      portrait = '';
      portraitInvalid = false;
      submit.disabled = false;
      error.textContent = '';
      document.getElementById('profile-portrait').value = '';
      document.getElementById('portrait-preview').innerHTML = avatar({ ...person('self'), portrait: '' });
    };
    document.getElementById('profile-form').onsubmit = async (event) => {
      event.preventDefault();
      const name = document.getElementById('profile-name').value.trim();
      const bio = document.getElementById('profile-bio').value.trim();
      if (!name) { error.textContent = 'Enter your character’s name.'; return; }
      if (portraitInvalid || submit.disabled) { error.textContent = 'Choose a valid avatar or select Use initials.'; return; }
      const fandom = document.getElementById('profile-fandom').value;
      const role = document.getElementById('profile-role').value.trim();
      const pronouns = document.getElementById('profile-pronouns').value.trim();
      const location = document.getElementById('profile-location')?.value.trim() || '';
      const backstory = document.getElementById('profile-backstory').value.trim();
      const boundaries = document.getElementById('profile-boundaries').value.trim();
      if (await commit(() => { state.profile = { ...state.profile, name, bio, fandom, role, pronouns, location, backstory, boundaries, portrait }; })) { modal.close(); render(); toast(isPersonal()?'Personal profile saved.':'Character saved. Your next chapter is ready.'); }
    };
  }

  function showPerson(id) {
    if (id === 'self') { navigate('profile'); return; }
    const who = person(id);
    if (!who) return;
    navigate('profile'); viewedProfile=id; renderProfile();
  }

  document.addEventListener('click', async (event) => {
    if (saving || accounts.busy) return;
    const button = event.target.closest('button');
    if (!button) return;
    if(button.dataset.collection){profileCollection=button.dataset.collection;renderProfile();return;}
    if(button.dataset.layout){profileLayout=button.dataset.layout;renderProfile();return;}
    if (button.dataset.view) { navigate(button.dataset.view); return; }
    if (button.dataset.person) { showPerson(button.dataset.person); return; }
    if (button.dataset.filter) { filter = button.dataset.filter; personFilter = null; renderFeed(); return; }
    const action = button.dataset.action;
    const id = button.dataset.id;
    const post = state.posts.find((item) => item.id === id);
    if(action==='message-person'){navigate('messages');window.KinMessages.startWith(id);return;}
    if(action==='profile-posts'){navigate('feed');personFilter=id;renderFeed();return;}
    if(action==='open-post'){const author=post?.author;navigate('feed');personFilter=author||'self';renderFeed();Array.from(content.querySelectorAll('.post')).find(post=>post.dataset.post===id)?.scrollIntoView({block:'center'});return;}
    if (action === 'create') createPost();
    else if (action === 'invite') invite();
    else if (action === 'edit-profile') editProfile();
    else if (action === 'logout') { try { await accounts.logout(); } catch(error) { toast(error.message); } }
    else if (action === 'refresh') { try { await accounts.refresh(); toast('Your feed is up to date.'); } catch(error) { toast(error.message); } }
    else if (action === 'cancel-request') { try { await accounts.act('remove',{id}); toast('Request canceled.'); } catch(error) { toast(error.message); } }
    else if (action === 'filter-person') { personFilter = personFilter === id ? null : id; filter = 'all'; fandomFilter = 'all'; renderFeed(); }
    else if (action === 'clear-person') { personFilter = null; renderFeed(); }
    else if (action === 'like' && post) { if (await commit(() => { post.liked = !post.liked; })) render(); }
    else if (action === 'save' && post) { if (await commit(() => { post.saved = !post.saved; })) { render(); toast(post.saved ? 'Added to your saved posts.' : 'Removed from saved posts.'); } }
    else if (action === 'comments' && post) {
      if (openComments.has(id)) openComments.delete(id); else openComments.add(id);
      render();
      if (openComments.has(id)) Array.from(document.querySelectorAll('[data-comment-form]')).find((form) => form.dataset.commentForm === id)?.querySelector('input').focus({ preventScroll: true });
    }
    else if (action === 'accept' || action === 'decline') {
      const request = state.requests.find((item) => item.id === id);
      if (!request) return;
      if (await commit(() => { if (action === 'accept') state.people.push(request); state.requests = state.requests.filter((item) => item.id !== id); })) { render(); toast(action === 'accept' ? `${request.name.split(' ')[0]} is in your ${accounts.active ? 'cast' : 'demo circle'}.` : 'Request declined.'); }
    }
    else if (action === 'cancel-invite') { if (await commit(() => { state.invitations = state.invitations.filter((item) => item.id !== id); })) render(); }
    else if (action === 'remove-person' && person(id)) confirmAction('Remove this connection?', `${person(id).name} will leave your ${accounts.active ? 'cast' : 'demo circle'}. You will lose access to each other’s posts and photos.`, 'Remove connection', () => commit(() => { state.people = state.people.filter((item) => item.id !== id); }));
    else if (action === 'delete' && post?.author === 'self') confirmAction('Delete this post?', accounts.active ? 'This removes the post and its replies from Kin. Export your writing first if you would like a copy.' : 'This removes the post, any photo, and its replies from this browser. Export first to keep a copy.', 'Delete post', () => commit(() => { state.posts = state.posts.filter((item) => item.id !== id); }));
    else if (action === 'reset' && !accounts.active) confirmAction('Start fresh?', 'This deletes your local posts, comments, profile edits, and saved posts, then restores the sample roleplay data. Export first to keep a copy.', 'Reset demo', async () => { const success = await commit(() => { state = seed(); }); if (success) { personFilter = null; fandomFilter = 'all'; filter = 'all'; openComments.clear(); toast('A fresh start. Sample stories restored.'); } return success; });
    else if (action === 'export') {
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), prototype: !accounts.active, ...state }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `kin-roleplay-${new Date().toISOString().slice(0, 10)}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Your data export is ready to download.');
    }
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-comment-form]');
    if (!form) return;
    event.preventDefault();
    const post = state.posts.find((item) => item.id === form.dataset.commentForm);
    const text = form.elements.comment.value.trim();
    if (!post || !text) return;
    const mode = form.elements.mode.value === 'ooc' ? 'ooc' : 'ic';
    if (await commit(() => post.comments.push({ name: state.profile.name, mode, text }))) render();
  });
  document.addEventListener('change', async (event) => {
    if(event.target.id==='profile-switch'){const select=event.target;select.disabled=true;try{await accounts.switchProfile(select.value);window.scrollTo({top:0});toast(isPersonal()?'Switched to your personal profile.':'Switched to your roleplay profile.');}catch(error){select.value=state.profileKind;toast(error.message);}finally{select.disabled=false;}return;}
    if (event.target.id === 'fandom-filter') { fandomFilter = event.target.value; personFilter = null; renderFeed(); return; }
    const id = event.target.dataset.group;
    if (!id) return;
    const who = person(id);
    const group = event.target.value;
    if (who && ['cast', 'partners'].includes(group)) { if (await commit(() => { who.group = group; })) render(); }
  });
  document.addEventListener('input', (event) => {
    if (event.target.id === 'people-search') { search = event.target.value; document.getElementById('people-list').innerHTML = peopleRows(state.people.filter((who) => who.name.toLowerCase().includes(search.toLowerCase()))); }
  });
  document.getElementById('close-modal').onclick = () => modal.close();
  modal.addEventListener('click', (event) => {
    if (event.target !== modal) return;
    const rect = modal.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) modal.close();
  });
  document.querySelector('.brand').addEventListener('click', (event) => { event.preventDefault(); navigate('feed'); });
  window.addEventListener('storage', (event) => { if (event.key === KEY) toast('This demo changed in another tab. Refresh before making more changes.'); });
  content.addEventListener('error', (event) => {
    if (event.target.tagName === 'IMG' && event.target.classList.contains('post-image')) {
      const replacement = document.createElement('div');
      replacement.className = 'empty-state'; replacement.style.cssText = 'height:100%;display:grid;place-content:center;border:0;border-radius:0;background:#ede8dc';
      replacement.innerHTML = `${svg('image')}<p>Sample photo unavailable.<br>The story is still here.</p>`;
      event.target.replaceWith(replacement);
    }
  }, true);
  modal.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  accounts.boot({
    onDemo() { render(); },
    onState(next) { window.KinCalls.sync(next); viewedProfile='self'; profileCollection='all'; state = next; view = 'feed'; filter = 'all'; personFilter = null; fandomFilter = 'all'; openComments.clear(); render(); },
    onRefresh(next) { window.KinCalls.sync(next); state = next; render(); },
    onLock() { window.KinCalls.close(); window.KinMessages.close(); state = {version:1,profile:{name:'Your character',fandom:'Original / Other'},people:[],posts:[],requests:[],outgoing:[],invitations:[]}; openComments.clear(); },
    isBusy() { return saving || window.KinMessages.busy || window.KinCalls.busy; }
  });
  if (!storageAvailable) toast('Saved data couldn’t be loaded. You can explore the sample feed; changes may not persist.');
})();
