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
  // multi-character roster (browser preview): two created characters, Air active.
  characters_list: { ok:true, active_nation:4, characters:[
    { nation:2, name:'Ember',  appearance:'', level:5, xp:820, gold:150, wins:9, bending_ids:'1,2,7,8', active:false, created:true },
    { nation:4, name:'Hermit', appearance:'', level:3, xp:120, gold:40,  wins:2, bending_ids:'1,2,3,4', active:true,  created:true } ] },
  character_create: { ok:true }, character_rename: { ok:true }, character_delete: { ok:true },
  character_select: { ok:true, active_nation:4 },
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
  char:{ attrs:{} },                         // assigned attribute points (Character tab)
  settings:{
    queue:4, room:'', server:DEFAULT_SERVER, res:'1440x1080',
    hd:false, fullscreen:true, skip_menu:false, gamescope:false, gamescope_args:'', proton:false } };
function loadSave(){
  try{ const j = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    return { ...SAVE_DEFAULTS, ...j,
      board:{ ...SAVE_DEFAULTS.board, ...(j.board||{}) },
      match:{ ...SAVE_DEFAULTS.match, ...(j.match||{}) },
      char:{ ...SAVE_DEFAULTS.char, ...(j.char||{}), attrs:{ ...((j.char||{}).attrs||{}) } },
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
  // Cap the backing store at ~1120px wide (the pre-1456 window size). WebKitGTK software-composites
  // this canvas every frame, so a bigger buffer steals GPU/CPU — keeping it at the old size means the
  // 30%-bigger window doesn't make the launcher heavier (CSS still stretches it to fill, same look).
  const scale = Math.min(1, 1120 / cw);
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
function setElement(el, animate){
  const changed = (el !== SAVE.element);
  app.setAttribute('data-el', el);
  emblemUse.setAttribute('href', '#el-'+el);
  document.querySelector('#login .mark use')?.setAttribute('href','#el-'+el);
  document.querySelectorAll('.theme-el use').forEach(u=>u.setAttribute('href','#el-'+el));   // Play/Training element motifs
  const ne=$('neEmblem'); if(ne){ ne.setAttribute('class','el el-'+el+' cr-emblem'); ne.querySelector('use').setAttribute('href','#el-'+el); }
  if(animate && changed) spinElementCircle();   // wheel spins right + snaps onto the new element
  currentElement=el; initParticles();
  SAVE.element=el; persist();
  if(typeof renderCharacter==='function' && typeof curView!=='undefined' && curView==='character') renderCharacter();
}
// the nav element-circle does a satisfying spin-and-snap when you swap bender
function spinElementCircle(){
  const nec=$('neCircle'); if(!nec) return;
  nec.classList.remove('swap'); void nec.offsetWidth;   // restart the keyframes
  nec.classList.add('swap');
  nec.addEventListener('animationend', ()=>nec.classList.remove('swap'), {once:true});
}
// clicking the central circle also pops the quick-swap picker (in addition to hover)
{ const _ne=$('neCircle'); if(_ne) _ne.addEventListener('click', e=>{ e.stopPropagation();
    const host=$('navEl'); if(host){ clearTimeout(_flyTimer); if(typeof syncFly==='function') syncFly(); host.classList.toggle('fly-open'); } }); }

// ── toast ────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, kind){
  const t=$('toast'); t.textContent=msg; t.className='toast show '+(kind||'');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>{ t.className='toast'; }, 4200);
}

// ── bottom-right profile bar + account dropdown ──────────────────────────────
const userbar=$('userbar'), acctMenu=$('acctMenu');
function showChip(name){
  const nm=$('ubName'); if(nm) nm.textContent = name || 'Sign in';
  const av=$('ubAv');   if(av){ av.textContent = name ? initials(name) : '?'; av.style.setProperty('--ah', nameHue(name||'?')); }
  const st=$('ubState');if(st) st.textContent = name ? 'Online' : 'Offline';
  if(userbar) userbar.classList.toggle('online', !!name);
  if(typeof renderMe==='function') renderMe();
  if(typeof syncCharTab==='function') syncCharTab();   // nav tab shows your character name
  if(typeof renderCharacter==='function' && typeof curView!=='undefined' && curView==='character') renderCharacter();
}
function openAcctMenu(){
  const s=SAVE.session, name=(s&&s.name)||'';
  $('amName').textContent = name || 'Guest';
  $('amServer').textContent = s ? 'Online' : 'Signed out';
  const av=$('amAv'); if(av){ av.textContent = s ? initials(name) : '?'; av.style.setProperty('--ah', nameHue(s?name:'?')); }
  acctMenu.classList.toggle('signedout', !s);
  acctMenu.classList.toggle('open');
}
// the profile bar simply brings up the social panel
if(userbar) userbar.addEventListener('click', e=>{ e.stopPropagation(); toggleSocial(); });
// account actions live inside the social screen: click your own profile row (top of the panel) → account menu
const _frMeAcct=$('frMe'); if(_frMeAcct) _frMeAcct.addEventListener('click', e=>{
  const col=$('frCollapse'); if(col && col.contains(e.target)) return;   // the collapse chevron still just hides the panel
  e.stopPropagation(); openAcctMenu();
});
document.addEventListener('click', ()=>acctMenu.classList.remove('open'));
acctMenu.addEventListener('click', e=>e.stopPropagation());

// ── social rail: persistent friends panel + its nav toggle ───────────────────
// The panel (#social) shows on EVERY page (it lives outside the view router). The
// nav button toggles it; default = open. While it's closed, unseen notifications
// (incoming friend requests + match/party invites) badge the toggle button.
const navSocial=$('navSocial'), socialBadge=$('socialBadge');
const isSocialOpen = () => !app.classList.contains('social-closed');
function setSocialOpen(open){
  app.classList.toggle('social-closed', !open);
  SAVE.settings.socialOpen = !!open; persist();   // launcher-UI pref → persist() only (not a game setting)
  updateSocialBadge();
}
function toggleSocial(){ setSocialOpen(!isSocialOpen()); }
if(navSocial) navSocial.addEventListener('click', e=>{ e.stopPropagation(); toggleSocial(); });
const _frCollapse=$('frCollapse'); if(_frCollapse) _frCollapse.addEventListener('click', ()=>setSocialOpen(false));
if(SAVE.settings.socialOpen!==true) app.classList.add('social-closed');   // default closed; the bottom-left profile brings it up

// own-profile header at the top of the panel (avatar · name · online/offline)
function renderMe(){
  const s=SAVE.session, signedIn=!!(s&&s.name), name=(s&&s.name)||'';
  const av=$('frMeAv'); if(av){ av.textContent=signedIn?initials(name):'?'; av.style.setProperty('--ah', nameHue(signedIn?name:'?')); }
  const nm=$('frMeName'); if(nm) nm.textContent = signedIn ? name : 'Sign in';
  const stx=$('frMeState'); if(stx) stx.textContent = signedIn ? 'Online' : 'Offline';
  const me=$('frMe'); if(me) me.classList.toggle('online', signedIn);
}
// unseen-notification count → only shown while the panel is closed
function notifCount(){ let n=0;
  try{ n += (frData.incoming||[]).length + (frData.invites||[]).length; }catch{}
  try{ if(_lastPartyInv) n+=1; }catch{}
  return n; }
function updateSocialBadge(){
  if(!socialBadge) return;
  const n=notifCount(), show = n>0 && !isSocialOpen();
  socialBadge.hidden=!show; if(show) socialBadge.textContent = n>9?'9+':String(n);
}

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
  renderMe(); updateSocialBadge();
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
  renderMe();
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
  updateSocialBadge();
}

// game invites — a prominent strip above whichever tab is open
function renderInvites(){
  const host=$('frInvites'); host.innerHTML='';
  for(const o of _outInvites){                    // outgoing: "waiting for them to accept" + cancel
    const el=document.createElement('div'); el.className='fr-invite out';
    el.innerHTML = avatarHTML(o.to) +
      `<div class="meta"><b></b><small>waiting to accept… · ${o.size||2}-player</small></div>`+
      `<span class="ld-spin"></span><button class="no" title="Cancel invite">✕</button>`;
    el.querySelector('b').textContent=o.disp||o.to;
    el.querySelector('.no').onclick=()=>cancelInvite(o.to);
    host.appendChild(el);
  }
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
  // Profile is a centered MODAL with its own backdrop (the old positioned popover was auto-closed by the
  // document click handler the instant you opened it from the context menu — its button isn't a .fr-row).
  _profile=document.createElement('div'); _profile.className='fr-modal'; _profile.hidden=true; document.body.appendChild(_profile);
  _profile.addEventListener('click', e=>{ if(e.target===_profile) _profile.hidden=true; });   // backdrop click closes
  document.addEventListener('click', e=>{ if(_menu && !_menu.contains(e.target)) _menu.hidden=true; });
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
  const acts = f.self ? '' :
    `<div class="pacts">`+
      `<button class="pa inv">⚔ Invite to match</button>`+
      `<button class="pa fav">${f.favorite?'★ Favorited':'☆ Favorite'}</button>`+
      `<button class="pa nick">✎ Nickname</button>`+
    `</div>`+
    `<div class="pacts2"><button class="pa rem">Remove friend</button><button class="pa blk">Block</button></div>`;
  _profile.innerHTML =
    `<div class="fr-profile">`+
      `<button class="fr-x" title="Close">✕</button>`+
      `<div class="ph">${avatarHTML(f.name,true)}<div class="pid"><b></b><span class="pstate ${f.state}"></span></div></div>`+
      `<div class="prows"></div>`+ acts +
    `</div>`;
  const card=_profile.querySelector('.fr-profile');
  card.querySelector('.pid b').textContent = dispName(f) + (f.nickname?` (${f.name})`:'');
  card.querySelector('.pstate').textContent = statusText(f);
  const rows=card.querySelector('.prows');
  const addr=(k,v)=>{ const d=document.createElement('div'); d.className='prow'; d.innerHTML=`<span>${k}</span><b></b>`; d.querySelector('b').textContent=v; rows.appendChild(d); };
  addr('Status', STATE_WORD[f.state]||'Offline');
  if(f.last_seen) addr('Last seen', relTime(f.last_seen));
  if(f.since) addr('Friends since', new Date(Number(f.since)*1000).toLocaleDateString());
  _fillCareer(card, f.name);                       // async: append W/L · K/D · damage · streak + recent matches
  card.querySelector('.fr-x').onclick=()=>{ _profile.hidden=true; };
  if(!f.self){
    card.querySelector('.inv').onclick=()=>{ _profile.hidden=true; inviteFriend(f); };
    card.querySelector('.fav').onclick=()=>toggleFav(f);
    card.querySelector('.nick').onclick=()=>{ _profile.hidden=true; openNickname(f); };
    card.querySelector('.rem').onclick=()=>{ _profile.hidden=true; removeFriend(f.name); };
    card.querySelector('.blk').onclick=()=>{ _profile.hidden=true; blockFriend(f.name); };
  }
  _profile.hidden=false;
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
  if(r && r.ok){ f.favorite=on; toast(on?('Added '+dispName(f)+' to favorites'):'Removed favorite','ok');
    const fb=_profile && _profile.querySelector('.fav'); if(fb) fb.textContent=on?'★ Favorited':'☆ Favorite';
    loadFriends(); }
  else toast((r && r.error)||'Sign in to manage favorites.','err'); }
async function setNickname(who, nickname){ const r=await sx('friend_nickname',{ who, nickname });
  if(r && r.ok){ toast(nickname?('Nickname set'):'Nickname cleared','ok'); loadFriends(); } }

// invites: send uses the Match-tab room/size (or the server mints a private room). The sender then
// WAITS — a "waiting to accept" card shows + we poll /invites/outgoing; when the friend accepts, BOTH
// sides launch into the same room. Auto-cancels after 60s or if the friend declines.
let _outInvites=[];                              // [{to, room, size, deadline}]
let _outInviteTimer=null;
async function inviteFriend(f){
  closeMenus();
  const room=(SAVE.settings.room||'').trim(), size=SAVE.settings.queue||2;
  const r=await sx('invite_send',{ to:f.name, room, size });
  if(!(r && r.ok)){ toast((r && r.error) || 'Could not invite.','err'); return; }
  _outInvites = _outInvites.filter(o=>o.to!==f.name);
  _outInvites.push({ to:f.name, disp:dispName(f), room:r.room_code||room, size:r.size||size, deadline:Date.now()+60000 });
  toast('Invite sent to '+dispName(f)+' — waiting for them to accept…','ok');
  renderInvites(); startInviteWatch();
}
function startInviteWatch(){ if(_outInviteTimer||!_outInvites.length) return;
  _outInviteTimer=setInterval(pollOutgoingInvites, 3000); pollOutgoingInvites(); }
function stopInviteWatch(){ if(_outInviteTimer){ clearInterval(_outInviteTimer); _outInviteTimer=null; } }
async function pollOutgoingInvites(){
  if(!_outInvites.length){ stopInviteWatch(); return; }
  const now=Date.now();
  // local 60s timeout → cancel server-side (so the friend's incoming card clears too) + drop the card
  for(const o of _outInvites.slice()) if(now>o.deadline){
    sx('invite_cancel',{ to:o.to }); _outInvites=_outInvites.filter(x=>x!==o);
    toast('Invite to '+o.disp+' timed out','err');
  }
  if(!_outInvites.length){ stopInviteWatch(); renderInvites(); return; }
  const r=await sx('invite_outgoing'); if(!(r && r.ok)){ renderInvites(); return; }
  const live=new Map((r.invites||[]).map(i=>[i.to, i]));
  for(const o of _outInvites.slice()){
    const srv=live.get(o.to);
    if(srv && srv.accepted){                      // accepted → launch the sender into the shared room
      _outInvites=_outInvites.filter(x=>x!==o);
      toast(o.disp+' accepted — launching!','ok');
      play(srv.room_code||o.room, srv.size||o.size);
    } else if(!srv){                              // row gone server-side = declined (or it expired)
      _outInvites=_outInvites.filter(x=>x!==o);
      toast(o.disp+' declined your invite','err');
    }
  }
  if(!_outInvites.length) stopInviteWatch();
  renderInvites();
}
function cancelInvite(name){
  const o=_outInvites.find(x=>x.to===name);
  _outInvites=_outInvites.filter(x=>x.to!==name); sx('invite_cancel',{ to:name });
  if(!_outInvites.length) stopInviteWatch();
  toast('Invite to '+((o&&o.disp)||name)+' cancelled','ok'); renderInvites();
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
setInterval(()=>{ if(!document.hidden && _tok()) loadFriends(); }, 20000);   // panel is global now → poll whenever signed in
$('liPass').addEventListener('keydown', e=>{ if(e.key==='Enter') signIn(); });
$('liUser').addEventListener('keydown', e=>{ if(e.key==='Enter') $('liPass').focus(); });
$('liServer').addEventListener('input', ()=>{ SAVE.settings.server=$('liServer').value.trim(); saveSettings(); });
$('amSignout').addEventListener('click', signOut);

// ── settings (now a content view, opened by the top-right gear pill) ───────────
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
  const dm=$('drMe'); if(dm){ dm.hidden=!signedIn;
    if(signedIn){ const nm=SAVE.session.name; $('drMeName').textContent=nm; $('drMeState').textContent='Online';
      const a=$('drMeAv'); a.textContent=initials(nm); a.style.setProperty('--ah', nameHue(nm)); } }
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
// Settings is a view now, TOGGLED by the titlebar gear (like the social panel): click to
// open, click again to return to the view you came from.
let _viewBeforeSettings = 'home';
function openSettings(){ if(curView!=='settings'){ _viewBeforeSettings = curView; setView('settings'); } }
function toggleSettings(){ if(curView==='settings') setView(_viewBeforeSettings); else openSettings(); }
function openDrawer(){ openSettings(); }                 // legacy call sites (account menu, demo)
function closeDrawer(){ if(curView==='settings') setView(_viewBeforeSettings); }
$('navSettings').addEventListener('click', e=>{ e.preventDefault(); toggleSettings(); });

// ── view router: Home / Match / Ranks ────────────────────────────────────────────
// (Training is no longer its own view — it's the "Bot Game" mode inside Match.)
const NAV = { home:'navHome', character:'navCharacter', match:'navMatch', ranks:'navNews' };   // left links
let curView = 'home';
function setView(v){
  curView = v;
  for(const id of ['home','character','match','ranks','settings']) $('view-'+id).hidden = (id !== v);
  document.querySelectorAll('.nav a').forEach(a=>a.classList.remove('on'));   // .nav a (char link is wrapped in .char-nav)
  if(NAV[v]) $(NAV[v]).classList.add('on');
  $('navSettings').classList.toggle('on', v==='settings');           // the top-right gear pill
  if(v==='ranks') renderBoard();
  if(v==='match') syncMatch();
  if(v==='settings') syncDrawer();
  if(v==='character') loadCharacters();
  if(v==='home' && typeof loadFriends==='function') loadFriends();
  if(typeof setStatus==='function' && !_inGame) setStatus(v==='settings' ? 'in settings' : 'in lobby');
  updateCTA();
  if(typeof positionNavDot==='function') positionNavDot(true);   // ride the active-tab marker along the line
}
$('navHome').addEventListener('click', e=>{ e.preventDefault(); setView('home'); });
$('navCharacter').addEventListener('click', e=>{ e.preventDefault(); setView('character'); });
$('navMatch').addEventListener('click', e=>{ e.preventDefault(); setView('match'); });
$('navNews').addEventListener('click', e=>{ e.preventDefault(); setView('ranks'); });
{ const _t=$('navTourney'); if(_t) _t.addEventListener('click', e=>{ e.preventDefault(); toast('Tournaments are coming soon','info'); }); }

// ── Character tab: radial element selector + bending loadout + assignable attributes ──────
// Scaffolding for the in-game character (loadout/attrs are local previews for now). The radial
// re-themes the launcher to the chosen nation (setElement); the tab + roster pull your name.
const NATIONS = { fire:'Firebender', water:'Waterbender', earth:'Earthbender', air:'Airbender' };
// nation ids on the wire (matches the gateway + game): 1=Earth 2=Fire 3=Water 4=Air.
const NATION_ID = { earth:1, fire:2, water:3, air:4 };
const EL_BY_NATION = { 1:'earth', 2:'fire', 3:'water', 4:'air' };
// Skills are 8 shared FAMILIES, reskinned per nation. The engine only knows families;
// these names are a pure launcher-side display layer. A loadout is 4 families (default 1,2,3,4).
const SKILL_FAMILY = {1:'Line',2:'Missile',3:'Cone',4:'Grenade',5:'Ground AoE',6:'Full AoE',7:'Heal',8:'Teleport'};
const SKILL_NAMES = {
  fire:  {1:'Fire Whip',  2:'Fireball',   3:'Flame Breath', 4:'Fire Bomb',   5:'Wall of Flame', 6:'Firestorm',  7:'Warmth',         8:'Flame Step'},
  water: {1:'Water Whip', 2:'Ice Spike',  3:'Water Spout',  4:'Ice Bomb',    5:'Tidal Surge',   6:'Maelstrom',  7:'Healing Waters', 8:'Mist Step'},
  earth: {1:'Stone Lance',2:'Boulder',    3:'Gravel Blast', 4:'Rock Charge', 5:'Tremor',        6:'Earthquake', 7:'Rejuvenate',     8:'Earth Glide'},
  air:   {1:'Air Slice',  2:'Wind Blast', 3:'Gale',         4:'Air Pocket',  5:'Cyclone',       6:'Tempest',    7:'Second Wind',    8:'Air Scooter'},
};
const skillName = (el, fam) => (SKILL_NAMES[el] && SKILL_NAMES[el][fam]) || ('Family '+fam);
// ── multi-character roster (up to 4 custom characters, one per nation) ──────────
// CHARS mirrors the gateway: the account's created characters + the active nation.
// loaded=false → offline / not signed in / gateway without the endpoints; we then fall
// back to the single-slot (session name) view so the tab still works.
let CHARS = { list:[], active:null, loaded:false };
const activeChar = () => CHARS.loaded ? (CHARS.list.find(c=>c.nation===CHARS.active) || null) : null;
const CHAR_ATTRS = [['power','Power'],['speed','Speed'],['defense','Defense'],['chi','Chi'],['vitality','Vitality']];
const ATTR_BASE = 3, ATTR_MAX = 10, ATTR_POOL = 5;
const charName = () => (SAVE.session && SAVE.session.name) || 'Character';
const charDisplayName = () => { const c=activeChar(); return c ? c.name : charName(); };
function syncCharTab(){ const a=$('navCharacter'); if(a) a.textContent = 'Character'; }  /* tab stays "Character"; the real name lives in the hover flyout */
function renderRoster(){
  const host=$('charRoster'); if(!host) return;
  if(!CHARS.loaded){                                    // offline / legacy — single slot (previous behavior)
    const nm=charName();
    host.innerHTML =
      `<button class="char-slot on" title="${esc(nm)}"><span class="cs-av" style="--ah:${nameHue(nm)}">${initials(nm)}</span></button>`
      + `<button class="char-slot add" data-act="add" title="New character">+</button>`;
    return;
  }
  let html = CHARS.list.map(c=>{
    const el=EL_BY_NATION[c.nation], on=(c.nation===CHARS.active);
    return `<button class="char-slot cslot${on?' on':''}" data-nation="${c.nation}" `
      + `title="${esc(c.name)} · ${NATIONS[el]} · Lv ${c.level}${on?' — click to rename/delete':''}">`
      + `<span class="cs-av el-${el}" style="--ah:${nameHue(c.name)}">${initials(c.name)}</span></button>`;
  }).join('');
  if(CHARS.list.length < 4) html += `<button class="char-slot add" data-act="add" title="Create a character">+</button>`;
  host.innerHTML = html;
}
function renderLoadout(){
  const c=activeChar(), el=(c?EL_BY_NATION[c.nation]:SAVE.element), host=$('loadout'); if(!host) return;
  const fams=(c&&c.bending_ids?String(c.bending_ids):'1,2,3,4').split(',').map(x=>parseInt(x,10)).filter(x=>x>0).slice(0,4);
  while(fams.length<4) fams.push([1,2,3,4][fams.length]);
  host.innerHTML = fams.map((fam,i)=>{
    const nm=skillName(el,fam);
    return `<button class="skill" title="${esc(nm)} — loadout editing coming soon">`
    + `<span class="sk-key">${i+1}</span>`
    + `<span class="sk-ic"><svg class="el el-${el}" width="26" height="26"><use href="#el-${el}"/></svg></span>`
    + `<b>${esc(nm)}</b><small>${esc(SKILL_FAMILY[fam]||'Skill')}</small></button>`;
  }).join('');
}
function renderAttrs(){
  const a=SAVE.char.attrs||(SAVE.char.attrs={}), host=$('attrs'); if(!host) return;
  const assigned=CHAR_ATTRS.reduce((s,[k])=>s+(a[k]||0),0), pool=ATTR_POOL-assigned;
  const pe=$('attrPoints'); if(pe){ pe.textContent=pool+' point'+(pool===1?'':'s'); pe.classList.toggle('spent',pool<=0); }
  host.innerHTML = CHAR_ATTRS.map(([k,label])=>{
    const v=ATTR_BASE+(a[k]||0), pct=Math.round(v/ATTR_MAX*100);
    return `<div class="attr" data-k="${k}"><span class="attr-name">${label}</span>`
      + `<span class="attr-bar"><span class="attr-fill" style="width:${pct}%"></span></span>`
      + `<span class="attr-ctl"><button class="attr-btn dec"${(a[k]||0)<=0?' disabled':''}>&minus;</button>`
      + `<span class="attr-val">${v}</span>`
      + `<button class="attr-btn inc"${(pool<=0||v>=ATTR_MAX)?' disabled':''}>+</button></span></div>`;
  }).join('');
}
function renderCharacter(){
  const c=activeChar(), el=(c?EL_BY_NATION[c.nation]:SAVE.element);
  $('charName').textContent = charDisplayName();
  $('charElement').textContent = c ? (NATIONS[el]+' · Lv '+c.level) : (NATIONS[SAVE.element] || 'Choose your bending');
  ['crEmblem','ciEmblem'].forEach(id=>{ const em=$(id); if(em){ em.setAttribute('class','el el-'+el+' cr-emblem'); em.querySelector('use').setAttribute('href','#el-'+el); } });
  document.querySelectorAll('#charRadial .cr-node').forEach(n=>n.classList.toggle('on', n.dataset.el===el));
  renderRoster(); renderLoadout(); renderAttrs();
}
// pull the account's roster from the gateway; theme the launcher to the active character.
async function loadCharacters(){
  const r = await sx('characters_list');
  if(r && r.ok && Array.isArray(r.characters)){
    CHARS.list = r.characters.slice().sort((a,b)=>a.nation-b.nation);
    CHARS.active = r.active_nation || (r.characters.find(c=>c.active)||{}).nation || null;
    CHARS.loaded = true;
    const el = EL_BY_NATION[CHARS.active];
    if(el && el!==SAVE.element) setElement(el, false);      // theme follows the active character
  } else {
    CHARS = { list:[], active:null, loaded:false };
  }
  if(typeof syncFly==='function') syncFly();
  renderCharacter();
}
// select a nation-character = set active on the gateway + project it for the next launch.
async function doSelect(nation){
  const r = await sx('character_select', { nation });
  if(r && r.ok){
    CHARS.active = nation; CHARS.list.forEach(c=>c.active=(c.nation===nation));
    const el=EL_BY_NATION[nation]; if(el) setElement(el, true);
    if(typeof syncFly==='function') syncFly();
    renderCharacter();
    return true;
  }
  toast((r&&r.error)||'Could not switch character.','err'); return false;
}
// radial: pick a nation → select its character if it exists, else start creating one.
$('charRadial').addEventListener('click', e=>{ const n=e.target.closest('.cr-node'); if(!n) return;
  const el=n.dataset.el, nation=NATION_ID[el];
  if(CHARS.loaded){
    if(CHARS.list.some(c=>c.nation===nation)){ if(nation!==CHARS.active) doSelect(nation); }
    else openCharModal('create', nation);
  } else { setElement(el, true); renderCharacter(); }
});
$('attrs').addEventListener('click', e=>{ const b=e.target.closest('.attr-btn'); if(!b||b.disabled) return;
  const k=b.closest('.attr').dataset.k, a=SAVE.char.attrs;
  if(b.classList.contains('inc')) a[k]=(a[k]||0)+1; else a[k]=Math.max(0,(a[k]||0)-1);
  persist(); renderAttrs(); });
$('loadout').addEventListener('click', e=>{ if(e.target.closest('.skill')) toast('Loadout editing is coming soon.','ok'); });
// roster: "+" creates, a slot selects, clicking the active slot again opens rename/delete.
$('charRoster').addEventListener('click', e=>{
  if(e.target.closest('.char-slot.add')){ openCharModal('create'); return; }
  const slot=e.target.closest('.char-slot[data-nation]'); if(!slot) return;
  const nation=+slot.dataset.nation;
  if(CHARS.loaded && nation===CHARS.active) openCharModal('edit', nation);
  else doSelect(nation);
});

// hover the central element circle → the quick-swap "+" picker blooms open (hover-intent, so a
// brief gap between circle and menu doesn't snap it shut). Clicking an element swaps your bender.
const navEl=$('navEl'), charFly=$('charFly'); let _flyTimer;
const ELEMENTS = ['fire','water','earth','air'];
function syncFly(){
  // the picker shows only the three NON-active elements; the active one lives in the circle above
  const others = ELEMENTS.filter(e=>e!==SAVE.element);
  document.querySelectorAll('#charFly .cf-el').forEach((b,i)=>{
    const el = others[i]; if(!el) return;
    b.dataset.el = el;
    b.title = el[0].toUpperCase()+el.slice(1);
    const svg=b.querySelector('svg'); svg.setAttribute('class','el el-'+el);
    svg.querySelector('use').setAttribute('href','#el-'+el);
  });
}
if(navEl){
  navEl.addEventListener('mouseenter', ()=>{ clearTimeout(_flyTimer); syncFly(); navEl.classList.add('fly-open'); });
  navEl.addEventListener('mouseleave', ()=>{ _flyTimer=setTimeout(()=>navEl.classList.remove('fly-open'), 160); });
}
if(charFly) charFly.addEventListener('click', e=>{ const b=e.target.closest('.cf-el'); if(!b) return; e.stopPropagation();
  const el=b.dataset.el, nation=NATION_ID[el];
  if(CHARS.loaded){
    if(CHARS.list.some(c=>c.nation===nation)){
      if(nation!==CHARS.active){ const nm=(CHARS.list.find(c=>c.nation===nation)||{}).name; doSelect(nation); toast('Now playing '+esc(nm||el),'ok'); }
    } else { setView('character'); openCharModal('create', nation); }
  } else if(el!==SAVE.element){ setElement(el, true); toast('Now bending '+el[0].toUpperCase()+el.slice(1),'ok'); }
  syncFly();
  if(typeof renderCharacter==='function' && curView==='character') renderCharacter();
  clearTimeout(_flyTimer); navEl.classList.remove('fly-open');
});

// ── character create / rename / delete dialog (reuses the .modal visual style) ──
let _cmMode='create', _cmNation=null;
function openCharModal(mode, nation){
  if(!CHARS.loaded){ toast('Sign in to manage characters.','err'); return; }
  _cmMode=mode; _cmNation = (mode==='edit') ? nation : (nation||null);
  const created=new Set(CHARS.list.map(c=>c.nation));
  $('cmNations').innerHTML = [1,2,3,4].map(n=>{ const el=EL_BY_NATION[n], made=created.has(n);
    const dis = (mode==='create') ? made : true;      // create: only uncreated pickable; edit: nation fixed
    return `<button class="cm-el el-${el}${made?' made':''}" data-nation="${n}" ${dis?'disabled':''} title="${NATIONS[el]}${made?' — already created':''}">`
      + `<span class="cm-emb"><svg class="el el-${el}"><use href="#el-${el}"/></svg></span>`
      + `<b>${NATIONS[el].replace('bender','')}</b></button>`; }).join('');
  const c = (mode==='edit') ? CHARS.list.find(x=>x.nation===nation) : null;
  $('cmTitle').textContent = (mode==='edit') ? 'Edit character' : 'New character';
  $('cmName').value = c ? c.name : '';
  $('cmSave').textContent = (mode==='edit') ? 'Save' : 'Create';
  const del=$('cmDelete'); del.hidden = (mode!=='edit'); del.dataset.armed=''; del.textContent='Delete';
  $('cmErr').hidden=true; $('cmErr').textContent='';
  syncCmNation();
  $('charModal').setAttribute('aria-hidden','false');
  setTimeout(()=>$('cmName').focus(), 40);
}
function syncCmNation(){ document.querySelectorAll('#cmNations .cm-el').forEach(b=>b.classList.toggle('sel', +b.dataset.nation===_cmNation)); }
function closeCharModal(){ $('charModal').setAttribute('aria-hidden','true'); }
function _cmShowErr(m){ const e=$('cmErr'); e.textContent=m; e.hidden=false; }
async function cmSave(){
  const name=$('cmName').value.trim();
  if(!name) return _cmShowErr('Enter a name.');
  if(_cmMode==='create'){
    if(!_cmNation) return _cmShowErr('Pick a nation.');
    const r=await sx('character_create',{ nation:_cmNation, name });
    if(r&&r.ok){ closeCharModal(); await loadCharacters(); if(CHARS.active!==_cmNation) await doSelect(_cmNation); toast('Created '+esc(name),'ok'); }
    else _cmShowErr((r&&r.error)||'Could not create character.');
  } else {
    const r=await sx('character_rename',{ nation:_cmNation, name });
    if(r&&r.ok){ closeCharModal(); await loadCharacters(); toast('Renamed to '+esc(name),'ok'); }
    else _cmShowErr((r&&r.error)||'Could not rename.');
  }
}
async function cmDelete(){
  const del=$('cmDelete');
  if(!del.dataset.armed){ del.dataset.armed='1'; del.textContent='Confirm delete'; return; }   // two-step guard
  const r=await sx('character_delete',{ nation:_cmNation });
  if(r&&r.ok){ closeCharModal(); await loadCharacters(); toast('Character deleted','ok'); }
  else _cmShowErr((r&&r.error)||'Could not delete.');
}
{ const cm=$('charModal');
  if(cm){
    $('cmNations').addEventListener('click', e=>{ const b=e.target.closest('.cm-el'); if(!b||b.disabled) return; _cmNation=+b.dataset.nation; syncCmNation(); });
    $('cmSave').addEventListener('click', cmSave);
    $('cmDelete').addEventListener('click', cmDelete);
    $('cmCancel').addEventListener('click', closeCharModal);
    cm.addEventListener('click', e=>{ if(e.target===cm) closeCharModal(); });
    $('cmName').addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); cmSave(); } else if(e.key==='Escape') closeCharModal(); });
  }
}

// draw the running underline: flat under the tabs, rising into a hump around the element circle
function layoutNavLine(){
  const tabs=$('navTabs'), el=$('navEl'), line=$('navLine'), path=$('navLinePath'), match=$('navMatch');
  if(!tabs||!el||!line||!path) return;
  const tr=tabs.getBoundingClientRect(), er=el.getBoundingClientRect();
  const W=Math.max(1,Math.round(tr.width)), H=44;
  const cx=Math.round(er.left+er.width/2-tr.left);   // element-circle centre, relative to the tab row
  const base=H-2, crown=-13;                         // baseline + how high the canopy arcs OVER the group
  // the line arcs up and OVER both the circle and Match, so they nestle inside the groove beneath it
  const er2=el.getBoundingClientRect();
  const gL = Math.round(er2.left-tr.left);            // circle's left edge (left edge of the group)
  let gR = cx+34;                                     // Match's right edge (right edge of the group)
  if(match){ const m=match.getBoundingClientRect(); gR=Math.round(m.right-tr.left); }
  const gc = (gL+gR)/2;                               // centre of the circle+Match pair
  const hw = (gR-gL)/2 + 4;                           // half-width of the flat crown (snug to the pair)
  const rw = 30;                                      // ramp width — equal on both sides so the notch is symmetric
  const cL = Math.round(gc-hw), cR = Math.round(gc+hw);   // flat crown span
  const bL = cL-rw, bR = cR+rw;                       // where the ramps meet the baseline
  line.setAttribute('viewBox',`0 0 ${W} ${H}`); line.setAttribute('width',W); line.setAttribute('height',H);
  path.setAttribute('d',
    `M0 ${base} H ${bL} `+                                            // baseline under Home / Character
    `C ${bL+Math.round(rw*0.55)} ${base} ${cL-Math.round(rw*0.55)} ${crown} ${cL} ${crown} `+  // ramp up
    `H ${cR} `+                                                       // canopy held symmetrically over the pair
    `C ${cR+Math.round(rw*0.55)} ${crown} ${bR-Math.round(rw*0.55)} ${base} ${bR} ${base} `+   // ramp down
    `H ${W}`);                                                        // baseline run-in to Leaderboard
  positionNavDot();
}
// the glowing marker RIDES ALONG the nav line (x + y) to sit under the active tab —
// so on the Match tab it travels up the ramp and onto the canopy, tracing the curve.
let _dotRAF=null, _dotDist=null;
function _pathLenAtX(path, x){                 // x is monotonic along the path → binary-search its length
  const L=path.getTotalLength(); let lo=0, hi=L;
  for(let i=0;i<26;i++){ const mid=(lo+hi)/2; (path.getPointAtLength(mid).x < x) ? (lo=mid) : (hi=mid); }
  return (lo+hi)/2;
}
function _placeDotAt(dist){
  const tabs=$('navTabs'), dot=$('navDot'), path=$('navLinePath'), svg=$('navLine');
  if(!tabs||!dot||!path||!svg) return;
  const p=path.getPointAtLength(dist), tr=tabs.getBoundingClientRect(), sr=svg.getBoundingClientRect();
  dot.style.left=(sr.left + p.x - tr.left)+'px';    // svg-local (viewBox) coords map 1:1 to CSS px
  dot.style.top =(sr.top  + p.y - tr.top )+'px';
}
function positionNavDot(animate){
  const tabs=$('navTabs'), dot=$('navDot'), path=$('navLinePath'), svg=$('navLine');
  if(!tabs||!dot||!path||!svg) return;
  const on=tabs.querySelector('.nav a.on') || document.querySelector('.nav a.on');
  if(!on){ dot.classList.remove('show'); return; }
  const ar=on.getBoundingClientRect(), sr=svg.getBoundingClientRect();
  const target=_pathLenAtX(path, ar.left + ar.width/2 - sr.left);
  dot.classList.add('show');
  if(_dotRAF){ cancelAnimationFrame(_dotRAF); _dotRAF=null; }
  if(!animate || _dotDist===null){ _dotDist=target; _placeDotAt(target); return; }   // snap on first paint / resize
  const from=_dotDist, to=target, dur=380, t0=performance.now(), ease=x=>1-Math.pow(1-x,3);
  (function step(now){
    const k=Math.min(1,(now-t0)/dur), d=from+(to-from)*ease(k);
    _dotDist=d; _placeDotAt(d);
    _dotRAF = k<1 ? requestAnimationFrame(step) : null;
  })(performance.now());
}
window.addEventListener('resize', layoutNavLine);
window.addEventListener('load', ()=>setTimeout(layoutNavLine,60));
try{ document.fonts.ready.then(()=>setTimeout(layoutNavLine,20)); }catch(e){}
setTimeout(layoutNavLine, 400);

// The bottom-right button is one contextual CTA:
//   Home / Ranks  → "MATCH"   (jump to the Match tab)
//   Match (quick/custom/bots) → "PLAY"   Match (ranked) → "PLAY RANKED" / "SEARCHING…"
let _playMode = 'quick';                      // quick | ranked | custom | bots (set from SAVE on load)
function ctaMode(){
  if(curView==='match') return _playMode==='ranked' ? 'ranked' : 'play';
  if(curView==='home') return 'goto';
  return 'hidden';                           // ranks: viewing only — no action button
}
function updateCTA(){
  app.classList.toggle('show-play', curView==='match');    // PLAY button shows ONLY on the Match tab
  if(curView!=='match') return;
  if($('play').disabled) return;             // mid-launch: leave the label alone
  setPlayLabel(_playMode==='ranked' ? (_rankedSearching ? 'SEARCHING…' : 'PLAY RANKED') : 'PLAY');
}
function onCTA(){
  const m=ctaMode();
  if(m==='hidden') return;
  if(m==='goto'){ setView('match'); return; }
  // Match view — act on the selected mode.
  if(_playMode==='bots'){                      // Bot Game: 1 human + N AI (transient room, never persisted)
    const count = Math.max(1, (SAVE.match.tsize||2) - 1);
    const room = SAVE.match.bot + ':' + SAVE.match.diff + (count>1 ? ':'+count : '');
    play(room, SAVE.match.tsize||2);
    return;
  }
  if(_playMode==='ranked'){ if(!_rankedSearching) rankedQueue(); return; }
  if(partyData && (partyData.members||[]).length>1){
    // In a party → PLAY queues the WHOLE party together (leader starts it; members ready up).
    if(partyData.is_leader){ partyStart(); }
    else { toast('Your leader starts the match — you’re readied up.','ok'); partyReady(true); }
    return;
  }
  if(_playMode==='custom') play((SAVE.settings.room||'').trim(), SAVE.settings.queue);
  else play('', SAVE.settings.queue);        // quick = open matchmaking (no room)
}

// ── Match modes (Quick / Ranked / Custom) ───────────────────────────────────────
function setPlayMode(mode){
  _playMode = (['quick','ranked','custom','bots'].includes(mode)) ? mode : 'quick';
  // persist() ONLY — playMode is a launcher-UI setting, NOT a game file. Using saveSettings() here
  // scheduled a debounced invoke('save') that overwrote arena_link.ini's room with the saved (empty)
  // code ~300ms later, clobbering a transient Training/bot code mid-launch. (Bug fix: empty bot queue.)
  SAVE.settings.playMode = _playMode; persist();
  document.querySelectorAll('#modeList .mode-card').forEach(c=>c.classList.toggle('on', c.dataset.mode===_playMode));
  for(const k of ['quick','ranked','custom','bots']){ const p=$('pane-'+k); if(p) p.classList.toggle('on', k===_playMode); }
  if(_playMode==='ranked') loadMyRank();
  if(_playMode==='bots') syncTraining();       // render the arena-size / bot / difficulty controls
  updateCTA();
}
function syncMatch(){
  document.querySelectorAll('#mSeg button,#cSeg button').forEach(b=>b.classList.toggle('on',+b.dataset.q===SAVE.settings.queue));
  $('mRoom').value = SAVE.settings.room || '';
  setPlayMode(SAVE.settings.playMode || _playMode || 'quick');
}
$('modeList').addEventListener('click', e=>{ const c=e.target.closest('.mode-card'); if(c) setPlayMode(c.dataset.mode); });
function _segPick(e){ const b=e.target.closest('button'); if(!b) return;
  SAVE.settings.queue=+b.dataset.q; saveSettings(); syncMatch(); }
$('mSeg').addEventListener('click', _segPick);
$('cSeg').addEventListener('click', _segPick);
$('mRoom').addEventListener('input', e=>{ SAVE.settings.room=e.target.value; saveSettings(); });

// ── Ranked 1v1 (gateway hands back the room code; play() launches — player types nothing) ──
let _rankedSearching=false;
const TIER_COLORS = { bronze:['#a9743f','#6e451f'], silver:['#b9c2cc','#717c89'], gold:['#e7c24a','#9c7a1e'],
  platinum:['#5fd3c0','#2a8f82'], diamond:['#7db4ff','#3a6fd8'], master:['#c47dff','#7b32c9'],
  grandmaster:['#ff6a6a','#c12626'], avatar:['#ffd76a','#ff8a30'], unranked:['#6b7280','#3b4250'] };
const tierColors = t => TIER_COLORS[(t||'').toLowerCase().split(' ')[0]] || TIER_COLORS.unranked;
const tierAbbrev = t => (t||'').split(' ')[0].slice(0,4).toUpperCase();
function showRankSearch(on){ const el=$('rankSearch'); if(el) el.hidden=!on; }
function renderRankCard(me){
  const el=$('rankCard'); if(!el) return;
  if(!_tok()){ el.innerHTML='<div class="rc-empty">Sign in to play ranked.</div>'; return; }
  if(!me || !me.ok){ el.innerHTML='<div class="rc-empty">Rank unavailable — try again in a moment.</div>'; return; }
  if(!me.ranked){
    el.innerHTML='<div class="rc-badge" style="--tier1:#6b7280;--tier2:#3b4250">UN<br>RANKED</div>'
      +'<div class="rc-main"><div class="rc-tier">Unranked</div><div class="rc-lp">Play a ranked match to place</div>'
      +'<div class="rc-stats">No ranked games yet</div></div>';
    return;
  }
  const tier=me.tier_name||'Unranked', div=me.division_name||'';
  const apex = !div || /avatar/i.test(tier);
  const [t1,t2]=tierColors(tier);
  const badge = apex ? tier.slice(0,6).toUpperCase() : tierAbbrev(tier)+'<br>'+div;
  const top = apex ? (me.rating+' RR') : (me.lp+' LP');
  const streak = me.streak ? ` · <span class="streak">${me.streak>0?'+':''}${me.streak}</span>` : '';
  el.innerHTML = `<div class="rc-badge" style="--tier1:${t1};--tier2:${t2}">${badge}</div>`
    +`<div class="rc-main"><div class="rc-tier">${tier}${div&&!apex?' '+div:''}</div>`
    +`<div class="rc-lp">${top} · ${me.rating} rating</div>`
    +`<div class="rc-stats"><span class="w">${me.wins||0}W</span> <span class="l">${me.losses||0}L</span>${streak}</div></div>`;
}
async function loadMyRank(){ if(!_tok()){ renderRankCard(null); return; } const me=await sx('ranked_me',{ mode:'1v1' }); renderRankCard(me); }
async function rankedQueue(){
  const r=await sx('ranked_queue',{ mode:'1v1' });
  if(!r || !r.ok){ toast((r && r.error) || 'Sign in to play ranked.','err'); return; }
  toast('Searching for a ranked match…','ok');
  _rankedSearching=true; showRankSearch(true); updateCTA();
  await play(r.match_code, r.size||2);        // writes arena_link.ini + launches; waits for the game to exit
  _rankedSearching=false; showRankSearch(false); updateCTA();
  loadMyRank();                               // refresh the rank card after the match (gateway rates it)
}
async function rankedCancel(){ _rankedSearching=false; showRankSearch(false); updateCTA(); await sx('ranked_cancel'); toast('Left the ranked queue','ok'); }
{ const rc=$('rankCancel'); if(rc) rc.onclick=rankedCancel; }

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
    `<button data-bot="${b}" class="${b===SAVE.match.bot?'on':''}" style="--bh:${nameHue(b)}">`
    +`<span class="bot-av">${initials(b)}</span><span class="bot-nm">${b}</span></button>`).join('');
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
$('amSettings').addEventListener('click', ()=>{ acctMenu.classList.remove('open'); openSettings(); });
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
// Each service drives a row in the titlebar drop-down; the indicator dot shows the
// WORST of them (down > unknown > good) so a single glance tells you if anything's off.
const _svc = { gateway:null, database:null, game_server:null };
function setSvc(name, up){
  _svc[name] = up;
  const row=document.querySelector(`.sd-row[data-svc="${name}"]`);
  if(row){ row.classList.remove('off','unknown'); if(up===null) row.classList.add('unknown'); else if(!up) row.classList.add('off'); }
  const ind=$('statusInd'); if(!ind) return;
  const vals=Object.values(_svc);
  const agg = vals.some(v=>v===false) ? 'down' : vals.some(v=>v===null) ? 'unknown' : 'good';
  ind.classList.remove('good','down','unknown'); ind.classList.add(agg);
  const b=$('statusBtn'); if(b) b.title = agg==='down' ? 'A service is down' : agg==='unknown' ? 'Checking server…' : 'All systems live';
}
$('statusBtn').addEventListener('click', e=>{ e.stopPropagation(); $('statusInd').classList.toggle('open'); });
document.addEventListener('click', ()=>$('statusInd')?.classList.remove('open'));
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
// Render the in-game loading screen here, from the launcher's OWN tokens (near-black warm bg, the
// player's element/nation crest + an accent glow, Cinzel) → a compressed PNG that Rust writes as the
// BMP the in-game cover blits, so the loader looks IDENTICAL to the launcher. The crest is the player's
// own nation, the title takes the element colour. The bottom is left clear: the DLL overlays the
// animated loading bar / "PRESS SPACE" prompt there.
const LD_ACCENT = { earth:'#a3c14a', fire:'#ff5a0a', water:'#4aa8ff', air:'#b6e3dc', neutral:'#ffb24a' };
const LD_GOLD='#ffb24a', LD_EMBER='#ff7a2e', LD_MUT='#a99c89';
function _hexRgb(h){ const n=parseInt(h.slice(1),16); return [(n>>16)&255,(n>>8)&255,n&255]; }
function _rgba(h,a){ const c=_hexRgb(h); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
function _roundRect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
async function renderLoadingImage(element, name, nation, room, party, W, H){
  if(!HAS_TAURI) return;
  element=(element||'air').toLowerCase();
  const acc=LD_ACCENT[element] || LD_ACCENT.neutral;
  W=Math.max(640,(W|0)||1920); H=Math.max(480,(H|0)||1080);
  const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
  const ctx=cv.getContext('2d');
  // near-black warm bg (launcher --bg)
  const bg=ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,'#0b0910'); bg.addColorStop(.55,'#090710'); bg.addColorStop(1,'#070509');
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);
  // element accent glow behind the crest
  const eg=ctx.createRadialGradient(W*.5,H*.30,0,W*.5,H*.30,H*.62);
  eg.addColorStop(0,_rgba(acc,.16)); eg.addColorStop(.45,_rgba(acc,.05)); eg.addColorStop(1,_rgba(acc,0));
  ctx.fillStyle=eg; ctx.fillRect(0,0,W,H);
  // warm ember kiss from the top + bottom vignette
  const tg=ctx.createRadialGradient(W*.5,-H*.06,0,W*.5,-H*.06,H*.7);
  tg.addColorStop(0,_rgba(LD_EMBER,.10)); tg.addColorStop(1,_rgba(LD_EMBER,0));
  ctx.fillStyle=tg; ctx.fillRect(0,0,W,H);
  const vg=ctx.createRadialGradient(W*.5,H*1.1,0,W*.5,H*1.1,H*.8);
  vg.addColorStop(0,'rgba(0,0,0,.55)'); vg.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=vg; ctx.fillRect(0,0,W,H);
  ctx.fillStyle=_rgba(LD_GOLD,.10); ctx.fillRect(0,0,W,2); ctx.fillRect(0,H-2,W,2);
  // element crest (the player's own nation emblem), tinted in the element accent
  const sym=document.getElementById('el-'+element);
  if(sym){
    const vb=sym.getAttribute('viewBox')||'0 0 100 100';
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" style="color:${acc}">${sym.innerHTML}</svg>`;
    await new Promise(res=>{ const im=new Image();
      im.onload=()=>{ const es=Math.round(H*.30); ctx.save(); ctx.globalAlpha=.92;
        ctx.shadowColor=_rgba(acc,.55); ctx.shadowBlur=H*.05; ctx.drawImage(im,(W-es)/2,H*.085,es,es); ctx.restore(); res(); };
      im.onerror=res; im.src='data:image/svg+xml;utf8,'+encodeURIComponent(svg); });
  }
  try{ if(document.fonts) await document.fonts.ready; }catch(_){}
  ctx.textAlign='center';
  // title — element-tinted Cinzel, wide tracking, accent halo
  const ts=Math.round(H*.066);
  ctx.save(); ctx.font=`900 ${ts}px Cinzel, serif`;
  if('letterSpacing' in ctx) ctx.letterSpacing=Math.round(ts*.14)+'px';
  ctx.shadowColor=_rgba(acc,.45); ctx.shadowBlur=H*.05; ctx.fillStyle=acc;
  ctx.fillText('LEGENDS AWAKENED', W/2, H*.50); ctx.restore();
  // gold accent rule + centre diamond
  const rw=W*.16, rx=W/2, rl=ctx.createLinearGradient(rx-rw/2,0,rx+rw/2,0);
  rl.addColorStop(0,_rgba(LD_GOLD,0)); rl.addColorStop(.5,_rgba(LD_GOLD,.85)); rl.addColorStop(1,_rgba(LD_GOLD,0));
  ctx.fillStyle=rl; ctx.fillRect(rx-rw/2,H*.535,rw,2);
  ctx.save(); ctx.translate(rx,H*.536); ctx.rotate(Math.PI/4); ctx.fillStyle=LD_GOLD; ctx.fillRect(-4,-4,8,8); ctx.restore();
  // subtitle — muted, tracked
  const ss=Math.round(H*.021);
  ctx.save(); ctx.font=`500 ${ss}px Inter, system-ui, sans-serif`;
  if('letterSpacing' in ctx) ctx.letterSpacing=Math.round(ss*.32)+'px';
  ctx.fillStyle=LD_MUT; ctx.fillText('ENTERING THE ARENA', W/2, H*.575); ctx.restore();
  // framed player card (launcher panel) — name · nation + room/party
  if(name){
    const cw=Math.min(W*.46,720), ch=H*(party?.155:.115), cx=(W-cw)/2, cy=H*.61;
    ctx.save();
    ctx.fillStyle='rgba(22,17,27,.62)'; _roundRect(ctx,cx,cy,cw,ch,16); ctx.fill();
    ctx.lineWidth=1.5; ctx.strokeStyle=_rgba(LD_GOLD,.18); _roundRect(ctx,cx,cy,cw,ch,16); ctx.stroke();
    ctx.fillStyle=_rgba(acc,.55); _roundRect(ctx,cx+cw*.30,cy-1,cw*.40,2,1); ctx.fill();
    ctx.restore();
    let ty=cy+ch*(party?.30:.40);
    const ns=Math.round(H*.038);
    ctx.save(); ctx.font=`700 ${ns}px Cinzel, serif`; if('letterSpacing' in ctx) ctx.letterSpacing=Math.round(ns*.04)+'px';
    ctx.fillStyle=LD_GOLD; ctx.fillText(nation? `${name}   ·   ${nation}` : name, W/2, ty); ctx.restore();
    ty+=H*.05; const ms=Math.round(H*.020);
    ctx.font=`400 ${ms}px Inter, system-ui, sans-serif`; ctx.fillStyle=LD_MUT;
    if(room){ ctx.fillText('Room  '+room, W/2, ty); ty+=H*.034; }
    if(party){ ctx.fillText('Party  '+party, W/2, ty); }
  }
  // export a COMPRESSED PNG (tiny vs the old raw-RGBA payload that stalled the webview)
  const url=cv.toDataURL('image/png'); const b64=url.slice(url.indexOf(',')+1);
  await invoke('save_loading_image', { data:b64 });
}
// Map the selected element to its display nation name for the loading card.
const LD_NATION = { earth:'Earth', fire:'Fire', water:'Water', air:'Air', neutral:'Neutral' };
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
  // A roomOverride is a ONE-OFF room — a training bot code ("korra:medium:2") or a party room. It must
  // drive THIS launch but must NOT become the saved match code. We write it to arena_link.ini for the
  // game, then after the match restore the saved (normal) room (below) so it doesn't round-trip back in
  // via load() on the next start. Normal matches (no override) keep persisting the typed code as before.
  const transient = roomOverride!=null;
  if(roomOverride!=null) settings.room=roomOverride;
  if(queueOverride!=null) settings.queue=queueOverride;
  // Cancel any pending debounced save: it would write the SAVED room over arena_link.ini ~300ms into
  // the game's startup, clobbering a transient bot/party/ranked room code before the game reads it.
  clearTimeout(_saveT);
  // Seamless identity: mint a ticket from the signed-in session so the game loads the REAL
  // character. Don't silently launch unarmed — warn so the player knows it'll be a manual login.
  let username=null, ticket=null;
  // Authenticate the game connection for EVERY signed-in launch — NOT just Skip-menus. The ticket
  // is what makes the game server load the real account/character and credit wins to the account;
  // without it you play as an unauthenticated guest (default 999-HP char, nothing linked). Skip-menus
  // is a SEPARATE convenience (auto-submitting the in-game login), handled Rust-side via game creds.
  if(SAVE.session){
    const armed = await armTicket(settings.host);
    if(armed){ username=armed.username; ticket=armed.ticket; }
    else { toast('Couldn’t arm your account — sign in again. Playing UNauthenticated (guest).','err'); }
  } else {
    toast('Not signed in — playing UNauthenticated (guest).','err');
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
    const element = (SAVE.element || (typeof currentElement!=='undefined' ? currentElement : '') || 'air').toLowerCase();
    const party = (partyData && partyData.members && partyData.members.length>1)
      ? partyData.members.map(m=>m.name).join(', ') : '';
    // Render the loading screen from the launcher's own tokens → BMP the in-game cover blits (so the
    // loader matches the launcher). Now a small PNG payload (the old raw-RGBA one stalled the webview).
    // Must finish BEFORE the game spawns so the image exists when the DLL loads. Never block launch on it.
    try{
      const who = (SAVE.session && SAVE.session.name) || username || '';
      await renderLoadingImage(element, who, LD_NATION[element]||'', (settings.room||'').trim(), party,
                               settings.width, settings.height);
    }catch(e){ /* fall back to the DLL's GDI card */ }
    const launched = invoke('play',{ settings, windowed:!settings.fullscreen, username, ticket, element, party });
    toast(ticket ? 'Logging you in…' : 'Launching…','ok');
    _inGame=true; setStatus('in match'); setPlayLabel('IN GAME');
    stopParticles();   // free the GPU/CPU NOW (don't wait for the minimize) so the game's startup isn't starved
    setTimeout(()=>{ if(w && _inGame) w.minimize(); }, 1500);   // let the game grab focus, then drop the launcher
    await launched;                                             // ← the game has now closed
    if(w){ try{ await w.unminimize(); await w.setFocus(); }catch{} }   // bring the launcher back, ready to go again
    startParticles();  // game closed → resume the background animation
  }catch(e){ toast(String(e),'err'); }
  // Restore the saved (normal) room in arena_link.ini after a one-off launch (training/party), so the
  // transient bot/party code never persists as the match room. gather() reads SAVE.settings (untouched
  // by the override). No-op for normal matches, which keep their typed code.
  if(transient){ try{ await invoke('save',{ settings: gather() }); syncMatch(); }catch{} }
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
    // The pacman path pops a graphical password prompt to authorize the install; tell the user.
    const tail = r.via==='pacman'
      ? `Install it now? You'll get a password prompt to authorize the package install, then the launcher restarts.`
      : `Install it now? The launcher will restart.`;
    $('updateBody').innerHTML=`A newer launcher is available — <b>v${r.version}</b>${appVersion?` (you have v${appVersion})`:''}. ${tail}`;
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
    const av = document.createElement('span'); av.className='fr-av lb-av';    // social-idiom hued avatar
    av.style.setProperty('--ah', nameHue(r.name)); av.textContent=initials(r.name);
    const ico = document.createElementNS('http://www.w3.org/2000/svg','svg'); ico.setAttribute('class','el el-'+r.nation+' lb-el');
    const use = document.createElementNS('http://www.w3.org/2000/svg','use'); use.setAttribute('href','#el-'+r.nation); ico.appendChild(use);
    const nm = document.createElement('span'); nm.className='lb-name'; nm.textContent=r.name;   // textContent → no HTML injection
    if(r.wins!=null && SAVE.board.mode!=='dominance'){ const w=document.createElement('span'); w.className='lb-w';
      w.textContent=r.wins+'W'; nm.appendChild(w); }
    const val = document.createElement('span'); val.className='lb-val'; val.textContent=r.value;
    row.append(rank, av, ico, nm, val); frag.appendChild(row);
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
  partyData=r.party; renderParty(r.party, r.invite); updateSocialBadge();
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
    const row=document.createElement('div'); row.className='party-m '+(m.state||'offline')+(m.leader?' leader':'')+(m.ready?' rdy':'');
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
  // Empty slots up to the party size — click to reveal an INLINE friends list (no floating menu).
  const filled = party.members.length + (party.pending||[]).length;
  if(party.is_leader && _partyInviteOpen) renderPartyInvitePanel(wrap, party);
  else if(party.is_leader) for(let i=filled; i<(party.size||4); i++){
    const slot=document.createElement('button'); slot.className='party-slot';
    slot.innerHTML='<span class="ps-plus">+</span><span class="ps-l">Invite a friend</span>';
    slot.onclick=e=>{ e.stopPropagation(); _partyInviteOpen=true; renderParty(party, invite); };
    wrap.appendChild(slot);
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
// Inline party invite: an in-place friends list (NOT a floating menu). Your friends who aren't
// already in the party, shown as rows like the Friends tab — click a row to invite.
let _partyInviteOpen=false;
let _partyInviteSearch='';
function renderPartyInvitePanel(wrap, party){
  const panel=document.createElement('div'); panel.className='party-invite';
  const head=document.createElement('div'); head.className='pi-head';
  head.innerHTML='<span class="pi-t">Invite to party</span><button class="pi-x" title="Done">✕</button>';
  head.querySelector('.pi-x').onclick=e=>{ e.stopPropagation(); _partyInviteOpen=false; _partyInviteSearch=''; renderParty(partyData, null); };
  panel.appendChild(head);
  const inParty=new Set([...(party.members||[]).map(m=>m.name), ...(party.pending||[])]);
  const pending=new Set(party.pending||[]);
  let cands=(frData.friends||[]).filter(f=>!inParty.has(f.name));
  if(frData.friends && frData.friends.length>6){
    const s=document.createElement('input'); s.className='pi-search'; s.placeholder='Search friends…'; s.value=_partyInviteSearch;
    s.oninput=()=>{ _partyInviteSearch=s.value; const q=s.value.toLowerCase();
      panel.querySelectorAll('.pi-row').forEach(r=>{ r.hidden = !!q && !r.dataset.name.toLowerCase().includes(q); }); };
    panel.appendChild(s);
  }
  const list=document.createElement('div'); list.className='pi-list';
  // order: online first, then the rest — same priority feel as the Friends tab
  const rank=f=>({'in-game':0,online:1,away:2,offline:3}[f.state]??3);
  cands.sort((a,b)=>rank(a)-rank(b) || dispName(a).localeCompare(dispName(b)));
  if(!cands.length){ list.innerHTML='<div class="pi-empty">No friends to invite — add some on the Home tab.</div>'; }
  for(const f of cands){
    const invited=pending.has(f.name);
    const row=document.createElement('div'); row.className='pi-row '+(f.state||'offline'); row.dataset.name=f.name;
    row.innerHTML=avatarHTML(f.name)+`<span class="dot"></span>`
      +`<div class="meta"><b class="nm"></b><span class="st"></span></div>`
      +(invited?'<span class="pi-inv">Invited</span>':'<button class="pi-add">Invite</button>');
    row.querySelector('.nm').textContent=dispName(f);
    row.querySelector('.st').textContent=statusText(f);
    if(!invited){ const add=()=>partyInvite(f.name); row.querySelector('.pi-add').onclick=e=>{ e.stopPropagation(); add(); }; row.onclick=add; }
    list.appendChild(row);
  }
  panel.appendChild(list); wrap.appendChild(panel);
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
      {name:'KorraMain',ready:false,leader:false,state:'in-game'} ] } };
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
  const _q = new URLSearchParams(location.search);
  const state = _q.get('demo') || 'friends';
  if(_q.get('closed')!==null) app.classList.add('social-closed');   // preview the collapsed rail + toggle badge (instant, no transition)
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
      else if(state==='partyinvite'){ pollParty().then(()=>setTimeout(()=>{ const s=document.querySelector('.party-slot'); if(s) s.click(); }, 120)); }
      else if(state==='waiting'){ _outInvites.push({to:'KorraMain',disp:'KorraMain',room:'x',size:2,deadline:Date.now()+60000}); renderInvites(); }
      else if(state==='leaderboard') setView('ranks');
      else if(state==='match'){ setView('match'); }
      else if(state==='character'){ setView('character'); }
      else if(state==='training' || state==='bots'){ setView('match'); setPlayMode('bots'); }
      else if(state==='ranked'){ setView('match'); setPlayMode('ranked');
        setTimeout(()=>renderRankCard({ok:true,ranked:true,tier_name:'Gold',division_name:'II',lp:64,rating:1340,wins:23,losses:17,streak:3}), 60); }
      else if(state==='custom'){ setView('match'); setPlayMode('custom'); }
      else if(state==='help') $('cbHow').click();
      else if(state==='account') openDrawer();
      else if(state==='acctmenu'){ setSocialOpen(true); openAcctMenu(); }
    });
  }
}
