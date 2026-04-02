# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Firefox Manifest V3 extension that displays Anthropic's real-time service status as a widget on claude.ai. No build system, no framework dependencies — pure vanilla JavaScript and CSS.

## Development Workflow

### Loading the Extension (Firefox)
1. Navigate to `about:debugging` → "This Firefox" → "Load Temporary Add-on…"
2. Select `claude-status-extension/manifest.json`

### Packaging for Distribution
```powershell
Compress-Archive -Path "claude-status-extension/*" -DestinationPath "claude-status-monitor-1.0.zip" -Force
```

### Testing
Manual only — no test framework. Key scenarios:
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

- **Firefox only** — uses `browser.*` APIs with `chrome.*` aliases; strict_min_version 140 desktop / 142 Android
- **No tracking** — the only outbound request is the GET to status.anthropic.com
- **AMO compliance** — Mozilla Add-ons review requires safe DOM methods and explicit `browser_specific_settings` in manifest
