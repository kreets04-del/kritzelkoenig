# 🎨🔊 Kritzelkönig – Prompts für Grafiken & Sounds

Diese Datei enthält fertige KI-Prompts, um Bilder und Soundeffekte für das Spiel zu erzeugen
(z. B. mit Higgsfield, Midjourney, DALL·E, Ideogram für Bilder und ElevenLabs / Stable Audio / Suno für Töne).

**Einheitlicher Stil (für ALLE Grafiken):** moderner, fröhlicher Flat-/Vektor-Stil, kräftige Farben,
abgerundete Formen, kinderfreundlich, klare Konturen, leichter Verlauf, dunkelblauer Hintergrund
(`#171a26`–`#222842`), Akzentgelb (`#ffcf45`) und Mintgrün (`#46e0a8`). Englische Prompts funktionieren
bei Bildgeneratoren meist am besten – sie stehen darum auf Englisch dabei.

---

## 1. Grafiken

> **Wohin damit?** Optional. Das Spiel läuft komplett ohne Bilder (es nutzt Emojis & CSS).
> Wenn du Bilder einbauen willst, lege sie in einen Ordner `C:\Kritzelkönig\img\` und ich baue sie dir ein – sag einfach Bescheid.

### 1.1 Logo / Schriftzug
**Datei:** `img/logo.png` · **Format:** PNG mit transparentem Hintergrund · **Größe:** 1600×600

```
A playful flat vector logo for a party drawing game called "KRITZELKÖNIG".
Bold rounded sans-serif wordmark, bright golden yellow (#ffcf45) letters with a soft
darker-gold outline, a small cute golden crown replacing the connection between the two
words. Clean, modern, kid-friendly, slight 3D bevel, subtle drop shadow.
Transparent background. Centered. High resolution, crisp edges.
Negative: photorealistic, gradient mesh noise, text artifacts, extra letters, watermark.
```

### 1.2 Hintergrund (App-Background)
**Datei:** `img/bg.png` · **Format:** PNG/JPG · **Größe:** 2560×1440 (Querformat)

```
A subtle dark navy background for a fun drawing party game. Deep blue gradient
(#171a26 to #222842) with very soft glowing blobs of color in the corners
(warm gold top-left, mint green bottom-right), faint hand-drawn doodles of simple
objects (cat, house, sun, star, balloon) as low-opacity white line scribbles
scattered like a chalkboard. Clean, not busy, leaves the center calm and empty.
Landscape 16:9.
Negative: text, logos, high contrast clutter, photorealism, busy center.
```

### 1.3 Werkzeug-Icons (optional, ersetzen die Emojis)
**Dateien:** `img/brush.png`, `img/eraser.png`, `img/undo.png`, `img/trash.png`
**Format:** PNG transparent · **Größe:** 256×256 · jeweils gleicher Stil

```
A set of 4 matching flat vector UI icons in a playful rounded style, single object each,
centered, thick clean outlines, soft inner shading, on transparent background:
1) a black drawing brush/marker tipped with a gold accent,
2) a white-pink eraser,
3) a curved "undo" arrow in gold,
4) a trash bin in mint green.
Consistent line weight, same perspective, app-icon look, 256x256, no text.
Negative: photorealism, drop shadows on background, text labels, mismatched styles.
```

### 1.4 Siegerbild (Overlay beim Gewinn)
**Datei:** `img/win.png` · **Format:** PNG transparent · **Größe:** 1024×1024

```
A cheerful flat vector illustration of a cute golden crown floating above colorful
confetti and a star burst, golden yellow and mint green palette, celebratory,
kid-friendly, rounded shapes, subtle sparkle. Transparent background, centered.
Negative: text, faces, photorealism, dark mood, watermark.
```

### 1.5 Favicon / App-Icon
**Datei:** `img/favicon.png` · **Größe:** 512×512

```
A simple bold app icon: a golden crown sitting on top of a white pencil tip,
on a rounded dark-navy square with a soft gradient, flat vector, high contrast,
recognizable at small sizes. No text.
Negative: tiny details, gradients that vanish when small, text, watermark.
```

---

## 2. Soundeffekte

> **Wohin damit?** Lege die Dateien in `C:\Kritzelkönig\sounds\` mit **genau diesen Namen** ab.
> Das Spiel sucht automatisch danach und spielt sie ab. Findet es keine Datei, erzeugt es einen
> einfachen Pieps-Ton als Ersatz – es funktioniert also auch ohne Dateien.

| Datei | Wann es spielt | Charakter |
|---|---|---|
| `sounds/round_start.mp3` | Neue Runde beginnt | kurz, freundlich, „los geht's" |
| `sounds/correct.mp3` | Jemand rät richtig | fröhliches Erfolgs-Ding |
| `sounds/tick.mp3` | Letzte 5 Sekunden, pro Sekunde | kurzes, dezentes Ticken |
| `sounds/win.mp3` | Spiel gewonnen (10 Punkte) | kleine Siegesfanfare |
| `sounds/click.mp3` | (optional) Button/Aktion | sehr kurzer UI-Klick |

**Allgemein:** kurze Dauer, sauber, ohne Hall-Schwanz, normalisiert, **MP3**, mono reicht.
Stil: verspielt, „mobile game / cartoon", nicht aggressiv, familienfreundlich.

### round_start.mp3 (ca. 0,8 s)
```
Short cheerful game round-start cue, playful marimba or xylophone, two quick rising
notes, bright and friendly, cartoon mobile game UI sound, clean, no reverb tail. 0.8s.
```

### correct.mp3 (ca. 0,7 s)
```
Happy "correct answer" chime for a casual game, two ascending bell/glockenspiel notes
with a soft sparkle, rewarding and positive, cartoon style, clean, short. 0.7s.
```

### tick.mp3 (ca. 0,15 s)
```
Very short subtle clock tick for a countdown timer, soft wooden "tock", neutral,
not alarming, clean, tiny. 0.15s.
```

### win.mp3 (ca. 1,5 s)
```
Short triumphant victory fanfare for a party game, playful brass and bells, ascending
celebratory melody ending on a bright chord, confetti-popping feel, cartoon style,
upbeat, family-friendly, clean ending. 1.5s.
```

### click.mp3 (ca. 0,1 s)
```
Minimal soft UI button click for a mobile game, single short pop/tap, neutral, clean. 0.1s.
```

---

## 3. Tipps zur Nutzung

- **Bildformat:** Für Logo/Icons/Sieg unbedingt **transparenten Hintergrund** (PNG) wählen.
- **Sounds testen:** Manche Generatoren liefern WAV – einfach in MP3 umwandeln (z. B. mit einem
  Online-Konverter) und exakt benennen wie oben.
- **Lautstärke:** Das Spiel spielt Sounds bei 55 % Lautstärke; sehr laute Dateien wirken dann passend.
- **Einbauen lassen:** Wenn die Bilder fertig sind, sag mir Bescheid – dann verdrahte ich Logo,
  Hintergrund, Icons und Siegerbild direkt im Spiel (statt der jetzigen Emojis/CSS).

Viel Spaß beim Gestalten! 🎉
