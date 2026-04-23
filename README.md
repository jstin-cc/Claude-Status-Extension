# Claude Status Monitor

A Firefox and Chrome extension that displays the real-time operational status of Anthropic's Claude services — as an inline widget on [claude.ai](https://claude.ai) and as a detailed popup accessible from the browser toolbar.

![Firefox](https://img.shields.io/badge/Firefox-140%2B-orange?logo=firefox)
![Chrome](https://img.shields.io/badge/Chrome-MV3-blue?logo=googlechrome)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![Version](https://img.shields.io/badge/Version-3.2-brightgreen)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Features

### Widget (claude.ai)
- **Live status widget** — appears in the bottom-right corner of claude.ai; repositions automatically to the top-right on Design pages (`claude.ai/design/…`) so it doesn't overlap the canvas
- **Color-coded indicator** — green (operational), yellow (degraded), orange (partial outage), red (major outage), gray (maintenance)
- **Expandable component list** — shows the status of each individual Anthropic service
- **Auto-refresh** — polls the official Anthropic status API at a configurable interval

### Toolbar Popup
- **Detailed status overview** — click the extension icon in the toolbar
- **All service components** with live status
- **7-day uptime chart** — color-coded bars showing incident history per day
- **Active incidents** — with impact level, status, and latest update
- **Scheduled maintenance** — upcoming and in-progress windows
- **Incident history** — resolved incidents from the last 7 days with duration

### Settings
- **Dark / Light theme** — toggle with 🌙/☀️ button in header or settings
- **Notifications** — browser notifications on incident start and recovery
- **Bilingual** — German 🇩🇪 and English 🇺🇸, switchable in widget and popup
- **Configurable poll interval** — 30s, 1 min, 2 min, or 5 min
- **Persistent settings** — all preferences saved locally via `browser.storage.local`

---

## What's New in v3.2

- **Design-area repositioning** — on `claude.ai/design/…` the widget moves from the bottom-right corner to the top-right toolbar area (`top: 5px; right: 170px`) so it no longer overlaps the canvas or navigation elements. The widget returns to its normal position when navigating back to any other page (SPA-navigation aware via `pushState` / `popstate`).

---

## What's New in v3.1

- **Live theme & language sync between popup and widget** — changing the theme or language in the toolbar popup (or settings view) now immediately updates the widget on open claude.ai tabs. Previously, updates only flowed from the widget to the popup.

---

## What's New in v3.0

### Reliability
- **Error code system** — 7 classified error codes (TIMEOUT, NETWORK, OFFLINE, HTTP_4XX, HTTP_5XX, PARSE, UNKNOWN) with bilingual labels for clear diagnostics
- **Exponential backoff** — auto-doubles poll interval on errors (max 10 min), resets on success
- **Cache persistence** — last API data survives service worker restarts (up to 10 min)
- **Fetch lock & timeout** — prevents parallel requests, 8s AbortController timeout
- **Offline handling** — detects network state, shows last known data when offline

### UI/UX
- **WCAG AA contrast** — improved light mode text colors
- **Yellow for degraded** — degraded performance now distinct from partial outage
- **System theme detection** — follows OS dark/light preference by default
- **Refresh button** — manual status refresh in popup (↻)
- **Skeleton loading** — shimmer animation while loading
- **Responsive widget** — adapts to small viewports
- **Escape key** — closes dropdown menus

### Developer Experience
- **Node.js build script** — cross-platform replacement for sync.ps1 with manifest generation
- **ESLint** — flat config with AMO compliance rules
- **Vitest** — 27 unit tests for shared.js logic
- **GitHub Actions CI/CD** — lint + test + build on push/PR

---

## How It Works

```
status.anthropic.com/api/v2/
  ├── summary.json     ← polled periodically → widget + popup
  └── incidents.json   ← polled periodically → popup history & uptime chart

background.js  ←→  content.js   (widget on claude.ai)
               ←→  popup.js     (toolbar popup)
```

The background service worker fetches and caches status data, broadcasts updates to open claude.ai tabs, and fires browser notifications when status changes. Cached data persists in `chrome.storage.local` across service worker restarts. Errors are classified with specific codes for easy debugging.

---

## Installation

### Firefox — From AMO
Install from [addons.mozilla.org](https://addons.mozilla.org) or sideload the `.xpi` from the [Releases](../../releases) page.

### Firefox — Manual (Developer)
1. Clone or download this repository
2. Open Firefox → `about:debugging` → **"This Firefox"** → **"Load Temporary Add-on…"**
3. Select `claude-status-extension-firefox-v3/manifest.json`
4. Open [claude.ai](https://claude.ai) — the widget appears in the bottom-right corner (top-right on Design pages)

### Chrome — Manual (Developer)
1. Open Chrome → `chrome://extensions` → enable **Developer mode**
2. Click **"Load unpacked"** → select the `claude-status-extension-chrome-v3/` folder

---

## Usage

### Widget (bottom-right on claude.ai)

| Action | Result |
|--------|--------|
| Widget visible | Shows status dot + "Claude Status" label |
| Click widget | Expands to show all service components |
| Click again | Collapses back to pill |
| Click flag 🇩🇪/🇺🇸 when expanded | Opens language selector |

### Toolbar Popup

| Action | Result |
|--------|--------|
| Click extension icon | Opens detailed status popup |
| Click 🌙/☀️ | Toggle dark/light theme |
| Click flag 🇩🇪/🇺🇸 | Switch language |
| Click ⚙️ | Open settings |
| Hover uptime bar | Shows date and status for that day |

### Status Colors

| Color | Meaning |
|-------|---------|
| 🟢 Green | All systems operational |
| 🟡 Yellow | Degraded performance |
| 🟠 Orange | Partial outage |
| 🔴 Red | Major outage |
| ⚫ Gray | Maintenance / unavailable |

---

## Repository Structure

```
src/                                  ← shared source — edit here
scripts/build.js                      ← build script (sync + manifest gen + zip)
tests/                                ← unit tests (vitest)
claude-status-extension-firefox-v3/   ← Firefox build target
claude-status-extension-chrome-v3/    ← Chrome build target
dist/                                 ← packaged releases (.zip)
```

Edit files in `src/`, then run `npm run build` to sync to both extension directories and generate browser-specific manifests. Use `npm run build -- --zip` to also create distribution ZIPs.

---

## Permissions

| Permission | Reason |
|------------|--------|
| `alarms` | Triggers periodic status refresh |
| `tabs` | Sends updated status data to open claude.ai tabs |
| `storage` | Persists theme, language, notification, and interval settings |
| `notifications` | Shows browser notifications on incident and recovery |
| `https://claude.ai/*` | Injects the status widget |
| `https://status.anthropic.com/*` | Fetches the status API |

---

## Privacy Policy

This extension does **not** collect, store, or transmit any personal data.

- No user data is sent to any server
- No analytics or tracking of any kind
- Network requests are read-only GETs to `https://status.anthropic.com/api/v2/`
- Settings are stored locally in the browser using `browser.storage.local` and never leave the device

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first.

---

## License

[MIT](LICENSE)
