# Legends Awakened — Launcher

A small, modern launcher for the Avatar: Legends of the Arena client. Built with
**Tauri 2** (Rust core + a vanilla web UI), so each shipped app is only a few MB.

**Runs on Windows, macOS and Linux** — one codebase, one shared version, a native
app per OS. The game itself is a Windows binary (`AvatarMP.exe`), so on macOS and
Linux the launcher starts it through **wine** (it sets `WINEPREFIX` to the prefix
your game folder lives inside). On Windows it launches the `.exe` directly.

It reads/writes the two config files the game already uses and then launches the
client:

| Setting | File | Key |
|---|---|---|
| Server address | `BuildingBlocks/arena_link.ini` | `[server] host` |
| Room code (preset) | `BuildingBlocks/arena_link.ini` | `[room] code` |
| Queue size (2/3/4) | `BuildingBlocks/arena_link.ini` | `[room] queue` |
| Fullscreen | `Config.ini` | `FullScreen` |
| Resolution | `Config.ini` | `Width` / `Height` |

Config.ini edits are **line-preserving** (every other key, the comments, and the
trailing newline the engine requires are kept). The launcher finds the game by
sitting next to `AvatarMP.exe` (production), or via a remembered folder you pick,
or `AVATAR_GAME_DIR` for development on a non-Windows box.

> Note: **room code** and **queue size** are written to `arena_link.ini` but the
> server doesn't group by them *yet* — that's the planned matchmaking follow-up
> (room-code grouping + per-room size). Server host, fullscreen and resolution are
> fully live today.

### Resolution & the 800×600 UI
The engine's 2D UI is authored for a **fixed 800×600** canvas — the 3D camera fills
any render size, but the UI alone would pin to the top-left at higher resolutions.
Two pieces fix that, and the launcher depends on them:

- **`AvatarMP_Windowed.exe`** — the *Config-respecting* client. The launcher always
  launches this (falling back to `AvatarMP.exe` only if it's missing). `AvatarMP.exe`
  ignores `Config.ini` and renders a hardcoded 800×600 window, so it's a last resort.
- **`BuildingBlocks/zz_uiscale.dll`** — injected Virtools plugin that scales the
  800×600 UI (sprites, panels, buttons **and dynamic fonts**) up to the real
  `Config.ini` resolution. Source: `AvatarServer/phase2/tools/uiscale`.

4:3 resolutions (1440×1080, 1600×1200 …) fill the screen edge-to-edge; 16:9/ultrawide
fill the 3D and keep the scaled UI centered (pillarboxed). Without `zz_uiscale.dll`
present, raising the resolution enlarges only the 3D view.

## Develop
```sh
cd launcher
npm install
# point it at a game folder for testing on Linux/macOS:
AVATAR_GAME_DIR="$HOME/.wine/drive_c/Program Files (x86)/NickOnline/Avatar - Legends of the Arena" \
  npm run tauri dev
```
Frontend is plain `src/index.html` + `styles.css` + `main.js` (no bundler;
`withGlobalTauri` exposes `window.__TAURI__`). Rust commands are in
`src-tauri/src/lib.rs` (`load`, `save`, `locate`, `play`, `status`).

### Linux: gamescope wrap (Wayland / hybrid GPUs)
The game is a 2008 wine title. Under a Wayland compositor (Hyprland, etc.) it can
show desktop through the window, jump to the wrong monitor, or — on hybrid
AMD+NVIDIA laptops — render on the dead GPU. The fix is to launch the game inside
**gamescope** (a micro-compositor that isolates it, routes it to a chosen GPU, and
gives clean fullscreen). The launcher GUI itself runs normally; only the game
subprocess is wrapped.

This is **opt-in** (the GPU device is per-machine, so auto-enabling could black-screen
a hybrid laptop). Set these in the environment the launcher runs in:

| Env var | Effect |
|---|---|
| `AVATAR_GAMESCOPE=1` | wrap the game in gamescope (`auto` = on when gamescope is on PATH) |
| `AVATAR_GAMESCOPE_ARGS` | gamescope args for this box, e.g. `--prefer-vk-device 1002:1638 -W 1920 -H 1080 -w 800 -h 600` |
| `AVATAR_VK_ICD` | sets `VK_ICD_FILENAMES` (pin the Vulkan driver, e.g. `/usr/share/vulkan/icd.d/radeon_icd.json`) |

The launcher always appends `-f -- wine <exe>`. Note: the launcher launches the
**Config-respecting** `AvatarMP_Windowed.exe`, so the game is *not* capped at 800×600
— `-w 800 -h 600` is only needed if you force the raw `AvatarMP.exe`; otherwise let
it render at your Config resolution (sharper than upscaling 800×600).

## Build

Tauri builds **on** the OS it targets (you can't make a `.dmg` from Linux), so
the three apps are produced on three runners — but from one source tree and one
version number.

| OS | Command | Output (`src-tauri/target/release/…`) |
|---|---|---|
| Windows | `npm run tauri build` | `bundle/nsis/*-setup.exe`, `bundle/msi/*.msi` |
| macOS | `npm run tauri build` | `bundle/dmg/*.dmg`, `bundle/macos/*.app` |
| Linux | `npm run tauri build` | `bundle/appimage/*.AppImage`, `bundle/deb/*.deb` |

On Windows, drop the launcher next to `AvatarMP.exe` and it auto-finds the game.
On macOS/Linux the launcher lives outside the wine prefix, so use the **locate**
link in the UI (or set `AVATAR_GAME_DIR`) to point it at the game folder once; it
remembers your choice.

> AppImage bundling needs `patchelf` + `appimagetool` on the build host. To skip
> bundling and just produce the runnable binary (`target/release/launcher`), add
> `-- --no-bundle`.

### Versioning
There's **one** version, in `src-tauri/tauri.conf.json` (`"version"`), mirrored in
`package.json`. Bump it, then tag `launcher-vX.Y.Z` (the `X.Y.Z` should match) —
that's the whole release process.

### CI — all three at once
The **launcher (Windows · macOS · Linux)** GitHub Action builds a matrix of
`windows-latest` / `macos-latest` (universal Intel+Apple-silicon `.dmg`) /
`ubuntu-22.04`. Push a `launcher-vX.Y.Z` tag and it produces a **single draft
GitHub Release** with the installer for each OS attached; or run it manually
(workflow_dispatch) to build without releasing.
