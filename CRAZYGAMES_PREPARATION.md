# CRAZYGAMES_PREPARATION.md

Vorbereitung von **Kritzelkönig** für die Veröffentlichung auf CrazyGames – ohne die
bestehende Web-/Render-Version zu brechen. Dieses Dokument beschreibt die geplanten
Schnittstellen, die Canvas-Regeln, Einladungslinks, Werbe-/Plattform-Adapter und die
Abnahme-Checkliste. Umsetzung erfolgt in Phasen (siehe `BESTANDSAUFNAHME_UND_ROADMAP.md`).

> **Grundsatz:** Der Spielcode ruft **niemals** direkt das CrazyGames-SDK auf. Alles läuft
> über einen Plattform-Adapter. Ohne SDK läuft das Spiel unverändert auf der eigenen Webseite.
> **Keine geheimen Keys im Frontend.**

---

## 1. Kanonische Zeichenfläche (verbindlich)

- **Logische Größe:** normalisierte Koordinaten **`x, y ∈ [0..1]`** (bereits im Bestand!).
- **Seitenverhältnis der Bühne:** fest (Empfehlung **1:1**; aktuell 4:5). Auf **9:16 und 16:9 identisch**.
- **Strichdaten-Format (raumweit gleich):**
  ```json
  { "points": [{ "x": 0.25, "y": 0.40 }, { "x": 0.27, "y": 0.43 }],
    "color": "#111111", "width": 0.008, "tool": "brush" }
  ```
- **Mittelpunkt** liegt auf **jedem** Gerät bei `x=0.5, y=0.5`.
- Bei Resize/Rotation wird die Zeichnung **komplett aus den Strichdaten neu gezeichnet** (bereits so via `redraw()`).
- Regeln: keine Verzerrung, kein Stretching, kein Cropping, keine zusätzliche Zeichenfläche auf PC; Pinselstärke **relativ** zur Bühne (`width` als 0..1).

## 2. Plattform-Adapter (`platform/`)

```
platform/
├── platformAdapter.js      // wählt zur Laufzeit Standalone oder CrazyGames
├── standaloneAdapter.js    // eigene Webseite / Render
├── crazyGamesAdapter.js    // CrazyGames HTML5-SDK (später)
└── adAdapter.js            // NoOpAdAdapter | CrazyGamesAdAdapter
```

Mindest-API des Plattform-Adapters:
```
init(), isCrazyGames(),
gameplayStart(), gameplayStop(), loadingStart(), loadingStop(),
createInviteLink(roomData), readInviteParams(),
saveSetting(key, val), loadSetting(key),
audioPause(), audioResume(),
requestMidgameAd()  // via adAdapter
```

Ad-Adapter:
```ts
interface AdAdapter { requestMidgameAd(): Promise<"finished"|"unavailable"|"error">; }
```
- **Basic Launch:** ausschließlich `NoOpAdAdapter` (liefert sofort `"unavailable"`, keine echte Werbung).
- **Full Launch (später):** `CrazyGamesAdAdapter` ruft die offizielle Midgame-Ad an.
- Das Spiel muss **immer** funktionieren, auch wenn Werbung fehlschlägt / geblockt / nicht verfügbar ist.

## 3. Einladungslinks

- **Standalone:** `https://DEINE-DOMAIN/?room=4827&invite=<TOKEN>`
- **CrazyGames:** offizieller CrazyGames-Invite-Link über den Adapter (`inviteLink.*` des SDK).
- Beim Öffnen: Invite-Parameter **früh** auslesen → Raum merken → Format-/Sprachwahl → Tutorial (falls nicht deaktiviert) → Name → Raum am Server validieren → **direkt in die Lobby** (kein erneuter Code nötig).
- **Teilen:** `navigator.share(...)` wo verfügbar; Fallback: Link kopieren (+ Bestätigung) und **QR-Code** (gleicher Link).
- Freundliche Fehler: Raum existiert nicht / abgelaufen / voll / bereits gestartet / Server nicht erreichbar.

## 4. Storage-Adapter

- Schlüssel **versioniert**, z. B. `kritzelkoenig_tutorial_hidden_v1`, `kritzelkoenig_format_v1`, `kritzelkoenig_uilang_v1`.
- Standalone: **LocalStorage**. CrazyGames: später **CrazyGames Data Module**. Fallback: LocalStorage.

## 5. Werbepause – nur am vollständigen Rundenende (Full Launch)

„Vollständige Runde" = **alle aktiven Spieler waren einmal am Zeichnen**. Nicht nach jedem Zeichner.
Servergesteuerter Ablauf (Zustände):
```
playing → round_results → round_intermission → waiting_for_players → countdown → playing
```
1. Letzter Zeichner fertig → `round_results` anzeigen.
2. Server setzt `round_intermission`; Clients stoppen Timer/Aktionen, **pausieren Audio**, zeigen Blocker-Screen.
3. `adAdapter.requestMidgameAd()` (im Basic Launch = NoOp).
4. Client meldet `client_ready_after_intermission`.
5. Server startet nächste Runde, **wenn alle bereit** ODER **Timeout** erreicht → dann **synchroner Countdown**.
6. Kein Spieler bleibt wegen fehlender Werbung hängen. Audio nur fortsetzen, wenn vorher aktiv.

## 6. Render / Verbindung (§15)

- HTTPS via Render ✓. Transport aktuell **SSE** (kein `wss`). Für CrazyGames-iframe nutzbar; WebSocket-Migration ist optional/später.
- Zu härten: erlaubte Ursprünge (CrazyGames-Domains), Reconnect mit Session-Token, doppelte Spieler vermeiden, Rate-Limits (Raumerstellung, Nachrichtenfrequenz), Validierung aller Eingaben. Strichpunkte gebündelt senden (bereits gedrosselt).

## 7. Benötigte NEUE Assets (Vorschlag, nichts überschreiben)

| Datei | Größe | Verhältnis | Zweck | Hintergrund |
|---|---|---|---|---|
| `img/bg_wide.png` | 2560×1440 | 16:9 | Desktop-Hintergrund (kein gestrecktes 9:16) | undurchsichtig |
| `img/panel_side.png` | ~500×1440 | – | seitliche Dekor-Panels (16:9) | transparent |
| `video/tutorial_de.webm` + `.mp4` | 1080×1920 | 9:16 | Tutorial (Lazy-Load) | – |
| `video/tutorial_en.webm` + `.mp4` | 1080×1920 | 9:16 | Tutorial EN | – |
| `video/tutorial_poster.jpg` | 1080×1920 | 9:16 | Vorschaubild | – |
| `video/tutorial_de.vtt` / `_en.vtt` | – | – | WebVTT-Untertitel | – |

*(Die vorhandenen `Kritzelkoenig_Intro*.mp4` können als Basis/Platzhalter für das Tutorial dienen; WebM + VTT müssten noch erzeugt werden.)*

## 8. Abnahme-Checkliste (Auszug §27)

- [ ] 9:16 auf Smartphone wählbar, 16:9 auf PC/Tablet wählbar (mit Auto-Empfehlung)
- [ ] DE/EN funktionieren; UI-Sprache unabhängig von Raumsprache
- [ ] Tutorial: abspielen / überspringen / „nicht mehr zeigen" (persistent) / später erneut öffnbar / Text-Fallback
- [ ] 4-stelliger Raumcode + teilbarer Einladungslink (+ QR) → führt auf anderem Gerät direkt in die Lobby
- [ ] Zeichenfläche auf 9:16 und 16:9 **geometrisch identisch**; Resize/Rotation zerstört nichts
- [ ] Einzelspieler-Modus ohne Freunde spielbar; Computer rät glaubwürdig
- [ ] Basic Launch **ohne** Werbung; Werbefehler unterbrechen das Spiel nie
- [ ] Werbung (später) nur an vollständigen Rundenenden
- [ ] Spiel läuft **ohne** CrazyGames-SDK weiter (eigene Webseite)
- [ ] Render + Verbindung stabil; keine Kernfunktion verloren

## 9. Nicht tun (aus dem Auftrag)

Kein Komplett-Rewrite · keine zweite Zeichenlogik · keine unterschiedliche Zeichenfläche
Handy/PC · keine Werbung im Basic Launch · keine Fremdwerbung in der CrazyGames-Version ·
keine Zahlungen · keine Secrets im Frontend · keine echte externe KI ohne Freigabe ·
keine Grafiken ungefragt überschreiben · nicht automatisch öffentlich deployen.
