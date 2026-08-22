#!/usr/bin/env node
/* Baut den CrazyGames-Upload nach dist/crazygames + dist/Kritzelkoenig_CrazyGames.zip.
   Kopiert NUR benoetigte Client-Dateien, injiziert SDK v3 + Backend-Adresse,
   entfernt die Service-Worker-Registrierung und bricht bei Fehlern verstaendlich ab. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'crazygames');
const DIST = path.join(ROOT, 'dist');
const ZIP = path.join(DIST, 'Kritzelkoenig_CrazyGames.zip');
const API_BASE = process.env.CRAZYGAMES_API_BASE || 'https://kritzelkoenig.onrender.com';

function die(m) { console.error('\n  BUILD-FEHLER: ' + m + '\n'); process.exit(1); }
function ok(m) { console.log('  ✓ ' + m); }

// --- Backend-Adresse pruefen (einzige manuell zu pflegende Adresse) ---
if (!/^https:\/\/[^ ]+/.test(API_BASE)) die('Ungueltige Backend-Adresse. Setze CRAZYGAMES_API_BASE=https://...onrender.com');
if (/localhost|127\.0\.0\.1/.test(API_BASE)) die('CRAZYGAMES_API_BASE darf nicht localhost sein.');

// --- Quelle index.html lesen + auf Vollstaendigkeit/Syntax pruefen ---
const srcIndex = path.join(ROOT, 'index.html');
let html = fs.readFileSync(srcIndex, 'utf8');
if (!html.trim().endsWith('</html>')) die('Quell-index.html ist unvollstaendig (abgeschnitten) – kein kaputter Build.');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) die('Kein <script>-Block in index.html gefunden.');
try { new Function(scriptMatch[1]); } catch (e) { die('Syntaxfehler im Client-Skript: ' + e.message); }
ok('Quell-index.html vollstaendig und syntaktisch gueltig');

// --- dist/crazygames leeren ---
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// --- index.html transformieren ---
const inject =
  '<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>\n' +
  '<script>window.API_BASE=' + JSON.stringify(API_BASE) + ';window.KK_CRAZYGAMES=true;</script>\n';
if (html.indexOf('<script>\n"use strict";') < 0) die('Anker <script>"use strict" nicht gefunden – Transform abgebrochen.');
html = html.replace('<script>\n"use strict";', inject + '<script>\n"use strict";');
// PWA raus: Manifest-Link + Service-Worker-Registrierung entfernen
html = html.replace(/\n?\s*<link[^>]*rel=["']manifest["'][^>]*>/gi, '');
html = html.replace(/\n?\s*<link[^>]*rel=["'](?:apple-touch-icon|icon|shortcut icon)["'][^>]*>/gi, ''); // PWA-Icons weg (CrazyGames)
// Service-Worker-Registrierung entfernen: die komplette EINE Zeile (serviceWorker + register) ersetzen
html = html.replace(/^.*serviceWorker.*register\([^\n]*$/m, '/* Service Worker deaktiviert (CrazyGames) */');
if (html.indexOf(API_BASE) < 0) die('Injektion der Backend-Adresse fehlgeschlagen.');
if (/navigator\.serviceWorker\.register\(/.test(html)) die('Service-Worker-Registrierung nicht entfernt.');
// Sicherheitsnetz: transformiertes Client-Skript erneut syntaktisch pruefen (faengt kaputte Transforms ab)
{
  const outScripts = html.match(/<script>[\s\S]*?<\/script>/g) || [];
  const mainScript = outScripts.map(b => b.replace(/^<script>/, '').replace(/<\/script>$/, '')).join('\n;\n');
  try { new Function(mainScript); } catch (e) { die('Transformiertes Client-Skript ist ungueltig: ' + e.message); }
}
fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');
ok('index.html transformiert (SDK v3 + API_BASE=' + API_BASE + ', SW/Manifest entfernt)');

// --- benoetigte Client-Dateien kopieren (Allowlist) ---
function copyFile(rel) {
  const s = path.join(ROOT, rel), d = path.join(OUT, rel);
  if (!fs.existsSync(s)) die('Benoetigte Datei fehlt: ' + rel);
  fs.mkdirSync(path.dirname(d), { recursive: true });
  fs.copyFileSync(s, d);
}
function copyDir(rel, filter) {
  const s = path.join(ROOT, rel);
  if (!fs.existsSync(s)) return;
  for (const f of fs.readdirSync(s)) { if (filter(f)) copyFile(path.join(rel, f)); }
}
copyFile('js/qrcode.min.js');
['logo.png', 'bg.png', 'brush.png', 'eraser.png', 'undo.png', 'trash.png', 'win.png'].forEach(f => copyFile('img/' + f));
copyDir('sounds', f => /\.(mp3)$/i.test(f));
ok('Client-Assets kopiert (js, img, sounds)');

// --- Referenzpruefung: alle im HTML referenzierten lokalen Dateien vorhanden? ---
const refs = new Set();
const htmlNoScript = html.replace(/<script[\s\S]*?<\/script>/gi, '');
const re = /(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi; let mm;
while ((mm = re.exec(htmlNoScript))) { const u = mm[1]; if (!/^https?:|^data:|^#/.test(u)) refs.add(u.replace(/^\.?\//, '')); }
// dynamisch geladene Video-/Sound-Pfade
['sounds/music.mp3', 'js/qrcode.min.js'].forEach(r => refs.add(r));
for (const r of refs) {
  if (!fs.existsSync(path.join(OUT, r))) console.warn('  ! referenzierte Datei fehlt im Build (evtl. optional): ' + r);
}

// --- Verbotene Inhalte / Pfade pruefen ---
function walk(dir) { let out = []; for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); const st = fs.statSync(p); if (st.isDirectory()) out = out.concat(walk(p)); else out.push(p); } return out; }
const files = walk(OUT);
const textExt = /\.(html|js|json|css|vtt)$/i;
for (const f of files) {
  if (!textExt.test(f)) continue;
  const c = fs.readFileSync(f, 'utf8');
  if (/[A-Za-z]:\\\\|[A-Za-z]:\\[^\\]/.test(c)) die('Absoluter Windows-Pfad in ' + path.relative(OUT, f));
  if (/sdkGameLoadingStart|sdkGameLoadingStop/.test(c)) die('Veraltete SDK-Funktion in ' + path.relative(OUT, f));
  if (/localhost|127\.0\.0\.1/.test(c)) console.warn('  ! "localhost" gefunden in ' + path.relative(OUT, f) + ' (pruefen)');
}
if (!fs.existsSync(path.join(OUT, 'index.html'))) die('index.html fehlt im Build-Wurzelverzeichnis.');
ok('Keine Backend-/Dev-Dateien, keine absoluten Pfade, keine veralteten SDK-Funktionen');

// --- Groesse + Anzahl ---
let total = 0; files.forEach(f => total += fs.statSync(f).size);
const mb = (total / 1048576).toFixed(2);
ok('Dateien: ' + files.length + '  |  Groesse: ' + mb + ' MB');
if (files.length > 1500) die('Zu viele Dateien (> 1500).');
if (total > 50 * 1048576) die('Build > 50 MB.');

// --- ZIP erstellen (index.html auf oberster Ebene) ---
fs.rmSync(ZIP, { force: true });
function zipWithPython() {
  const py = 'import zipfile,os,sys\n' +
    'root=sys.argv[1]; out=sys.argv[2]\n' +
    'z=zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED)\n' +
    'for base,_,files in os.walk(root):\n' +
    '  for f in files:\n' +
    '    p=os.path.join(base,f); z.write(p, os.path.relpath(p, root))\n' +
    'z.close()\n';
  const tmp = path.join(require('os').tmpdir(), 'kk_zip_' + Date.now() + '.py');
  fs.writeFileSync(tmp, py);
  execSync('python3 "' + tmp + '" "' + OUT + '" "' + ZIP + '"', { stdio: 'ignore' });
  fs.rmSync(tmp, { force: true });
}
try {
  if (process.platform === 'win32') {
    execSync('powershell -NoProfile -Command "Compress-Archive -Path \'' + OUT + '\\*\' -DestinationPath \'' + ZIP + '\' -Force"', { stdio: 'ignore' });
  } else {
    try { execSync('cd "' + OUT + '" && zip -r -q "' + ZIP + '" .', { stdio: 'ignore' }); }
    catch (e) { fs.rmSync(ZIP, { force: true }); zipWithPython(); }   // Fallback ohne zip-CLI
  }
} catch (e) { die('ZIP-Erstellung fehlgeschlagen: ' + e.message); }
if (!fs.existsSync(ZIP)) die('ZIP wurde nicht erstellt.');
const zipMb = (fs.statSync(ZIP).size / 1048576).toFixed(2);
ok('ZIP erstellt: ' + path.relative(ROOT, ZIP) + '  (' + zipMb + ' MB)');

console.log('\n  BUILD OK  ->  ' + path.relative(ROOT, OUT) + '  |  ' + files.length + ' Dateien  |  ' + mb + ' MB  |  ZIP ' + zipMb + ' MB\n');
