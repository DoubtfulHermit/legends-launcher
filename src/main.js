// Legends Awakened launcher — frontend wiring (vanilla, withGlobalTauri).
const TAURI = window.__TAURI__ || {};
const invoke = TAURI.core ? TAURI.core.invoke : async () => { throw new Error('not in Tauri'); };
const getWin = () => (TAURI.window && TAURI.window.getCurrentWindow) ? TAURI.window.getCurrentWindow() : null;

const $ = (id) => document.getElementById(id);
const DEFAULT_HOST = 'gw.legends-awakened.com'; // official gateway; used when none is saved
let state = { host: '', room: '', queue: 4, fullscreen: true, width: 1920, height: 1080 };
let native = [0, 0];
let resolutions = [];
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
function buildResolutions() {
  const sel = $('res');
  sel.innerHTML = '';
  resolutions.forEach(([w, h]) => {
    const o = document.createElement('option');
    o.value = `${w}x${h}`;
    o.textContent = `${w} × ${h}` + (native[0] === w && native[1] === h ? '  ·  native' : '');
    sel.appendChild(o);
  });
  sel.value = `${state.width}x${state.height}`;
}
function renderLaunchAs() {
  const el = $('launchAs');
  const mode = state.fullscreen ? 'FULLSCREEN' : 'WINDOWED';
  let tail = '';
  if (native[0]) {
    if (state.fullscreen && (state.width !== native[0] || state.height !== native[1]))
      tail = ` — <span class="warn">your display is ${native[0]}×${native[1]}</span>`;
    else if (state.fullscreen)
      tail = ` — <span class="native">matches your display</span>`;
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
  state = { ...state, ...r.settings };
  $('host').value = state.host || DEFAULT_HOST;
  $('room').value = state.room || '';
  setQueue([2, 3, 4].includes(state.queue) ? state.queue : 4);
  setFullscreen(!!state.fullscreen);
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
           fullscreen: state.fullscreen, width: w || state.width, height: h || state.height };
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

// ---- content patcher (download changed game files) ----
function setUpdateBtn(text, busy) {
  const t = $('updateText'); if (t) t.textContent = text;
  const b = $('checkUpdates'); if (b) b.classList.toggle('is-busy', !!busy);
}
async function syncContent(manual) {
  const host = ($('host').value || '').trim();
  if (!host) { if (manual) toast('Set a server first.', 'err'); return; }
  if (manual) setUpdateBtn('Checking…', true);
  let did = false, restart = false;
  // 1) launcher self-update (independent of the game folder; updates this binary)
  try {
    const u = await invoke('self_update', { host });
    if (u && u.updated) { toast(`Launcher updated to v${u.version} — restart to apply.`, 'ok'); did = true; restart = true; }
  } catch (e) { /* best-effort */ }
  // 2) game content patch (needs a known game folder)
  if (found) {
    try {
      const r = await invoke('sync', { host });
      const n = (r && r.updated && r.updated.length) || 0;
      if (r && r.ok && n) {
        const names = r.updated.map((p) => p.replace(/^.*[\\/]/, '')).join(', ');
        toast(`Updated ${n} game file${n > 1 ? 's' : ''}: ${names}`, 'ok'); did = true;
      } else if (r && !r.ok && manual && !did) {
        toast((r && r.error) ? r.error : 'Update check failed.', 'err');
      }
    } catch (e) { /* best-effort */ }
  }
  if (manual) {
    if (restart) setUpdateBtn('Restart to update', false);
    else if (did) setUpdateBtn('Updated', false);
    else { toast('Everything is up to date.', 'ok'); setUpdateBtn('Up to date', false); }
    if (!restart) setTimeout(() => setUpdateBtn('Check for updates', false), 5000);
  }
}

// ---- events ----
window.addEventListener('DOMContentLoaded', () => {
  $('queue').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setQueue(+b.dataset.q); });
  $('fs').addEventListener('click', () => setFullscreen(!state.fullscreen));
  $('res').addEventListener('change', () => { const [w, h] = $('res').value.split('x').map(Number); state.width = w; state.height = h; renderLaunchAs(); });
  $('host').addEventListener('input', () => { clearTimeout(statusDebounce); statusDebounce = setTimeout(pollStatus, 800); });
  $('play').addEventListener('click', () => play(false));
  $('playWin').addEventListener('click', () => play(true));
  const win = getWin();
  $('min').addEventListener('click', () => win && win.minimize());
  $('close').addEventListener('click', () => win && win.close());
  $('checkUpdates').addEventListener('click', () => syncContent(true));
  ['gateway', 'database', 'game_server'].forEach((n) => setSvc(n, null)); // blink until first poll
  refresh().then(() => { pollStatus(); syncContent(); });
  setInterval(pollStatus, 12000);
});
