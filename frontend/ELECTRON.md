# Electron Wrapper Setup

This frontend now includes an Electron wrapper to produce installable desktop builds.

## Install dependencies

Run once in `/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend`:

```bash
yarn add -D electron electron-builder concurrently wait-on
```

## Run in desktop dev mode

```bash
yarn electron:dev
```

This starts Vite on `http://localhost:5173` and opens Electron on top of it.

## Build targets

Build all configured targets:

```bash
yarn electron:build
```

Build per platform:

```bash
yarn electron:build:win
yarn electron:build:mac
yarn electron:build:linux
yarn electron:build:deb
```

Generated outputs go under:

- `/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/release/`

Typical artifacts:

- Windows: `Keppler Healthcare-Setup-<version>.exe`
- macOS: `Keppler Healthcare-<version>-mac-<arch>.dmg`
- Linux: `Keppler Healthcare-<version>-linux-<arch>.AppImage`
- Debian: `keppler-healthcare_<version>_<arch>.deb` (name may vary by builder normalization)

## Notes

- `.exe`, `.dmg`, `.AppImage`, and `.deb` builds need network access to download Electron platform binaries.
- Building each platform on its native OS (or OS-specific CI runner) is most reliable.
- Your React app still calls backend APIs using `VITE_API_BASE` / `VITE_SYMPTOM_API_BASE`.
