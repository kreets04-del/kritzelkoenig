'use strict';
/* Normkonformer ZIP-Schreiber fuer die Portal-Pakete.

   Warum nicht PowerShells Compress-Archive: das schreibt unter Windows
   Rueckwaertsstriche als Pfadtrenner ins Archiv (img\bg.png). Die
   ZIP-Spezifikation verlangt Vorwaertsschraegstriche. Portale entpacken
   serverseitig unter Linux - dort entsteht daraus KEIN Ordner, sondern eine
   flache Datei, die woertlich "img\bg.png" heisst. Das Spiel fordert dann
   img/bg.png an und bekommt 404. Genau das ist bei Playgama passiert: nur
   index.html im Wurzelverzeichnis wurde ausgeliefert, jede Datei aus einem
   Unterordner fehlte - keine Bilder, kein Ton, und die Portal-Anbindung lief
   gar nicht erst an.

   Heimtueckisch daran: Pythons zipfile und die meisten Werkzeuge wandeln beim
   LESEN stillschweigend in Schraegstriche um. Ein Blick ins Archiv sieht also
   sauber aus. Deshalb prueft pruefeZip() unten die rohen Bytes.
*/
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function dosZeit(d) {
  const zeit = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const datum = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { zeit: zeit & 0xffff, datum: datum & 0xffff };
}

// Alle Dateien unterhalb von wurzel einsammeln, Pfade immer mit Schraegstrich.
function sammle(wurzel) {
  const raus = [];
  (function lauf(ordner) {
    for (const name of fs.readdirSync(ordner).sort()) {
      const voll = path.join(ordner, name);
      if (fs.statSync(voll).isDirectory()) lauf(voll);
      else raus.push({ voll, drin: path.relative(wurzel, voll).split(path.sep).join('/') });
    }
  })(wurzel);
  // index.html zuerst - manche Entpacker moegen das, und es schadet nie.
  raus.sort((a, b) => (a.drin === 'index.html' ? -1 : b.drin === 'index.html' ? 1 : a.drin.localeCompare(b.drin)));
  return raus;
}

function schreibeZip(quellordner, zieldatei) {
  const dateien = sammle(quellordner);
  if (!dateien.some(d => d.drin === 'index.html')) {
    throw new Error('index.html fehlt im Wurzelverzeichnis von ' + quellordner);
  }
  const stuecke = [];
  const verzeichnis = [];
  let versatz = 0;

  for (const d of dateien) {
    const roh = fs.readFileSync(d.voll);
    const gepackt = zlib.deflateRawSync(roh, { level: 9 });
    const crc = zlib.crc32(roh);
    const t = dosZeit(fs.statSync(d.voll).mtime);
    const name = Buffer.from(d.drin, 'utf8');
    if (name.includes(0x5c)) throw new Error('Rueckwaertsstrich im Eintragsnamen: ' + d.drin);

    const kopf = Buffer.alloc(30);
    kopf.writeUInt32LE(0x04034b50, 0);
    kopf.writeUInt16LE(20, 4);           // benoetigte Version
    kopf.writeUInt16LE(0x0800, 6);       // Bit 11: Namen sind UTF-8
    kopf.writeUInt16LE(8, 8);            // Verfahren: deflate
    kopf.writeUInt16LE(t.zeit, 10);
    kopf.writeUInt16LE(t.datum, 12);
    kopf.writeUInt32LE(crc, 14);
    kopf.writeUInt32LE(gepackt.length, 18);
    kopf.writeUInt32LE(roh.length, 22);
    kopf.writeUInt16LE(name.length, 26);
    kopf.writeUInt16LE(0, 28);
    stuecke.push(kopf, name, gepackt);

    const eintrag = Buffer.alloc(46);
    eintrag.writeUInt32LE(0x02014b50, 0);
    eintrag.writeUInt16LE(20, 4);        // erstellt von
    eintrag.writeUInt16LE(20, 6);        // benoetigte Version
    eintrag.writeUInt16LE(0x0800, 8);
    eintrag.writeUInt16LE(8, 10);
    eintrag.writeUInt16LE(t.zeit, 12);
    eintrag.writeUInt16LE(t.datum, 14);
    eintrag.writeUInt32LE(crc, 16);
    eintrag.writeUInt32LE(gepackt.length, 20);
    eintrag.writeUInt32LE(roh.length, 24);
    eintrag.writeUInt16LE(name.length, 28);
    eintrag.writeUInt32LE(versatz, 42);
    verzeichnis.push(Buffer.concat([eintrag, name]));

    versatz += kopf.length + name.length + gepackt.length;
  }

  const verz = Buffer.concat(verzeichnis);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0);
  ende.writeUInt16LE(dateien.length, 8);
  ende.writeUInt16LE(dateien.length, 10);
  ende.writeUInt32LE(verz.length, 12);
  ende.writeUInt32LE(versatz, 16);

  fs.writeFileSync(zieldatei, Buffer.concat([...stuecke, verz, ende]));
  return dateien.length;
}

// Gegenprobe auf den ROHEN Bytes: kein Eintragsname darf einen Rueckwaertsstrich
// tragen, und index.html muss vorhanden sein. Bibliotheken schoenen das beim
// Lesen - deshalb hier von Hand durch das zentrale Verzeichnis laufen.
function pruefeZip(zieldatei) {
  const b = fs.readFileSync(zieldatei);
  const namen = [];
  for (let i = 0; i + 46 <= b.length; i++) {
    if (b.readUInt32LE(i) !== 0x02014b50) continue;
    const len = b.readUInt16LE(i + 28);
    namen.push(b.slice(i + 46, i + 46 + len).toString('utf8'));
  }
  if (!namen.length) throw new Error('Kein zentrales Verzeichnis im Archiv gefunden.');
  const schlecht = namen.filter(n => n.includes('\\'));
  if (schlecht.length) throw new Error('Rueckwaertsstriche im Archiv: ' + schlecht.join(', '));
  if (!namen.includes('index.html')) throw new Error('index.html liegt nicht im Wurzelverzeichnis des Archivs.');
  return namen;
}

module.exports = { schreibeZip, pruefeZip };
