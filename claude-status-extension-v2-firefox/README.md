# Claude Status Monitor

A Firefox extension that displays the real-time operational status of Anthropic's Claude services — both as an inline widget on [claude.ai](https://claude.ai) and as a detailed popup accessible from the browser toolbar.

![Firefox](https://img.shields.io/badge/Firefox-140%2B-orange?logo=firefox)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Features

### Widget (claude.ai)
- **Live status widget** — appears in the bottom-right corner of claude.ai
- **Color-coded indicator** — green (operational), orange (degraded/partial outage), red (major outage), gray (unknown/maintenance)
- **Expandable component list** — shows the status of each individual Anthropic service
- **Auto-refresh** — polls the official Anthropic status API every 60 seconds

### Toolbar Popup
- **Detailed status overview** — click the extension icon in the Firefox toolbar
- **All service components** with live status
- **7-day uptime chart** — color-coded bars showing incident history per day
- **Active incidents** — with impact level, status, and latest update
- **Scheduled maintenance** — upcoming and in-progress windows
- **Incident history** — resolved incidents from the last 7 days with duration

### General
- **Bilingual** — supports German 🇩🇪 and English 🇺🇸, switchable in both widget and popup
- **Persistent settings** — language choice is saved across sessions
- **No tracking, no external servers** — only communicates with `status.anthropic.com`

---

## How It Works

```
status.anthropic.com/api/v2/
  ├── components.json  ← polled every 60s → widget on claude.ai
  ├── summary.json     ← polled every 5min → toolbar popup
  └── incidents.json   ← polled every 5min → popup history & uptime chart

background.js  ←→  content.js   (widget)
               ←→  popup.js     (toolbar popup)
```

The background script fetches status data and caches it. This avoids Content Security Policy restrictions that would block direct fetches from the page context.

---

## Installation

### From Firefox Add-ons (AMO)
Click the `.xpi` file or install from [addons.mozilla.org](https://addons.mozilla.org).

### Manual (Developer / Temporary)
1. Clone or download this repository
2. Open Firefox and navigate to `about:debugging`
3. Click **"This Firefox"** → **"Load Temporary Add-on…"**
4. Select `manifest.json` from the `claude-status-extension/` folder
5. Open [claude.ai](https://claude.ai) — the widget appears in the bottom-right corner

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
| Click flag 🇩🇪/🇺🇸 | Switch language (synced with widget) |
| Hover uptime bar | Shows date and status for that day |

### Status Colors

| Color | Meaning |
|-------|---------|
| 🟢 Green | All systems operational |
| 🟠 Orange | Degraded performance or partial outage |
| 🔴 Red | Major outage |
| ⚫ Gray | Status unavailable / maintenance |

---

## File Structure

```
claude-status-extension/
├── manifest.json       # Extension manifest (MV3)
├── background.js       # Status API polling via alarms, caches data
├── content.js          # Widget injection, rendering, language logic
├── content.css         # Widget styles
├── popup.html          # Toolbar popup markup
├── popup.js            # Popup rendering & language logic
├── popup.css           # Popup styles
└── icons/
    ├── icon-16.png
    ├── icon-48.png
    └── icon-128.png
```

---

## Permissions

| Permission | Reason |
|------------|--------|
| `alarms` | Triggers status refresh every 60s (widget) and 5min (popup) |
| `tabs` | Sends updated status data to open claude.ai tabs |
| `storage` | Persists language preference |
| `https://claude.ai/*` | Injects the status widget |
| `https://status.anthropic.com/*` | Fetches the status API |

---

## Privacy Policy

This extension does **not** collect, store, or transmit any personal data.

- No user data is sent to any server
- No analytics or tracking of any kind
- Network requests are read-only GETs to `https://status.anthropic.com/api/v2/`
- Settings (language) are stored locally in the browser using `browser.storage.local` and never leave the device

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first.

---

## License

[MIT](LICENSE)
