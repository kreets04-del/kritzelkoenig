#!/usr/bin/env node
/* Baut den Playgama-Upload nach dist/playgama + dist/Kritzelkoenig_Playgama_<Datum>.zip.

   Kritzelkoenig ist ein Online-Mehrspieler-Spiel: das Paket enthaelt nur den
   Client. Der Server bleibt auf Render, die Adresse wird als window.API_BASE
   eingesetzt. Deshalb laeuft der Client auf einer Playgama-Domain und spricht
   ueber CORS mit Render - dafuer muss ALLOWED_ORIGINS dort passen.

   Playgama-Spezifisches steht ausschliesslich in platform/playgama.js; hier wird
   nur die Bridge geladen und die Datei eingebunden. Fremde Portal-SDKs (Y8,
   CrazyGames) kommen in diesem Build nicht vor. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'playgama');
const DIST = path.join(ROOT, 'dist');
const API_BASE = process.env.PLAYGAMA_API_BASE || 'https://kritzelkoenig.onrender.com';
// Die stabile Bridge. Die Playgama-Vorgabe nennt v1; im Developer-Portal ist v2
// der aktuelle stabile Stand und wurde bei Manga Clash erfolgreich abgenommen.
// Ueber PLAYGAMA_BRIDGE_URL umstellbar, falls Playgama etwas anderes verlangt.
const BRIDGE_URL = process.env.PLAYGAMA_BRIDGE_URL || 'https://bridge.playgama.com/v2/stable/playgama-bridge.js';

// Datum UND Uhrzeit im Namen. Zwei Pakete vom selben Tag hiessen sonst gleich -
// und das QA-Werkzeug zeigt genau diesen Namen oben an, dort ist er die einzige
// Stelle, an der man erkennt, welches Paket wirklich geladen wurde.
const jetzt = new Date();
const zz = (n) => String(n).padStart(2, '0');
const stamp = jetzt.getFullYear() + zz(jetzt.getMonth() + 1) + zz(jetzt.getDate())
            + '_' + zz(jetzt.getHours()) + zz(jetzt.getMinutes());
const ZIP = path.join(DIST, 'Kritzelkoenig_Playgama_' + stamp + '.zip');

function die(m) { console.error('\n  BUILD-FEHLER: ' + m + '\n'); process.exit(1); }
function ok(m) { console.log('  ✓ ' + m); }

if (!/^https:\/\/[^ ]+/.test(API_BASE)) die('Ungueltige Backend-Adresse. Setze PLAYGAMA_API_BASE=https://...onrender.com');
if (/localhost|127\.0\.0\.1/.test(API_BASE)) die('PLAYGAMA_API_BASE darf nicht localhost sein - sonst findet kein Spieler den Server.');
if (!/^https:\/\/bridge\.playgama\.com\//.test(BRIDGE_URL)) die('Bridge-URL sieht nicht nach Playgama aus: ' + BRIDGE_URL);

// --- Quelle lesen + pruefen ---
const srcIndex = path.join(ROOT, 'index.html');
let html = fs.readFileSync(srcIndex, 'utf8');
if (!html.trim().endsWith('</html>')) die('Quell-index.html ist unvollstaendig (abgeschnitten) - kein kaputter Build.');
{
  const bloecke = html.match(/<script>[\s\S]*?<\/script>/g) || [];
  if (!bloecke.length) die('Kein <script>-Block in index.html gefunden.');
  const code = bloecke.map(b => b.replace(/^<script>/, '').replace(/<\/script>$/, '')).join('\n;\n');
  try { new Function(code); } catch (e) { die('Syntaxfehler im Client-Skript: ' + e.message); }
}
ok('Quell-index.html vollstaendig und syntaktisch gueltig');

const platformSrc = path.join(ROOT, 'platform', 'playgama.js');
if (!fs.existsSync(platformSrc)) die('platform/playgama.js fehlt.');
try { new Function(fs.readFileSync(platformSrc, 'utf8')); } catch (e) { die('Syntaxfehler in platform/playgama.js: ' + e.message); }
ok('platform/playgama.js syntaktisch gueltig');

// --- Die neutralen Anschluesse muessen in index.html vorhanden sein ---
// Ohne sie waere platform/playgama.js wirkungslos und der Build stillschweigend kaputt.
[
  ['window.KK_AD_PROVIDER', 'Werbe-Anschluss'],
  ['window.KK_PORTAL_HOOKS', 'Spielverlauf-Anschluss'],
  ['window.KK_setPortalLanguage', 'Sprach-Anschluss']
].forEach(([nadel, label]) => {
  if (html.indexOf(nadel) < 0) die('Anschluss fehlt in index.html (' + label + '): ' + nadel);
});
ok('Alle drei Anschluesse in index.html vorhanden');

// --- dist/playgama leeren ---
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// --- Bridge + Plattformdatei + API_BASE injizieren ---
// Reihenfolge zaehlt: erst die Bridge (klassisches Skript, laeuft beim Parsen),
// dann API_BASE, dann platform/playgama.js. Die Plattformdatei wartet selbst auf
// DOMContentLoaded, bevor sie initialize() ruft.
// Die Plattformdatei bekommt eine Version an die Adresse. Ohne die haelt der
// Browser eines Spielers nach einer Aktualisierung im Portal die alte Fassung
// fest - der Fehler faellt dann erst spaeter und schwer auffindbar auf.
const PLATFORM_SRC = 'platform/playgama.js?v=' + Math.floor(fs.statSync(platformSrc).mtimeMs / 1000).toString(36);
// Ein Paketstempel. Ohne ihn heissen zwei Pakete vom selben Tag gleich, und man
// kann nicht erkennen, welches gerade im Portal liegt.
const BUILD_STAMP = stamp;   // derselbe Stempel wie im Dateinamen
const inject =
  '<script src="' + BRIDGE_URL + '"></script>\n' +
  '<script>window.API_BASE=' + JSON.stringify(API_BASE) + ';window.KK_PLAYGAMA_BUILD=' +
    JSON.stringify(BUILD_STAMP) + ';</script>\n' +
  '<script src="' + PLATFORM_SRC + '"></script>\n';
if (html.indexOf('<script>\n"use strict";') < 0) die('Anker <script>"use strict" nicht gefunden - Transform abgebrochen.');
html = html.replace('<script>\n"use strict";', inject + '<script>\n"use strict";');

// --- PWA raus (Portal-Build laeuft im iFrame) ---
html = html.replace(/\n?\s*<link[^>]*rel=["']manifest["'][^>]*>/gi, '');
html = html.replace(/\n?\s*<link[^>]*rel=["'](?:apple-touch-icon|icon|shortcut icon)["'][^>]*>/gi, '');
html = html.replace(/^.*serviceWorker.*register\([^\n]*$/m, '/* Service Worker deaktiviert (Playgama) */');
if (/navigator\.serviceWorker\.register\(/.test(html)) die('Service-Worker-Registrierung nicht entfernt.');

// --- Fremde Portale hart abschalten ---
function must(from, to, label) {
  if (html.indexOf(from) < 0) die('Erwarteter Textbaustein fehlt (' + label + '): ' + from.slice(0, 60));
  html = html.split(from).join(to);
}
must('function _sdk(){ try{ return (window.CrazyGames && CrazyGames.SDK) || null; }catch(e){ return null; } }',
     'function _sdk(){ return null; }   // Playgama-Build: kein fremdes Portal-SDK',
     'SDK-Zugriff');
must('const ENABLE_Y8_ADS = true;          // Werbung im Y8-Build ein-/ausschalten',
     'const ENABLE_Y8_ADS = false;         // Playgama-Build: Werbung laeuft ueber KK_AD_PROVIDER',
     'Y8-Ads-Schalter');
must('const ENABLE_CRAZYGAMES_ADS = false; // Werbung erst im Full Launch aktivieren',
     '// Werbung laeuft im Playgama-Build ueber platform/playgama.js (KK_AD_PROVIDER).',
     'CrazyGames-Ads-Konstante');
must('// ---------- CrazyGames HTML5 SDK v3 – Integration ----------',
     '// ---------- Portal-Fassade (Playgama-Build: ohne Fremd-SDK) ----------', 'SDK-Kommentar');
must('isCrazyGames(){ return CG.mode===\'crazygames\'; },', 'isPortal(){ return PF.mode===\'portal\'; },', 'Platform-Fassade');
// sichtbare Texte (Regeln & Datenschutz)
must('(oder den CrazyGames-Benutzernamen)', '(oder den Portal-Benutzernamen)', 'Datenschutz DE');
must('(or your CrazyGames username)', '(or your portal username)', 'Datenschutz EN');
must('in der CrazyGames-Version stellt CrazyGames Konto und Einladungen bereit',
     'in der Portal-Version stellt das Portal Konto und Einladungen bereit', 'Datenschutz DE 2');
must('in the CrazyGames version, CrazyGames provides account and invites',
     'in the portal version, the portal provides account and invites', 'Datenschutz EN 2');
// Bezeichner/Kommentare neutralisieren (gleiche Kur wie im Y8-Build)
html = html.replace(/'crazygames'/g, "'portal'");
html = html.replace(/\bCG\b/g, 'PF');
html = html.replace(/\bcg([A-Z])/g, (m, c) => 'pf' + c);
html = html.replace(/\binitCG\b/g, 'initPortal');
html = html.replace(/CrazyGames-Data-Module später/g, 'Portal-Datenspeicher später');
html = html.replace(/\(Gast ohne CrazyGames-Login\)/g, '(Gast ohne Portal-Login)');
html = html.replace(/CrazyGames SDK v3 initialisieren \(Standalone: No-Op\)/g, 'Portal-Fassade initialisieren (ohne SDK: No-Op)');
html = html.replace(/\(CrazyGames-Hook\)/g, '(Portal-Hook)');
if (/crazygames/i.test(html)) {
  const hit = html.match(/.{0,70}crazygames.{0,70}/i);
  die('Es sind noch CrazyGames-Verweise im Playgama-Build: ' + (hit ? hit[0].replace(/\n/g, ' ') : '(Stelle nicht ermittelbar)'));
}
// Y8 darf nur noch als abgeschalteter Restpfad vorkommen, nie als geladenes SDK.
if (/cdn\.y8\.com|y8\.min\.js/i.test(html)) die('Y8-SDK wird im Playgama-Build geladen - das darf nicht sein.');
ok('Keine fremden Portal-SDKs im Build (CrazyGames entfernt, Y8 abgeschaltet)');

if (html.indexOf(API_BASE) < 0) die('Injektion der Backend-Adresse fehlgeschlagen.');
if (html.indexOf(BRIDGE_URL) < 0) die('Injektion der Bridge fehlgeschlagen.');
if (html.indexOf('platform/playgama.js') < 0) die('Einbindung von platform/playgama.js fehlgeschlagen.');

{
  const outScripts = html.match(/<script>[\s\S]*?<\/script>/g) || [];
  const mainScript = outScripts.map(b => b.replace(/^<script>/, '').replace(/<\/script>$/, '')).join('\n;\n');
  try { new Function(mainScript); } catch (e) { die('Transformiertes Client-Skript ist ungueltig: ' + e.message); }
}
fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');
ok('index.html transformiert (Bridge + platform/playgama.js, API_BASE=' + API_BASE + ')');

// --- Dateien kopieren (Allowlist wie beim Y8-Build) ---
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
copyFile('platform/playgama.js');
copyFile('js/qrcode.min.js');
['logo.png', 'bg.png', 'brush.png', 'eraser.png', 'undo.png', 'trash.png', 'win.png'].forEach(f => copyFile('img/' + f));
copyDir('sounds', f => /\.(mp3)$/i.test(f));
ok('Client-Assets kopiert (platform, js, img, sounds)');

// --- playgama-bridge-config.json ---
// Struktur nach der Bridge-Dokumentation. Wichtig sind hier die Werbeplaetze:
// platform/playgama.js ruft showInterstitial() mit genau diesen Namen auf, und
// nur deklarierte Plaetze kann die Plattform zuordnen und abrechnen.
// "platforms" bleibt leer - die Kennungen darin gelten fremden Portalen
// (Yandex, VK, Game Distribution). Fuer Playgama selbst braucht es sie nicht.
const bridgeConfig = {
  advertisement: {
    // Unser Abstand ist strenger als die 60 Sekunden der Plattform. Hier
    // deklariert, damit ihn auch das SDK selbst durchsetzt.
    minimumDelayBetweenInterstitial: 180,
    interstitial: {
      placements: [
        { id: 'round-break' },    // Pause zwischen zwei Runden
        { id: 'game-over' },      // Partie zu Ende
        { id: 'back-to-menu' }    // zurueck ins Menue
      ]
    }
  }
};
fs.writeFileSync(path.join(OUT, 'playgama-bridge-config.json'),
  JSON.stringify(bridgeConfig, null, 4) + '\n', 'utf8');
// Gegenprobe: jeder in der Plattformdatei erlaubte Platz muss deklariert sein.
{
  const quelle = fs.readFileSync(platformSrc, 'utf8');
  const erlaubt = (quelle.match(/'([a-z-]+)':\s*true/g) || []).map(s => s.split("'")[1]);
  const deklariert = bridgeConfig.advertisement.interstitial.placements.map(p => p.id);
  const fehlend = erlaubt.filter(p => deklariert.indexOf(p) < 0);
  if (fehlend.length) die('Werbeplatz nicht in der Bridge-Konfiguration deklariert: ' + fehlend.join(', '));
  ok('playgama-bridge-config.json geschrieben (' + deklariert.join(', ') + ')');
}

// --- Referenzpruefung ---
const refs = new Set();
const htmlNoScript = html.replace(/<script[\s\S]*?<\/script>/gi, '');
const re = /(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi; let mm;
while ((mm = re.exec(htmlNoScript))) { const u = mm[1]; if (!/^https?:|^data:|^#/.test(u)) refs.add(u.replace(/^\.?\//, '')); }
['sounds/music.mp3', 'js/qrcode.min.js', 'platform/playgama.js'].forEach(r => refs.add(r));
for (const r of refs) {
  if (!fs.existsSync(path.join(OUT, r))) console.warn('  ! referenzierte Datei fehlt im Build (evtl. optional): ' + r);
}

// --- Verbotene Inhalte / Pfade ---
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
if (total > 100 * 1048576) die('Build > 100 MB.');

// --- ZIP ---
fs.rmSync(ZIP, { force: true });
try {
  if (process.platform === 'win32') {
    execSync('powershell -NoProfile -Command "Compress-Archive -Path \'' + OUT + '\\*\' -DestinationPath \'' + ZIP + '\' -Force"', { stdio: 'ignore' });
  } else {
    execSync('cd "' + OUT + '" && zip -r -q "' + ZIP + '" .', { stdio: 'ignore' });
  }
} catch (e) { die('ZIP-Erstellung fehlgeschlagen: ' + e.message); }
if (!fs.existsSync(ZIP)) die('ZIP wurde nicht erstellt.');
const zipMb = (fs.statSync(ZIP).size / 1048576).toFixed(2);
ok('ZIP erstellt: ' + path.relative(ROOT, ZIP) + '  (' + zipMb + ' MB)');

console.log('\n  BUILD OK  ->  ' + path.relative(ROOT, OUT) + '  |  ' + files.length + ' Dateien  |  ' + mb + ' MB  |  ZIP ' + zipMb + ' MB');
console.log('  Backend: ' + API_BASE + '  (dort ALLOWED_ORIGINS pruefen)\n');
