# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Firefox and Chrome Manifest V3 extension that displays Anthropic's real-time service status as a widget on claude.ai. Pure vanilla JavaScript and CSS with a Node.js-based build toolchain.

## Repository Structure

```
src/                              ← shared source — edit here
scripts/build.js                  ← build script (sync + manifest gen + zip)
tests/                            ← unit tests (vitest)
claude-status-extension-firefox-v3/ ← Firefox v2 (build target)
claude-status-extension-chrome-v3/  ← Chrome v2 (build target)
dist/                             ← packaged releases (.zip)
sync.ps1                          ← legacy sync (PowerShell, still works)
```

**Workflow:** Edit files in `src/`, then run `node scripts/build.js` (or `npm run build`) to sync to both extension directories and generate manifests. Alternative: `.\sync.ps1` (PowerShell, legacy).

## Development Workflow

### Loading the Extension (Firefox v2)
1. Navigate to `about:debugging` → "This Firefox" → "Load Temporary Add-on…"
2. Select `claude-status-extension-firefox-v3/manifest.json`

### Loading the Extension (Chrome v2)
1. Navigate to `chrome://extensions` → Enable "Developer mode" → "Load unpacked"
2. Select the `claude-status-extension-chrome-v3/` folder

### Build & Package
```bash
npm install          # first time only
npm run build        # sync src/ + generate manifests
npm run build -- --zip  # also create dist/ ZIPs
npm run build -- --firefox  # Firefox only
npm run build -- --chrome   # Chrome only
```

### Linting & Testing
```bash
npm run lint         # ESLint on src/
npm run lint:fix     # auto-fix
npm test             # vitest (tests/shared.test.js)
npm run test:watch   # watch mode
```

### Manual Testing
Key scenarios:
- Widget appears bottom-right on claude.ai
- Status dot color reflects worst component status (green/orange/red/gray)
- Expand/collapse persists across page reloads
- Language toggle (DE/EN) persists in `browser.storage.local`
- Auto-refresh every 60 seconds via Chrome Alarms API

## Architecture

### Two-Script Model
```
status.anthropic.com/api/v2/components.json
    ↓ (fetch every 60s via chrome.alarms)
background.js  ←→  content.js
(caches lastData)   (renders widget on claude.ai)
```

**`background.js`** — Service worker. Polls the API, caches last response in `lastData`, broadcasts to all claude.ai tabs via `chrome.tabs.sendMessage()`. Also handles on-demand requests from content scripts.

**`content.js`** — Injected into claude.ai. Renders the widget DOM, handles expand/collapse and language switching. Key data structures:
- `STATUS_COLOR` — maps API status strings → CSS color classes
- `STATUS_PRIORITY` — ranks statuses (0=operational … 4=major_outage) for computing overall widget color
- `LABELS` — bilingual strings (`de`/`en`)

**`content.css`** — Fixed-position widget (bottom-right, z-index max). Dark theme with CSS variables (`--green`, `--orange`, `--red`, `--gray`). Expand/collapse via `max-height` animation.

### Status API
```
GET https://status.anthropic.com/api/v2/components.json
```
Response: `{ components: [{ name, status, group }] }` — `status` values: `operational`, `degraded_performance`, `partial_outage`, `major_outage`, `under_maintenance`.

### DOM Safety
Always use `textContent` / `createElement` / `appendChild`. Never use `innerHTML` — this was explicitly fixed for Mozilla AMO compliance.

## Key Constraints

- **Firefox + Chrome** — uses `chrome.*` APIs (Firefox aliases them from `browser.*`); Firefox strict_min_version 140 desktop / 142 Android
- **No tracking** — the only outbound requests are to status.anthropic.com
- **AMO compliance** — Mozilla Add-ons review requires safe DOM methods and explicit `browser_specific_settings` in manifest
