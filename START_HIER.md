# 🎨 Kritzelkönig – So spielst du

Echtes WLAN-Multiplayer: **ein** Gerät startet den Server, **alle** spielen im Browser. Keine Installation auf den Mitspieler-Geräten nötig – nur ein Browser.

---

## 1. Einmalig: Node.js installieren (nur auf dem Host-Gerät)

Node.js ist das Programm, das den kleinen Spielserver laufen lässt.

- Download: https://nodejs.org → die **LTS**-Version installieren.
- Prüfen (Eingabeaufforderung / Terminal):
  ```
  node --version
  ```
  Wenn eine Versionsnummer erscheint (z. B. `v22.x`), passt alles.

> Nur das Gerät, das den Server startet, braucht Node.js. Die Mitspieler brauchen **nichts** außer einem Browser.

---

## 2. Server starten (Host-Gerät)

1. Eingabeaufforderung (Windows: „cmd") oder Terminal öffnen.
2. In den Ordner wechseln:
   ```
   cd C:\Kritzelkönig
   ```
3. Server starten:
   ```
   node server.js
   ```
4. Es erscheint z. B.:
   ```
   Andere Geräte im WLAN öffnen:
       http://192.168.0.23:3000
   ```
   **Diese Adresse merken** – die brauchen die Mitspieler.

Beenden: `Strg + C` im Terminal.

---

## 3. Mitspielen

- **Host-Gerät:** Browser öffnen → `http://localhost:3000`
- **Alle anderen Geräte (im selben WLAN):** Browser öffnen → die angezeigte Adresse, z. B. `http://192.168.0.23:3000`

Dann:
1. Namen eingeben.
2. Einer klickt **„Spiel erstellen"** → bekommt einen **4-stelligen Raum-Code**.
3. Alle anderen tippen **„Spiel beitreten"** und den Code ein.
4. Der Ersteller (Host) klickt **„Spiel starten"** (ab 2 Spielern).
5. Gerät **quer** halten 📱↻

---

## 3b. Neue Funktionen

- **Schwierigkeit:** In der Lobby wählt der **Host** zwischen 🧒 Leicht (Kinder), 🙂 Mittel, 🔥 Schwer oder 🎲 Gemischt.
- **Vollbild:** Im Spiel oben rechts auf **⛶** tippen.
- **Ton an/aus:** Oben rechts auf **🔊 / 🔇**. Eigene Soundeffekte kannst du ergänzen – siehe `ASSET_PROMPTS.md` (Ordner `sounds/`).
- **Pinselgrößen:** In der Werkzeugleiste über der Zeichenfläche (klein / mittel / groß).
- **Mehr Begriffe aus dem Internet (optional, experimentell):** Server so starten:
  ```
  node server.js --online
  ```
  Holt zusätzliche Begriffe aus der Wikipedia. Hinweis: nicht alle sind gut zeichenbar; ohne Internet wird automatisch nur die lokale Liste genutzt.

---

## 4. Spielregeln (Kurzfassung)

- Der Zeichner sieht den Begriff und zeichnet ihn in 60 Sekunden.
- Alle anderen tippen ihre Vermutung ein.
- Richtig geraten → **1 Punkt** und der Rater wird zum nächsten Zeichner.
- Nicht erraten → Wort wird aufgelöst, der Nächste zeichnet (reihum).
- Hinweise: nach 20/40/50 s werden einzelne Buchstaben aufgedeckt (nie der erste zuerst, nie das ganze Wort).
- **Wer zuerst 10 Punkte hat, gewinnt.**

Werkzeuge des Zeichners: **Pinsel**, **Radierer**, **Undo**, **Leeren**.

---

## 5. Wenn etwas nicht klappt

- **Mitspieler sehen die Seite nicht:** Alle im **selben WLAN**? Manche (Gäste-)Netze trennen Geräte voneinander – dann ein normales Heim-WLAN oder einen Handy-Hotspot nutzen.
- **Firewall-Frage beim ersten Start:** Zugriff im **privaten Netz erlauben**.
- **Falsche Adresse:** Genau die `http://…:3000`-Zeile aus dem Terminal verwenden (nicht `localhost` auf den anderen Geräten).
- **Server-IP ändert sich:** Bei jedem Neustart prüfen, welche Adresse das Terminal anzeigt.

---

## 6. Eigene Begriffe hinzufügen

Die Datei `words_de.json` öffnen und Einträge ergänzen:

```json
{ "wordId": "w061", "text": "Drache", "category": "Fantasie", "difficulty": "Medium" }
```

Umlaute funktionieren beim Raten automatisch (z. B. „Käse" = „Kaese"). Danach den Server neu starten.

---

## Dateien in diesem Ordner

| Datei | Zweck |
|---|---|
| `server.js` | Der Spielserver (Node.js) |
| `index.html` | Das Spiel im Browser (Menü, Lobby, Zeichnen, Raten) |
| `words_de.json` | Die Begriffsliste |
| `Kritzelkoenig_Technischer_Entwurf.md` | Vollständiger technischer Entwurf (auch für die Unity-Version) |
| `START_HIER.md` | Diese Anleitung |

Viel Spaß! 🎉
