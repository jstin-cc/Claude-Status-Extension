'use strict';

// STATUS_COLOR/PRIORITY not loaded in background — inline only what's needed
function _getOverallColor(components) {
  const priority = { major_outage: 4, partial_outage: 3, degraded_performance: 2, under_maintenance: 1, operational: 0 };
  const color    = { major_outage: 'red', partial_outage: 'orange', degraded_performance: 'orange', under_maintenance: 'gray', operational: 'green' };
  let max = -1; let worst = 'operational';
  for (const c of components) {
    if (c.group) continue;
    const p = priority[c.status] ?? 0;
    if (p > max) { max = p; worst = c.status; }
  }
  return color[worst] ?? 'gray';
}

const ALARM_NAME = 'claude-status-poll';
const DEFAULT_POLL_MINUTES = 1;

let lastSummary   = null;
let lastIncidents = null;
let lastOverallStatus = null;

// ── Startup ──────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  setupAlarm();
  fetchAndBroadcast();
});

chrome.runtime.onStartup.addListener(() => {
  setupAlarm();
});

async function setupAlarm() {
  const stored = await chrome.storage.local.get(['csm-poll-interval']);
  const minutes = Number(stored['csm-poll-interval'] ?? DEFAULT_POLL_MINUTES);
  await chrome.alarms.clearAll();
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: minutes });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) fetchAndBroadcast();
});

chrome.storage.onChanged.addListener((changes) => {
  if ('csm-poll-interval' in changes) setupAlarm();
});

// ── Message handling ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'GET_STATUS') {
    if (lastSummary) {
      sendResponse({ type: 'STATUS_DATA', payload: lastSummary });
    } else {
      fetchAll()
        .then(() => sendResponse({ type: 'STATUS_DATA', payload: lastSummary }))
        .catch(() => sendResponse({ type: 'STATUS_ERROR' }));
      return true;
    }
  }

  if (message?.type === 'GET_SUMMARY') {
    if (lastSummary && lastIncidents) {
      sendResponse({ summary: lastSummary, incidents: lastIncidents });
    } else {
      fetchAll()
        .then(() => sendResponse({ summary: lastSummary, incidents: lastIncidents }))
        .catch(() => sendResponse(null));
      return true;
    }
  }
});

// ── Fetch ────────────────────────────────────────────────────

async function fetchAll() {
  const [summaryRes, incidentsRes] = await Promise.all([
    fetch('https://status.anthropic.com/api/v2/summary.json',   { cache: 'no-store' }),
    fetch('https://status.anthropic.com/api/v2/incidents.json', { cache: 'no-store' }),
  ]);
  if (!summaryRes.ok)   throw new Error(`HTTP ${summaryRes.status}`);
  if (!incidentsRes.ok) throw new Error(`HTTP ${incidentsRes.status}`);
  lastSummary   = await summaryRes.json();
  lastIncidents = await incidentsRes.json();
}

async function fetchAndBroadcast() {
  try {
    await fetchAll();

    const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'STATUS_DATA', payload: lastSummary }).catch(() => {});
    }

    updateBadge(lastSummary?.incidents ?? []);
    maybeNotify(lastSummary?.components ?? [], lastSummary?.incidents ?? []);

  } catch {
    const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'STATUS_ERROR' }).catch(() => {});
    }
    chrome.action.setBadgeText({ text: '' });
  }
}

// ── Badge ────────────────────────────────────────────────────

function updateBadge(activeIncidents) {
  if (!activeIncidents.length) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  const hasMajor = activeIncidents.some(i => i.impact === 'major');
  chrome.action.setBadgeText({ text: String(activeIncidents.length) });
  chrome.action.setBadgeBackgroundColor({ color: hasMajor ? '#ef4444' : '#f97316' });
}

// ── Notifications ────────────────────────────────────────────

async function maybeNotify(components, activeIncidents) {
  const newStatus = activeIncidents.length > 0
    ? (activeIncidents.some(i => i.impact === 'major') ? 'major' : 'degraded')
    : _getOverallColor(components);

  if (lastOverallStatus === null) {
    lastOverallStatus = newStatus;
    return;
  }

  const worsened = isWorse(newStatus, lastOverallStatus);
  lastOverallStatus = newStatus;
  if (!worsened) return;

  const stored = await chrome.storage.local.get(['csm-notify', 'csm-lang']);
  if (!stored['csm-notify']) return;

  const lang = stored['csm-lang'] ?? 'de';
  const msg  = activeIncidents.length
    ? (lang === 'de'
        ? `Aktiver Vorfall: ${activeIncidents[0].name}`
        : `Active incident: ${activeIncidents[0].name}`)
    : (lang === 'de' ? 'Dienststatus hat sich verschlechtert.' : 'Service status has degraded.');

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
