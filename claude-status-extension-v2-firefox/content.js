(function () {
  'use strict';

  if (document.getElementById('claude-status-widget')) return;

  // STATUS_COLOR, STATUS_PRIORITY, getOverallColor — from shared.js

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
  let currentTheme = 'dark';
  let lastComponents = [];

  // ── Build widget DOM (no innerHTML — AMO compliance) ────────

  function mk(tag, id, className) {
    const e = document.createElement(tag);
    if (id) e.id = id;
    if (className) e.className = className;
    return e;
  }

  // Header
  const dot      = mk('span', 'csm-dot', 'csm-dot csm-gray');
  dot.setAttribute('role', 'img');
  dot.setAttribute('aria-label', 'Status');
  const title    = mk('span', 'csm-title');
  title.textContent = 'Claude Status';
  const chevron  = mk('span', 'csm-chevron');
  chevron.textContent = '▴';
  chevron.setAttribute('aria-hidden', 'true');

  const langFlag  = mk('span', 'csm-lang-flag');
  langFlag.textContent = '🇩🇪';
  const langArrow = mk('span', 'csm-lang-arrow');
  langArrow.textContent = '▾';
  langArrow.setAttribute('aria-hidden', 'true');
  const langBtn   = mk('button', 'csm-lang-btn');
  langBtn.setAttribute('aria-label', 'Sprache wählen');
  langBtn.setAttribute('aria-haspopup', 'listbox');
  langBtn.append(langFlag, langArrow);
  const langSelector = mk('div', 'csm-lang-selector');
  langSelector.appendChild(langBtn);

  const themeBtn  = mk('button', 'csm-theme-btn');
  themeBtn.textContent = '🌙';
  themeBtn.setAttribute('aria-label', 'Theme wechseln');

  const headerControls = mk('div', 'csm-header-controls');
  headerControls.append(langSelector, themeBtn);

  const header = mk('div', 'csm-header');
  header.append(dot, title, chevron, headerControls);

  // Body
  const components = mk('div', 'csm-components');
  const timestamp  = mk('span', 'csm-timestamp');
  timestamp.textContent = 'Wird geladen…';
  const link       = mk('a', 'csm-link');
  link.href = 'https://status.anthropic.com';
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Details ↗';
  const footer     = mk('div', 'csm-footer');
  footer.append(timestamp, link);
  const bodyInner  = mk('div', 'csm-body-inner');
  bodyInner.append(components, footer);
  const body       = mk('div', 'csm-body');
  body.appendChild(bodyInner);

  const widget = mk('div', 'claude-status-widget');
  widget.setAttribute('role', 'complementary');
  widget.setAttribute('aria-label', 'Claude Status Monitor');
  header.setAttribute('role', 'button');
  header.setAttribute('tabindex', '0');
  header.setAttribute('aria-expanded', 'false');
  widget.append(header, body);
  document.body.appendChild(widget);

  // ── Lang dropdown — appended to body, positioned via JS ────

  const langMenu = mk('div', 'csm-lang-menu');
  const optDe = mk('div', null, 'csm-lang-option');
  optDe.dataset.lang = 'de';
  optDe.textContent = '🇩🇪 Deutsch';
  const optEn = mk('div', null, 'csm-lang-option');
  optEn.dataset.lang = 'en';
  optEn.textContent = '🇺🇸 English';
  langMenu.append(optDe, optEn);
  document.body.appendChild(langMenu);

  // ── Cached element refs ─────────────────────────────────────

  const dotEl       = widget.querySelector('#csm-dot');
  const chevronEl   = widget.querySelector('#csm-chevron');
  const timestampEl = widget.querySelector('#csm-timestamp');
  const componentsEl= widget.querySelector('#csm-components');
  const flagEl      = widget.querySelector('#csm-lang-flag');

  // ── Load persisted settings ─────────────────────────────────

  chrome.storage.local.get(['csm-lang', 'csm-expanded', 'csm-theme'], (stored) => {
    if (stored['csm-lang']) currentLang = stored['csm-lang'];
    if (stored['csm-theme']) currentTheme = stored['csm-theme'];
    updateLangUI();
    applyTheme(currentTheme);
    if (stored['csm-expanded']) {
      widget.classList.add('expanded');
      chevronEl.textContent = '▾';
    }
  });

  // ── Lang menu ───────────────────────────────────────────────

  function positionLangMenu() {
    const rect = langBtn.getBoundingClientRect();
    langMenu.style.top  = (rect.bottom + 4) + 'px';
    langMenu.style.left = (rect.right - 120) + 'px';
  }

  function closeLangMenu() {
    langMenu.classList.remove('open');
  }

  langBtn.addEventListener('click', (e) => {
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

  // ── Theme ───────────────────────────────────────────────────

  const THEME_VARS = {
    dark:  { bg: 'rgba(28,28,28,0.82)', border: 'rgba(255,255,255,0.12)', text: '#f0f0f0', link: '#60a5fa' },
    light: { bg: 'rgba(248,248,248,0.88)', border: 'rgba(0,0,0,0.1)',    text: '#111111', link: '#2563eb' },
  };

  function applyTheme(theme) {
    currentTheme = theme;
    widget.dataset.theme = theme;
    // Lang-menu is outside widget; set CSS vars directly
    const v = THEME_VARS[theme] ?? THEME_VARS.dark;
    langMenu.style.setProperty('background', v.bg);
    langMenu.style.setProperty('border-color', v.border);
    langMenu.querySelectorAll('.csm-lang-option').forEach(o => {
      o.style.setProperty('color', o.classList.contains('active') ? v.link : v.text);
    });
    themeBtn.textContent = theme === 'dark' ? '🌙' : '☀️';
  }

  themeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const next = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    chrome.storage.local.set({ 'csm-theme': next });
  });

  function updateLangUI() {
    if (flagEl) flagEl.textContent = currentLang === 'de' ? '🇩🇪' : '🇺🇸';
    langMenu.querySelectorAll('.csm-lang-option').forEach((o) =>
      o.classList.toggle('active', o.dataset.lang === currentLang)
    );
    // Re-apply theme so option colors reflect active state correctly
    applyTheme(currentTheme);
  }

  // ── Expand / collapse ───────────────────────────────────────

  header.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('#csm-lang-selector') || e.target.closest('#csm-theme-btn')) return;
    closeLangMenu();
    const expanded = widget.classList.toggle('expanded');
    chevronEl.textContent = expanded ? '▾' : '▴';
    header.setAttribute('aria-expanded', String(expanded));
    chrome.storage.local.set({ 'csm-expanded': expanded });
  });

  // Keyboard: Enter/Space toggle on header
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); header.click(); }
  });

  // ── Status rendering ────────────────────────────────────────

  // getOverallColor — from shared.js

  function makeEmpty(text) {
    const div = document.createElement('div');
    div.className = 'csm-empty';
    div.textContent = text;
    return div;
  }

  function renderComponents(comps) {
    lastComponents = comps;
    const L = LABELS[currentLang];
    const visible = comps.filter(c => !c.group);
    componentsEl.replaceChildren();
    if (!visible.length) {
      componentsEl.appendChild(makeEmpty(L.noData));
      return;
    }
    for (const c of visible) {
      const row = document.createElement('div');
      row.className = 'csm-component';

      const d = document.createElement('span');
      d.className = `csm-dot csm-${STATUS_COLOR[c.status] ?? 'gray'}`;

      const name = document.createElement('span');
      name.className = 'csm-component-name';
      name.textContent = c.name;

      const st = document.createElement('span');
      st.className = 'csm-component-status';
      st.textContent = L.status[c.status] ?? c.status;

      row.append(d, name, st);
      componentsEl.appendChild(row);
    }
  }

  function updateTimestamp() {
    const time = new Date().toLocaleTimeString(
      currentLang === 'de' ? 'de-DE' : 'en-US',
      { hour: '2-digit', minute: '2-digit' }
    );
    timestampEl.textContent = LABELS[currentLang].lastChecked(time);
  }

  function applyData(data) {
    const comps = data.components ?? [];
    const color = getOverallColor(comps);
    const pulse = color === 'orange' || color === 'red';
    dotEl.className = `csm-dot csm-${color}${pulse ? ' csm-pulsing' : ''}`;
    dotEl.setAttribute('aria-label', `Status: ${LABELS[currentLang].status[color === 'orange' ? 'partial_outage' : color === 'red' ? 'major_outage' : color === 'gray' ? 'under_maintenance' : 'operational'] ?? color}`);
    renderComponents(comps);
    updateTimestamp();
  }

  function applyError() {
    dotEl.className = 'csm-dot csm-gray';
    componentsEl.replaceChildren(makeEmpty(LABELS[currentLang].error));
    timestampEl.textContent = LABELS[currentLang].fetchError;
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
