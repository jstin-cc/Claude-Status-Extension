(function () {
  'use strict';

  if (document.getElementById('claude-status-widget')) return;

  // STATUS_COLOR, STATUS_PRIORITY, getOverallStatus, ERROR_CODES, ERROR_LABELS,
  // SHARED_STATUS_LABELS, UI_LABELS, CSM_CONFIG, STORAGE_KEYS, formatLastChecked,
  // csmEl, csmIcon — from shared.js

  function W() {
    return UI_LABELS[currentLang].widget;
  }

  function getErrorLabel(code) {
    return ERROR_LABELS[currentLang]?.[code] ?? ERROR_LABELS[currentLang]?.UNKNOWN ?? W().error;
  }

  // Default to the browser locale; a stored choice overrides it below.
  let currentLang = (navigator.language || 'en').toLowerCase().startsWith('de') ? 'de' : 'en';
  let themeSetting = 'auto'; // 'auto' (follow claude.ai) | 'dark' | 'light'
  let resolvedTheme = 'dark';
  let lastComponents = [];
  let lastIncidents = [];
  let lastIndicator = 'none';
  let lastFetchedAt = null;

  // ── Build widget DOM (no innerHTML — AMO compliance) ────────

  // Header
  const dot      = csmEl('span', 'csm-dot csm-gray');
  dot.id = 'csm-dot';
  dot.setAttribute('role', 'img');
  dot.setAttribute('aria-label', 'Status');
  const title    = csmEl('span', '#csm-title', 'Claude Status');
  const chevron  = csmEl('span', '#csm-chevron');
  chevron.appendChild(csmIcon('chevron', 12));

  // Exactly two languages — a plain DE/EN toggle beats a dropdown
  const langBtn  = csmEl('button', '#csm-lang-btn');
  const themeBtn = csmEl('button', '#csm-theme-btn');

  const headerControls = csmEl('div', '#csm-header-controls');
  headerControls.append(langBtn, themeBtn);

  const header = csmEl('div', '#csm-header');
  header.append(dot, title, chevron, headerControls);

  // Body
  const incidentEl = csmEl('div', '#csm-incident');
  incidentEl.hidden = true;
  const componentsEl = csmEl('div', '#csm-components');
  const timestampEl  = csmEl('span', '#csm-timestamp');
  timestampEl.setAttribute('role', 'status');
  timestampEl.setAttribute('aria-live', 'polite');
  timestampEl.classList.add('csm-loading');
  const link = csmEl('a', '#csm-link');
  link.href = 'https://status.anthropic.com';
  link.target = '_blank';
  link.rel = 'noopener';
  const footer = csmEl('div', '#csm-footer');
  footer.append(timestampEl, link);
  const bodyInner = csmEl('div', '#csm-body-inner');
  bodyInner.append(incidentEl, componentsEl, footer);
  const body = csmEl('div', '#csm-body');
  body.appendChild(bodyInner);

  const widget = csmEl('div', '#claude-status-widget');
  widget.setAttribute('role', 'complementary');
  header.setAttribute('role', 'button');
  header.setAttribute('tabindex', '0');
  header.setAttribute('aria-expanded', 'false');
  widget.append(header, body);
  document.body.appendChild(widget);

  const globalAC = new AbortController();

  // ── SPA navigation watch ────────────────────────────────────
  // Patching history.pushState from the isolated world can never observe
  // page-initiated navigations, so we listen to popstate, use the Navigation
  // API where available (Chrome) and fall back to a cheap visibility-gated
  // location poll (Firefox).

  function isDesignPage() {
    return window.location.pathname.startsWith('/design');
  }
  function applyPageMode() {
    widget.classList.toggle('csm-design-mode', isDesignPage());
  }
  applyPageMode();

  let navTimer = null;
  function startNavWatch() {
    window.addEventListener('popstate', applyPageMode, { signal: globalAC.signal });
    if (window.navigation?.addEventListener) {
      // navigate fires before the URL commits — defer one tick
      window.navigation.addEventListener('navigate', () => setTimeout(applyPageMode, 0), { signal: globalAC.signal });
    } else {
      let lastPath = window.location.pathname;
      navTimer = setInterval(() => {
        if (document.hidden || window.location.pathname === lastPath) return;
        lastPath = window.location.pathname;
        applyPageMode();
      }, 2000);
    }
  }
  startNavWatch();

  // ── Theme ───────────────────────────────────────────────────
  // 'auto' follows claude.ai's own theme: documentElement class/attribute
  // first, background luminance as the DOM-agnostic fallback, OS preference
  // as the last resort. Defensive by design — survives claude.ai redesigns.

  function detectPageTheme() {
    const html = document.documentElement;
    if (html.classList.contains('dark')) return 'dark';
    const attr = html.dataset.theme ?? html.dataset.mode;
    if (attr === 'dark' || attr === 'light') return attr;
    const bg = getComputedStyle(document.body).backgroundColor;
    const m = bg?.match(/\d+(\.\d+)?/g);
    if (m && m.length >= 3) {
      const [r, g, b] = m.map(Number);
      const alpha = m.length >= 4 ? Number(m[3]) : 1;
      if (alpha > 0.1) {
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 128 ? 'dark' : 'light';
      }
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
  }

  function applyTheme(setting) {
    themeSetting = setting;
    resolvedTheme = setting === 'auto' ? detectPageTheme() : setting;
    widget.dataset.theme = resolvedTheme;
    themeBtn.replaceChildren(csmIcon(resolvedTheme === 'dark' ? 'moon' : 'sun', 14));
  }

  const themeObserver = new MutationObserver(() => {
    if (themeSetting === 'auto') applyTheme('auto');
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme', 'data-mode', 'style'],
  });
  window.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.(
    'change',
    () => { if (themeSetting === 'auto') applyTheme('auto'); },
    { signal: globalAC.signal }
  );

  // The widget button stays a predictable dark/light toggle (writes an
  // explicit value); 'auto' is selectable in the popup settings.
  themeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const next = resolvedTheme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    chrome.storage.local.set({ [STORAGE_KEYS.THEME]: next });
  });

  // ── Language toggle ─────────────────────────────────────────

  langBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    currentLang = currentLang === 'de' ? 'en' : 'de';
    chrome.storage.local.set({ [STORAGE_KEYS.LANG]: currentLang });
    updateLangUI();
    rerender();
  });

  function updateLangUI() {
    const w = W();
    langBtn.textContent = currentLang.toUpperCase();
    langBtn.setAttribute('aria-label', w.langAria);
    themeBtn.setAttribute('aria-label', w.themeAria);
    header.setAttribute('aria-label', w.headerAria);
    widget.setAttribute('aria-label', w.widgetAria);
    link.replaceChildren(document.createTextNode(w.details), csmIcon('external', 11));
    if (lastFetchedAt == null) timestampEl.textContent = w.loading;
  }
  updateLangUI();
  applyTheme(themeSetting);

  // ── Load persisted settings ─────────────────────────────────

  chrome.storage.local.get(
    [STORAGE_KEYS.LANG, STORAGE_KEYS.EXPANDED, STORAGE_KEYS.THEME, STORAGE_KEYS.WIDGET_VISIBLE],
    (stored) => {
      if (stored[STORAGE_KEYS.LANG]) currentLang = stored[STORAGE_KEYS.LANG];
      if (stored[STORAGE_KEYS.WIDGET_VISIBLE] === false) widget.hidden = true;
      updateLangUI();
      applyTheme(stored[STORAGE_KEYS.THEME] ?? 'auto');
      if (stored[STORAGE_KEYS.EXPANDED]) {
        widget.classList.add('expanded');
        header.setAttribute('aria-expanded', 'true');
      }
    }
  );

  // Re-render only the timestamp so the displayed data age stays honest
  const tsTimer = setInterval(() => {
    if (!document.hidden) renderTimestamp();
  }, 30000);

  // Cleanup when widget is removed from DOM
  new MutationObserver((_, obs) => {
    if (!document.getElementById('claude-status-widget')) {
      globalAC.abort();
      chrome.storage.onChanged.removeListener(onStorageChanged);
      themeObserver.disconnect();
      if (navTimer) clearInterval(navTimer);
      clearInterval(tsTimer);
      obs.disconnect();
    }
  }).observe(document.body, { childList: true });

  // ── Expand / collapse ───────────────────────────────────────

  header.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('#csm-lang-btn') || e.target.closest('#csm-theme-btn')) return;
    const expanded = widget.classList.toggle('expanded');
    header.setAttribute('aria-expanded', String(expanded));
    chrome.storage.local.set({ [STORAGE_KEYS.EXPANDED]: expanded });
  });

  // Keyboard: Enter/Space toggle on header
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); header.click(); }
  });

  // ── Status rendering ────────────────────────────────────────

  function renderIncidentBanner() {
    incidentEl.replaceChildren();
    const inc = lastIncidents[0];
    if (!inc) {
      incidentEl.hidden = true;
      incidentEl.className = '';
      return;
    }
    incidentEl.hidden = false;
    const impact = inc.impact ?? 'none';
    const impactClass = impact === 'critical' ? 'major' : impact;
    incidentEl.className = `csm-incident-${impactClass}`;

    incidentEl.appendChild(csmEl('span', 'csm-incident-name', inc.name));
    const impactLabel = UI_LABELS[currentLang].impact[impact] ?? impact;
    if (impactLabel) {
      incidentEl.appendChild(csmEl('span', `csm-impact csm-impact-${impactClass}`, impactLabel));
    }
  }

  function renderComponents(comps) {
    const visible = comps.filter(c => !c.group);
    componentsEl.replaceChildren();
    if (!visible.length) {
      componentsEl.appendChild(csmEl('div', 'csm-empty', W().noData));
      return;
    }
    const frag = document.createDocumentFragment();
    for (const c of visible) {
      const row = csmEl('div', 'csm-component');
      row.append(
        csmEl('span', `csm-dot csm-${STATUS_COLOR[c.status] ?? 'gray'}`),
        csmEl('span', 'csm-component-name', c.name),
        csmEl('span', 'csm-component-status', SHARED_STATUS_LABELS[currentLang][c.status] ?? c.status)
      );
      frag.appendChild(row);
    }
    componentsEl.appendChild(frag);
  }

  function renderTimestamp() {
    if (lastFetchedAt == null) return;
    const { text, stale } = formatLastChecked(lastFetchedAt, currentLang);
    timestampEl.textContent = text;
    timestampEl.classList.toggle('csm-stale', stale);
  }

  function rerender() {
    if (lastFetchedAt == null) return;
    renderIncidentBanner();
    renderComponents(lastComponents);
    renderTimestamp();
  }

  function applyData(payload) {
    timestampEl.classList.remove('csm-loading');
    lastComponents = payload.components ?? [];
    lastIncidents = payload.incidents ?? [];
    lastIndicator = payload.indicator ?? 'none';
    lastFetchedAt = payload.fetchedAt ?? Date.now();

    const status = getOverallStatus(lastComponents, lastIndicator);
    const color = STATUS_COLOR[status] ?? 'gray';
    const pulse = (STATUS_PRIORITY[status] ?? 0) >= STATUS_PRIORITY.degraded_performance;
    dot.className = `csm-dot csm-${color}${pulse ? ' csm-pulsing' : ''}`;
    dot.setAttribute('aria-label', `Status: ${SHARED_STATUS_LABELS[currentLang][status] ?? status}`);
    rerender();
  }

  function applyError(code) {
    timestampEl.classList.remove('csm-loading');
    const errorCode = code ?? ERROR_CODES.UNKNOWN;
    if (lastFetchedAt != null && lastComponents.length) {
      // Keep showing the last known data; flag its age plus the error code
      renderTimestamp();
      timestampEl.textContent += ` · E:${errorCode}`;
      return;
    }
    dot.className = 'csm-dot csm-gray';
    componentsEl.replaceChildren(csmEl('div', 'csm-empty', getErrorLabel(errorCode)));
    timestampEl.textContent = `E:${errorCode}`;
  }

  function requestStatus(retriesLeft) {
    const attempt = retriesLeft ?? 1;
    // The 5s timer and the sendMessage callback race; whoever settles first
    // wins, the loser becomes a no-op (no more double applyData/applyError).
    let settled = false;
    function finish(action) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    }
    const timer = setTimeout(() => {
      finish(() => {
        if (attempt > 0) requestStatus(0);
        else applyError(ERROR_CODES.TIMEOUT);
      });
    }, 5000);

    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
      const err = chrome.runtime.lastError; // always read, even when settled
      finish(() => {
        if (err) {
          if (attempt > 0) setTimeout(() => requestStatus(0), 1000);
          else applyError(ERROR_CODES.NETWORK);
          return;
        }
        if (response?.type === 'STATUS_DATA') applyData(response.payload);
        else applyError(response?.code);
      });
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'STATUS_DATA') applyData(message.payload);
    else if (message?.type === 'STATUS_ERROR') applyError(message?.code);
  });

  // Sync settings when changed from the popup/settings
  function onStorageChanged(changes, area) {
    if (area !== 'local') return;
    const themeChange = changes[STORAGE_KEYS.THEME];
    if (themeChange && themeChange.newValue && themeChange.newValue !== themeSetting) {
      applyTheme(themeChange.newValue);
    }
    const langChange = changes[STORAGE_KEYS.LANG];
    if (langChange && langChange.newValue && langChange.newValue !== currentLang) {
      currentLang = langChange.newValue;
      updateLangUI();
      rerender();
    }
    const visChange = changes[STORAGE_KEYS.WIDGET_VISIBLE];
    if (visChange) {
      widget.hidden = visChange.newValue === false;
    }
  }
  chrome.storage.onChanged.addListener(onStorageChanged);

  requestStatus();
})();
