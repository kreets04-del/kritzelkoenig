#!/usr/bin/env node
/* Prueft den erzeugten CrazyGames-Build (dist/crazygames) und bricht mit Fehlercode ab,
   wenn etwas fuer den Upload nicht stimmt. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'crazygames');
const MOBILE_TARGET = 20 * 1048576;
const HARD_LIMIT = 50 * 1048576;

let errors = 0, warns = 0;
function fail(m) { console.error('  ✗ ' + m); errors++; }
function ok(m) { console.log('  ✓ ' + m); }
function warn(m) { console.warn('  ! ' + m); warns++; }

if (!fs.existsSync(OUT)) { console.error('  ✗ dist/crazygames fehlt – zuerst "npm run build:crazygames".'); process.exit(1); }
function walk(dir) { let o = []; for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); const s = fs.statSync(p); if (s.isDirectory()) o = o.concat(walk(p)); else o.push(p); } return o; }
const files = walk(OUT);

// index.html an oberster Stelle
if (fs.existsSync(path.join(OUT, 'index.html'))) ok('index.html im Wurzelverzeichnis'); else fail('index.html fehlt im Wurzelverzeichnis');

// Anzahl / Groesse
let total = 0; files.forEach(f => total += fs.statSync(f).size);
const mb = total / 1048576;
if (files.length <= 1500) ok('Dateianzahl: ' + files.length + ' (<= 1500)'); else fail('Zu viele Dateien: ' + files.length);
if (total <= HARD_LIMIT) ok('Groesse: ' + mb.toFixed(2) + ' MB (<= 50 MB)'); else fail('Build > 50 MB: ' + mb.toFixed(2) + ' MB');
if (total <= MOBILE_TARGET) ok('Mobiles Ziel eingehalten: ' + mb.toFixed(2) + ' MB (<= 20 MB)'); else warn('Ueber mobilem Ziel (20 MB): ' + mb.toFixed(2) + ' MB');

// verbotene Dateien
const banned = ['server.js', 'package.json', '.env', '.env.example', 'render.yaml', 'sw.js', 'manifest.json'];
const bannedDir = /(^|\/)(moderation|raster|_backup)/i;
for (const f of files) {
  const rel = path.relative(OUT, f).replace(/\\/g, '/');
  const base = path.basename(f);
  if (banned.includes(base)) fail('Backend-/Dev-Datei im Build: ' + rel);
  if (bannedDir.test(rel)) fail('Unerwuenschtes Verzeichnis im Build: ' + rel);
  if (/^_|\.bat$|\.md$/i.test(base)) fail('Entwicklungsdatei im Build: ' + rel);
  if (/img\/pics\//.test(rel)) fail('Symbolbilder (img/pics) im Build: ' + rel);
}

// Inhaltspruefungen + JSON-Gueltigkeit + referenzierte Dateien
const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
for (const f of files) {
  const rel = path.relative(OUT, f).replace(/\\/g, '/');
  if (/\.(html|js|css|vtt)$/i.test(f)) {
    const c = fs.readFileSync(f, 'utf8');
    if (/[A-Za-z]:\\/.test(c)) fail('Absoluter Windows-Pfad in ' + rel);
    if (/sdkGameLoadingStart|sdkGameLoadingStop/.test(c)) fail('Veraltete SDK-Funktion in ' + rel);
    if (rel === 'index.html') {
      if (/https?:\/\/localhost|https?:\/\/127\.0\.0\.1/.test(c) || /API_BASE\s*=\s*["'][^"']*(?:localhost|127\.0\.0\.1)/.test(c)) fail('localhost-Backend in Produktions-index.html');
      if (c.indexOf('crazygames-sdk-v3.js') < 0) fail('SDK v3 nicht eingebunden');
      if (!/window\.API_BASE\s*=\s*["']https:\/\//.test(c)) fail('API_BASE (HTTPS) nicht gesetzt');
      if (/serviceWorker\s*\)\s*\{[\s\S]*register\(/.test(c)) fail('Service-Worker-Registrierung noch vorhanden');
    }
  }
  if (/\.json$/i.test(f)) { try { JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { fail('Ungueltiges JSON: ' + rel); } }
}

// referenzierte lokale Dateien vorhanden (nur echtes HTML-Markup, NICHT JS-Strings im <script>)
const htmlNoScript = html.replace(/<script[\s\S]*?<\/script>/gi, '');
const re = /(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi; let m;
while ((m = re.exec(htmlNoScript))) { const u = m[1]; if (/^https?:|^data:|^#/.test(u)) continue; const r = u.replace(/^\.?\//, ''); if (!fs.existsSync(path.join(OUT, r))) fail('Referenzierte Datei fehlt: ' + r); }

console.log('');
if (err