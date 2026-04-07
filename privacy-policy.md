# Privacy Policy — Claude Status Monitor

**Last updated: 2026-04-07**

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

The extension stores the following data locally in the browser using `browser.storage.local` (Firefox) or `chrome.storage.local` (Chrome):

| Key | Value | Purpose |
|-----|-------|---------|
| `lang` | `"de"` or `"en"` | Language preference |
| `expanded` | `true` or `false` | Widget expand/collapse state |

This data never leaves the device.

## Permissions

| Permission | Reason |
|------------|--------|
| `alarms` | Triggers periodic status refresh (every 60s / 5min) |
| `tabs` | Sends updated status to open claude.ai tabs |
| `storage` | Persists language and UI preferences locally |
| `notifications` | Shows browser notifications for status changes (Chrome only) |
| `https://claude.ai/*` | Injects the status widget into the page |
| `https://status.anthropic.com/*` | Fetches the public status API |

## Third-Party Services

The extension reads from `status.anthropic.com`, which is operated by Anthropic. This extension is not affiliated with, endorsed by, or created by Anthropic.

## Changes to This Policy

If this policy changes, the updated version will be committed to this repository with a new "Last updated" date.

## Contact

For questions or concerns, open an issue at:
[https://github.com/jstin-cc/Claude-Status-Firefox-Extension/issues](https://github.com/jstin-cc/Claude-Status-Firefox-Extension/issues)
