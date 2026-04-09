'use strict';

// Load shared.js in Chrome service worker (Firefox loads via manifest "scripts" array)
if (typeof importScripts === 'function') importScripts('shared.js');

// ── State ───────────────────────────────────────────────────

const ALARM_NAME = 'claude-status-poll';

let lastSummary   = null;
let lastIncidents = null;
let lastOverallStatus = null;
let isFetching = false;
let consecutiveErrors = 0;

// ── Startup ─────────────────────────────────────────────────

async function restoreCache() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.CACHE]);
  const cache = stored[STORAGE_KEYS.CACHE];
  if (cache?.timestamp && (Date.now() - cache.timestamp) < CSM_CONFIG.CACHE_MAX_AGE_MS) {
    lastSummary = cache.summary ?? null;
    lastIncidents = cache.incidents ?? null;
  }
}

async function persistCache() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.CACHE]: {
      summary: lastSummary,
      incidents: lastIncidents,
      timestamp: Date.now(),
    },
  });
}

chrome.runtime.onInstalled.addListener(() => {
  setupAlarm();
  fetchAndBroadcast();
});

chrome.runtime.onStartup.addListener(async () => {
  await restoreCache();
  setupAlarm();
  fetchAndBroadcast();
});

async function setupAlarm() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.INTERVAL]);
  let minutes = Number(stored[STORAGE_KEYS.INTERVAL] ?? CSM_CONFIG.DEFAULT_POLL_MINUTES);

  // Exponential backoff: double interval per consecutive error, cap at max
  if (consecutiveErrors > 0) {
    minutes = Math.min(minutes * Math.pow(2, consecutiveErrors), CSM_CONFIG.MAX_BACKOFF_MINUTES);
  }

  await chrome.alarms.clearAll();
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: minutes });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) fetchAndBroadcast();
});

chrome.storage.onChanged.addListener((changes) => {
  if (STORAGE_KEYS.INTERVAL in changes) setupAlarm();
});

// ── Offline / Online handling ───────────────────────────────

self.addEventListener('online', () => {
  consecutiveErrors = 0;
  setupAlarm();
  fetchAndBroadcast();
});

self.addEventListener('offline', () => {
  chrome.tabs.query({ url: 'https://claude.ai/*' }).then(tabs => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'STATUS_ERROR', code: 'OFFLINE' }).catch(() => {});
    }
  });
});

// ── Message handling ────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'GET_STATUS') {
    if (lastSummary) {
      sendResponse({ type: 'STATUS_DATA', payload: lastSummary });
      return false;
    }
    fetchAll()
      .then(() => sendResponse({ type: 'STATUS_DATA', payload: lastSummary }))
      .catch((err) => sendResponse({ type: 'STATUS_ERROR', code: err.code ?? 'UNKNOWN' }));
    return true;
  }

  if (message?.type === 'GET_SUMMARY') {
    if (lastSummary && lastIncidents) {
      sendResponse({ summary: lastSummary, incidents: lastIncidents });
      return false;
    }
    fetchAll()
      .then(() => sendResponse({ summary: lastSummary, incidents: lastIncidents }))
      .catch((err) => sendResponse({ error: true, code: err.code ?? 'UNKNOWN' }));
    return true;
  }

  if (message?.type === 'FORCE_FETCH') {
    fetchAndBroadcast().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
});

// ── Fetch ───────────────────────────────────────────────────

function classifyFetchError(err, summaryRes, incidentsRes) {
  if (err?.name === 'AbortError') return 'TIMEOUT';
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'OFFLINE';

  const status = summaryRes?.status ?? incidentsRes?.status;
  if (status >= 400 && status < 500) return 'HTTP_4XX';
  if (status >= 500)                 return 'HTTP_5XX';

  if (err?.name === 'TypeError' || err?.message?.includes('fetch')) return 'NETWORK';
  if (err?.name === 'SyntaxError') return 'PARSE';

  return 'UNKNOWN';
}

async function fetchAll() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CSM_CONFIG.FETCH_TIMEOUT_MS);

  let summaryRes, incidentsRes;
  try {
    [summaryRes, incidentsRes] = await Promise.all([
      fetch(`${CSM_CONFIG.API_BASE}/summary.json`,   { cache: 'no-store', signal: controller.signal }),
      fetch(`${CSM_CONFIG.API_BASE}/incidents.json`, { cache: 'no-store', signal: controller.signal }),
    ]);
  } catch (err) {
    clearTimeout(timeoutId);
    const code = classifyFetchError(err, null, null);
    throw Object.assign(new Error(err.message), { code });
  }

  clearTimeout(timeoutId);

  if (!summaryRes.ok || !incidentsRes.ok) {
    const code = classifyFetchError(null, summaryRes, incidentsRes);
    const status = !summaryRes.ok ? summaryRes.status : incidentsRes.status;
    throw Object.assign(new Error(`HTTP ${status}`), { code });
  }

  let summaryJson, incidentsJson;
  try {
    summaryJson   = await summaryRes.json();
    incidentsJson = await incidentsRes.json();
  } catch (_err) {
    throw Object.assign(new Error('JSON parse failed'), { code: 'PARSE' });
  }

  if (!summaryJson || !Array.isArray(summaryJson.components)) {
    throw Object.assign(new Error('Invalid summary: missing components array'), { code: 'PARSE' });
  }

  lastSummary   = summaryJson;
  lastIncidents = incidentsJson;
}

async function fetchAndBroadcast() {
  if (isFetching) return;
  isFetching = true;

  try {
    await fetchAll();
    await persistCache();

    const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'STATUS_DATA', payload: lastSummary }).catch(() => {});
    }

    updateBadge(lastSummary?.incidents ?? []);
    maybeNotify(lastSummary?.components ?? [], lastSummary?.incidents ?? []);

    if (consecutiveErrors > 0) {
      consecutiveErrors = 0;
      setupAlarm();
    }

  } catch (err) {
    consecutiveErrors++;
    setupAlarm();

    const code = err.code ?? 'UNKNOWN';
    const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'STATUS_ERROR', code }).catch(() => {});
    }
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
  } finally {
    isFetching = false;
  }
}

// ── Badge ───────────────────────────────────────────────────

function updateBadge(activeIncidents) {
  if (!activeIncidents.length) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  const hasMajor = activeIncidents.some(i => i.impact === 'major');
  chrome.action.setBadgeText({ text: String(activeIncidents.length) });
  chrome.action.setBadgeBackgroundColor({ color: hasMajor ? '#ef4444' : '#f97316' });
}

// ── Notifications ───────────────────────────────────────────

async function maybeNotify(components, activeIncidents) {
  const newStatus = activeIncidents.length > 0
    ? (activeIncidents.some(i => i.impact === 'major') ? 'major' : 'degraded')
    : getOverallColor(components);

  if (lastOverallStatus === null) {
    lastOverallStatus = newStatus;
    return;
  }

  const worsened  = isWorse(newStatus, lastOverallStatus);
  const recovered = isRecovery(newStatus, lastOverallStatus);
  lastOverallStatus = newStatus;
  if (!worsened && !recovered) return;

  const stored = await chrome.storage.local.get([STORAGE_KEYS.NOTIFY, STORAGE_KEYS.LANG]);
  if (!stored[STORAGE_KEYS.NOTIFY]) return;

  const lang = stored[STORAGE_KEYS.LANG] ?? 'de';
  let msg;

  if (recovered) {
    msg = lang === 'de'
      ? 'Alle Dienste wieder operational.'
      : 'All services back to operational.';
  } else {
    msg = activeIncidents.length
      ? (lang === 'de'
          ? `Aktiver Vorfall: ${activeIncidents[0].name}`
          : `Active incident: ${activeIncidents[0].name}`)
      : (lang === 'de' ? 'Dienststatus hat sich verschlechtert.' : 'Service status has degraded.');
  }

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon-48.png',
    title: 'Claude Status',
    message: msg,
  });
}

function isWorse(newStatus, oldStatus) {
  const rank = { green: 0, operational: 0, gray: 1, degraded: 2, orange: 2, major: 3, red: 3 };
  return (rank[newStatus] ?? 0) > (rank[oldStatus] ?? 0);
}

function isRecovery(newStatus, oldStatus) {
  const rank = { green: 0, operational: 0, gray: 1, degraded: 2, orange: 2, major: 3, red: 3 };
  return (rank[newStatus] ?? 0) === 0 && (rank[oldStatus] ?? 0) >= 2;
}
