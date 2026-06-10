'use strict';

// Load shared.js in Chrome service worker (Firefox loads via manifest "scripts" array)
if (typeof importScripts === 'function') importScripts('shared.js');

const ALARM_NAME = 'claude-status-poll';

// ── State ───────────────────────────────────────────────────
// MV3: Chrome kills the service worker (~30s idle) and Firefox suspends the
// event page between alarms, so nothing mutable may live in module scope.
// All state goes through storage.session (survives respawns, cleared per
// browser session — which doubles as the notification re-baseline) and is
// hydrated lazily by every entry point via getState().

const sessionArea = chrome.storage.session ?? chrome.storage.local;

// state: { lastStatus, consecutiveErrors, payload, incidents, incidentsFetchedAt }
let statePromise = null;

function getState() {
  statePromise ??= loadState();
  return statePromise;
}

async function loadState() {
  const stored = await sessionArea.get(STORAGE_KEYS.BG_STATE);
  const state = stored[STORAGE_KEYS.BG_STATE] ?? {
    lastStatus: null,
    consecutiveErrors: 0,
    payload: null,
    incidents: null,
    incidentsFetchedAt: 0,
  };
  if (!state.payload) {
    // Warm start across browser restarts from the storage.local cache
    const cached = (await chrome.storage.local.get(STORAGE_KEYS.CACHE))[STORAGE_KEYS.CACHE];
    if (cached?.payload?.fetchedAt && Date.now() - cached.payload.fetchedAt < CSM_CONFIG.CACHE_MAX_AGE_MS) {
      state.payload = cached.payload;
    }
  }
  return state;
}

async function persistState(state) {
  await sessionArea.set({ [STORAGE_KEYS.BG_STATE]: state });
}

// ── Lifecycle ───────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'update') {
    // v4 payload shape differs from v3 — drop the old cache, refetch repopulates
    await chrome.storage.local.remove(STORAGE_KEYS.CACHE);
  }
  await setupAlarm();
  fetchSummaryOnce().catch(() => {});
});

chrome.runtime.onStartup.addListener(async () => {
  await setupAlarm();
  fetchSummaryOnce().catch(() => {});
});

async function setupAlarm() {
  const state = await getState();
  const stored = await chrome.storage.local.get(STORAGE_KEYS.INTERVAL);
  let minutes = Number(stored[STORAGE_KEYS.INTERVAL] ?? CSM_CONFIG.DEFAULT_POLL_MINUTES);

  // Exponential backoff: double interval per consecutive error, cap at max
  if (state.consecutiveErrors > 0) {
    minutes = Math.min(minutes * Math.pow(2, state.consecutiveErrors), CSM_CONFIG.MAX_BACKOFF_MINUTES);
  }

  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: minutes });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) fetchSummaryOnce().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && STORAGE_KEYS.INTERVAL in changes) setupAlarm();
});

// ── Offline / Online handling ───────────────────────────────
// Best-effort only: the worker must already be awake to receive these
// events. Real recovery happens through the alarm-driven retries.

self.addEventListener('online', () => {
  getState().then(async (state) => {
    if (state.consecutiveErrors > 0) {
      state.consecutiveErrors = 0;
      await persistState(state);
      await setupAlarm();
    }
    fetchSummaryOnce().catch(() => {});
  });
});

self.addEventListener('offline', () => {
  broadcast({ type: 'STATUS_ERROR', code: ERROR_CODES.OFFLINE });
});

// ── Message handling ────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'GET_STATUS') {
    handleGetStatus().then(sendResponse);
    return true;
  }
  if (message?.type === 'GET_SUMMARY') {
    handleGetSummary().then(sendResponse);
    return true;
  }
  if (message?.type === 'FORCE_FETCH') {
    fetchSummaryOnce()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});

async function handleGetStatus() {
  const state = await getState();
  if (state.payload) {
    // Answer instantly from cache; refresh in the background when stale —
    // the resulting broadcast updates the widget a moment later.
    if (Date.now() - state.payload.fetchedAt > CSM_CONFIG.STALE_AFTER_MS) {
      fetchSummaryOnce().catch(() => {});
    }
    return { type: 'STATUS_DATA', payload: state.payload };
  }
  try {
    const payload = await fetchSummaryOnce();
    return { type: 'STATUS_DATA', payload };
  } catch (err) {
    return { type: 'STATUS_ERROR', code: err.code ?? ERROR_CODES.UNKNOWN };
  }
}

async function handleGetSummary() {
  try {
    const state = await getState();
    const payload = state.payload ?? await fetchSummaryOnce();
    const incidents = await fetchIncidentsOnce();
    return { summary: payload, incidents, incidentsFetchedAt: state.incidentsFetchedAt };
  } catch (err) {
    return { error: true, code: err.code ?? ERROR_CODES.UNKNOWN };
  }
}

// ── Fetch ───────────────────────────────────────────────────

function withCode(err, code) {
  return Object.assign(new Error(err?.message ?? String(err)), { code });
}

async function fetchJson(path) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CSM_CONFIG.FETCH_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${CSM_CONFIG.API_BASE}${path}`, { cache: 'no-store', signal: controller.signal });
  } catch (err) {
    clearTimeout(timeoutId);
    throw withCode(err, classifyFetchError(err, null, navigator.onLine));
  }
  clearTimeout(timeoutId);

  if (!res.ok) {
    throw withCode(new Error(`HTTP ${res.status}`), classifyFetchError(null, res.status, navigator.onLine));
  }

  try {
    return await res.json();
  } catch (err) {
    throw withCode(err, ERROR_CODES.PARSE);
  }
}

// Single-flight: the alarm tick, the GET_STATUS cold path and FORCE_FETCH
// all share one in-flight request instead of fanning out per tab.
let inflightSummary = null;

function fetchSummaryOnce() {
  inflightSummary ??= doFetchSummary().finally(() => { inflightSummary = null; });
  return inflightSummary;
}

async function doFetchSummary() {
  const state = await getState();
  try {
    const json = await fetchJson('/summary.json');
    if (!validateSummary(json)) throw withCode(new Error('Invalid summary: missing components array'), ERROR_CODES.PARSE);

    const payload = buildStatusPayload(json, Date.now());
    state.payload = payload;
    await maybeNotify(state, payload);
    const hadErrors = state.consecutiveErrors > 0;
    state.consecutiveErrors = 0;
    await persistState(state);
    await chrome.storage.local.set({ [STORAGE_KEYS.CACHE]: { payload } });

    broadcast({ type: 'STATUS_DATA', payload });
    updateBadge(payload.incidents);
    if (hadErrors) await setupAlarm();
    return payload;
  } catch (err) {
    state.consecutiveErrors += 1;
    await persistState(state);
    await setupAlarm();

    broadcast({ type: 'STATUS_ERROR', code: err.code ?? ERROR_CODES.UNKNOWN });
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#8a877d' });
    throw err;
  }
}

// incidents.json (full history) is only needed by the popup — fetched on
// demand with a short TTL instead of riding along on every poll.
let inflightIncidents = null;

function fetchIncidentsOnce() {
  inflightIncidents ??= doFetchIncidents().finally(() => { inflightIncidents = null; });
  return inflightIncidents;
}

async function doFetchIncidents() {
  const state = await getState();
  if (state.incidents && Date.now() - state.incidentsFetchedAt < CSM_CONFIG.INCIDENTS_TTL_MS) {
    return state.incidents;
  }
  const json = await fetchJson('/incidents.json');
  if (!validateIncidents(json)) throw withCode(new Error('Invalid incidents: missing incidents array'), ERROR_CODES.PARSE);
  state.incidents = json.incidents;
  state.incidentsFetchedAt = Date.now();
  await persistState(state);
  return state.incidents;
}

// ── Broadcast ───────────────────────────────────────────────

async function broadcast(message) {
  const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  }
}

// ── Badge ───────────────────────────────────────────────────

function updateBadge(activeIncidents) {
  if (!activeIncidents.length) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  const hasMajor = activeIncidents.some((i) => i.impact === 'major' || i.impact === 'critical');
  chrome.action.setBadgeText({ text: String(activeIncidents.length) });
  chrome.action.setBadgeBackgroundColor({ color: hasMajor ? '#e05252' : '#e07a4f' });
}

// ── Notifications ───────────────────────────────────────────
// Compares status strings end to end (never colors) via shared helpers.
// The null baseline happens exactly once per browser session because
// storage.session starts empty exactly once.

async function maybeNotify(state, payload) {
  const newStatus = getOverallStatus(payload.components, payload.indicator);
  const prev = state.lastStatus;
  state.lastStatus = newStatus;
  if (prev == null) return;

  const worsened = isWorseStatus(newStatus, prev);
  const recovered = isRecoveryStatus(newStatus, prev);
  if (!worsened && !recovered) return;

  const stored = await chrome.storage.local.get([STORAGE_KEYS.NOTIFY, STORAGE_KEYS.LANG]);
  if (!stored[STORAGE_KEYS.NOTIFY]) return;

  const lang = stored[STORAGE_KEYS.LANG]
    ?? ((navigator.language || 'en').toLowerCase().startsWith('de') ? 'de' : 'en');
  let msg;

  if (recovered) {
    msg = lang === 'de'
      ? 'Alle Dienste wieder operational.'
      : 'All services back to operational.';
  } else {
    const incident = payload.incidents[0];
    msg = incident
      ? (lang === 'de' ? `Aktiver Vorfall: ${incident.name}` : `Active incident: ${incident.name}`)
      : (lang === 'de'
          ? `Dienststatus: ${SHARED_STATUS_LABELS.de[newStatus] ?? newStatus}`
          : `Service status: ${SHARED_STATUS_LABELS.en[newStatus] ?? newStatus}`);
  }

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon-48.png',
    title: 'Claude Status',
    message: msg,
  });
}
