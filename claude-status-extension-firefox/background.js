'use strict';

const ALARM_NAME = 'claude-status-poll';
const POLL_INTERVAL_MINUTES = 1;

const SUMMARY_ALARM_NAME = 'claude-summary-poll';
const SUMMARY_POLL_INTERVAL_MINUTES = 5;

// Cache last fetched data to send immediately on request
let lastData = null;
let lastSummary = null;
let lastIncidents = null;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_INTERVAL_MINUTES });
  chrome.alarms.create(SUMMARY_ALARM_NAME, { periodInMinutes: SUMMARY_POLL_INTERVAL_MINUTES });
  fetchAndBroadcast();
  fetchAndCacheSummary();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) fetchAndBroadcast();
  if (alarm.name === SUMMARY_ALARM_NAME) fetchAndCacheSummary();
});

// Content script requests current data on load; popup requests summary
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'GET_STATUS') {
    if (lastData) {
      sendResponse({ type: 'STATUS_DATA', payload: lastData });
    } else {
      fetchStatus()
        .then((data) => sendResponse({ type: 'STATUS_DATA', payload: data }))
        .catch(() => sendResponse({ type: 'STATUS_ERROR' }));
      return true; // Keep channel open for async response
    }
  }

  if (message?.type === 'GET_SUMMARY') {
    if (lastSummary && lastIncidents) {
      sendResponse({ summary: lastSummary, incidents: lastIncidents });
    } else {
      fetchAndCacheSummary()
        .then(() => sendResponse({ summary: lastSummary, incidents: lastIncidents }))
        .catch(() => sendResponse(null));
      return true;
    }
  }
});

async function fetchStatus() {
  const response = await fetch('https://status.anthropic.com/api/v2/components.json', {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  lastData = data;
  return data;
}

async function fetchAndBroadcast() {
  try {
    const data = await fetchStatus();
    const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'STATUS_DATA', payload: data }).catch(() => {});
    }
  } catch (err) {
    const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'STATUS_ERROR' }).catch(() => {});
    }
  }
}

async function fetchAndCacheSummary() {
  const [summaryRes, incidentsRes] = await Promise.all([
    fetch('https://status.anthropic.com/api/v2/summary.json', { cache: 'no-store' }),
    fetch('https://status.anthropic.com/api/v2/incidents.json', { cache: 'no-store' }),
  ]);
  if (!summaryRes.ok) throw new Error(`HTTP ${summaryRes.status}`);
  if (!incidentsRes.ok) throw new Error(`HTTP ${incidentsRes.status}`);
  lastSummary = await summaryRes.json();
  lastIncidents = await incidentsRes.json();
}
