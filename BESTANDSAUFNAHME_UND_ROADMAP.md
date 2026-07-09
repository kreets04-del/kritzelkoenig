# Kritzelkönig – Bestandsaufnahme & Umbau-Roadmap (CrazyGames-Vorbereitung)

Stand: Phase 0 (Analyse). Dieses Dokument ist die geforderte Architektur-Übersicht,
Lücken-Analyse und der Phasenplan. Umgesetzt wird **auf dem bestehenden Code**,
funktionierende Funktionen bleiben erhalten.

---

## 1. Ist-Architektur (real im Projekt)

| Bereich | Ist-Zustand |
|---|---|
| **Frontend** | **Eine Datei** `index.html` (~800 Zeilen: HTML + CSS + Vanilla-JS inline). Kein Build-System, keine Module, kein Bundler. |
| **PWA** | `manifest.json` + `sw.js` (installierbar), App-Icons vorhanden. |
| **Backend** | `server.js` (~820 Zeilen), **reines Node.js ohne Abhängigkeiten**. Liefert `index.html` + statische Dateien (`/img`, `/sounds`, `/manifest.json`, `/sw.js`). |
| **Transport** | **Server-Sent Events (SSE)** für Server→Client (`/events`) + **POST** für Client→Server (`/action`). **KEIN WebSocket.** |
| **State** | In-Memory-Räume in **einem** Server-Prozess. Host-autoritativ. |
| **Begriffe** | `words_de.json` (1500, davon 500 „Easy"), `words_en.json`, `emojis_de.json`, `img/pics/` (500 S/W-Zeichnungen). |
| **Deploy** | GitHub → Render (Node Web Service, Free-Plan). Auto-/Manual-Deploy. |
| **Videos** | `Kritzelkoenig_Intro.mp4` (DE) + `_EN.mp4` (EN), je ~2,7 MB, 9:16. |

### Wichtiger Hinweis: SSE statt WebSocket
Der Auftrag spricht durchgehend von **WebSocket/`wss://`/CORS**. Real ist der Transport
**SSE + POST**. Das läuft über Render (HTTPS) stabil und ist in einem CrazyGames-iframe
grundsätzlich nutzbar. Eine WebSocket-Migration ist möglich, aber ein separater Serverumbau
(siehe offene Punkte). **Empfehlung:** für den Basic Launch SSE beibehalten.

---

## 2. Was die Anforderungen BEREITS erfüllt (nicht neu bauen!)

- **§5 Identische Zeichenfläche:** Striche werden bereits als **normalisierte Koordinaten `0..1`** übertragen (`relPoint`), und die Zeichenbühne (`.canvas-stage`) hat ein **festes Seitenverhältnis** → auf allen Geräten geometrisch identisch, keine Verzerrung/kein Cropping. *(Aktuell 4:5; der Auftrag wünscht 1:1 — leicht umstellbar, siehe Phase 3.)*
- **§8 Raum:** 4-stelliger Code, Host-autoritativ, **Wort nur an den Zeichner**, Bereinigung leerer/abgelaufener Räume, Rundenanzahl, max. Spieler – vorhanden.
- **§16 Eingabe:** Pointer Events (`pointerdown/move/up/cancel`), `touch-action:none`, `user-select:none` – vorhanden.
- **§2 Sprache:** DE/EN vorhanden (Wörterbuch + `data-i18n`), **raumweit vom Host** gesetzt. *(Fehlt: separate `locales/*.json`, UI-Sprache unabhängig von Raumsprache.)*
- **§19 Audio:** startet erst nach Nutzeraktion, Ton an/aus, pausierbar.
- **§20 Datenschutz:** freie Namen, keine Registrierung, keine gespeicherten Zeichnungen, `esc()` gegen HTML-/Script-Injektion, Auto-Löschung von Räumen.
- **Team-Modus, Wortauswahl (3 Begriffe), Bild-/Emoji-Hilfe, Punktelogik (Restsekunden + Multiplikatoren), Sprach-Rateeingabe (🎤)** – vorhanden.

---

## 3. Lücken (Soll vs. Ist) – was noch fehlt

| § | Anforderung | Status |
|---|---|---|
| 2 | Startbildschirm mit **Format-Auswahl 9:16 / 16:9** + Auto-Empfehlung | fehlt |
| 2 | `locales/*.json` (ausgelagerte Sprachdateien), UI- vs. Raum- vs. Begriffssprache getrennt | teils (inline) |
| 3 | **Tutorial-Komponente** (Video im Spiel, Skip, „nicht mehr zeigen", Untertitel/WebVTT, Lazy-Load, Text-Fallback) | fehlt |
| 3 | Storage-Adapter (LocalStorage / CrazyGames Data) für Tutorial-Flag | fehlt |
| 7 | Eigenständiges **16:9-Desktop-Layout** (Seitenpanels, Dekor) | fehlt |
| 9 | **Einladungslink** + QR + Web Share + **Auto-Beitritt** (`?room=&invite=`) | fehlt |
| 10 | **Einzelspieler-Testmodus** mit simuliertem Computer-Rater | fehlt |
| 11–14 | **Plattform-Adapter** (Standalone/CrazyGames), **Ad-Adapter** (NoOp/CrazyGames), SDK-Init, Werbepause am Rundenende, servergesteuerte **Intermission-States** | fehlt |
| 15 | WebSocket/`wss`/CORS-Härtung, Rate-Limits, Reconnect mit Session-Token | teils (SSE, Basis-Reconnect) |
| 18 | Code-Splitting, WebM-Video, getrennte Module | fehlt (Einzeldatei) |
| 23 | Modulare `src/`-Struktur | fehlt (Einzeldatei) |

---

## 4. Zwei grundsätzliche Weichenstellungen (deine Entscheidung, blockierend)

### A) Architektur-Ansatz
Die gewünschte `src/`-Modulstruktur (getrennte Module, Code-Splitting) bedeutet praktisch
einen **Umbau auf ein Build-System** (z. B. Vite). Das steht im Spannungsverhältnis zu
„das Spiel nicht neu schreiben".
- **A1 – Einzeldatei behalten & sauber modular erweitern** *(empfohlen für schnellen CrazyGames-Start)*: kein Build, geringes Risiko, alle Funktionen bleiben. Die geforderte Trennung (Adapter, Layouts, i18n) wird **logisch** umgesetzt (klare Module im Code + ausgelagerte `locales/*.json`), aber ohne die formale Ordnerstruktur.
- **A2 – Umbau auf Vite/Module**: liefert die formale `src/`-Struktur & echtes Code-Splitting, kostet aber deutlich mehr Zeit und birgt Risiko für bestehende Funktionen.

### B) Koordination mit Codex
`server.js` und `index.html` werden **parallel auch von Codex** bearbeitet. Ein Umbau dieser
Größe **muss von einem Werkzeug allein** erfolgen – sonst überschreiben wir uns gegenseitig
(ist in diesem Projekt bereits passiert). Bitte für die Dauer des Umbaus **nur mich** an diesen
zwei Dateien arbeiten lassen, oder klar aufteilen.

---

## 5. Phasen-Roadmap (Vorschlag)

- **Phase 0 (fertig):** Analyse, Backup (`_backup_…/`), diese Doku, `CRAZYGAMES_PREPARATION.md`, `.env.example`.
- **Phase 1:** Startbildschirm **Format (9:16/16:9) + Sprache** mit Auto-Empfehlung · **Tutorial-Komponente** (Video Lazy-Load, Skip, „nicht mehr zeigen", Text-Fallback) · **StorageAdapter**.
- **Phase 2:** **Einladungslink** + QR + Web Share + **Auto-Beitritt** (`?room=&invite=`) · Fehlerzustände (§21).
- **Phase 3:** Eigenständiges **16:9-Layout** · Canvas auf festes Verhältnis (1:1 optional) · Safe-Areas (Notch/Dynamic Island).
- **Phase 4:** **Einzelspieler-Testmodus** + `SimulatedGuessProvider` (Schnittstelle für spätere echte Bilderkennung).
- **Phase 5:** **Plattform-Adapter** (`platformAdapter`, `standaloneAdapter`, `crazyGamesAdapter`) + **Ad-Adapter** (`NoOpAdAdapter`) + SDK-Schnittstellen (ohne echte Werbung).
- **Phase 6:** Servergesteuerte **Intermission-States** (`playing → round_results → round_intermission → waiting_for_players → countdown`) + Werbepause **nur am vollständigen Rundenende** (Gerüst, im Basic Launch NoOp).
- **Phase 7:** `locales/*.json` auslagern · WebM/WebVTT · Ladezeit-Optimierung · Tests · Endabnahme-Doku.

---

## 6. Offene Punkte / benötigte Entscheidungen

1. **Architektur A1 vs. A2** (Einzeldatei erweitern vs. Vite-Umbau).
2. **Codex-Koordination** (nur ein Werkzeug an server.js/index.html).
3. **Transport**: SSE beibehalten (empfohlen für Basic Launch) oder WebSocket-Migration (Auftrag wünscht `wss`).
4. **Canvas-Verhältnis**: 4:5 beibehalten (bestehend) oder auf **1:1** umstellen (Auftrag empfiehlt 1:1). Umstellung ist unkritisch, weil Koordinaten normalisiert sind.
5. **CrazyGames-Konto/SDK-Key**: benötigt für die echte Integration (später) – Adapter wird jetzt nur vorbereitet, **keine Keys im Frontend**.
6. **Tutorial-Video im CrazyGames-Build**: mp4 vorhanden; WebM + WebVTT-Untertitel müssten noch erzeugt werden (Asset-Liste s. `CRAZYGAMES_PREPARATION.md`).

---

## 7. Nicht angetastet / bewusst beibehalten

Multiplayer-SSE-Logik, Raumverwaltung, Wort-Geheimhaltung, normalisierte Zeichenübertragung,
Begriffsdateien, 500 Bild-Hilfen, Team-Modus, Punktelogik, PWA, Render-Deploy. Diese laufen und
werden **erweitert, nicht ersetzt**.
