# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Firefox and Chrome Manifest V3 extension that displays Anthropic's real-time service status as a widget on claude.ai plus a toolbar popup (uptime chart, incidents, settings). Pure vanilla JavaScript and CSS with a Node.js-based build toolchain.

## Repository Structure

```
src/                              ← shared source — edit here
  shared.js                       ← pure constants/helpers (config, status logic,
                                    payload contract, UI_LABELS, csmEl/csmIcon)
  background.js                   ← service worker / event page (polling, state)
  content.js + content.css        ← widget on claude.ai
  popup.js/.html/.css             ← toolbar popup
  icons/                          ← PNG + SVG icons
scripts/build.js                  ← build script (sync + manifest gen + zip)
tests/shared.test.js              ← unit tests (vitest) for shared.js
claude-status-extension-firefox-v3/ ← Firefox (build target, generated)
claude-status-extension-chrome-v3/  ← Chrome (build target, generated)
dist/                             ← build output (.zip, gitignored)
sync-hook.ps1                     ← optional local hook: rebuild on src/ edits
```

**Workflow:** Edit files in `src/`, then run `node scripts/build.js` (or `npm run build`) to sync to both extension directories and generate manifests. Never edit the build-target directories directly.

## Development Workflow

### Loading the Extension (Firefox)
1. Navigate to `about:debugging` → "This Firefox" → "Load Temporary Add-on…"
2. Select `claude-status-extension-firefox-v3/manifest.json`

### Loading the Extension (Chrome)
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

The manifest version is stamped from `package.json` (`4.0.0` → `"4.0"`).

**Releases:** pushing a `v*` tag triggers `.github/workflows/release.yml`, which
lints/tests, builds both ZIPs and publishes them as a GitHub Release. `dist/`
is gitignored — ZIP artifacts live on the Releases page, not in git.

#### AMO upload gotcha (Windows) — DO NOT use PowerShell Compress-Archive
On Windows, `Compress-Archive` writes ZIP entries using backslash path
separators (e.g. `icons\icon-128.png`). AMO rejects these uploads every time
with:

```
Invalid file name in archive: icons\icon-128.png
```

The ZIP spec requires forward slashes. `scripts/build.js` and `scripts/make-zip.py`
handle this by using Python's `zipfile` module on Windows instead (it writes
forward slashes). **Never** zip the extension folder manually via Explorer's
"Send to → Compressed (zipped) folder" or `Compress-Archive` — always use
`npm run build -- --zip` (or run `python scripts/make-zip.py <src-dir> <zip>`
directly). This has bitten us on every AMO release, which is why the build
script is hard-wired to Python on Windows.

### Linting & Testing
```bash
npm run lint         # ESLint on src/
npm run lint:fix     # auto-fix
npm test             # vitest (tests/shared.test.js)
npm run test:watch   # watch mode
```

#### ESLint — Browser Globals
The ESLint config (`eslint.config.js`) uses a manual `BROWSER_GLOBALS` allowlist instead of the built-in `browser` environment. **Whenever new browser APIs are used in `src/` (e.g. `IntersectionObserver`, `crypto`), they must be added to `BROWSER_GLOBALS` — otherwise CI fails with `no-undef` errors.** Current list: `window`, `document`, `console`, `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `fetch`, `AbortController`, `MutationObserver`, `URL`, `self`, `navigator`, `history`, `getComputedStyle`, `chrome`, `browser`, `importScripts`.

The same applies to `SHARED_JS_GLOBALS`: every constant/function that `shared.js` exposes and other files consume must be listed there.

#### Tests
`shared.js` is a plain script (no modules — it is loaded via manifest script
lists / `importScripts`). The test harness reads the file and evaluates it in
a sandbox; **when you add a new top-level export to shared.js, add it to the
return list in `loadShared()`** in `tests/shared.test.js`. The suite enforces
recursive DE/EN key parity over `UI_LABELS` — adding a string to one language
without the other fails CI.

## Architecture

### Polling & state (background.js)
```
status.anthropic.com/api/v2/summary.json    ← polled every 60s (chrome.alarms)
status.anthropic.com/api/v2/incidents.json  ← fetched on demand for the popup
                                              (2-min TTL), NOT on every poll
```

**MV3 lifecycle rule:** Chrome kills the service worker after ~30s idle and
Firefox suspends the event page, so **no mutable state may live in module
scope**. All state (`{ lastStatus, consecutiveErrors, payload, incidents,
incidentsFetchedAt }`) lives in `chrome.storage.session` (fallback
`storage.local`) and is hydrated lazily: every entry point (`onAlarm`,
message handlers, `onInstalled`, `onStartup`) starts with `await getState()`.
`storage.local[csm-cache]` additionally persists the last payload across
browser restarts (10-min TTL warm start). Notification baselines compare
status strings via `isWorseStatus`/`isRecoveryStatus` from shared.js — never
colors.

Fetches are **single-flight** (`fetchSummaryOnce`/`fetchIncidentsOnce`): the
alarm tick, the `GET_STATUS` cold path and `FORCE_FETCH` share one in-flight
request. Errors increase `consecutiveErrors` → exponential alarm backoff
(capped at `MAX_BACKOFF_MINUTES`).

### Payload contract
`buildStatusPayload()` in shared.js defines the one shape that travels
everywhere:
```js
{ components, incidents, scheduled_maintenances, indicator, fetchedAt }
```
- `indicator` is Statuspage's own overall verdict (`status.indicator`);
  `getOverallStatus(components, indicator)` folds it with the worst component.
- `fetchedAt` lets widget and popup render honest timestamps via
  `formatLastChecked()` (stale flag after 5 min). Never print `new Date()`
  as "last checked".

### Message types
- `GET_STATUS` → `{ type: 'STATUS_DATA', payload }` or `{ type: 'STATUS_ERROR', code }`
- `GET_SUMMARY` → `{ summary: payload, incidents: [...], incidentsFetchedAt }` or `{ error: true, code }`
- `FORCE_FETCH` → `{ ok: boolean }`
- Broadcasts to claude.ai tabs reuse `STATUS_DATA` / `STATUS_ERROR`.

### content.js (widget)
- **Theme**: 3-state setting `auto|dark|light` (default `auto`). `auto`
  follows claude.ai itself: `documentElement` class/data attributes →
  background-luminance fallback → OS preference; kept live by a
  MutationObserver on `documentElement`. Don't assume specific claude.ai DOM.
- **SPA navigation**: `popstate` + Navigation API (Chrome) + visibility-gated
  2s location poll (Firefox fallback). Do NOT monkey-patch
  `history.pushState` — content scripts run in an isolated world and can
  never observe page-initiated calls.
- **Teardown rule**: every listener/observer/interval must be cleaned up when
  the widget node disappears (see the cleanup MutationObserver): the
  `AbortController` signal for DOM listeners, `removeListener` for
  `chrome.storage.onChanged`, `clearInterval` for nav/timestamp timers,
  `disconnect()` for observers.
- Language defaults to `navigator.language` (de → DE, else EN); stored choice
  wins. ALL strings incl. aria-labels come from `UI_LABELS` and are re-applied
  in `updateLangUI()`.

### Design tokens (content.css / popup.css)
Warm claude.ai-native palette — keep new UI on these variables:
dark `--csm-bg: rgba(38,38,36,.96)` (#262624), light `#faf9f5` warm paper,
text `#faf9f5`/`#b8b5a9` (dark) and `#1f1e1c`/`#6e6c64` (light), accent
coral `#d97757` (dark) / `#a84b2f` (light, AA), hairline borders
`rgba(255,255,255,.08)`, radius 12–14px, `font-family: inherit` on the widget
(inherits claude.ai's own stack). No blue links, no emoji icons.

### Status API
```
GET https://status.anthropic.com/api/v2/summary.json
GET https://status.anthropic.com/api/v2/incidents.json   (popup only)
```
`summary.json`: `{ status: { indicator }, components: [{ name, status, group }], incidents, scheduled_maintenances }` — `status` values: `operational`, `degraded_performance`, `partial_outage`, `major_outage`, `under_maintenance`; `indicator` values: `none`, `minor`, `major`, `critical`, `maintenance`.

### DOM Safety
Always use `textContent` / `createElement` / `appendChild` — via the shared
`csmEl(tag, classOrId, text)` helper. Icons are inline SVG built with
`createElementNS` through `csmIcon(name, size)` (AMO-safe, CSP-immune,
`currentColor` theming). Never use `innerHTML` — ESLint enforces this for
Mozilla AMO compliance.

## Manual Testing
Key scenarios:
- Widget appears bottom-right on claude.ai; pill expands; state persists
- Status dot reflects worst of components + indicator (green/yellow/orange/red/gray)
- Theme `auto` follows claude.ai's theme switch live; explicit dark/light wins
- DE/EN toggle persists and syncs widget ↔ popup (incl. aria-labels)
- Timestamp shows data age; goes amber (`.csm-stale`) after 5 min (e.g. offline)
- Active incident shows a banner in the expanded widget
- Notifications: with the SW inactive (chrome://extensions), a status flip
  must produce exactly one notification (state lives in storage.session)
- Network tab: only `summary.json` per poll; `incidents.json` only on popup open
- Widget visibility toggle in popup settings hides/shows live

## Key Constraints

- **Firefox + Chrome** — uses `chrome.*` APIs (Firefox aliases them); Firefox strict_min_version 140 desktop / 142 Android
- **No tracking** — the only outbound requests are to status.anthropic.com
- **AMO compliance** — safe DOM methods only, explicit `browser_specific_settings`, forward-slash ZIPs
- **MV3 lifecycle** — no in-memory state in background.js; storage.session + lazy hydration
