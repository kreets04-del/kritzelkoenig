# 🌍 Kritzelkönig online stellen (für alle, installierbar)

## Kurz: Geht das mit Netlify?
**Nein – nicht so.** Netlify (und GitHub Pages, Vercel statisch) hosten nur **statische** Dateien.
Kritzelkönig braucht aber einen **dauerhaft laufenden Node-Server** (`server.js`) mit Live-Verbindung
(Räume, Punkte, Wort-Geheimhaltung). Den kann Netlify nicht betreiben.

Du brauchst einen Anbieter, der **Node.js dauerhaft** laufen lässt. Gute, meist kostenlose Optionen:
**Render**, **Railway**, **Fly.io**, **Glitch**, **Replit**.

---

## Empfehlung: Render.com (einfach, kostenloser Plan)

1. Lege die Dateien in ein **GitHub-Repository** (alles aus `C:\Kritzelkönig\`).
2. Bei https://render.com anmelden → **New → Web Service** → dein Repo wählen.
3. Einstellungen:
   - **Runtime:** Node
   - **Build Command:** *(leer lassen – keine Abhängigkeiten)*
   - **Start Command:** `node server.js`
4. Render gibt dir eine öffentliche Adresse, z. B. `https://kritzelkoenig.onrender.com`.
   Diese öffnen alle Mitspieler – **weltweit**, nicht mehr nur im selben WLAN.

> Wichtiger Code-Hinweis: Der Server muss den von der Plattform vorgegebenen Port nutzen.
> In `server.js` steht aktuell `const PORT = 3000;`. Für Render/Railway/… besser:
> `const PORT = process.env.PORT || 3000;`
> (Sag mir Bescheid, dann ändere ich das für dich – dann läuft es lokal **und** online.)

---

## Installierbar machen (PWA) – ist schon vorbereitet
Das Spiel ist bereits eine **PWA**: Es gibt `manifest.json`, einen Service Worker (`sw.js`)
und ein App-Icon. Sobald es über **https://** läuft (Render liefert automatisch https):

- **Android/Chrome:** Menü → „App installieren" / „Zum Startbildschirm".
- **iPhone/Safari:** Teilen → „Zum Home-Bildschirm".

Dann erscheint Kritzelkönig wie eine echte App mit eigenem Icon.

Voraussetzung: Das App-Icon muss als `img/icon-512.png` **und** `img/icon-192.png` im Ordner liegen
(siehe `ASSETS_DOWNLOAD.md`).

---

## Lokal (WLAN) bleibt natürlich weiter möglich
Ohne Online-Hosting läuft alles wie bisher: `node server.js` starten und die `http://192.168…:3000`-Adresse
im selben WLAN öffnen.
