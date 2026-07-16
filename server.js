/* =====================================================================
 *  KRITZELKÖNIG – lokaler WLAN-Server (MVP)
 *  Reines Node.js, KEINE externen Pakete nötig.
 *
 *  Starten:   node server.js
 *  Spielen:   alle Geräte im selben WLAN öffnen im Browser
 *             http://<HOST-IP>:3000   (IP wird beim Start angezeigt)
 *
 *  Der Server ist der "Host" / die einzige Wahrheit:
 *  er wählt Begriffe, prüft Antworten, zählt Punkte und schaltet Runden.
 *  Server -> Clients: Server-Sent Events (SSE).  Clients -> Server: POST.
 * ===================================================================== */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const crypto = require('crypto');
const traitor = require('./traitor.js'); // Verräter-Modus (eigenständige Ablauf-Logik)

const PORT          = process.env.PORT || 3000;  // lokal 3000, online vom Hoster vorgegeben
const ROUND_SECONDS = 90;          // 1:30 pro Runde
const ROUND_OPTIONS = [10, 15, 20, 25, 30, 40, 50];
const DEFAULT_ROUNDS = 10;
const MAX_PLAYERS = parseInt(process.env.MAX_PLAYERS, 10) || 8;
const RECENT_WORD_LIMIT = 180;
const MIN_POOL_AFTER_RECENT_FILTER = 8;
const WORD_OPTION_COUNT = 3;
const DIFFICULTY_MULTIPLIERS = { easy: 1, medium: 1.25, hard: 1.5 };
const ROUND_END_PAUSE_MS = 4500;   // (nur Sicherheits-Fallback)
const LOAD_ONLINE   = process.argv.includes('--online'); // optional: node server.js --online

// ---------- Zentrale Feature-Schalter ----------
const ENABLE_SYMBOL_HELP   = false; // Symbol-/Bild-/Emoji-Hilfe bei der Wortauswahl (deaktiviert; Spieler zeichnen selbst)
const ENABLE_REPORT_CHEATING = false; // "Mogeln melden" – nur vorbereitet, NICHT aktiviert (keine Auto-Prüfung, keine Pflicht-Abstimmung)

// ---------- Cross-Origin / Sicherheit / Limits (für CrazyGames-Client auf anderer Domain) ----------
// ALLOWED_ORIGINS: kommagetrennte Liste. Enthält '*' -> alle erlaubt (nur für Vorschau/Tests).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
const ALLOW_ALL_ORIGINS = ALLOWED_ORIGINS.includes('*');
const ROOM_TTL_MS = (parseInt(process.env.ROOM_TTL_MINUTES, 10) || 120) * 60000;
const MAX_ROOMS_PER_IP = parseInt(process.env.MAX_ROOMS_PER_IP, 10) || 20;
const MAX_ACTIONS_PER_MINUTE = parseInt(process.env.MAX_ACTIONS_PER_MINUTE, 10) || 600;
const MAX_BODY_BYTES = 64 * 1024;        // 64 KB je Anfrage (Zeichenpakete sind klein)
const RECONNECT_GRACE_MS = 12000;         // kurze Trennung -> Spieler bleibt im Raum
const SERVICE_VERSION = '1.0.0';

function originAllowed(origin) {
  if (!origin) return false;
  if (ALLOW_ALL_ORIGINS) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Offizielle CrazyGames-Vorschau-/Spiel-Ursprünge (exakte Host-Endungen, keine unsichere includes-Prüfung)
  try {
    const h = new URL(origin).hostname;
    if (h === 'crazygames.com' || h.endsWith('.crazygames.com')) return true;
    if (h === 'crazygames.io' || h.endsWith('.crazygames.io')) return true;
  } catch (e) {}
  return false;
}
function applyCors(req, res) {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (origin && originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', ALLOW_ALL_ORIGINS ? '*' : origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
    return true;
  }
  return false;
}
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();   // Render-Proxy: erster Eintrag
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
function token(n = 24) { return crypto.randomBytes(n).toString('base64url'); }

// einfache Rate-Limits pro IP (rollierendes Zeitfenster)
const ipActions = new Map();   // ip -> {count, resetAt}
const ipRooms = new Map();     // ip -> Set(roomCodes)
function rateOk(ip) {
  const now = Date.now();
  let e = ipActions.get(ip);
  if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + 60000 }; ipActions.set(ip, e); }
  e.count++;
  return e.count <= MAX_ACTIONS_PER_MINUTE;
}

// ---------- Begriffe laden (Deutsch + Englisch) ----------
const WORDS_DE = JSON.parse(fs.readFileSync(path.join(__dirname, 'words_de.json'), 'utf8'))
  .map(w => ({ ...w, normalizedText: normalize(w.text) }));
let WORDS_EN = [];
try {
  WORDS_EN = JSON.parse(fs.readFileSync(path.join(__dirname, 'words_en.json'), 'utf8'))
    .map(w => ({ ...w, normalizedText: normalize(w.text) }));
} catch (_) {}
const WORDS = WORDS_DE; // Alias (Online-Begriffe werden hier ergänzt)
function wordsFor(room) { return (room.lang === 'en' && WORDS_EN.length) ? WORDS_EN : WORDS_DE; }

// Emoji-Mini-Bild pro Begriff (für die Jüngsten) – separate Datei, stört die Wortliste nicht
let EMOJI = {};
try { EMOJI = JSON.parse(fs.readFileSync(path.join(__dirname, 'emojis_de.json'), 'utf8')); } catch (_) {}
function emojiFor(word) { return (word && EMOJI[normalize(word.text)]) || ''; }
// Gezeichnete S/W-Bilder (img/pics/<wort>.png) – kleine Hilfe bei der Wortauswahl
let PICS = new Set();
try {
  PICS = new Set(fs.readdirSync(path.join(__dirname, 'img', 'pics'))
    .filter(f => f.toLowerCase().endsWith('.png')).map(f => f.slice(0, -4)));
} catch (_) {}
function picFor(word) {
  if (!word) return '';
  const k = normalize(word.text);
  return PICS.has(k) ? ('/img/pics/' + encodeURIComponent(k) + '.png') : '';
}

// ---------- Hilfsfunktionen ----------
function normalize(input) {
  if (!input) return '';
  let s = String(input).trim().toLowerCase();
  s = s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  // Diakritika entfernen
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/\s+/g, ' ');
  return s;
}

// ---------- Moderation (Schimpfwort-/Beleidigungsfilter) ----------
// Listen liegen getrennt von der Logik unter moderation/ und werden hier geladen.
// Serverautoritativ: die entscheidende Prüfung passiert hier.
function loadModList(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'moderation', file), 'utf8'));
    const arr = Array.isArray(raw) ? raw : (raw.words || []);
    return new Set(arr.map(w => normalize(w).replace(/\s+/g, '')));
  } catch (_) { return new Set(); }
}
const BLOCKED = { de: loadModList('blocked_words_de.json'), en: loadModList('blocked_words_en.json') };
const WHITELIST = { de: loadModList('whitelist_de.json'), en: loadModList('whitelist_en.json') };

// Umgehungen entschärfen: Leetspeak -> Buchstaben, danach normalisieren.
function normLeet(input) {
  let s = normalize(input);
  s = s.replace(/[@]/g, 'a').replace(/[$]/g, 's').replace(/[€]/g, 'e')
       .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a')
       .replace(/5/g, 's').replace(/7/g, 't').replace(/8/g, 'b').replace(/9/g, 'g');
  return s;
}
// True, wenn der Text ein gesperrtes Wort enthält (mit Token-/Wortgrenzen + Whitelist).
function containsBlocked(text, lang) {
  const blocked = BLOCKED[lang] || BLOCKED.de;
  const white = WHITELIST[lang] || WHITELIST.de;
  if (!blocked.size) return false;
  const norm = normLeet(text);
  const tokens = norm.split(/[^a-z0-9]+/).filter(Boolean);
  // Anzeichen für "gespreizte" Umgehung: viele Einzelbuchstaben (w o r t) ODER
  // ein in kurze Häppchen zerteiltes Wort (sch.eiss.e / w-o-r-t).
  const obfuscated = tokens.filter(t => t.length === 1).length >= 3
                  || (tokens.length >= 3 && tokens.every(t => t.length <= 4));
  const collapsed = norm.replace(/[^a-z0-9]+/g, '');
  for (const tok of tokens) {
    if (white.has(tok)) continue;
    if (blocked.has(tok)) return true;                         // exaktes Token
    for (const b of blocked) {
      if (b.length >= 4 && tok.includes(b)) return true;       // Teilwort nur ab Länge 4 (z. B. shithead)
    }
  }
  if (obfuscated && !white.has(collapsed)) {
    for (const b of blocked) {
      if (b.length >= 4 && collapsed.includes(b)) return true; // zusammengezogen, z. B. "s c h e i s s e"
    }
  }
  return false;
}
function isBlockedName(name) { return containsBlocked(name, 'de') || containsBlocked(name, 'en'); }

function uid(n = 6) {
  return Math.random().toString(36).slice(2, 2 + n);
}

function roomCode() {
  return String(Math.floor(1000 + Math.random() * 9000)); // 4 Ziffern
}

function isLetter(c) { return c !== ' ' && c !== '-'; }

const MIME = {
  '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.gif':'image/gif', '.svg':'image/svg+xml', '.ico':'image/x-icon',
  '.mp3':'audio/mpeg', '.m4a':'audio/mp4', '.wav':'audio/wav', '.ogg':'audio/ogg',
  '.json':'application/json', '.js':'text/javascript', '.webmanifest':'application/manifest+json',
  '.mp4':'video/mp4', '.webm':'video/webm', '.vtt':'text/vtt',
};
function mimeOf(p) { return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream'; }

// Maske bauen, z.B. "_ A T _ _"
function buildMask(text, revealedSet) {
  const tokens = [...text].map((c, i) => {
    if (c === ' ') return ' ';      // Leerzeichen sichtbar
    if (c === '-') return '-';
    if (revealedSet.has(i)) return c.toUpperCase();
    return '_';
  });
  return tokens.join(' ');
}

// nächsten Buchstaben aufdecken (Regeln aus dem Entwurf §7)
function revealNext(room) {
  const text = room.currentWord.text;
  const letterPositions = [];
  for (let i = 0; i < text.length; i++) if (isLetter(text[i])) letterPositions.push(i);
  const letterCount = letterPositions.length;
  const maxHints = letterCount <= 3 ? 1 : letterCount <= 7 ? 2 : 3;

  if (room.revealed.size >= maxHints) return false;

  let candidates = letterPositions.filter(i => !room.revealed.has(i));
  if (candidates.length === 0) return false;

  // Erster Hinweis: ersten Buchstaben nicht zuerst, Mitte bevorzugen
  if (room.revealed.size === 0) {
    const firstLetterPos = letterPositions[0];
    const notFirst = candidates.filter(i => i !== firstLetterPos);
    if (notFirst.length > 0) candidates = notFirst;
    const mid = Math.floor(text.length / 2);
    candidates = candidates.slice().sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid)).slice(0, 3);
  }

  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  room.revealed.add(pick);
  return true;
}

// ---------- Räume ----------
const rooms = new Map(); // code -> room

function createRoom(hostId) {
  let code;
  do { code = roomCode(); } while (rooms.has(code));
  const room = {
    code,
    invite: token(9),       // sicheres Einladungs-Token (Auto-Beitritt per Link)
    hostId,
    lastActive: Date.now(),
    players: [],            // {id,name,score,connected}
    clients: new Map(),     // playerId -> SSE response
    state: 'lobby',         // lobby | choosing | playing | roundend | gameover
    currentDrawerId: null,
    currentWord: null,
    wordOptions: [],
    revealed: new Set(),
    usedWordIds: [],
    recentWordIds: [],
    roundNumber: 0,
    maxRounds: DEFAULT_ROUNDS,
    remaining: 0,
    timer: null,
    difficulty: 'mixed',    // easy | medium | hard | mixed
    teamMode: false,
    lang: 'de',             // de | en  (Begriffe + UI raumweit)
    solo: false,            // Einzelspieler-Testmodus (mit Computer-Rater)
    botTimers: [],          // laufende Timer des simulierten Raters
    strokeCount: 0,         // gezeichnete Striche in der aktuellen Runde
    mode: 'classic',        // 'classic' | 'traitor' (Verräter-Modus)
  };
  rooms.set(code, room);
  return room;
}

function getPlayer(room, id) { return room.players.find(p => p.id === id); }
function connectedPlayers(room) { return room.players.filter(p => p.connected); }
function teamName(team) { return team === 0 ? 'Team Rot' : 'Team Blau'; }
function teamScores(room) {
  return [0, 1].map(team => ({
    team,
    name: teamName(team),
    score: room.players.filter(p => p.team === team).reduce((sum, p) => sum + p.score, 0),
  }));
}
function nextTeam(room) {
  const red = room.players.filter(p => p.team === 0).length;
  const blue = room.players.filter(p => p.team === 1).length;
  return red <= blue ? 0 : 1;
}
function assignTeams(room) {
  room.players.forEach((p, i) => { p.team = i % 2; });
}
function clearTeams(room) {
  room.players.forEach(p => { p.team = null; });
}

function publicState(room) {
  return {
    roomCode: room.code,
    hostId: room.hostId,
    state: room.state,
    mode: room.mode || 'classic',
    tCurrentId: room.tCurrent || null,
    currentDrawerId: room.currentDrawerId,
    roundNumber: room.roundNumber,
    maxRounds: room.maxRounds,
    difficulty: room.difficulty,
    teamMode: room.teamMode,
    teamScores: room.teamMode ? teamScores(room) : [],
    lang: room.lang,
    players: room.players.map(p => ({
      id: p.id, name: p.name, score: p.score,
      team: room.teamMode ? p.team : null,
      isHost: p.id === room.hostId,
      isDrawer: p.id === room.currentDrawerId,
      isBot: !!p.isBot,
      connected: p.connected,
    })),
  };
}

// ---------- Senden (SSE) ----------
function sendTo(room, playerId, event, data) {
  const res = room.clients.get(playerId);
  if (!res) return;
  try { res.write(`data: ${JSON.stringify({ event, data })}\n\n`); } catch (_) {}
}

function broadcast(room, event, data, exceptId = null) {
  for (const [pid, res] of room.clients) {
    if (pid === exceptId) continue;
    try { res.write(`data: ${JSON.stringify({ event, data })}\n\n`); } catch (_) {}
  }
}

function pushRoomUpdate(room) { broadcast(room, 'room_update', publicState(room)); }

// Verräter-Modul mit Server-Abhängigkeiten verdrahten (Funktionsdeklarationen sind gehoisted)
traitor.init({
  broadcast, sendTo, getPlayer, connectedPlayers, publicState, pushRoomUpdate,
  pickWord, normalize, gameOver,
});

// ---------- Spiel-Logik ----------
function rememberRecentWord(room, wordId, baseSize) {
  room.recentWordIds = (room.recentWordIds || []).filter(id => id !== wordId);
  room.recentWordIds.push(wordId);
  const limit = Math.min(RECENT_WORD_LIMIT, Math.max(DEFAULT_ROUNDS, Math.floor(baseSize * 0.45)));
  while (room.recentWordIds.length > limit) room.recentWordIds.shift();
}

function wordDifficulty(word) {
  return String(word?.difficulty || 'medium').toLowerCase();
}

function difficultyMultiplier(word) {
  return DIFFICULTY_MULTIPLIERS[wordDifficulty(word)] || 1;
}

function speedMultiplier(remaining) {
  const elapsed = ROUND_SECONDS - remaining;
  if (elapsed <= 15) return 2;
  if (elapsed <= 30) return 1.5;
  return 1;
}

function markWordUsed(room, word, baseSize) {
  if (!room.usedWordIds.includes(word.wordId)) room.usedWordIds.push(word.wordId);
  rememberRecentWord(room, word.wordId, baseSize);
}

function pickWord(room, excludeIds = [], markUsed = true) {
  const diff = room.difficulty || 'mixed';
  const all = wordsFor(room);
  // Leicht: nur leichte | Mittel: nur mittlere | Schwer: schwere + mittlere | Gemischt: alle
  const pools = {
    easy:   w => w.difficulty.toLowerCase() === 'easy',
    medium: w => w.difficulty.toLowerCase() === 'medium',
    hard:   w => ['hard', 'medium'].includes(w.difficulty.toLowerCase()),
    mixed:  () => true,
  };
  const inDiff = all.filter(pools[diff] || pools.mixed);
  const base = inDiff.length ? inDiff : all;
  const exclude = new Set(excludeIds);
  let pool = base.filter(w => !room.usedWordIds.includes(w.wordId) && !exclude.has(w.wordId));
  if (pool.length === 0) {
    // verbrauchte Begriffe DIESER Stufe zurücksetzen
    const baseIds = new Set(base.map(w => w.wordId));
    room.usedWordIds = room.usedWordIds.filter(id => !baseIds.has(id));
    pool = base.filter(w => !exclude.has(w.wordId));
    if (pool.length === 0) pool = base;
  }
  const recent = new Set(room.recentWordIds || []);
  const freshPool = pool.filter(w => !recent.has(w.wordId));
  if (freshPool.length >= Math.min(MIN_POOL_AFTER_RECENT_FILTER, pool.length)) pool = freshPool;
  const w = pool[Math.floor(Math.random() * pool.length)];
  if (markUsed) markWordUsed(room, w, base.length);
  return w;
}

function buildWordOptions(room) {
  const options = [];
  const exclude = [];
  for (let i = 0; i < WORD_OPTION_COUNT; i++) {
    const word = pickWord(room, exclude, false);
    if (!word || exclude.includes(word.wordId)) break;
    options.push(word);
    exclude.push(word.wordId);
  }
  return options;
}

function publicWordOptions(words) {
  return words.map(w => ({
    wordId: w.wordId,
    text: w.text,
    category: w.category,
    difficulty: w.difficulty,
    multiplier: difficultyMultiplier(w),
    emoji: ENABLE_SYMBOL_HELP ? emojiFor(w) : '',
    pic:   ENABLE_SYMBOL_HELP ? picFor(w) : '',
  }));
}

function chooseNextDrawer(room, solverId) {
  const conn = connectedPlayers(room);
  if (conn.length === 0) return null;
  if (room.solo) return firstHuman(room)?.id || null; // Solo: der Mensch zeichnet immer
  if (solverId && getPlayer(room, solverId)?.connected) return solverId; // Löser zeichnet als Nächstes
  // reihum: nächster nach dem aktuellen Zeichner
  const order = conn.map(p => p.id);
  const idx = order.indexOf(room.currentDrawerId);
  return order[(idx + 1) % order.length];
}

function startRound(room, drawerId) {
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
  if (room.safetyTimer) { clearTimeout(room.safetyTimer); room.safetyTimer = null; }
  clearBotTimers(room);
  clearIntermissionTimers(room);
  const conn = connectedPlayers(room);
  if (conn.length < 2) { // nicht genug Spieler -> zurück in Lobby
    room.state = 'lobby';
    room.currentDrawerId = null;
    pushRoomUpdate(room);
    broadcast(room, 'need_players', {});
    return;
  }

  room.state = 'choosing';
  room.roundNumber += 1;
  room.currentDrawerId = drawerId || conn[Math.floor(Math.random() * conn.length)].id;
  if (room.solo) room.currentDrawerId = firstHuman(room)?.id || room.currentDrawerId; // nie der Bot
  room.currentWord = null;
  room.wordOptions = buildWordOptions(room);
  room.revealed = new Set();
  room.remaining = ROUND_SECONDS;

  pushRoomUpdate(room);
  broadcast(room, 'clear', {});

  const drawer = getPlayer(room, room.currentDrawerId);
  broadcast(room, 'word_choosing', {
    drawerId: room.currentDrawerId,
    drawerName: drawer ? drawer.name : '?',
    roundNumber: room.roundNumber,
    maxRounds: room.maxRounds,
  });
  sendTo(room, room.currentDrawerId, 'word_options', {
    options: publicWordOptions(room.wordOptions),
    roundNumber: room.roundNumber,
    maxRounds: room.maxRounds,
  });
}

function beginDrawingRound(room, word) {
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
  clearBotTimers(room);
  room.state = 'playing';
  room.currentWord = word;
  room.wordOptions = [];
  room.revealed = new Set();
  room.remaining = ROUND_SECONDS;
  room.strokeCount = 0;
  room.reports = new Set();   // Meldungen pro Runde zurücksetzen

  pushRoomUpdate(room);
  broadcast(room, 'clear', {});

  const drawer = getPlayer(room, room.currentDrawerId);
  // geheimer Begriff NUR an den Zeichner
  sendTo(room, room.currentDrawerId, 'word_assignment', {
    text: room.currentWord.text,
    category: room.currentWord.category,
    difficulty: room.currentWord.difficulty,
    multiplier: difficultyMultiplier(room.currentWord),
    emoji: ENABLE_SYMBOL_HELP ? emojiFor(room.currentWord) : '',
  });
  // alle anderen: nur Maske + Länge
  broadcast(room, 'round_started', {
    drawerId: room.currentDrawerId,
    drawerName: drawer ? drawer.name : '?',
    drawerTeam: drawer ? drawer.team : null,
    teamMode: room.teamMode,
    roundNumber: room.roundNumber,
    maxRounds: room.maxRounds,
    mask: buildMask(room.currentWord.text, room.revealed),
    remaining: room.remaining,
  });

  room.timer = setInterval(() => tick(room), 1000);
  DrawingGuessProvider.start(room); // Solo-Testmodus: Computer beginnt zu raten
}

function chooseWord(room, playerId, wordId) {
  if (room.state !== 'choosing') return { ok: false };
  if (playerId !== room.currentDrawerId) return { ok: false, error: 'Nur der Zeichner' };
  const word = (room.wordOptions || []).find(w => w.wordId === wordId);
  if (!word) return { ok: false, error: 'Begriff nicht gefunden' };
  markWordUsed(room, word, wordsFor(room).length);
  beginDrawingRound(room, word);
  return { ok: true };
}

function tick(room) {
  room.remaining -= 1;
  broadcast(room, 'timer', { remaining: room.remaining });

  // Hinweise nach und nach aufdecken (auf 1:30 verteilt)
  if (room.remaining === 60 || room.remaining === 40 || room.remaining === 20 || room.remaining === 10) {
    if (revealNext(room)) {
      broadcast(room, 'hint_update', { mask: buildMask(room.currentWord.text, room.revealed) });
    }
  }

  if (room.remaining <= 0) endRoundTimeout(room);
}

function endRoundTimeout(room) {
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
  clearBotTimers(room);
  room.state = 'roundend';
  const next = chooseNextDrawer(room, null); // reihum
  broadcast(room, 'round_timeout', {
    word: room.currentWord.text,
    nextDrawerId: next,
    nextDrawerName: getPlayer(room, next)?.name || '?',
    roundNumber: room.roundNumber, maxRounds: room.maxRounds,
    lastRound: room.roundNumber >= room.maxRounds,
    players: publicState(room).players,
  });
  scheduleNext(room, next);
}

function endRoundSolved(room, solver) {
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
  clearBotTimers(room);
  const basePts = Math.max(1, room.remaining);
  const speedMult = speedMultiplier(room.remaining);
  const difficultyMult = difficultyMultiplier(room.currentWord);
  const pts = Math.max(1, Math.round(basePts * speedMult * difficultyMult));
  const drawer = getPlayer(room, room.currentDrawerId);
  let drawerPts = 0;
  solver.score += pts;
  // Solo: Maler bekommt immer die Hälfte.
  // Team: alle raten – der Maler (und damit sein Team) bekommt die Hälfte NUR, wenn
  // sein EIGENES Team errät. So lohnt sich gutes Zeichnen; absichtlich Kritzeln bringt nichts.
  const sameTeam = room.teamMode && drawer && solver.team != null && solver.team === drawer.team;
  if (drawer && drawer.id !== solver.id && (!room.teamMode || sameTeam)) {
    drawerPts = Math.ceil(pts / 2);
    drawer.score += drawerPts;
  }
  room.state = 'roundend';

  // Solo-Test: der Mensch zeichnet weiter. Team: reihum. Sonst: Löser zeichnet als Nächster.
  const next = room.solo ? (firstHuman(room)?.id || solver.id)
             : (room.teamMode ? chooseNextDrawer(room, null) : solver.id);

  broadcast(room, 'round_solved', {
    winnerId: solver.id, winnerName: solver.name, points: pts,
    basePoints: basePts, speedMultiplier: speedMult, difficultyMultiplier: difficultyMult,
    wordDifficulty: room.currentWord.difficulty,
    drawerId: room.currentDrawerId, drawerName: drawer ? drawer.name : '?',
    drawerPoints: drawerPts,
    word: room.currentWord.text,
    nextDrawerId: next, nextDrawerName: getPlayer(room, next)?.name || '?',
    roundNumber: room.roundNumber, maxRounds: room.maxRounds,
    lastRound: room.roundNumber >= room.maxRounds,
    players: publicState(room).players,
  });
  scheduleNext(room, next);
}

function scheduleNext(room, nextDrawerId) {
  // Es geht NICHT automatisch weiter: der nächste Zeichner (oder der Host)
  // muss auf "Weiter" klicken. Auflösung bleibt so lange sichtbar.
  room.pendingNextDrawer = nextDrawerId;
  room.isLastRound = room.roundNumber >= room.maxRounds;
  pushRoomUpdate(room);
  if (room.safetyTimer) clearTimeout(room.safetyTimer);
  // Sicherheits-Auto-Weiter, falls die Person weg ist (2 Minuten)
  room.safetyTimer = setTimeout(() => {
    if (room.state !== 'roundend') return;
    if (room.isLastRound) gameOver(room); else startRound(room, room.pendingNextDrawer);
  }, 120000);
}

function continueRound(room, playerId) {
  if (room.state !== 'roundend') return;
  // nur der vorgesehene nächste Zeichner oder der Host darf weiterschalten
  if (playerId !== room.pendingNextDrawer && playerId !== room.hostId) return;
  if (room.safetyTimer) { clearTimeout(room.safetyTimer); room.safetyTimer = null; }
  if (room.isLastRound) { gameOver(room); return; }
  // Werbepause NUR am vollständigen Rundenende (alle aktiven Spieler waren einmal dran).
  if (!room.solo && lapSizeOf(room) > 0 && room.roundNumber % lapSizeOf(room) === 0) {
    startIntermission(room);
  } else {
    startRound(room, room.pendingNextDrawer);
  }
}

// ---------- Zwischenstand / Werbepause (servergesteuert) ----------
// Ablauf: playing -> roundend (Ergebnis sichtbar) -> [Weiter] ->
//         round_intermission (Client: Audio pausieren, NoOp-/echte Werbung) ->
//         countdown -> playing. Bleibt NIE hängen (Timeout-Fallback).
const INTERMISSION_MAX_MS = 12000;   // Sicherheits-Timeout, falls Werbung/Client klemmt
const COUNTDOWN_SECONDS = 3;
function lapSizeOf(room) {
  return Math.max(1, connectedPlayers(room).filter(p => !p.isBot).length);
}
function clearIntermissionTimers(room) {
  if (room.intermissionTimer) { clearTimeout(room.intermissionTimer); room.intermissionTimer = null; }
  if (room.countdownTimer) { clearTimeout(room.countdownTimer); room.countdownTimer = null; }
}
function startIntermission(room) {
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
  if (room.safetyTimer) { clearTimeout(room.safetyTimer); room.safetyTimer = null; }
  clearBotTimers(room);
  clearIntermissionTimers(room);
  room.state = 'round_intermission';
  room.readyAfter = new Set();
  pushRoomUpdate(room);
  broadcast(room, 'round_intermission', {});
  // Sicherheits-Timeout: falls nicht alle "bereit" melden (z. B. Werbung hängt), trotzdem weiter.
  room.intermissionTimer = setTimeout(() => finishIntermission(room), INTERMISSION_MAX_MS);
}
function markReadyAfterIntermission(room, playerId) {
  if (room.state !== 'round_intermission') return;
  room.readyAfter = room.readyAfter || new Set();
  room.readyAfter.add(playerId);
  const humans = connectedPlayers(room).filter(p => !p.isBot);
  if (humans.length && humans.every(p => room.readyAfter.has(p.id))) finishIntermission(room);
}
function finishIntermission(room) {
  if (room.state !== 'round_intermission') return;
  clearIntermissionTimers(room);
  room.state = 'countdown';
  pushRoomUpdate(room);
  broadcast(room, 'round_countdown', { seconds: COUNTDOWN_SECONDS });
  room.countdownTimer = setTimeout(() => {
    room.countdownTimer = null;
    startRound(room, room.pendingNextDrawer);
  }, COUNTDOWN_SECONDS * 1000);
}

// ---------- Einzelspieler-Testmodus: simulierter Computer-Rater ----------
// Schnittstelle DrawingGuessProvider: start(room) / stop(room).
// Der SimulatedGuessProvider "erkennt" die Zeichnung NICHT wirklich, sondern rät
// zeitgesteuert glaubwürdig (ein paar Fehltipps, dann die Lösung), sobald genug
// gezeichnet wurde. So kann man das Spiel allein testen. Ein späterer echter
// Bilderkennungs-Provider könnte dieselbe Schnittstelle implementieren.
function isBot(p) { return !!(p && p.isBot); }
function firstHuman(room) { return connectedPlayers(room).find(p => !p.isBot) || null; }

let botSeq = 0;
function addBot(room, name) {
  const id = 'bot_' + (botSeq++);
  room.players.push({ id, name: name || '🤖 Kritzel-Bot', score: 0, team: null, connected: true, isBot: true });
  return id;
}

function clearBotTimers(room) {
  if (room.botTimers) room.botTimers.forEach(t => clearTimeout(t));
  room.botTimers = [];
}

function pickDecoy(room) {
  const all = wordsFor(room);
  const ansNorm = room.currentWord ? room.currentWord.normalizedText : '';
  for (let i = 0; i < 8; i++) {
    const w = all[Math.floor(Math.random() * all.length)];
    if (w && w.normalizedText !== ansNorm) return w.text;
  }
  return null;
}

function botTrySolve(room, botId, answer) {
  if (room.state !== 'playing') return;
  const p = getPlayer(room, botId);
  if (!p || !p.connected) return;
  if ((room.strokeCount || 0) >= 8) {
    handleGuess(room, p, answer);
  } else {
    room.botTimers.push(setTimeout(() => botTrySolve(room, botId, answer), 4000));
  }
}

const SimulatedGuessProvider = {
  name: 'simulated',
  start(room) {
    clearBotTimers(room);
    if (!room.solo || !room.currentWord) return;
    const bots = connectedPlayers(room).filter(isBot);
    if (!bots.length) return;
    const answer = room.currentWord.text;
    bots.forEach(bot => {
      // ein paar Fehltipps (später und weiter gestreut, damit man länger malen kann)
      const nWrong = 1 + Math.floor(Math.random() * 3);
      let t = 10000 + Math.random() * 8000;
      for (let i = 0; i < nWrong; i++) {
        room.botTimers.push(setTimeout(() => {
          if (room.state === 'playing') { const g = pickDecoy(room); if (g) handleGuess(room, bot, g); }
        }, t));
        t += 7000 + Math.random() * 8000;
      }
      // Lösung erst spät – und nur, wenn genug gezeichnet wurde (wirkt echter, lässt Zeit)
      const solveDelay = Math.min(32000 + Math.random() * 36000, (ROUND_SECONDS - 6) * 1000);
      room.botTimers.push(setTimeout(() => botTrySolve(room, bot.id, answer), solveDelay));
    });
  },
  stop(room) { clearBotTimers(room); },
};
const DrawingGuessProvider = SimulatedGuessProvider; // aktiver Provider (später ersetzbar)

function gameOver(room) {
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
  if (room.safetyTimer) { clearTimeout(room.safetyTimer); room.safetyTimer = null; }
  clearBotTimers(room);
  clearIntermissionTimers(room);
  room.state = 'gameover';
  const rankedTeams = room.teamMode ? teamScores(room).sort((a, b) => b.score - a.score) : [];
  const ranked = room.players.slice().sort((a, b) => b.score - a.score);
  const winner = room.teamMode ? (rankedTeams[0] || { team: null, name: '?' }) : (ranked[0] || { id: null, name: '?' });
  broadcast(room, 'game_over', {
    winnerId: winner.id, winnerTeam: winner.team, winnerName: winner.name,
    teamMode: room.teamMode, teamScores: room.teamMode ? rankedTeams : [],
    players: publicState(room).players,
  });
  pushRoomUpdate(room);
}

function handleGuess(room, player, text) {
  if (room.state !== 'playing') return;
  if (player.id === room.currentDrawerId) return; // Zeichner darf nicht raten
  const correct = normalize(text) === room.currentWord.normalizedText;
  if (correct) {
    broadcast(room, 'guess_feed', { playerName: player.name, text, correct: true });
    endRoundSolved(room, player);
  } else {
    // Kein Chat-Missbrauch: falscher Text nur an den Ratenden selbst; andere sehen nur neutralen Status.
    sendTo(room, player.id, 'guess_feed', { playerName: player.name, text, correct: false });
    broadcast(room, 'guess_feed', { playerName: player.name, correct: false }, player.id);
  }
}

function newGame(room) {
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
  clearBotTimers(room);
  clearIntermissionTimers(room);
  traitor.cleanup(room); // Verräter-Timer stoppen
  room.players.forEach(p => p.score = 0);
  room.roundNumber = 0;
  room.state = 'lobby';
  room.currentDrawerId = null;
  room.currentWord = null;
  room.wordOptions = [];
  pushRoomUpdate(room);
  broadcast(room, 'back_to_lobby', {});
}

// ---------- HTTP-Server ----------
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);

  // ----- CORS-Preflight (für CrazyGames-Client auf anderer Domain) -----
  if (req.method === 'OPTIONS') { applyCors(req, res); res.writeHead(204); res.end(); return; }

  // ----- Health-Check (keine internen Daten) -----
  if (req.method === 'GET' && u.pathname === '/health') {
    applyCors(req, res);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'kritzelkoenig', version: SERVICE_VERSION }));
    return;
  }

  // ----- index.html -----
  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // ----- statische Dateien (Grafiken, Sounds, PWA: manifest/sw) -----
  if (req.method === 'GET' && (u.pathname.startsWith('/img/') || u.pathname.startsWith('/sounds/')
      || u.pathname.startsWith('/video/') || u.pathname.startsWith('/locales/') || u.pathname.startsWith('/js/')
      || u.pathname === '/manifest.json' || u.pathname === '/sw.js')) {
    const rel = path.normalize(decodeURIComponent(u.pathname)).replace(/^[\\/]+/, '');
    const filePath = path.join(__dirname, rel);
    if (!filePath.startsWith(__dirname)) { res.writeHead(403); res.end('verboten'); return; }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('nicht gefunden'); return; }
      res.writeHead(200, { 'Content-Type': mimeOf(filePath), 'Cache-Control': 'no-cache' });
      res.end(data);
    });
    return;
  }

  // ----- SSE-Stream -----
  if (req.method === 'GET' && u.pathname === '/events') {
    applyCors(req, res);
    const code = u.searchParams.get('room');
    const playerId = u.searchParams.get('playerId');
    const tok = u.searchParams.get('token') || '';
    const room = rooms.get(code);
    const player = room && getPlayer(room, playerId);
    if (!room || !player) { res.writeHead(404); res.end('room/player not found'); return; }
    if (player.sessionToken && tok !== player.sessionToken) { res.writeHead(403); res.end('forbidden'); return; }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    if (player._dcTimer) { clearTimeout(player._dcTimer); player._dcTimer = null; } // Reconnect in Schonfrist
    room.clients.set(playerId, res);
    player.connected = true;
    room.lastActive = Date.now();

    // aktuellen Zustand schicken
    sendTo(room, playerId, 'room_update', publicState(room));
    if (room.state === 'playing' && playerId === room.currentDrawerId) {
      sendTo(room, playerId, 'word_assignment', {
        text: room.currentWord.text, category: room.currentWord.category,
        emoji: ENABLE_SYMBOL_HELP ? emojiFor(room.currentWord) : '' });
    }
    if (room.state === 'playing') {
      sendTo(room, playerId, 'round_started', {
        drawerId: room.currentDrawerId,
        drawerName: getPlayer(room, room.currentDrawerId)?.name || '?',
        roundNumber: room.roundNumber,
        maxRounds: room.maxRounds,
        mask: buildMask(room.currentWord.text, room.revealed),
        remaining: room.remaining,
      });
    }
    if (room.state === 'choosing') {
      sendTo(room, playerId, 'word_choosing', {
        drawerId: room.currentDrawerId,
        drawerName: getPlayer(room, room.currentDrawerId)?.name || '?',
        roundNumber: room.roundNumber,
        maxRounds: room.maxRounds,
      });
      if (playerId === room.currentDrawerId) {
        sendTo(room, playerId, 'word_options', {
          options: publicWordOptions(room.wordOptions || []),
          roundNumber: room.roundNumber,
          maxRounds: room.maxRounds,
        });
      }
    }
    if (room.state === 'round_intermission') {
      sendTo(room, playerId, 'round_intermission', {});
    }
    if (room.state === 'countdown') {
      sendTo(room, playerId, 'round_countdown', { seconds: COUNTDOWN_SECONDS });
    }
    pushRoomUpdate(room);

    const ka = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 15000);

    req.on('close', () => {
      clearInterval(ka);
      if (room.clients.get(playerId) === res) room.clients.delete(playerId);
      const p = getPlayer(room, playerId);
      if (!p) return;
      // Schonfrist: kurze Trennung (Tabwechsel, Funkloch) wirft niemanden sofort raus.
      if (p._dcTimer) clearTimeout(p._dcTimer);
      p._dcTimer = setTimeout(() => {
        p._dcTimer = null;
        if (room.clients.has(playerId)) return; // inzwischen wieder verbunden
        p.connected = false;
        if (room.hostId === playerId) {
          const next = connectedPlayers(room).find(pp => !pp.isBot) || connectedPlayers(room)[0];
          if (next) room.hostId = next.id;
        }
        if (room.state === 'playing' && room.currentDrawerId === playerId) endRoundTimeout(room);
        if (room.state === 'choosing' && room.currentDrawerId === playerId) {
          room.roundNumber = Math.max(0, room.roundNumber - 1);
          room.wordOptions = [];
          startRound(room, chooseNextDrawer(room, null));
        }
        if (connectedPlayers(room).filter(pp => !pp.isBot).length === 0) {
          if (room.timer) clearInterval(room.timer);
          clearBotTimers(room);
          clearIntermissionTimers(room);
          rooms.delete(room.code);
        } else {
          pushRoomUpdate(room);
        }
      }, RECONNECT_GRACE_MS);
    });
    return;
  }

  // ----- Aktionen (POST) -----
  if (req.method === 'POST' && u.pathname === '/action') {
    applyCors(req, res);
    const ip = clientIp(req);
    if (!rateOk(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'rate_limited' }));
      return;
    }
    let body = '';
    let aborted = false;
    req.on('data', c => { body += c; if (body.length > MAX_BODY_BYTES) { aborted = true; try { req.destroy(); } catch (e) {} } });
    req.on('end', () => {
      if (aborted) return;
      let msg;
      try { msg = JSON.parse(body || '{}'); } catch (_) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'bad_json' })); return; }
      let out;
      try { out = handleAction(msg, ip) || { ok: true }; }
      catch (e) { out = { ok: false, error: 'server_error' }; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
    return;
  }

  res.writeHead(404); res.end('not found');
});

function handleAction(msg, ip) {
  const type = (msg && typeof msg.type === 'string') ? msg.type : '';
  const safeName = (n) => (String(n == null ? 'Spieler' : n).replace(/[<>\r\n\t]/g, '').trim().slice(0, 16) || 'Spieler');

  if (type === 'create') {
    if (isBlockedName(msg.name || '')) return { ok: false, error: 'name_blocked' };
    // Rate-Limit: nicht zu viele offene Räume pro IP
    let set = ipRooms.get(ip); if (!set) { set = new Set(); ipRooms.set(ip, set); }
    for (const rc of Array.from(set)) if (!rooms.has(rc)) set.delete(rc);
    if (set.size >= MAX_ROOMS_PER_IP) return { ok: false, error: 'zu viele Räume' };
    const playerId = crypto.randomUUID();
    const sessionToken = token(24);
    const room = createRoom(playerId);
    room.ownerIp = ip; set.add(room.code);
    room.players.push({ id: playerId, name: safeName(msg.name), score: 0, team: null, connected: false, sessionToken });
    if (msg.solo) { room.solo = true; addBot(room); }  // Einzelspieler-Testmodus
    return { ok: true, playerId, sessionToken, roomCode: room.code, invite: room.invite, lanBase: shareBase(), solo: !!room.solo };
  }

  // Raum prüfen (für Auto-Beitritt: existiert / voll / schon gestartet)
  if (type === 'room_info') {
    const room = rooms.get(String(msg.roomCode || '').trim());
    if (!room) return { ok: false, error: 'Raum nicht gefunden oder abgelaufen' };
    return { ok: true, roomCode: room.code, state: room.state,
      players: room.players.length, maxPlayers: MAX_PLAYERS,
      full: room.players.length >= MAX_PLAYERS, started: room.state !== 'lobby' };
  }

  if (type === 'join') {
    const room = rooms.get(String(msg.roomCode || '').trim());
    if (!room) return { ok: false, error: 'Raum nicht gefunden oder abgelaufen' };
    if (isBlockedName(msg.name || '')) return { ok: false, error: 'name_blocked' };
    if (room.players.length >= MAX_PLAYERS) return { ok: false, error: 'Raum ist voll' };
    // Optionales Einladungstoken: wenn übergeben, muss es passen (Link-Beitritt)
    if (room.invite && msg.invite && String(msg.invite) !== String(room.invite)) return { ok: false, error: 'Einladung ungültig' };
    const playerId = crypto.randomUUID();
    const sessionToken = token(24);
    room.players.push({ id: playerId, name: safeName(msg.name), score: 0,
      team: room.teamMode ? nextTeam(room) : null, connected: false, sessionToken });
    return { ok: true, playerId, sessionToken, roomCode: room.code, invite: room.invite, lanBase: shareBase() };
  }

  const room = rooms.get(String(msg.roomCode || ''));
  if (!room) return { ok: false, error: 'Raum nicht gefunden' };
  const player = getPlayer(room, msg.playerId);
  if (!player) return { ok: false, error: 'Spieler nicht gefunden' };
  // Authentifizierung: Aktionen nur mit passendem Sitzungstoken
  if (player.sessionToken && String(msg.sessionToken || '') !== player.sessionToken) return { ok: false, error: 'nicht autorisiert' };
  room.lastActive = Date.now();

  switch (type) {
    case 'difficulty':
      if (msg.playerId !== room.hostId) return { ok: false, error: 'Nur der Host' };
      if (['easy','medium','hard','mixed'].includes(msg.value)) {
        room.difficulty = msg.value;
        pushRoomUpdate(room);
      }
      return { ok: true };

    case 'language':
      if (msg.playerId !== room.hostId) return { ok: false, error: 'Nur der Host' };
      if (['de','en'].includes(msg.value)) { room.lang = msg.value; pushRoomUpdate(room); }
      return { ok: true };

    case 'rounds': {
      if (msg.playerId !== room.hostId) return { ok: false, error: 'Nur der Host' };
      const rounds = Number(msg.value);
      if (ROUND_OPTIONS.includes(rounds)) {
        room.maxRounds = rounds;
        pushRoomUpdate(room);
      }
      return { ok: true };
    }

    case 'team_mode':
      if (msg.playerId !== room.hostId) return { ok: false, error: 'Nur der Host' };
      room.teamMode = !!msg.value;
      if (room.teamMode) assignTeams(room); else clearTeams(room);
      pushRoomUpdate(room);
      return { ok: true };

    case 'mode': // Spielmodus wählen (nur Host, nur in der Lobby)
      if (msg.playerId !== room.hostId) return { ok: false, error: 'Nur der Host' };
      if (room.state !== 'lobby') return { ok: false };
      room.mode = (msg.value === 'traitor') ? 'traitor' : 'classic';
      pushRoomUpdate(room);
      return { ok: true };

    case 'start': {
      if (msg.playerId !== room.hostId) return { ok: false, error: 'Nur der Host kann starten' };
      if (['easy','medium','hard','mixed'].includes(msg.value)) room.difficulty = msg.value;
      if (ROUND_OPTIONS.includes(Number(msg.rounds))) room.maxRounds = Number(msg.rounds);
      if (room.mode === 'traitor') {
        const humans = connectedPlayers(room).filter(p => !p.isBot).length;
        if (humans < traitor.MIN_PLAYERS) return { ok: false, error: 'Verräter-Modus braucht mindestens ' + traitor.MIN_PLAYERS + ' Spieler' };
        room.roundNumber = 0;
        traitor.start(room);
        return { ok: true };
      }
      if (connectedPlayers(room).length < 2) return { ok: false, error: 'Mindestens 2 Spieler nötig' };
      startRound(room, null);
      return { ok: true };
    }

    case 'choose_word':
      return chooseWord(room, msg.playerId, String(msg.wordId || ''));

    case 'stroke': {
      // Punkte immer zuerst prüfen/begrenzen (gilt für beide Modi)
      if (!Array.isArray(msg.points) || msg.points.length === 0 || msg.points.length > 400) return { ok: false };
      const pts = [];
      for (const p of msg.points) {
        if (!Array.isArray(p) || p.length < 2) continue;
        let x = Number(p[0]), y = Number(p[1]);
        if (!isFinite(x) || !isFinite(y)) continue;             // NaN/Infinity verwerfen
        x = Math.max(0, Math.min(1, x)); y = Math.max(0, Math.min(1, y)); // auf Fläche begrenzen
        pts.push([x, y]);
      }
      if (!pts.length) return { ok: false };
      const tool = (msg.tool === 'eraser') ? 'eraser' : 'brush';
      const color = (typeof msg.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(msg.color)) ? msg.color : '#111111';
      let lw = Number(msg.lineWidth); if (!isFinite(lw) || lw <= 0 || lw > 0.2) lw = 0.01;
      // Verräter-Modus: EIN Strich = ein Zug (auf gemeinsamer Leinwand)
      if (room.mode === 'traitor') {
        return traitor.onStroke(room, msg.playerId, { tool, color, lineWidth: lw, points: pts });
      }
      if (msg.playerId !== room.currentDrawerId) return { ok: false };
      room.strokeCount = (room.strokeCount || 0) + 1;
      broadcast(room, 'stroke', { strokeId: String(msg.strokeId || '').slice(0, 40), tool, color, lineWidth: lw, points: pts, first: !!msg.first }, msg.playerId);
      return { ok: true };
    }

    case 'undo':
      if (msg.playerId !== room.currentDrawerId) return { ok: false };
      broadcast(room, 'undo', {}, msg.playerId);
      return { ok: true };

    case 'clear':
      if (msg.playerId !== room.currentDrawerId) return { ok: false };
      broadcast(room, 'clear', {}, msg.playerId);
      return { ok: true };

    case 'report_drawing': {
      // Community-Moderation: mehrere unabhängige Meldungen -> Zeichnung entfernen, Runde ohne Punkte beenden.
      if (room.state !== 'playing') return { ok: false };
      if (msg.playerId === room.currentDrawerId) return { ok: false }; // keine Selbstmeldung
      room.reports = room.reports || new Set();
      room.reports.add(msg.playerId);                                   // ein Report je Spieler/Runde
      const guessers = connectedPlayers(room).filter(p => !p.isBot && p.id !== room.currentDrawerId).length;
      const need = Math.max(2, Math.ceil(guessers / 2));                // keine Sperre durch EINE Meldung
      if (room.reports.size >= need) {
        broadcast(room, 'clear', {});
        broadcast(room, 'drawing_removed', {});
        endRoundTimeout(room);                                          // Zeichner erhält keine Punkte
      }
      return { ok: true };
    }

    case 'vote': // Verräter-Modus: Abstimmung
      if (room.mode !== 'traitor') return { ok: false };
      return traitor.onVote(room, msg.playerId, String(msg.target || '')) || { ok: true };

    case 'guess': {
      let gtext = String(msg.text == null ? '' : msg.text);
      if (gtext.length > 60) gtext = gtext.slice(0, 60);
      // Gesperrte Eingaben (beide Sprachlisten) werden NICHT übertragen, nicht angezeigt, ohne Punkte.
      if (containsBlocked(gtext, 'de') || containsBlocked(gtext, 'en')) return { ok: false, error: 'blocked_input' };
      // Verräter-Modus: der enttarnte Verräter rät das Wort (Steal)
      if (room.mode === 'traitor') { return traitor.onGuess(room, player.id, gtext) || { ok: true }; }
      handleGuess(room, player, gtext);
      return { ok: true };
    }

    case 'continue':
      if (room.mode === 'traitor') { traitor.onContinue(room, msg.playerId); return { ok: true }; }
      continueRound(room, msg.playerId);
      return { ok: true };

    case 'ready_after_intermission':
      markReadyAfterIntermission(room, msg.playerId);
      return { ok: true };

    case 'newgame':
      if (msg.playerId !== room.hostId) return { ok: false, error: 'Nur der Host' };
      newGame(room);
      return { ok: true };

    default:
      return { ok: false, error: 'unbekannte Aktion' };
  }
}

// ---------- Optionale Online-Begriffe ----------
// Holt KONKRETE, zeichenbare Substantive aus thematischen Wikipedia-Kategorien
// (Tiere, Obst, Werkzeug, Fahrzeuge ...) statt zufälliger Artikel.
// Nur Ein-Wort-Begriffe, gefiltert. Bei Fehlern -> einfach lokale Liste.
const ABSTRACT = /(ung|heit|keit|tion|tät|ismus|schaft|nis|tum)$/i;
const ONLINE_CATEGORIES = [
  'Haustier', 'Obst', 'Gemüse', 'Speise', 'Werkzeug', 'Möbelstück',
  'Musikinstrument', 'Wasserfahrzeug', 'Landfahrzeug', 'Luftfahrzeug',
  'Kleidung', 'Küchengerät', 'Sportgerät', 'Spielzeug', 'Gebäude',
];
function fetchOnlineWords() {
  let added = 0, done = 0;
  const cats = ONLINE_CATEGORIES;
  cats.forEach(cat => {
    const url = 'https://de.wikipedia.org/w/api.php?action=query&list=categorymembers'
      + '&cmtitle=' + encodeURIComponent('Kategorie:' + cat)
      + '&cmtype=page&cmnamespace=0&cmlimit=100&format=json';
    const req = https.get(url, { headers: { 'User-Agent': 'Kritzelkoenig/1.0' }, timeout: 7000 }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          const members = (JSON.parse(b).query.categorymembers) || [];
          for (const m of members) {
            const t = m.title;
            if (!/^[A-ZÄÖÜ][a-zäöüß]+$/.test(t)) continue; // genau EIN Wort, groß beginnend
            if (t.length < 3 || t.length > 13) continue;
            if (ABSTRACT.test(t)) continue;
            const norm = normalize(t);
            if (WORDS.some(w => w.normalizedText === norm)) continue;
            const diff = t.length <= 6 ? 'Easy' : t.length <= 9 ? 'Medium' : 'Hard';
            WORDS.push({ wordId: 'on' + (added++), text: t, category: 'Online:' + cat, difficulty: diff, normalizedText: norm });
          }
        } catch (_) {}
        if (++done === cats.length) console.log('  Online-Begriffe ergänzt:', added, '(gesamt', WORDS.length + ')');
      });
    });
    req.on('error', () => { if (++done === cats.length) console.log('  Online-Begriffe: nicht erreichbar – nutze lokale Liste.'); });
    req.on('timeout', () => req.destroy());
  });
}

// ---------- Start ----------
// Basis-URL für Einladungslinks im lokalen Netz (LAN-IP statt localhost),
// damit ein per WhatsApp geteilter Link auf anderen Geräten im selben WLAN öffnet.
function shareBase() {
  const ips = lanIPs();
  return ips.length ? ('http://' + ips[0] + ':' + PORT) : null;
}
function lanIPs() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const ni of ifs[name]) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

// Abgelaufene/verlassene Räume regelmäßig aufräumen (Speicherleck-Schutz)
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const humans = connectedPlayers(room).filter(p => !p.isBot).length;
    const idle = now - (room.lastActive || 0);
    if (humans === 0 && idle > ROOM_TTL_MS) {
      if (room.timer) clearInterval(room.timer);
      clearBotTimers(room); clearIntermissionTimers(room);
      for (const [, r] of room.clients) { try { r.end(); } catch (e) {} }
      if (room.ownerIp && ipRooms.get(room.ownerIp)) ipRooms.get(room.ownerIp).delete(code);
      rooms.delete(code);
    }
  }
}, 60000);

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanIPs();
  console.log('\n=============================================');
  console.log('  KRITZELKÖNIG läuft!');
  console.log('=============================================');
  console.log('  Auf DIESEM Gerät:   http://localhost:' + PORT);
  if (ips.length) {
    console.log('  Andere Geräte im WLAN öffnen:');
    ips.forEach(ip => console.log('      http://' + ip + ':' + PORT));
  } else {
    console.log('  (Keine WLAN-IP gefunden – sind alle im selben Netz?)');
  }
  console.log('=============================================');
  console.log('  Beenden mit  Strg + C');
  console.log('  Begriffe geladen:', WORDS.length);
  if (LOAD_ONLINE) { console.log('  Lade zusätzliche Online-Begriffe …'); fetchOnlineWords(); }
  console.log('');
});
