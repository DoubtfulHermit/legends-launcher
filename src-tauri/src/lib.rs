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
    #[serde(default)]
    skip_menu: bool,        // PLAY straight into the arena queue (toggles BuildingBlocks/zz_quickmatch.ini enabled)
    #[serde(default)]
    proton: bool,           // Linux: run the game through Proton (umu-run + DXVK) instead of raw wine
}
impl Default for Settings {
    fn default() -> Self {
        Settings { host: String::new(), room: String::new(), queue: 4,
                   fullscreen: true, width: 1440, height: 1080, hd_textures: false,
                   gamescope: false, gamescope_args: String::new(), skip_menu: false, proton: false }
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
    proton_available: bool,     // Linux + umu-run on PATH (so the Proton toggle is usable)
    version: String,            // launcher version (CARGO_PKG_VERSION), shown in the UI
    cloned: bool,               // a user-writable patched clone exists
    needs_clone: bool,          // an original is located but not yet cloned → show the first-run wizard
    original_dir: Option<String>, // the located original install (the clone source), for display
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

// ── patched-clone model (see docs/handoff_patching.md) ───────────────────────
// We never patch the player's ORIGINAL install (often in Program Files → needs
// admin). We clone it once into a user-writable home and patch/run the clone.
// Windows: %LOCALAPPDATA%\LegendsAwakened ; Unix: $XDG_DATA_HOME or ~/.local/share.
fn app_home() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
        .or_else(|| std::env::var_os("XDG_DATA_HOME").map(PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local").join("share")))
        .map(|d| d.join("LegendsAwakened"))
}
fn clone_dir() -> Option<PathBuf> { app_home().map(|d| d.join("game")) }
fn clone_meta_path() -> Option<PathBuf> { app_home().map(|d| d.join("clone.state")) }
fn clone_prefix_path() -> Option<PathBuf> { app_home().map(|d| d.join("wineprefix.path")) }

// The dir the launcher PATCHES and RUNS from: the clone if it's a valid game dir,
// otherwise the located original (pre-clone behaviour). Once cloned, every caller
// (patcher, Config/arena writers, play) follows automatically.
fn resolve_game_dir() -> Option<PathBuf> {
    if let Some(c) = clone_dir() { if is_game_dir(&c) { return Some(c); } }
    resolve_original_dir()
}

// Locate the player's ORIGINAL install (the clone source). AVATAR_GAME_DIR for dev,
// the folder next to the exe, or a remembered user-picked dir.
fn resolve_original_dir() -> Option<PathBuf> {
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

// Cheap fingerprint of a source install so we re-clone only when the SOURCE changes:
// "<path>|<AvatarMP.exe size>|<mtime>" — avoids hashing the whole multi-hundred-MB tree.
fn source_fingerprint(dir: &Path) -> String {
    let (size, mtime) = fs::metadata(dir.join("AvatarMP.exe")).map(|m| {
        let t = m.modified().ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs()).unwrap_or(0);
        (m.len(), t)
    }).unwrap_or((0, 0));
    format!("{}|{}|{}", dir.display(), size, mtime)
}
fn count_files(dir: &Path) -> u32 {
    let mut n = 0;
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.flatten() {
            match e.file_type() {
                Ok(ft) if ft.is_dir() => n += count_files(&e.path()),
                Ok(ft) if ft.is_file() => n += 1,
                _ => {}
            }
        }
    }
    n
}
// Recursively copy src→dst, overwriting (so a re-clone refreshes), reporting per file.
fn copy_tree(src: &Path, dst: &Path, total: u32, done: &mut u32,
             on: &dyn Fn(u32, u32, &str)) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let (from, to) = (entry.path(), dst.join(entry.file_name()));
        if ft.is_dir() {
            copy_tree(&from, &to, total, done, on)?;
        } else if ft.is_file() {
            fs::copy(&from, &to)?;
            *done += 1;
            on(*done, total, &entry.file_name().to_string_lossy());
        }
    }
    Ok(())
}
// Ensure a fresh clone of the original exists in the home. No-op when the clone is
// present and its source fingerprint is unchanged. Returns the clone dir.
fn ensure_clone(on: &dyn Fn(u32, u32, &str)) -> Result<PathBuf, String> {
    let src = resolve_original_dir().ok_or("game folder not found")?;
    let dst = clone_dir().ok_or("no home dir")?;
    let meta = clone_meta_path().ok_or("no home dir")?;
    let fp = source_fingerprint(&src);
    if is_game_dir(&dst) {
        if let Ok(prev) = fs::read_to_string(&meta) {
            if prev.trim() == fp { return Ok(dst); }   // already current
        }
    }
    if let Some(parent) = dst.parent() { let _ = fs::create_dir_all(parent); }
    let total = count_files(&src);
    let mut done = 0u32;
    on(0, total, "");
    copy_tree(&src, &dst, total, &mut done, on).map_err(|e| format!("clone copy: {e}"))?;
    let _ = fs::write(&meta, &fp);
    // Linux: record which wine prefix the ORIGINAL lived in, so we run the clone there
    // (that prefix already has the game's deps). Harmless on Windows (no drive_c → None).
    if let (Some(pp), Some(wp)) = (clone_prefix_path(), wine_prefix_of(&src)) {
        let _ = fs::write(&pp, wp.to_string_lossy().as_bytes());
    }
    Ok(dst)
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
                    "skip_menu" => s.skip_menu = v.trim() == "1" || v.trim().eq_ignore_ascii_case("true"),
                    "proton" => s.proton = v.trim() == "1" || v.trim().eq_ignore_ascii_case("true"),
                    // fullscreen lives here (the user's INTENT) because play() flips Config.ini's
                    // FullScreen to windowed for the Proton+gamescope path — reading it back from Config
                    // would reset the toggle every launch. The conf keeps the real choice.
                    "fullscreen" => s.fullscreen = v.trim() == "1" || v.trim().eq_ignore_ascii_case("true"),
                    _ => {}
                }
            }
        }
    }
}
fn write_prefs(s: &Settings) {
    if let Some(p) = prefs_path() {
        if let Some(parent) = p.parent() { let _ = fs::create_dir_all(parent); }
        let _ = fs::write(p, format!("gamescope={}\ngamescope_args={}\nskip_menu={}\nproton={}\nfullscreen={}\n",
            if s.gamescope { 1 } else { 0 }, s.gamescope_args, if s.skip_menu { 1 } else { 0 },
            if s.proton { 1 } else { 0 }, if s.fullscreen { 1 } else { 0 }));
    }
}

// The quickmatch DLL (always present in BuildingBlocks) reads `enabled` from its own ini:
// 1 = on PLAY it fires the arena (AutoMatch) queue straight from a fresh menu — no menu
// navigation — so the player lands in queue; 0 = leave the normal menus. The launcher's
// "Skip menus → queue" toggle flips this just before each launch. No-op if the ini is absent.
fn quickmatch_ini(dir: &Path) -> PathBuf { dir.join("BuildingBlocks").join("zz_quickmatch.ini") }
// Set flat key=value pairs in a section-less ini (zz_quickmatch.ini), line-preserving:
// replace the first matching `key=…` (ignoring comments), else append.
fn ini_set_flat(text: &str, kv: &[(&str, &str)]) -> String {
    let mut lines: Vec<String> = text.lines().map(|l| l.to_string()).collect();
    for (key, val) in kv {
        let mut done = false;
        for line in lines.iter_mut() {
            let t = line.trim_start();
            if t.starts_with('#') || t.starts_with(';') { continue; }
            if let Some((k, _)) = t.split_once('=') {
                if k.trim().eq_ignore_ascii_case(key) { *line = format!("{key} = {val}"); done = true; break; }
            }
        }
        if !done { lines.push(format!("{key} = {val}")); }
    }
    let mut body = lines.join("\n"); body.push('\n'); body
}

// Configure BuildingBlocks/zz_quickmatch.ini for the seamless Play.
//  - disabled / not logged in → enabled=0: classic client, the player logs in by hand.
//  - skip + logged in → AUTO-LOGIN ONLY: the DLL auto-submits the launcher's authenticated login
//    (username + ticket, no password) FAST, then STOPS at the post-login menu and hands control to the
//    player. No char-select/queue driving, NO identity forcing, NO cover/reveal — the game shows
//    normally; it just lands logged in. (login_gap_ms small = a flash.) The launcher having already
//    authenticated the user is the whole point: you never type the in-game login again.
fn write_quickmatch(dir: &Path, enabled: bool, logged_in: bool) {
    let p = quickmatch_ini(dir);
    let Ok(txt) = fs::read_to_string(&p) else { return; }; // DLL/ini not installed → nothing to toggle
    let kv: Vec<(&str, &str)> = if enabled && logged_in {
        vec![
            ("enabled", "1"),
            ("local_login", "1"),
            // Match the successful manual path: seed the login fields, then let the game's
            // real Login button graph run. Activating the child behavior directly logs in, but
            // leaves later Multiplayer/Play in a bad menu state.
            ("login_activate", ""),
            ("login_submit", ""),
            ("login_seq", ""),
            ("type_login", "1"),
            ("submit_obj", "btn_t_l_log_1"),
            ("char_seq", ""),            // STOP after login — hand the menu to the player
            ("queue_after_login", "0"),  // don't drive char-select / queue
            ("set_nation", "0"), ("set_custom", ""),
            ("set_online", "0"),
            ("orchestrate", "0"),        // game shown normally (no cover/reveal hackery)
            ("login_gap_ms", "650"),     // short frame-paced gap between real menu clicks
        ]
    } else {
        vec![("enabled", "0")]   // not logged in → classic client (manual login)
    };
    let _ = fs::write(&p, ini_set_flat(&txt, &kv));
}

// Write the seamless-login sidecar (username + single-use ticket) the DLL reads to drive the in-game
// login (its WININET hook rewrites the check.jhtml POST to this account). Consumed + deleted by the DLL.
fn write_game_creds(dir: &Path, username: &str, ticket: &str) {
    if username.is_empty() || ticket.is_empty() { return; }
    let _ = fs::write(quickmatch_creds(dir), format!("username={username}\nticket={ticket}\n"));
}

// Seamless-login creds for the game: a sidecar the DLL reads ONCE then deletes. Holds the
// launcher's username + a single-use gateway ticket — never the password. Written fresh per
// launch when Skip-menus is on and the player is logged in; cleared otherwise so a stale
// ticket never lingers.
fn quickmatch_creds(dir: &Path) -> PathBuf { dir.join("BuildingBlocks").join("zz_quickmatch.creds") }
fn clear_game_creds(dir: &Path) { let _ = fs::remove_file(quickmatch_creds(dir)); }

// Themed loading-card data the in-game cover (zz_quickmatch.dll) reads at PLAY: the selected element
// (drives the theme), the player name + nation, the party, and the room — so the loading screen
// matches the launcher. Written fresh per logged-in launch; cleared otherwise.
fn loading_ini(dir: &Path) -> PathBuf { dir.join("BuildingBlocks").join("zz_loading.ini") }
fn write_loading(dir: &Path, element: &str, name: &str, nation: &str, party: &str, room: &str) {
    let body = format!("element={element}\nname={name}\nnation={nation}\nparty={party}\nroom={room}\n");
    let _ = fs::write(loading_ini(dir), body);
}
fn clear_loading(dir: &Path) {
    let _ = fs::remove_file(loading_ini(dir));
    let _ = fs::remove_file(dir.join("BuildingBlocks").join("zz_loading.bmp"));
}

// The launcher renders the loading screen (its real CSS/SVG/Cinzel) to a <canvas> and hands the raw
// RGBA here; we write it as a 24-bit BMP the in-game cover blits, so the loader looks IDENTICAL to the
// launcher. (Base64 to avoid a giant JSON byte array; tiny inline decoder to avoid a new dep.)
fn b64_decode(s: &str) -> Vec<u8> {
    let mut t = [255u8; 256];
    for (i, c) in b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".iter().enumerate() {
        t[*c as usize] = i as u8;
    }
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let (mut buf, mut bits) = (0u32, 0u32);
    for &c in s.as_bytes() {
        let v = t[c as usize];
        if v == 255 { continue; }
        buf = (buf << 6) | v as u32; bits += 6;
        if bits >= 8 { bits -= 8; out.push((buf >> bits) as u8); }
    }
    out
}
fn write_loading_bmp(dir: &Path, w: u32, h: u32, rgba: &[u8]) {
    let (wn, hn) = (w as usize, h as usize);
    if wn == 0 || hn == 0 || rgba.len() < wn * hn * 4 { return; }
    let rowpad = (wn * 3 + 3) & !3;
    let imgsize = rowpad * hn;
    let mut b: Vec<u8> = Vec::with_capacity(54 + imgsize);
    b.extend_from_slice(b"BM");
    b.extend_from_slice(&((54 + imgsize) as u32).to_le_bytes());
    b.extend_from_slice(&0u32.to_le_bytes());
    b.extend_from_slice(&54u32.to_le_bytes());
    b.extend_from_slice(&40u32.to_le_bytes());
    b.extend_from_slice(&(w as i32).to_le_bytes());
    b.extend_from_slice(&(h as i32).to_le_bytes());            // positive = bottom-up
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&24u16.to_le_bytes());
    b.extend_from_slice(&0u32.to_le_bytes());
    b.extend_from_slice(&(imgsize as u32).to_le_bytes());
    b.extend_from_slice(&2835i32.to_le_bytes());
    b.extend_from_slice(&2835i32.to_le_bytes());
    b.extend_from_slice(&0u32.to_le_bytes());
    b.extend_from_slice(&0u32.to_le_bytes());
    for y in (0..hn).rev() {
        let base = y * wn * 4;
        for x in 0..wn { let i = base + x * 4; b.push(rgba[i + 2]); b.push(rgba[i + 1]); b.push(rgba[i]); }
        for _ in 0..(rowpad - wn * 3) { b.push(0); }
    }
    let _ = fs::write(dir.join("BuildingBlocks").join("zz_loading.bmp"), b);
}
#[tauri::command]
fn save_loading_image(width: u32, height: u32, data: String) -> Result<(), String> {
    let dir = resolve_game_dir().ok_or("game folder not found")?;
    write_loading_bmp(&dir, width, height, &b64_decode(&data));
    Ok(())
}

fn write_launch_debug(dir: &Path, exe_path: &Path, auto_login: bool, skip_env: &str, auto_login_env: &str) {
    let body = format!(
        "exe={}\nauto_login={}\nAVATAR_SKIP_MENUS={}\nAVATAR_AUTO_LOGIN={}\n",
        exe_path.display(),
        if auto_login { 1 } else { 0 },
        skip_env,
        auto_login_env
    );
    let _ = fs::write(dir.join("launcher_last_play.env"), body);
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

// The game gets a NUMERIC IP, not a hostname. Two reasons:
//  1. arena_link.dll resolves the master with an IP-only parser (inet_addr) — a hostname
//     yields master_ip=0xffffffff and the UDP match never connects ("unable to connect to
//     master server" / black screen).
//  2. HTTP to a raw IP hits Caddy's plain-HTTP catch-all (the IP doesn't match the gw cert
//     host), dodging the gw HTTPS 308-redirect the 2008 WebManager can't follow.
// So resolve whatever host the user configured to an IPv4 and write that. The launcher's
// OWN API calls still use the original hostname (gw.* over HTTPS). A bare IP passes through;
// resolution failure falls back to the hostname.
fn game_host(h: &str) -> String {
    use std::net::{IpAddr, ToSocketAddrs};
    let host = h.trim();
    if host.is_empty() || host.parse::<IpAddr>().is_ok() {
        return host.to_string();                       // already an IP (or empty)
    }
    if let Ok(addrs) = (host, 80u16).to_socket_addrs() {
        let addrs: Vec<_> = addrs.collect();
        if let Some(a) = addrs.iter().find(|a| a.is_ipv4()).or_else(|| addrs.first()) {
            return a.ip().to_string();                 // resolved → numeric IP
        }
    }
    host.to_string()                                   // resolution failed → hostname fallback
}

// Update [server] host and [room] code/queue in arena_link.ini, creating the
// file/sections/keys if missing.
fn write_arena(dir: &Path, s: &Settings, ticket: Option<&str>) -> Result<(), String> {
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
    set(&mut lines, "server", "host", &game_host(&s.host));
    set(&mut lines, "room", "code", &s.room);
    set(&mut lines, "room", "queue", &s.queue.to_string());
    // [player] ticket: the launcher's authenticated identity token (HMAC, short-lived) — arena_link
    // forwards it to the game server so the match loads this account's real character. Some("")
    // clears it (no stale token); None leaves it untouched (e.g. plain settings save).
    if let Some(v) = ticket { set(&mut lines, "player", "ticket", v); }
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
    let pt = proton_available();
    // clone state (see docs/handoff_patching.md): an original located but not yet
    // cloned → first-run wizard; once cloned, resolve_game_dir() returns the clone.
    let cloned = clone_dir().map(|c| is_game_dir(&c)).unwrap_or(false);
    let original = resolve_original_dir();
    let original_dir = original.as_ref().map(|p| p.to_string_lossy().into_owned());
    let needs_clone = original.is_some() && !cloned;
    match resolve_game_dir() {
        Some(dir) => {
            let mut settings = read_settings(&dir);
            settings.hd_textures = current_texture_set(&dir) == "hd";
            read_prefs(&mut settings);
            let resolutions = resolution_list(native, [settings.width, settings.height]);
            LoadResult { found: true, game_dir: Some(dir.to_string_lossy().into()), settings,
                         native, resolutions, hd_available: hd_available(&dir), gamescope_available: gs,
                         proton_available: pt,
                         version: env!("CARGO_PKG_VERSION").into(), cloned, needs_clone, original_dir }
        }
        None => {
            let mut settings = Settings::default();
            read_prefs(&mut settings);
            let resolutions = resolution_list(native, [settings.width, settings.height]);
            LoadResult { found: false, game_dir: None, settings, native, resolutions,
                         hd_available: false, gamescope_available: gs, proton_available: pt,
                         version: env!("CARGO_PKG_VERSION").into(), cloned, needs_clone, original_dir }
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
    write_arena(&dir, &settings, None)?;   // leave any [player] ticket untouched
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
// Off the UI thread (spawn_blocking): a sync command runs on the GTK main loop,
// so a 2.5s×2 network wait every 12s froze the whole window. Now the blocking
// HTTP runs on a worker; the webview stays responsive. Timeout trimmed too.
#[tauri::command]
async fn status(host: String) -> StatusOut {
    tauri::async_runtime::spawn_blocking(move || {
        let host = host.trim().trim_end_matches('/');
        if host.is_empty() { return StatusOut::default(); }
        let agent = ureq::AgentBuilder::new().timeout(std::time::Duration::from_millis(1200)).build();
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
    }).await.unwrap_or_default()
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
struct SyncOut { ok: bool, checked: u32, updated: Vec<String>, failed: Vec<String>, error: Option<String> }

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
            } else {
                // download was fine but we couldn't WRITE it — locked (game running),
                // read-only, or a permission-protected folder (Program Files). Report it
                // so the UI can tell the user instead of silently doing nothing.
                let _ = fs::remove_file(&tmp);
                out.failed.push(f.path.clone());
            }
        } else if !got {
            out.failed.push(f.path.clone());  // download failed (network)
        }
        on_progress(SyncProgress { done: (i + 1) as u32, total, file: f.path.clone() });
    }
    if !out.failed.is_empty() && out.updated.is_empty() {
        out.error = Some("Couldn't write game files — close the game and make sure the \
            folder isn't read-only (avoid Program Files, or run as administrator).".into());
    }
    out
}

#[tauri::command]
async fn sync(app: tauri::AppHandle, host: String) -> SyncOut {
    use tauri::Emitter;
    tauri::async_runtime::spawn_blocking(move || {
        run_sync(&host, |p| { let _ = app.emit("sync-progress", p); })
    }).await.unwrap_or_default()
}

#[derive(Serialize, Default)]
struct CloneOut { ok: bool, dir: Option<String>, error: Option<String> }

// First-run / re-clone: copy the player's ORIGINAL install into the user-writable
// home so we patch + run from there (no admin, non-destructive). No-op when the
// clone is already current. Emits "clone-progress" {done,total,file}.
#[tauri::command]
async fn prepare_clone(app: tauri::AppHandle) -> CloneOut {
    use tauri::Emitter;
    tauri::async_runtime::spawn_blocking(move || {
        let on = |done: u32, total: u32, file: &str| {
            let _ = app.emit("clone-progress", SyncProgress { done, total, file: file.to_string() });
        };
        match ensure_clone(&on) {
            Ok(dir) => CloneOut { ok: true, dir: Some(dir.to_string_lossy().into_owned()), error: None },
            Err(e) => CloneOut { ok: false, dir: None, error: Some(e) },
        }
    }).await.unwrap_or_default()
}

// Relaunch the app (kept for callers; no longer used by the update flow).
#[tauri::command]
fn restart(app: tauri::AppHandle) { app.restart(); }

// Open a URL in the user's browser — the update modal's "Download" button uses this
// to send the user to the download page instead of self-modifying the running exe.
#[tauri::command]
fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

// Version-only check. NO self-update, NO content patcher — the launcher never
// modifies itself or game files (that self-modifying-exe path silently failed on
// Windows). If the gateway advertises a newer version, the UI just prompts the user
// to DOWNLOAD it manually (opens the download page). Reliable, no SmartScreen/lock
// surprises.
#[tauri::command]
async fn check_updates(host: String) -> UpdateCheck {
    tauri::async_runtime::spawn_blocking(move || {
    let host = host.trim().trim_end_matches('/');
    if host.is_empty() { return UpdateCheck { error: Some("no server set".into()), ..Default::default() }; }
    let agent = ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(15)).build();
    let mut out = UpdateCheck { ok: true, ..Default::default() };
    let mut reached = false;
    // Launcher self-update is handled by the updater plugin (GitHub Releases); check_updates
    // now only covers game CONTENT (DLLs/textures) that differ from the gateway manifest —
    // which the launcher CAN safely patch into the user-writable clone, with the user's OK.
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
    }).await.unwrap_or_default()
}

// ---- launcher self-update (tauri-plugin-updater, from GitHub Releases) -------
// The launcher is a bundled, installed app (NSIS on Windows, AppImage on Linux), so the
// OFFICIAL updater plugin does the download + minisign signature verification + install +
// restart — correctly per-OS, instead of a hand-rolled exe swap. The update endpoint and
// the public key live in tauri.conf.json (plugins.updater). See docs/handoff_release_signing.md.
#[derive(Serialize, Default)]
struct SelfUpdateOut { updated: bool, version: Option<String>, error: Option<String> }

#[tauri::command]
async fn self_update(app: tauri::AppHandle) -> SelfUpdateOut {
    // Linux updates via the package manager — never self-install (would call dpkg). See check_self_update.
    #[cfg(target_os = "linux")]
    { let _ = &app; return SelfUpdateOut { error: Some("On Linux, update with your package manager (pacman / apt / AUR).".into()), ..Default::default() }; }
    #[cfg(not(target_os = "linux"))]
    {
    use tauri_plugin_updater::UpdaterExt;
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => return SelfUpdateOut { error: Some(e.to_string()), ..Default::default() },
    };
    let update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => return SelfUpdateOut::default(),          // already current
        Err(e) => return SelfUpdateOut { error: Some(e.to_string()), ..Default::default() },
    };
    let version = update.version.clone();
    match update.download_and_install(|_chunk, _total| {}, || {}).await {
        Ok(()) => SelfUpdateOut { updated: true, version: Some(version), error: None },
        Err(e) => SelfUpdateOut { error: Some(e.to_string()), ..Default::default() },
    }
    }
}

#[derive(Serialize, Default)]
struct SelfUpdateCheck { available: bool, version: Option<String> }

// Is a newer signed launcher available? (checks the updater endpoint, installs nothing —
// the UI prompts, then calls self_update.) Silent no-op if the endpoint is unreachable.
#[tauri::command]
async fn check_self_update(app: tauri::AppHandle) -> SelfUpdateCheck {
    // Linux installs are owned by the package manager (pacman / apt / AUR). The in-app
    // updater would download the .deb and shell out to `dpkg` (absent on Arch) to replace
    // a package-managed binary — so never offer a self-update on Linux. Windows (NSIS) only.
    #[cfg(target_os = "linux")]
    { let _ = &app; return SelfUpdateCheck::default(); }
    #[cfg(not(target_os = "linux"))]
    {
        use tauri_plugin_updater::UpdaterExt;
        if let Ok(updater) = app.updater() {
            if let Ok(Some(u)) = updater.check().await {
                return SelfUpdateCheck { available: true, version: Some(u.version) };
            }
        }
        SelfUpdateCheck::default()
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

// The WINEPREFIX to run `dir` under: the prefix it sits inside (original installed in a
// prefix), else the prefix recorded at clone time (the clone lives outside any drive_c
// but should run in the original's working prefix, which has the game's deps), else
// the default (~/.wine). See docs/handoff_patching.md.
fn effective_wine_prefix(dir: &Path) -> Option<PathBuf> {
    if let Some(p) = wine_prefix_of(dir) { return Some(p); }
    if let Some(pp) = clone_prefix_path() {
        if let Ok(s) = fs::read_to_string(&pp) {
            let p = PathBuf::from(s.trim());
            if p.is_dir() { return Some(p); }
        }
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

// Whether the Proton toggle should be offered: Linux + umu-run installed (umu fetches Proton itself).
fn proton_available() -> bool {
    #[cfg(target_os = "linux")] { on_path("umu-run") }
    #[cfg(not(target_os = "linux"))] { false }
}
// A dedicated Proton prefix (kept separate from the wine prefix the rest of the game uses).
#[cfg(target_os = "linux")]
fn proton_prefix() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share/legends-awakened/proton-pfx"))
}
// Find an installed GE-Proton so umu doesn't have to download one. Returns the first GE-Proton
// found in the standard Steam compat-tools dirs; None → let umu-run fetch its default UMU-Proton.
#[cfg(target_os = "linux")]
fn find_proton_path() -> Option<PathBuf> {
    let home = PathBuf::from(std::env::var_os("HOME")?);
    for d in [".steam/root/compatibilitytools.d", ".local/share/Steam/compatibilitytools.d",
              ".steam/steam/compatibilitytools.d"] {
        if let Ok(rd) = fs::read_dir(home.join(d)) {
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().into_owned();
                if n.starts_with("GE-Proton") && e.path().join("proton").is_file() {
                    return Some(e.path());
                }
            }
        }
    }
    None
}

// `gamescope`/`gamescope_args` come from the launcher's Display toggle (Linux only).
// Env vars (AVATAR_GAMESCOPE / AVATAR_GAMESCOPE_ARGS / AVATAR_VK_ICD) still override.
#[cfg_attr(not(target_os = "linux"), allow(unused_variables))]
// Launch the game. Returns the child process when we can track it (so the caller can wait for
// the game to exit) — or None when it's detached on purpose (gamescope via setsid).
fn spawn_game(dir: &Path, exe_path: &Path, auto_login: bool, gamescope: bool, gamescope_args: &str,
              width: u32, height: u32, fullscreen: bool, proton: bool) -> Result<Option<std::process::Child>, String> {
    use std::process::Command;
    // Login-only is not skip/queue. Keep the old skip env off for Auto sign-in and use a separate
    // marker so the DLL installs only the login driver + observers, not the queue-era hooks.
    let skip_env = "0";
    let auto_login_env = if auto_login { "1" } else { "0" };
    write_launch_debug(dir, exe_path, auto_login, skip_env, auto_login_env);
    #[cfg(target_os = "windows")]
    {
        let child = Command::new(exe_path).current_dir(dir)
            .env("AVATAR_SKIP_MENUS", skip_env)
            .env("AVATAR_AUTO_LOGIN", auto_login_env)
            .spawn()
            .map_err(|e| format!("launch {}: {e}", exe_path.display()))?;
        Ok(Some(child))
    }
    #[cfg(not(target_os = "windows"))]
    {
        // AvatarMP.exe is a Windows binary — on Linux/macOS run it through wine,
        // pointing WINEPREFIX at the clone's recorded prefix (or the one it sits inside).
        let prefix = effective_wine_prefix(dir);

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
        // PROTON (Linux): run the game through umu-run + Proton (DXVK) instead of raw wine. Old
        // Virtools/DirectX games render far more reliably on DXVK, and Proton presents consistent
        // monitor coordinates (so the seamless cover lands on the right screen). The game files stay
        // in place — umu runs the exe via the Z:/X: mapping and uses a dedicated Proton prefix for C:.
        // Takes precedence over gamescope/wine when the Proton toggle is on.
        #[cfg(target_os = "linux")]
        if proton {
            if !on_path("umu-run") {
                return Err("Proton is enabled but umu-run isn't installed (install umu-launcher).".into());
            }
            let pfx = proton_prefix();
            if let Some(p) = &pfx { let _ = fs::create_dir_all(p); }
            let pp = find_proton_path();
            // Fullscreen for this windowed client comes from gamescope SCALING the game to the screen
            // (the game itself only makes a fixed-size window). gamescope+Proton/DXVK nests cleanly on
            // Wayland (gamescope+raw-wine does NOT — it aborts), so we only do this on the Proton path.
            // --backend wayland is required under a Wayland compositor (the default backend aborts).
            if fullscreen && on_path("gamescope") {
                // setsid so gamescope owns its session (closing the launcher won't kill the match).
                let mut cmd = Command::new("setsid");
                cmd.arg("gamescope").current_dir(dir);
                if std::env::var_os("WAYLAND_DISPLAY").is_some() { cmd.args(["--backend", "wayland"]); }
                cmd.args(["-w", &width.max(640).to_string(), "-h", &height.max(480).to_string(), "-S", "fit", "-f"]);
                cmd.arg("--").arg("env");
                cmd.arg("GAMEID=umu-avatar");
                cmd.arg(format!("AVATAR_SKIP_MENUS={skip_env}"));
                cmd.arg(format!("AVATAR_AUTO_LOGIN={auto_login_env}"));
                if let Some(p) = &pfx { cmd.arg(format!("WINEPREFIX={}", p.display())); }
                if let Some(p) = &pp { cmd.arg(format!("PROTONPATH={}", p.display())); }
                if let Ok(icd) = std::env::var("AVATAR_VK_ICD") { cmd.arg(format!("VK_ICD_FILENAMES={icd}")); }
                cmd.arg("umu-run").arg(exe_path);
                cmd.spawn().map_err(|e| format!("launch via gamescope+Proton: {e}"))?;
                return Ok(None);   // detached via setsid — its exit can't be tracked
            }
            // Windowed Proton (no fullscreen): run umu-run directly so we can wait on it.
            let mut cmd = Command::new("umu-run");
            cmd.arg(exe_path).current_dir(dir);
            cmd.env("AVATAR_SKIP_MENUS", skip_env);
            cmd.env("AVATAR_AUTO_LOGIN", auto_login_env);
            cmd.env("GAMEID", "umu-avatar");                 // non-Steam GAMEID for umu
            if let Some(p) = pfx { cmd.env("WINEPREFIX", p); }
            if let Some(p) = pp { cmd.env("PROTONPATH", p); }
            if let Ok(icd) = std::env::var("AVATAR_VK_ICD") { cmd.env("VK_ICD_FILENAMES", icd); }
            let child = cmd.spawn().map_err(|e|
                format!("launch via Proton/umu-run ({}): {e}", exe_path.display()))?;
            return Ok(Some(child));
        }

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
                cmd.env("AVATAR_SKIP_MENUS", skip_env);
                cmd.env("AVATAR_AUTO_LOGIN", auto_login_env);
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
                    // NO --force-grab-cursor: it warps the pointer every frame, which
                    // makes the game's mouse-look spin wildly (uncontrollable camera).
                    format!("-w {} -h {} -S fit", width.max(640), height.max(480))
                };
                cmd.args(args.split_whitespace());
                // Fullscreen -> -f. Windowed -> -b (borderless) so the host window's title
                // bar doesn't push the view up and clip the bottom of the HUD.
                cmd.arg(if fullscreen { "-f" } else { "-b" });
                cmd.arg("--").arg("wine").arg(exe_path);
                cmd.spawn().map_err(|e| format!("launch via gamescope: {e}"))?;
                return Ok(None);   // detached via setsid — its exit can't be tracked
            }
        }

        let mut cmd = Command::new("wine");
        cmd.arg(exe_path).current_dir(dir);
        cmd.env("AVATAR_SKIP_MENUS", skip_env);
        cmd.env("AVATAR_AUTO_LOGIN", auto_login_env);
        if let Some(p) = prefix { cmd.env("WINEPREFIX", p); }
        let child = cmd.spawn().map_err(|e|
            format!("launch via wine ({}): {e} — is wine installed?", exe_path.display()))?;
        Ok(Some(child))
    }
}

#[tauri::command]
async fn play(settings: Settings, windowed: bool, username: Option<String>, ticket: Option<String>,
              element: Option<String>, party: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
    let dir = resolve_game_dir().ok_or("game folder not found")?;
    // The ⊡ Windowed button forces a window regardless of the Fullscreen toggle.
    let mut s = settings;
    // Persist the user's REAL settings intent FIRST — before the ⊡ Windowed one-time override and the
    // gamescope/Proton windowed override — so toggles (incl. Fullscreen) survive every launch.
    write_prefs(&s);
    if windowed { s.fullscreen = false; }
    // The user's real fullscreen intent (Fullscreen toggle, minus the ⊡ Windowed button).
    // It drives whether gamescope gets -f; the game itself always runs WINDOWED inside
    // gamescope (that's what gives a centered, clickable game on Wayland — wine's own
    // exclusive fullscreen renders tiny/top-left and breaks the cursor).
    let want_fullscreen = s.fullscreen;
    // The game runs WINDOWED whenever gamescope does the fullscreen scaling: the wine+gamescope path,
    // AND the Proton path when fullscreen is on (Proton wraps umu-run in gamescope to fill the screen,
    // since this windowed client can't fullscreen itself). gamescope then scales it up.
    if (s.gamescope && !s.proton) || (s.proton && want_fullscreen) { s.fullscreen = false; }
    write_config(&dir, &s)?;
    // Identity: when skipping menus AND logged in, pass the launcher's auth ticket to arena_link
    // (it forwards it to the game server, which loads this account's real character). Otherwise
    // no ticket → the match uses the default character.
    let tk = if s.skip_menu { ticket.as_deref().unwrap_or("") } else { "" };
    write_arena(&dir, &s, Some(tk))?;      // set on skip+login, else clear (Some("")) so none lingers
    // Logged-in skip-menus → drive the engine's OWN login (hands-off) so the match loads + builds the
    // REAL custom character. Needs the username (for the login POST) + a valid ticket (the password the
    // WININET hook substitutes). Not logged in → inject path (default character).
    let uname = username.as_deref().unwrap_or("").trim().to_string();
    let logged_in = s.skip_menu && !uname.is_empty() && !tk.is_empty();
    write_quickmatch(&dir, s.skip_menu, logged_in);
    if logged_in { write_game_creds(&dir, &uname, tk); } else { clear_game_creds(&dir); }
    // Themed loading card: hand the in-game cover the selected element + identity + party + room.
    if logged_in {
        let el = element.as_deref().unwrap_or("").trim().to_lowercase();
        let nation = match el.as_str() { "fire"=>"Fire","water"=>"Water","earth"=>"Earth","air"=>"Air", _=>"" };
        write_loading(&dir, &el, &uname, nation, party.as_deref().unwrap_or("").trim(), s.room.trim());
    } else { clear_loading(&dir); }
    // Safety net: make sure the live textures match the toggle (normally a no-op —
    // set_textures already applied it when the toggle was flipped).
    apply_textures(&dir, s.hd_textures)?;
    // ALWAYS launch AvatarMP_Windowed.exe — it's the Config-respecting client that
    // honours Width/Height/FullScreen and pairs with BuildingBlocks/zz_uiscale.dll to
    // scale the fixed 800x600 2D UI up to the real resolution. AvatarMP.exe ignores
    // Config.ini (hardcoded 800x600 top-left), so only use it as a last-resort fallback.
    let windowed_exe = dir.join("AvatarMP_Windowed.exe");
    let target = if windowed_exe.is_file() { windowed_exe } else { dir.join("AvatarMP.exe") };
    let child = spawn_game(&dir, &target, logged_in, s.gamescope, &s.gamescope_args, s.width, s.height, want_fullscreen, s.proton)?;
    // Block (on this spawn_blocking thread) until the game exits, so the JS `await invoke('play')`
    // resolves only when the match is actually over — that's what keeps PLAY disabled (no second
    // instance) and re-arms it afterwards. `None` = detached (gamescope) → return right away.
    if let Some(mut c) = child { let _ = c.wait(); }
    Ok(())
    }).await.map_err(|e| e.to_string())?
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
async fn gw_login(host: String, username: String, password: String) -> LoginOut {
    tauri::async_runtime::spawn_blocking(move || {
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
    }).await.unwrap_or_default()
}

// pull a simple "key":"value" string out of a flat JSON body (our fields have no escaping).
fn json_str_field(body: &str, key: &str) -> Option<String> {
    let pat = format!("\"{key}\"");
    let after = &body[body.find(&pat)? + pat.len()..];
    let after = after[after.find(':')? + 1..].trim_start();
    let inner = after.strip_prefix('"')?;
    Some(inner[..inner.find('"')?].to_string())
}

#[derive(Serialize, Default)]
struct TicketOut {
    ok: bool,
    ticket: String,
    error: Option<String>,
}

// Seamless hand-off: trade the (in-memory) login for a short-lived single-use ticket from the
// gateway (POST /launcher/ticket). The launcher writes username + THIS ticket for the game —
// never the password. The game logs in with it; the gateway consumes it once.
#[tauri::command]
async fn gw_ticket(host: String, username: String, password: String) -> TicketOut {
    tauri::async_runtime::spawn_blocking(move || {
    let host = host.trim().trim_end_matches('/');
    if host.is_empty() || username.trim().is_empty() {
        return TicketOut { error: Some("Not logged in.".into()), ..Default::default() };
    }
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(10)).build();
    let form = [("screenName", username.trim()), ("password", password.as_str())];
    for scheme in ["https", "http"] {
        let url = format!("{scheme}://{host}/launcher/ticket");
        match agent.post(&url).send_form(&form) {
            Ok(resp) | Err(ureq::Error::Status(_, resp)) => {
                if let Ok(body) = resp.into_string() {
                    if let Some(t) = json_str_field(&body, "ticket").filter(|s| !s.is_empty()) {
                        return TicketOut { ok: true, ticket: t, error: None };
                    }
                    return TicketOut {
                        error: Some(json_str_field(&body, "error").unwrap_or_else(|| "Ticket denied.".into())),
                        ..Default::default() };
                }
            }
            Err(_) => continue, // transport error → try the other scheme
        }
    }
    TicketOut { error: Some("Couldn't reach the server.".into()), ..Default::default() }
    }).await.unwrap_or_default()
}

// ---- launcher social: proxy the gateway's /session + /friends endpoints --------
// Like gw_login, these go through Rust (not webview fetch) to reuse the https→http
// fallback and dodge CORS. The bearer token (from session_login) is forwarded as
// `Authorization: Bearer`. Each returns the gateway's JSON ({ok, …} or {ok:false,error}).
fn gw_json(host: &str, method: &str, path: &str, token: Option<&str>,
           body: serde_json::Value) -> serde_json::Value {
    let host = host.trim().trim_end_matches('/');
    if host.is_empty() {
        return serde_json::json!({"ok": false, "error": "No server set."});
    }
    let agent = ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(10)).build();
    for scheme in ["https", "http"] {
        let url = format!("{scheme}://{host}{path}");
        let mut req = if method == "GET" { agent.get(&url) } else { agent.post(&url) };
        if let Some(t) = token { req = req.set("Authorization", &format!("Bearer {t}")); }
        let res = if method == "GET" { req.call() } else { req.send_json(body.clone()) };
        match res {
            Ok(resp) | Err(ureq::Error::Status(_, resp)) =>
                return resp.into_json::<serde_json::Value>()
                    .unwrap_or_else(|_| serde_json::json!({"ok": false, "error": "bad response"})),
            Err(_) => continue, // transport error → try the other scheme
        }
    }
    serde_json::json!({"ok": false, "error": "Couldn't reach the server."})
}

#[tauri::command]
async fn session_login(host: String, username: String, password: String) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "POST", "/session/login", None,
                serde_json::json!({"name": username, "password": password}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false, "error": "internal error"}))
}

#[tauri::command]
async fn session_ping(host: String, token: String) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "POST", "/session/ping", Some(&token), serde_json::json!({}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

#[tauri::command]
async fn gw_ticket_session(host: String, token: String) -> serde_json::Value {
    // Mint a fresh short-lived game-login ticket from a LIVE session token — no
    // password. The launcher signs in once (session_login → token, persisted) and
    // re-mints a ticket here per Play, so multiple matches never re-prompt for a
    // password and the password never leaves the launcher after the first sign-in.
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "POST", "/session/ticket", Some(&token), serde_json::json!({}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

#[tauri::command]
async fn session_logout(host: String, token: String) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "POST", "/session/logout", Some(&token), serde_json::json!({}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

#[tauri::command]
async fn friends_list(host: String, token: String) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "GET", "/friends/list", Some(&token), serde_json::json!({}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

// ── account self-service: forgot / change password / sign-out-all / delete ────
#[tauri::command]
async fn account_forgot(host: String, ident: String) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "POST", "/account/forgot", None, serde_json::json!({"name": ident}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}
#[tauri::command]
async fn account_change_password(host: String, name: String, current: String, new: String) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "POST", "/account/change-password", None,
                serde_json::json!({"name": name, "current_password": current, "new_password": new}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}
#[tauri::command]
async fn account_delete(host: String, name: String, password: String) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "POST", "/account/delete", None,
                serde_json::json!({"name": name, "password": password}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}
#[tauri::command]
async fn session_logout_all(host: String, token: String) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "POST", "/session/logout-all", Some(&token), serde_json::json!({}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

// ── desktop notification — fired from JS for friend requests / invites when unfocused ──
#[tauri::command]
fn os_notify(app: tauri::AppHandle, title: String, body: String) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}

#[tauri::command]
async fn friend_request(host: String, token: String, to: String) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "POST", "/friends/request", Some(&token), serde_json::json!({"to": to}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

#[tauri::command]
async fn friend_respond(host: String, token: String, from: String, accept: bool) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "POST", "/friends/respond", Some(&token),
                serde_json::json!({"from": from, "accept": accept}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

#[tauri::command]
async fn friend_remove(host: String, token: String, who: String) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "POST", "/friends/remove", Some(&token), serde_json::json!({"who": who}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

// ── social v2: cancel/block/favorite/nickname/invites/recent ───────────────────
#[tauri::command]
async fn friend_cancel(host: String, token: String, to: String) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "POST", "/friends/cancel", Some(&token), serde_json::json!({"to": to}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

#[tauri::command]
async fn friend_block(host: String, token: String, who: String) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "POST", "/friends/block", Some(&token), serde_json::json!({"who": who}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

#[tauri::command]
async fn friend_unblock(host: String, token: String, who: String) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "POST", "/friends/unblock", Some(&token), serde_json::json!({"who": who}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

#[tauri::command]
async fn friend_favorite(host: String, token: String, who: String, on: bool) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "POST", "/friends/favorite", Some(&token), serde_json::json!({"who": who, "on": on}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

#[tauri::command]
async fn friend_nickname(host: String, token: String, who: String, nickname: String) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "POST", "/friends/nickname", Some(&token),
                serde_json::json!({"who": who, "nickname": nickname}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

#[tauri::command]
async fn invite_send(host: String, token: String, to: String, room: String, size: u32) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "POST", "/invites/send", Some(&token),
                serde_json::json!({"to": to, "room_code": room, "size": size}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

#[tauri::command]
async fn invite_respond(host: String, token: String, from: String, accept: bool) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "POST", "/invites/respond", Some(&token),
                serde_json::json!({"from": from, "accept": accept}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

#[tauri::command]
async fn friends_recent(host: String, token: String) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "GET", "/friends/recent", Some(&token), serde_json::json!({}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

// percent-encode a query-string value (screen names / match uids can hold non-alnum)
fn qenc(s: &str) -> String {
    s.bytes().map(|b| match b {
        b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
        _ => format!("%{:02X}", b),
    }).collect()
}

// ── stats: leaderboard / career / match history + replay (public GET reads) ────
#[tauri::command]
async fn leaderboard(host: String) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "GET", "/leaderboard", None, serde_json::json!({}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

#[tauri::command]
async fn career(host: String, name: String) -> serde_json::Value {
    let path = format!("/career?name={}", qenc(&name));
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "GET", &path, None, serde_json::json!({}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

#[tauri::command]
async fn matches_recent(host: String, name: String) -> serde_json::Value {
    let path = format!("/matches/recent?name={}", qenc(&name));
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "GET", &path, None, serde_json::json!({}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

#[tauri::command]
async fn match_replay(host: String, uid: String) -> serde_json::Value {
    let path = format!("/match/{}/replay", qenc(&uid));
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "GET", &path, None, serde_json::json!({}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

// ── parties: group up + queue together ────────────────────────────────────────
fn party_post(host: String, token: String, path: &'static str, body: serde_json::Value)
    -> tauri::async_runtime::JoinHandle<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(move || gw_json(&host, "POST", path, Some(&token), body))
}
#[tauri::command]
async fn party_get(host: String, token: String) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move ||
        gw_json(&host, "GET", "/party/get", Some(&token), serde_json::json!({}))
    ).await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}
#[tauri::command]
async fn party_create(host: String, token: String, size: u32) -> serde_json::Value {
    party_post(host, token, "/party/create", serde_json::json!({"size": size}))
        .await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}
#[tauri::command]
async fn party_invite(host: String, token: String, to: String) -> serde_json::Value {
    party_post(host, token, "/party/invite", serde_json::json!({"to": to}))
        .await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}
#[tauri::command]
async fn party_join(host: String, token: String, party: String) -> serde_json::Value {
    party_post(host, token, "/party/join", serde_json::json!({"party_id": party}))
        .await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}
#[tauri::command]
async fn party_leave(host: String, token: String) -> serde_json::Value {
    party_post(host, token, "/party/leave", serde_json::json!({}))
        .await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}
#[tauri::command]
async fn party_ready(host: String, token: String, ready: bool) -> serde_json::Value {
    party_post(host, token, "/party/ready", serde_json::json!({"ready": ready}))
        .await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}
#[tauri::command]
async fn party_kick(host: String, token: String, who: String) -> serde_json::Value {
    party_post(host, token, "/party/kick", serde_json::json!({"who": who}))
        .await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}
#[tauri::command]
async fn party_start(host: String, token: String) -> serde_json::Value {
    party_post(host, token, "/party/start", serde_json::json!({}))
        .await.unwrap_or_else(|_| serde_json::json!({"ok": false}))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebKitGTK on Linux renders a grey/blank window when its DMABUF renderer can't
    // negotiate a buffer with the system GPU stack (common on AMD/Mesa + Wayland).
    // Disabling that one renderer fixes it while staying on the NATIVE backend.
    // Do NOT force GDK_BACKEND=x11 — on a modern Wayland/AMD stack XWayland is what
    // produces the grey box (verified on RX 9070 / WebKitGTK 2.52). No-op on X11;
    // harmless on Windows/macOS. Respects an explicit user override.
    #[cfg(target_os = "linux")]
    for (k, v) in [
        ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
    ] {
        if std::env::var_os(k).is_none() { std::env::set_var(k, v); }
    }
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
        .invoke_handler(tauri::generate_handler![load, save, locate, play, status, sync, prepare_clone, check_updates, check_self_update, self_update, restart, open_url, set_textures, menu_init, gw_login, gw_ticket, gw_ticket_session, session_login, session_ping, session_logout, friends_list, friend_request, friend_respond, friend_remove, friend_cancel, friend_block, friend_unblock, friend_favorite, friend_nickname, invite_send, invite_respond, friends_recent, leaderboard, career, matches_recent, match_replay, party_get, party_create, party_invite, party_join, party_leave, party_ready, party_kick, party_start, account_forgot, account_change_password, account_delete, session_logout_all, os_notify, save_loading_image])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
