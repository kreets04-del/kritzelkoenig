# Kritzelkönig bei Playgama veröffentlichen

Kritzelkönig ist ein Online-Mehrspieler-Spiel. Deshalb sind es **zwei getrennte
Schritte**, die beide gemacht werden müssen:

1. **Render aktualisieren** – der Server muss die neuen Sprachen kennen.
2. **Playgama-Paket hochladen** – der Client läuft auf Playgamas Domain und
   spricht von dort mit dem Render-Server.

Wird nur eins von beidem gemacht, wirkt es wie ein Fehler im Spiel: Das Paket ist
dann zum Beispiel auf Thai, bekommt vom Server aber deutsche Begriffe.

---

## Schritt 1 – GitHub

Diese Dateien sind neu oder geändert und müssen ins Repository:

| Datei | warum |
|---|---|
| `server.js` | lädt die neuen Wortlisten, erlaubt Playgama-Domains, `đ` in der Antwortprüfung |
| `index.html` | fünf Sprachen, Portal-Anschlüsse, Formatempfehlung, Anleitungssprache |
| `words_id.json`, `words_th.json`, `words_vi.json` | die neuen Begriffe |
| `platform/playgama.js` | die Playgama-Schicht (nur im Playgama-Paket aktiv) |
| `tools/build-playgama.js`, `tools/make-language.js`, `tools/lang/**` | Bauwerkzeuge |

Der Ordner `dist/` muss **nicht** ins Repository – der wird lokal gebaut.

## Schritt 2 – Render

Nach dem Push baut Render automatisch neu. Zwei Dinge danach prüfen:

**a) Startprotokoll.** Dort muss stehen: `Begriffe geladen: 1500`. Fehlt eine
Wortliste, fällt die Sprache still auf Deutsch zurück – das Spiel läuft weiter,
aber die Übersetzung fehlt.

**b) Umgebungsvariable `ALLOWED_ORIGINS`.** Das ist der Punkt, an dem es sonst
klemmt. Playgama verteilt dasselbe Spiel über viele Partnerportale mit jeweils
eigener Domain. Der Client läuft dort und ruft den Render-Server über CORS auf.

- Ist `ALLOWED_ORIGINS` **nicht gesetzt**, gilt `*` – alles erlaubt, es
  funktioniert sofort.
- Ist die Variable gesetzt, müssen die Playgama-Domains hinein. `playgama.com`,
  `playgama.io` und deren Unterdomains sind bereits fest im Server eingebaut,
  aber **die Partnerportale nicht** – die heißen anders und sind vorab nicht
  bekannt.

Empfehlung: `ALLOWED_ORIGINS` gar nicht setzen. Das ist hier vertretbar, weil der
Server keine Cookies benutzt. Wer mitspielen will, braucht Raumcode und
`sessionToken` – CORS schützt an dieser Stelle nichts, was nicht ohnehin über die
Tokens geschützt wäre. Ratenbegrenzung und Raumlimits bleiben unabhängig davon aktiv.

## Schritt 3 – Paket bauen

```bash
node tools/build-playgama.js
```

Ergebnis: `dist/playgama/` und `dist/Kritzelkoenig_Playgama_<Datum>.zip` (rund 7,7 MB).

Die Server-Adresse ist fest eingebaut (`https://kritzelkoenig.onrender.com`).
Andere Adresse:

```bash
PLAYGAMA_API_BASE=https://meine-adresse.onrender.com node tools/build-playgama.js
```

Der Build bricht ab, wenn etwas fehlt – ein halb kaputtes Paket kann nicht entstehen.

## Schritt 4 – Playgama-Dashboard

Das ZIP unter https://developer.playgama.com/applications/new-game hochladen.

Danach im Dashboard selbst eintragen, das kann kein Skript übernehmen:

- **Titel, Beschreibung, Kategorie, Altersfreigabe**
- **Titelbild und Screenshots**
- **Sprachen:** Englisch, Deutsch, Indonesisch, Thai, Vietnamesisch
- **Werbung aktivieren** (Interstitials). Ohne die Freigabe im Dashboard bleibt
  jede Anzeige leer – im Spiel sieht man dann in der Konsole `failed`, und es
  läuft einfach ohne Werbung weiter.
- **Game-ID:** Die Datei `playgama-bridge-config.json` im Paket ist eine leere
  Vorlage. Trägt Playgama die Kennung selbst ein, ist nichts zu tun. Verlangt das
  Dashboard eine ID im Paket, so bauen:
  ```bash
  PLAYGAMA_GAME_ID=<die-id> node tools/build-playgama.js
  ```

---

## Wo Werbung erscheint

Die Playgama-Vorgabe verbietet Werbung beim Zeichnen, beim Raten, bei laufender
Uhr und direkt beim Start. Danach richtet sich der Einbau:

| Stelle | Werbung? |
|---|---|
| Spielstart | **nein** – ausdrücklich ausgeschlossen |
| Rundenpause zwischen zwei Runden | ja |
| nach einer beendeten Partie („Neues Spiel") | ja |
| zurück zum Menü | ja |
| während des Zeichnens oder Ratens | nie – gibt es an diesen Stellen gar keinen Aufruf |

Zusätzlich liegen **mindestens drei Minuten** zwischen zwei Anzeigen. Eine
fehlgeschlagene Anzeige verbraucht diese Sperre nicht.

Während einer Anzeige ist der komplette Spielton aus (Musik pausiert,
Soundeffekte werden geschluckt); danach kommt er zurück.

**Der Mehrspieler-Teil bleibt geschützt:** Die Rundenpause ist eine echte Pause,
in der ohnehin alle warten. Meldet ein Spieler wegen einer hängenden Anzeige
nicht zurück, bricht der Server die Pause nach 35 Sekunden von sich aus ab. Die
Anzeige selbst gibt schon nach 25 Sekunden auf. Ein einzelner Spieler kann die
Partie also nicht anhalten.

## Rewarded Ads

Vorbereitet, aber noch nirgends im Spiel verwendet – so wie es die Vorgabe
verlangt. Aufruf für später:

```js
const belohnt = await KK_PLAYGAMA.zeigeRewarded();   // true nur bei vollständig gesehener Anzeige
```

## Was nicht automatisch geht

- Titelbild, Screenshots und Beschreibungstexte
- die Freigabe der Werbeformate im Dashboard
- die Prüfung durch Playgama selbst

## Anleitung im Spiel

Die Anleitungsvideos sind raus. An ihrer Stelle stehen fünf kurze Sätze, die in
allen fünf Sprachen vorliegen (`howStep1` bis `howStep5` in der Sprachtabelle).
Das spart rund 5 MB im Paket und löst nebenbei das Problem, dass es Videos nur
auf Deutsch und Englisch gab.

Die Anleitung öffnet sich weiterhin beim ersten Start und ist danach über
„📖 Anleitung" erreichbar; „Nicht mehr zeigen" bleibt wie gehabt.
