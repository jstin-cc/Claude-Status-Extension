# Privacy Policy — Claude Status Monitor

**Last updated: 2026-06-11**

## Overview

Claude Status Monitor is a browser extension for Firefox and Chrome that displays the real-time operational status of Anthropic's Claude services. This policy describes what data the extension accesses and how it is handled.

## Data Collection

**This extension does not collect, store, or transmit any personal data.**

- No user information is collected
- No analytics or telemetry of any kind
- No advertising or tracking

## Network Requests

The extension makes read-only HTTP GET requests to a single external endpoint:

```
https://status.anthropic.com/api/v2/
```

This is the official public Anthropic status API. The requests contain no user data — only a standard browser request for JSON status information. No data is sent to any server operated by this extension or its author.

## Local Storage

The extension stores the following preferences locally in the browser using `browser.storage.local` (Firefox) or `chrome.storage.local` (Chrome):

| Key | Value | Purpose |
|-----|-------|---------|
| `csm-lang` | `"de"` or `"en"` | Language preference |
| `csm-theme` | `"auto"`, `"dark"` or `"light"` | Theme preference |
| `csm-expanded` | `true` / `false` | Widget expand/collapse state |
| `csm-notify` | `true` / `false` | Notifications on/off |
| `csm-poll-interval` | number | Status refresh interval |
| `csm-widget-visible` | `true` / `false` | Widget visibility on claude.ai |
| `csm-cache` | last fetched status payload | Warm start after a browser restart (≤ 10 min) |

In addition, ephemeral worker state (`csm-bg-state`: last overall status, error counter, cached payload) lives in `browser.storage.session` and is cleared automatically when the browser closes.

All of this is non-personal UI/state data. It never leaves the device.

## Permissions

| Permission | Reason |
|------------|--------|
| `alarms` | Triggers periodic status refresh (configurable: 30 s – 5 min) |
| `tabs` | Sends updated status to open claude.ai tabs |
| `storage` | Persists the preferences listed above locally |
| `notifications` | Shows browser notifications on status change and recovery |
| `https://claude.ai/*` | Injects the status widget into the page |
| `https://status.anthropic.com/*` | Fetches the public status API |

## Third-Party Services

The extension reads from `status.anthropic.com`, which is operated by Anthropic. This extension is not affiliated with, endorsed by, or created by Anthropic.

## Changes to This Policy

If this policy changes, the updated version will be committed to this repository with a new "Last updated" date.

## Contact

For questions or concerns, open an issue at:
[https://github.com/jstin-cc/Claude-Status-Extension/issues](https://github.com/jstin-cc/Claude-Status-Extension/issues)
