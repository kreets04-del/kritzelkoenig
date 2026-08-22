/* Baut words_<lang>.json aus der deutschen Liste und Übersetzungsschnipseln.

   Aufruf:  node tools/make-language.js id

   Die Übersetzungen liegen als Teilstücke unter tools/lang/<lang>/*.json und
   bilden jeweils deutsche wordId -> Begriff in der Zielsprache ab:

     { "e001": "Anjing", "e002": "Kucing" }

   In Stücken, weil 1500 Begriffe je Sprache nicht in einem Rutsch entstehen.
   Jedes Stück lässt sich einzeln nachbessern, ohne den Rest anzufassen.

   Struktur und Reihenfolge übernimmt das Werkzeug unverändert aus
   words_de.json - Schwierigkeit und Kategorie bleiben also gleich, und die
   Listen sind über alle Sprachen positionsgleich. Die wordId bekommt das
   Sprachkürzel vorangestellt, so wie es die englische Liste schon vormacht
   (en_e001).

   Fehlende Übersetzungen werden gemeldet und übersprungen, nicht geraten.
*/
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const lang = (process.argv[2] || '').trim();
if (!lang) {
  console.error('Sprache fehlt. Beispiel: node tools/make-language.js id');
  process.exit(1);
}

const de = JSON.parse(fs.readFileSync(path.join(ROOT, 'words_de.json'), 'utf8'));

const stueckOrdner = path.join(__dirname, 'lang', lang);
if (!fs.existsSync(stueckOrdner)) {
  console.error('Kein Ordner mit Übersetzungen: ' + path.relative(ROOT, stueckOrdner));
  process.exit(1);
}

const uebersetzung = {};
const dateien = fs.readdirSync(stueckOrdner).filter((f) => f.endsWith('.json')).sort();
for (const datei of dateien) {
  const teil = JSON.parse(fs.readFileSync(path.join(stueckOrdner, datei), 'utf8'));
  for (const [id, text] of Object.entries(teil)) {
    if (uebersetzung[id] && uebersetzung[id] !== text) {
      console.warn(`  doppelte, abweichende Übersetzung für ${id}: "${uebersetzung[id]}" / "${text}"`);
    }
    uebersetzung[id] = text;
  }
}

const ausgabe = [];
const fehlend = [];
const ausgelassen = [];
for (const eintrag of de) {
  const text = uebersetzung[eintrag.wordId];
  // null bedeutet "bewusst ausgelassen" und ist etwas anderes als "fehlt noch".
  // Lieber ein paar Begriffe weniger als welche, bei denen die Übersetzung
  // wacklig ist oder die sich kaum zeichnen lassen - im Zeichenspiel verdirbt
  // ein unratbarer Begriff die ganze Runde.
  if (text === null) {
    ausgelassen.push(eintrag.wordId);
    continue;
  }
  if (!text) {
    fehlend.push(eintrag.wordId);
    continue;
  }
  ausgabe.push({
    wordId: `${lang}_${eintrag.wordId}`,
    text,
    category: eintrag.category,
    difficulty: eintrag.difficulty,
  });
}

// Doppelte Begriffe innerhalb einer Sprache sind ein echtes Problem: Der Server
// vergleicht Antworten über den normalisierten Text, zwei gleiche Begriffe
// wären nicht unterscheidbar.
const gesehen = new Map();
const doppelt = [];
for (const w of ausgabe) {
  const schluessel = w.text.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();
  if (gesehen.has(schluessel)) doppelt.push(`${w.wordId} = ${gesehen.get(schluessel)} ("${w.text}")`);
  else gesehen.set(schluessel, w.wordId);
}

const ziel = path.join(ROOT, `words_${lang}.json`);
fs.writeFileSync(ziel, JSON.stringify(ausgabe, null, 1) + '\n', 'utf8');

const stufen = {};
for (const w of ausgabe) stufen[w.difficulty] = (stufen[w.difficulty] || 0) + 1;

console.log(`words_${lang}.json: ${ausgabe.length} von ${de.length} Begriffen`);
console.log(`  Stufen: ${Object.entries(stufen).map(([k, v]) => k + ' ' + v).join(' · ')}`);
console.log(`  Teilstücke: ${dateien.length} (${dateien.join(', ')})`);
if (ausgelassen.length) console.log(`  bewusst ausgelassen: ${ausgelassen.length}`);
if (doppelt.length) {
  console.log(`  DOPPELT: ${doppelt.length}`);
  for (const d of doppelt.slice(0, 10)) console.log('    ' + d);
}
if (fehlend.length) {
  console.log(`  fehlen noch: ${fehlend.length}`);
  console.log('    erste: ' + fehlend.slice(0, 12).join(', '));
}
