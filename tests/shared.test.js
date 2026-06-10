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
    'INDICATOR_STATUS, getOverallStatus, getOverallColor, isWorseStatus, ' +
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
    const keys = ['LANG', 'THEME', 'EXPANDED', 'NOTIFY', 'INTERVAL', 'CACHE', 'BG_STATE', 'WIDGET_VISIBLE'];
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

// ── getOverallColor ───────────────────────────────────────

describe('getOverallColor', () => {
  it('returns green for all-operational components', () => {
    const comps = [
      { name: 'API', status: 'operational' },
      { name: 'Web', status: 'operational' },
    ];
    expect(shared.getOverallColor(comps)).toBe('green');
  });

  it('returns the worst status color', () => {
    const comps = [
      { name: 'API', status: 'operational' },
      { name: 'Web', status: 'partial_outage' },
    ];
    expect(shared.getOverallColor(comps)).toBe('orange');
  });

  it('skips group-header components', () => {
    const comps = [
      { name: 'Group', status: 'major_outage', group: true },
      { name: 'API', status: 'operational' },
    ];
    expect(shared.getOverallColor(comps)).toBe('green');
  });

  it('returns green for empty array', () => {
    expect(shared.getOverallColor([])).toBe('green');
  });

  it('returns yellow for degraded_performance', () => {
    const comps = [
      { name: 'API', status: 'degraded_performance' },
      { name: 'Web', status: 'operational' },
    ];
    expect(shared.getOverallColor(comps)).toBe('yellow');
  });

  it('major_outage overrides everything', () => {
    const comps = [
      { name: 'API', status: 'degraded_performance' },
      { name: 'Web', status: 'partial_outage' },
      { name: 'DB', status: 'major_outage' },
    ];
    expect(shared.getOverallColor(comps)).toBe('red');
  });

  it('handles unknown status gracefully', () => {
    const comps = [{ name: 'X', status: 'some_new_status' }];
    const result = shared.getOverallColor(comps);
    expect(typeof result).toBe('string');
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
