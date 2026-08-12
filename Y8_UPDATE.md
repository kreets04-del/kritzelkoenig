# Kritzelkoenig auf Y8 mit Werbung aktualisieren

Die Y8-Version zeigt eine Werbeanfrage an zwei sicheren Stellen:

1. synchronisiert vor dem eigentlichen Spielstart;
2. nach einer vollstaendig abgeschlossenen Runde, bevor die naechste Runde startet.

Während Zeichnen, Raten oder eines laufenden Timers wird keine Werbung angefragt. Musik,
laufende Soundeffekte und WebAudio werden vor der Anzeige gestoppt. Alle verbundenen
Y8-Spieler melden das Anzeigenende an den Server; danach beginnt fuer alle derselbe Countdown.

## Y8-Konfiguration

Das Spiel verwendet die neue Minimal SDK direkt von Y8s CDN:

- Game ID: `278345`
- App ID: derzeit im Portal `Not yet available`

Die Game ID reicht fuer die Anzeigenintegration aus. Die optionale App ID wird vor allem fuer
Y8-Login und weitere Kontofunktionen verwendet; deshalb startet dieses Build das SDK mit
deaktiviertem Auto-Login. Es werden keine alten AFP-, AdSense- oder Channel-IDs eingebaut.

## Produktions-ZIP erstellen

Im Projektordner:

```powershell
npm run build:y8
```

Optional koennen Backend und spaeter eine App ID ueberschrieben werden:

```powershell
$env:Y8_API_BASE='https://kritzelkoenig.onrender.com'
$env:Y8_APP_ID='APP_ID_AUS_DEM_Y8_PORTAL'
npm run build:y8
```

Das fertige Upload-Paket liegt danach unter `dist/Kritzelkoenig_Y8.zip`.

Y8 liefert laut aktueller SDK-Dokumentation waehrend der Pruefung automatisch Testanzeigen
und nach Freigabe echte Anzeigen. Dafuer ist kein Testschalter im Spiel erforderlich.
