# Kritzelkönig – Umsetzung Phase 5–7 & Zusatzwünsche (Abnahme)

Stand: intern getestet, **noch nicht deployed** (bewusst, wie gewünscht).

## Phase 5 – Plattform-/Werbe-Adapter (Gerüst)
- Adapter-Schicht `Platform` (Standalone / CrazyGames), Werbe-Adapter `NoOpAdAdapter`.
- Spielcode ruft **nie** direkt ein SDK auf. Basic Launch = **keine echte Werbung**.
- Hooks verdrahtet: Laden-Ende, Gameplay-Start/Stop.

## Phase 6 – Zwischenstände + Werbepause am vollständigen Rundenende
- Serverfluss `playing → roundend → round_intermission → countdown → playing`.
- Werbepause **nur** wenn alle aktiven Spieler einmal gezeichnet haben (`lapSizeOf`).
- Client: Audio pausieren, `requestMidgameAd()` (NoOp), dann „bereit"; **12 s Timeout-Fallback**, bleibt nie hängen. Solo-Test löst keine Pause aus.

## Phase 7 – Zusatzwünsche
### 1. Fairplay-Hinweis
- Overlay „🎨 Fair zeichnen!" mit Nicht-erlaubt/Erlaubt-Listen + Button **Verstanden**.
- Erscheint **einmal pro Mehrspieler-Partie**, vor der ersten Zeichenrunde (nicht nach jeder Runde/Zeichnung, nicht im Solo-Test).
- Kleiner, unaufdringlicher Zeichner-Hinweis in der Kopfleiste: „nur zeichnen – keine Buchstaben/Zahlen" (verdeckt die Zeichenfläche nicht).
- Keine automatische Abstimmung nach Zeichnungen.

### 2. Schimpfwort-/Beleidigungsfilter
- Listen getrennt von der Logik unter `moderation/`:
  `blocked_words_de.json`, `blocked_words_en.json`, `whitelist_de.json`, `whitelist_en.json`.
- **Serverautoritativ** (`containsBlocked`). Prüft Namen, Rateeingaben und sichtbaren Text.
- Erkennt Umgehungen: Groß/Klein, Leerzeichen, Punkte, Bindestriche, Unterstriche, Sternchen, Zahl-Buchstaben-Ersetzungen (`W0RT`, `W.O.R.T`, `W-O-R-T`, `W*O*R*T`, `S C H E I S S E`).
- Fehlalarm-Schutz: Wortgrenzen/Token, Teilwort erst ab Länge 4, **Whitelists** (u. a. Scunthorpe-Problem). Getestet: harmlose Wörter wie *Klasse, Grafiker, Truhe, Schwanz, class, assassin, Scunthorpe, Massachusetts* bleiben erlaubt.
- Gesperrter **Name**: nicht übernehmen, Feld markiert, neuer Name nötig.
- Gesperrte **Rateeingabe**: nicht übertragen, nicht im Verlauf, keine Punkte; freundlicher Hinweis („Dieser Ausdruck kann im Spiel nicht verwendet werden…"). Keine dauerhafte personenbezogene Speicherung.

### 3. Symbolhilfe entfernt
- Zentrale Schaltung `ENABLE_SYMBOL_HELP = false` (Server). Bild-/Emoji-Hilfe bei Wortauswahl und für den Zeichner deaktiviert → schlichtere UI, weniger Ladelast, faire Bedingungen.
- **Assets (`img/pics/`, `emojis_de.json`) bleiben vorerst erhalten** und werden erst nach erfolgreichem Test endgültig gelöscht (wie gewünscht).

### 4. Keine automatische Mogelprüfung
- Keine KI-Erkennung für Buchstaben/Zahlen, keine Pflicht-Abstimmung.
- `ENABLE_REPORT_CHEATING = false` als vorbereiteter, **nicht aktivierter** Seam für ein späteres optionales „Mogeln melden" (nur nach ausdrücklicher Freigabe).
- Gastgeber kann bei absichtlichem Fehlverhalten eingreifen (Spiel beenden/neu).

## Tests (intern, isoliert)
- Filter: Umgehungen blockiert, harmlose Wörter erlaubt – **0 Fehltreffer** im Testset.
- Fairplay: nur einmal pro Partie, Solo ausgenommen.
- Intermission/Countdown/Timeout-Fallback: Übergänge korrekt.
- Neue Client-/Server-Blöcke: Syntaxprüfung bestanden.

## Offene/aufgeschobene Punkte
- `locales/*.json` (UI-Sprachen auslagern): bewusst **nicht** migriert, um die funktionierende Inline-i18n nicht zu gefährden (nur die genannten Punkte geändert). Kann später separat erfolgen.
- Endgültiges Löschen der Symbol-Assets nach bestandenem Live-Test.
- Voller `node --check` der Gesamtdateien vor dem Deploy auf dem Klon (lokaler Mount-Cache liefert die großen Dateien aktuell abgeschnitten; Host-Dateien sind vollständig).
