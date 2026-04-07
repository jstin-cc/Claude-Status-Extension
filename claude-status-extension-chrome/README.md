# Claude Status Monitor — Chrome Edition

A Chrome extension that displays the real-time operational status of Anthropic's Claude services — both as an inline widget on [claude.ai](https://claude.ai) and as a detailed popup accessible from the browser toolbar.

![Chrome](https://img.shields.io/badge/Chrome-MV3-blue?logo=googlechrome)
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
- **Detailed status overview** — click the extension icon in the Chrome toolbar
- **All service components** with live status
- **7-day uptime chart** — color-coded bars showing incident history per day
- **Active incidents** — with impact level, status, and latest update
- **Scheduled maintenance** — upcoming and in-progress windows
- **Incident history** — resolved incidents from the last 7 days with duration

### General
- **Bilingual** — supports German 🇩🇪 and English 🇺🇸, switchable in both widget and popup
- **Persistent settings** — language and theme choice saved across sessions
- **No tracking, no external servers** — only communicates with `status.anthropic.com`

---

## How It Works

```
status.anthropic.com/api/v2/
  ├── summary.json     ← polled every 60s → widget + toolbar popup
  └── incidents.json   ← polled every 60s → popup history & uptime chart

background.js (service worker)  ←→  content.js   (widget)
                                ←→  popup.js     (toolbar popup)
```

The background service worker fetches status data and caches it. This avoids Content Security Policy restrictions that would block direct fetches from the page context.

---

## Installation

### From Chrome Web Store
*(Not yet published)*

### Manual (Developer / Unpacked)
1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **"Developer mode"** (top-right toggle)
4. Click **"Load unpacked"**
5. Select the `claude-status-extension-chrome/` folder
6. Open [claude.ai](https://claude.ai) — the widget appears in the bottom-right corner

---

## Differences from the Firefox Version

| Aspect | Firefox | Chrome |
|--------|---------|--------|
| Background script | `"scripts": [...]` in manifest | `"service_worker": "..."` in manifest |
| Browser-specific settings | `browser_specific_settings` (gecko) | Not applicable — removed |
| APIs used | `chrome.*` (standard) | `chrome.*` (native) |
| Distribution | Firefox AMO (.xpi) | Chrome Web Store (.zip) |

All JavaScript code (`background.js`, `content.js`, `popup.js`, `shared.js`) is identical between both versions — only `manifest.json` differs.

---

## Packaging for Chrome Web Store

```bash
# Linux / macOS
zip -r claude-status-monitor-chrome.zip claude-status-extension-chrome/

# Windows PowerShell
Compress-Archive -Path "claude-status-extension-chrome/*" -DestinationPath "claude-status-monitor-chrome.zip" -Force
```

Upload the `.zip` to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

---

## Usage

### Widget (bottom-right on claude.ai)

| Action | Result |
|--------|--------|
| Widget visible | Shows status dot + "Claude Status" label |
| Click widget | Expands to show all service components |
| Click again | Collapses back to pill |
| Click flag 🇩🇪/🇺🇸 when expanded | Opens language selector |
| Click 🌙/☀️ | Toggle dark/light theme |

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
claude-status-extension-chrome/
├── manifest.json       # Chrome MV3 manifest (service_worker, no gecko settings)
├── background.js       # Service worker — status polling, badge, notifications
├── shared.js           # Shared constants (STATUS_COLOR, STATUS_PRIORITY)
├── content.js          # Widget injection and rendering on claude.ai
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
| `alarms` | Triggers status refresh every 60 seconds |
| `tabs` | Sends updated status data to open claude.ai tabs |
| `storage` | Persists language, theme, and expand state |
| `notifications` | Optional status change alerts |
| `https://claude.ai/*` | Injects the status widget |
| `https://status.anthropic.com/*` | Fetches the status API |

---

## Privacy

This extension does **not** collect, store, or transmit any personal data.

- No user data is sent to any server
- No analytics or tracking of any kind
- Network requests are read-only GETs to `https://status.anthropic.com/api/v2/`
- Settings are stored locally using `chrome.storage.local` and never leave the device

---

## License

[MIT](LICENSE)
