// Legends Awakened launcher — reads/writes the game's Config.ini (resolution +
// fullscreen) and BuildingBlocks/arena_link.ini (server host + room code + queue),
// then launches the client. Line-based file edits preserve every other line +
// comments + the trailing newline the engine requires.
use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tauri::Manager; // asset_protocol_scope() for the menu's texture loading

#[derive(Serialize, Deserialize, Clone, Debug)]
struct Settings {
    host: String,       // arena_link.ini [server] host
    room: String,       // arena_link.ini [room] code
    queue: u32,         // arena_link.ini [room] queue (2/3/4)
    fullscreen: bool,   // Config.ini FullScreen
    width: u32,         // Config.ini Width
    height: u32,        // Config.ini Height
    #[serde(default)]
    hd_textures: bool,  // overlay the AI-upscaled Textures.hd set (vs originals)
    #[serde(default)]
    gamescope: bool,        // Linux: wrap the game launch in gamescope
    #[serde(default)]
    gamescope_args: String, // extra gamescope args (GPU/output, e.g. "--prefer-vk-device 1002:1638 -W 1920 -H 1080")
}
impl Default for Settings {
    fn default() -> Self {
        Settings { host: String::new(), room: String::new(), queue: 4,
                   fullscreen: true, width: 1440, height: 1080, hd_textures: false,
                   gamescope: false, gamescope_args: String::new() }
    }
}

#[derive(Serialize)]
struct LoadResult {
    found: bool,
    game_dir: Option<String>,
    settings: Settings,
    native: [u32; 2],           // primary monitor native resolution
    resolutions: Vec<[u32; 2]>, // selectable resolutions (curated + native + current)
    hd_available: bool,         // both Textures.original/ and Textures.hd/ exist
    gamescope_available: bool,  // Linux + gamescope on PATH (so the toggle is usable)
    version: String,            // launcher version (CARGO_PKG_VERSION), shown in the UI
}

// ---- locating the game install ----------------------------------------------
// In production the launcher .exe sits IN the game folder, so the folder next to
// the exe (with Config.ini) is the game dir. We also remember a user-picked dir
// and honour AVATAR_GAME_DIR for development on a non-Windows box.
fn config_store() -> Option<PathBuf> {
    cfg_home().map(|d| d.join("legends-launcher.path"))
}
fn cfg_home() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(PathBuf::from)
        .or_else(|| std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
}
fn is_game_dir(p: &Path) -> bool { p.join("Config.ini").is_file() }

fn resolve_game_dir() -> Option<PathBuf> {
    if let Ok(d) = std::env::var("AVATAR_GAME_DIR") {
        let p = PathBuf::from(d);
        if is_game_dir(&p) { return Some(p); }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if is_game_dir(dir) { return Some(dir.to_path_buf()); }
        }
    }
    if let Some(store) = config_store() {
        if let Ok(s) = fs::read_to_string(&store) {
            let p = PathBuf::from(s.trim());
            if is_game_dir(&p) { return Some(p); }
        }
    }
    None
}
fn remember_game_dir(p: &Path) {
    if let Some(store) = config_store() {
        if let Some(parent) = store.parent() { let _ = fs::create_dir_all(parent); }
        let _ = fs::write(store, p.to_string_lossy().as_bytes());
    }
}

// Per-user launcher prefs that don't belong in the game's own config files (gamescope
// is a desktop/GPU setting, not game data) — kept next to the remembered game-dir so we
// never risk confusing arena_link.dll's INI parser.
fn prefs_path() -> Option<PathBuf> { cfg_home().map(|d| d.join("legends-launcher.conf")) }
fn read_prefs(s: &mut Settings) {
    if let Some(txt) = prefs_path().and_then(|p| fs::read_to_string(p).ok()) {
        for line in txt.lines() {
            if let Some((k, v)) = line.split_once('=') {
                match k.trim() {
                    "gamescope" => s.gamescope = v.trim() == "1" || v.trim().eq_ignore_ascii_case("true"),
                    "gamescope_args" => s.gamescope_args = v.trim().to_string(),
                    _ => {}
                }
            }
        }
    }
}
fn write_prefs(s: &Settings) {
    if let Some(p) = prefs_path() {
        if let Some(parent) = p.parent() { let _ = fs::create_dir_all(parent); }
        let _ = fs::write(p, format!("gamescope={}\ngamescope_args={}\n",
            if s.gamescope { 1 } else { 0 }, s.gamescope_args));
    }
}

// ---- INI helpers (line-preserving) ------------------------------------------
fn arena_ini(dir: &Path) -> PathBuf { dir.join("BuildingBlocks").join("arena_link.ini") }

fn ascii_trim_start(b: &[u8]) -> &[u8] {
    let mut i = 0; while i < b.len() && (b[i] == b' ' || b[i] == b'\t') { i += 1; }
    &b[i..]
}
fn starts_with_ci(hay: &[u8], pre: &[u8]) -> bool {
    hay.len() >= pre.len() && hay[..pre.len()].eq_ignore_ascii_case(pre)
}

fn read_settings(dir: &Path) -> Settings {
    let mut s = Settings::default();
    // Config.ini contains non-UTF-8 (cp1252) bytes in its comment banner, so read
    // as bytes and decode each line lossily just to parse the ASCII key=value pairs.
    if let Ok(raw) = fs::read(dir.join("Config.ini")) {
        for line in raw.split(|&b| b == b'\n') {
            let t = String::from_utf8_lossy(line);
            let t = t.trim();
            if let Some(v) = t.strip_prefix("FullScreen=") { s.fullscreen = v.trim().eq_ignore_ascii_case("true"); }
            else if let Some(v) = t.strip_prefix("Width=") { if let Ok(n) = v.trim().parse() { s.width = n; } }
            else if let Some(v) = t.strip_prefix("Height=") { if let Ok(n) = v.trim().parse() { s.height = n; } }
        }
    }
    if let Ok(al) = fs::read_to_string(arena_ini(dir)) {
        let mut section = String::new();
        for line in al.lines() {
            let t = line.trim();
            if t.starts_with('[') && t.ends_with(']') { section = t[1..t.len()-1].to_lowercase(); continue; }
            if let Some((k, v)) = t.split_once('=') {
                let (k, v) = (k.trim().to_lowercase(), v.trim().to_string());
                match (section.as_str(), k.as_str()) {
                    ("server", "host") => s.host = v,
                    ("room", "code") => s.room = v,
                    ("room", "queue") => { if let Ok(n) = v.parse() { s.queue = n; } }
                    _ => {}
                }
            }
        }
    }
    s
}

// Replace the FullScreen/Width/Height lines in Config.ini, leaving every other
// byte (the cp1252 comment banner, CRLF endings, and the trailing newline the
// engine demands) byte-for-byte intact.
fn write_config(dir: &Path, s: &Settings) -> Result<(), String> {
    let path = dir.join("Config.ini");
    let raw = fs::read(&path).map_err(|e| format!("read Config.ini: {e}"))?;
    let fs_val = if s.fullscreen { "TRUE" } else { "FALSE" };
    let lines: Vec<&[u8]> = raw.split(|&b| b == b'\n').collect();
    let mut out: Vec<u8> = Vec::with_capacity(raw.len() + 16);
    for (i, line) in lines.iter().enumerate() {
        let (content, cr) = if line.last() == Some(&b'\r') { (&line[..line.len() - 1], true) } else { (&line[..], false) };
        let t = ascii_trim_start(content);
        let repl = if starts_with_ci(t, b"FullScreen=") { Some(format!("FullScreen={fs_val}")) }
            else if starts_with_ci(t, b"Width=") { Some(format!("Width={}", s.width)) }
            else if starts_with_ci(t, b"Height=") { Some(format!("Height={}", s.height)) }
            else { None };
        match repl { Some(r) => out.extend_from_slice(r.as_bytes()), None => out.extend_from_slice(content) }
        if cr { out.push(b'\r'); }
        if i + 1 < lines.len() { out.push(b'\n'); } // split() leaves a trailing "" so the final \n is preserved
    }
    fs::write(&path, out).map_err(|e| format!("write Config.ini: {e}"))
}

// Update [server] host and [room] code/queue in arena_link.ini, creating the
// file/sections/keys if missing.
fn write_arena(dir: &Path, s: &Settings) -> Result<(), String> {
    let path = arena_ini(dir);
    if let Some(parent) = path.parent() { let _ = fs::create_dir_all(parent); }
    let src = fs::read_to_string(&path).unwrap_or_default();
    let mut lines: Vec<String> = if src.trim().is_empty() {
        vec!["[server]".into(), "host =".into(), String::new(), "[room]".into(), "code =".into(), "queue =".into()]
    } else { src.lines().map(|l| l.to_string()).collect() };

    fn set(lines: &mut Vec<String>, section: &str, key: &str, val: &str) {
        let mut sec = String::new();
        let mut set_in = false;
        let mut sec_end = lines.len();
        for i in 0..lines.len() {
            let t = lines[i].trim().to_string();
            if t.starts_with('[') && t.ends_with(']') {
                sec = t[1..t.len()-1].to_lowercase();
                if sec == section { sec_end = i + 1; }
                continue;
            }
            if sec == section {
                if let Some((k, _)) = t.split_once('=') {
                    if k.trim().eq_ignore_ascii_case(key) { lines[i] = format!("{key} = {val}"); set_in = true; }
                }
                if !t.is_empty() { sec_end = i + 1; }
            }
        }
        if !set_in {
            let has_section = lines.iter().any(|l| l.trim().eq_ignore_ascii_case(&format!("[{section}]")));
            if has_section { lines.insert(sec_end.min(lines.len()), format!("{key} = {val}")); }
            else { lines.push(format!("[{section}]")); lines.push(format!("{key} = {val}")); }
        }
    }
    set(&mut lines, "server", "host", &s.host);
    set(&mut lines, "room", "code", &s.room);
    set(&mut lines, "room", "queue", &s.queue.to_string());
    let mut body = lines.join("\n");
    body.push('\n');
    fs::write(&path, body).map_err(|e| format!("write arena_link.ini: {e}"))
}

fn resolution_list(_native: [u32; 2], current: [u32; 2]) -> Vec<[u32; 2]> {
    // 4:3 ONLY. The game's UI is authored for 4:3 and the engine hit-tests the menus
    // and item grids in 800x600 *design* space (no pillarbox offset), while buttons
    // hit-test in *device* space. A single cursor mapping satisfies both only when the
    // pillarbox offset is 0 — i.e. at 4:3. Any other aspect renders fine but breaks
    // clicking on grids (bending-skill slots, merchant items). So we offer 4:3 sizes
    // only; zz_uiscale fills the screen edge-to-edge at any of them.
    let mut v: Vec<[u32; 2]> = vec![
        [1280, 960], [1440, 1080], [1600, 1200], [1920, 1440], [2048, 1536],
    ];
    // keep the saved value selectable only if it is already 4:3 (legacy 16:9 saves
    // get snapped to a 4:3 default by the frontend instead of being offered here).
    if current[0] > 0 && current[0] * 3 == current[1] * 4 { v.push(current); }
    v.sort_by(|a, b| (a[0] as u64 * a[1] as u64).cmp(&(b[0] as u64 * b[1] as u64)));
    v.dedup();
    v
}

// ---- HD texture pack --------------------------------------------------------
// game/Textures is the live set the engine loads. game/Textures.original holds the
// pristine backup, game/Textures.hd the AI-upscaled set. The launcher swaps the live
// set between them and records which is active in Textures/.texture-set, so it only
// copies when the choice actually changes.
fn tex_dirs(dir: &Path) -> (PathBuf, PathBuf, PathBuf) {
    let g = dir.join("game");
    (g.join("Textures"), g.join("Textures.original"), g.join("Textures.hd"))
}
fn dir_has_files(p: &Path) -> bool {
    fs::read_dir(p).map(|rd| rd.flatten().any(|e| e.path().is_file())).unwrap_or(false)
}
// HD is only usable when BOTH sets actually contain files — not merely that the
// folders exist. A distribution that shipped empty Textures.hd/ Textures.original/
// (the dirs travelled but the 160M of textures didn't) used to satisfy is_dir() and
// show a toggle that copied nothing; require real content so it stays hidden until
// the patcher has delivered the pack.
fn hd_available(dir: &Path) -> bool {
    let (_a, orig, hd) = tex_dirs(dir);
    dir_has_files(&orig) && dir_has_files(&hd)
}
fn texture_marker(dir: &Path) -> PathBuf { tex_dirs(dir).0.join(".texture-set") }
fn current_texture_set(dir: &Path) -> String {
    fs::read_to_string(texture_marker(dir)).unwrap_or_default().trim().to_string()
}
// Copy every file in `src` over the same name in `dst` (Textures is a flat folder).
// The bitmap-font atlases (tex_font_*) are skipped: fonts are always the HD (1024)
// atlas, which the game's per-font Scale in AvatarMP.vmo is sized for, so the
// HD/original texture toggle must never revert them (doing so would shrink all text).
fn copy_over(src: &Path, dst: &Path) -> Result<(), String> {
    for entry in fs::read_dir(src).map_err(|e| format!("read {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let p = entry.path();
        if p.is_file() {
            let name = entry.file_name();
            if name.to_string_lossy().starts_with("tex_font_") { continue; }
            fs::copy(&p, dst.join(&name)).map_err(|e| format!("copy {name:?}: {e}"))?;
        }
    }
    Ok(())
}
// Make the live Textures folder match `hd` (true = HD overlay, false = originals).
// No-op when already in that state (the marker matches) or when the sets are absent.
fn apply_textures(dir: &Path, hd: bool) -> Result<(), String> {
    if !hd_available(dir) { return Ok(()); }
    let want = if hd { "hd" } else { "original" };
    if current_texture_set(dir) == want { return Ok(()); }
    let (active, orig, hdd) = tex_dirs(dir);
    copy_over(if hd { &hdd } else { &orig }, &active)?;
    let _ = fs::write(texture_marker(dir), want);
    Ok(())
}

// ---- commands ---------------------------------------------------------------
#[tauri::command]
fn load(app: tauri::AppHandle) -> LoadResult {
    let native = app.primary_monitor().ok().flatten()
        .map(|m| { let s = m.size(); [s.width, s.height] }).unwrap_or([0, 0]);
    let gs = gamescope_available();
    match resolve_game_dir() {
        Some(dir) => {
            let mut settings = read_settings(&dir);
            settings.hd_textures = current_texture_set(&dir) == "hd";
            read_prefs(&mut settings);
            let resolutions = resolution_list(native, [settings.width, settings.height]);
            LoadResult { found: true, game_dir: Some(dir.to_string_lossy().into()), settings,
                         native, resolutions, hd_available: hd_available(&dir), gamescope_available: gs,
                         version: env!("CARGO_PKG_VERSION").into() }
        }
        None => {
            let mut settings = Settings::default();
            read_prefs(&mut settings);
            let resolutions = resolution_list(native, [settings.width, settings.height]);
            LoadResult { found: false, game_dir: None, settings, native, resolutions,
                         hd_available: false, gamescope_available: gs,
                         version: env!("CARGO_PKG_VERSION").into() }
        }
    }
}

// Swap the live texture set immediately (called when the toggle flips, so the copy
// happens then with UI feedback rather than stalling launch). Async so the file copy
// runs off the UI thread.
#[tauri::command]
async fn set_textures(hd: bool) -> Result<(), String> {
    let dir = resolve_game_dir().ok_or("game folder not found")?;
    // Explicit user action: fail loudly if the pack can't be applied, rather than
    // the old silent no-op (apply_textures stays lenient for the play() safety net).
    if !hd_available(&dir) {
        return Err("HD texture pack isn't installed — run \"Check for updates\" to download it.".into());
    }
    tauri::async_runtime::spawn_blocking(move || apply_textures(&dir, hd))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn save(settings: Settings) -> Result<(), String> {
    let dir = resolve_game_dir().ok_or("game folder not found")?;
    write_config(&dir, &settings)?;
    write_arena(&dir, &settings)?;
    write_prefs(&settings);
    Ok(())
}

#[tauri::command]
async fn locate(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    // The *blocking* folder picker deadlocks/crashes the GTK main loop on Linux when
    // called from a sync command. Use the non-blocking picker (the plugin shows it on
    // the right thread) and await the choice off the UI thread.
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |p| { let _ = tx.send(p); });
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
        .await.ok().flatten()?;
    let path = picked.into_path().ok()?;
    if is_game_dir(&path) {
        remember_game_dir(&path);
        Some(path.to_string_lossy().into())
    } else {
        None
    }
}

#[derive(Serialize, Default)]
struct StatusOut { reachable: bool, gateway: bool, database: bool, game_server: bool, players: u32 }

// Poll the gateway's public /status (CORS-open). Tries https then http so it works
// whether `host` is a TLS domain (gw.…) or a bare IP on :80.
#[tauri::command]
fn status(host: String) -> StatusOut {
    let host = host.trim().trim_end_matches('/');
    if host.is_empty() { return StatusOut::default(); }
    let agent = ureq::AgentBuilder::new().timeout(std::time::Duration::from_millis(2500)).build();
    for scheme in ["https", "http"] {
        let url = format!("{scheme}://{host}/status");
        if let Ok(resp) = agent.get(&url).call() {
            if let Ok(v) = resp.into_json::<serde_json::Value>() {
                let b = |k: &str| v.get(k).and_then(|x| x.as_bool()).unwrap_or(false);
                return StatusOut {
                    reachable: true,
                    gateway: v.get("gateway").and_then(|x| x.as_bool()).unwrap_or(true),
                    database: b("database"), game_server: b("game_server"),
                    players: v.get("players").and_then(|x| x.as_u64()).unwrap_or(0) as u32,
                };
            }
        }
    }
    StatusOut::default()
}

// ---- content patcher --------------------------------------------------------
// Pulls the gateway's /launcher/manifest.json (a list of game-folder files + their
// sha256), hashes the local copies, and downloads only what differs into the game
// folder — so game-side assets (e.g. BuildingBlocks/zz_uiscale.dll) update without
// shipping a new zip. Every download is sha256-verified before it's written.
#[derive(Deserialize)]
struct ManifestFile { path: String, sha256: String, #[serde(default)] size: u64 }
#[derive(Deserialize)]
struct Manifest { files: Vec<ManifestFile> }

#[derive(Serialize, Default)]
struct SyncOut { ok: bool, checked: u32, updated: Vec<String>, error: Option<String> }

// Progress event payload emitted during `sync` so the UI can show a download bar.
#[derive(Serialize, Clone)]
struct SyncProgress { done: u32, total: u32, file: String }

// Read-only "is there anything to update?" check — drives the update modal. Never
// downloads file bodies: compares the launcher version (release.json) and the game
// files' sha256 (manifest.json) against what's on disk.
#[derive(Serialize, Default)]
struct UpdateCheck {
    ok: bool,
    launcher_version: Option<String>, // newer launcher version, if one is published
    content_files: u32,               // count of game files that differ from the manifest
    content_bytes: u64,               // total bytes those updated files will download
    error: Option<String>,
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

// Reject anything that could escape the game folder (absolute or `..` segments).
fn safe_rel(p: &str) -> bool {
    !p.is_empty()
        && !p.starts_with('/') && !p.starts_with('\\')
        && !p.split(['/', '\\']).any(|seg| seg == ".." || seg.is_empty())
        && p.chars().nth(1) != Some(':') // no "C:\…"
}

fn fetch_manifest(agent: &ureq::Agent, host: &str) -> Option<(Manifest, &'static str)> {
    for scheme in ["https", "http"] {
        let url = format!("{scheme}://{host}/launcher/manifest.json");
        if let Ok(resp) = agent.get(&url).call() {
            if let Ok(m) = resp.into_json::<Manifest>() { return Some((m, scheme)); }
        }
    }
    None
}
// A manifest file needs downloading if it's missing locally or its sha256 differs.
fn file_differs(local: &Path, f: &ManifestFile) -> bool {
    match fs::read(local) { Ok(cur) => sha256_hex(&cur) != f.sha256, Err(_) => true }
}

// Core content sync. `on_progress` is called once before the work and after each
// file so the UI (or nothing, for the CLI path) can render a download bar.
fn run_sync(host: &str, on_progress: impl Fn(SyncProgress)) -> SyncOut {
    use std::io::Read;
    let host = host.trim().trim_end_matches('/');
    if host.is_empty() { return SyncOut { error: Some("no server set".into()), ..Default::default() }; }
    let dir = match resolve_game_dir() {
        Some(d) => d,
        None => return SyncOut { error: Some("game folder not found".into()), ..Default::default() },
    };
    let agent = ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(60)).build();
    let (manifest, scheme) = match fetch_manifest(&agent, host) {
        Some(x) => x, None => return SyncOut { error: Some("update server unreachable".into()), ..Default::default() },
    };
    // Pass 1: build the work set (files that differ) so the UI gets a real total.
    let todo: Vec<&ManifestFile> = manifest.files.iter()
        .filter(|f| safe_rel(&f.path) && file_differs(&dir.join(&f.path), f))
        .collect();
    let total = todo.len() as u32;
    let mut out = SyncOut { ok: true, checked: manifest.files.len() as u32, ..Default::default() };
    on_progress(SyncProgress { done: 0, total, file: String::new() });
    // Pass 2: download each, sha256-verify before writing, emit progress per file.
    for (i, f) in todo.iter().enumerate() {
        let url = format!("{scheme}://{host}/launcher/files/{}", f.path);
        let mut buf = Vec::new();
        let mut got = false;
        if let Ok(resp) = agent.get(&url).call() { got = resp.into_reader().read_to_end(&mut buf).is_ok(); }
        if got && sha256_hex(&buf) == f.sha256 { // corrupt/tampered → never write
            let local = dir.join(&f.path);
            if let Some(parent) = local.parent() { let _ = fs::create_dir_all(parent); }
            let tmp = local.with_extension("download.tmp");
            if fs::write(&tmp, &buf).is_ok() && fs::rename(&tmp, &local).is_ok() {
                out.updated.push(f.path.clone());
            } else { let _ = fs::remove_file(&tmp); }
        }
        on_progress(SyncProgress { done: (i + 1) as u32, total, file: f.path.clone() });
    }
    out
}

#[tauri::command]
fn sync(app: tauri::AppHandle, host: String) -> SyncOut {
    use tauri::Emitter;
    run_sync(&host, |p| { let _ = app.emit("sync-progress", p); })
}

// Relaunch the app — used by the update modal after a launcher self-update so the
// swapped-in binary takes effect without the user hunting for the .exe.
#[tauri::command]
fn restart(app: tauri::AppHandle) { app.restart(); }

#[tauri::command]
fn check_updates(host: String) -> UpdateCheck {
    let host = host.trim().trim_end_matches('/');
    if host.is_empty() { return UpdateCheck { error: Some("no server set".into()), ..Default::default() }; }
    let agent = ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(20)).build();
    let mut out = UpdateCheck { ok: true, ..Default::default() };
    let mut reached = false;
    // launcher self-update available?
    for scheme in ["https", "http"] {
        let url = format!("{scheme}://{host}/launcher/release.json");
        if let Ok(resp) = agent.get(&url).call() {
            if let Ok(r) = resp.into_json::<Release>() {
                reached = true;
                if version_gt(&r.version, env!("CARGO_PKG_VERSION")) { out.launcher_version = Some(r.version); }
                break;
            }
        }
    }
    // game content files that differ from the manifest?
    if let Some(dir) = resolve_game_dir() {
        if let Some((manifest, _)) = fetch_manifest(&agent, host) {
            reached = true;
            for f in &manifest.files {
                if safe_rel(&f.path) && file_differs(&dir.join(&f.path), f) {
                    out.content_files += 1;
                    out.content_bytes += f.size;
                }
            }
        }
    }
    if !reached { out.ok = false; out.error = Some("update server unreachable".into()); }
    out
}

// ---- launcher self-update ---------------------------------------------------
// The launcher updates ITSELF (not just game files): it reads /launcher/release.json
// (the published launcher version + a per-OS binary sha256), and if that's newer than
// the running version, downloads this platform's binary, verifies the hash, and swaps
// it onto disk (applies next restart). Best-effort — any failure leaves the running
// launcher untouched, so a bad update can never brick it.
#[derive(Deserialize)]
struct ReleasePlatform { file: String, sha256: String }
#[derive(Deserialize)]
struct Release { version: String, #[serde(default)] platforms: std::collections::HashMap<String, ReleasePlatform> }

#[derive(Serialize, Default)]
struct SelfUpdateOut { updated: bool, version: Option<String>, error: Option<String> }

fn platform_key() -> &'static str {
    #[cfg(target_os = "windows")] { "windows" }
    #[cfg(target_os = "macos")] { "macos" }
    #[cfg(all(unix, not(target_os = "macos")))] { "linux" }
}

// "1.2.3" > "1.2.0"? Missing/garbage parts read as 0.
fn version_gt(remote: &str, local: &str) -> bool {
    let parse = |s: &str| -> Vec<u64> { s.split('.').map(|p| p.trim().parse().unwrap_or(0)).collect() };
    let (r, l) = (parse(remote), parse(local));
    for i in 0..r.len().max(l.len()) {
        let (rv, lv) = (*r.get(i).unwrap_or(&0), *l.get(i).unwrap_or(&0));
        if rv != lv { return rv > lv; }
    }
    false
}

// Replace the running executable's file with `bytes`. On Unix, renaming over the
// running binary is safe (the process keeps the old inode; the next launch is new).
// On Windows the running .exe can't be overwritten, but it CAN be renamed aside first.
fn swap_self(exe: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = exe.parent().ok_or("no exe dir")?;
    let newp = dir.join(".launcher-update.new");
    fs::write(&newp, bytes).map_err(|e| format!("write update: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&newp, fs::Permissions::from_mode(0o755));
        fs::rename(&newp, exe).map_err(|e| { let _ = fs::remove_file(&newp); format!("swap: {e}") })?;
    }
    #[cfg(windows)]
    {
        let oldp = dir.join(".launcher-update.old");
        let _ = fs::remove_file(&oldp);
        fs::rename(exe, &oldp).map_err(|e| { let _ = fs::remove_file(&newp); format!("rename current: {e}") })?;
        if let Err(e) = fs::rename(&newp, exe) {
            let _ = fs::rename(&oldp, exe); // roll back
            let _ = fs::remove_file(&newp);
            return Err(format!("install update: {e}"));
        }
    }
    Ok(())
}

#[tauri::command]
fn self_update(host: String) -> SelfUpdateOut {
    use std::io::Read;
    let host = host.trim().trim_end_matches('/');
    if host.is_empty() { return SelfUpdateOut::default(); }
    let local = env!("CARGO_PKG_VERSION");
    let agent = ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(20)).build();
    let (rel, scheme) = {
        let mut found = None;
        for scheme in ["https", "http"] {
            let url = format!("{scheme}://{host}/launcher/release.json");
            if let Ok(resp) = agent.get(&url).call() {
                if let Ok(r) = resp.into_json::<Release>() { found = Some((r, scheme)); break; }
            }
        }
        match found { Some(x) => x, None => return SelfUpdateOut::default() } // unreachable server = no-op
    };
    if !version_gt(&rel.version, local) { return SelfUpdateOut::default(); }
    let plat = match rel.platforms.get(platform_key()) {
        Some(p) => p, None => return SelfUpdateOut { error: Some("no build for this OS".into()), ..Default::default() },
    };
    if !safe_rel(&plat.file) { return SelfUpdateOut { error: Some("bad file path".into()), ..Default::default() }; }
    let exe = match std::env::current_exe() {
        Ok(e) => e, Err(e) => return SelfUpdateOut { error: Some(format!("exe path: {e}")), ..Default::default() },
    };
    let url = format!("{scheme}://{host}/download/{}", plat.file);
    let mut buf = Vec::new();
    match agent.get(&url).call() {
        Ok(resp) => { if resp.into_reader().read_to_end(&mut buf).is_err() { return SelfUpdateOut { error: Some("download failed".into()), ..Default::default() }; } }
        Err(_) => return SelfUpdateOut { error: Some("download failed".into()), ..Default::default() },
    }
    if sha256_hex(&buf) != plat.sha256 { return SelfUpdateOut { error: Some("hash mismatch".into()), ..Default::default() }; }
    match swap_self(&exe, &buf) {
        Ok(()) => SelfUpdateOut { updated: true, version: Some(rel.version), error: None },
        Err(e) => SelfUpdateOut { error: Some(e), ..Default::default() },
    }
}

// On a path like `…/<prefix>/drive_c/…`, return `<prefix>` so we can set WINEPREFIX
// when launching the Windows client from Linux/macOS.
fn wine_prefix_of(dir: &Path) -> Option<PathBuf> {
    let mut prefix = PathBuf::new();
    for c in dir.components() {
        if c.as_os_str().to_str().map_or(false, |s| s.eq_ignore_ascii_case("drive_c")) {
            return Some(prefix);
        }
        prefix.push(c);
    }
    None
}

// Is `bin` runnable from PATH? (used to decide whether gamescope is available)
#[cfg(target_os = "linux")]
fn on_path(bin: &str) -> bool {
    std::env::var_os("PATH").map_or(false, |paths| {
        std::env::split_paths(&paths).any(|p| p.join(bin).is_file())
    })
}

// Whether the gamescope toggle should be offered: Linux + gamescope installed.
fn gamescope_available() -> bool {
    #[cfg(target_os = "linux")] { on_path("gamescope") }
    #[cfg(not(target_os = "linux"))] { false }
}

// `gamescope`/`gamescope_args` come from the launcher's Display toggle (Linux only).
// Env vars (AVATAR_GAMESCOPE / AVATAR_GAMESCOPE_ARGS / AVATAR_VK_ICD) still override.
#[cfg_attr(not(target_os = "linux"), allow(unused_variables))]
fn spawn_game(dir: &Path, exe_path: &Path, gamescope: bool, gamescope_args: &str,
              width: u32, height: u32, fullscreen: bool) -> Result<(), String> {
    use std::process::Command;
    #[cfg(target_os = "windows")]
    {
        Command::new(exe_path).current_dir(dir).spawn()
            .map_err(|e| format!("launch {}: {e}", exe_path.display()))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        // AvatarMP.exe is a Windows binary — on Linux/macOS run it through wine,
        // pointing WINEPREFIX at the prefix the game folder lives inside.
        let prefix = wine_prefix_of(dir);

        // Optional gamescope wrap (Linux). A 2008 wine game under a Wayland compositor
        // (Hyprland, etc.) hits transparency / wrong-monitor bugs and, on hybrid
        // AMD+NVIDIA laptops, can render on the dead GPU. gamescope isolates the game
        // into its own micro-compositor, routes it to a chosen GPU, and gives clean
        // fullscreen. Opt-in — the GPU device is machine-specific, so auto-enabling it
        // could black-screen a hybrid laptop (the very failure we're avoiding):
        //   AVATAR_GAMESCOPE=1            enable ("auto" = on when gamescope is found)
        //   AVATAR_GAMESCOPE_ARGS="…"     gamescope args, e.g. the values that work on
        //                                 a given box: "--prefer-vk-device 1002:1638
        //                                 -W 1920 -H 1080 -w 800 -h 600"
        //   AVATAR_VK_ICD=/path/icd.json  sets VK_ICD_FILENAMES (pin the Vulkan driver)
        // We always append `-f` (fullscreen) and the wine invocation.
        #[cfg(target_os = "linux")]
        {
            let env_want = std::env::var("AVATAR_GAMESCOPE").unwrap_or_default().to_ascii_lowercase();
            let env_enable = matches!(env_want.as_str(), "1" | "on" | "true" | "yes")
                || (env_want == "auto" && on_path("gamescope"));
            if gamescope || env_enable {
                if !on_path("gamescope") {
                    return Err("Gamescope is enabled but isn't installed (not on PATH).".into());
                }
                // Run via `setsid` so gamescope gets its OWN session, detached from the
                // launcher. Otherwise gamescope's reaper sees its parent (the launcher)
                // exit and kills the game — so closing/crashing the launcher (or the
                // launcher being killed) takes the running match down with it.
                let mut cmd = Command::new("setsid");
                cmd.arg("gamescope");
                cmd.current_dir(dir);
                if let Some(p) = &prefix { cmd.env("WINEPREFIX", p); }
                if let Ok(icd) = std::env::var("AVATAR_VK_ICD") { cmd.env("VK_ICD_FILENAMES", icd); }
                // Args from the toggle's field, then the env override, else AUTO:
                // render the game at its (4:3) resolution with -w/-h and let gamescope
                // upscale + CENTER it on the display (-W/-H native); --force-grab-cursor
                // keeps the pointer mapped to the game surface. Without -w/-h gamescope
                // can't size the nested display and the game lands tiny/top-left — which
                // is exactly the wine fullscreen bug we're working around.
                let explicit = if !gamescope_args.trim().is_empty() {
                    gamescope_args.to_string()
                } else {
                    std::env::var("AVATAR_GAMESCOPE_ARGS").unwrap_or_default()
                };
                let args = if !explicit.trim().is_empty() {
                    explicit
                } else {
                    // Only the game's render size. gamescope auto-detects the output
                    // monitor and fits 4:3 with aspect preserved (pillarbox) — pinning a
                    // guessed -W/-H stretched the picture (the splash looked squashed).
                    format!("-w {} -h {} --force-grab-cursor", width.max(640), height.max(480))
                };
                cmd.args(args.split_whitespace());
                if fullscreen { cmd.arg("-f"); }   // honour the Fullscreen toggle, not always
                cmd.arg("--").arg("wine").arg(exe_path);
                cmd.spawn().map_err(|e| format!("launch via gamescope: {e}"))?;
                return Ok(());
            }
        }

        let mut cmd = Command::new("wine");
        cmd.arg(exe_path).current_dir(dir);
        if let Some(p) = prefix { cmd.env("WINEPREFIX", p); }
        cmd.spawn().map_err(|e|
            format!("launch via wine ({}): {e} — is wine installed?", exe_path.display()))?;
    }
    Ok(())
}

#[tauri::command]
fn play(settings: Settings, windowed: bool) -> Result<(), String> {
    let dir = resolve_game_dir().ok_or("game folder not found")?;
    // The ⊡ Windowed button forces a window regardless of the Fullscreen toggle.
    let mut s = settings;
    if windowed { s.fullscreen = false; }
    write_prefs(&s);   // save the user's real toggles (gamescope/args) before overrides
    // The user's real fullscreen intent (Fullscreen toggle, minus the ⊡ Windowed button).
    // It drives whether gamescope gets -f; the game itself always runs WINDOWED inside
    // gamescope (that's what gives a centered, clickable game on Wayland — wine's own
    // exclusive fullscreen renders tiny/top-left and breaks the cursor).
    let want_fullscreen = s.fullscreen;
    if s.gamescope { s.fullscreen = false; }
    write_config(&dir, &s)?;
    write_arena(&dir, &s)?;
    // Safety net: make sure the live textures match the toggle (normally a no-op —
    // set_textures already applied it when the toggle was flipped).
    apply_textures(&dir, s.hd_textures)?;
    // ALWAYS launch AvatarMP_Windowed.exe — it's the Config-respecting client that
    // honours Width/Height/FullScreen and pairs with BuildingBlocks/zz_uiscale.dll to
    // scale the fixed 800x600 2D UI up to the real resolution. AvatarMP.exe ignores
    // Config.ini (hardcoded 800x600 top-left), so only use it as a last-resort fallback.
    let windowed_exe = dir.join("AvatarMP_Windowed.exe");
    let target = if windowed_exe.is_file() { windowed_exe } else { dir.join("AvatarMP.exe") };
    spawn_game(&dir, &target, s.gamescope, &s.gamescope_args, s.width, s.height, want_fullscreen)
}

// ---- remade menus (Tauri) ---------------------------------------------------
// The bundled menu UI (faithful HTML recreation of the in-game menus) needs to know
// where the live textures are (to render them via the asset protocol) and the saved
// gateway host (so login/data calls hit the right server).
#[derive(Serialize, Default)]
struct MenuInit {
    found: bool,
    game_dir: Option<String>,
    textures_dir: Option<String>,
    host: String,
}
#[tauri::command]
fn menu_init() -> MenuInit {
    match resolve_game_dir() {
        Some(dir) => {
            let tex = dir.join("game").join("Textures");
            MenuInit {
                found: true,
                game_dir: Some(dir.to_string_lossy().into_owned()),
                textures_dir: Some(tex.to_string_lossy().into_owned()),
                host: read_settings(&dir).host,
            }
        }
        None => MenuInit::default(),
    }
}

// Pull one `key="value"` attribute out of the gateway's tiny XML login reply.
fn xml_attr(xml: &str, key: &str) -> Option<String> {
    let needle = format!("{key}=\"");
    let start = xml.find(&needle)? + needle.len();
    let rest = &xml[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

#[derive(Serialize, Default)]
struct LoginOut {
    ok: bool,
    screen_name: String,
    error: Option<String>,
}

// Faithful login: the engine logs in via POST /common/login/check.jhtml (form
// screenName+password) → XML `<login loggedIn="true" … screenName="…" />`. The gateway
// auto-provisions unknown accounts, so a fresh name + password just works. Proxied
// through Rust (not fetch) to reuse the https→http fallback and dodge webview CORS.
#[tauri::command]
fn gw_login(host: String, username: String, password: String) -> LoginOut {
    let host = host.trim().trim_end_matches('/');
    let username = username.trim();
    if host.is_empty() {
        return LoginOut { error: Some("No server set.".into()), ..Default::default() };
    }
    if username.is_empty() {
        return LoginOut { error: Some("Enter a username.".into()), ..Default::default() };
    }
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(10)).build();
    let form = [("screenName", username), ("password", password.as_str())];
    for scheme in ["https", "http"] {
        let url = format!("{scheme}://{host}/common/login/check.jhtml");
        if let Ok(resp) = agent.post(&url).send_form(&form) {
            if let Ok(body) = resp.into_string() {
                if body.contains("loggedIn=\"true\"") {
                    let screen = xml_attr(&body, "screenName")
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| username.to_string());
                    return LoginOut { ok: true, screen_name: screen, error: None };
                }
                return LoginOut { error: Some("Invalid username or password.".into()), ..Default::default() };
            }
        }
    }
    LoginOut { error: Some("Couldn't reach the server.".into()), ..Default::default() }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Headless patcher: `launcher --sync [host]` runs the content sync and exits
    // (no window). Host defaults to the saved arena_link.ini host, then the official
    // gateway. Lets you patch from a script/cron and makes the patcher testable.
    let args: Vec<String> = std::env::args().collect();
    if let Some(pos) = args.iter().position(|a| a == "--sync") {
        let host = args.get(pos + 1).filter(|h| !h.starts_with('-')).cloned()
            .filter(|h| !h.is_empty())
            .or_else(|| resolve_game_dir().map(|d| read_settings(&d).host).filter(|h| !h.is_empty()))
            .unwrap_or_else(|| "gw.legends-awakened.com".to_string());
        eprintln!("syncing against {host} …");
        let out = run_sync(&host, |p| { if p.total > 0 { eprintln!("  {}/{}  {}", p.done, p.total, p.file); } });
        println!("{}", serde_json::to_string_pretty(&out).unwrap_or_default());
        std::process::exit(if out.ok { 0 } else { 1 });
    }
    if let Some(pos) = args.iter().position(|a| a == "--self-update") {
        let host = args.get(pos + 1).filter(|h| !h.starts_with('-')).cloned()
            .filter(|h| !h.is_empty())
            .or_else(|| resolve_game_dir().map(|d| read_settings(&d).host).filter(|h| !h.is_empty()))
            .unwrap_or_else(|| "gw.legends-awakened.com".to_string());
        eprintln!("checking launcher update against {host} (running {}) …", env!("CARGO_PKG_VERSION"));
        let out = self_update(host);
        println!("{}", serde_json::to_string_pretty(&out).unwrap_or_default());
        std::process::exit(if out.error.is_none() { 0 } else { 1 });
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // The remade menus load the game's real textures straight from the install
        // (game/Textures), so the webview can `convertFileSrc()` them. The install dir
        // is only known at runtime, so allow it here rather than via a static config glob.
        .setup(|app| {
            if let Some(dir) = resolve_game_dir() {
                let tex = dir.join("game").join("Textures");
                let _ = app.asset_protocol_scope().allow_directory(&tex, true);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![load, save, locate, play, status, sync, check_updates, self_update, restart, set_textures, menu_init, gw_login])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
