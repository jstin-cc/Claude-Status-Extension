'use strict';

// Shared constants — loaded before content.js, popup.js, and background.js
// content_scripts: ["shared.js", "content.js"] in manifest.json
// popup.html: <script src="shared.js"></script> before popup.js
// background (Firefox): "scripts": ["shared.js", "background.js"]
// background (Chrome): importScripts('shared.js') in background.js
//
// Everything here must stay pure (no chrome.* calls, no DOM access at load
// time) so it can run in the service worker and be unit-tested via vitest.

// ── Config ──────────────────────────────────────────────────

const CSM_CONFIG = {
  API_BASE: 'https://status.anthropic.com/api/v2',
  FETCH_TIMEOUT_MS: 8000,
  DEFAULT_POLL_MINUTES: 1,
  MAX_BACKOFF_MINUTES: 10,
  CACHE_MAX_AGE_MS: 600000, // 10 min — storage.local warm-start cache
  INCIDENTS_TTL_MS: 120000, // 2 min — incidents.json is only fetched for the popup
  STALE_AFTER_MS: 300000,   // 5 min — data older than this is flagged as stale
};

const STORAGE_KEYS = {
  LANG:     'csm-lang',
  THEME:    'csm-theme',          // 'auto' | 'dark' | 'light' (unset → auto)
  EXPANDED: 'csm-expanded',
  NOTIFY:   'csm-notify',
  INTERVAL: 'csm-poll-interval',
  CACHE:    'csm-cache',          // storage.local — survives browser restart
  BG_STATE: 'csm-bg-state',       // storage.session — survives SW respawn only
  WIDGET_VISIBLE: 'csm-widget-visible',
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

// Statuspage top-level status.indicator → component-status enum.
// summary.json's own overall verdict already folds in active incidents.
const INDICATOR_STATUS = {
  none: 'operational',
  minor: 'degraded_performance',
  major: 'partial_outage',
  critical: 'major_outage',
  maintenance: 'under_maintenance',
};

// Worst of: Statuspage's own indicator + every non-group component.
function getOverallStatus(components, indicator) {
  let worst = INDICATOR_STATUS[indicator] ?? 'operational';
  for (const c of components ?? []) {
    if (c.group) continue;
    if ((STATUS_PRIORITY[c.status] ?? 0) > (STATUS_PRIORITY[worst] ?? 0)) worst = c.status;
  }
  return worst;
}

function getOverallColor(components) {
  return STATUS_COLOR[getOverallStatus(components)] ?? 'gray';
}

// Status-string comparisons for notifications — never compare colors.
function isWorseStatus(next, prev) {
  return (STATUS_PRIORITY[next] ?? 0) > (STATUS_PRIORITY[prev] ?? 0);
}

function isRecoveryStatus(next, prev) {
  return next === 'operational'
    && (STATUS_PRIORITY[prev] ?? 0) >= STATUS_PRIORITY.degraded_performance;
}

// ── Payload contract ────────────────────────────────────────
// The one shape that travels in STATUS_DATA broadcasts, GET_STATUS
// responses, and the `summary` half of GET_SUMMARY responses.

function buildStatusPayload(summaryJson, fetchedAt) {
  return {
    components: summaryJson.components ?? [],
    incidents: summaryJson.incidents ?? [],
    scheduled_maintenances: summaryJson.scheduled_maintenances ?? [],
    indicator: summaryJson.status?.indicator ?? 'none',
    fetchedAt,
  };
}

function validateSummary(json) {
  return !!json && Array.isArray(json.components);
}

function validateIncidents(json) {
  return !!json && Array.isArray(json.incidents);
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

// Pure: pass navigator.onLine in as `onLine` so this stays testable.
function classifyFetchError(err, httpStatus, onLine) {
  if (err?.name === 'AbortError') return ERROR_CODES.TIMEOUT;
  if (onLine === false) return ERROR_CODES.OFFLINE;
  if (httpStatus >= 400 && httpStatus < 500) return ERROR_CODES.HTTP_4XX;
  if (httpStatus >= 500) return ERROR_CODES.HTTP_5XX;
  if (err?.name === 'TypeError' || err?.message?.includes('fetch')) return ERROR_CODES.NETWORK;
  if (err?.name === 'SyntaxError') return ERROR_CODES.PARSE;
  return ERROR_CODES.UNKNOWN;
}

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

// ── Timestamp / staleness ───────────────────────────────────
// Returns { text, stale }. Both widget and popup render through this so
// cached payloads can never masquerade as freshly checked.

function formatLastChecked(fetchedAt, lang, now) {
  const ts = typeof now === 'number' ? now : Date.now();
  const locale = lang === 'de' ? 'de-DE' : 'en-US';
  const time = new Date(fetchedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const ageMs = Math.max(0, ts - fetchedAt);
  const stale = ageMs > CSM_CONFIG.STALE_AFTER_MS;
  const base = lang === 'de' ? `Stand: ${time} Uhr` : `Updated ${time}`;
  if (ageMs < 120000) return { text: base, stale };
  const mins = Math.floor(ageMs / 60000);
  const ago = mins < 60
    ? (lang === 'de' ? `vor ${mins} Min.` : `${mins} min ago`)
    : (lang === 'de' ? `vor ${Math.floor(mins / 60)} Std.` : `${Math.floor(mins / 60)}h ago`);
  return { text: `${base} · ${ago}`, stale };
}

// ── UI labels ───────────────────────────────────────────────
// Single source for every user-visible string (incl. aria-labels).
// Structure is lang-first so call sites read UI_LABELS[currentLang].widget.
// The vitest suite enforces DE/EN key parity recursively.

const UI_LABELS = {
  de: {
    impact: { major: 'Kritisch', minor: 'Gering', maintenance: 'Wartung', none: '' },
    widget: {
      loading: 'Wird geladen…',
      error: 'Status nicht verfügbar',
      noData: 'Keine Daten verfügbar',
      details: 'Details',
      activeIncident: 'Aktiver Vorfall',
      headerAria: 'Claude Status — ein-/ausklappen',
      langAria: 'Sprache wechseln (Deutsch/Englisch)',
      themeAria: 'Theme wechseln',
      widgetAria: 'Claude Status Monitor',
    },
    popup: {
      components: 'Komponenten',
      activeIncidents: 'Aktive Vorfälle',
      scheduledMaint: 'Geplante Wartung',
      recentIncidents: 'Letzte Vorfälle',
      noIncidents: 'Keine aktuellen Vorfälle',
      noMaintenance: 'Keine geplanten Wartungen',
      noHistory: 'Keine aufgelösten Vorfälle in den letzten 7 Tagen',
      uptimeHistory: '7-Tage-Verlauf',
      uptimeAria: 'Uptime-Verlauf der letzten 7 Tage',
      dayNames: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
      today: 'Heute',
      loading: 'Wird geladen…',
      error: 'Daten nicht verfügbar',
      langAria: 'Sprache wechseln (Deutsch/Englisch)',
      refreshAria: 'Status aktualisieren',
      themeAria: 'Theme wechseln',
      settingsAria: 'Einstellungen öffnen',
      backAria: 'Zurück',
      incidentStatus: {
        investigating: 'Wird untersucht',
        identified: 'Identifiziert',
        monitoring: 'Monitoring',
        resolved: 'Behoben',
        postmortem: 'Postmortem',
      },
      maintStatus: {
        scheduled: 'Geplant',
        in_progress: 'Läuft',
        completed: 'Abgeschlossen',
      },
      duration: (mins) => {
        if (mins < 60) return `${mins} Min.`;
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return m > 0 ? `${h} Std. ${m} Min.` : `${h} Std.`;
      },
      ago: (mins) => {
        if (mins < 2) return 'gerade eben';
        if (mins < 60) return `vor ${mins} Min.`;
        return `vor ${Math.floor(mins / 60)} Std.`;
      },
    },
    settings: {
      title: 'Einstellungen',
      theme: 'Erscheinungsbild',
      themeDesc: 'Auto folgt claude.ai',
      themeOptions: { auto: 'Auto', dark: 'Dunkel', light: 'Hell' },
      notify: 'Benachrichtigungen',
      notifyDesc: 'Bei Störung & Erholung',
      lang: 'Sprache',
      widget: 'Widget anzeigen',
      widgetDesc: 'Status-Widget auf claude.ai',
      interval: 'Aktualisierungsintervall',
      intervalDesc: 'Wie oft Status geprüft wird',
      intervals: { '0.5': '30 Sek.', '1': '1 Min.', '2': '2 Min.', '5': '5 Min.' },
    },
  },
  en: {
    impact: { major: 'Major', minor: 'Minor', maintenance: 'Maintenance', none: '' },
    widget: {
      loading: 'Loading…',
      error: 'Status unavailable',
      noData: 'No data available',
      details: 'Details',
      activeIncident: 'Active incident',
      headerAria: 'Claude Status — expand/collapse',
      langAria: 'Switch language (German/English)',
      themeAria: 'Toggle theme',
      widgetAria: 'Claude Status Monitor',
    },
    popup: {
      components: 'Components',
      activeIncidents: 'Active Incidents',
      scheduledMaint: 'Scheduled Maintenance',
      recentIncidents: 'Recent Incidents',
      noIncidents: 'No active incidents',
      noMaintenance: 'No scheduled maintenance',
      noHistory: 'No resolved incidents in the last 7 days',
      uptimeHistory: '7-Day History',
      uptimeAria: 'Uptime history of the last 7 days',
      dayNames: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      today: 'Today',
      loading: 'Loading…',
      error: 'Data unavailable',
      langAria: 'Switch language (German/English)',
      refreshAria: 'Refresh status',
      themeAria: 'Toggle theme',
      settingsAria: 'Open settings',
      backAria: 'Back',
      incidentStatus: {
        investigating: 'Investigating',
        identified: 'Identified',
        monitoring: 'Monitoring',
        resolved: 'Resolved',
        postmortem: 'Postmortem',
      },
      maintStatus: {
        scheduled: 'Scheduled',
        in_progress: 'In Progress',
        completed: 'Completed',
      },
      duration: (mins) => {
        if (mins < 60) return `${mins}m`;
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
      },
      ago: (mins) => {
        if (mins < 2) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        return `${Math.floor(mins / 60)}h ago`;
      },
    },
    settings: {
      title: 'Settings',
      theme: 'Appearance',
      themeDesc: 'Auto follows claude.ai',
      themeOptions: { auto: 'Auto', dark: 'Dark', light: 'Light' },
      notify: 'Notifications',
      notifyDesc: 'On incident & recovery',
      lang: 'Language',
      widget: 'Show widget',
      widgetDesc: 'Status widget on claude.ai',
      interval: 'Refresh interval',
      intervalDesc: 'How often status is checked',
      intervals: { '0.5': '30 sec', '1': '1 min', '2': '2 min', '5': '5 min' },
    },
  },
};

// ── DOM helpers ─────────────────────────────────────────────

function csmEl(tag, classOrId, text) {
  const e = document.createElement(tag);
  if (classOrId) {
    if (classOrId.startsWith('#')) e.id = classOrId.slice(1);
    else e.className = classOrId;
  }
  if (text !== undefined) e.textContent = text;
  return e;
}

// Inline SVG icons via createElementNS — AMO-safe (no innerHTML) and immune
// to the page CSP (inline DOM nodes are not fetched resources, unlike
// data:-URI background images). Stroke uses currentColor for free theming.

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICON_PATHS = {
  sun: [
    'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    'M8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.05 1.05M11.55 11.55l1.05 1.05M12.6 3.4l-1.05 1.05M4.45 11.55L3.4 12.6',
  ],
  moon: ['M13.25 9.85A5.75 5.75 0 1 1 6.15 2.75a4.5 4.5 0 0 0 7.1 7.1Z'],
  chevron: ['M4 6l4 4 4-4'],
  external: [
    'M6.5 3.5h-3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3',
    'M9.5 2.5h4v4M13.5 2.5l-6 6',
  ],
  refresh: ['M13.5 8a5.5 5.5 0 1 1-1.6-3.9', 'M13.5 1.5v3h-3'],
  settings: [
    'M2.5 4.5h5.5M11.5 4.5h2M2.5 11.5h2M8 11.5h5.5',
    'M9.5 2.75a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Z',
    'M6 9.75a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Z',
  ],
  back: ['M13 8H3.5', 'M7.5 4L3.5 8l4 4'],
  check: ['M3 8.5l3 3 7-7'],
};

function csmIcon(name, size) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size ?? 14));
  svg.setAttribute('height', String(size ?? 14));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `csm-icon csm-icon-${name}`);
  for (const d of ICON_PATHS[name] ?? []) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}
