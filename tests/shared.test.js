/**
 * Tests for src/shared.js
 *
 * shared.js uses global variables (no module exports) because it's loaded
 * as a content script. We eval it in a controlled scope to test the logic.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sharedSource = readFileSync(join(__dirname, '..', 'src', 'shared.js'), 'utf8');

// Execute shared.js in a sandboxed scope and collect its globals
function loadShared() {
  const globals = {};

  function mockNode(tag) {
    return {
      tagName: tag.toUpperCase(),
      id: '', className: '', textContent: '',
      attributes: {},
      children: [],
      setAttribute(k, v) { this.attributes[k] = v; },
      appendChild(child) { this.children.push(child); return child; },
    };
  }

  const mockDocument = {
    createElement(tag) { return mockNode(tag); },
    createElementNS(_ns, tag) { return mockNode(tag); },
  };

  const fn = new Function(
    'document',
    // Strip 'use strict' so we can capture top-level declarations via `this`
    sharedSource.replace(/^'use strict';?\s*/, '') +
    '\nreturn { CSM_CONFIG, STORAGE_KEYS, STATUS_COLOR, STATUS_PRIORITY, ' +
    'INDICATOR_STATUS, getOverallStatus, isWorseStatus, ' +
    'getImpactStatus, worseStatus, nextNotifyState, getRecentResolvedIncidents, ' +
    'getDailyStatuses, BADGE_COLORS, getBadgeState, buildNotificationMessage, detectLang, ' +
    'isRecoveryStatus, buildStatusPayload, validateSummary, validateIncidents, ' +
    'classifyFetchError, formatLastChecked, UI_LABELS, ' +
    'ERROR_CODES, ERROR_LABELS, SHARED_STATUS_LABELS, csmEl, csmIcon, ICON_PATHS };'
  );

  return fn.call(globals, mockDocument);
}

let shared;

beforeAll(() => {
  shared = loadShared();
});

// ── CSM_CONFIG ────────────────────────────────────────────

describe('CSM_CONFIG', () => {
  it('has required keys', () => {
    expect(shared.CSM_CONFIG).toHaveProperty('API_BASE');
    expect(shared.CSM_CONFIG).toHaveProperty('FETCH_TIMEOUT_MS');
    expect(shared.CSM_CONFIG).toHaveProperty('DEFAULT_POLL_MINUTES');
    expect(shared.CSM_CONFIG).toHaveProperty('MAX_BACKOFF_MINUTES');
    expect(shared.CSM_CONFIG).toHaveProperty('CACHE_MAX_AGE_MS');
    expect(shared.CSM_CONFIG).toHaveProperty('INCIDENTS_TTL_MS');
    expect(shared.CSM_CONFIG).toHaveProperty('STALE_AFTER_MS');
  });

  it('API_BASE points to Anthropic status page', () => {
    expect(shared.CSM_CONFIG.API_BASE).toContain('status.anthropic.com');
  });

  it('FETCH_TIMEOUT_MS is a positive number', () => {
    expect(shared.CSM_CONFIG.FETCH_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

// ── STORAGE_KEYS ──────────────────────────────────────────

describe('STORAGE_KEYS', () => {
  it('has all expected keys', () => {
    const keys = ['LANG', 'THEME', 'EXPANDED', 'NOTIFY', 'INTERVAL', 'CACHE', 'BG_STATE', 'BG_INCIDENTS', 'WIDGET_VISIBLE'];
    for (const k of keys) {
      expect(shared.STORAGE_KEYS).toHaveProperty(k);
      expect(typeof shared.STORAGE_KEYS[k]).toBe('string');
    }
  });

  it('all values have csm- prefix', () => {
    for (const val of Object.values(shared.STORAGE_KEYS)) {
      expect(val).toMatch(/^csm-/);
    }
  });
});

// ── STATUS_COLOR ──────────────────────────────────────────

describe('STATUS_COLOR', () => {
  it('maps all five statuses', () => {
    expect(shared.STATUS_COLOR.operational).toBe('green');
    expect(shared.STATUS_COLOR.degraded_performance).toBe('yellow');
    expect(shared.STATUS_COLOR.partial_outage).toBe('orange');
    expect(shared.STATUS_COLOR.major_outage).toBe('red');
    expect(shared.STATUS_COLOR.under_maintenance).toBe('gray');
  });
});

// ── STATUS_PRIORITY ───────────────────────────────────────

describe('STATUS_PRIORITY', () => {
  it('operational has lowest priority (0)', () => {
    expect(shared.STATUS_PRIORITY.operational).toBe(0);
  });

  it('major_outage has highest priority', () => {
    const maxP = Math.max(...Object.values(shared.STATUS_PRIORITY));
    expect(shared.STATUS_PRIORITY.major_outage).toBe(maxP);
  });

  it('priorities are strictly ordered', () => {
    const { operational, under_maintenance, degraded_performance, partial_outage, major_outage } = shared.STATUS_PRIORITY;
    expect(operational).toBeLessThan(under_maintenance);
    expect(under_maintenance).toBeLessThan(degraded_performance);
    expect(degraded_performance).toBeLessThan(partial_outage);
    expect(partial_outage).toBeLessThan(major_outage);
  });
});

// ── INDICATOR_STATUS ──────────────────────────────────────

describe('INDICATOR_STATUS', () => {
  it('maps every Statuspage indicator to a known status', () => {
    const indicators = ['none', 'minor', 'major', 'critical', 'maintenance'];
    for (const ind of indicators) {
      const status = shared.INDICATOR_STATUS[ind];
      expect(shared.STATUS_PRIORITY).toHaveProperty(status);
    }
  });
});

// ── getOverallStatus ──────────────────────────────────────

describe('getOverallStatus', () => {
  it('returns operational for all-operational components without indicator', () => {
    const comps = [{ status: 'operational' }, { status: 'operational' }];
    expect(shared.getOverallStatus(comps)).toBe('operational');
  });

  it('returns the worst component status', () => {
    const comps = [{ status: 'operational' }, { status: 'partial_outage' }];
    expect(shared.getOverallStatus(comps)).toBe('partial_outage');
  });

  it('folds in the Statuspage indicator when worse than components', () => {
    const comps = [{ status: 'operational' }];
    expect(shared.getOverallStatus(comps, 'minor')).toBe('degraded_performance');
    expect(shared.getOverallStatus(comps, 'critical')).toBe('major_outage');
  });

  it('keeps the worse component status over a milder indicator', () => {
    const comps = [{ status: 'major_outage' }];
    expect(shared.getOverallStatus(comps, 'minor')).toBe('major_outage');
  });

  it('ignores unknown indicators', () => {
    expect(shared.getOverallStatus([], 'something_new')).toBe('operational');
  });

  it('skips group-header components', () => {
    const comps = [
      { status: 'major_outage', group: true },
      { status: 'operational' },
    ];
    expect(shared.getOverallStatus(comps)).toBe('operational');
  });

  it('handles undefined components', () => {
    expect(shared.getOverallStatus(undefined, 'none')).toBe('operational');
  });
});

// ── isWorseStatus / isRecoveryStatus ──────────────────────
// Regression tests for the v3 bug where color-keyed rank maps lacked
// 'yellow', so degraded_performance counted as operational.

describe('isWorseStatus', () => {
  it('degraded_performance is worse than operational (v3 regression)', () => {
    expect(shared.isWorseStatus('degraded_performance', 'operational')).toBe(true);
  });

  it('detects every escalation step', () => {
    expect(shared.isWorseStatus('under_maintenance', 'operational')).toBe(true);
    expect(shared.isWorseStatus('degraded_performance', 'under_maintenance')).toBe(true);
    expect(shared.isWorseStatus('partial_outage', 'degraded_performance')).toBe(true);
    expect(shared.isWorseStatus('major_outage', 'partial_outage')).toBe(true);
  });

  it('is false for same or improving status', () => {
    expect(shared.isWorseStatus('operational', 'operational')).toBe(false);
    expect(shared.isWorseStatus('operational', 'major_outage')).toBe(false);
    expect(shared.isWorseStatus('degraded_performance', 'major_outage')).toBe(false);
  });
});

describe('isRecoveryStatus', () => {
  it('operational after degraded_performance is a recovery (v3 regression)', () => {
    expect(shared.isRecoveryStatus('operational', 'degraded_performance')).toBe(true);
  });

  it('operational after any outage is a recovery', () => {
    expect(shared.isRecoveryStatus('operational', 'partial_outage')).toBe(true);
    expect(shared.isRecoveryStatus('operational', 'major_outage')).toBe(true);
  });

  it('degraded_performance after an outage is NOT a recovery (v3 false-positive)', () => {
    expect(shared.isRecoveryStatus('degraded_performance', 'major_outage')).toBe(false);
    expect(shared.isRecoveryStatus('degraded_performance', 'partial_outage')).toBe(false);
  });

  it('maintenance → operational is not announced as recovery', () => {
    expect(shared.isRecoveryStatus('operational', 'under_maintenance')).toBe(false);
  });

  it('operational → operational is not a recovery', () => {
    expect(shared.isRecoveryStatus('operational', 'operational')).toBe(false);
  });
});

// ── nextNotifyState (flap guard) ─────────────────────────

describe('nextNotifyState', () => {
  const N = 2;

  it('first observation only sets the baseline', () => {
    expect(shared.nextNotifyState(null, null, 'partial_outage', N))
      .toEqual({ baseline: 'partial_outage', pending: null, notify: null });
  });

  it('unchanged status clears any pending change', () => {
    const r = shared.nextNotifyState('operational', { status: 'major_outage', count: 1 }, 'operational', N);
    expect(r).toEqual({ baseline: 'operational', pending: null, notify: null });
  });

  it('a single-poll blip never notifies', () => {
    let r = shared.nextNotifyState('operational', null, 'degraded_performance', N);
    expect(r.notify).toBeNull();
    expect(r.pending).toEqual({ status: 'degraded_performance', count: 1 });
    r = shared.nextNotifyState(r.baseline, r.pending, 'operational', N);
    expect(r).toEqual({ baseline: 'operational', pending: null, notify: null });
  });

  it('a change confirmed on consecutive polls notifies once', () => {
    let r = shared.nextNotifyState('operational', null, 'partial_outage', N);
    r = shared.nextNotifyState(r.baseline, r.pending, 'partial_outage', N);
    expect(r).toEqual({ baseline: 'partial_outage', pending: null, notify: 'worse' });
    r = shared.nextNotifyState(r.baseline, r.pending, 'partial_outage', N);
    expect(r.notify).toBeNull();
  });

  it('flapping every poll stays silent', () => {
    let r = { baseline: 'operational', pending: null };
    for (let i = 0; i < 10; i++) {
      r = shared.nextNotifyState(r.baseline, r.pending, i % 2 ? 'operational' : 'degraded_performance', N);
      expect(r.notify).toBeNull();
    }
  });

  it('a different pending status restarts the count', () => {
    let r = shared.nextNotifyState('operational', null, 'degraded_performance', N);
    r = shared.nextNotifyState(r.baseline, r.pending, 'major_outage', N);
    expect(r.notify).toBeNull();
    expect(r.pending).toEqual({ status: 'major_outage', count: 1 });
  });

  it('confirmed recovery notifies as recovery', () => {
    let r = shared.nextNotifyState('major_outage', null, 'operational', N);
    r = shared.nextNotifyState(r.baseline, r.pending, 'operational', N);
    expect(r.notify).toBe('recovery');
  });

  it('confirmed improvement short of operational moves the baseline silently', () => {
    let r = shared.nextNotifyState('major_outage', null, 'degraded_performance', N);
    r = shared.nextNotifyState(r.baseline, r.pending, 'degraded_performance', N);
    expect(r).toEqual({ baseline: 'degraded_performance', pending: null, notify: null });
  });

  it('confirmPolls of 1 notifies immediately', () => {
    expect(shared.nextNotifyState('operational', null, 'major_outage', 1).notify).toBe('worse');
  });
});

// ── buildNotificationMessage ──────────────────────────────

describe('buildNotificationMessage', () => {
  it('recovery message in both languages', () => {
    expect(shared.buildNotificationMessage('recovery', 'operational', [], 'de')).toBe(shared.UI_LABELS.de.notify.recovered);
    expect(shared.buildNotificationMessage('recovery', 'operational', [], 'en')).toBe(shared.UI_LABELS.en.notify.recovered);
  });

  it('names the first active incident', () => {
    const msg = shared.buildNotificationMessage('worse', 'partial_outage', [{ name: 'API errors' }], 'en');
    expect(msg).toBe('Active incident: API errors');
  });

  it('falls back to the localized status label', () => {
    expect(shared.buildNotificationMessage('worse', 'partial_outage', [], 'de')).toBe('Dienststatus: Teilausfall');
  });
});

// ── detectLang ────────────────────────────────────────────

describe('detectLang', () => {
  it('maps any German locale to de, everything else to en', () => {
    expect(shared.detectLang('de-AT')).toBe('de');
    expect(shared.detectLang('DE')).toBe('de');
    expect(shared.detectLang('en-US')).toBe('en');
    expect(shared.detectLang('fr')).toBe('en');
    expect(shared.detectLang(undefined)).toBe('en');
  });
});

// ── Impact mapping ────────────────────────────────────────

describe('getImpactStatus / worseStatus', () => {
  it('maps incident impact through the same enum as the indicator', () => {
    expect(shared.getImpactStatus('minor')).toBe('degraded_performance');
    expect(shared.getImpactStatus('major')).toBe('partial_outage');
    expect(shared.getImpactStatus('critical')).toBe('major_outage');
    expect(shared.getImpactStatus('maintenance')).toBe('under_maintenance');
    expect(shared.getImpactStatus('none')).toBe('operational');
    expect(shared.getImpactStatus(undefined)).toBe('operational');
  });

  it('worseStatus picks the higher priority', () => {
    expect(shared.worseStatus('operational', 'partial_outage')).toBe('partial_outage');
    expect(shared.worseStatus('major_outage', 'degraded_performance')).toBe('major_outage');
  });
});

// ── getRecentResolvedIncidents ────────────────────────────

describe('getRecentResolvedIncidents', () => {
  const NOW = Date.parse('2026-06-10T12:00:00Z');
  const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();

  it('includes postmortem incidents (resolved_at set, status postmortem)', () => {
    const list = [{ name: 'Big outage', status: 'postmortem', resolved_at: hoursAgo(5) }];
    expect(shared.getRecentResolvedIncidents(list, NOW, 7, 5)).toHaveLength(1);
  });

  it('skips unresolved and out-of-window incidents', () => {
    const list = [
      { name: 'ongoing', status: 'investigating', resolved_at: null },
      { name: 'old', status: 'resolved', resolved_at: hoursAgo(24 * 8) },
      { name: 'recent', status: 'resolved', resolved_at: hoursAgo(1) },
    ];
    expect(shared.getRecentResolvedIncidents(list, NOW, 7, 5).map((i) => i.name)).toEqual(['recent']);
  });

  it('sorts newest first and respects the limit', () => {
    const list = [3, 1, 2].map((h) => ({ name: `h${h}`, status: 'resolved', resolved_at: hoursAgo(h) }));
    expect(shared.getRecentResolvedIncidents(list, NOW, 7, 2).map((i) => i.name)).toEqual(['h1', 'h2']);
  });

  it('handles undefined input', () => {
    expect(shared.getRecentResolvedIncidents(undefined, NOW, 7, 5)).toEqual([]);
  });
});

// ── getDailyStatuses ──────────────────────────────────────

describe('getDailyStatuses', () => {
  // Local noon, so the test holds in any timezone
  const NOW = new Date(2026, 5, 10, 12, 0, 0).getTime();
  const localDay = (d, h) => new Date(2026, 5, d, h, 0, 0).toISOString();

  it('returns one entry per day, oldest first, ending today', () => {
    const days = shared.getDailyStatuses([], 'operational', NOW, 7);
    expect(days).toHaveLength(7);
    expect(days[6].isToday).toBe(true);
    expect(new Date(days[6].dayStart).getDate()).toBe(10);
    expect(new Date(days[0].dayStart).getDate()).toBe(4);
    expect(days.every((d) => d.status === 'operational')).toBe(true);
  });

  it('colors minor incidents like the header dot (degraded, not partial)', () => {
    const inc = [{ impact: 'minor', started_at: localDay(8, 9), resolved_at: localDay(8, 10) }];
    const days = shared.getDailyStatuses(inc, 'operational', NOW, 7);
    expect(days[4].status).toBe('degraded_performance');
    expect(days[3].status).toBe('operational');
    expect(days[5].status).toBe('operational');
  });

  it('spans multi-day incidents and takes the worst per day', () => {
    const inc = [
      { impact: 'major', started_at: localDay(7, 22), resolved_at: localDay(8, 2) },
      { impact: 'critical', started_at: localDay(8, 5), resolved_at: localDay(8, 6) },
    ];
    const days = shared.getDailyStatuses(inc, 'operational', NOW, 7);
    expect(days[3].status).toBe('partial_outage');
    expect(days[4].status).toBe('major_outage');
  });

  it('treats unresolved incidents as ongoing until now', () => {
    const inc = [{ impact: 'minor', started_at: localDay(9, 20), resolved_at: null }];
    const days = shared.getDailyStatuses(inc, 'operational', NOW, 7);
    expect(days[5].status).toBe('degraded_performance');
    expect(days[6].status).toBe('degraded_performance');
  });

  it('folds the live status into today only', () => {
    const days = shared.getDailyStatuses([], 'partial_outage', NOW, 7);
    expect(days[6].status).toBe('partial_outage');
    expect(days[5].status).toBe('operational');
  });

  it('falls back to created_at when started_at is missing', () => {
    const inc = [{ impact: 'minor', created_at: localDay(10, 8), resolved_at: localDay(10, 9) }];
    expect(shared.getDailyStatuses(inc, 'operational', NOW, 7)[6].status).toBe('degraded_performance');
  });
});

// ── getBadgeState ─────────────────────────────────────────

describe('getBadgeState', () => {
  const op = [{ name: 'API', status: 'operational' }];

  it('is empty when everything is operational', () => {
    expect(shared.getBadgeState({ components: op, incidents: [], indicator: 'none' }).text).toBe('');
  });

  it('marks a degraded component even without an incident', () => {
    const b = shared.getBadgeState({
      components: [{ name: 'API', status: 'degraded_performance' }], incidents: [], indicator: 'none',
    });
    expect(b.text).toBe('•');
    expect(b.status).toBe('degraded_performance');
    expect(b.color).toBe(shared.BADGE_COLORS.degraded_performance);
  });

  it('shows the incident count, colored by overall status', () => {
    const b = shared.getBadgeState({ components: op, incidents: [{}, {}], indicator: 'critical' });
    expect(b.text).toBe('2');
    expect(b.color).toBe(shared.BADGE_COLORS.major_outage);
  });

  it('has a color for every status', () => {
    for (const status of Object.keys(shared.STATUS_PRIORITY)) {
      expect(shared.BADGE_COLORS[status]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

// ── buildStatusPayload ────────────────────────────────────

describe('buildStatusPayload', () => {
  it('extracts components, incidents, maintenances, indicator and fetchedAt', () => {
    const summary = {
      components: [{ name: 'API', status: 'operational' }],
      incidents: [{ name: 'I1' }],
      scheduled_maintenances: [{ name: 'M1' }],
      status: { indicator: 'minor', description: 'Minor issues' },
    };
    const payload = shared.buildStatusPayload(summary, 1234567890);
    expect(payload.components).toHaveLength(1);
    expect(payload.incidents).toHaveLength(1);
    expect(payload.scheduled_maintenances).toHaveLength(1);
    expect(payload.indicator).toBe('minor');
    expect(payload.fetchedAt).toBe(1234567890);
  });

  it('defaults missing fields safely', () => {
    const payload = shared.buildStatusPayload({}, 0);
    expect(payload.components).toEqual([]);
    expect(payload.incidents).toEqual([]);
    expect(payload.scheduled_maintenances).toEqual([]);
    expect(payload.indicator).toBe('none');
  });
});

// ── validateSummary / validateIncidents ───────────────────

describe('validators', () => {
  it('validateSummary requires a components array', () => {
    expect(shared.validateSummary({ components: [] })).toBe(true);
    expect(shared.validateSummary({ components: 'nope' })).toBe(false);
    expect(shared.validateSummary({})).toBe(false);
    expect(shared.validateSummary(null)).toBe(false);
  });

  it('validateIncidents requires an incidents array', () => {
    expect(shared.validateIncidents({ incidents: [] })).toBe(true);
    expect(shared.validateIncidents({ incidents: {} })).toBe(false);
    expect(shared.validateIncidents(null)).toBe(false);
  });
});

// ── classifyFetchError ────────────────────────────────────

describe('classifyFetchError', () => {
  it('AbortError → TIMEOUT', () => {
    expect(shared.classifyFetchError({ name: 'AbortError' }, null, true)).toBe('TIMEOUT');
  });

  it('offline → OFFLINE', () => {
    expect(shared.classifyFetchError({ name: 'TypeError' }, null, false)).toBe('OFFLINE');
  });

  it('HTTP status codes → HTTP_4XX / HTTP_5XX', () => {
    expect(shared.classifyFetchError(null, 404, true)).toBe('HTTP_4XX');
    expect(shared.classifyFetchError(null, 429, true)).toBe('HTTP_4XX');
    expect(shared.classifyFetchError(null, 500, true)).toBe('HTTP_5XX');
    expect(shared.classifyFetchError(null, 503, true)).toBe('HTTP_5XX');
  });

  it('TypeError / fetch message → NETWORK', () => {
    expect(shared.classifyFetchError({ name: 'TypeError' }, null, true)).toBe('NETWORK');
    expect(shared.classifyFetchError({ message: 'failed to fetch' }, null, true)).toBe('NETWORK');
  });

  it('SyntaxError → PARSE', () => {
    expect(shared.classifyFetchError({ name: 'SyntaxError' }, null, true)).toBe('PARSE');
  });

  it('anything else → UNKNOWN', () => {
    expect(shared.classifyFetchError({ name: 'WeirdError' }, null, true)).toBe('UNKNOWN');
    expect(shared.classifyFetchError(null, null, true)).toBe('UNKNOWN');
  });
});

// ── formatLastChecked ─────────────────────────────────────

describe('formatLastChecked', () => {
  const T0 = new Date('2026-06-10T12:00:00Z').getTime();

  it('fresh data: time only, not stale', () => {
    const { text, stale } = shared.formatLastChecked(T0, 'en', T0 + 30000);
    expect(text).toMatch(/^Updated /);
    expect(text).not.toContain('ago');
    expect(stale).toBe(false);
  });

  it('adds relative age from 2 minutes', () => {
    const { text, stale } = shared.formatLastChecked(T0, 'en', T0 + 3 * 60000);
    expect(text).toContain('3 min ago');
    expect(stale).toBe(false);
  });

  it('flags stale after STALE_AFTER_MS', () => {
    const { text, stale } = shared.formatLastChecked(T0, 'en', T0 + shared.CSM_CONFIG.STALE_AFTER_MS + 60000);
    expect(stale).toBe(true);
    expect(text).toContain('ago');
  });

  it('switches to hours after 60 minutes', () => {
    const { text } = shared.formatLastChecked(T0, 'en', T0 + 90 * 60000);
    expect(text).toContain('1h ago');
  });

  it('produces German strings for de', () => {
    const fresh = shared.formatLastChecked(T0, 'de', T0);
    expect(fresh.text).toMatch(/^Stand: .* Uhr$/);
    const aged = shared.formatLastChecked(T0, 'de', T0 + 5 * 60000);
    expect(aged.text).toContain('vor 5 Min.');
  });

  it('never reports negative age', () => {
    const { text, stale } = shared.formatLastChecked(T0 + 60000, 'en', T0);
    expect(stale).toBe(false);
    expect(text).not.toContain('ago');
  });
});

// ── ERROR_CODES ───────────────────────────────────────────

describe('ERROR_CODES', () => {
  it('has all seven error codes', () => {
    const expected = ['TIMEOUT', 'NETWORK', 'OFFLINE', 'HTTP_4XX', 'HTTP_5XX', 'PARSE', 'UNKNOWN'];
    for (const code of expected) {
      expect(shared.ERROR_CODES).toHaveProperty(code);
      expect(shared.ERROR_CODES[code]).toBe(code);
    }
  });
});

// ── ERROR_LABELS ──────────────────────────────────────────

describe('ERROR_LABELS', () => {
  it('has labels for both languages', () => {
    expect(shared.ERROR_LABELS).toHaveProperty('de');
    expect(shared.ERROR_LABELS).toHaveProperty('en');
  });

  it('every error code has a label in both languages', () => {
    for (const code of Object.values(shared.ERROR_CODES)) {
      expect(shared.ERROR_LABELS.de[code]).toBeDefined();
      expect(shared.ERROR_LABELS.en[code]).toBeDefined();
      expect(typeof shared.ERROR_LABELS.de[code]).toBe('string');
      expect(typeof shared.ERROR_LABELS.en[code]).toBe('string');
    }
  });
});

// ── SHARED_STATUS_LABELS ──────────────────────────────────

describe('SHARED_STATUS_LABELS', () => {
  it('has both language sets', () => {
    expect(shared.SHARED_STATUS_LABELS).toHaveProperty('de');
    expect(shared.SHARED_STATUS_LABELS).toHaveProperty('en');
  });

  it('covers all STATUS_COLOR keys', () => {
    for (const status of Object.keys(shared.STATUS_COLOR)) {
      expect(shared.SHARED_STATUS_LABELS.de[status]).toBeDefined();
      expect(shared.SHARED_STATUS_LABELS.en[status]).toBeDefined();
    }
  });
});

// ── UI_LABELS parity ──────────────────────────────────────
// Recursive DE/EN comparison: identical key sets, identical leaf types.
// Catches forgotten translations whenever a new string is added.

describe('UI_LABELS', () => {
  function compareShapes(a, b, path) {
    expect(Object.keys(a).sort(), `keys mismatch at ${path}`).toEqual(Object.keys(b).sort());
    for (const key of Object.keys(a)) {
      const va = a[key];
      const vb = b[key];
      const p = `${path}.${key}`;
      expect(typeof va, `type mismatch at ${p}`).toBe(typeof vb);
      if (Array.isArray(va)) {
        expect(Array.isArray(vb), `array mismatch at ${p}`).toBe(true);
        expect(va.length, `array length mismatch at ${p}`).toBe(vb.length);
      } else if (va && typeof va === 'object') {
        compareShapes(va, vb, p);
      }
    }
  }

  it('de and en have identical structure', () => {
    compareShapes(shared.UI_LABELS.de, shared.UI_LABELS.en, 'UI_LABELS');
  });

  it('has widget, popup, settings and impact sections', () => {
    for (const lang of ['de', 'en']) {
      expect(shared.UI_LABELS[lang]).toHaveProperty('widget');
      expect(shared.UI_LABELS[lang]).toHaveProperty('popup');
      expect(shared.UI_LABELS[lang]).toHaveProperty('settings');
      expect(shared.UI_LABELS[lang]).toHaveProperty('impact');
    }
  });

  it('settings intervals cover all popup interval options', () => {
    for (const lang of ['de', 'en']) {
      const intervals = shared.UI_LABELS[lang].settings.intervals;
      for (const v of ['0.5', '1', '2', '5']) {
        expect(intervals[v]).toBeDefined();
      }
    }
  });
});

// ── csmEl ─────────────────────────────────────────────────

describe('csmEl', () => {
  it('creates element with id when prefix is #', () => {
    const el = shared.csmEl('div', '#my-id', 'hello');
    expect(el.id).toBe('my-id');
    expect(el.textContent).toBe('hello');
  });

  it('creates element with className for plain string', () => {
    const el = shared.csmEl('span', 'my-class');
    expect(el.className).toBe('my-class');
  });

  it('creates element without classOrId when null', () => {
    const el = shared.csmEl('p', null, 'text');
    expect(el.textContent).toBe('text');
  });
});

// ── csmIcon ───────────────────────────────────────────────

describe('csmIcon', () => {
  it('builds an svg with paths and currentColor stroke', () => {
    const svg = shared.csmIcon('sun');
    expect(svg.tagName).toBe('SVG');
    expect(svg.attributes.viewBox).toBe('0 0 16 16');
    expect(svg.attributes.stroke).toBe('currentColor');
    expect(svg.attributes['aria-hidden']).toBe('true');
    expect(svg.children.length).toBe(shared.ICON_PATHS.sun.length);
    expect(svg.children[0].attributes.d).toBe(shared.ICON_PATHS.sun[0]);
  });

  it('respects a custom size', () => {
    const svg = shared.csmIcon('moon', 18);
    expect(svg.attributes.width).toBe('18');
    expect(svg.attributes.height).toBe('18');
  });

  it('returns an empty svg for unknown names', () => {
    const svg = shared.csmIcon('does-not-exist');
    expect(svg.children.length).toBe(0);
  });

  it('has paths for every icon used by widget and popup', () => {
    for (const name of ['sun', 'moon', 'chevron', 'external', 'refresh', 'settings', 'back', 'check']) {
      expect(shared.ICON_PATHS[name]?.length).toBeGreaterThan(0);
    }
  });
});
