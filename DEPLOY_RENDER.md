# 🚀 Kritzelkönig auf Render hochladen (kostenlos) – Schritt für Schritt

Du brauchst zwei kostenlose Konten: **GitHub** (für die Dateien) und **Render** (fürs Hosting).
Beides ohne Kreditkarte möglich. (Konten musst du selbst anlegen – das kann ich nicht für dich tun.)

## Vorbereitung
Stelle sicher, dass im Ordner `C:\Kritzelkönig` alles vollständig ist:
- `server.js`, `index.html`, `words_de.json`, `words_en.json`
- `manifest.json`, `sw.js`, `package.json`, `render.yaml`
- Ordner `img/` (inkl. `icon-192.png` + `icon-512.png`!) und `sounds/`

> Die kleinen Hilfsdateien `HIER_*.txt` und `_writetest.txt` kannst du vorher löschen – sie stören aber nicht.

---

## Schritt 1 – Dateien zu GitHub (einfachster Weg, ohne Programme)
1. Auf https://github.com anmelden → oben rechts **+ → New repository**.
2. Name z. B. `kritzelkoenig`, **Public**, dann **Create repository**.
3. Auf der neuen Seite: **„uploading an existing file"** anklicken.
4. **Alle Dateien und die Ordner** `img` und `sounds` aus `C:\Kritzelkönig` per
   Drag & Drop ins Browserfenster ziehen → unten **Commit changes**.

## Schritt 2 – Render verbinden
1. Auf https://render.com mit dem **GitHub-Konto** anmelden.
2. **New → Web Service** → dein Repo `kritzelkoenig` auswählen.
3. Render erkennt durch `render.yaml`/`package.json` automatisch:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free
   (Falls nicht automatisch: Werte wie oben eintragen, Runtime = Node.)
4. **Create Web Service** klicken und ~1–2 Min warten.

## Schritt 3 – Spielen
Render zeigt dir eine Adresse wie `https://kritzelkoenig.onrender.com`.
Die öffnen alle Mitspieler im Browser – **weltweit**. Über das Browser-Menü
lässt sich die App **zum Startbildschirm hinzufügen** (PWA, mit Icon).

---

## Updates später
Wenn du etwas änderst: die geänderte Datei auf GitHub neu hochladen (oder ersetzen) →
Render baut automatisch neu.

## Gut zu wissen (Gratis-Plan)
- Nach ~15 Min ohne Besucher „schläft" der Dienst → der **erste** Aufruf danach dauert kurz.
- Beim Einschlafen werden offene Räume zurückgesetzt (einfach neuen Raum erstellen).
- Für dauerhaft „immer wach" gibt es kostenpflichtige Pläne – für ein Partyspiel nicht nötig.
