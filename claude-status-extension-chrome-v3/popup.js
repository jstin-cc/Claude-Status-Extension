'use strict';

// STATUS_COLOR, STATUS_PRIORITY, getOverallStatus, SHARED_STATUS_LABELS,
// ERROR_CODES, ERROR_LABELS, UI_LABELS, CSM_CONFIG, STORAGE_KEYS,
// formatLastChecked, csmEl, csmIcon — from shared.js

function P() {
  return UI_LABELS[currentLang].popup;
}

let currentLang = (navigator.language || 'en').toLowerCase().startsWith('de') ? 'de' : 'en';
let themeSetting = 'auto'; // 'auto' | 'dark' | 'light'
let cachedResponse = null;

// The popup cannot see claude.ai, so 'auto' falls back to the OS preference
// (the widget itself follows claude.ai's theme — documented asymmetry).
function resolvePopupTheme(setting) {
  if (setting === 'dark' || setting === 'light') return setting;
  return window.matchMedia?.('(prefers-color-scheme: light)')?.matches ? 'light' : 'dark';
}

function applyTheme(setting) {
  themeSetting = setting;
  const resolved = resolvePopupTheme(setting);
  document.documentElement.dataset.theme = resolved;
  document.getElementById('p-theme-btn')
    .replaceChildren(csmIcon(resolved === 'dark' ? 'moon' : 'sun', 14));
  document.getElementById('p-setting-theme').value = setting;
}

// ── Helpers ──────────────────────────────────────────────────

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

// ── Render functions ─────────────────────────────────────────

function renderUptimeChart(allIncidents, summaryData) {
  const L = P();
  const container = document.getElementById('p-uptime-bars');
  container.replaceChildren();
  container.setAttribute('aria-label', L.uptimeAria);

  const COLOR_PRIORITY = { red: 4, orange: 3, yellow: 2, gray: 1, green: 0 };

  // Map incident impact → color
  function impactColor(impact) {
    if (impact === 'critical' || impact === 'major') return 'red';
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
      const compColor = STATUS_COLOR[getOverallStatus(summaryData.components ?? [], summaryData.indicator)] ?? 'gray';
      if ((COLOR_PRIORITY[compColor] ?? 0) > (COLOR_PRIORITY[color] ?? 0)) color = compColor;
    }

    // Tooltip text
    const dateLabel = new Date(dayStart).toLocaleDateString(
      currentLang === 'de' ? 'de-DE' : 'en-US',
      { day: '2-digit', month: '2-digit', timeZone: 'UTC' }
    );
    const S = SHARED_STATUS_LABELS[currentLang];
    const statusLabel = {
      green:  S.operational,
      yellow: S.degraded_performance,
      orange: S.partial_outage,
      red:    S.major_outage,
      gray:   S.under_maintenance,
    }[color] ?? color;

    const wrapper = csmEl('div', 'p-uptime-bar-wrapper');
    const bar     = csmEl('div', `p-uptime-bar p-uptime-${color}`);
    bar.title = `${dateLabel}: ${statusLabel}`;

    const label = csmEl('span', 'p-uptime-label');
    if (daysAgo === 0) {
      label.textContent = L.today;
      label.classList.add('p-uptime-today');
    } else {
      label.textContent = L.dayNames[new Date(dayStart).getUTCDay()];
    }

    wrapper.append(bar, label);
    container.appendChild(wrapper);
  }
}

function renderComponents(components) {
  const container = document.getElementById('p-components');
  container.replaceChildren();
  const visible = components.filter((c) => !c.group);
  for (const c of visible) {
    const row = csmEl('div', 'p-component-row');
    row.append(
      csmEl('span', `p-dot p-${STATUS_COLOR[c.status] ?? 'gray'}`),
      csmEl('span', 'p-comp-name', c.name),
      csmEl('span', 'p-comp-status', SHARED_STATUS_LABELS[currentLang][c.status] ?? c.status)
    );
    container.appendChild(row);
  }
}

function renderActiveIncidents(incidents) {
  const L = P();
  const container = document.getElementById('p-active-incidents');
  const countEl = document.getElementById('p-active-count');
  container.replaceChildren();

  countEl.textContent = incidents.length;
  countEl.style.display = incidents.length ? 'inline' : 'none';

  if (!incidents.length) {
    container.appendChild(csmEl('div', 'p-empty', L.noIncidents));
    return;
  }

  for (const inc of incidents) {
    const impactClass = inc.impact === 'critical' ? 'major' : inc.impact;
    const card = csmEl('div', `p-incident-card p-incident-${impactClass}`);

    const header = csmEl('div', 'p-incident-header');
    const impactLabel = UI_LABELS[currentLang].impact[inc.impact] ?? inc.impact;
    header.append(
      csmEl('span', 'p-incident-name', inc.name),
      ...(impactLabel ? [csmEl('span', `p-badge p-impact-${impactClass}`, impactLabel)] : [])
    );

    const meta = csmEl('div', 'p-incident-meta');
    meta.append(
      csmEl('span', 'p-incident-status', L.incidentStatus[inc.status] ?? inc.status),
      csmEl('span', 'p-incident-time', L.ago(minutesAgo(inc.started_at)))
    );

    card.append(header, meta);

    if (inc.incident_updates?.length) {
      card.appendChild(csmEl('div', 'p-incident-update', inc.incident_updates[0].body));
    }

    container.appendChild(card);
  }
}

function renderScheduledMaintenance(maintenances) {
  const L = P();
  const container = document.getElementById('p-maintenance');
  const countEl = document.getElementById('p-maint-count');
  container.replaceChildren();

  const active = maintenances.filter((m) => m.status === 'scheduled' || m.status === 'in_progress');
  countEl.textContent = active.length;
  countEl.style.display = active.length ? 'inline' : 'none';

  if (!active.length) {
    container.appendChild(csmEl('div', 'p-empty', L.noMaintenance));
    return;
  }

  for (const m of active) {
    const card = csmEl('div', 'p-maint-card');

    const header = csmEl('div', 'p-maint-header');
    header.append(
      csmEl('span', 'p-maint-name', m.name),
      csmEl('span', 'p-badge p-maint-status-badge', L.maintStatus[m.status] ?? m.status)
    );

    card.appendChild(header);

    if (m.scheduled_for && m.scheduled_until) {
      const time = csmEl('div', 'p-maint-time');
      time.textContent = `${formatDate(m.scheduled_for)} · ${formatTimeRange(m.scheduled_for, m.scheduled_until)}`;
      card.appendChild(time);
    }

    container.appendChild(card);
  }
}

function renderHistory(allIncidents) {
  const L = P();
  const container = document.getElementById('p-history');
  container.replaceChildren();

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = allIncidents
    .filter((i) => i.status === 'resolved' && new Date(i.resolved_at).getTime() > sevenDaysAgo)
    .slice(0, 5);

  if (!recent.length) {
    container.appendChild(csmEl('div', 'p-empty', L.noHistory));
    return;
  }

  for (const inc of recent) {
    const row = csmEl('div', 'p-history-row');

    const durationMins = Math.round(
      (new Date(inc.resolved_at).getTime() - new Date(inc.started_at).getTime()) / 60000
    );

    const meta = csmEl('div', 'p-history-meta');
    meta.append(
      csmEl('span', 'p-history-date', formatDate(inc.resolved_at)),
      csmEl('span', 'p-history-sep', '·'),
      csmEl('span', 'p-history-duration', L.duration(durationMins))
    );

    const check = csmEl('span', 'p-history-check');
    check.appendChild(csmIcon('check', 11));

    row.append(check, csmEl('span', 'p-history-name', inc.name), meta);
    container.appendChild(row);
  }
}

function renderAll(summaryData, allIncidents) {
  const components = summaryData.components ?? [];
  const activeIncidents = summaryData.incidents ?? [];
  const maintenances = summaryData.scheduled_maintenances ?? [];

  // Header dot: worst of Statuspage indicator + components
  const status = getOverallStatus(components, summaryData.indicator);
  const overallColor = STATUS_COLOR[status] ?? 'gray';
  const pulse = (STATUS_PRIORITY[status] ?? 0) >= STATUS_PRIORITY.degraded_performance;
  const dotEl = document.getElementById('p-dot');
  dotEl.className = `p-dot p-${overallColor}${pulse ? ' p-pulsing' : ''}`;
  dotEl.setAttribute('aria-label', `Status: ${SHARED_STATUS_LABELS[currentLang][status] ?? status}`);

  renderComponents(components);
  renderUptimeChart(allIncidents ?? [], summaryData);
  renderActiveIncidents(activeIncidents);
  renderScheduledMaintenance(maintenances);
  renderHistory(allIncidents ?? []);

  const { text, stale } = formatLastChecked(summaryData.fetchedAt ?? Date.now(), currentLang);
  const ts = document.getElementById('p-timestamp');
  ts.textContent = text;
  ts.classList.toggle('p-stale', stale);
}

function updateLangUI() {
  const L = P();
  document.documentElement.lang = currentLang;
  const langBtn = document.getElementById('p-lang-btn');
  langBtn.textContent = currentLang.toUpperCase();
  langBtn.setAttribute('aria-label', L.langAria);
  langBtn.title = L.langAria;
  const refreshBtn = document.getElementById('p-refresh-btn');
  refreshBtn.setAttribute('aria-label', L.refreshAria);
  refreshBtn.title = L.refreshAria;
  const themeBtn = document.getElementById('p-theme-btn');
  themeBtn.setAttribute('aria-label', L.themeAria);
  themeBtn.title = L.themeAria;
  const settingsBtn = document.getElementById('p-settings-btn');
  settingsBtn.setAttribute('aria-label', L.settingsAria);
  settingsBtn.title = L.settingsAria;
  document.getElementById('p-settings-back').setAttribute('aria-label', L.backAria);

  // Section titles live here (not in renderAll) so error states have them too
  document.getElementById('p-components-title').textContent = L.components;
  document.getElementById('p-uptime-title').textContent = L.uptimeHistory;
  document.getElementById('p-active-title').textContent = L.activeIncidents;
  document.getElementById('p-maint-title').textContent = L.scheduledMaint;
  document.getElementById('p-history-title').textContent = L.recentIncidents;

  const link = document.getElementById('p-link');
  link.replaceChildren(document.createTextNode('status.anthropic.com'), csmIcon('external', 10));

  updateSettingsLabels();
}

function getPopupErrorLabel(code) {
  return ERROR_LABELS[currentLang]?.[code] ?? ERROR_LABELS[currentLang]?.UNKNOWN ?? P().error;
}

function showPopupError(code) {
  const container = document.getElementById('p-components');
  container.replaceChildren();
  container.appendChild(csmEl('div', 'p-empty', getPopupErrorLabel(code)));

  document.getElementById('p-dot').className = 'p-dot p-gray';
  document.getElementById('p-timestamp').textContent = `E:${code}`;
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
    renderAll(response.summary ?? {}, response.incidents ?? []);
  });
}

// ── Init ─────────────────────────────────────────────────────

document.getElementById('p-refresh-btn').replaceChildren(csmIcon('refresh', 13));
document.getElementById('p-settings-btn').replaceChildren(csmIcon('settings', 14));
document.getElementById('p-settings-back').replaceChildren(csmIcon('back', 14));

chrome.storage.local.get([STORAGE_KEYS.LANG, STORAGE_KEYS.THEME], (stored) => {
  if (stored[STORAGE_KEYS.LANG]) currentLang = stored[STORAGE_KEYS.LANG];
  applyTheme(stored[STORAGE_KEYS.THEME] ?? 'auto');
  updateLangUI();
  document.getElementById('p-components').appendChild(
    csmEl('div', 'p-empty', P().loading)
  );
  requestAndRender();
});

// ── Header actions ───────────────────────────────────────────

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

document.getElementById('p-lang-btn').addEventListener('click', () => {
  currentLang = currentLang === 'de' ? 'en' : 'de';
  chrome.storage.local.set({ [STORAGE_KEYS.LANG]: currentLang });
  updateLangUI();
  if (cachedResponse) renderAll(cachedResponse.summary ?? {}, cachedResponse.incidents ?? []);
});

// Header button: quick explicit dark/light toggle. 'Auto' lives in settings.
document.getElementById('p-theme-btn').addEventListener('click', () => {
  const next = resolvePopupTheme(themeSetting) === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  chrome.storage.local.set({ [STORAGE_KEYS.THEME]: next });
});

// ── Settings view ─────────────────────────────────────────────

function updateSettingsLabels() {
  const S = UI_LABELS[currentLang].settings;
  document.getElementById('p-settings-title').textContent = S.title;
  document.getElementById('p-label-theme').textContent    = S.theme;
  document.getElementById('p-desc-theme').textContent     = S.themeDesc;
  document.getElementById('p-label-notify').textContent   = S.notify;
  document.getElementById('p-desc-notify').textContent    = S.notifyDesc;
  document.getElementById('p-label-widget').textContent   = S.widget;
  document.getElementById('p-desc-widget').textContent    = S.widgetDesc;
  document.getElementById('p-label-lang').textContent     = S.lang;
  document.getElementById('p-label-interval').textContent = S.interval;
  document.getElementById('p-desc-interval').textContent  = S.intervalDesc;
  const themeSel = document.getElementById('p-setting-theme');
  Array.from(themeSel.options).forEach(opt => {
    opt.textContent = S.themeOptions[opt.value] ?? opt.value;
  });
  const intervalSel = document.getElementById('p-setting-interval');
  Array.from(intervalSel.options).forEach(opt => {
    opt.textContent = S.intervals[opt.value] ?? opt.value;
  });
}

function openSettings() {
  document.getElementById('p-main-view').classList.add('hidden');
  document.getElementById('p-settings-view').classList.add('active');
  updateSettingsLabels();

  // Load current values
  chrome.storage.local.get(
    [STORAGE_KEYS.THEME, STORAGE_KEYS.NOTIFY, STORAGE_KEYS.LANG, STORAGE_KEYS.INTERVAL, STORAGE_KEYS.WIDGET_VISIBLE],
    (stored) => {
      document.getElementById('p-setting-theme').value    = stored[STORAGE_KEYS.THEME] ?? 'auto';
      document.getElementById('p-setting-notify').checked = !!stored[STORAGE_KEYS.NOTIFY];
      document.getElementById('p-setting-widget').checked = stored[STORAGE_KEYS.WIDGET_VISIBLE] !== false;
      document.getElementById('p-setting-lang').value     = currentLang;
      document.getElementById('p-setting-interval').value = String(stored[STORAGE_KEYS.INTERVAL] ?? '1');
    }
  );
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

document.getElementById('p-setting-theme').addEventListener('change', (e) => {
  applyTheme(e.target.value);
  chrome.storage.local.set({ [STORAGE_KEYS.THEME]: e.target.value });
});

document.getElementById('p-setting-notify').addEventListener('change', (e) => {
  chrome.storage.local.set({ [STORAGE_KEYS.NOTIFY]: e.target.checked });
});

document.getElementById('p-setting-widget').addEventListener('change', (e) => {
  chrome.storage.local.set({ [STORAGE_KEYS.WIDGET_VISIBLE]: e.target.checked });
});

document.getElementById('p-setting-lang').addEventListener('change', (e) => {
  currentLang = e.target.value;
  chrome.storage.local.set({ [STORAGE_KEYS.LANG]: currentLang });
  updateLangUI();
  if (cachedResponse) renderAll(cachedResponse.summary ?? {}, cachedResponse.incidents ?? []);
});

document.getElementById('p-setting-interval').addEventListener('change', (e) => {
  const val = Number(e.target.value);
  chrome.storage.local.set({ [STORAGE_KEYS.INTERVAL]: val });
  // background.js listens to storage changes and reconfigures the alarm
});
