// Remade in-game menus (v1) — faithful HTML recreation of AvatarMP's 800x600 menu
// screens, rendered in a transform-scaled stage so they're crisp at any resolution.
// Same binary as the launcher; lives on #/menu routes. Textures are loaded straight
// from the live install (game/Textures) via the asset protocol, so HD/original just
// works. Gateway calls (login) are proxied through Rust (gw_login).
(function () {
  const TAURI = window.__TAURI__ || {};
  const invoke = TAURI.core ? TAURI.core.invoke : async () => { throw new Error('not in Tauri'); };
  const convertFileSrc = TAURI.core && TAURI.core.convertFileSrc ? TAURI.core.convertFileSrc : (p) => p;
  const getWin = () => (TAURI.window && TAURI.window.getCurrentWindow) ? TAURI.window.getCurrentWindow() : null;
  const LogicalSize = (TAURI.dpi && TAURI.dpi.LogicalSize) || (TAURI.window && TAURI.window.LogicalSize) || null;

  const STAGE_W = 800, STAGE_H = 600;
  const DEFAULT_HOST = 'gw.legends-awakened.com';

  const state = {
    texturesDir: null,
    host: '',
    texScale: 2,      // how many texture px per logical px (HD=2, original=1); derived from the bg
    ready: false,     // menu_init resolved + texScale known
    session: null,    // { screenName } after login
  };

  // ---- texture helpers ------------------------------------------------------
  function texUrl(name) {
    if (!state.texturesDir) return '';
    const sep = state.texturesDir.includes('\\') ? '\\' : '/';
    return convertFileSrc(state.texturesDir + sep + name);
  }
  // load one image, resolving with the element (so callers can read naturalWidth)
  function loadImg(name) {
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = texUrl(name);
    });
  }

  // A faithful texture button with hover (_2) / press (_3) states, sized to the
  // texture's own logical dimensions (natural / texScale) so it matches the game.
  function makeButton(base, onClick, opts) {
    opts = opts || {};
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mnu-btn';
    const img = document.createElement('img');
    img.draggable = false;
    const url1 = texUrl(`${base}_1.png`);
    const url2 = texUrl(`${base}_2.png`);
    const url3 = texUrl(`${base}_3.png`);
    img.src = url1;
    img.onload = () => {
      const w = (img.naturalWidth / state.texScale) * (opts.scale || 1);
      btn.style.width = w + 'px';
    };
    // preload hover/press so the swap doesn't flash
    new Image().src = url2;
    new Image().src = url3;
    const set = (u) => { if (u) img.src = u; };
    btn.addEventListener('mouseenter', () => set(url2));
    btn.addEventListener('mouseleave', () => set(url1));
    btn.addEventListener('mousedown', () => set(url3));
    btn.addEventListener('mouseup', () => set(url2));
    btn.addEventListener('click', (e) => { e.preventDefault(); onClick && onClick(); });
    btn.appendChild(img);
    return btn;
  }

  // ---- stage scaling --------------------------------------------------------
  function fitStage() {
    const stage = document.getElementById('mnuStage');
    if (!stage) return;
    const s = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  }
  window.addEventListener('resize', fitStage);

  // ---- toast ----------------------------------------------------------------
  let toastTimer;
  function toast(msg, kind) {
    const t = document.getElementById('mnuToast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'mnu-toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'mnu-toast'; }, 3500);
  }

  // ---- window mode (menu owns a big/fullscreen window) ----------------------
  let menuOpen = false;
  async function enterMenu() {
    if (menuOpen) return;
    menuOpen = true;
    document.body.classList.add('in-menu');
    const w = getWin();
    if (w) { try { await w.setResizable(true); await w.maximize(); } catch (_) {} }
    fitStage();
  }
  async function leaveMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    document.body.classList.remove('in-menu');
    const w = getWin();
    if (w) {
      try {
        if (await w.isFullscreen()) await w.setFullscreen(false);
        await w.unmaximize();
        await w.setResizable(false);
        if (LogicalSize) await w.setSize(new LogicalSize(940, 640));
        await w.center();
      } catch (_) {}
    }
  }
  async function toggleFullscreen() {
    const w = getWin();
    if (!w) return;
    try { await w.setFullscreen(!(await w.isFullscreen())); } catch (_) {}
    setTimeout(fitStage, 60);
  }

  // ---- screens --------------------------------------------------------------
  function clearStage() {
    const stage = document.getElementById('mnuStage');
    if (stage) stage.innerHTML = '';
    return stage;
  }
  function addBg(stage, name) {
    const bg = document.createElement('img');
    bg.className = 'mnu-bg';
    bg.draggable = false;
    bg.src = texUrl(name);
    stage.appendChild(bg);
  }

  // Title screen — logged out. Logo top-center over the open arena; Login / Play below.
  function screenTitle() {
    const stage = clearStage();
    addBg(stage, 'tex_mnu_title_bg.jpg');

    const logo = document.createElement('img');
    logo.className = 'mnu-layer';
    logo.draggable = false;
    logo.src = texUrl('tex_mnu_title.png');
    logo.onload = () => {
      const w = logo.naturalWidth / state.texScale;
      logo.style.width = w + 'px';
      logo.style.left = (520 - w / 2) + 'px'; // centered over the open right area
      logo.style.top = '46px';
    };
    stage.appendChild(logo);

    const col = document.createElement('div');
    col.className = 'mnu-col';
    col.style.left = '520px';
    col.style.transform = 'translateX(-50%)';
    col.style.top = '360px';
    col.appendChild(makeButton('tex_btn_t_l_log', () => go('#/menu/login')));
    col.appendChild(makeButton('tex_btn_t_l_play', () => {
      if (state.session) go('#/menu/main');
      else go('#/menu/login');
    }));
    stage.appendChild(col);
  }

  // Login screen — faithful panel with two fields, wired to the live gateway.
  function screenLogin() {
    const stage = clearStage();
    addBg(stage, 'tex_mnu_title_bg.jpg');

    const wrap = document.createElement('div');
    wrap.className = 'mnu-login';

    const panel = document.createElement('img');
    panel.className = 'mnu-login-panel';
    panel.draggable = false;
    panel.src = texUrl('tex_mnu_login.png');

    const name = document.createElement('input');
    name.className = 'mnu-input';
    name.type = 'text';
    name.spellcheck = false;
    name.autocomplete = 'off';
    name.placeholder = 'name';
    const pass = document.createElement('input');
    pass.className = 'mnu-input';
    pass.type = 'password';
    pass.placeholder = '••••';
    const err = document.createElement('div');
    err.className = 'mnu-login-err';

    // size the panel + place the inputs over its dark boxes once the texture is known
    panel.onload = () => {
      const w = panel.naturalWidth / state.texScale;
      const h = panel.naturalHeight / state.texScale;
      panel.style.width = w + 'px';
      panel.style.height = h + 'px';
      // dark-box rects as fractions of the panel (from the texture art)
      const place = (el, topPct, hPct) => {
        el.style.left = 0.275 * w + 'px';
        el.style.width = 0.43 * w + 'px';
        el.style.top = topPct * h + 'px';
        el.style.height = hPct * h + 'px';
        el.style.fontSize = Math.round(0.052 * h) + 'px';
      };
      place(name, 0.235, 0.085);
      place(pass, 0.375, 0.085);
      err.style.top = 0.86 * h + 'px';
    };

    const submit = makeButton('tex_btn_log_submit', doLogin);
    const cancel = makeButton('tex_btn_log_cancel', () => go('#/menu'));
    // a centered action row hung just below the panel's bottom edge (positioning the
    // row, not the buttons, so the buttons' own :active press transform stays intact)
    const actions = document.createElement('div');
    actions.style.position = 'absolute';
    actions.style.display = 'flex';
    actions.style.gap = '14px';
    actions.style.left = '50%';
    actions.style.transform = 'translateX(-50%)';
    actions.appendChild(submit);
    actions.appendChild(cancel);
    const placeBtns = () => {
      const h = panel.naturalHeight / state.texScale || 250;
      actions.style.top = (h - 24) + 'px';
    };
    setTimeout(placeBtns, 50);

    async function doLogin() {
      err.textContent = '';
      const host = state.host || DEFAULT_HOST;
      const username = (name.value || '').trim();
      const password = pass.value || '';
      if (!username) { err.textContent = 'Enter a name.'; name.focus(); return; }
      submit.style.pointerEvents = 'none';
      try {
        const r = await invoke('gw_login', { host, username, password });
        if (r && r.ok) {
          state.session = { screenName: r.screen_name || username };
          toast('Welcome, ' + state.session.screenName);
          go('#/menu/main');
        } else {
          err.textContent = (r && r.error) || 'Login failed.';
        }
      } catch (e) {
        err.textContent = String(e);
      }
      submit.style.pointerEvents = '';
    }
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') pass.focus(); });
    pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

    wrap.appendChild(panel);
    wrap.appendChild(name);
    wrap.appendChild(pass);
    wrap.appendChild(err);
    wrap.appendChild(actions);
    stage.appendChild(wrap);
    setTimeout(() => name.focus(), 30);
  }

  // Main hub — after login. Faithful vertical bar-menu (single/multi/options/...).
  // v1: visual + navigation only; launching the match is the engine handoff (later).
  function screenMain() {
    const stage = clearStage();
    addBg(stage, 'tex_mnu_title_bg.jpg');

    const logo = document.createElement('img');
    logo.className = 'mnu-layer';
    logo.draggable = false;
    logo.src = texUrl('tex_mnu_title.png');
    logo.onload = () => {
      const w = (logo.naturalWidth / state.texScale) * 0.7;
      logo.style.width = w + 'px';
      logo.style.left = (520 - w / 2) + 'px';
      logo.style.top = '30px';
    };
    stage.appendChild(logo);

    const col = document.createElement('div');
    col.className = 'mnu-col';
    col.style.left = '520px';
    col.style.transform = 'translateX(-50%)';
    col.style.top = '210px';
    const soon = (label) => () => toast(label + ' — coming in a later version');
    col.appendChild(makeButton('tex_btn_t_s_single', soon('Single player')));
    col.appendChild(makeButton('tex_btn_t_s_multi', soon('Multiplayer')));
    col.appendChild(makeButton('tex_btn_t_s_highs', soon('High scores')));
    col.appendChild(makeButton('tex_btn_t_s_options', soon('Options')));
    col.appendChild(makeButton('tex_btn_t_s_how', soon('How to play')));
    col.appendChild(makeButton('tex_btn_t_s_quit', () => go('#/menu')));
    stage.appendChild(col);
  }

  // ---- router ---------------------------------------------------------------
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  async function route() {
    const h = location.hash || '';
    if (!h.startsWith('#/menu')) { await leaveMenu(); return; }
    if (!state.ready) { await init(); }
    await enterMenu();
    if (h === '#/menu/login') screenLogin();
    else if (h === '#/menu/main') screenMain();
    else screenTitle();
    fitStage();
  }
  window.addEventListener('hashchange', route);

  // Escape: leave fullscreen, else back to launcher
  window.addEventListener('keydown', async (e) => {
    if (!menuOpen || e.key !== 'Escape') return;
    const w = getWin();
    if (w && (await w.isFullscreen())) { await w.setFullscreen(false); setTimeout(fitStage, 60); }
    else go('#/');
  });

  // ---- init -----------------------------------------------------------------
  async function init() {
    if (state.ready) return;
    try {
      const r = await invoke('menu_init');
      if (r) {
        state.texturesDir = r.textures_dir || null;
        state.host = r.host || '';
      }
    } catch (_) {}
    // derive texScale from the title background (HD set = 1600 wide → 2; original = 800 → 1)
    if (state.texturesDir) {
      const bg = await loadImg('tex_mnu_title_bg.jpg');
      if (bg && bg.naturalWidth) state.texScale = bg.naturalWidth / STAGE_W;
    }
    state.ready = true;
  }

  // ---- wire up --------------------------------------------------------------
  function wire() {
    // Remade-menus entry button intentionally NOT injected — the feature is dormant
    // (still reachable via the #/menu hash for dev, but hidden from testers).
    const fs = document.getElementById('mnuFs');
    const back = document.getElementById('mnuBack');
    if (fs) fs.addEventListener('click', toggleFullscreen);
    if (back) back.addEventListener('click', () => go('#/'));
    // honour a deep-link / refresh that lands on a #/menu route
    route();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
