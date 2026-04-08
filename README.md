# Claude Status Monitor

A Firefox and Chrome extension that displays the real-time operational status of Anthropic's Claude services — as an inline widget on [claude.ai](https://claude.ai) and as a detailed popup accessible from the browser toolbar.

![Firefox](https://img.shields.io/badge/Firefox-140%2B-orange?logo=firefox)
![Chrome](https://img.shields.io/badge/Chrome-MV3-blue?logo=googlechrome)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![Version](https://img.shields.io/badge/Version-2.1-brightgreen)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Features

### Widget (claude.ai)
- **Live status widget** — appears in the bottom-right corner of claude.ai
- **Color-coded indicator** — green (operational), orange (degraded/partial outage), red (major outage), gray (unknown/maintenance)
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

## What's New in v2.1

- **Recovery notifications** — get notified when services return to operational after an outage (gray → green from maintenance end does not trigger this)
- **Theme button in settings** — the Dark/Light toggle is now a 🌙/☀️ icon button, consistent with the header

---

## How It Works

```
status.anthropic.com/api/v2/
  ├── summary.json     ← polled periodically → widget + popup
  └── incidents.json   ← polled periodically → popup history & uptime chart

background.js  ←→  content.js   (widget on claude.ai)
               ←→  popup.js     (toolbar popup)
```

The background service worker fetches and caches status data, broadcasts updates to open claude.ai tabs, and fires browser notifications when status changes.

---

## Installation

### Firefox — From AMO
Install from [addons.mozilla.org](https://addons.mozilla.org) or sideload the `.xpi` from the [Releases](../../releases) page.

### Firefox — Manual (Developer)
1. Clone or download this repository
2. Open Firefox → `about:debugging` → **"This Firefox"** → **"Load Temporary Add-on…"**
3. Select `claude-status-extension-firefox-v2/manifest.json`
4. Open [claude.ai](https://claude.ai) — the widget appears in the bottom-right corner

### Chrome — Manual (Developer)
1. Open Chrome → `chrome://extensions` → enable **Developer mode**
2. Click **"Load unpacked"** → select the `claude-status-extension-chrome-v2/` folder

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
| 🟠 Orange | Degraded performance or partial outage |
| 🔴 Red | Major outage |
| ⚫ Gray | Status unavailable / maintenance |

---

## Repository Structure

```
src/                                  ← shared source — edit here
claude-status-extension-firefox-v2/  ← Firefox v2 build target
claude-status-extension-chrome-v2/   ← Chrome v2 build target
claude-status-extension-firefox/      ← Firefox v1 (legacy)
dist/                                 ← packaged releases (.zip, .xpi)
sync.ps1                              ← propagates src/ to both v2 extensions
```

Only `manifest.json` in each extension folder is browser-specific. All other source files live in `src/` and are synced via `sync.ps1`.

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
