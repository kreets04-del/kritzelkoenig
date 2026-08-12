#!/usr/bin/env node
/* Builds the Y8 upload into dist/y8 and dist/Kritzelkoenig_Y8.zip.
   The current Y8 SDK is loaded from Y8's CDN, as required by the portal. */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'y8');
const ZIP = path.join(DIST, 'Kritzelkoenig_Y8.zip');
const API_BASE = process.env.Y8_API_BASE || 'https://kritzelkoenig.onrender.com';
const GAME_ID = String(process.env.Y8_GAME_ID || '278345').trim();
const APP_ID = String(process.env.Y8_APP_ID || '').trim();

function die(message) { console.error('\n  BUILD-FEHLER: ' + message + '\n'); process.exit(1); }
function ok(message) { console.log('  OK  ' + message); }

if (!/^https:\/\/[^\s]+$/.test(API_BASE) || /localhost|127\.0\.0\.1/i.test(API_BASE)) {
  die('Y8_API_BASE muss eine oeffentliche HTTPS-Adresse sein.');
}
if (!/^[1-9]\d*$/.test(GAME_ID)) die('Y8_GAME_ID muss eine numerische Y8 Game ID sein.');
if (APP_ID && !/^[A-Za-z0-9._-]+$/.test(APP_ID)) die('Y8_APP_ID hat ein ungueltiges Format.');

const srcIndex = path.join(ROOT, 'index.html');
let html = fs.readFileSync(srcIndex, 'utf8');
if (!html.trim().endsWith('</html>')) die('Quell-index.html ist unvollstaendig.');
const mainScript = html.match(/<script>\s*"use strict";([\s\S]*?)<\/script>/);
if (!mainScript) die('Hauptskript in index.html nicht gefunden.');
try { new Function('"use strict";' + mainScript[1]); } catch (error) { die('Syntaxfehler im Client: ' + error.message); }

const expectedParent = DIST + path.sep;
if (!OUT.startsWith(expectedParent) || OUT === DIST) die('Unsicherer Build-Zielpfad.');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const inject =
  '<script>window.API_BASE=' + JSON.stringify(API_BASE) + ';window.KK_Y8=true;window.KK_Y8_GAME_ID=' + JSON.stringify(GAME_ID) + ';window.KK_Y8_APP_ID=' + JSON.stringify(APP_ID) + ';</script>\n' +
  '<script src="https://cdn.y8.com/minimal-sdk/2-0/y8.min.js" async></script>\n';
const anchor = /<script>\r?\n"use strict";/;
if (!anchor.test(html)) die('Injektionsanker in index.html fehlt.');
html = html.replace(anchor, inject + '<script>\n"use strict";');
html = html.replace(/\n?\s*<link[^>]*rel=["']manifest["'][^>]*>/gi, '');
html = html.replace(/\n?\s*<link[^>]*rel=["'](?:apple-touch-icon|icon|shortcut icon)["'][^>]*>/gi, '');
const swRegistration = /if\('serviceWorker' in navigator\)\{ window\.addEventListener\('load',\(\)=>navigator\.serviceWorker\.register\('\/sw\.js'\)\.catch\(\(\)=>\{\}\)\); \}/;
if (!swRegistration.test(html)) die('Service-Worker-Registrierung nicht eindeutig gefunden.');
html = html.replace(swRegistration,
  "if('serviceWorker' in navigator){ window.addEventListener('load',function(){" +
  "navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});}).catch(function(){});" +
  "if(window.caches){caches.keys().then(function(ks){ks.filter(function(k){return /^kk-/.test(k);}).forEach(function(k){caches.delete(k);});}).catch(function(){});}" +
  "}); }");
const builtMainScript = html.match(/<script>\s*"use strict";([\s\S]*?)<\/script>/);
try { new Function('"use strict";' + builtMainScript[1]); } catch (error) { die('Syntaxfehler nach Y8-Transformation: ' + error.message); }
fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');
ok('index.html fuer Y8 transformiert');
ok('Neue Y8-CDN-SDK konfiguriert (Game ID ' + GAME_ID + ')');

function copyFile(rel) {
  const source = path.join(ROOT, rel);
  const destination = path.join(OUT, rel);
  if (!fs.existsSync(source)) die('Benoetigte Datei fehlt: ' + rel);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}
function copyDir(rel, filter) {
  const source = path.join(ROOT, rel);
  if (!fs.existsSync(source)) return;
  for (const name of fs.readdirSync(source)) if (filter(name)) copyFile(path.join(rel, name));
}
copyFile('js/qrcode.min.js');
for (const name of ['logo.png', 'bg.png', 'brush.png', 'eraser.png', 'undo.png', 'trash.png', 'win.png']) copyFile('img/' + name);
copyDir('sounds', name => /\.mp3$/i.test(name));
for (const name of ['tutorial_de.mp4', 'tutorial_en.mp4', 'tutorial_poster.jpg', 'tutorial_de.vtt', 'tutorial_en.vtt']) copyFile('video/' + name);
ok('Client-Assets kopiert');

const verify = spawnSync(process.execPath, [path.join(__dirname, 'verify-y8.js')], { stdio: 'inherit' });
if (verify.status !== 0) die('Y8-Pruefung fehlgeschlagen.');

fs.rmSync(ZIP, { force: true });
const py = [
  'import os,sys,zipfile',
  'root,out=sys.argv[1],sys.argv[2]',
  'with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as z:',
  '  for base,_,files in os.walk(root):',
  '    for name in files:',
  '      p=os.path.join(base,name)',
  '      z.write(p,os.path.relpath(p,root))',
].join('\n');
let zipped = false;
for (const candidate of [['python', []], ['python3', []], ['py', ['-3']]]) {
  const result = spawnSync(candidate[0], candidate[1].concat(['-c', py, OUT, ZIP]), { stdio: 'inherit' });
  if (!result.error && result.status === 0) { zipped = true; break; }
}
if (!zipped || !fs.existsSync(ZIP)) die('ZIP konnte nicht erstellt werden.');

const sizeMb = (fs.statSync(ZIP).size / 1048576).toFixed(2);
ok('Upload-Paket: ' + ZIP + ' (' + sizeMb + ' MB)');
