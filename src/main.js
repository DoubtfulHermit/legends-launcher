// Legends Awakened launcher — frontend wiring (vanilla, withGlobalTauri).
// Runs in the Tauri WebView (real backend) and in a plain browser (mock data, so
// the redesign stays previewable). All visuals are in index.html + styles.css.

// ── Tauri bridge ─────────────────────────────────────────────────────────────
const TAURI = window.__TAURI__ || {};
const HAS_TAURI = !!(TAURI.core && TAURI.core.invoke);
const getWin = () => (TAURI.window && TAURI.window.getCurrentWindow) ? TAURI.window.getCurrentWindow() : null;
// Browser-preview fallbacks so the page renders without a backend.
const FALLBACK = {
  load: { found:true, game_dir:'(preview)', version:'1.12', native:[1920,1080],
    cloned:true, needs_clone:false, original_dir:'(preview)',
    resolutions:[[1024,768],[1280,960],[1440,1080],[1600,1200],[1920,1440]],
    hd_available:true, gamescope_available:false, proton_available:true,
    settings:{ host:'', room:'', queue:4, fullscreen:true, width:1440, height:1080,
               hd_textures:false, gamescope:false, gamescope_args:'', skip_menu:false, proton:false } },
  status: { reachable:true, gateway:true, database:true, game_server:true, players:27 },
  gw_login: { ok:true, screen_name:null }, gw_ticket: { ok:false }, gw_ticket_session: { ok:false },
  check_updates: { ok:true }, sync: { ok:true, updated:[], failed:[] },
  session_login: { ok:true, token:'demo-token' }, session_ping: { ok:true }, session_logout: { ok:true },
  // Rich demo bundle so the social panel is fully previewable in a plain browser (no Tauri).
  friends_list: { ok:true, me:'Aang',
    friends:[
      {name:'KorraMain', nickname:'Korra', favorite:true,  state:'in-game', last_seen:Date.now()/1000-20,    since:1718000000},
      {name:'BoulderKing',nickname:'',      favorite:true,  state:'online',  last_seen:Date.now()/1000-10,    since:1719500000},
      {name:'Zephyra',    nickname:'',      favorite:false, state:'online',  last_seen:Date.now()/1000-5,     since:1717000000},
      {name:'AshRider',   nickname:'',      favorite:false, state:'online',  last_seen:Date.now()/1000-40,    since:1720100000},
      {name:'TidebornNn', nickname:'Tide',  favorite:false, state:'away',    last_seen:Date.now()/1000-180,   since:1716000000},
      {name:'GaleStorm',  nickname:'',      favorite:false, state:'away',    last_seen:Date.now()/1000-240,   since:1721000000},
      {name:'Inferna',    nickname:'',      favorite:false, state:'offline', last_seen:Date.now()/1000-7200,  since:1715000000},
      {name:'TerraNova',  nickname:'',      favorite:false, state:'offline', last_seen:Date.now()/1000-90000, since:1714000000},
      {name:'FrostByte',  nickname:'',      favorite:false, state:'offline', last_seen:Date.now()/1000-400000,since:1722000000},
    ],
    incoming:[{name:'SkyDancer'},{name:'GraniteFist'}],
    outgoing:[{name:'Zenith'}],
    invites:[{from:'BoulderKing', room_code:'p-a1b2c3', size:4, expires:Date.now()/1000+120}],
    blocked:[{name:'Spammer99'}],
    counts:{ online:6, total:9, requests:2, invites:1 } },
  friends_recent: { ok:true, recent:[{name:'Zenith'},{name:'TidebornNn'},{name:'GraniteFist'},{name:'SkyDancer'}] },
  friend_request: { ok:true }, friend_respond: { ok:true }, friend_remove: { ok:true },
  friend_cancel: { ok:true }, friend_block: { ok:true }, friend_unblock: { ok:true },
  friend_favorite: { ok:true }, friend_nickname: { ok:true },
  invite_send: { ok:true, room_code:'p-demo', size:2 }, invite_respond: { ok:true, room_code:'p-demo', size:2 },
};
const invoke = HAS_TAURI ? TAURI.core.invoke
  : async (cmd) => { return Object.prototype.hasOwnProperty.call(FALLBACK, cmd) ? FALLBACK[cmd] : null; };

const $ = (id) => document.getElementById(id);
const DEFAULT_SERVER = 'gw.legends-awakened.com';
const DOWNLOAD_URL = 'https://legends-awakened.com';

// ── persistent save — theme + remembered user + settings ─────────────────────
// localStorage works in both the preview and the Tauri WebView. The password is
// NEVER stored; only the username is remembered. On Tauri, game settings are
// reconciled from the backend `load` (the authoritative INIs/prefs) at boot.
const SAVE_KEY = 'la.save';
const SAVE_DEFAULTS = { element:'fire', session:null,
  board:{ mode:'overall', nation:'fire' },
  match:{ bot:'korra', diff:'medium', tsize:2 },
  settings:{
    queue:4, room:'', server:DEFAULT_SERVER, res:'1440x1080',
    hd:false, fullscreen:true, skip_menu:false, gamescope:false, gamescope_args:'', proton:false } };
function loadSave(){
  try{ const j = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    return { ...SAVE_DEFAULTS, ...j,
      board:{ ...SAVE_DEFAULTS.board, ...(j.board||{}) },
      match:{ ...SAVE_DEFAULTS.match, ...(j.match||{}) },
      settings:{ ...SAVE_DEFAULTS.settings, ...(j.settings||{}) } }; }
  catch{ return JSON.parse(JSON.stringify(SAVE_DEFAULTS)); }
}
let SAVE = loadSave();
function persist(){ try{ localStorage.setItem(SAVE_KEY, JSON.stringify(SAVE)); }catch{} }
// Persist settings to the DURABLE stores (the launcher conf + Config/arena) on every change — not just
// on PLAY — so toggles (Proton, gamescope, Fullscreen, skip-menus, server, room, resolution) stick and
// nobody has to keep re-flipping them. Debounced; localStorage updates immediately.
let _saveT=null;
function saveSettings(){ persist(); if(!HAS_TAURI) return; clearTimeout(_saveT);
  _saveT=setTimeout(()=>{ try{ invoke('save',{ settings: gather() }); }catch(_){} }, 300); }

// backend capability flags (from `load`)
let found = false, hdAvailable = false, gsAvailable = false, ptAvailable = false;
let needsClone = false, cloning = false;   // first-run patched-clone setup
let native = [0,0], resolutions = [], appVersion = '';
let sessionPass = '';   // in-memory only, for minting the seamless login ticket

// ── elemental particles — ported from the Legends Awakened site (canvas) ─────
const app = document.querySelector('.app');
const canvas = $('particles-canvas'), pctx = canvas.getContext('2d');
let particles = [], currentElement = 'fire'; const MAX_PARTICLES = 70;
// Cap the canvas BACKING-STORE resolution and let CSS stretch it to fill. WebKitGTK
// software-composites the 2D canvas (the DMABUF renderer is off for the grey-screen fix), so a
// maximised full-res canvas tanked the frame rate and the particles crawled. A ~720p buffer keeps
// fps up; the uniform CSS stretch preserves the visual pace (a particle still crosses the screen in
// the same wall-clock time) and keeps the aspect ratio (proportional shrink, no distortion).
function resizeCanvas(){
  const cw = Math.max(1, app.clientWidth), ch = Math.max(1, app.clientHeight);
  const scale = Math.min(1, 1280 / cw);   // only shrinks the buffer once the window exceeds 1280px
  canvas.width = Math.round(cw * scale);
  canvas.height = Math.round(ch * scale);
}
const spawners = {
  fire:()=>({x:Math.random()*canvas.width,y:canvas.height+10,size:Math.random()*3+1,speedY:-(Math.random()*0.4+0.15),speedX:(Math.random()-0.5)*0.3,opacity:Math.random()*0.5+0.2,life:1,decay:Math.random()*0.002+0.001,color:Math.random()<0.7?[25,90,60]:[0,0,40]}),
  water:()=>({x:Math.random()*canvas.width,y:canvas.height+10,size:Math.random()*4+1.5,speedY:-(Math.random()*0.5+0.25),sway:Math.random()*Math.PI*2,swaySpeed:Math.random()*0.03+0.01,swayAmp:Math.random()*0.8+0.3,opacity:Math.random()*0.4+0.15,life:1,decay:Math.random()*0.002+0.001,color:[210,90,65],bubble:true}),
  earth:()=>({x:Math.random()*canvas.width,y:-10,size:Math.random()*2.5+1,speedY:Math.random()*0.25+0.08,speedX:(Math.random()-0.5)*0.2,rotation:Math.random()*Math.PI,rotationSpeed:(Math.random()-0.5)*0.02,opacity:Math.random()*0.4+0.15,life:1,decay:Math.random()*0.0015+0.0008,color:Math.random()<0.6?[78,50,50]:[40,40,45],mote:true}),
  air:()=>({x:-20,y:Math.random()*canvas.height,size:Math.random()*1.5+0.5,length:Math.random()*40+15,speedX:Math.random()*1.4+0.6,speedY:(Math.random()-0.5)*0.15,opacity:Math.random()*0.3+0.08,life:1,decay:Math.random()*0.002+0.001,color:[168,30,85],wisp:true})
};
function createParticle(){ return (spawners[currentElement]||spawners.fire)(); }
function initParticles(){ particles.length=0; for(let i=0;i<MAX_PARTICLES;i++){ const p=createParticle(); p.x=Math.random()*canvas.width; p.y=Math.random()*canvas.height; p.life=Math.random(); particles.push(p);} }
function drawParticles(){
  pctx.clearRect(0,0,canvas.width,canvas.height);
  for(let i=particles.length-1;i>=0;i--){ const p=particles[i];
    p.y+=p.speedY||0; p.life-=p.decay;
    if(p.sway!==undefined){ p.sway+=p.swaySpeed; p.x+=Math.sin(p.sway)*p.swayAmp; } else { p.x+=p.speedX||0; }
    if(p.rotation!==undefined) p.rotation+=p.rotationSpeed;
    if(p.life<=0||p.y<-30||p.y>canvas.height+30||p.x<-80||p.x>canvas.width+80){ particles[i]=createParticle(); continue; }
    const al=p.opacity*p.life, fill='hsla('+p.color[0]+','+p.color[1]+'%,'+p.color[2]+'%,'+al+')';
    if(p.wisp){ pctx.beginPath(); pctx.moveTo(p.x,p.y); pctx.lineTo(p.x-p.length,p.y-p.speedY*p.length); pctx.strokeStyle=fill; pctx.lineWidth=p.size; pctx.stroke(); }
    else if(p.bubble){ pctx.beginPath(); pctx.arc(p.x,p.y,p.size,0,Math.PI*2); pctx.strokeStyle=fill; pctx.lineWidth=1; pctx.stroke(); }
    else if(p.mote){ pctx.save(); pctx.translate(p.x,p.y); pctx.rotate(p.rotation); pctx.fillStyle=fill; pctx.fillRect(-p.size,-p.size,p.size*2,p.size*2); pctx.restore(); }
    else { pctx.beginPath(); pctx.arc(p.x,p.y,p.size,0,Math.PI*2); pctx.fillStyle=fill; pctx.fill(); }
  }
}
let rafId = null;
function particleLoop(){ drawParticles(); rafId = requestAnimationFrame(particleLoop); }
function startParticles(){ if(rafId == null) rafId = requestAnimationFrame(particleLoop); }
function stopParticles(){ if(rafId != null){ cancelAnimationFrame(rafId); rafId = null; } }
// pause the canvas when the window is minimised/hidden — don't burn GPU off-screen
document.addEventListener('visibilitychange', ()=>{ document.hidden ? stopParticles() : startParticles(); });
resizeCanvas(); window.addEventListener('resize', resizeCanvas);

// ── theme (element) ──────────────────────────────────────────────────────────
const emblemUse = document.querySelector('.emblem use');
function setElement(el){
  app.setAttribute('data-el', el);
  emblemUse.setAttribute('href', '#el-'+el);
  document.querySelector('#login .mark use')?.setAttribute('href','#el-'+el);
  document.querySelectorAll('.elements .el').forEach(s=>
    s.classList.toggle('on', /el-(\w+)/.exec(s.getAttribute('class'))[1]===el));
  currentElement=el; initParticles();
  SAVE.element=el; persist();
}
document.querySelectorAll('.elements .el').forEach(s=>{
  const el=/el-(\w+)/.exec(s.getAttribute('class'))[1];
  s.addEventListener('click', ()=>setElement(el));
});

// ── toast ────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, kind){
  const t=$('toast'); t.textContent=msg; t.className='toast show '+(kind||'');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>{ t.className='toast'; }, 4200);
}

// ── account chip + dropdown ──────────────────────────────────────────────────
const acct=$('acct'), acctMenu=$('acctMenu');
function showChip(name){
  document.querySelector('.acct .nm').textContent = name || 'Sign in';
  document.querySelector('.acct .av').textContent = (name ? name[0] : '?').toUpperCase();
}
acct.addEventListener('click', e=>{
  e.stopPropagation();
  const s=SAVE.session;
  $('amName').textContent = s ? s.name : 'Guest';
  $('amServer').textContent = s ? s.server : '';
  acctMenu.classList.toggle('open');
});
document.addEventListener('click', ()=>acctMenu.classList.remove('open'));
acctMenu.addEventListener('click', e=>e.stopPropagation());

// ── login gate ───────────────────────────────────────────────────────────────
const loginEl=$('login');
async function signIn(){
  const u=$('liUser').value.trim();
  const server=$('liServer').value.trim()||DEFAULT_SERVER;
  const pass=$('liPass').value;
  const err=$('liErr');
  if(!u){ err.textContent='Enter a username.'; $('liUser').focus(); return; }
  const btn=$('liGo'); btn.disabled=true; btn.textContent='…';
  try{
    const r=await invoke('gw_login',{ host:server, username:u, password:pass });
    if(r && r.ok){
      const name = r.screen_name || u;
      SAVE.session={ name, server }; SAVE.settings.server=server; persist();
      sessionPass = pass;                 // memory only — for the PLAY ticket
      err.textContent=''; showChip(name);
      loginEl.classList.add('hide');
      $('liPass').value='';
      toast('Signed in as '+name, 'ok');
      // open a social session (bearer token) for friends + presence — best-effort
      try{ const s=await invoke('session_login',{ host:server, username:name, password:pass });
        if(s && s.ok && s.token){ SAVE.session.token=s.token; persist(); } }catch{}
      startPresence(); loadFriends();
    } else {
      err.textContent=(r && r.error) || 'Login failed.';
    }
  }catch(e){ err.textContent=String(e); }
  btn.disabled=false; btn.innerHTML='SIGN IN &#9658;';
}
function signOut(){
  if(SAVE.session && SAVE.session.token)
    invoke('session_logout',{ host:SAVE.settings.server, token:SAVE.session.token }).catch(()=>{});
  SAVE.session=null; sessionPass=''; persist();
  $('liPass').value=''; $('liErr').textContent='';
  showChip(null); acctMenu.classList.remove('open');
  loginEl.classList.remove('hide'); $('liUser').focus();
  loadFriends();   // clear the panel → sign-in prompt
}
$('liGo').addEventListener('click', signIn);

// ── friends + presence (social) ─────────────────────────────────────────────
const _tok = () => (SAVE.session && SAVE.session.token) || null;
const _srv = () => SAVE.settings.server;
let presenceTimer = null;
function startPresence(){
  if(presenceTimer) return;
  const ping = () => { const t=_tok(); if(t && !document.hidden)
    invoke('session_ping',{ host:_srv(), token:t, status:_status }).catch(()=>{}); };
  ping(); presenceTimer = setInterval(ping, 30000);
}
// thin invoke that injects host + token and swallows transport errors (null on signed-out/fail)
async function sx(cmd, extra){ const t=_tok(); if(!t) return null;
  try{ return await invoke(cmd, { host:_srv(), token:t, ...(extra||{}) }); }catch{ return null; } }

// ── social state ──
let frTab = 'friends';
let frData = { me:'', friends:[], incoming:[], outgoing:[], invites:[], blocked:[], counts:{} };
let frSearch = '';
let frRecent = [];

// ── presentation helpers ──
const esc = s => String(s==null?'':s);
function initials(n){ n=esc(n).trim(); return (n[0]||'?').toUpperCase(); }
// deterministic per-name hue so avatars are distinct but stay in the dark, muted theme
function nameHue(n){ let h=0; n=esc(n); for(let i=0;i<n.length;i++) h=(h*31 + n.charCodeAt(i))>>>0; return h%360; }
function avatarHTML(name, big){
  const h=nameHue(name), sz=big?'fr-av big':'fr-av';
  return `<span class="${sz}" style="--ah:${h}">${initials(name)}</span>`;
}
function relTime(sec){
  if(!sec) return '';
  const d=Math.max(0, Date.now()/1000 - Number(sec));
  if(d<60) return 'just now';
  if(d<3600) return Math.floor(d/60)+'m ago';
  if(d<86400) return Math.floor(d/3600)+'h ago';
  return Math.floor(d/86400)+'d ago';
}
const STATE_WORD = { 'in-game':'In a match', online:'Online', away:'Away', offline:'Offline' };
function statusText(f){
  if(f.state==='offline') return f.last_seen ? ('Last seen '+relTime(f.last_seen)) : 'Offline';
  return STATE_WORD[f.state] || 'Offline';
}
const dispName = f => (f.nickname || f.name);

// ── change notifications (toast new incoming requests + new invites between polls) ──
let _frPrimed=false, _seenInc=new Set(), _seenInv=new Set();
function _resetNotify(){ _frPrimed=false; _seenInc=new Set(); _seenInv=new Set(); }
function _notify(d){
  const inc=(d.incoming||[]).map(f=>f.name), inv=(d.invites||[]).map(i=>i.from);
  if(_frPrimed){
    for(const n of inc) if(!_seenInc.has(n)){ toast(n+' wants to be your friend','ok'); osNotify('Friend request', n+' wants to be your friend'); }
    for(const n of inv) if(!_seenInv.has(n)){ toast(n+' invited you to a match','ok'); osNotify('Match invite', n+' invited you to a match'); }
  }
  _seenInc=new Set(inc); _seenInv=new Set(inv); _frPrimed=true;
}
// OS notification — only when the launcher is unfocused/minimised (don't double-noise on-screen toasts)
function osNotify(title, body){ if(HAS_TAURI && document.hidden) invoke('os_notify',{ title, body }).catch(()=>{}); }

// ── signed-out / unreachable empty state ──
function _hideShell(hide){
  for(const id of ['frTabs','frSearch','frInvites','frList']) $(id).hidden = hide && id!=='frList';
  if(hide){ $('frList').innerHTML=''; $('frInvites').innerHTML=''; }
}
function frShowEmpty(){
  const signedIn = !!(SAVE.session && SAVE.session.name);
  closeMenus(); _hideShell(true);
  $('frCount').textContent=''; $('frAdd').hidden=true; $('frAddToggle').hidden=true; $('frSearch').hidden=true;
  const el=$('frEmpty');
  if(signedIn){
    el.innerHTML='Couldn’t reach the social server. <a href="#" id="frRetry">Retry</a>';
    const rt=$('frRetry'); if(rt) rt.onclick=e=>{ e.preventDefault(); retrySocial(); };
  } else { el.textContent='Sign in to add friends and see who’s online.'; }
  el.hidden=false;
}
async function retrySocial(){
  if(!(SAVE.session && SAVE.session.name)) return;
  if(!sessionPass){ toast('Sign out and back in to reconnect.','err'); return; }
  try{ const s=await invoke('session_login',{ host:_srv(), username:SAVE.session.name, password:sessionPass });
    if(s && s.ok && s.token){ SAVE.session.token=s.token; persist(); startPresence(); loadFriends(); toast('Reconnected.','ok'); return; }
  }catch{}
  toast('Still can’t reach the social server.','err');
}

// ── load + render ──
async function loadFriends(){
  if(!_tok()){ frShowEmpty(); _resetNotify(); return; }
  $('frEmpty').hidden=true; $('frAddToggle').hidden=false; _hideShell(false);
  let r; try{ r = await invoke('friends_list',{ host:_srv(), token:_tok() }); }catch{ return; }
  if(!r || !r.ok){
    if(r && /signed in/.test(r.error||'')){ SAVE.session.token=null; persist(); frShowEmpty(); _resetNotify(); }
    return;
  }
  frData = { me:r.me||'', friends:r.friends||[], incoming:r.incoming||[], outgoing:r.outgoing||[],
             invites:r.invites||[], blocked:r.blocked||[], counts:r.counts||{} };
  _notify(frData);
  renderSocial();
}
function setTab(t){ frTab=t; closeMenus();
  document.querySelectorAll('#frTabs button').forEach(b=>b.classList.toggle('on', b.dataset.tab===t));
  $('frSearch').hidden = (t!=='friends') || frData.friends.length<6;
  renderSocial();
}
function renderSocial(){
  const c=frData.counts||{};
  $('frCount').textContent = frData.friends.length ? `${c.online||0}/${frData.friends.length} online` : '';
  const badge=$('frReqBadge'); const nreq=(frData.incoming||[]).length;
  badge.textContent=nreq; badge.hidden=!nreq;
  renderInvites();
  if(frTab==='friends') renderFriendsTab();
  else if(frTab==='requests') renderRequestsTab();
  else renderBlockedTab();
}

// game invites — a prominent strip above whichever tab is open
function renderInvites(){
  const host=$('frInvites'); host.innerHTML='';
  for(const iv of (frData.invites||[])){
    const el=document.createElement('div'); el.className='fr-invite';
    el.innerHTML = avatarHTML(iv.from) +
      `<div class="meta"><b></b><small>invites you · ${iv.size||2}-player</small></div>`+
      `<button class="ok" title="Accept">Join</button><button class="no" title="Decline">✕</button>`;
    el.querySelector('b').textContent=iv.from;
    el.querySelector('.ok').onclick=()=>acceptInvite(iv);
    el.querySelector('.no').onclick=()=>declineInvite(iv);
    host.appendChild(el);
  }
}

function matches(f){ if(!frSearch) return true;
  const q=frSearch.toLowerCase(); return f.name.toLowerCase().includes(q) || (f.nickname||'').toLowerCase().includes(q); }

const GROUPS = [
  ['fav','Favorites', f=>f.favorite],
  ['in-game','In a match', f=>!f.favorite && f.state==='in-game'],
  ['online','Online', f=>!f.favorite && f.state==='online'],
  ['away','Away', f=>!f.favorite && f.state==='away'],
  ['offline','Offline', f=>!f.favorite && f.state==='offline'],
];
function renderFriendsTab(){
  const list=$('frList'); list.innerHTML='';
  const all=(frData.friends||[]).filter(matches);
  if(!all.length){
    list.innerHTML = frData.friends.length
      ? '<div class="fr-empty">No friends match your search.</div>'
      : '<div class="fr-empty">No friends yet — hit <b>+ Add</b> to find someone by name.</div>';
    return;
  }
  for(const [key,label,pred] of GROUPS){
    const grp=all.filter(pred); if(!grp.length) continue;
    const head=document.createElement('div'); head.className='fr-grp';
    head.innerHTML=`<span>${label}</span><i>${grp.length}</i>`; list.appendChild(head);
    for(const f of grp) list.appendChild(friendRow(f));
  }
}
function friendRow(f){
  const row=document.createElement('div'); row.className='fr-row '+(f.state||'offline');
  row.innerHTML =
    avatarHTML(f.name) +
    `<span class="dot" title="${STATE_WORD[f.state]||'Offline'}"></span>`+
    `<div class="meta"><b class="nm"></b><span class="st"></span></div>`+
    `<div class="acts">`+
      `<button class="fr-act inv" title="Invite to a match">⚔</button>`+
      `<button class="fr-act more" title="More">⋯</button>`+
    `</div>`+
    (f.favorite?'<span class="favstar" title="Favorite">★</span>':'');
  row.querySelector('.nm').textContent = dispName(f);
  if(f.nickname){ const b=document.createElement('small'); b.className='real'; b.textContent='('+f.name+')'; row.querySelector('.nm').appendChild(b); }
  row.querySelector('.st').textContent = statusText(f);
  row.querySelector('.inv').onclick = e=>{ e.stopPropagation(); inviteFriend(f); };
  row.querySelector('.more').onclick = e=>{ e.stopPropagation(); openMenu(f, e.currentTarget); };
  row.onclick = ()=>openProfile(f);
  row.oncontextmenu = e=>{ e.preventDefault(); openMenu(f, row); };
  return row;
}

function renderRequestsTab(){
  const list=$('frList'); list.innerHTML='';
  const inc=frData.incoming||[], out=frData.outgoing||[];
  if(!inc.length && !out.length){ list.innerHTML='<div class="fr-empty">No pending requests.</div>'; return; }
  if(inc.length){
    const h=document.createElement('div'); h.className='fr-grp'; h.innerHTML=`<span>Wants to be friends</span><i>${inc.length}</i>`; list.appendChild(h);
    for(const f of inc){
      const row=document.createElement('div'); row.className='fr-req';
      row.innerHTML = avatarHTML(f.name) + '<span class="nm"></span>'+
        '<button class="yes" title="Accept">✓</button><button class="no" title="Decline">✕</button>';
      row.querySelector('.nm').textContent=f.name;
      row.querySelector('.yes').onclick=()=>respondFriend(f.name,true);
      row.querySelector('.no').onclick=()=>respondFriend(f.name,false);
      list.appendChild(row);
    }
  }
  if(out.length){
    const h=document.createElement('div'); h.className='fr-grp'; h.innerHTML=`<span>Sent</span><i>${out.length}</i>`; list.appendChild(h);
    for(const f of out){
      const row=document.createElement('div'); row.className='fr-req out';
      row.innerHTML = avatarHTML(f.name) + '<span class="nm"></span><span class="tag">pending</span>'+
        '<button class="no" title="Cancel">✕</button>';
      row.querySelector('.nm').textContent=f.name;
      row.querySelector('.no').onclick=()=>cancelRequest(f.name);
      list.appendChild(row);
    }
  }
}

function renderBlockedTab(){
  const list=$('frList'); list.innerHTML='';
  const bl=frData.blocked||[];
  if(!bl.length){ list.innerHTML='<div class="fr-empty">You haven’t blocked anyone.</div>'; return; }
  for(const f of bl){
    const row=document.createElement('div'); row.className='fr-req blocked';
    row.innerHTML = avatarHTML(f.name) + '<span class="nm"></span><button class="unb">Unblock</button>';
    row.querySelector('.nm').textContent=f.name;
    row.querySelector('.unb').onclick=()=>unblock(f.name);
    list.appendChild(row);
  }
}

// ── floating layers: context menu + profile popover (built once, appended to body) ──
let _menu=null, _profile=null;
function _ensureLayers(){
  if(_menu) return;
  _menu=document.createElement('div'); _menu.className='fr-menu'; _menu.hidden=true; document.body.appendChild(_menu);
  _profile=document.createElement('div'); _profile.className='fr-profile'; _profile.hidden=true; document.body.appendChild(_profile);
  document.addEventListener('click', e=>{ if(_menu && !_menu.contains(e.target)) _menu.hidden=true;
    if(_profile && !_profile.contains(e.target) && !e.target.closest('.fr-row')) _profile.hidden=true; });
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeMenus(); });
}
function closeMenus(){ if(_menu) _menu.hidden=true; if(_profile) _profile.hidden=true; }
function _place(el, anchor){
  el.hidden=false;
  const r=anchor.getBoundingClientRect(), w=el.offsetWidth, h=el.offsetHeight;
  let x=Math.min(r.left, window.innerWidth-w-8);
  let y=r.bottom+6; if(y+h>window.innerHeight-8) y=Math.max(8, r.top-h-6);
  el.style.left=Math.max(8,x)+'px'; el.style.top=y+'px';
}
function openMenu(f, anchor){
  _ensureLayers(); _profile.hidden=true;
  const items=[
    ['⚔','Invite to a match', ()=>inviteFriend(f)],
    ['🎉','Invite to party', ()=>partyInvite(f.name)],
    [f.favorite?'★':'☆', f.favorite?'Remove favorite':'Add favorite', ()=>toggleFav(f)],
    ['✎','Set nickname', ()=>openNickname(f)],
    ['👤','View profile', ()=>openProfile(f)],
    ['—',null,null],
    ['✕','Remove friend', ()=>removeFriend(f.name), 'danger'],
    ['⊘','Block', ()=>blockFriend(f.name), 'danger'],
  ];
  _menu.innerHTML='';
  for(const [ic,label,fn,cls] of items){
    if(label===null){ const sep=document.createElement('div'); sep.className='sep'; _menu.appendChild(sep); continue; }
    const b=document.createElement('button'); if(cls) b.className=cls;
    b.innerHTML=`<i>${ic}</i><span></span>`; b.querySelector('span').textContent=label;
    b.onclick=()=>{ _menu.hidden=true; fn(); }; _menu.appendChild(b);
  }
  _place(_menu, anchor);
}
function openProfile(f){
  _ensureLayers(); _menu.hidden=true;
  const p=_profile;
  p.innerHTML =
    `<div class="ph">${avatarHTML(f.name,true)}<div class="pid"><b></b><span class="pstate ${f.state}"></span></div></div>`+
    `<div class="prows"></div>`+
    `<div class="pacts">`+
      `<button class="pa inv">⚔ Invite</button>`+
      `<button class="pa fav">${f.favorite?'★ Favorited':'☆ Favorite'}</button>`+
      `<button class="pa nick">✎ Nickname</button>`+
    `</div>`+
    `<div class="pacts2"><button class="pa rem">Remove</button><button class="pa blk">Block</button></div>`;
  p.querySelector('.pid b').textContent = dispName(f) + (f.nickname?` (${f.name})`:'');
  const ps=p.querySelector('.pstate'); ps.textContent=statusText(f);
  const rows=p.querySelector('.prows'); rows.innerHTML='';
  const addr=(k,v)=>{ const d=document.createElement('div'); d.className='prow'; d.innerHTML=`<span>${k}</span><b></b>`; d.querySelector('b').textContent=v; rows.appendChild(d); };
  addr('Status', STATE_WORD[f.state]||'Offline');
  if(f.last_seen) addr('Last seen', relTime(f.last_seen));
  if(f.since) addr('Friends since', new Date(Number(f.since)*1000).toLocaleDateString());
  _fillCareer(p, f.name);                         // async: append W/L · K/D · streak + recent matches
  p.querySelector('.inv').onclick=()=>{ closeMenus(); inviteFriend(f); };
  p.querySelector('.fav').onclick=()=>{ toggleFav(f); };
  p.querySelector('.nick').onclick=()=>{ openNickname(f); };
  p.querySelector('.rem').onclick=()=>{ closeMenus(); removeFriend(f.name); };
  p.querySelector('.blk').onclick=()=>{ closeMenus(); blockFriend(f.name); };
  if(f.self){ const a=p.querySelector('.pacts'), b=p.querySelector('.pacts2'); if(a)a.remove(); if(b)b.remove(); }
  // center it within the friends panel
  const host=$('friends').getBoundingClientRect();
  p.hidden=false;
  p.style.left=Math.max(8, host.left+(host.width-p.offsetWidth)/2)+'px';
  p.style.top=Math.max(8, host.top+40)+'px';
}
function openNickname(f){
  _ensureLayers();
  const cur=f.nickname||'';
  _menu.innerHTML=`<div class="nick-edit"><input maxlength="24" placeholder="nickname" value=""><button>Save</button></div>`;
  const inp=_menu.querySelector('input'); inp.value=cur;
  const save=()=>{ _menu.hidden=true; setNickname(f.name, inp.value.trim()); };
  _menu.querySelector('button').onclick=save;
  inp.onkeydown=e=>{ if(e.key==='Enter') save(); else if(e.key==='Escape') _menu.hidden=true; };
  const host=$('friends').getBoundingClientRect(); _menu.hidden=false;
  _menu.style.left=Math.max(8, host.left+20)+'px'; _menu.style.top=(host.top+80)+'px';
  setTimeout(()=>inp.focus(), 0);
}

// ── actions ──
async function addFriend(){
  const name=$('frAddName').value.trim(); if(!name) return;
  const r=await sx('friend_request',{ to:name });
  if(r && r.ok){ $('frAddName').value=''; toast(r.accepted? (name+' is now your friend') : ('Friend request sent to '+name),'ok'); loadFriends(); loadRecent(); }
  else toast((r && r.error) || 'Could not send request.','err');
}
async function respondFriend(from, accept){
  const r=await sx('friend_respond',{ from, accept });
  if(r && r.ok){ toast(accept?(from+' is now your friend'):'Request declined', accept?'ok':'ok'); loadFriends(); }
  else toast((r && r.error) || 'Failed.','err');
}
async function cancelRequest(to){ const r=await sx('friend_cancel',{ to }); if(r && r.ok) loadFriends(); else toast((r&&r.error)||'Failed.','err'); }
async function removeFriend(who){ const r=await sx('friend_remove',{ who }); if(r && r.ok){ closeMenus(); toast('Removed '+who,'ok'); loadFriends(); } }
async function blockFriend(who){ const r=await sx('friend_block',{ who }); if(r && r.ok){ closeMenus(); toast('Blocked '+who,'ok'); loadFriends(); } else toast((r&&r.error)||'Failed.','err'); }
async function unblock(who){ const r=await sx('friend_unblock',{ who }); if(r && r.ok){ toast('Unblocked '+who,'ok'); loadFriends(); } }
async function toggleFav(f){ const on=!f.favorite; const r=await sx('friend_favorite',{ who:f.name, on });
  if(r && r.ok){ f.favorite=on; loadFriends(); } }
async function setNickname(who, nickname){ const r=await sx('friend_nickname',{ who, nickname });
  if(r && r.ok){ toast(nickname?('Nickname set'):'Nickname cleared','ok'); loadFriends(); } }

// invites: send uses the Match-tab room/size (or the server mints a private room)
async function inviteFriend(f){
  closeMenus();
  const room=(SAVE.settings.room||'').trim(), size=SAVE.settings.queue||2;
  const r=await sx('invite_send',{ to:f.name, room, size });
  if(r && r.ok) toast('Invited '+f.name+' to a match','ok');
  else toast((r && r.error) || 'Could not invite.','err');
}
async function acceptInvite(iv){
  const r=await sx('invite_respond',{ from:iv.from, accept:true });
  if(r && r.ok && r.room_code){ toast('Joining '+iv.from+'’s match…','ok'); play(r.room_code, r.size||iv.size||2); }
  else toast((r && r.error) || 'That invite expired.','err');
  loadFriends();
}
async function declineInvite(iv){ await sx('invite_respond',{ from:iv.from, accept:false }); loadFriends(); }

// recent co-players → quick-add chips in the Add panel
async function loadRecent(){
  const r=await sx('friends_recent'); frRecent=(r && r.ok && r.recent)||[];
  const host=$('frRecent'); host.innerHTML='';
  if(!frRecent.length) return;
  const lbl=document.createElement('div'); lbl.className='fr-recent-lbl'; lbl.textContent='Recently played with'; host.appendChild(lbl);
  for(const p of frRecent.slice(0,8)){
    const chip=document.createElement('button'); chip.className='fr-chip';
    chip.innerHTML=avatarHTML(p.name)+'<span></span>'; chip.querySelector('span').textContent=p.name;
    chip.onclick=async ()=>{ const r=await sx('friend_request',{ to:p.name }); if(r&&r.ok){ toast('Friend request sent to '+p.name,'ok'); loadFriends(); loadRecent(); } };
    host.appendChild(chip);
  }
}

// ── wiring ──
$('frTabs').addEventListener('click', e=>{ const b=e.target.closest('button'); if(b) setTab(b.dataset.tab); });
$('frSearch').addEventListener('input', e=>{ frSearch=e.target.value; renderFriendsTab(); });
$('frAddToggle').addEventListener('click', ()=>{ const a=$('frAdd'); a.hidden=!a.hidden; if(!a.hidden){ $('frAddName').focus(); loadRecent(); } });
$('frAddBtn').addEventListener('click', addFriend);
$('frAddName').addEventListener('keydown', e=>{ if(e.key==='Enter') addFriend(); else if(e.key==='Escape') $('frAdd').hidden=true; });
setInterval(()=>{ if(!document.hidden && !$('view-home').hidden) loadFriends(); }, 20000);
$('liPass').addEventListener('keydown', e=>{ if(e.key==='Enter') signIn(); });
$('liUser').addEventListener('keydown', e=>{ if(e.key==='Enter') $('liPass').focus(); });
$('liServer').addEventListener('input', ()=>{ SAVE.settings.server=$('liServer').value.trim(); saveSettings(); });
$('amSignout').addEventListener('click', signOut);

// ── settings drawer ──────────────────────────────────────────────────────────
const drawer=$('drawer'), scrim=$('scrim');
function buildResolutions(){
  const sel=$('stRes'); sel.innerHTML='';
  (resolutions.length?resolutions:FALLBACK.load.resolutions).forEach(([w,h])=>{
    const o=document.createElement('option'); o.value=`${w}x${h}`; o.textContent=`${w} × ${h}`; sel.appendChild(o);
  });
  sel.value=SAVE.settings.res;
  if(sel.selectedIndex<0){ const def=(resolutions.find(([w,h])=>w===1440&&h===1080))||resolutions[0]||[1440,1080];
    SAVE.settings.res=`${def[0]}x${def[1]}`; sel.value=SAVE.settings.res; persist(); }
}
function syncDrawer(){
  const st=SAVE.settings;
  const signedIn=!!(SAVE.session && SAVE.session.name);
  $('acctSec').hidden=!signedIn; $('acctBox').hidden=!signedIn;
  if(!signedIn){ $('apDel').hidden=true; $('apMsg').textContent=''; }
  $('stServer').value=st.server||'';
  $('stRes').value=st.res;
  $('stFs').classList.toggle('on', !!st.fullscreen);
  $('stHd').classList.toggle('on', !!st.hd);
  $('stSkip').classList.toggle('on', !!st.skip_menu);
  $('stGs').classList.toggle('on', !!st.gamescope);
  $('stGsArgs').value=st.gamescope_args||'';
  $('stGsArgs').hidden = !(gsAvailable && st.gamescope);
  $('stProton').classList.toggle('on', !!st.proton);
  $('hdRow').hidden = !hdAvailable;
  $('gsRow').hidden = !gsAvailable;
  $('ptRow').hidden = !ptAvailable;
}
function openDrawer(){ syncDrawer(); drawer.classList.add('open'); scrim.classList.add('show'); if(!_inGame) setStatus('in settings'); }
function closeDrawer(){ drawer.classList.remove('open'); scrim.classList.remove('show'); if(!_inGame) setStatus('in lobby'); }
$('navSettings').addEventListener('click', e=>{ e.preventDefault(); openDrawer(); });

// ── view router: Home / Match / Training / Ranks ────────────────────────────────
const NAV = { home:'navHome', match:'navMatch', training:'navTraining', ranks:'navNews' };
let curView = 'home';
function setView(v){
  curView = v;
  for(const id of ['home','match','training','ranks']) $('view-'+id).hidden = (id !== v);
  document.querySelectorAll('.nav > a').forEach(a=>a.classList.remove('on'));
  $(NAV[v]).classList.add('on');
  if(v==='ranks') renderBoard();
  if(v==='match') syncMatch();
  if(v==='training') syncTraining();
  if(v==='home' && typeof loadFriends==='function') loadFriends();
  updateCTA();
}
$('navHome').addEventListener('click', e=>{ e.preventDefault(); setView('home'); });
$('navMatch').addEventListener('click', e=>{ e.preventDefault(); setView('match'); });
$('navTraining').addEventListener('click', e=>{ e.preventDefault(); setView('training'); });
$('navNews').addEventListener('click', e=>{ e.preventDefault(); setView('ranks'); });

// The bottom-right button is one contextual CTA:
//   Home / Ranks  → "MATCH"  (jump to the Match tab)
//   Match         → "PLAY"   (queue a player match)
//   Training      → "PLAY"   (start a match vs AI)
function ctaMode(){
  if(curView==='match'||curView==='training') return 'play';
  if(curView==='home') return 'goto';
  return 'hidden';                           // ranks: viewing only — no action button
}
function updateCTA(){
  const m=ctaMode(), pw=$('play');
  if(m==='hidden'){ pw.style.display='none'; return; }
  if(pw.style.display==='none') pw.style.display='flex';
  if(pw.disabled) return;                    // mid-launch: leave the label alone
  setPlayLabel(m==='play' ? 'PLAY' : 'MATCH');
}
function onCTA(){
  const m=ctaMode();
  if(m==='hidden') return;
  if(m==='goto'){ setView('match'); return; }
  if(curView==='training'){
    const count = Math.max(1, (SAVE.match.tsize||2) - 1);
    const room = SAVE.match.bot + ':' + SAVE.match.diff + (count>1 ? ':'+count : '');
    play(room, SAVE.match.tsize||2);         // transient room + arena size; never persisted
  } else {
    play();                                  // human match: uses the typed room code
  }
}

// ── Match setup (vs players) ────────────────────────────────────────────────────
function syncMatch(){
  document.querySelectorAll('#mSeg button').forEach(b=>b.classList.toggle('on',+b.dataset.q===SAVE.settings.queue));
  $('mRoom').value = SAVE.settings.room || '';
}
$('mSeg').addEventListener('click', e=>{ const b=e.target.closest('button'); if(!b) return;
  SAVE.settings.queue=+b.dataset.q; saveSettings(); syncMatch(); });
$('mRoom').addEventListener('input', e=>{ SAVE.settings.room=e.target.value; saveSettings(); });

// ── Training setup (vs AI) ──────────────────────────────────────────────────────
// Roster mirrors the server's BOT_ROSTER (config.py): dummy = stand-still target,
// target = wanders + dodges (never attacks), korra = full modal AI fighter. Bot "tiers"
// are gone — strength is the difficulty suffix (easy/medium/hard) the tDiff buttons set.
const BOTS = ['dummy','target','korra'];
// A returning user may have an old bot ('ember'/'grunt'/…) saved in localStorage; that code
// no longer resolves server-side, so training would silently wait for a human. Coerce it.
if(!BOTS.includes(SAVE.match.bot)){ SAVE.match.bot = 'korra'; persist(); }
function renderTBots(){
  $('tBots').innerHTML = BOTS.map(b=>
    `<button data-bot="${b}" class="${b===SAVE.match.bot?'on':''}">${b}</button>`).join('');
}
function syncTraining(){
  document.querySelectorAll('#tSeg button').forEach(b=>b.classList.toggle('on',+b.dataset.q===(SAVE.match.tsize||2)));
  document.querySelectorAll('#tDiff button').forEach(b=>b.classList.toggle('on',b.dataset.d===SAVE.match.diff));
  renderTBots();
}
$('tSeg').addEventListener('click', e=>{ const b=e.target.closest('button'); if(!b) return;
  SAVE.match.tsize=+b.dataset.q; persist(); syncTraining(); });
$('tDiff').addEventListener('click', e=>{ const b=e.target.closest('button'); if(!b) return;
  SAVE.match.diff=b.dataset.d; persist(); syncTraining(); });
$('tBots').addEventListener('click', e=>{ const b=e.target.closest('button'); if(!b) return;
  SAVE.match.bot=b.dataset.bot; persist(); syncTraining(); });
$('amSettings').addEventListener('click', ()=>{ acctMenu.classList.remove('open'); openDrawer(); });
$('drawerClose').addEventListener('click', closeDrawer);
scrim.addEventListener('click', closeDrawer);
$('stServer').addEventListener('input', e=>{ SAVE.settings.server=e.target.value; saveSettings(); });
$('stRes').addEventListener('change', e=>{ SAVE.settings.res=e.target.value; saveSettings(); });
$('stFs').addEventListener('click', ()=>{ SAVE.settings.fullscreen=!SAVE.settings.fullscreen; saveSettings(); syncDrawer(); });
$('stSkip').addEventListener('click', ()=>{ SAVE.settings.skip_menu=!SAVE.settings.skip_menu; saveSettings(); syncDrawer(); });
$('stGs').addEventListener('click', ()=>{ if(!gsAvailable) return; SAVE.settings.gamescope=!SAVE.settings.gamescope; saveSettings(); syncDrawer(); });
$('stGsArgs').addEventListener('input', e=>{ SAVE.settings.gamescope_args=e.target.value; saveSettings(); });
$('stProton').addEventListener('click', ()=>{ if(!ptAvailable) return; SAVE.settings.proton=!SAVE.settings.proton; saveSettings(); syncDrawer(); });
// HD textures swap immediately (the engine only reads them at startup → next launch)
$('stHd').addEventListener('click', async ()=>{
  if(!hdAvailable) return;
  const on=!SAVE.settings.hd; SAVE.settings.hd=on; persist(); syncDrawer();
  $('hdHint').textContent='switching…';
  try{ await invoke('set_textures',{ hd:on });
    $('hdHint').textContent = on?'HD · applies next launch':'original · applies next launch';
    toast(on?'HD textures on — applies on next launch.':'Original textures restored — applies on next launch.','ok');
  }catch(e){ SAVE.settings.hd=!on; persist(); syncDrawer(); $('hdHint').textContent='AI-upscaled arena set · next launch'; toast(String(e),'err'); }
});

// ── service status polling ───────────────────────────────────────────────────
function setSvc(name, up){
  const el=document.querySelector(`.pill[data-svc="${name}"]`); if(!el) return;
  el.classList.remove('off','unknown');
  if(up===null) el.classList.add('unknown'); else if(!up) el.classList.add('off');
}
let statusDebounce, _wasReachable=true;
async function pollStatus(){
  if(document.hidden) return;   // don't poll the network while minimised
  const host=(SAVE.settings.server||'').trim();
  if(!host){ ['gateway','database','game_server'].forEach(n=>setSvc(n,null)); $('players').textContent='—'; return; }
  let r; try{ r=await invoke('status',{ host }); }catch{ r=null; }
  if(!r || !r.reachable){
    ['gateway','database','game_server'].forEach(n=>setSvc(n,false)); $('players').textContent='—';
    if(_wasReachable){ toast('Can’t reach the server — retrying…','err'); _wasReachable=false; }
    return;
  }
  if(!_wasReachable){ toast('Back online.','ok'); _wasReachable=true; }   // recovered
  setSvc('gateway', !!r.gateway); setSvc('database', !!r.database); setSvc('game_server', !!r.game_server);
  $('players').textContent = r.game_server ? String(r.players) : '—';
}

// ── PLAY ─────────────────────────────────────────────────────────────────────
// Render the in-game loading screen here (the launcher's real gradients, ember glow, element emblem
// SVG, Cinzel) onto a canvas and hand the raw pixels to Rust → BMP → the in-game cover blits it, so
// the loader looks IDENTICAL to the launcher. The DLL only animates the bottom bar/prompt on top.
const LD_PAL = {
  fire:{g:['#2a1a3a','#5e2f33','#b5683a','#160c12'],gold:'#ff8a30',ember:'#ff5a0a'},
  water:{g:['#0e2138','#163a58','#3a86b2','#091420'],gold:'#8fd0ff',ember:'#4aa8ff'},
  earth:{g:['#222a14','#3a431c','#7e7a30','#14110a'],gold:'#c8de7e',ember:'#a3c14a'},
  air:{g:['#1a2630','#2c4450','#6fa6b4','#0e171f'],gold:'#e0f5f1',ember:'#b6e3dc'},
};
function _hexRgb(h){ const n=parseInt(h.slice(1),16); return ((n>>16)&255)+','+((n>>8)&255)+','+(n&255); }
function _u8b64(u8){ let s=''; const C=0x8000; for(let i=0;i<u8.length;i+=C) s+=String.fromCharCode.apply(null,u8.subarray(i,i+C)); return btoa(s); }
async function renderLoadingImage(element, name, nation, room, party){
  if(!HAS_TAURI) return;
  const p = LD_PAL[element] || LD_PAL.air, W=1440, H=1080;
  const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
  const ctx=cv.getContext('2d');
  const lg=ctx.createLinearGradient(0,0,0,H);
  lg.addColorStop(0,p.g[0]); lg.addColorStop(.34,p.g[1]); lg.addColorStop(.62,p.g[2]); lg.addColorStop(1,p.g[3]);
  ctx.fillStyle=lg; ctx.fillRect(0,0,W,H);
  const er=_hexRgb(p.ember);
  const rg=ctx.createRadialGradient(W*.5,-H*.05,0,W*.5,-H*.05,H*.95);
  rg.addColorStop(0,`rgba(${er},.36)`); rg.addColorStop(.5,`rgba(${er},.09)`); rg.addColorStop(1,`rgba(${er},0)`);
  ctx.fillStyle=rg; ctx.fillRect(0,0,W,H);
  const vg=ctx.createRadialGradient(W*.5,H*1.15,0,W*.5,H*1.15,H*.75);
  vg.addColorStop(0,'rgba(0,0,0,.6)'); vg.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=vg; ctx.fillRect(0,0,W,H);
  // element emblem (the launcher's SVG), tinted gold
  const sym=document.getElementById('el-'+element);
  if(sym){
    const vb=sym.getAttribute('viewBox')||'0 0 100 100';
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" style="color:${p.gold}">${sym.innerHTML}</svg>`;
    await new Promise(res=>{ const im=new Image(); im.onload=()=>{ ctx.save(); ctx.globalAlpha=.95; ctx.shadowColor=`rgba(${er},.5)`; ctx.shadowBlur=40;
        const es=320; ctx.drawImage(im,(W-es)/2,H*.085,es,es); ctx.restore(); res(); };
      im.onerror=res; im.src='data:image/svg+xml;utf8,'+encodeURIComponent(svg); });
  }
  try{ if(document.fonts) await document.fonts.ready; }catch(_){}
  ctx.textAlign='center';
  ctx.save(); ctx.shadowColor='rgba(0,0,0,.55)'; ctx.shadowBlur=22; ctx.shadowOffsetY=5;
  ctx.fillStyle=p.gold; ctx.font='700 96px Cinzel, serif'; ctx.fillText('LEGENDS AWAKENED', W/2, H*.52); ctx.restore();
  ctx.fillStyle='#cabda9'; ctx.font='400 30px Inter, system-ui, sans-serif'; ctx.fillText('Your match awaits', W/2, H*.575);
  ctx.fillStyle=p.gold; ctx.font='700 50px Cinzel, serif'; ctx.fillText(nation? name+'   ·   '+nation : name, W/2, H*.70);
  ctx.fillStyle='#bbb09c'; ctx.font='400 28px Inter, system-ui, sans-serif';
  let yy=H*.745; if(room){ ctx.fillText('Room: '+room, W/2, yy); yy+=44; } if(party){ ctx.fillText('Party: '+party, W/2, yy); }
  const px=ctx.getImageData(0,0,W,H).data;
  await invoke('save_loading_image', { width:W, height:H, data:_u8b64(new Uint8Array(px.buffer)) });
}
function setPlayLabel(t){ document.querySelector('.play-label').textContent=t; }
function gather(){
  const st=SAVE.settings; const [w,h]=(st.res||'1440x1080').split('x').map(Number);
  return { host:(st.server||'').trim(), room:(st.room||'').trim(), queue:st.queue,
           fullscreen:!!st.fullscreen, width:w||1440, height:h||1080, hd_textures:!!st.hd,
           gamescope:!!st.gamescope, gamescope_args:(st.gamescope_args||'').trim(),
           skip_menu:!!st.skip_menu, proton:!!st.proton };
}
// PLAY morphs into a status pill (#prog) — reused for the experimental Skip-menus orchestration.
function showProg(text, pct){ $('play').style.display='none'; $('prog').style.display='block';
  $('progText').textContent=text; $('progFill').style.width=(pct||0)+'%'; $('progPct').textContent = pct!=null?pct+'%':''; }
let _inGame=false;   // true while a launched game is running → PLAY stays disabled (no double-launch)
// Presence telemetry: a short label of what the player is doing, sent on each keep-alive ping so the
// gateway admin Command view shows it. setStatus() updates it at navigation points.
let _status='in lobby';
function setStatus(s){ _status = s || 'in lobby'; }
function resetPlay(){ _inGame=false; setStatus('in lobby'); $('prog').style.display='none'; $('play').style.display='flex'; $('play').disabled=false; updateCTA(); }


// Arm the seamless ("Skip-menus") launch with a one-time game-login ticket so the game
// loads the REAL character. Prefers the DURABLE session token (no password, survives launcher
// restarts, kept alive by sliding expiry while you keep playing) and only falls back to the
// in-memory password from this session. The password never reaches the game — only the ticket.
// Returns {username, ticket} or null when it can't arm (caller warns + launches with a manual login).
async function armTicket(host){
  const tok = SAVE.session && SAVE.session.token;
  if(tok){
    try{
      const r = await invoke('gw_ticket_session',{ host, token:tok });
      if(r && r.ok && r.ticket) return { username:r.name || SAVE.session.name, ticket:r.ticket };
      // token died server-side — drop it so the UI reflects signed-out, then try the password
      if(r && /signed in/.test(r.error||'')){ SAVE.session.token=null; persist(); }
    }catch{}
  }
  if(SAVE.session && sessionPass){
    try{
      const r = await invoke('gw_ticket',{ host, username:SAVE.session.name, password:sessionPass });
      if(r && r.ok && r.ticket){
        // re-open a durable session too, so the NEXT Play needs no password (survives restart)
        try{ const s=await invoke('session_login',{ host, username:SAVE.session.name, password:sessionPass });
          if(s && s.ok && s.token){ SAVE.session.token=s.token; persist(); } }catch{}
        return { username:SAVE.session.name, ticket:r.ticket };
      }
    }catch{}
  }
  return null;
}

async function play(roomOverride, queueOverride){
  if(!found){ return locate(); }   // PLAY doubles as "locate game" when not found
  const settings=gather();
  if(roomOverride!=null) settings.room=roomOverride;       // training: transient bot room, never persisted
  if(queueOverride!=null) settings.queue=queueOverride;
  // Seamless identity: mint a ticket from the signed-in session so the game loads the REAL
  // character. Don't silently launch unarmed — warn so the player knows it'll be a manual login.
  let username=null, ticket=null;
  if(settings.skip_menu){
    const armed = SAVE.session ? await armTicket(settings.host) : null;
    if(armed){ username=armed.username; ticket=armed.ticket; }
    else if(SAVE.session){ toast('Couldn’t arm your account — sign in again. Launching with a manual login.','err'); }
    else { toast('Not signed in — launching with a manual login.','err'); }
  }
  // AUTO-LOGIN: with Skip-menus on + a ticket, the DLL submits this account's login in-game (fast)
  // and hands the menu to the player — so you never type the in-game login again. The launcher's job
  // ends at launch; it steps aside (no cover/queue orchestration — the game runs normally).
  $('play').disabled=true; setPlayLabel(ticket ? 'LOGGING IN…' : 'LAUNCHING…');
  const w=getWin();
  try{
    // invoke('play') now resolves only when the GAME EXITS (the Rust side waits on the child).
    // So PLAY stays disabled for the whole match (no 2nd instance), and we minimise meanwhile.
    // themed loading card: pass the selected element + party so the in-game cover matches the launcher
    const element = SAVE.element || (typeof currentElement!=='undefined' ? currentElement : '') || 'air';
    const party = (partyData && partyData.party && partyData.party.members && partyData.party.members.length>1)
      ? partyData.party.members.map(m=>m.name).join(', ') : '';
    // (loading-image render temporarily disabled — the raw-pixel IPC payload was too large and could
    // stall the webview; being redone with a small PNG. The DLL falls back to the GDI/Cinzel card.)
    const launched = invoke('play',{ settings, windowed:!settings.fullscreen, username, ticket, element, party });
    toast(ticket ? 'Logging you in…' : 'Launching…','ok');
    _inGame=true; setStatus('in match'); setPlayLabel('IN GAME');
    setTimeout(()=>{ if(w && _inGame) w.minimize(); }, 1500);   // let the game grab focus, then drop the launcher
    await launched;                                             // ← the game has now closed
    if(w){ try{ await w.unminimize(); await w.setFocus(); }catch{} }   // bring the launcher back, ready to go again
  }catch(e){ toast(String(e),'err'); }
  resetPlay();   // re-arm PLAY (game exited, or launch failed)
}
async function locate(){
  try{ const p=await invoke('locate'); if(p) await refresh(); else toast('That folder has no Config.ini.','err'); }
  catch(e){ toast(String(e),'err'); }
}
$('play').addEventListener('click', onCTA);

// ── updates (read-only check; explicit, modal-gated patch) ───────────────────
let updateMode=null;
function setUpdateBtn(text, busy){ $('updateText').textContent=text; $('checkUpdates').classList.toggle('busy',!!busy); }
function fmtBytes(n){ if(!n) return ''; const mb=n/(1024*1024); return mb>=1?`~${mb.toFixed(mb<10?1:0)} MB`:`~${Math.max(1,Math.round(n/1024))} KB`; }
function resetModal(){ $('updateProgress').hidden=true; $('updateBarFill').style.width='0%'; $('updateBarLabel').textContent='';
  $('updateNow').disabled=false; $('updateLater').disabled=false; $('updateLater').textContent='Later'; }
function closeUpdateModal(){ $('updateModal').setAttribute('aria-hidden','true'); }
async function checkForUpdates(manual){
  const host=(SAVE.settings.server||'').trim();
  if(!host){ if(manual) toast('Set a server first.','err'); return; }
  if(manual) setUpdateBtn('Checking…',true);
  let r; try{ r=await invoke('check_updates',{ host }); }
  catch(e){ if(manual){ toast('Update check failed.','err'); setUpdateBtn('Check for updates',false); } return; }
  const files=(r && r.content_files)||0;   // check_updates is content-only now; launcher → plugin
  if(files>0){
    updateMode='content';
    $('updateBody').innerHTML=`<b>${files}</b> game file${files>1?'s':''}${r.content_bytes?` (${fmtBytes(r.content_bytes)})`:''} can be updated (textures / plugins). Download them now?`;
    resetModal(); $('updateNow').textContent='Update'; $('updateModal').setAttribute('aria-hidden','false');
    if(manual) setUpdateBtn('Check for updates',false);
  } else if(manual){
    if(r && r.ok){ toast("You're up to date.",'ok'); setUpdateBtn('Up to date',false); }
    else { toast((r && r.error)||'Update check failed.','err'); setUpdateBtn('Check for updates',false); }
    setTimeout(()=>setUpdateBtn('Check for updates',false), 5000);
  }
}
// Launcher self-update via the updater plugin (signed installer from GitHub Releases).
async function checkLauncherUpdate(){
  let r; try{ r=await invoke('check_self_update'); }catch{ return; }
  if(r && r.available){
    updateMode='launcher';
    $('updateBody').innerHTML=`A newer launcher is available — <b>v${r.version}</b>${appVersion?` (you have v${appVersion})`:''}. Install it now? The launcher will restart.`;
    resetModal(); $('updateNow').textContent='Update'; $('updateModal').setAttribute('aria-hidden','false');
  }
}
async function installLauncherUpdate(){
  $('updateNow').disabled=true; $('updateLater').disabled=true; $('updateProgress').hidden=false;
  $('updateBarFill').style.width='40%'; $('updateBarLabel').textContent='Downloading & installing…';
  try{
    const r=await invoke('self_update');
    if(r && r.updated){ $('updateBarFill').style.width='100%'; $('updateBarLabel').textContent='Installed — restarting…';
      toast('Updated to v'+(r.version||'')+' — restarting…','ok'); setTimeout(()=>invoke('restart'), 900); }
    else { const msg=(r && r.error)||'Update failed.'; $('updateBarLabel').textContent=msg; toast(msg,'err');
      $('updateLater').textContent='Close'; $('updateLater').disabled=false; $('updateNow').disabled=false; }
  }catch(e){ $('updateBarLabel').textContent=String(e); toast('Update failed.','err');
    $('updateLater').textContent='Close'; $('updateLater').disabled=false; $('updateNow').disabled=false; }
}
async function applyContent(){
  const host=(SAVE.settings.server||'').trim();
  $('updateNow').disabled=true; $('updateLater').disabled=true; $('updateProgress').hidden=false; $('updateBarLabel').textContent='Starting…';
  let unlisten=null;
  try{
    const EVT=TAURI.event;
    if(EVT && EVT.listen){ unlisten=await EVT.listen('sync-progress', ev=>{ const p=ev.payload||{};
      const pct=p.total?Math.round((p.done/p.total)*100):0; $('updateBarFill').style.width=pct+'%';
      const name=(p.file||'').replace(/^.*[\\/]/,''); $('updateBarLabel').textContent=p.total?`Updating ${p.done}/${p.total}${name?' · '+name:''}`:'Updating…'; }); }
    const r=await invoke('sync',{ host });
    const n=(r && r.updated && r.updated.length)||0; const bad=(r && r.failed && r.failed.length)||0;
    if(r && r.ok && bad===0){ $('updateBarFill').style.width='100%';
      $('updateBarLabel').textContent=n?`Updated ${n} file${n>1?'s':''}.`:'Already up to date.';
      toast(n?`Updated ${n} game file${n>1?'s':''}.`:'Game files already up to date.','ok'); setTimeout(closeUpdateModal,1300);
    } else { const msg=(r && r.error)||'Some files could not be updated.'; $('updateBarLabel').textContent=msg; toast(msg,'err');
      $('updateLater').textContent='Close'; $('updateLater').disabled=false; }
  }catch(e){ $('updateBarLabel').textContent='Update failed — is the game closed?'; toast('Could not update game files.','err');
    $('updateLater').textContent='Close'; $('updateLater').disabled=false; }
  finally{ if(typeof unlisten==='function') unlisten(); }
}
$('checkUpdates').addEventListener('click', ()=>checkForUpdates(true));
$('updateNow').addEventListener('click', ()=>{ if(updateMode==='launcher') installLauncherUpdate(); else if(updateMode==='content') applyContent(); });
$('updateLater').addEventListener('click', closeUpdateModal);

// ── boot: load backend state, reconcile settings, then gate or resume ────────
async function refresh(){
  let r; try{ r=await invoke('load'); }catch{ toast('Launcher backend unavailable.','err'); return; }
  if(!r) return;
  found=!!r.found; native=r.native||[0,0]; resolutions=r.resolutions||[];
  hdAvailable=!!r.hd_available; gsAvailable=!!r.gamescope_available; ptAvailable=!!r.proton_available;
  if(r.version){ appVersion=r.version; $('version').textContent=`Legends Awakened · v${r.version}`; $('drawerVer').textContent=`Launcher v${r.version}`; }
  // reconcile authoritative game settings from the backend (keep element + session local)
  const s=r.settings||{};
  SAVE.settings={ ...SAVE.settings,
    server:(s.host||SAVE.settings.server||DEFAULT_SERVER), room:s.room??SAVE.settings.room,
    queue:[2,3,4].includes(s.queue)?s.queue:SAVE.settings.queue,
    res:(s.width&&s.height)?`${s.width}x${s.height}`:SAVE.settings.res,
    hd:('hd_textures'in s)?!!s.hd_textures:SAVE.settings.hd,
    fullscreen:('fullscreen'in s)?!!s.fullscreen:SAVE.settings.fullscreen,
    skip_menu:('skip_menu'in s)?!!s.skip_menu:SAVE.settings.skip_menu,
    gamescope:('gamescope'in s)?!!s.gamescope:SAVE.settings.gamescope,
    gamescope_args:s.gamescope_args??SAVE.settings.gamescope_args,
    proton:('proton'in s)?!!s.proton:SAVE.settings.proton };
  persist();
  buildResolutions(); syncDrawer();
  $('liServer').value = SAVE.session ? SAVE.session.server : SAVE.settings.server;
  if(found){ setPlayLabel('PLAY'); $('play').disabled=false; }
  else { setPlayLabel('LOCATE GAME'); $('play').disabled=false; toast('Game folder not found — click LOCATE GAME to pick it.','err'); }
  // First-run: an original is located but not yet cloned → show the setup wizard. Its
  // full-screen overlay also gates PLAY (so we never launch/patch the un-cloned original).
  needsClone = !!r.needs_clone;
  $('czFrom').textContent = r.original_dir ? ('Your game: ' + r.original_dir) : '';
  $('cloneWizard').style.display = needsClone ? 'grid' : 'none';
}

// First-run setup: clone the player's game into a user-writable folder (no admin),
// streaming clone-progress into the wizard, then re-load so PLAY targets the clone.
async function startClone(){
  if(cloning) return; cloning = true;
  $('czErr').textContent=''; $('czGo').disabled=true; $('czGo').textContent='Setting up…';
  $('czProg').hidden=false; $('czFill').style.width='0%'; $('czLabel').textContent='Starting…';
  let unlisten=null;
  try{
    const EVT=TAURI.event;
    if(EVT && EVT.listen){ unlisten=await EVT.listen('clone-progress', ev=>{ const p=ev.payload||{};
      const pct=p.total?Math.round((p.done/p.total)*100):0; $('czFill').style.width=pct+'%';
      const name=(p.file||'').replace(/^.*[\\/]/,''); $('czLabel').textContent=p.total?`Copying ${p.done}/${p.total}${name?' · '+name:''}`:'Copying…'; }); }
    const r=await invoke('prepare_clone');
    if(r && r.ok){
      $('czFill').style.width='100%'; $('czLabel').textContent='Done!';
      toast('Setup complete — your patched copy is ready.','ok');
      setTimeout(async ()=>{ $('cloneWizard').style.display='none'; await refresh(); }, 700);
    } else { $('czErr').textContent=(r && r.error)||'Setup failed.'; $('czGo').disabled=false; $('czGo').textContent='Retry ▶'; }
  }catch(e){ $('czErr').textContent=String(e); $('czGo').disabled=false; $('czGo').textContent='Retry ▶'; }
  finally{ if(typeof unlisten==='function') unlisten(); cloning=false; }
}
$('czGo').addEventListener('click', startClone);

// ── leaderboard ──────────────────────────────────────────────────────────────
// REAL WIRING: replace DEMO_BOARD with `await invoke('leaderboard',{host})` once
// the gateway exposes a ranks endpoint — same {name,nation,rating,solo} shape.
const DEMO_BOARD = [
  {name:'Zenith',     nation:'fire',  rating:2480, wins:31, solo:2240},
  {name:'KorraMain',  nation:'water', rating:2415, wins:28, solo:2310},
  {name:'BoulderKing',nation:'earth', rating:2388, wins:25, solo:2090},
  {name:'Aang',       nation:'air',   rating:2351, wins:23, solo:2402},
  {name:'AshRider',   nation:'fire',  rating:2290, wins:21, solo:2155},
  {name:'TidebornNn', nation:'water', rating:2244, wins:19, solo:2188},
  {name:'GraniteFist',nation:'earth', rating:2201, wins:17, solo:1990},
  {name:'GaleStorm',  nation:'air',   rating:2177, wins:16, solo:2260},
  {name:'Inferna',    nation:'fire',  rating:2120, wins:14, solo:2305},
  {name:'FrostByte',  nation:'water', rating:2088, wins:12, solo:2044},
  {name:'TerraNova',  nation:'earth', rating:2050, wins:11, solo:2130},
  {name:'SkyDancer',  nation:'air',   rating:2012, wins:9,  solo:1975},
];
let boardData = DEMO_BOARD;
const cap = s => s.charAt(0).toUpperCase()+s.slice(1);
const NATION_NAMES = { fire:'Fire Nation', water:'Water Tribe', earth:'Earth Kingdom', air:'Air Nomads' };
function boardRows(){
  const { mode, nation } = SAVE.board;
  // Dominance: rank the four nations by their players' COMBINED score.
  if(mode==='dominance'){
    const totals = {};
    for(const p of boardData) totals[p.nation] = (totals[p.nation]||0) + p.rating;
    return Object.keys(NATION_NAMES)
      .map(n=>({ name:NATION_NAMES[n], nation:n, value:totals[n]||0 }))
      .sort((a,b)=>b.value-a.value)
      .map((r,i)=>({ ...r, rank:i+1 }));
  }
  let list = boardData.slice();
  if(mode==='nation') list = list.filter(p=>p.nation===nation);
  list.sort((a,b)=>b.rating-a.rating);
  return list.slice(0,10).map((p,i)=>({ ...p, rank:i+1, value:p.rating }));
}
function renderBoard(){
  if(!['overall','nation','dominance'].includes(SAVE.board.mode)) SAVE.board.mode='overall';   // drop legacy '1v1'
  const { mode, nation } = SAVE.board;
  document.querySelectorAll('#lbTabs button').forEach(b=>b.classList.toggle('on', b.dataset.mode===mode));
  $('lbNations').hidden = mode!=='nation';
  document.querySelectorAll('#lbNations .el').forEach(s=>
    s.classList.toggle('on', /el-(\w+)/.exec(s.getAttribute('class'))[1]===nation));
  $('lbCap').textContent = mode==='dominance' ? 'Combined nation score'
    : mode==='nation' ? cap(nation)+' · rating' : 'Overall rating';
  const host = $('lbList'); host.innerHTML='';
  const rows = boardRows();
  if(!rows.length){ host.innerHTML='<div class="lb-empty">No ranked players yet.</div>'; return; }
  const frag = document.createDocumentFragment();
  for(const r of rows){
    const row = document.createElement('div'); row.className = 'lb-row'+(r.rank===1?' top':'');
    const rank = document.createElement('span'); rank.className='lb-rank'; rank.textContent=r.rank;
    const ico = document.createElementNS('http://www.w3.org/2000/svg','svg'); ico.setAttribute('class','el el-'+r.nation+' lb-el');
    const use = document.createElementNS('http://www.w3.org/2000/svg','use'); use.setAttribute('href','#el-'+r.nation); ico.appendChild(use);
    const nm = document.createElement('span'); nm.className='lb-name'; nm.textContent=r.name;   // textContent → no HTML injection
    if(r.wins!=null && SAVE.board.mode!=='dominance'){ const w=document.createElement('span'); w.className='lb-w';
      w.textContent=r.wins+'W'; nm.appendChild(w); }
    const val = document.createElement('span'); val.className='lb-val'; val.textContent=r.value;
    row.append(rank, ico, nm, val); frag.appendChild(row);
    if(SAVE.session && r.name===SAVE.session.name) row.classList.add('me');
  }
  host.appendChild(frag);
}
$('lbTabs').addEventListener('click', e=>{ const b=e.target.closest('button'); if(!b) return;
  SAVE.board.mode=b.dataset.mode;
  if(b.dataset.mode==='nation' && !SAVE.board.nation) SAVE.board.nation=SAVE.element;
  persist(); renderBoard(); });
$('lbNations').addEventListener('click', e=>{ const s=e.target.closest('.el'); if(!s) return;
  SAVE.board.nation=/el-(\w+)/.exec(s.getAttribute('class'))[1]; persist(); renderBoard(); });
async function loadBoard(){
  const host=(SAVE.settings.server||'').trim();
  try{ const r=await invoke('leaderboard',{ host });
    const b=(r && r.board)||(Array.isArray(r)?r:null); if(b && b.length) boardData=b; }
  catch{ /* gateway unreachable — keep demo data */ }
  renderBoard();
}

// window controls
$('min').addEventListener('click', ()=>{ const w=getWin(); if(w) w.minimize(); });
// Maximize / restore (the button between – and ×). Swap the glyph + tooltip to reflect state.
async function syncMaxBtn(){ const w=getWin(); if(!w) return; let m=false; try{ m=await w.isMaximized(); }catch{}
  $('max').innerHTML = m ? '&#10064;' : '&#9723;'; $('max').title = m ? 'Restore' : 'Maximize'; }
$('max').addEventListener('click', async ()=>{ const w=getWin(); if(!w) return;
  // explicit maximize/unmaximize — these are the granted capabilities (toggleMaximize would
  // need a separate allow-toggle-maximize permission we don't grant, and was failing silently).
  try{ (await w.isMaximized()) ? await w.unmaximize() : await w.maximize(); }
  catch(e){ toast('Couldn’t maximize: '+e,'err'); }
  syncMaxBtn(); });
(async ()=>{ const w=getWin(); if(w){ try{ await w.onResized(syncMaxBtn); }catch{} syncMaxBtn(); } })();
$('close').addEventListener('click', ()=>{ const w=getWin(); if(w) w.close(); });

// initial paint: theme first (instant), then async backend reconcile
setElement(SAVE.element || 'fire');
renderBoard();
// Restore a remembered session. The bearer token is persisted (localStorage) and kept alive by
// the gateway's sliding expiry, so you stay signed in across launcher restarts and never re-type
// a password between matches. Verify the token on boot; if the server says it's expired, drop to
// the sign-in prompt (username stays prefilled) rather than looking signed-in but failing Play.
async function restoreSession(){
  if(!SAVE.session){ showChip(null); setTimeout(()=>$('liUser').focus(), 60); loadFriends(); return; }
  showChip(SAVE.session.name); loginEl.classList.add('hide');
  const tok = SAVE.session.token;
  if(tok){
    try{ const r=await invoke('session_ping',{ host:SAVE.settings.server, token:tok, status:_status });
      if(r && r.ok===false && /signed in/.test(r.error||'')){
        SAVE.session.token=null; persist();           // expired — keep the name for a one-tap re-sign-in
        $('liUser').value=SAVE.session.name; loginEl.classList.remove('hide');
        toast('Your session expired — sign in once to keep playing.','err');
      }
    }catch{}                                            // server unreachable → stay optimistic, retry later
  }
  startPresence(); loadFriends();
}
restoreSession();
startParticles();
updateCTA();   // Home → the bottom button reads "MATCH"
refresh().then(()=>{ pollStatus(); checkForUpdates(false); checkLauncherUpdate(); loadBoard(); });
setInterval(pollStatus, 12000);

// ════════════════════════════════════════════════════════════════════════════
//  Career stats (#2) · Match replay (#5) · Parties (#3)
// ════════════════════════════════════════════════════════════════════════════
const NAT_COL = { 1:'#a3c14a', 2:'#ff5a0a', 3:'#4aa8ff', 4:'#b6e3dc' };   // earth/fire/water/air
function fmtDur(s){ s=Math.max(0,Math.round(s||0)); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }

// ── career card — fills the profile popover with real match stats + recent matches ──
async function _fillCareer(p, name){
  const rows=p.querySelector('.prows'); if(!rows) return;
  let r; try{ r=await invoke('career',{ host:_srv(), name }); }catch{ r=null; }
  if(!r || !r.ok) return;
  const stat=(k,v)=>{ const d=document.createElement('div'); d.className='prow'; d.innerHTML=`<span>${k}</span><b></b>`;
    d.querySelector('b').textContent=v; rows.appendChild(d); };
  if(r.matches){
    stat('Record', `${r.wins}W · ${r.losses}L  (${r.winrate}%)`);
    stat('K / D', `${r.kills} / ${r.deaths}  (${r.kd})`);
    stat('Damage dealt', Number(r.damage||0).toLocaleString());
    if(r.streak>1) stat('Win streak', '🔥 '+r.streak);
    stat('Rating', r.rating);
  } else { stat('Matches', 'No ranked matches yet'); }
  if(r.recent && r.recent.length){
    const h=document.createElement('div'); h.className='pmatch-h'; h.textContent='Recent matches — click to watch'; rows.appendChild(h);
    const list=document.createElement('div'); list.className='pmatches';
    for(const m of r.recent.slice(0,5)){
      const it=document.createElement('button'); it.className='pmatch '+m.result;
      it.innerHTML=`<i>${m.result==='win'?'W':'L'}</i><span></span><small>${m.when?relTime(m.when):''}</small>`;
      it.querySelector('span').textContent=`${m.players||2}-player · ${m.end_reason||'match'}`;
      it.onclick=()=>openReplay(m.uid);
      list.appendChild(it);
    }
    rows.appendChild(list);
  }
}
function openMyCareer(){ if(!SAVE.session) return; acctMenu.classList.remove('open');
  openProfile({ name:SAVE.session.name, state:'online', self:true }); }
$('amCareer').addEventListener('click', openMyCareer);

// ── match replay — 2D top-down playback on a canvas ──
let _rv=null, _rvState=null;
function _replayEl(){
  if(_rv) return _rv;
  _rv=document.createElement('div'); _rv.className='replay'; _rv.hidden=true;
  _rv.innerHTML=`<div class="rv-card"><button class="rv-x" title="Close">✕</button>
    <div class="rv-title">Match Replay</div><div class="rv-meta" id="rvMeta"></div>
    <canvas class="rv-canvas" width="660" height="380"></canvas>
    <div class="rv-bar"><button class="rv-play" title="Play/Pause">❚❚</button>
      <input type="range" class="rv-seek" min="0" max="1000" value="0">
      <span class="rv-time">0:00</span></div></div>`;
  document.body.appendChild(_rv);
  _rv.querySelector('.rv-x').onclick=closeReplay;
  _rv.addEventListener('click', e=>{ if(e.target===_rv) closeReplay(); });
  return _rv;
}
function closeReplay(){ if(_rvState){ cancelAnimationFrame(_rvState.raf); _rvState=null; } if(_rv) _rv.hidden=true; if(!_inGame) setStatus('in lobby'); }
async function openReplay(uid){
  const el=_replayEl(); el.hidden=false; closeMenus(); if(!_inGame) setStatus('watching a replay');
  el.querySelector('#rvMeta').textContent='Loading replay…';
  let r; try{ r=await invoke('match_replay',{ host:_srv(), uid }); }catch{ r=null; }
  if(!r || !r.ok || !(r.frames||[]).length){ el.querySelector('#rvMeta').textContent='No replay data for this match.'; return; }
  _rvSetup(el, r);
}
function _rvSetup(el, data){
  const cv=el.querySelector('.rv-canvas'), ctx=cv.getContext('2d');
  const W=cv.width, H=cv.height, pad=46;
  let minx=1e9,maxx=-1e9,minz=1e9,maxz=-1e9;
  for(const f of data.frames) for(const p of (f.players||[])){
    minx=Math.min(minx,p.x); maxx=Math.max(maxx,p.x); minz=Math.min(minz,p.z); maxz=Math.max(maxz,p.z); }
  if(minx>maxx){ minx=minz=-10; maxx=maxz=10; }
  const cx=(minx+maxx)/2, cz=(minz+maxz)/2, span=Math.max(1,Math.max(maxx-minx,maxz-minz))*1.15;
  const scale=(Math.min(W,H)-pad*2)/span;
  const px=x=> W/2+(x-cx)*scale, py=z=> H/2+(z-cz)*scale;
  const dur=data.frames[data.frames.length-1].t || data.meta.duration || 1;
  const win=(data.meta.winners||[]);
  el.querySelector('#rvMeta').textContent=`${data.meta.players||'?'} players · ${fmtDur(data.meta.duration||dur)}`
    +(win.length?`  ·  🏆 ${win.join(', ')}`:'');
  const seek=el.querySelector('.rv-seek'), playBtn=el.querySelector('.rv-play'), timeEl=el.querySelector('.rv-time');
  const state={ data,ctx,W,H,px,py,dur,t:0,playing:true,raf:0,last:performance.now() }; _rvState=state;
  playBtn.textContent='❚❚';
  playBtn.onclick=()=>{ state.playing=!state.playing; playBtn.textContent=state.playing?'❚❚':'▶'; state.last=performance.now(); };
  seek.oninput=()=>{ state.t=(+seek.value/1000)*dur; state.playing=false; playBtn.textContent='▶'; };
  function frameAt(t){
    const fr=state.data.frames; let i=0; while(i<fr.length-1 && fr[i+1].t<=t) i++;
    const a=fr[i], b=fr[Math.min(fr.length-1,i+1)], dn=Math.max(1e-3,b.t-a.t), u=Math.max(0,Math.min(1,(t-a.t)/dn));
    const bm={}; for(const p of (b.players||[])) bm[p.n]=p;
    return (a.players||[]).map(p=>{ const q=bm[p.n]||p; return {...p, x:p.x+(q.x-p.x)*u, z:p.z+(q.z-p.z)*u}; });
  }
  function render(){
    ctx.clearRect(0,0,W,H);
    ctx.beginPath(); ctx.arc(W/2,H/2,Math.min(W,H)/2-pad/2,0,Math.PI*2);
    ctx.fillStyle='rgba(255,255,255,.025)'; ctx.fill(); ctx.strokeStyle='rgba(255,170,90,.12)'; ctx.lineWidth=1; ctx.stroke();
    const players=frameAt(state.t);
    for(const e of state.data.events){ const dt=(e.t||0)-state.t; if(dt<=0 && dt>-0.45){
      const tgt=players.find(p=>p.n===e.target)||players.find(p=>p.n===e.actor); if(!tgt) continue;
      const X=px(tgt.x),Y=py(tgt.z), a=1+dt/0.45;
      if(e.kind==='kill'){ ctx.globalAlpha=a; ctx.strokeStyle='#ff5a0a'; ctx.lineWidth=2.5;
        ctx.beginPath(); ctx.arc(X,Y,18*(1.3-a),0,Math.PI*2); ctx.stroke(); ctx.globalAlpha=1; }
      else if(e.kind==='hit'){ ctx.globalAlpha=a*.6; ctx.fillStyle='#fff';
        ctx.beginPath(); ctx.arc(X,Y,5,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1; } } }
    for(const p of players){
      const X=px(p.x), Y=py(p.z), col=NAT_COL[p.f]||'#bbb';
      ctx.globalAlpha = p.d?0.35:1;
      ctx.beginPath(); ctx.arc(X,Y,8,0,Math.PI*2); ctx.fillStyle=col; ctx.fill();
      ctx.lineWidth=2; ctx.strokeStyle='rgba(0,0,0,.55)'; ctx.stroke();
      const hp=p.hm?Math.max(0,Math.min(1,p.h/p.hm)):1;
      ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(X-13,Y-17,26,3.5);
      ctx.fillStyle= hp>.5?'#52e08a':hp>.25?'#e0a93a':'#f85149'; ctx.fillRect(X-13,Y-17,26*hp,3.5);
      ctx.globalAlpha=1; ctx.fillStyle='rgba(244,236,224,.92)'; ctx.font='10px Inter,system-ui,sans-serif'; ctx.textAlign='center';
      ctx.fillText(p.n, X, Y+22);
    }
  }
  function loop(now){
    if(state!==_rvState) return;
    if(state.playing){ state.t+=(now-state.last)/1000; if(state.t>=dur){ state.t=dur; state.playing=false; playBtn.textContent='▶'; } }
    state.last=now; seek.value=Math.round(state.t/dur*1000); timeEl.textContent=fmtDur(state.t); render();
    state.raf=requestAnimationFrame(loop);
  }
  state.raf=requestAnimationFrame(loop);
}

// ── parties — group block in the friends panel, polled separately ──
let partyData=null, _partyTimer=null, _lastGo=0;
let _lastPartyInv=null;
async function pollParty(){
  if(!_tok()){ renderParty(null,null); return; }
  let r; try{ r=await invoke('party_get',{ host:_srv(), token:_tok() }); }catch{ return; }
  if(!r || !r.ok) return;
  // notify on a NEW incoming party invite
  const invId=r.invite ? (r.invite.party_id+':'+r.invite.from) : null;
  if(invId && invId!==_lastPartyInv && _frPrimed){ toast(r.invite.from+' invited you to their party','ok');
    osNotify('Party invite', r.invite.from+' invited you to their party'); }
  _lastPartyInv=invId;
  partyData=r.party; renderParty(r.party, r.invite);
  if(r.party && r.party.status==='go' && r.party.go_at>_lastGo){
    _lastGo=r.party.go_at; toast('Party starting — queuing you in…','ok'); play(r.party.room_code, r.party.size);
  }
}
function startPartyPoll(){ if(_partyTimer) return; pollParty(); _partyTimer=setInterval(()=>{ if(!document.hidden) pollParty(); }, 5000); }
function renderParty(party, invite){
  const host=$('frParty'); if(!host) return; host.innerHTML='';
  if(invite){
    const el=document.createElement('div'); el.className='fr-invite party';
    el.innerHTML=avatarHTML(invite.from)+`<div class="meta"><b></b><small>invites you to their party · ${invite.size||4}-player</small></div>`
      +`<button class="ok">Join</button><button class="no">✕</button>`;
    el.querySelector('b').textContent=invite.from;
    el.querySelector('.ok').onclick=()=>partyJoin(invite.party_id);
    el.querySelector('.no').onclick=()=>{};   // ignore (invite expires)
    host.appendChild(el);
  }
  if(!party) return;
  const wrap=document.createElement('div'); wrap.className='party';
  const head=document.createElement('div'); head.className='party-head';
  head.innerHTML=`<span class="pt">PARTY</span><span class="pc">${party.members.length}/${party.size}</span>`
    +`<button class="party-leave" title="Leave party">Leave</button>`;
  head.querySelector('.party-leave').onclick=partyLeave; wrap.appendChild(head);
  for(const m of party.members){
    const row=document.createElement('div'); row.className='party-m '+(m.state||'offline');
    row.innerHTML=avatarHTML(m.name)+`<span class="dot"></span><b class="nm"></b>`
      +(m.leader?'<span class="crown" title="Leader">👑</span>':'')
      +`<span class="rd ${m.ready?'on':''}">${m.ready?'Ready':'…'}</span>`
      +(party.is_leader && !m.leader?'<button class="kick" title="Remove">✕</button>':'');
    row.querySelector('.nm').textContent=m.name;
    const kb=row.querySelector('.kick'); if(kb) kb.onclick=()=>partyKick(m.name);
    wrap.appendChild(row);
  }
  for(const nm of (party.pending||[])){
    const row=document.createElement('div'); row.className='party-m pending';
    row.innerHTML=avatarHTML(nm)+'<span class="dot"></span><b class="nm"></b><span class="rd">invited…</span>';
    row.querySelector('.nm').textContent=nm; wrap.appendChild(row);
  }
  const acts=document.createElement('div'); acts.className='party-acts';
  const me=party.members.find(m=>m.name===(SAVE.session&&SAVE.session.name));
  const ready=me?me.ready:false;
  acts.innerHTML=`<button class="pa rdy ${ready?'on':''}">${ready?'✓ Ready':'Ready up'}</button>`
    +(party.is_leader?`<button class="pa go">Start ▶</button>`:'');
  acts.querySelector('.rdy').onclick=()=>partyReady(!ready);
  const go=acts.querySelector('.go'); if(go) go.onclick=partyStart;
  wrap.appendChild(acts); host.appendChild(wrap);
}
async function _pcall(cmd, extra){ const r=await sx(cmd, extra); if(r && r.ok){ partyData=r.party; renderParty(r.party, r.invite); }
  else if(r && r.error) toast(r.error,'err'); return r; }
async function partyInvite(name){ closeMenus(); const r=await _pcall('party_invite',{ to:name });
  if(r && r.ok) toast('Invited '+name+' to your party','ok'); }
async function partyJoin(pid){ const r=await _pcall('party_join',{ party:pid }); if(r && r.ok) toast('Joined the party','ok'); }
async function partyLeave(){ await _pcall('party_leave'); }
async function partyReady(on){ await _pcall('party_ready',{ ready:on }); }
async function partyKick(name){ await _pcall('party_kick',{ who:name }); }
async function partyStart(){ const r=await sx('party_start'); if(r && r.ok){ _lastGo=r.go_at; toast('Starting party match…','ok'); if(r.room_code) play(r.room_code, r.size); pollParty(); }
  else toast((r&&r.error)||'Could not start.','err'); }
startPartyPoll();

// preview-only mock data for the new features (browser, no Tauri)
if(!HAS_TAURI){
  FALLBACK.career={ ok:true, name:'Aang', nation:'air', matches:48, wins:31, losses:17, winrate:65,
    kills:112, deaths:63, kd:1.78, damage:18450, streak:4, rating:2351, recent:[
      {uid:'demo',when:Date.now()/1000-3600,  result:'win', players:4,end_reason:'last-man'},
      {uid:'demo',when:Date.now()/1000-7200,  result:'win', players:2,end_reason:'timer'},
      {uid:'demo',when:Date.now()/1000-90000, result:'loss',players:4,end_reason:'last-man'},
      {uid:'demo',when:Date.now()/1000-180000,result:'win', players:3,end_reason:'last-man'} ] };
  FALLBACK.party_get={ ok:true, invite:null, party:{ id:'demo', leader:'Aang', is_leader:true,
    room_code:'party-7f3a2c', size:4, status:'idle', go_at:0, pending:['Zephyra'], members:[
      {name:'Aang',ready:true,leader:true,state:'online'},
      {name:'KorraMain',ready:true,leader:false,state:'in-game'},
      {name:'BoulderKing',ready:false,leader:false,state:'away'} ] } };
  const fr=[]; for(let i=0;i<64;i++){ const a=i/9; fr.push({ t:i*0.25, players:[
    {s:0,n:'Aang', f:4,x:Math.cos(a)*6,        z:Math.sin(a)*6,        h:Math.max(0,128-i),    hm:130,d:0,a:'move'},
    {s:1,n:'Korra',f:3,x:Math.cos(a+2.1)*7,    z:Math.sin(a+2.1)*7,    h:Math.max(0,140-i*0.6),hm:140,d:0,a:'attack'},
    {s:2,n:'Toph', f:1,x:Math.cos(a*1.3+4)*4.5,z:Math.sin(a*1.3+4)*4.5,h:i>44?0:95,            hm:120,d:i>44?1:0,a:'idle'} ]}); }
  FALLBACK.match_replay={ ok:true, meta:{ uid:'demo', players:3, end_reason:'last-man',
    winners:['Aang'], duration:16, when:Date.now()/1000-3600 },
    frames:fr, events:[{t:11,kind:'kill',actor:'Korra',target:'Toph'},{t:6,kind:'hit',actor:'Aang',target:'Korra',value:30},
                       {t:14,kind:'hit',actor:'Aang',target:'Korra',value:45}] };
}

// ════════════════════════════════════════════════════════════════════════════
//  Pre-launch: account self-service (#1) · news + community (#4)
// ════════════════════════════════════════════════════════════════════════════
function _lserver(){ return ($('liServer').value.trim()) || SAVE.settings.server; }

// ── forgot password (login screen) ──
$('liForgot').addEventListener('click', e=>{ e.preventDefault(); const f=$('fpw'); f.hidden=!f.hidden;
  if(!f.hidden){ $('fpwId').value=$('liUser').value.trim(); $('fpwId').focus(); $('fpwMsg').textContent=''; } });
$('fpwGo').addEventListener('click', async ()=>{
  const ident=$('fpwId').value.trim(); const msg=$('fpwMsg');
  if(!ident){ msg.textContent='Enter your email or username.'; return; }
  const b=$('fpwGo'); b.disabled=true;
  try{ await invoke('account_forgot',{ host:_lserver(), ident }); }catch{}
  msg.textContent='If an account with an email on file exists, a reset link is on its way — check your inbox.';
  b.disabled=false;
});
$('fpwId').addEventListener('keydown', e=>{ if(e.key==='Enter') $('fpwGo').click(); });

// ── account panel (settings drawer) ──
$('apGo').addEventListener('click', async ()=>{
  const cur=$('apCur').value, neu=$('apNew').value, msg=$('apMsg');
  if(!cur||!neu){ msg.textContent='Fill in both fields.'; return; }
  const r=await invoke('account_change_password',{ host:SAVE.settings.server, name:SAVE.session.name, current:cur, new:neu }).catch(()=>null);
  if(r && r.ok){ msg.textContent='Password updated.'; $('apCur').value=''; $('apNew').value=''; sessionPass=neu; toast('Password updated.','ok'); }
  else msg.textContent=(r && r.error)||'Could not update password.';
});
$('apLogoutAll').addEventListener('click', async ()=>{
  const r=await invoke('session_logout_all',{ host:SAVE.settings.server, token:_tok() }).catch(()=>null);
  toast(r && r.ok ? 'Signed out on every device.' : 'Signed out.','ok'); closeDrawer(); signOut();
});
$('apDelete').addEventListener('click', ()=>{ const d=$('apDel'); d.hidden=!d.hidden; if(!d.hidden) $('apDelPw').focus(); });
$('apDelGo').addEventListener('click', async ()=>{
  const pw=$('apDelPw').value; if(!pw){ return; }
  const r=await invoke('account_delete',{ host:SAVE.settings.server, name:SAVE.session.name, password:pw }).catch(()=>null);
  if(r && r.ok){ toast('Your account has been deleted.','ok'); closeDrawer(); signOut(); }
  else toast((r && r.error)||'Could not delete account — check your password.','err');
});

// ── news + community + how-to-play ──
let _links={};
function openUrl(u){ if(u) invoke('open_url',{ url:u }).catch(()=>{}); }
async function loadNews(){
  let r; try{ r=await invoke('news',{ host:SAVE.settings.server }); }catch{ r=null; }
  if(!r || !r.ok) return;
  const items=r.items||[]; _links=r.links||{};
  const host=$('newsList');
  if(items.length){ host.innerHTML='';
    for(const it of items.slice(0,3)){
      const el=document.createElement('div'); el.className='news-item';
      el.innerHTML='<b></b><p></p>'; el.querySelector('b').textContent=it.title||''; el.querySelector('p').textContent=it.body||'';
      host.appendChild(el);
    }
    $('news').hidden=false;
  }
  $('cbDiscord').hidden=!_links.discord; $('cbSite').hidden=!_links.site;
}
$('cbDiscord').addEventListener('click', ()=>openUrl(_links.discord));
$('cbSite').addEventListener('click', ()=>openUrl(_links.site));
$('cbHow').addEventListener('click', ()=>$('helpModal').setAttribute('aria-hidden','false'));
$('helpClose').addEventListener('click', ()=>$('helpModal').setAttribute('aria-hidden','true'));
$('helpModal').addEventListener('click', e=>{ if(e.target===$('helpModal')) $('helpModal').setAttribute('aria-hidden','true'); });
$('helpDiscord').addEventListener('click', e=>{ e.preventDefault(); openUrl(_links.discord); });

// preview-only mock data for the pre-launch features (must be set BEFORE loadNews runs)
if(!HAS_TAURI){
  FALLBACK.account_forgot={ok:true}; FALLBACK.account_change_password={ok:true};
  FALLBACK.account_delete={ok:true}; FALLBACK.session_logout_all={ok:true,revoked:2}; FALLBACK.os_notify=null;
  FALLBACK.news={ ok:true, links:{ discord:'https://discord.gg/hK9ZkNS8Sp', site:'https://www.legends-awakened.com',
      support:'https://www.legends-awakened.com' }, items:[
    {date:'', title:'Welcome to Legends Awakened', body:'The 2008 Avatar arena brawler is back online — sign in, pick your bender, and queue up.'},
    {date:'', title:'Friends, parties & replays', body:'Group up with friends, invite them to a match, and watch your games back in 2D.'} ] };
}
loadNews();

// ── preview/demo harness (browser only, no Tauri) ────────────────────────────
// Drives the social panel into a named state for screenshots / design preview:
//   index.html?demo=friends | requests | blocked | menu | profile | add | invite
// Never runs in the real launcher (HAS_TAURI gates it). Uses the rich FALLBACK bundle.
if(!HAS_TAURI && /[?&]demo/.test(location.search)){
  const state = new URLSearchParams(location.search).get('demo') || 'friends';
  const _cw=$('cloneWizard'); if(_cw) _cw.style.display='none';
  if(state==='forgot'){                          // pre-login feature → keep the login card visible
    $('liUser').value='Aang'; $('liForgot').click();
  } else {
    SAVE.session = { name:'Aang', server:DEFAULT_SERVER, token:'demo' };
    showChip('Aang'); loginEl.classList.add('hide'); loginEl.style.display='none';
    setView('home');
    loadFriends().then(()=>{
      if(state==='requests') setTab('requests');
      else if(state==='blocked') setTab('blocked');
      else if(state==='add'){ $('frAdd').hidden=false; loadRecent(); }
      else if(state==='menu'){ const m=document.querySelector('.fr-row .more'); if(m) m.click(); }
      else if(state==='profile'){ const f=(frData.friends.find(x=>!x.favorite&&x.state!=='offline')||frData.friends[0]); if(f) openProfile(f); }
      else if(state==='invite'){ toast('BoulderKing invited you to a match','ok'); }
      else if(state==='career') openMyCareer();
      else if(state==='replay') openReplay('demo');
      else if(state==='party') pollParty();
      else if(state==='leaderboard') setView('ranks');
      else if(state==='help') $('cbHow').click();
      else if(state==='account') openDrawer();
    });
  }
}
