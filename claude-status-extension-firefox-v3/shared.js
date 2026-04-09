'use strict';

// Shared constants — loaded before content.js, popup.js, and background.js
// content_scripts: ["shared.js", "content.js"] in manifest.json
// popup.html: <script src="shared.js"></script> before popup.js
// background (Firefox): "scripts": ["shared.js", "background.js"]
// background (Chrome): importScripts('shared.js') in background.js

// ── Config ──────────────────────────────────────────────────

const CSM_CONFIG = {
  API_BASE: 'https://status.anthropic.com/api/v2',
  FETCH_TIMEOUT_MS: 8000,
  DEFAULT_POLL_MINUTES: 1,
  MAX_BACKOFF_MINUTES: 10,
  CACHE_MAX_AGE_MS: 600000, // 10 min
};

const STORAGE_KEYS = {
  LANG:     'csm-lang',
  THEME:    'csm-theme',
  EXPANDED: 'csm-expanded',
  NOTIFY:   'csm-notify',
  INTERVAL: 'csm-poll-interval',
  CACHE:    'csm-cache',
};

// ── Status maps ─────────────────────────────────────────────

const STATUS_COLOR = {
  major_outage: 'red',
  partial_outage: 'orange',
  degraded_performance: 'yellow',
  under_maintenance: 'gray',
  operational: 'green',
};

const STATUS_PRIORITY = {
  major_outage: 4,
  partial_outage: 3,
  degraded_performance: 2,
  under_maintenance: 1,
  operational: 0,
};

function getOverallColor(components) {
  let maxPriority = -1;
  let worstStatus = 'operational';
  for (const c of components) {
    if (c.group) continue;
    const p = STATUS_PRIORITY[c.status] ?? 0;
    if (p > maxPriority) { maxPriority = p; worstStatus = c.status; }
  }
  return STATUS_COLOR[worstStatus] ?? 'gray';
}

// ── Error codes ─────────────────────────────────────────────

const ERROR_CODES = {
  TIMEOUT:  'TIMEOUT',
  NETWORK:  'NETWORK',
  OFFLINE:  'OFFLINE',
  HTTP_4XX: 'HTTP_4XX',
  HTTP_5XX: 'HTTP_5XX',
  PARSE:    'PARSE',
  UNKNOWN:  'UNKNOWN',
};

const ERROR_LABELS = {
  de: {
    TIMEOUT:  'Zeitüberschreitung — erneuter Versuch läuft',
    NETWORK:  'Netzwerkfehler — bist du online?',
    OFFLINE:  'Offline — letzte Daten werden angezeigt',
    HTTP_4XX: 'API vorübergehend nicht erreichbar',
    HTTP_5XX: 'Statuspage-Server nicht erreichbar',
    PARSE:    'Ungültige Antwort vom Server',
    UNKNOWN:  'Unbekannter Fehler',
  },
  en: {
    TIMEOUT:  'Request timed out — retrying',
    NETWORK:  'Network error — are you online?',
    OFFLINE:  'Offline — showing last known data',
    HTTP_4XX: 'API temporarily unreachable',
    HTTP_5XX: 'Status page server unreachable',
    PARSE:    'Invalid response from server',
    UNKNOWN:  'Unknown error',
  },
};

// ── Shared labels (status text used in both widget and popup) ─

const SHARED_STATUS_LABELS = {
  de: {
    major_outage: 'Komplettausfall',
    partial_outage: 'Teilausfall',
    degraded_performance: 'Eingeschränkt',
    under_maintenance: 'Wartung',
    operational: 'Betrieb normal',
  },
  en: {
    major_outage: 'Major Outage',
    partial_outage: 'Partial Outage',
    degraded_performance: 'Degraded',
    under_maintenance: 'Maintenance',
    operational: 'Operational',
  },
};

// ── DOM helper ──────────────────────────────────────────────

function csmEl(tag, classOrId, text) {
  const e = document.createElement(tag);
  if (classOrId) {
    if (classOrId.startsWith('#')) e.id = classOrId.slice(1);
    else e.className = classOrId;
  }
  if (text !== undefined) e.textContent = text;
  return e;
}
