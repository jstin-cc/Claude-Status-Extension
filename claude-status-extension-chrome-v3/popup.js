'use strict';

// STATUS_COLOR, STATUS_PRIORITY, getOverallColor, SHARED_STATUS_LABELS,
// ERROR_CODES, ERROR_LABELS, CSM_CONFIG, STORAGE_KEYS, csmEl — from shared.js

const LABELS = {
  de: {
    components: 'Komponenten',
    activeIncidents: 'Aktive Vorfälle',
    scheduledMaint: 'Geplante Wartung',
    recentIncidents: 'Letzte Vorfälle',
    noIncidents: 'Keine aktuellen Vorfälle',
    noMaintenance: 'Keine geplanten Wartungen',
    noHistory: 'Keine aufgelösten Vorfälle in den letzten 7 Tagen',
    uptimeHistory: '7-Tage-Verlauf',
    dayNames: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
    today: 'Heute',
    loading: 'Wird geladen…',
    error: 'Daten nicht verfügbar',
    lastChecked: (t) => `Zuletzt geprüft: ${t} Uhr`,
    impact: { major: 'Kritisch', minor: 'Gering', maintenance: 'Wartung', none: '' },
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
    compStatus: SHARED_STATUS_LABELS.de,
    duration: (mins) => {
      if (mins < 60) return `${mins} Min.`;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m > 0 ? `${h} Std. ${m} Min.` : `${h} Std.`;
    },
    ago: (mins) => {
      if (mins < 2) return 'gerade eben';
      if (mins < 60) return `vor ${mins} Min.`;
      const h = Math.floor(mins / 60);
      return `vor ${h} Std.`;
    },
  },
  en: {
    components: 'Components',
    activeIncidents: 'Active Incidents',
    scheduledMaint: 'Scheduled Maintenance',
    recentIncidents: 'Recent Incidents',
    noIncidents: 'No active incidents',
    noMaintenance: 'No scheduled maintenance',
    noHistory: 'No resolved incidents in the last 7 days',
    uptimeHistory: '7-Day History',
    dayNames: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    today: 'Today',
    loading: 'Loading…',
    error: 'Data unavailable',
    lastChecked: (t) => `Last checked: ${t}`,
    impact: { major: 'Major', minor: 'Minor', maintenance: 'Maintenance', none: '' },
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
    compStatus: SHARED_STATUS_LABELS.en,
    duration: (mins) => {
      if (mins < 60) return `${mins}m`;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m > 0 ? `${h}h ${m}m` : `${h}h`;
    },
    ago: (mins) => {
      if (mins < 2) return 'just now';
      if (mins < 60) return `${mins}m ago`;
      const h = Math.floor(mins / 60);
      return `${h}h ago`;
    },
  },
};

let currentLang  = 'de';
let currentTheme = (window.matchMedia?.('(prefers-color-scheme: light)')?.matches) ? 'light' : 'dark';
let cachedResponse = null;

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.dataset.theme = theme;
  const icon = theme === 'dark' ? '🌙' : '☀️';
  const themeBtn = document.getElementById('p-theme-btn');
  if (themeBtn) themeBtn.textContent = icon;
  const settingBtn = document.getElementById('p-setting-theme-btn');
  if (settingBtn) settingBtn.textContent = icon;
}

// ── Helpers ──────────────────────────────────────────────────

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function minutesAgo(dateStr) {
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000));
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString(
    currentLang === 'de' ? 'de-DE' : 'en-US',
    { day: '2-digit', month: '2-digit', year: 'numeric' }
  );
}

function formatTimeRange(fromStr, toStr) {
  const opts = { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' };
  const locale = currentLang === 'de' ? 'de-DE' : 'en-US';
  return `${new Date(fromStr).toLocaleTimeString(locale, opts)} – ${new Date(toStr).toLocaleTimeString(locale, opts)} UTC`;
}

// getOverallColor — from shared.js

// ── Render functions ─────────────────────────────────────────

function renderUptimeChart(allIncidents, summaryData) {
  const L = LABELS[currentLang];
  const container = document.getElementById('p-uptime-bars');
  container.replaceChildren();

  const COLOR_PRIORITY = { red: 3, orange: 2, gray: 1, green: 0 };

  // Map incident impact → color
  function impactColor(impact) {
    if (impact === 'major') return 'red';
    if (impact === 'minor') return 'orange';
    return 'gray'; // maintenance / none
  }

  const now = new Date();

  for (let daysAgo = 6; daysAgo >= 0; daysAgo--) {
    const day = new Date(now);
    day.setUTCDate(now.getUTCDate() - daysAgo);
    const dayStart = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    const dayEnd   = dayStart + 86400000;

    let color = 'green';

    for (const inc of allIncidents) {
      const incStart = new Date(inc.started_at).getTime();
      const incEnd   = inc.resolved_at ? new Date(inc.resolved_at).getTime() : Date.now();
      if (incStart < dayEnd && incEnd > dayStart) {
        const c = impactColor(inc.impact);
        if ((COLOR_PRIORITY[c] ?? 0) > (COLOR_PRIORITY[color] ?? 0)) color = c;
      }
    }

    // For today also factor in live component status
    if (daysAgo === 0) {
      const compColor = getOverallColor(summaryData.components ?? []);
      if ((COLOR_PRIORITY[compColor] ?? 0) > (COLOR_PRIORITY[color] ?? 0)) color = compColor;
    }

    // Tooltip text
    const dateLabel = new Date(dayStart).toLocaleDateString(
      currentLang === 'de' ? 'de-DE' : 'en-US',
      { day: '2-digit', month: '2-digit', timeZone: 'UTC' }
    );
    const statusLabel = {
      green:  L.compStatus.operational,
      orange: L.compStatus.partial_outage,
      red:    L.compStatus.major_outage,
      gray:   L.compStatus.under_maintenance,
    }[color];

    const wrapper = el('div', 'p-uptime-bar-wrapper');
    const bar     = el('div', `p-uptime-bar p-uptime-${color}`);
    bar.title = `${dateLabel}: ${statusLabel}`;

    const label = el('span', 'p-uptime-label');
    if (daysAgo === 0) {
      label.textContent = L.today;
      label.classList.add('p-uptime-today');
    } else {
      label.textContent = L.dayNames[new Date(dayStart).getUTCDay()];
    }

    wrapper.append(bar, label);
    container.appendChild(wrapper);
  }

  document.getElementById('p-uptime-title').textContent = L.uptimeHistory;
}

function renderComponents(components) {
  const L = LABELS[currentLang];
  const container = document.getElementById('p-components');
  container.replaceChildren();
  const visible = components.filter((c) => !c.group);
  for (const c of visible) {
    const row = el('div', 'p-component-row');
    row.append(
      el('span', `p-dot p-${STATUS_COLOR[c.status] ?? 'gray'}`),
      el('span', 'p-comp-name', c.name),
      el('span', 'p-comp-status', L.compStatus[c.status] ?? c.status)
    );
    container.appendChild(row);
  }
}

function renderActiveIncidents(incidents) {
  const L = LABELS[currentLang];
  const container = document.getElementById('p-active-incidents');
  const countEl = document.getElementById('p-active-count');
  container.replaceChildren();

  countEl.textContent = incidents.length;
  countEl.style.display = incidents.length ? 'inline' : 'none';

  if (!incidents.length) {
    container.appendChild(el('div', 'p-empty', L.noIncidents));
    return;
  }

  for (const inc of incidents) {
    const card = el('div', `p-incident-card p-incident-${inc.impact}`);

    const header = el('div', 'p-incident-header');
    const impactLabel = L.impact[inc.impact];
    header.append(
      el('span', 'p-incident-name', inc.name),
      ...(impactLabel ? [el('span', `p-badge p-impact-${inc.impact}`, impactLabel)] : [])
    );

    const meta = el('div', 'p-incident-meta');
    meta.append(
      el('span', 'p-incident-status', L.incidentStatus[inc.status] ?? inc.status),
      el('span', 'p-incident-time', L.ago(minutesAgo(inc.started_at)))
    );

    card.append(header, meta);

    if (inc.incident_updates?.length) {
      card.appendChild(el('div', 'p-incident-update', inc.incident_updates[0].body));
    }

    container.appendChild(card);
  }
}

function renderScheduledMaintenance(maintenances) {
  const L = LABELS[currentLang];
  const container = document.getElementById('p-maintenance');
  const countEl = document.getElementById('p-maint-count');
  container.replaceChildren();

  const active = maintenances.filter((m) => m.status === 'scheduled' || m.status === 'in_progress');
  countEl.textContent = active.length;
  countEl.style.display = active.length ? 'inline' : 'none';

  if (!active.length) {
    container.appendChild(el('div', 'p-empty', L.noMaintenance));
    return;
  }

  for (const m of active) {
    const card = el('div', 'p-maint-card');

    const header = el('div', 'p-maint-header');
    header.append(
      el('span', 'p-maint-name', m.name),
      el('span', 'p-badge p-maint-status-badge', L.maintStatus[m.status] ?? m.status)
    );

    card.appendChild(header);

    if (m.scheduled_for && m.scheduled_until) {
      const time = el('div', 'p-maint-time');
      time.textContent = `${formatDate(m.scheduled_for)} · ${formatTimeRange(m.scheduled_for, m.scheduled_until)}`;
      card.appendChild(time);
    }

    container.appendChild(card);
  }
}

function renderHistory(allIncidents) {
  const L = LABELS[currentLang];
  const container = document.getElementById('p-history');
  container.replaceChildren();

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = allIncidents
    .filter((i) => i.status === 'resolved' && new Date(i.resolved_at).getTime() > sevenDaysAgo)
    .slice(0, 5);

  if (!recent.length) {
    container.appendChild(el('div', 'p-empty', L.noHistory));
    return;
  }

  for (const inc of recent) {
    const row = el('div', 'p-history-row');

    const durationMins = Math.round(
      (new Date(inc.resolved_at).getTime() - new Date(inc.started_at).getTime()) / 60000
    );

    const meta = el('div', 'p-history-meta');
    meta.append(
      el('span', 'p-history-date', formatDate(inc.resolved_at)),
      el('span', 'p-history-sep', '·'),
      el('span', 'p-history-duration', L.duration(durationMins))
    );

    row.append(
      el('span', 'p-history-check', '✓'),
      el('span', 'p-history-name', inc.name),
      meta
    );
    container.appendChild(row);
  }
}

function renderAll(summaryData, incidentsData) {
  const L = LABELS[currentLang];
  const components = summaryData.components ?? [];
  const activeIncidents = summaryData.incidents ?? [];
  const maintenances = summaryData.scheduled_maintenances ?? [];
  const allIncidents = incidentsData?.incidents ?? [];

  // Header dot: red/orange if active incident, otherwise worst component color
  const overallColor = activeIncidents.length > 0
    ? (activeIncidents.some((i) => i.impact === 'major') ? 'red' : 'orange')
    : getOverallColor(components);
  const pulse = overallColor === 'red' || overallColor === 'orange' || overallColor === 'yellow';
  document.getElementById('p-dot').className = `p-dot p-${overallColor}${pulse ? ' p-pulsing' : ''}`;

  renderComponents(components);
  renderUptimeChart(allIncidents, summaryData);
  renderActiveIncidents(activeIncidents);
  renderScheduledMaintenance(maintenances);
  renderHistory(allIncidents);

  // Section titles (for language switching)
  document.getElementById('p-components-title').textContent = L.components;
  document.getElementById('p-active-title').textContent = L.activeIncidents;
  document.getElementById('p-maint-title').textContent = L.scheduledMaint;
  document.getElementById('p-history-title').textContent = L.recentIncidents;

  const time = new Date().toLocaleTimeString(
    currentLang === 'de' ? 'de-DE' : 'en-US',
    { hour: '2-digit', minute: '2-digit' }
  );
  document.getElementById('p-timestamp').textContent = L.lastChecked(time);
}

function updateLangUI() {
  document.getElementById('p-lang-flag').textContent = currentLang === 'de' ? '🇩🇪' : '🇺🇸';
  document.querySelectorAll('.p-lang-option').forEach((o) =>
    o.classList.toggle('active', o.dataset.lang === currentLang)
  );
}

function getPopupErrorLabel(code) {
  return ERROR_LABELS[currentLang]?.[code] ?? ERROR_LABELS[currentLang]?.UNKNOWN ?? LABELS[currentLang].error;
}

function showPopupError(code) {
  const container = document.getElementById('p-components');
  container.replaceChildren();
  const msg = el('div', 'p-empty', getPopupErrorLabel(code));
  container.appendChild(msg);

  const dot = document.getElementById('p-dot');
  dot.className = 'p-dot p-gray';

  const ts = document.getElementById('p-timestamp');
  ts.textContent = `E:${code}`;
}

function requestAndRender() {
  chrome.runtime.sendMessage({ type: 'GET_SUMMARY' }, (response) => {
    if (chrome.runtime.lastError) {
      showPopupError('NETWORK');
      return;
    }
    if (!response || response.error) {
      showPopupError(response?.code ?? 'UNKNOWN');
      return;
    }
    cachedResponse = response;
    renderAll(response.summary ?? {}, response.incidents ?? {});
  });
}

// ── Init ─────────────────────────────────────────────────────

chrome.storage.local.get([STORAGE_KEYS.LANG, STORAGE_KEYS.THEME], (stored) => {
  if (stored[STORAGE_KEYS.LANG])  currentLang = stored[STORAGE_KEYS.LANG];
  if (stored[STORAGE_KEYS.THEME]) applyTheme(stored[STORAGE_KEYS.THEME]);
  updateLangUI();
  document.getElementById('p-components').appendChild(
    el('div', 'p-empty', LABELS[currentLang].loading)
  );
  requestAndRender();
});

// ── Language switching ────────────────────────────────────────

// ── Refresh button ────────────────────────────────────────────

document.getElementById('p-refresh-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const btn = e.currentTarget;
  btn.style.opacity = '0.5';
  btn.disabled = true;
  chrome.runtime.sendMessage({ type: 'FORCE_FETCH' }, () => {
    requestAndRender();
    btn.style.opacity = '1';
    btn.disabled = false;
  });
});

document.getElementById('p-lang-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('p-lang-menu').classList.toggle('open');
});

document.querySelectorAll('.p-lang-option').forEach((opt) => {
  opt.addEventListener('click', (e) => {
    e.stopPropagation();
    const lang = opt.dataset.lang;
    document.getElementById('p-lang-menu').classList.remove('open');
    if (lang === currentLang) return;
    currentLang = lang;
    chrome.storage.local.set({ [STORAGE_KEYS.LANG]: lang });
    updateLangUI();
    if (cachedResponse) renderAll(cachedResponse.summary ?? {}, cachedResponse.incidents ?? {});
  });
});

document.addEventListener('click', () => {
  document.getElementById('p-lang-menu').classList.remove('open');
});

// ── Theme toggle ──────────────────────────────────────────────

document.getElementById('p-theme-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const next = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  chrome.storage.local.set({ [STORAGE_KEYS.THEME]: next });
});

document.getElementById('p-setting-theme-btn').addEventListener('click', () => {
  const next = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  chrome.storage.local.set({ [STORAGE_KEYS.THEME]: next });
});

// ── Settings view ─────────────────────────────────────────────

const LABELS_SETTINGS = {
  de: {
    title: 'Einstellungen',
    theme: 'Erscheinungsbild',
    themeDesc: 'Dark / Light Mode',
    notify: 'Benachrichtigungen',
    notifyDesc: 'Bei Störung & Erholung',
    lang: 'Sprache',
    interval: 'Aktualisierungsintervall',
    intervalDesc: 'Wie oft Status geprüft wird',
    intervals: { '0.5': '30 Sek.', '1': '1 Min.', '2': '2 Min.', '5': '5 Min.' },
  },
  en: {
    title: 'Settings',
    theme: 'Appearance',
    themeDesc: 'Dark / Light Mode',
    notify: 'Notifications',
    notifyDesc: 'On incident & recovery',
    lang: 'Language',
    interval: 'Refresh interval',
    intervalDesc: 'How often status is checked',
    intervals: { '0.5': '30 sec', '1': '1 min', '2': '2 min', '5': '5 min' },
  },
};

function updateSettingsLabels() {
  const S = LABELS_SETTINGS[currentLang];
  document.getElementById('p-settings-title').textContent = S.title;
  document.getElementById('p-label-theme').textContent    = S.theme;
  document.getElementById('p-desc-theme').textContent     = S.themeDesc;
  document.getElementById('p-label-notify').textContent   = S.notify;
  document.getElementById('p-desc-notify').textContent    = S.notifyDesc;
  document.getElementById('p-label-lang').textContent     = S.lang;
  document.getElementById('p-label-interval').textContent = S.interval;
  document.getElementById('p-desc-interval').textContent  = S.intervalDesc;
  const sel = document.getElementById('p-setting-interval');
  Array.from(sel.options).forEach(opt => {
    opt.textContent = S.intervals[opt.value] ?? opt.value;
  });
}

function openSettings() {
  document.getElementById('p-main-view').classList.add('hidden');
  document.getElementById('p-settings-view').classList.add('active');
  updateSettingsLabels();

  // Load current values
  chrome.storage.local.get([STORAGE_KEYS.THEME, STORAGE_KEYS.NOTIFY, STORAGE_KEYS.LANG, STORAGE_KEYS.INTERVAL], (stored) => {
    document.getElementById('p-setting-theme-btn').textContent = (stored[STORAGE_KEYS.THEME] === 'light') ? '☀️' : '🌙';
    document.getElementById('p-setting-notify').checked   = !!stored[STORAGE_KEYS.NOTIFY];
    document.getElementById('p-setting-lang').value       = stored[STORAGE_KEYS.LANG] ?? 'de';
    document.getElementById('p-setting-interval').value   = String(stored[STORAGE_KEYS.INTERVAL] ?? '1');
  });
}

function closeSettings() {
  document.getElementById('p-settings-view').classList.remove('active');
  document.getElementById('p-main-view').classList.remove('hidden');
}

document.getElementById('p-settings-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  openSettings();
});

document.getElementById('p-settings-back').addEventListener('click', closeSettings);


document.getElementById('p-setting-notify').addEventListener('change', (e) => {
  chrome.storage.local.set({ [STORAGE_KEYS.NOTIFY]: e.target.checked });
});

document.getElementById('p-setting-lang').addEventListener('change', (e) => {
  const lang = e.target.value;
  currentLang = lang;
  chrome.storage.local.set({ [STORAGE_KEYS.LANG]: lang });
  updateLangUI();
  updateSettingsLabels();
  if (cachedResponse) renderAll(cachedResponse.summary ?? {}, cachedResponse.incidents ?? {});
});

document.getElementById('p-setting-interval').addEventListener('change', (e) => {
  const val = Number(e.target.value);
  chrome.storage.local.set({ [STORAGE_KEYS.INTERVAL]: val });
  // background.js listens to storage changes and reconfigures the alarm
});
