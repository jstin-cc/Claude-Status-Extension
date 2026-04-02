# Claude Status Monitor — Änderungsprotokoll v2

Dieses Dokument hält alle Änderungen von v1 → v2 fest.
Die v1 liegt unverändert in `claude-status-extension/`.
Die v2 wird in `claude-status-extension-v2/` entwickelt.

**Stand: 2026-04-02 — Alle Schritte + Nachbesserungen abgeschlossen.**

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
