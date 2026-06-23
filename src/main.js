// Legends Awakened launcher — frontend wiring (vanilla, withGlobalTauri).
const TAURI = window.__TAURI__ || {};
const invoke = TAURI.core ? TAURI.core.invoke : async () => { throw new Error('not in Tauri'); };
const getWin = () => (TAURI.window && TAURI.window.getCurrentWindow) ? TAURI.window.getCurrentWindow() : null;

const $ = (id) => document.getElementById(id);
const DEFAULT_HOST = 'gw.legends-awakened.com'; // official gateway; used when none is saved
let state = { host: '', room: '', queue: 4, fullscreen: true, width: 1440, height: 1080, hd_textures: false, gamescope: false, gamescope_args: '', skip_menu: false, session: null };
let native = [0, 0];
let resolutions = [];
let hdAvailable = false;
let gsAvailable = false;
let found = false;

// ---- embers ----
(function embers() {
  const host = $('embers');
  for (let i = 0; i < 26; i++) {
    const e = document.createElement('span');
    e.className = 'ember';
    e.style.left = Math.random() * 100 + '%';
    e.style.setProperty('--dx', (Math.random() * 60 - 30) + 'px');
    const d = 5 + Math.random() * 7;
    e.style.animationDuration = d + 's';
    e.style.animationDelay = -(Math.random() * d) + 's';
    const s = 2 + Math.random() * 2.5;
    e.style.width = e.style.height = s + 'px';
    host.appendChild(e);
  }
})();

// ---- render ----
function setQueue(q) {
  state.queue = q;
  const btns = [...$('queue').querySelectorAll('button')];
  btns.forEach((b) => b.classList.toggle('is-active', +b.dataset.q === q));
  const active = btns.find((b) => +b.dataset.q === q);
  if (active) {
    const g = $('segGlider');
    g.style.width = active.offsetWidth + 'px';
    g.style.transform = `translateX(${active.offsetLeft - 4}px)`; // -4 = container padding (glider left:4)
  }
}
function setFullscreen(on) {
  state.fullscreen = on;
  $('fs').classList.toggle('on', on);
  renderLaunchAs();
}
function setHd(on) {
  state.hd_textures = on;
  $('hd').classList.toggle('on', on);
  $('hdState').textContent = '';
}
async function toggleHd() {
  if (!hdAvailable) return;
  const on = !state.hd_textures;
  setHd(on);
  $('hd').classList.add('busy'); $('hdState').textContent = on ? 'switching to HD…' : 'restoring…';
  try {
    await invoke('set_textures', { hd: on });
    $('hdState').textContent = on ? 'HD' : 'original';
    // The engine only reads textures at startup, so the swap shows up next launch —
    // say so, otherwise a successful toggle looks like it did nothing.
    toast(on ? 'HD textures on — applies on next launch.' : 'Original textures restored — applies on next launch.', 'ok');
  } catch (e) { toast(String(e), 'err'); setHd(!on); $('hdState').textContent = state.hd_textures ? 'HD' : 'original'; }
  $('hd').classList.remove('busy');
}
function setGs(on) {
  state.gamescope = on;
  $('gs').classList.toggle('on', on);
  $('gsArgs').hidden = !on; // only show the args field when gamescope is enabled
}
function toggleGs() { if (gsAvailable) setGs(!state.gamescope); }

// Skip menus → on PLAY the game fires the arena queue straight from a fresh menu (the
// quickmatch DLL). Remembered across launches (persisted via prefs in gather()/play).
function setSkipMenu(on) {
  state.skip_menu = on;
  $('skipMenu').classList.toggle('on', on);
}

// Login on the live launcher — informational for now (PLAY works without it); the gateway
// auto-provisions a fresh name + password. We'll feed this identity into the match later.
async function doLogin() {
  const host = ($('host').value || '').trim() || DEFAULT_HOST;
  const username = ($('user').value || '').trim();
  const password = $('pass').value || '';
  const pill = $('loginPill');
  if (!username) { toast('Enter a username.', 'err'); $('user').focus(); return; }
  const btn = $('login');
  btn.disabled = true; btn.textContent = '…';
  try {
    const r = await invoke('gw_login', { host, username, password });
    if (r && r.ok) {
      state.session = { screenName: r.screen_name || username };
      pill.textContent = '✓ ' + state.session.screenName;
      pill.className = 'login-pill ok'; pill.hidden = false;
      toast('Logged in as ' + state.session.screenName, 'ok');
    } else {
      pill.textContent = '✕ not logged in';
      pill.className = 'login-pill err'; pill.hidden = false;
      toast((r && r.error) || 'Login failed.', 'err');
    }
  } catch (e) {
    pill.textContent = '✕ not logged in';
    pill.className = 'login-pill err'; pill.hidden = false;
    toast(String(e), 'err');
  }
  btn.disabled = false; btn.textContent = 'Login';
}

function buildResolutions() {
  const sel = $('res');
  sel.innerHTML = '';
  resolutions.forEach(([w, h]) => {
    const o = document.createElement('option');
    o.value = `${w}x${h}`;
    o.textContent = `${w} × ${h}`;
    sel.appendChild(o);
  });
  sel.value = `${state.width}x${state.height}`;
  // 4:3 only — if a legacy non-4:3 value was saved it won't be in the list; snap to a
  // sensible 4:3 default (1440×1080, else the smallest offered) so the UI stays valid.
  if (sel.selectedIndex < 0) {
    const def = resolutions.find(([w, h]) => w === 1440 && h === 1080) || resolutions[0];
    if (def) { state.width = def[0]; state.height = def[1]; sel.value = `${def[0]}x${def[1]}`; renderLaunchAs(); }
  }
}
function renderLaunchAs() {
  const el = $('launchAs');
  const mode = state.fullscreen ? 'FULLSCREEN' : 'WINDOWED';
  let tail = '';
  if (native[0] && state.fullscreen) {
    if (state.width === native[0] && state.height === native[1])
      tail = ` — <span class="native">matches your display</span>`;
    else
      tail = ` — <span class="native">4:3 · centered on your ${native[0]}×${native[1]} display</span>`;
  }
  el.innerHTML = `Launching as <b>${mode} · ${state.width} × ${state.height}</b>${tail}`;
}
function setStatus(kind, text) {
  const s = $('status'); s.className = 'hero-status' + (kind ? ' ' + kind : '');
  $('statusText').innerHTML = text;
}

async function refresh() {
  let r;
  try { r = await invoke('load'); }
  catch (e) { setStatus('bad', 'Launcher backend unavailable.'); return; }
  found = r.found; native = r.native || [0, 0]; resolutions = r.resolutions || [];
  if (r.version) { appVersion = r.version; $('version').textContent = `Legends Awakened Launcher · v${r.version}`; }
  state = { ...state, ...r.settings };
  $('host').value = state.host || DEFAULT_HOST;
  $('room').value = state.room || '';
  setQueue([2, 3, 4].includes(state.queue) ? state.queue : 4);
  setFullscreen(!!state.fullscreen);
  hdAvailable = !!r.hd_available;
  $('hd').hidden = !hdAvailable;
  if (hdAvailable) { setHd(!!state.hd_textures); $('hdState').textContent = state.hd_textures ? 'HD' : 'original'; }
  gsAvailable = !!r.gamescope_available;
  $('gs').hidden = !gsAvailable;
  if (gsAvailable) { $('gsArgs').value = state.gamescope_args || ''; setGs(!!state.gamescope); }
  setSkipMenu(!!state.skip_menu);
  buildResolutions();
  renderLaunchAs();
  if (found) {
    const dir = (r.game_dir || '').replace(/^.*[\\/]/, '');
    setStatus('ok', `Game ready${dir ? ` · ${dir}` : ''} · <a id="locate">change</a>`);
    $('play').disabled = false; $('playWin').disabled = false;
  } else {
    setStatus('bad', `Game folder not found — <a id="locate">locate it</a>`);
    $('play').disabled = true; $('playWin').disabled = true;
  }
  const l = $('locate'); if (l) l.onclick = locate;
  // re-place the queue glider once the web font has loaded (it can reflow widths)
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => setQueue(state.queue));
}

async function locate() {
  try { const p = await invoke('locate'); if (p) await refresh(); else toast('That folder has no Config.ini.', 'err'); }
  catch (e) { toast(String(e), 'err'); }
}

function gather() {
  const [w, h] = $('res').value.split('x').map(Number);
  return { host: $('host').value.trim(), room: $('room').value.trim(), queue: state.queue,
           fullscreen: state.fullscreen, width: w || state.width, height: h || state.height,
           hd_textures: state.hd_textures,
           gamescope: state.gamescope, gamescope_args: ($('gsArgs').value || '').trim(),
           skip_menu: state.skip_menu };
}

let toastTimer;
function toast(msg, kind) {
  const t = $('toast'); t.textContent = msg; t.className = 'toast show ' + (kind || '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = 'toast'; }, 4000);
}

async function play(windowed) {
  const settings = gather();
  $('play').disabled = true; $('playWin').disabled = true;
  $('play').querySelector('.play-label').textContent = 'LAUNCHING…';
  try {
    await invoke('play', { settings, windowed });
    toast('Entering the arena…', 'ok');
    const win = getWin();
    setTimeout(() => { if (win) win.close(); }, 900);
  } catch (e) {
    toast(String(e), 'err');
    $('play').disabled = false; $('playWin').disabled = false;
    $('play').querySelector('.play-label').textContent = 'PLAY';
  }
}

// ---- live service status ----
function setSvc(name, up) {
  const el = document.querySelector(`.svc[data-svc="${name}"]`);
  if (el) el.className = 'svc ' + (up === null ? 'unknown' : up ? 'up' : 'down');
}
let statusDebounce;
async function pollStatus() {
  const host = ($('host').value || '').trim();
  if (!host) { ['gateway', 'database', 'game_server'].forEach((n) => setSvc(n, null)); $('playersN').textContent = '—'; return; }
  let r;
  try { r = await invoke('status', { host }); } catch { r = null; }
  if (!r || !r.reachable) {
    ['gateway', 'database', 'game_server'].forEach((n) => setSvc(n, false));
    $('playersN').textContent = '—';
    return;
  }
  setSvc('gateway', !!r.gateway);
  setSvc('database', !!r.database);
  setSvc('game_server', !!r.game_server);
  $('playersN').textContent = r.game_server ? String(r.players) : '—';
}

// ---- updates -----------------------------------------------------------------
// Two separate, opt-in flows — startup only CHECKS, never acts on its own:
//  * a newer LAUNCHER -> "Download" (opens the page; never self-modifies the exe,
//    which silently failed on Windows).
//  * differing GAME FILES (DLLs/textures) -> the launcher CAN patch those safely,
//    but only after the user clicks Update, and write failures are surfaced clearly.
const DOWNLOAD_URL = 'https://legends-awakened.com';   // where new launcher builds are posted
let appVersion = '';                                    // this launcher's version (from load)
let updateMode = null;                                  // 'launcher' | 'content'

function setUpdateBtn(text, busy) {
  const t = $('updateText'); if (t) t.textContent = text;
  const b = $('checkUpdates'); if (b) b.classList.toggle('is-busy', !!busy);
}
function fmtBytes(n) {
  if (!n) return '';
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `~${mb.toFixed(mb < 10 ? 1 : 0)} MB` : `~${Math.max(1, Math.round(n / 1024))} KB`;
}
function resetModal() {
  $('updateProgress').hidden = true;
  $('updateBarFill').style.width = '0%';
  $('updateBarLabel').textContent = '';
  $('updateNow').disabled = false;
  $('updateLater').disabled = false; $('updateLater').textContent = 'Later';
}

async function checkForUpdates(manual) {
  const host = ($('host').value || '').trim();
  if (!host) { if (manual) toast('Set a server first.', 'err'); return; }
  if (manual) setUpdateBtn('Checking…', true);
  let r;
  try { r = await invoke('check_updates', { host }); }
  catch (e) { if (manual) { toast('Update check failed.', 'err'); setUpdateBtn('Check for updates', false); } return; }
  const files = (r && r.content_files) || 0;
  if (r && r.launcher_version) {
    // newer launcher takes priority — get the new build first
    updateMode = 'launcher';
    const have = appVersion ? ` (you have v${appVersion})` : '';
    $('updateBody').innerHTML =
      `A newer launcher is available — <b>v${r.launcher_version}</b>${have}. ` +
      `Click Download to get it, then replace your current launcher.`;
    resetModal(); $('updateNow').textContent = 'Download';
    $('updateModal').setAttribute('aria-hidden', 'false');
    if (manual) setUpdateBtn('Check for updates', false);
  } else if (files > 0) {
    updateMode = 'content';
    $('updateBody').innerHTML =
      `<b>${files}</b> game file${files > 1 ? 's' : ''}${r.content_bytes ? ` (${fmtBytes(r.content_bytes)})` : ''} ` +
      `can be updated (textures / plugins). Download them now?`;
    resetModal(); $('updateNow').textContent = 'Update';
    $('updateModal').setAttribute('aria-hidden', 'false');
    if (manual) setUpdateBtn('Check for updates', false);
  } else if (manual) {
    if (r && r.ok) { toast("You're up to date.", 'ok'); setUpdateBtn('Up to date', false); }
    else { toast((r && r.error) || 'Update check failed.', 'err'); setUpdateBtn('Check for updates', false); }
    setTimeout(() => setUpdateBtn('Check for updates', false), 5000);
  }
}

function closeUpdateModal() { $('updateModal').setAttribute('aria-hidden', 'true'); }

function onUpdateNow() {
  if (updateMode === 'launcher') return downloadUpdate();
  if (updateMode === 'content') return applyContent();
}

async function downloadUpdate() {
  try { await invoke('open_url', { url: DOWNLOAD_URL }); }
  catch (e) { toast('Could not open the download page.', 'err'); }
  closeUpdateModal();
}

// Patch game files — only reached after the user clicks Update (explicit permission).
async function applyContent() {
  const host = ($('host').value || '').trim();
  $('updateNow').disabled = true; $('updateLater').disabled = true;
  $('updateProgress').hidden = false;
  $('updateBarLabel').textContent = 'Starting…';
  let unlisten = null;
  try {
    const EVT = TAURI.event;
    if (EVT && EVT.listen) {
      unlisten = await EVT.listen('sync-progress', (ev) => {
        const p = ev.payload || {};
        const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
        $('updateBarFill').style.width = pct + '%';
        const name = (p.file || '').replace(/^.*[\\/]/, '');
        $('updateBarLabel').textContent = p.total ? `Updating ${p.done}/${p.total}${name ? ' · ' + name : ''}` : 'Updating…';
      });
    }
    const r = await invoke('sync', { host });
    const n = (r && r.updated && r.updated.length) || 0;
    const bad = (r && r.failed && r.failed.length) || 0;
    if (r && r.ok && bad === 0) {
      $('updateBarFill').style.width = '100%';
      $('updateBarLabel').textContent = n ? `Updated ${n} file${n > 1 ? 's' : ''}.` : 'Already up to date.';
      toast(n ? `Updated ${n} game file${n > 1 ? 's' : ''}.` : 'Game files already up to date.', 'ok');
      setTimeout(closeUpdateModal, 1300);
    } else {
      // graceful failure — never just hang. Tell the user what to do.
      const msg = (r && r.error) || 'Some files could not be updated.';
      $('updateBarLabel').textContent = msg;
      toast(msg, 'err');
      $('updateLater').textContent = 'Close'; $('updateLater').disabled = false;
    }
  } catch (e) {
    $('updateBarLabel').textContent = 'Update failed — is the game closed?';
    toast('Could not update game files.', 'err');
    $('updateLater').textContent = 'Close'; $('updateLater').disabled = false;
  } finally { if (typeof unlisten === 'function') unlisten(); }
}

// ---- events ----
window.addEventListener('DOMContentLoaded', () => {
  $('queue').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setQueue(+b.dataset.q); });
  $('fs').addEventListener('click', () => setFullscreen(!state.fullscreen));
  $('hd').addEventListener('click', toggleHd);
  $('gs').addEventListener('click', toggleGs);
  $('gsArgs').addEventListener('input', () => { state.gamescope_args = $('gsArgs').value; });
  $('res').addEventListener('change', () => { const [w, h] = $('res').value.split('x').map(Number); state.width = w; state.height = h; renderLaunchAs(); });
  $('host').addEventListener('input', () => { clearTimeout(statusDebounce); statusDebounce = setTimeout(pollStatus, 800); });
  $('skipMenu').addEventListener('click', () => setSkipMenu(!state.skip_menu));
  $('login').addEventListener('click', doLogin);
  $('pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('user').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('pass').focus(); });
  $('play').addEventListener('click', () => play(false));
  $('playWin').addEventListener('click', () => play(true));
  const win = getWin();
  $('min').addEventListener('click', () => win && win.minimize());
  $('close').addEventListener('click', () => win && win.close());
  $('checkUpdates').addEventListener('click', () => checkForUpdates(true));
  $('updateNow').addEventListener('click', onUpdateNow);
  $('updateLater').addEventListener('click', closeUpdateModal);
  ['gateway', 'database', 'game_server'].forEach((n) => setSvc(n, null)); // blink until first poll
  // startup is a READ-ONLY check — only prompts (modal); never downloads on its own
  refresh().then(() => { pollStatus(); checkForUpdates(false); });
  setInterval(pollStatus, 12000);
});
