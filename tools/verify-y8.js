#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'y8');
let errors = 0;
let warnings = 0;
function fail(message) { console.error('  FEHLER  ' + message); errors++; }
function warn(message) { console.warn('  WARNUNG ' + message); warnings++; }
function ok(message) { console.log('  OK      ' + message); }

if (!fs.existsSync(OUT)) { fail('dist/y8 fehlt.'); process.exit(1); }
const indexPath = path.join(OUT, 'index.html');
if (!fs.existsSync(indexPath)) fail('index.html fehlt im ZIP-Wurzelverzeichnis.');
if (errors) process.exit(1);

const html = fs.readFileSync(indexPath, 'utf8');
const builtMainScript = html.match(/<script>\s*"use strict";([\s\S]*?)<\/script>/);
try { new Function('"use strict";' + builtMainScript[1]); ok('Client-JavaScript ist syntaktisch gueltig'); }
catch (error) { fail('Syntaxfehler im Client-JavaScript: ' + error.message); }
if (/window\.KK_Y8\s*=\s*true/.test(html)) ok('Y8-Modus aktiviert'); else fail('Y8-Modus nicht aktiviert');
if (/window\.API_BASE\s*=\s*["']https:\/\//.test(html)) ok('HTTPS-Backend gesetzt'); else fail('HTTPS-Backend fehlt');
if (/src=["']https:\/\/cdn\.y8\.com\/minimal-sdk\/2-0\/y8\.min\.js["'][^>]*async/.test(html)) ok('Aktuelle Y8-CDN-SDK eingebunden'); else fail('Aktuelle Y8-CDN-SDK fehlt');
if (/window\.KK_Y8_GAME_ID\s*=\s*["']278345["']/.test(html)) ok('Y8 Game ID 278345 gesetzt'); else fail('Y8 Game ID fehlt oder ist falsch');
if (/gameBreakBeta|AdsenseId|ChannelId/.test(html)) fail('Legacy-Y8-SDK oder alte Werbekennung enthalten'); else ok('Keine Legacy-Y8-Integration enthalten');
if (/serviceWorker\.register\(/.test(html)) fail('Service Worker ist im Y8-Build noch aktiv');
if (/getRegistrations\(\)[\s\S]*unregister\(\)/.test(html)) ok('Alte Service-Worker-Caches werden entfernt'); else fail('Service-Worker-Cleanup fehlt');
if (/requestAd\(d\.placement\|\|'midgame'\)/.test(html)) ok('Werbung nur am synchronisierten Uebergang'); else fail('Synchronisierter Werbeaufruf fehlt');
if (/function pauseAllAudio\(\)/.test(html) && /activeSfx/.test(html)) ok('Musik und Soundeffekte werden waehrend Werbung gestoppt'); else fail('Vollstaendige Audio-Pause fehlt');
if (/type:isStart\?'start':'next'/.test(html)) ok('Start- und Rundenende-Platzierungen gesetzt'); else fail('Y8-Platzierungstypen fehlen');
if (/autoLogin:false/.test(html)) ok('Login ohne App ID deaktiviert'); else fail('App-ID-loser Initialisierungsmodus fehlt');

function walk(dir) {
  let files = [];
  for (const name of fs.readdirSync(dir)) {
    const item = path.join(dir, name);
    const stat = fs.statSync(item);
    files = stat.isDirectory() ? files.concat(walk(item)) : files.concat(item);
  }
  return files;
}
const files = walk(OUT);
let total = 0;
for (const file of files) total += fs.statSync(file).size;
if (total > 50 * 1048576) fail('Build ist groesser als 50 MB');
else ok('Build-Groesse: ' + (total / 1048576).toFixed(2) + ' MB');

console.log('');
if (errors) { console.error(errors + ' Fehler, ' + warnings + ' Warnungen'); process.exit(1); }
console.log('Y8-Pruefung bestanden (' + warnings + ' Warnungen).');
