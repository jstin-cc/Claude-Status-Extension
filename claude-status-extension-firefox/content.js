(function () {
  'use strict';

  if (document.getElementById('claude-status-widget')) return;

  const STATUS_COLOR = {
    major_outage: 'red',
    partial_outage: 'orange',
    degraded_performance: 'orange',
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

  const LABELS = {
    de: {
      status: {
        major_outage: 'Komplettausfall',
        partial_outage: 'Teilausfall',
        degraded_performance: 'Eingeschränkt',
        under_maintenance: 'Wartung',
        operational: 'Betrieb normal',
      },
      loading: 'Wird geladen…',
      lastChecked: (t) => `Zuletzt geprüft: ${t} Uhr`,
      error: 'Status nicht verfügbar',
      fetchError: 'Fehler beim Abrufen',
      noData: 'Keine Daten verfügbar',
    },
    en: {
      status: {
        major_outage: 'Major Outage',
        partial_outage: 'Partial Outage',
        degraded_performance: 'Degraded',
        under_maintenance: 'Maintenance',
        operational: 'Operational',
      },
      loading: 'Loading…',
      lastChecked: (t) => `Last checked: ${t}`,
      error: 'Status unavailable',
      fetchError: 'Failed to fetch',
      noData: 'No data available',
    },
  };

  let currentLang = 'de';
  let lastComponents = [];

  // Load persisted lang from storage
  chrome.storage.local.get(['csm-lang', 'csm-expanded'], (stored) => {
    if (stored['csm-lang']) currentLang = stored['csm-lang'];
    updateLangUI();
    if (stored['csm-expanded']) {
      widget.classList.add('expanded');
      widget.querySelector('#csm-chevron').textContent = '▾';
    }
  });

  // ── Build widget DOM ────────────────────────────────────────

  const widget = document.createElement('div');
  widget.id = 'claude-status-widget';
  widget.innerHTML = `
    <div id="csm-header">
      <span id="csm-dot" class="csm-dot csm-gray"></span>
      <span id="csm-title">Claude Status</span>
      <span id="csm-chevron">▴</span>
      <div id="csm-lang-selector">
        <button id="csm-lang-btn">
          <span id="csm-lang-flag">🇩🇪</span>
          <span id="csm-lang-arrow">▾</span>
        </button>
      </div>
    </div>
    <div id="csm-body">
      <div id="csm-body-inner">
        <div id="csm-components"></div>
        <div id="csm-footer">
          <span id="csm-timestamp">Wird geladen…</span>
          <a id="csm-link" href="https://status.anthropic.com" target="_blank" rel="noopener">Details ↗</a>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(widget);

  // ── Lang dropdown — appended to body, positioned via JS ────

  const langMenu = document.createElement('div');
  langMenu.id = 'csm-lang-menu';
  langMenu.innerHTML = `
    <div class="csm-lang-option" data-lang="de">🇩🇪 Deutsch</div>
    <div class="csm-lang-option" data-lang="en">🇺🇸 English</div>
  `;
  document.body.appendChild(langMenu);

  function positionLangMenu() {
    const btn = widget.querySelector('#csm-lang-btn');
    const rect = btn.getBoundingClientRect();
    langMenu.style.top  = (rect.bottom + 4) + 'px';
    langMenu.style.left = (rect.right - 120) + 'px'; // 120 = min-width of menu
  }

  function closeLangMenu() {
    langMenu.classList.remove('open');
  }

  widget.querySelector('#csm-lang-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (langMenu.classList.contains('open')) {
      closeLangMenu();
    } else {
      positionLangMenu();
      langMenu.classList.add('open');
    }
  });

  langMenu.querySelectorAll('.csm-lang-option').forEach((opt) => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const lang = opt.dataset.lang;
      closeLangMenu();
      if (lang === currentLang) return;
      currentLang = lang;
      chrome.storage.local.set({ 'csm-lang': lang });
      updateLangUI();
      if (lastComponents.length) renderComponents(lastComponents);
      updateTimestamp();
    });
  });

  document.addEventListener('click', closeLangMenu);
  window.addEventListener('scroll', closeLangMenu, true);
  window.addEventListener('resize', closeLangMenu);

  function updateLangUI() {
    const flagEl = widget.querySelector('#csm-lang-flag');
    if (flagEl) flagEl.textContent = currentLang === 'de' ? '🇩🇪' : '🇺🇸';
    langMenu.querySelectorAll('.csm-lang-option').forEach((o) =>
      o.classList.toggle('active', o.dataset.lang === currentLang)
    );
  }

  // ── Expand / collapse ───────────────────────────────────────

  widget.querySelector('#csm-header').addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('#csm-lang-selector')) return;
    closeLangMenu();
    const expanded = widget.classList.toggle('expanded');
    widget.querySelector('#csm-chevron').textContent = expanded ? '▾' : '▴';
    chrome.storage.local.set({ 'csm-expanded': expanded });
  });

  // ── Status rendering ────────────────────────────────────────

  function getOverallColor(components) {
    let maxPriority = -1;
    let worstStatus = 'operational';
    for (const c of components) {
      const p = STATUS_PRIORITY[c.status] ?? 0;
      if (p > maxPriority) { maxPriority = p; worstStatus = c.status; }
    }
    return STATUS_COLOR[worstStatus] ?? 'gray';
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function makeEmpty(text) {
    const div = document.createElement('div');
    div.className = 'csm-empty';
    div.textContent = text;
    return div;
  }

  function renderComponents(components) {
    lastComponents = components;
    const container = widget.querySelector('#csm-components');
    const L = LABELS[currentLang];
    const visible = components.filter(c => !c.group);
    container.replaceChildren();
    if (!visible.length) {
      container.appendChild(makeEmpty(L.noData));
      return;
    }
    for (const c of visible) {
      const row = document.createElement('div');
      row.className = 'csm-component';

      const dot = document.createElement('span');
      dot.className = `csm-dot csm-${STATUS_COLOR[c.status] ?? 'gray'}`;

      const name = document.createElement('span');
      name.className = 'csm-component-name';
      name.textContent = c.name;

      const status = document.createElement('span');
      status.className = 'csm-component-status';
      status.textContent = L.status[c.status] ?? c.status;

      row.append(dot, name, status);
      container.appendChild(row);
    }
  }

  function updateTimestamp() {
    const time = new Date().toLocaleTimeString(
      currentLang === 'de' ? 'de-DE' : 'en-US',
      { hour: '2-digit', minute: '2-digit' }
    );
    widget.querySelector('#csm-timestamp').textContent =
      LABELS[currentLang].lastChecked(time);
  }

  function applyData(data) {
    const components = data.components ?? [];
    widget.querySelector('#csm-dot').className = `csm-dot csm-${getOverallColor(components)}`;
    renderComponents(components);
    updateTimestamp();
  }

  function applyError() {
    widget.querySelector('#csm-dot').className = 'csm-dot csm-gray';
    const container = widget.querySelector('#csm-components');
    container.replaceChildren(makeEmpty(LABELS[currentLang].error));
    widget.querySelector('#csm-timestamp').textContent = LABELS[currentLang].fetchError;
  }

  function requestStatus() {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
      if (chrome.runtime.lastError) { applyError(); return; }
      if (response?.type === 'STATUS_DATA') applyData(response.payload);
      else applyError();
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'STATUS_DATA') applyData(message.payload);
    else if (message?.type === 'STATUS_ERROR') applyError();
  });

  requestStatus();
})();
