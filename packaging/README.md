# Launcher packaging (Linux)

There is **no single "Linux binary."** Desktop Linux splits by package manager, and the
launcher is a Tauri/WebKitGTK app — WebKitGTK is welded to the system GPU/driver stack,
so the *only* reliable approach is to link the **system's** WebKit (a native package),
never bundle our own (that's what made the old AppImage grey-screen on rolling distros).

| Audience | Artifact | How they install | Updates |
|----------|----------|------------------|---------|
| Windows | `*_x64-setup.exe` (NSIS) | run the installer | in-app auto-update |
| Debian / Ubuntu / Mint / Pop | `*_amd64.deb` | `sudo apt install ./*.deb` | redownload (or apt repo, later) |
| Arch / CachyOS / Manjaro | `*.pkg.tar.zst` (release asset) | `sudo pacman -U <url>` | redownload |
| Arch (once AUR is up) | AUR `legends-awakened-launcher-bin` | `yay -S legends-awakened-launcher-bin` | `yay -Syu` |

The `.exe`, `.deb` and updater manifest are built + published automatically by
`.github/workflows/release-launcher.yml` on every `v*` tag. The Arch `*.pkg.tar.zst` is
built from that same release `.deb` (`packaging/aur/`, `makepkg`) and uploaded to the
release — so Arch users get the identical, system-WebKit-linked binary as a native pacman
package **even when AUR registration is closed**. When AUR is reachable, publishing the
same `aur/` package adds the `yay` convenience path on top.

## Why not AppImage / Flatpak?
- **AppImage** bundles its own WebKit/EGL/GL. Frozen at build time → can't talk to a fresh
  GPU driver → `EGL_BAD_PARAMETER` / grey window on Arch & other rolling distros. Dropped.
- **Flatpak** would work (sandboxed runtime + GPU portals) but is heavier to set up and
  publish. Add later only if there's demand for distros outside deb/rpm/Arch.

## Per release: build + upload the Arch pacman package (current flow)
`aur/` is the package source. After a `v*` release publishes, build the native package
from the release `.deb` and attach it (works on any Arch box; no AUR account needed):

```sh
cd packaging/aur
# bump pkgver to match the release, then regenerate .SRCINFO from the PKGBUILD:
makepkg --printsrcinfo > .SRCINFO
makepkg -f                                   # downloads the release .deb, builds the pkg
gh release upload v<ver> *.pkg.tar.zst --repo DoubtfulHermit/legends-launcher --clobber
```

Arch users then: `sudo pacman -U <pkg-url-from-the-release>`.

## AUR (the `yay` convenience path — when registration is open)
AUR periodically disables new-account registration. When it's open, publish the same
package (needs an AUR account + your SSH key at https://aur.archlinux.org/account):

```sh
git clone ssh://aur@aur.archlinux.org/legends-awakened-launcher-bin.git aur-pkg
cp PKGBUILD .SRCINFO aur-pkg/
cd aur-pkg && git add PKGBUILD .SRCINFO && git commit -m "Update to <ver>" && git push
```

Per release thereafter: bump `pkgver`, regenerate `.SRCINFO`, push. Keep the in-repo `aur/`
copies in sync — they're the source of truth for both paths.
