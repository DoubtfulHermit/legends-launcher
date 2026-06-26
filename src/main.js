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
    hd_available:true, gamescope_available:false,
    settings:{ host:'', room:'', queue:4, fullscreen:true, width:1440, height:1080,
               hd_textures:false, gamescope:false, gamescope_args:'', skip_menu:false } },
  status: { reachable:true, gateway:true, database:true, game_server:true, players:27 },
  gw_login: { ok:true, screen_name:null }, gw_ticket: { ok:false },
  check_updates: { ok:true }, sync: { ok:true, updated:[], failed:[] },
  session_login: { ok:true, token:'demo-token' }, session_ping: { ok:true }, session_logout: { ok:true },
  friends_list: { ok:true, incoming:[{name:'AshRider'}], outgoing:[{name:'FrostByte'}],
    friends:[{name:'KorraMain',state:'online'},{name:'BoulderKing',state:'in-game'},{name:'Zephyra',state:'offline'}] },
  friend_request: { ok:true }, friend_respond: { ok:true }, friend_remove: { ok:true },
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
  match:{ bot:'ember', diff:'medium', tsize:2 },
  settings:{
    queue:4, room:'', server:DEFAULT_SERVER, res:'1440x1080',
    hd:false, fullscreen:true, skip_menu:false, gamescope:false, gamescope_args:'' } };
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

// backend capability flags (from `load`)
let found = false, hdAvailable = false, gsAvailable = false;
let needsClone = false, cloning = false;   // first-run patched-clone setup
let native = [0,0], resolutions = [], appVersion = '';
let sessionPass = '';   // in-memory only, for minting the seamless login ticket

// ── elemental particles — ported from the Legends Awakened site (canvas) ─────
const app = document.querySelector('.app');
const canvas = $('particles-canvas'), pctx = canvas.getContext('2d');
let particles = [], currentElement = 'fire'; const MAX_PARTICLES = 70;
function resizeCanvas(){ canvas.width = app.clientWidth; canvas.height = app.clientHeight; }
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

// ── friends + presence (F3) ────────────────────────────────────────────────────
const _tok = () => (SAVE.session && SAVE.session.token) || null;
let presenceTimer = null;
function startPresence(){
  if(presenceTimer) return;
  const ping = () => { const t=_tok(); if(t && !document.hidden)
    invoke('session_ping',{ host:SAVE.settings.server, token:t }).catch(()=>{}); };
  ping(); presenceTimer = setInterval(ping, 30000);
}
// Toast on friend-graph changes between polls. Primed on the first load after
// sign-in so an existing backlog of requests/friends doesn't fire a toast storm.
let _frPrimed = false, _seenIncoming = new Set(), _seenFriends = new Set();
function _frResetNotify(){ _frPrimed=false; _seenIncoming=new Set(); _seenFriends=new Set(); }
function _notifyFriendChanges(incoming, friends){
  const inc = incoming.map(f=>f.name), fr = friends.map(f=>f.name);
  if(_frPrimed){
    for(const n of inc) if(!_seenIncoming.has(n)) toast(n+' wants to be your friend','ok');
    for(const n of fr)  if(!_seenFriends.has(n))  toast(n+' is now your friend','ok');
  }
  _seenIncoming = new Set(inc); _seenFriends = new Set(fr); _frPrimed = true;
}
// Distinguish "not signed in" from "signed in but social server unreachable".
function frShowEmpty(){
  const signedIn = !!(SAVE.session && SAVE.session.name);
  $('frList').innerHTML=''; $('frReqs').hidden=true; $('frCount').textContent='';
  $('frAdd').hidden=true; $('frAddToggle').hidden=true;
  const el=$('frEmpty');
  if(signedIn){
    el.innerHTML='Couldn’t reach the social server. <a href="#" id="frRetry">Retry</a>';
    const rt=$('frRetry'); if(rt) rt.onclick=e=>{ e.preventDefault(); retrySocial(); };
  } else {
    el.textContent='Sign in to add friends and see who’s online.';
  }
  el.hidden=false;
}
async function retrySocial(){
  if(!(SAVE.session && SAVE.session.name)) return;
  if(!sessionPass){ toast('Sign out and back in to reconnect.','err'); return; }
  try{ const s=await invoke('session_login',{ host:SAVE.settings.server, username:SAVE.session.name, password:sessionPass });
    if(s && s.ok && s.token){ SAVE.session.token=s.token; persist(); startPresence(); loadFriends(); toast('Reconnected.','ok'); return; }
  }catch{}
  toast('Still can’t reach the social server.','err');
}
async function loadFriends(){
  if(!_tok()){ frShowEmpty(); _frResetNotify(); return; }
  $('frEmpty').hidden = true; $('frAddToggle').hidden = false;
  let r; try{ r = await invoke('friends_list',{ host:SAVE.settings.server, token:_tok() }); }catch{ return; }
  if(!r || !r.ok){
    if(r && /signed in/.test(r.error||'')){ SAVE.session.token=null; persist(); frShowEmpty(); _frResetNotify(); }
    return;
  }
  _notifyFriendChanges(r.incoming||[], r.friends||[]);
  renderFriends(r.friends||[], r.incoming||[], r.outgoing||[]);
}
function renderFriends(friends, incoming, outgoing){
  const online = friends.filter(f=>f.state && f.state!=='offline').length;
  $('frCount').textContent = friends.length ? `${online}/${friends.length} online` : '';
  const reqs = $('frReqs'); reqs.innerHTML='';
  for(const f of incoming){
    const row=document.createElement('div'); row.className='fr-req';
    row.innerHTML='<span class="tag">adds you</span><span class="nm"></span>'
      +'<button class="yes" title="Accept">&#10003;</button><button class="no" title="Decline">&#10005;</button>';
    row.querySelector('.nm').textContent=f.name;
    row.querySelector('.yes').onclick=()=>respondFriend(f.name,true);
    row.querySelector('.no').onclick=()=>respondFriend(f.name,false);
    reqs.appendChild(row);
  }
  for(const f of outgoing){
    const row=document.createElement('div'); row.className='fr-req';
    row.innerHTML='<span class="nm"></span><span class="tag">pending</span>';
    row.querySelector('.nm').textContent=f.name;
    reqs.appendChild(row);
  }
  reqs.hidden = !(incoming.length || outgoing.length);
  const list = $('frList'); list.innerHTML='';
  if(!friends.length){ list.innerHTML='<div class="fr-empty">No friends yet — add someone by name.</div>'; return; }
  for(const f of friends){
    const st = f.state || 'offline';
    const row=document.createElement('div'); row.className='fr-row '+st;
    row.innerHTML='<span class="dot"></span><span class="nm"></span><span class="st"></span><button class="x" title="Remove">&#10005;</button>';
    row.querySelector('.nm').textContent=f.name;
    row.querySelector('.st').textContent = st==='in-game' ? 'in a match' : st;
    row.querySelector('.x').onclick=()=>removeFriend(f.name);
    list.appendChild(row);
  }
}
async function addFriend(){
  const name=$('frAddName').value.trim(); if(!name || !_tok()) return;
  const r=await invoke('friend_request',{ host:SAVE.settings.server, token:_tok(), to:name }).catch(()=>null);
  if(r && r.ok){ $('frAddName').value=''; $('frAdd').hidden=true; toast('Friend request sent to '+name,'ok'); loadFriends(); }
  else toast((r && r.error) || 'Could not send request.','err');
}
async function respondFriend(from, accept){
  const r=await invoke('friend_respond',{ host:SAVE.settings.server, token:_tok(), from, accept }).catch(()=>null);
  if(r && r.ok) loadFriends(); else toast((r && r.error) || 'Failed.','err');
}
async function removeFriend(who){
  const r=await invoke('friend_remove',{ host:SAVE.settings.server, token:_tok(), who }).catch(()=>null);
  if(r && r.ok) loadFriends();
}
$('frAddToggle').addEventListener('click', ()=>{ const a=$('frAdd'); a.hidden=!a.hidden; if(!a.hidden) $('frAddName').focus(); });
$('frAddBtn').addEventListener('click', addFriend);
$('frAddName').addEventListener('keydown', e=>{ if(e.key==='Enter') addFriend(); else if(e.key==='Escape') $('frAdd').hidden=true; });
setInterval(()=>{ if(!document.hidden && !$('view-home').hidden) loadFriends(); }, 20000);
$('liPass').addEventListener('keydown', e=>{ if(e.key==='Enter') signIn(); });
$('liUser').addEventListener('keydown', e=>{ if(e.key==='Enter') $('liPass').focus(); });
$('liServer').addEventListener('input', ()=>{ SAVE.settings.server=$('liServer').value.trim(); persist(); });
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
  $('stServer').value=st.server||'';
  $('stRes').value=st.res;
  $('stFs').classList.toggle('on', !!st.fullscreen);
  $('stHd').classList.toggle('on', !!st.hd);
  $('stSkip').classList.toggle('on', !!st.skip_menu);
  $('stGs').classList.toggle('on', !!st.gamescope);
  $('stGsArgs').value=st.gamescope_args||'';
  $('stGsArgs').hidden = !(gsAvailable && st.gamescope);
  $('hdRow').hidden = !hdAvailable;
  $('gsRow').hidden = !gsAvailable;
}
function openDrawer(){ syncDrawer(); drawer.classList.add('open'); scrim.classList.add('show'); }
function closeDrawer(){ drawer.classList.remove('open'); scrim.classList.remove('show'); }
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
  SAVE.settings.queue=+b.dataset.q; persist(); syncMatch(); });
$('mRoom').addEventListener('input', e=>{ SAVE.settings.room=e.target.value; persist(); });

// ── Training setup (vs AI) ──────────────────────────────────────────────────────
const BOTS = ['dummy','target','grunt','ember','rumble','boss'];
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
$('stServer').addEventListener('input', e=>{ SAVE.settings.server=e.target.value; persist(); });
$('stRes').addEventListener('change', e=>{ SAVE.settings.res=e.target.value; persist(); });
$('stFs').addEventListener('click', ()=>{ SAVE.settings.fullscreen=!SAVE.settings.fullscreen; persist(); syncDrawer(); });
$('stSkip').addEventListener('click', ()=>{ SAVE.settings.skip_menu=!SAVE.settings.skip_menu; persist(); syncDrawer(); });
$('stGs').addEventListener('click', ()=>{ if(!gsAvailable) return; SAVE.settings.gamescope=!SAVE.settings.gamescope; persist(); syncDrawer(); });
$('stGsArgs').addEventListener('input', e=>{ SAVE.settings.gamescope_args=e.target.value; persist(); });
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
let statusDebounce;
async function pollStatus(){
  if(document.hidden) return;   // don't poll the network while minimised
  const host=(SAVE.settings.server||'').trim();
  if(!host){ ['gateway','database','game_server'].forEach(n=>setSvc(n,null)); $('players').textContent='—'; return; }
  let r; try{ r=await invoke('status',{ host }); }catch{ r=null; }
  if(!r || !r.reachable){ ['gateway','database','game_server'].forEach(n=>setSvc(n,false)); $('players').textContent='—'; return; }
  setSvc('gateway', !!r.gateway); setSvc('database', !!r.database); setSvc('game_server', !!r.game_server);
  $('players').textContent = r.game_server ? String(r.players) : '—';
}

// ── PLAY ─────────────────────────────────────────────────────────────────────
function setPlayLabel(t){ document.querySelector('.play-label').textContent=t; }
function gather(){
  const st=SAVE.settings; const [w,h]=(st.res||'1440x1080').split('x').map(Number);
  return { host:(st.server||'').trim(), room:(st.room||'').trim(), queue:st.queue,
           fullscreen:!!st.fullscreen, width:w||1440, height:h||1080, hd_textures:!!st.hd,
           gamescope:!!st.gamescope, gamescope_args:(st.gamescope_args||'').trim(),
           skip_menu:!!st.skip_menu };
}
// PLAY morphs into a status pill (#prog) — reused for the experimental Skip-menus orchestration.
function showProg(text, pct){ $('play').style.display='none'; $('prog').style.display='block';
  $('progText').textContent=text; $('progFill').style.width=(pct||0)+'%'; $('progPct').textContent = pct!=null?pct+'%':''; }
function resetPlay(){ $('prog').style.display='none'; $('play').style.display='flex'; $('play').disabled=false; updateCTA(); }


async function play(roomOverride, queueOverride){
  if(!found){ return locate(); }   // PLAY doubles as "locate game" when not found
  const settings=gather();
  if(roomOverride!=null) settings.room=roomOverride;       // training: transient bot room, never persisted
  if(queueOverride!=null) settings.queue=queueOverride;
  // Seamless identity: mint a one-time ticket from the signed-in session so the game loads the
  // REAL character. Password is memory-only; a resumed session without it falls back to default.
  let username=null, ticket=null;
  if(settings.skip_menu && SAVE.session && sessionPass){
    try{ const r=await invoke('gw_ticket',{ host:settings.host, username:SAVE.session.name, password:sessionPass });
      if(r && r.ok && r.ticket){ username=SAVE.session.name; ticket=r.ticket; }
      else toast('Could not get a login ticket — using the default character.','err');
    }catch(e){ toast('Ticket error: '+e,'err'); }
  }
  // AUTO-LOGIN: with Skip-menus on + a ticket, the DLL submits this account's login in-game (fast)
  // and hands the menu to the player — so you never type the in-game login again. The launcher's job
  // ends at launch; it steps aside (no cover/queue orchestration — the game runs normally).
  $('play').disabled=true; setPlayLabel(ticket ? 'LOGGING IN…' : 'LAUNCHING…');
  try{
    await invoke('play',{ settings, windowed:!settings.fullscreen, username, ticket });
    toast(ticket ? 'Logging you in…' : 'Launching…','ok');
    const w=getWin(); setTimeout(()=>{ if(w) w.close(); }, 900);
  }catch(e){ toast(String(e),'err'); resetPlay(); }
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
  hdAvailable=!!r.hd_available; gsAvailable=!!r.gamescope_available;
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
    gamescope_args:s.gamescope_args??SAVE.settings.gamescope_args };
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
  {name:'Zenith',     nation:'fire',  rating:2480, solo:2240},
  {name:'KorraMain',  nation:'water', rating:2415, solo:2310},
  {name:'BoulderKing',nation:'earth', rating:2388, solo:2090},
  {name:'Zephyra',    nation:'air',   rating:2351, solo:2402},
  {name:'AshRider',   nation:'fire',  rating:2290, solo:2155},
  {name:'TidebornNn', nation:'water', rating:2244, solo:2188},
  {name:'GraniteFist',nation:'earth', rating:2201, solo:1990},
  {name:'GaleStorm',  nation:'air',   rating:2177, solo:2260},
  {name:'Inferna',    nation:'fire',  rating:2120, solo:2305},
  {name:'FrostByte',  nation:'water', rating:2088, solo:2044},
  {name:'TerraNova',  nation:'earth', rating:2050, solo:2130},
  {name:'SkyDancer',  nation:'air',   rating:2012, solo:1975},
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
    const val = document.createElement('span'); val.className='lb-val'; val.textContent=r.value;
    row.append(rank, ico, nm, val); frag.appendChild(row);
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
  try{ const r=await invoke('leaderboard',{ host }); if(Array.isArray(r) && r.length) boardData=r; }
  catch{ /* no gateway endpoint yet — keep demo data */ }
  renderBoard();
}

// window controls
$('min').addEventListener('click', ()=>{ const w=getWin(); if(w) w.minimize(); });
$('close').addEventListener('click', ()=>{ const w=getWin(); if(w) w.close(); });

// initial paint: theme first (instant), then async backend reconcile
setElement(SAVE.element || 'fire');
renderBoard();
if(SAVE.session){ showChip(SAVE.session.name); loginEl.classList.add('hide'); startPresence(); loadFriends(); }
else { showChip(null); setTimeout(()=>$('liUser').focus(), 60); loadFriends(); }
startParticles();
updateCTA();   // Home → the bottom button reads "MATCH"
refresh().then(()=>{ pollStatus(); checkForUpdates(false); checkLauncherUpdate(); loadBoard(); });
setInterval(pollStatus, 12000);
