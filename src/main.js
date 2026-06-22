// Legends Awakened launcher — frontend wiring (vanilla, withGlobalTauri).
const TAURI = window.__TAURI__ || {};
const invoke = TAURI.core ? TAURI.core.invoke : async () => { throw new Error('not in Tauri'); };
const getWin = () => (TAURI.window && TAURI.window.getCurrentWindow) ? TAURI.window.getCurrentWindow() : null;

const $ = (id) => document.getElementById(id);
const DEFAULT_HOST = 'gw.legends-awakened.com'; // official gateway; used when none is saved
let state = { host: '', room: '', queue: 4, fullscreen: true, width: 1440, height: 1080, hd_textures: false, gamescope: false, gamescope_args: '' };
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
  if (r.version) $('version').textContent = `Legends Awakened Launcher · v${r.version}`;
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
           gamescope: state.gamescope, gamescope_args: ($('gsArgs').value || '').trim() };
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

// ---- updates: read-only CHECK → modal → apply with a download bar ----
// Startup never downloads/overwrites anything; it only checks and, if something is
// available, prompts. Files are fetched only after the user clicks "Update now".
function setUpdateBtn(text, busy) {
  const t = $('updateText'); if (t) t.textContent = text;
  const b = $('checkUpdates'); if (b) b.classList.toggle('is-busy', !!busy);
}
function fmtBytes(n) {
  if (!n) return '';
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `~${mb.toFixed(mb < 10 ? 1 : 0)} MB` : `~${Math.max(1, Math.round(n / 1024))} KB`;
}
let pendingUpdate = null;
let restartPending = false;

async function checkForUpdates(manual) {
  const host = ($('host').value || '').trim();
  if (!host) { if (manual) toast('Set a server first.', 'err'); return; }
  if (manual) setUpdateBtn('Checking…', true);
  let r;
  try { r = await invoke('check_updates', { host }); }
  catch (e) { if (manual) { toast('Update check failed.', 'err'); setUpdateBtn('Check for updates', false); } return; }
  const files = (r && r.content_files) || 0;
  if ((r && r.launcher_version) || files > 0) {
    pendingUpdate = r;
    openUpdateModal(r);
    if (manual) setUpdateBtn('Check for updates', false);
  } else if (manual) {
    if (r && r.ok) { toast('Everything is up to date.', 'ok'); setUpdateBtn('Up to date', false); }
    else { toast((r && r.error) || 'Update check failed.', 'err'); setUpdateBtn('Check for updates', false); }
    setTimeout(() => setUpdateBtn('Check for updates', false), 5000);
  }
}

function openUpdateModal(r) {
  const parts = [];
  if (r.launcher_version) parts.push(`a new <b>launcher (v${r.launcher_version})</b>`);
  if (r.content_files > 0) parts.push(`<b>${r.content_files}</b> game file${r.content_files > 1 ? 's' : ''}${r.content_bytes ? ` (${fmtBytes(r.content_bytes)})` : ''}`);
  $('updateBody').innerHTML = `There's an update available — ${parts.join(' and ')}. Update now?`;
  $('updateProgress').hidden = true;
  $('updateBarFill').style.width = '0%';
  $('updateBarLabel').textContent = '';
  restartPending = false;
  $('updateNow').disabled = false; $('updateNow').textContent = 'Update now';
  $('updateLater').disabled = false; $('updateLater').textContent = 'Later';
  $('updateModal').setAttribute('aria-hidden', 'false');
}
function closeUpdateModal() { $('updateModal').setAttribute('aria-hidden', 'true'); }

async function applyUpdate() {
  const r = pendingUpdate; if (!r) return;
  const host = ($('host').value || '').trim();
  $('updateNow').disabled = true; $('updateLater').disabled = true;
  $('updateProgress').hidden = false;
  let restart = false;

  // 1) launcher self-update (single binary — coarse progress)
  if (r.launcher_version) {
    $('updateBarLabel').textContent = 'Updating launcher…';
    $('updateBarFill').style.width = '20%';
    try { const u = await invoke('self_update', { host }); if (u && u.updated) restart = true; } catch (e) {}
  }

  // 2) game content — live bar driven by the 'sync-progress' events from Rust
  if (r.content_files > 0 && found) {
    let unlisten = null;
    try {
      const EVT = TAURI.event;
      if (EVT && EVT.listen) {
        unlisten = await EVT.listen('sync-progress', (ev) => {
          const p = ev.payload || {};
          const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
          $('updateBarFill').style.width = pct + '%';
          const name = (p.file || '').replace(/^.*[\\/]/, '');
          $('updateBarLabel').textContent = p.total ? `Downloading ${p.done}/${p.total}${name ? ' · ' + name : ''}` : 'Downloading…';
        });
      }
      await invoke('sync', { host });
      $('updateBarFill').style.width = '100%';
    } catch (e) { toast('Some files failed to update.', 'err'); }
    finally { if (typeof unlisten === 'function') unlisten(); }
  }

  if (restart) {
    // launcher binary was swapped — offer a real restart so it takes effect
    restartPending = true;
    $('updateBarLabel').textContent = 'Launcher updated — restart to finish.';
    $('updateNow').textContent = 'Restart now'; $('updateNow').disabled = false;
    $('updateLater').textContent = 'Later'; $('updateLater').disabled = false;
  } else {
    $('updateBarLabel').textContent = 'Up to date.';
    $('updateNow').disabled = true;
    $('updateLater').textContent = 'Close'; $('updateLater').disabled = false;
    toast('Update complete.', 'ok'); setTimeout(closeUpdateModal, 1100); await refresh();
  }
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
  $('play').addEventListener('click', () => play(false));
  $('playWin').addEventListener('click', () => play(true));
  const win = getWin();
  $('min').addEventListener('click', () => win && win.minimize());
  $('close').addEventListener('click', () => win && win.close());
  $('checkUpdates').addEventListener('click', () => checkForUpdates(true));
  $('updateNow').addEventListener('click', () => {
    if (restartPending) invoke('restart').catch(() => {}); else applyUpdate();
  });
  $('updateLater').addEventListener('click', closeUpdateModal);
  ['gateway', 'database', 'game_server'].forEach((n) => setSvc(n, null)); // blink until first poll
  // startup is a READ-ONLY check — only prompts (modal); never downloads on its own
  refresh().then(() => { pollStatus(); checkForUpdates(false); });
  setInterval(pollStatus, 12000);
});
