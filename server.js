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

const PORT          = process.env.PORT || 3000;  // lokal 3000, online vom Hoster vorgegeben
const ROUND_SECONDS = 90;          // 1:30 pro Runde
const ROUND_OPTIONS = [10, 15, 20, 25, 30, 40, 50];
const DEFAULT_ROUNDS = 10;
const RECENT_WORD_LIMIT = 180;
const MIN_POOL_AFTER_RECENT_FILTER = 8;
const WORD_OPTION_COUNT = 3;
const DIFFICULTY_MULTIPLIERS = { easy: 1, medium: 1.25, hard: 1.5 };
const ROUND_END_PAUSE_MS = 4500;   // (nur Sicherheits-Fallback)
const LOAD_ONLINE   = process.argv.includes('--online'); // optional: node server.js --online

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
    hostId,
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
    emoji: emojiFor(w),
    pic: picFor(w),
  }));
}

function chooseNextDrawer(room, solverId) {
  const conn = connectedPlayers(room);
  if (conn.length === 0) return null;
  if (solverId && getPlayer(room, solverId)?.connected) return solverId; // Löser zeichnet als Nächstes
  // reihum: nächster nach dem aktuellen Zeichner
  const order = conn.map(p => p.id);
  const idx = order.indexOf(room.currentDrawerId);
  return order[(idx + 1) % order.length];
}

function startRound(room, drawerId) {
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
  if (room.safetyTimer) { clearTimeout(room.safetyTimer); room.safetyTimer = null; }
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
  room.state = 'playing';
  room.currentWord = word;
  room.wordOptions = [];
  room.revealed = new Set();
  room.remaining = ROUND_SECONDS;

  pushRoomUpdate(room);
  broadcast(room, 'clear', {});

  const drawer = getPlayer(room, room.currentDrawerId);
  // geheimer Begriff NUR an den Zeichner
  sendTo(room, room.currentDrawerId, 'word_assignment', {
    text: room.currentWord.text,
    category: room.currentWord.category,
    difficulty: room.currentWord.difficulty,
    multiplier: difficultyMultiplier(room.currentWord),
    emoji: emojiFor(room.currentWord),
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

  // Solo: Löser zeichnet als Nächster. Team: reihum (jeder ist mal dran).
  const next = room.teamMode ? chooseNextDrawer(room, null) : solver.id;

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
  if (room.isLastRound) gameOver(room); else startRound(room, room.pendingNextDrawer);
}

function gameOver(room) {
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
  if (room.safetyTimer) { clearTimeout(room.safetyTimer); room.safetyTimer = null; }
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
  broadcast(room, 'guess_feed', {
    playerName: player.name, text, correct,
  });
  if (correct) endRoundSolved(room, player);
}

function newGame(room) {
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
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

  // ----- index.html -----
  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // ----- statische Dateien (Grafiken, Sounds, PWA: manifest/sw) -----
  if (req.method === 'GET' && (u.pathname.startsWith('/img/') || u.pathname.startsWith('/sounds/')
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
    const code = u.searchParams.get('room');
    const playerId = u.searchParams.get('playerId');
    const room = rooms.get(code);
    const player = room && getPlayer(room, playerId);
    if (!room || !player) { res.writeHead(404); res.end('room/player not found'); return; }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    room.clients.set(playerId, res);
    player.connected = true;

    // aktuellen Zustand schicken
    sendTo(room, playerId, 'room_update', publicState(room));
    if (room.state === 'playing' && playerId === room.currentDrawerId) {
      sendTo(room, playerId, 'word_assignment', {
        text: room.currentWord.text, category: room.currentWord.category, emoji: emojiFor(room.currentWord) });
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
    pushRoomUpdate(room);

    const ka = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 15000);

    req.on('close', () => {
      clearInterval(ka);
      room.clients.delete(playerId);
      const p = getPlayer(room, playerId);
      if (p) p.connected = false;

      // Host weg -> neuen Host bestimmen
      if (room.hostId === playerId) {
        const next = connectedPlayers(room)[0];
        if (next) room.hostId = next.id;
      }
      // Zeichner weg während Runde -> Runde beenden (Timeout)
      if (room.state === 'playing' && room.currentDrawerId === playerId) {
        endRoundTimeout(room);
      }
      if (room.state === 'choosing' && room.currentDrawerId === playerId) {
        room.roundNumber = Math.max(0, room.roundNumber - 1);
        room.wordOptions = [];
        startRound(room, chooseNextDrawer(room, null));
      }
      // Raum leer -> aufräumen
      if (connectedPlayers(room).length === 0) {
        if (room.timer) clearInterval(room.timer);
        rooms.delete(room.code);
      } else {
        pushRoomUpdate(room);
      }
    });
    return;
  }

  // ----- Aktionen (POST) -----
  if (req.method === 'POST' && u.pathname === '/action') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let msg;
      try { msg = JSON.parse(body || '{}'); } catch (_) { res.writeHead(400); res.end('bad json'); return; }
      const out = handleAction(msg) || { ok: true };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
    return;
  }

  res.writeHead(404); res.end('not found');
});

function handleAction(msg) {
  const { type } = msg;

  if (type === 'create') {
    const playerId = uid();
    const room = createRoom(playerId);
    room.players.push({ id: playerId, name: (msg.name || 'Spieler').slice(0, 16), score: 0, team: null, connected: false });
    return { ok: true, playerId, roomCode: room.code };
  }

  if (type === 'join') {
    const room = rooms.get(String(msg.roomCode || '').trim());
    if (!room) return { ok: false, error: 'Raum nicht gefunden' };
    if (room.state !== 'lobby') {
      // Beitritt auch während des Spiels erlauben (als Mitspieler)
    }
    const playerId = uid();
    room.players.push({
      id: playerId,
      name: (msg.name || 'Spieler').slice(0, 16),
      score: 0,
      team: room.teamMode ? nextTeam(room) : null,
      connected: false,
    });
    return { ok: true, playerId, roomCode: room.code };
  }

  const room = rooms.get(String(msg.roomCode || ''));
  if (!room) return { ok: false, error: 'Raum nicht gefunden' };
  const player = getPlayer(room, msg.playerId);
  if (!player) return { ok: false, error: 'Spieler nicht gefunden' };

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

    case 'start':
      if (msg.playerId !== room.hostId) return { ok: false, error: 'Nur der Host kann starten' };
      if (connectedPlayers(room).length < 2) return { ok: false, error: 'Mindestens 2 Spieler nötig' };
      if (['easy','medium','hard','mixed'].includes(msg.value)) room.difficulty = msg.value;
      if (ROUND_OPTIONS.includes(Number(msg.rounds))) room.maxRounds = Number(msg.rounds);
      startRound(room, null);
      return { ok: true };

    case 'choose_word':
      return chooseWord(room, msg.playerId, String(msg.wordId || ''));

    case 'stroke':
      if (msg.playerId !== room.currentDrawerId) return { ok: false };
      broadcast(room, 'stroke', {
        strokeId: msg.strokeId, tool: msg.tool, color: msg.color, lineWidth: msg.lineWidth,
        points: msg.points, first: msg.first,
      }, msg.playerId);
      return { ok: true };

    case 'undo':
      if (msg.playerId !== room.currentDrawerId) return { ok: false };
      broadcast(room, 'undo', {}, msg.playerId);
      return { ok: true };

    case 'clear':
      if (msg.playerId !== room.currentDrawerId) return { ok: false };
      broadcast(room, 'clear', {}, msg.playerId);
      return { ok: true };

    case 'guess':
      handleGuess(room, player, String(msg.text || ''));
      return { ok: true };

    case 'continue':
      continueRound(room, msg.playerId);
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
function lanIPs() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const ni of ifs[name]) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni