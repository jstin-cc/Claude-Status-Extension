# Claude Status Monitor — Änderungsprotokoll

**Stand: 2026-06-10 — v4.0 veröffentlicht.**

---

## v4.0 (2026-06-10)

Große Überarbeitung: kritische Bugfixes, MV3-feste Architektur, natives claude.ai-Design.

### Kritische Bugfixes
- **Benachrichtigungen funktionieren jetzt wirklich**: Der gesamte Background-State (`lastStatus`, Fehlerzähler, Cache) lag bisher nur im RAM des Service Workers, den Chrome nach ~30s Idle beendet — die Vergleichsbasis ging vor jedem Poll verloren, Notifications feuerten praktisch nie. Jetzt liegt der State in `chrome.storage.session` und wird bei jedem Worker-Start lazy hydriert (gilt auch für Firefox-Event-Pages).
- **`degraded_performance` war für den Notifier unsichtbar**: Die alten Rank-Maps verglichen Farben und kannten `yellow` nicht — eine Verschlechterung auf „Eingeschränkt" wurde nie gemeldet, und beim Auflösen eines Incidents bei weiterhin degradierter Komponente kam eine falsche „Alles wieder operational"-Meldung. Vergleiche laufen jetzt über Status-Strings (`isWorseStatus`/`isRecoveryStatus`, mit Regressionstests).
- **SPA-Navigation wird jetzt erkannt**: Der `history.pushState`-Patch konnte Navigationen der claude.ai-App aus der Isolated World prinzipiell nie sehen — die `/design`-Repositionierung griff nur bei Initial-Load. Jetzt: `popstate` + Navigation API (Chrome) + leichtgewichtiger Location-Watcher (Firefox).
- **Timestamps lügen nicht mehr**: Widget und Popup zeigen den echten Abrufzeitpunkt (`fetchedAt` im Payload) inkl. relativem Alter; ab 5 Minuten wird der Timestamp amber eingefärbt. Bisher wurde die Renderzeit gedruckt — auch für minutenalte Cache-Daten.
- **Uptime-Chart**: Degradierte Tage werden jetzt gelb dargestellt (vorher stillschweigend grün, `yellow` fehlte in `COLOR_PRIORITY`/Labels); `critical`-Impact mappt auf rot.

### Architektur
- **Payload-Vertrag**: `buildStatusPayload()` definiert die eine Datenform (`components`, `incidents`, `scheduled_maintenances`, `indicator`, `fetchedAt`) für Broadcast, `GET_STATUS` und `GET_SUMMARY`.
- **Statuspage-Indicator**: Der Gesamtstatus berücksichtigt jetzt `status.indicator` aus summary.json (Statuspages eigene Bewertung inkl. Incidents) zusätzlich zur schlechtesten Komponente.
- **Single-Flight-Fetches**: Alarm-Tick, `GET_STATUS`-Kaltpfad und `FORCE_FETCH` teilen einen In-Flight-Request; der Kaltpfad nutzt denselben Erfolgs-Pfad (Persist + Badge + Notify + Backoff-Reset).
- **Split-Polling**: Der 60s-Poll lädt nur noch `summary.json`; die komplette `incidents.json`-Historie wird erst beim Öffnen des Popups geholt (2-Min-TTL) — deutlich weniger Traffic.
- **API-Validierung** auch für die Incidents-Shape; alter Cache wird bei Update-Installation verworfen.

### Design (natives claude.ai-Look-and-feel)
- **Warmes Token-System**: Anthrazit `#262624` (dark) / warmes Papier `#faf9f5` (light), Coral-Akzent `#d97757` statt blauer Links, Hairline-Borders, 12–14px-Radien, dezenteres Blur; Widget erbt claude.ai's eigene Schrift (`font-family: inherit`).
- **Auto-Theme (neuer Default)**: `auto` folgt dem tatsächlichen claude.ai-Theme (Klassen-/Attribut-Erkennung mit Luminanz-Fallback, live per MutationObserver); explizite Dark/Light-Wahl gewinnt weiterhin. Das Popup folgt bei `auto` der OS-Einstellung.
- **SVG-Icons statt Emojis** (`createElementNS`, AMO-konform, `currentColor`); **DE/EN-Text-Toggle statt Flaggen-Dropdown** — entfernt das Body-Menü samt JS-Positionierung und Inline-Style-Theming (~90 Zeilen).
- Focus-visible-Styles auf allen interaktiven Elementen.

### Neue Features
- **Incident-Banner im Widget**: Aktive Vorfälle erscheinen mit Impact-Badge direkt im aufgeklappten Widget.
- **Stale-Anzeige**: „Stand: 14:32 Uhr · vor 5 Min." mit Amber-Tint bei veralteten Daten.
- **Widget-Sichtbarkeit**: Neues Setting im Popup blendet das On-Page-Widget live aus/ein.
- **Sprach-Default nach Browser-Locale** statt erzwungenem Deutsch (gespeicherte Wahl bleibt unangetastet); alle aria-Labels werden mitübersetzt.

### Qualität
- Tests 27 → 63 (u. a. Notification-Regressionsfälle, `classifyFetchError`-Tabelle, `formatLastChecked`-Grenzen, rekursive DE/EN-Label-Parität).
- `UI_LABELS` als einzige Quelle aller UI-Strings; DOM-Helfer auf `csmEl` konsolidiert; Listener-/Timer-Teardown vollständig.
- Repo-URLs vereinheitlicht (`package.json`, `homepage_url`); CLAUDE.md an die reale Architektur angepasst.

### Verhaltensänderungen
- Theme-Default ist `auto` (folgt claude.ai); bestehende explizite Dark/Light-Einstellungen bleiben erhalten.
- Sprach-Default folgt der Browser-Sprache; bestehende Einstellungen bleiben erhalten.
- 30s-Intervall: Chrome < 120 und ggf. Firefox runden auf 1 Min auf (Browser-Limit für `chrome.alarms`).

---

## v3.1 (2026-04-10)

### Bugfixes
- **Live-Sync Theme & Sprache zwischen Popup und Widget**: Änderungen am Theme oder an der Sprache, die im Popup oder in den Einstellungen vorgenommen werden, werden jetzt sofort auf das Widget in offenen claude.ai-Tabs übertragen. Bisher lief der Sync nur in eine Richtung (Widget → Popup). Umgesetzt über einen `chrome.storage.onChanged`-Listener in `content.js`.

---

## v3.0 (2026-04-09)

### Stabilität & Fehlerbehandlung
- **Fehlercode-System**: 7 klassifizierte Error-Codes (TIMEOUT, NETWORK, OFFLINE, HTTP_4XX, HTTP_5XX, PARSE, UNKNOWN) mit bilingualen Labels (DE/EN)
- **Exponential Backoff**: Automatische Verdopplung des Poll-Intervalls bei Fehlern (max 10 Min), Reset nach Erfolg
- **Cache-Persistenz**: Letzte API-Daten werden in `chrome.storage.local` gesichert und beim Service-Worker-Neustart wiederhergestellt (max 10 Min alt)
- **Fetch-Lock**: Verhindert parallele API-Anfragen
- **Fetch-Timeout**: 8s AbortController-Timeout auf alle API-Calls
- **API-Validierung**: Prüft ob Response-Schema gültig ist (components Array)
- **Content Script Timeout + Retry**: 5s Timeout mit 1x Retry nach 1s
- **Offline-Handling**: Erkennt Online/Offline-Events, zeigt letzte bekannte Daten

### Code-Qualität
- **Zentralisierte Konfiguration**: `CSM_CONFIG` (API-URL, Timeouts, Limits) und `STORAGE_KEYS` in shared.js
- **Keine Duplikate**: `getOverallColor()`, Status-Labels nur noch in shared.js
- **DocumentFragment**: Batch-DOM-Rendering für Komponentenliste
- **Event-Listener Cleanup**: AbortController + MutationObserver für SPA-Navigation
- **Legacy-Ordner entfernt**: Firefox v1 und Backup-Ordner gelöscht

### UI/UX
- **WCAG AA Kontraste**: Light-Mode Textfarben angepasst (#0a0a0a / #3d3d3d)
- **Neue Farbe für degraded_performance**: Gelb statt Orange (besser unterscheidbar)
- **System-Theme-Detection**: `prefers-color-scheme` als Default, gespeicherter Wert überschreibt
- **Manueller Refresh-Button**: Im Popup (↻) mit Loading-Feedback
- **Skeleton Loading**: Shimmer-Animation beim ersten Laden
- **Responsive Widget**: Anpassung für kleine Viewports (480px / 800px)
- **Touch-Targets**: Min 32x32px auf allen Buttons
- **Escape-Taste**: Schließt Dropdown-Menüs
- **aria-live**: Screen-Reader-Unterstützung auf Timestamp

### Build & Tooling
- **package.json**: npm Scripts für build, lint, test
- **Build-Script** (`scripts/build.js`): Plattformunabhängiger Ersatz für sync.ps1, generiert browser-spezifische Manifeste, erstellt dist/-ZIPs
- **ESLint**: Flat Config mit AMO-Compliance-Regeln (kein innerHTML)
- **Vitest**: 27 Unit-Tests für shared.js (Logik, Error-Codes, Labels)
- **GitHub Actions CI/CD**: Lint + Test + Build + Artefakt-Upload bei Push/PR

---

## v2.1 (2026-04-02)

- Recovery-Notifications bei Statusverbesserung
- Theme-Toggle-Button im Widget-Header
- Shared `src/`-Struktur mit `sync.ps1`

---

## v2.0 (2026-04-02)

Dieses Dokument hält alle Änderungen von v1 → v2 fest.

**Alle Schritte + Nachbesserungen abgeschlossen.**

---

## Status: ✅ Vollständig implementiert

- [x] Schritt 1: v2-Verzeichnis angelegt, CHANGES.md erstellt
- [x] Schritt 2: `shared.js` — gemeinsame Konstanten (STATUS_COLOR, STATUS_PRIORITY, getOverallColor)
- [x] Schritt 3: `innerHTML` aus `content.js` entfernen (AMO-Compliance)
- [x] Schritt 4: Polling vereinfachen (1 Alarm statt 2), Error-Handling in `background.js`
- [x] Schritt 5: Dark/Light Theme-Toggle (Sonne/Mond-Icon, CSS-Übergang)
- [x] Schritt 6: Desktop-Notifications (konfigurierbar, bilingual)
- [x] Schritt 7: Badge-Count auf Extension-Icon
- [x] Schritt 8: Pulsierender Dot bei Incidents, CSS-Grid Expand-Animation
- [x] Schritt 9: Einstellungsseite im Popup (⚙-Icon → Settings-Panel)
- [x] Schritt 10: Accessibility (aria-labels, role, keyboard nav, prefers-reduced-motion)

---

## Abgeschlossene Änderungen

### Schritt 1 — Setup (2026-04-02)
- `claude-status-extension/` → `claude-status-extension-v2/` kopiert
- `manifest.json`: Version 2.0, `notifications`-Permission, `shared.js` als Content-Script
- Gecko-ID geändert auf `claude-status-monitor-v2@jstin-cc`

---

### Schritt 2 — shared.js (2026-04-02)
**Neue Datei:** `shared.js`
- `STATUS_COLOR`, `STATUS_PRIORITY`, `getOverallColor()` ausgelagert
- In `manifest.json` als erstes Content-Script eingetragen (`["shared.js", "content.js"]`)
- In `popup.html`: `<script src="shared.js">` vor `popup.js` eingefügt
- `content.js`: Duplikate entfernt
- `popup.js`: Duplikate entfernt

---

### Schritt 3 — innerHTML entfernen (2026-04-02)
**Datei:** `content.js`
- Widget-DOM komplett über `createElement`/`appendChild` aufgebaut
- Lang-Menü ebenfalls ohne innerHTML
- Hilfsfunktion `mk(tag, id, className)` für weniger Boilerplate
- Häufig verwendete Element-Referenzen gecacht (`dotEl`, `chevronEl`, `timestampEl`, etc.)
- `escapeHtml()`-Funktion entfernt (war nie aufgerufen)

---

### Schritt 4 — Polling & Error-Handling (2026-04-02)
**Datei:** `background.js`
- Nur noch **1 Alarm** statt 2 (`claude-status-poll`)
- Summary-API liefert Components bereits → kein separater Components-Request mehr
- `fetchAndCacheSummary()` + `fetchStatus()` zu `fetchAll()` zusammengeführt
- `try/catch` um Fetch-Logik
- Alarm-Intervall konfigurierbar via `csm-poll-interval` in Storage (Default: 1 Min.)
- `chrome.storage.onChanged` lauscht auf Intervall-Änderungen → Alarm neu anlegen
- `chrome.runtime.onStartup` stellt Alarm nach Browser-Neustart wieder her

---

### Schritt 5 — Dark/Light Theme (2026-04-02)
**Dateien:** `content.css`, `popup.css`, `content.js`, `popup.js`

**CSS:**
- Alle Farben als CSS-Custom-Properties (`--bg`, `--surface`, `--border`, etc.)
- Dark-Theme: Default (wie v1)
- Light-Theme: `#claude-status-widget[data-theme="light"]` / `:root[data-theme="light"]`
- Fließender Übergang: `transition: background-color 0.3s ease, color 0.3s ease`
- Expand/Collapse jetzt via CSS Grid (`grid-template-rows: 0fr → 1fr`) statt `max-height`-Hack

**JS:**
- Widget-Header: neuer `#csm-header-controls`-Container mit Lang-Selector + Theme-Button
- Theme-Button: `☀️` (im Dark-Modus) / `🌙` (im Light-Modus)
- `applyTheme(theme)` setzt `data-theme` auf Widget + handelt Lang-Menü separat (außerhalb Widget)
- Persistenz: `csm-theme` in `chrome.storage.local`
- Laden: Theme wird **vor** dem Render aus Storage geladen (kein FOUC)

---

### Schritt 6 — Desktop-Notifications (2026-04-02)
**Datei:** `background.js`

- `lastOverallStatus` verfolgt letzten bekannten Status
- `maybeNotify()`: Nach jedem Fetch Statusvergleich → `isWorse()` prüft Verschlechterung
- Notification nur wenn `csm-notify === true` (Opt-in, Default: aus)
- Bilingual: liest `csm-lang` aus Storage
- `manifest.json`: Permission `"notifications"` ergänzt

---

### Schritt 7 — Badge-Count (2026-04-02)
**Datei:** `background.js`

- `updateBadge(activeIncidents)` nach jedem Fetch aufgerufen
- Badge zeigt Anzahl aktiver Incidents
- Farbe: `#ef4444` (rot) bei major, `#f97316` (orange) bei minor
- Kein Incident → Badge leer

---

### Schritt 8 — Animationen (2026-04-02)
**Dateien:** `content.css`, `popup.css`, `content.js`, `popup.js`

- `@keyframes csm-pulse` / `@keyframes p-pulse`: Opacity 100% → 45% → 100%
- Pulse-Klasse `.csm-pulsing` / `.p-pulsing` wird gesetzt wenn Status `orange` oder `red`
- `@media (prefers-reduced-motion: reduce)`: Alle Animationen und Transitions deaktiviert
- CSS-Grid-Animation für Widget-Expand (sauberer als `max-height`)

---

### Schritt 9 — Einstellungsseite (2026-04-02)
**Dateien:** `popup.html`, `popup.js`, `popup.css`

**HTML:**
- `#p-main-view` (default) und `#p-settings-view` (hidden)
- ⚙-Button im Popup-Header öffnet Settings-View
- ← Zurück-Button in Settings-Header

**Settings:**
| Setting | Storage-Key | Default |
|---------|-------------|---------|
| Erscheinungsbild (Toggle: Hell/Dunkel) | `csm-theme` | `dark` |
| Benachrichtigungen (Toggle) | `csm-notify` | `false` |
| Sprache (Dropdown) | `csm-lang` | `de` |
| Aktualisierungsintervall (Dropdown) | `csm-poll-interval` | `1` (Min.) |

**JS:**
- `openSettings()` / `closeSettings()` tauschen View
- Settings-Labels werden beim Öffnen sprachabhängig gesetzt
- Änderungen schreiben direkt in `chrome.storage.local`
- Intervall-Änderungen lösen Alarm-Neuanlage in `background.js` aus

---

### Schritt 10 — Accessibility (2026-04-02)
**Dateien:** `content.js`, `popup.html`

**Widget (content.js):**
- Widget: `role="complementary"`, `aria-label="Claude Status Monitor"`
- Header: `role="button"`, `tabindex="0"`, `aria-expanded` (dynamisch)
- Status-Dot: `role="img"`, `aria-label` dynamisch mit Statustext
- Chevron + Lang-Pfeil: `aria-hidden="true"`
- Lang-Button: `aria-label="Sprache wählen"`, `aria-haspopup="listbox"`
- Theme-Button: `aria-label="Theme wechseln"`
- Keyboard: `Enter`/`Space` auf Header triggert Expand/Collapse

**Popup (popup.html):**
- Buttons: `aria-label` für alle Icon-Buttons
- Lang-Menü: `role="listbox"`, Options: `role="option"`
- Uptime-Bars: `role="img"` mit `aria-label`
- Incident/Maintenance/History-Listen: `role="list"`
- Timestamp: `role="status"`, `aria-live="polite"`

---

## Dateiübersicht v2

| Datei | Änderungen |
|-------|-----------|
| `manifest.json` | v2.0, notifications-Permission, shared.js Content-Script |
| `shared.js` | NEU — gemeinsame Konstanten |
| `background.js` | Komplett neu: 1 Alarm, fetchAll(), Badge, Notifications |
| `content.js` | innerHTML→createElement, Theme, A11y, Pulse |
| `content.css` | CSS-Vars, Dark/Light, Grid-Animation, Pulse |
| `popup.html` | Theme/Settings-Buttons, Settings-View, aria-Attribute |
| `popup.js` | Theme, Settings-Panel, Pulse-Dot |
| `popup.css` | CSS-Vars, Dark/Light, Toggle-Switch, Settings-Styles |

---

---

### Nachbesserung — Theme-Icons & Glassmorphism (2026-04-02)
**Dateien:** `content.js`, `popup.js`, `content.css`

**Icons getauscht:**
- 🌙 = Dark-Modus aktiv (zeigt aktuellen Zustand)
- ☀️ = Light-Modus aktiv (zeigt aktuellen Zustand)
- Vorher war es umgekehrt (zeigte jeweils das Ziel-Theme)

**Glassmorphism für Widget (`content.css`):**
- Hintergrund semi-transparent: Dark `rgba(18,18,18,0.72)`, Light `rgba(255,255,255,0.68)`
- `backdrop-filter: blur(14px) saturate(180%)` — Widget "frosted glass" über claude.ai
- `box-shadow` zweischichtig: äußerer Schatten + innerer Highlight-Streifen
- `border-radius: 20px` — Pill-Form im kollabierten Zustand
- Beim Expandieren: `border-radius: 20px 20px 0 0` (untere Ecken eckig)
- Abstand von Bildschirmkante auf 16px erhöht
- Lang-Menü: ebenfalls glassmorphism `rgba(28,28,28,0.82)` + Blur + runder (`border-radius: 10px`)

---

## Offene Punkte / Bekannte Einschränkungen

- Das Lang-Menü im Widget liegt außerhalb des Widget-DOM (im `body`), daher CSS-Variablen
  nicht ererbbar → Inline-Style-Lösung in `applyTheme()`
- `firefox.storage.onChanged` in background.js setzt Alarm bei Intervall-Änderung neu;
  aktuelle Laufzeit des alten Alarms wird nicht abgewartet
- Notifications benötigen `csm-notify: true` in Storage (Default: false/undefined = aus)
