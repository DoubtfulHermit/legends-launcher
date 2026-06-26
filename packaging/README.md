# Launcher packaging (Linux)

There is **no single "Linux binary."** Desktop Linux splits by package manager, and the
launcher is a Tauri/WebKitGTK app — WebKitGTK is welded to the system GPU/driver stack,
so the *only* reliable approach is to link the **system's** WebKit (a native package),
never bundle our own (that's what made the old AppImage grey-screen on rolling distros).

| Audience | Artifact | How they install | Updates |
|----------|----------|------------------|---------|
| Windows | `*_x64-setup.exe` (NSIS) | run the installer | in-app auto-update |
| Debian / Ubuntu / Mint / Pop | `*_amd64.deb` | `sudo apt install ./*.deb` | redownload (or apt repo, later) |
| Arch / CachyOS / Manjaro | AUR `legends-awakened-launcher-bin` | `yay -S legends-awakened-launcher-bin` | `yay -Syu` |

The `.deb` and the NSIS installer are built + published automatically by
`.github/workflows/release-launcher.yml` on every `launcher-v*` tag. The AUR package
repackages that same `.deb`, so Arch users get the identical, system-WebKit-linked binary.

## Why not AppImage / Flatpak?
- **AppImage** bundles its own WebKit/EGL/GL. Frozen at build time → can't talk to a fresh
  GPU driver → `EGL_BAD_PARAMETER` / grey window on Arch & other rolling distros. Dropped.
- **Flatpak** would work (sandboxed runtime + GPU portals) but is heavier to set up and
  publish. Add later only if there's demand for distros outside deb/rpm/Arch.

## AUR: one-time publish, then per-release bump
The `aur/` dir is the package source. To publish (needs an AUR account + your SSH key
registered at https://aur.archlinux.org/account):

```sh
# one time: clone the (empty) AUR repo
git clone ssh://aur@aur.archlinux.org/legends-awakened-launcher-bin.git aur-pkg
cp packaging/aur/PKGBUILD packaging/aur/.SRCINFO aur-pkg/
cd aur-pkg && git add PKGBUILD .SRCINFO && git commit -m "Initial import 0.1.19" && git push
```

For each new launcher release: bump `pkgver` in `aur/PKGBUILD`, regenerate `.SRCINFO`
(`makepkg --printsrcinfo > .SRCINFO`), and push to the AUR repo. (Keep the in-repo copies
under `aur/` in sync so this stays the source of truth.)

## Verifying the .deb locally on Arch
You can't `apt install` on Arch, but you can sanity-check the package or build the AUR pkg:

```sh
cd packaging/aur && makepkg -si   # downloads the release .deb, installs as a pacman pkg
```
