#!/usr/bin/env node
/* Baut den Y8-Upload nach dist/y8 + dist/Kritzelkoenig_Y8_<Datum>.zip.
   Kopiert NUR benoetigte Client-Dateien, injiziert das Y8 Minimal-SDK 2.0
   (App-ID + Game-ID), setzt die Backend-Adresse, entfernt PWA/Service-Worker
   und bricht bei Fehlern verstaendlich ab. */
'use strict';
const fs = require('fs');
const path = require('path');
const { schreibeZip, pruefeZip } = require('./zip');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'y8');
const DIST = path.join(ROOT, 'dist');
const API_BASE = process.env.Y8_API_BASE || 'https://kritzelkoenig.onrender.com';

// --- Y8-Kennungen (Developer Portal -> SDK Initialization) ---
const Y8_APP_ID = process.env.Y8_APP_ID || '6a83051553e382ff8c551695';
const Y8_GAME_ID = process.env.Y8_GAME_ID || '278345';

const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const ZIP = path.join(DIST, 'Kritzelkoenig_Y8_' + stamp + '.zip');

function die(m) { console.error('\n  BUILD-FEHLER: ' + m + '\n'); process.exit(1); }
function ok(m) { console.log('  ✓ ' + m); }

if (!/^https:\/\/[^ ]+/.test(API_BASE)) die('Ungueltige Backend-Adresse. Setze Y8_API_BASE=https://...onrender.com');
if (/localhost|127\.0\.0\.1/.test(API_BASE)) die('Y8_API_BASE darf nicht localhost sein.');
if (!/^[a-f0-9]{24}$/i.test(Y8_APP_ID)) die('Y8_APP_ID sieht nicht wie eine App-ID aus: ' + Y8_APP_ID);
if (!/^\d+$/.test(Y8_GAME_ID)) die('Y8_GAME_ID muss numerisch sein: ' + Y8_GAME_ID);

// --- Quelle index.html lesen + auf Vollstaendigkeit/Syntax pruefen ---
const srcIndex = path.join(ROOT, 'index.html');
let html = fs.readFileSync(srcIndex, 'utf8');
if (!html.trim().endsWith('</html>')) die('Quell-index.html ist unvollstaendig (abgeschnitten) - kein kaputter Build.');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) die('Kein <script>-Block in index.html gefunden.');
try { new Function(scriptMatch[1]); } catch (e) { die('Syntaxfehler im Client-Skript: ' + e.message); }
ok('Quell-index.html vollstaendig und syntaktisch gueltig');

// --- Scrollbalken-Fix pruefen (Y8-Beanstandung bei aktivem Resize) ---
if (!/\.center\{[^}]*scrollbar-width:none/.test(html)) die('Scrollbalken-Fix in .center fehlt - Y8 beanstandet sichtbare Scrollbalken.');
ok('Scrollbalken-Fix vorhanden (.center ohne sichtbare Leiste)');

// --- dist/y8 leeren ---
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// --- index.html transformieren: Y8 SDK + API_BASE injizieren ---
const inject =
  '<script src="https://cdn.y8.com/minimal-sdk/2-0/y8.min.js" async></script>\n' +
  '<script>\n' +
  // Zwei Schalter, die nur den Y8-Build betreffen:
  //
  // KK_START_MUTED - Y8 verlangt einen stummen Start: kein Ton, bevor der
  //   Spieler etwas getan hat. Wer den Lautsprecher schon einmal selbst bedient
  //   hat, behaelt seine Einstellung (ausgewertet in index.html).
  //
  // KK_START_AD - Y8 erlaubt eine Anzeige vor dem Spielstart; Playgama verbietet
  //   sie ausdruecklich. Wann sonst noch Werbung passt, entscheidet
  //   werbestelleErlaubt() in index.html - fuer beide Portale gleich.
  //
  // Eine eigene Zeitsperre gibt es hier bewusst NICHT: Bei Y8 taktet Googles
  // Ad Placement API selbst, wie oft eine Anzeige kommt. Ein zweiter Riegel von
  // uns wuerde ihr nur dazwischenfunken. Der Mindestabstand von drei Minuten
  // gilt deshalb nur bei Playgama, wo wir ihn selbst setzen muessen.
  'window.API_BASE=' + JSON.stringify(API_BASE) + ';window.KK_Y8=true;window.KK_START_MUTED=true;window.KK_START_AD=true;\n' +
  'var y8Sdk=null;\n' +
  'window.addEventListener("y8sdk.ready",function(){\n' +
  '  try{\n' +
  '    y8Sdk=y8.sdk();window.y8Sdk=y8Sdk;\n' +
  '    y8Sdk.init(\n' +
  '      { appId:' + JSON.stringify(Y8_APP_ID) + ', autoLogin:true },\n' +
  '      { gameId:' + JSON.stringify(Y8_GAME_ID) + ', preloadAdBreaks:"on", sound:"on", onReady:function(){} }\n' +
  '    );\n' +
  '    y8Sdk.onAuth(function(user,error){ window.KK_Y8_USER=(error?null:user)||null; });\n' +
  '  }catch(e){ /* Spiel laeuft auch ohne SDK weiter */ }\n' +
  '},{once:true});\n' +
  'if(window.y8&&window.y8.emitReadyEvent){ window.y8.emitReadyEvent(); }\n' +
  '</script>\n';
if (html.indexOf('<script>\n"use strict";') < 0) die('Anker <script>"use strict" nicht gefunden - Transform abgebrochen.');
html = html.replace('<script>\n"use strict";', inject + '<script>\n"use strict";');
// PWA raus: Manifest-Link, Icons und Service-Worker-Registrierung entfernen
html = html.replace(/\n?\s*<link[^>]*rel=["']manifest["'][^>]*>/gi, '');
html = html.replace(/\n?\s*<link[^>]*rel=["'](?:apple-touch-icon|icon|shortcut icon)["'][^>]*>/gi, '');
html = html.replace(/^.*serviceWorker.*register\([^\n]*$/m, '/* Service Worker deaktiviert (Y8) */');
if (html.indexOf(API_BASE) < 0) die('Injektion der Backend-Adresse fehlgeschlagen.');
if (html.indexOf(Y8_APP_ID) < 0) die('Injektion der Y8 App-ID fehlgeschlagen.');
if (html.indexOf(Y8_GAME_ID) < 0) die('Injektion der Y8 Game-ID fehlgeschlagen.');
if (/navigator\.serviceWorker\.register\(/.test(html)) die('Service-Worker-Registrierung nicht entfernt.');

// --- Fremdportal (CrazyGames) restlos entfernen: Y8-Build enthaelt keinerlei Verweise ---
// Die Helfer bleiben als neutrale Portal-Fassade erhalten (gleiche Logik, andere Namen),
// das fremde SDK wird hart abgeschaltet: _sdk() liefert immer null -> mode bleibt 'local'.
function must(from, to, label) {
  if (html.indexOf(from) < 0) die('Erwarteter Textbaustein fehlt (' + label + '): ' + from.slice(0, 60));
  html = html.split(from).join(to);
}
must('function _sdk(){ try{ return (window.CrazyGames && CrazyGames.SDK) || null; }catch(e){ return null; } }',
     'function _sdk(){ return null; }   // Y8-Build: kein fremdes Portal-SDK',
     'SDK-Zugriff');
must('// ---------- CrazyGames HTML5 SDK v3 – Integration ----------',
     '// ---------- Portal-Fassade (Y8-Build: ohne Fremd-SDK) ----------', 'SDK-Kommentar');
must('const ENABLE_CRAZYGAMES_ADS = false; // Werbung erst im Full Launch aktivieren',
     '// Werbung laeuft im Y8-Build ueber showPortalAd() / ENABLE_Y8_ADS.', 'Ads-Konstante');
must('isCrazyGames(){ return CG.mode===\'crazygames\'; },', 'isPortal(){ return PF.mode===\'portal\'; },', 'Platform-Fassade');
// sichtbare Texte (Regeln & Datenschutz)
must('(oder den CrazyGames-Benutzernamen)', '(oder den Y8-Benutzernamen)', 'Datenschutz DE');
must('(or your CrazyGames username)', '(or your Y8 username)', 'Datenschutz EN');
must('in der CrazyGames-Version stellt CrazyGames Konto und Einladungen bereit',
     'in der Y8-Version stellt Y8 Konto und Einladungen bereit', 'Datenschutz DE 2');
must('in the CrazyGames version, CrazyGames provides account and invites',
     'in the Y8 version, Y8 provides account and invites', 'Datenschutz EN 2');
// Bezeichner/Kommentare neutralisieren
html = html.replace(/'crazygames'/g, "'portal'");
html = html.replace(/\bCG\b/g, 'PF');
html = html.replace(/\bcg([A-Z])/g, (m, c) => 'pf' + c);
html = html.replace(/\binitCG\b/g, 'initPortal');
html = html.replace(/CrazyGames-Data-Module später/g, 'Portal-Datenspeicher später');
html = html.replace(/\(Gast ohne CrazyGames-Login\)/g, '(Gast ohne Portal-Login)');
html = html.replace(/CrazyGames SDK v3 initialisieren \(Standalone: No-Op\)/g, 'Portal-Fassade initialisieren (ohne SDK: No-Op)');
html = html.replace(/\(CrazyGames-Hook\)/g, '(Portal-Hook)');
if (/crazygames/i.test(html)) {
  const hit = html.match(/.{60}crazygames.{60}/i);
  die('Es sind noch CrazyGames-Verweise im Y8-Build: ' + (hit ? hit[0] : ''));
}
ok('Keine CrazyGames-Verweise mehr im Build (Code, Kommentare, Datenschutztexte)');

{
  const outScripts = html.match(/<script>[\s\S]*?<\/script>/g) || [];
  const mainScript = outScripts.map(b => b.replace(/^<script>/, '').replace(/<\/script>$/, '')).join('\n;\n');
  try { new Function(mainScript); } catch (e) { die('Transformiertes Client-Skript ist ungueltig: ' + e.message); }
}
fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');
ok('index.html transformiert (Y8 SDK 2.0, appId=' + Y8_APP_ID + ', gameId=' + Y8_GAME_ID + ', API_BASE=' + API_BASE + ')');

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
  if (/localhost|127\.0\.0\.1/.test(c)) console.warn('  ! "localhost" gefunden in ' + path.relative(OUT, f) + ' (pruefen)');
}
if (!fs.existsSync(path.join(OUT, 'index.html'))) die('index.html fehlt im Build-Wurzelverzeichnis.');
ok('Keine Backend-/Dev-Dateien, keine absoluten Pfade');

let total = 0; files.forEach(f => total += fs.statSync(f).size);
const mb = (total / 1048576).toFixed(2);
ok('Dateien: ' + files.length + '  |  Groesse: ' + mb + ' MB');
if (total > 50 * 1048576) die('Build > 50 MB.');

// --- ZIP erstellen (index.html auf oberster Ebene) ---
fs.rmSync(ZIP, { force: true });
let zipDateien;
try {
  schreibeZip(OUT, ZIP);
  zipDateien = pruefeZip(ZIP);
} catch (e) { die('ZIP-Erstellung fehlgeschlagen: ' + e.message); }
if (!fs.existsSync(ZIP)) die('ZIP wurde nicht erstellt.');
ok('Archiv normkonform (' + zipDateien.length + ' Eintraege, nur Schraegstriche, index.html an der Wurzel)');
const zipMb = (fs.statSync(ZIP).size / 1048576).toFixed(2);
ok('ZIP erstellt: ' + path.relative(ROOT, ZIP) + '  (' + zipMb + ' MB)');

console.log('\n  BUILD OK  ->  ' + path.relative(ROOT, OUT) + '  |  ' + files.length + ' Dateien  |  ' + mb + ' MB  |  ZIP ' + zipMb + ' MB\n');
