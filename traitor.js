'use strict';
/* Verräter-Modus ("Kritzel-Verräter") – eigenständige Ablauf-Logik.
   Angelehnt an "A Fake Artist Goes to New York": gemeinsame Leinwand, reihum EIN Strich,
   danach Abstimmung, wer der Verräter ist; wird er enttarnt, darf er das Wort erraten (Steal).

   Der klassische Modus bleibt komplett unberührt – dieses Modul wird nur aufgerufen,
   wenn room.mode === 'traitor'. Alle Server-Abhängigkeiten werden über init(deps) injiziert,
   damit sich die Logik isoliert testen lässt.
*/

// ---- Konfiguration ----
const MIN_PLAYERS   = 4;   // sinnvolle Deduktion erst ab 4
const PASSES        = 2;   // wie oft jeder zeichnet
const TURN_SECONDS  = 20;  // Zeit pro Strich
const VOTE_SECONDS  = 40;  // Abstimmung
const STEAL_SECONDS = 25;  // Rateversuch des enttarnten Verräters
const PTS_INNOCENT  = 2;   // Punkte je Ehrlichem, wenn die Gruppe gewinnt
const PTS_TRAITOR   = 3;   // Punkte für den Verräter, wenn er gewinnt/stiehlt

let D = null; // injizierte Abhängigkeiten
function init(deps) { D = deps; return module.exports; }

// ---- Hilfen ----
function eligible(room) {
  return D.connectedPlayers(room).filter(p => !p.isBot);
}
function shuffle(a) {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function nameOf(room, id) { const p = D.getPlayer(room, id); return p ? p.name : '?'; }
function clearTimer(room) { if (room.tTimer) { clearInterval(room.tTimer); room.tTimer = null; } }
function clearSafety(room) { if (room.tSafety) { clearTimeout(room.tSafety); room.tSafety = null; } }
function cleanup(room) { clearTimer(room); clearSafety(room); }

function phaseTimer(room, seconds, onExpire) {
  clearTimer(room);
  room.tRemaining = seconds;
  room.tTimer = setInterval(() => {
    room.tRemaining -= 1;
    D.broadcast(room, 't_timer', { remaining: room.tRemaining, phase: room.state });
    if (room.tRemaining <= 0) { clearTimer(room); onExpire(); }
  }, 1000);
}

// ---- Rundenstart ----
function start(room) {
  cleanup(room);
  const players = eligible(room);
  if (players.length < MIN_PLAYERS) {
    room.state = 'lobby';
    D.pushRoomUpdate(room);
    D.broadcast(room, 't_need_players', { min: MIN_PLAYERS });
    return;
  }
  room.roundNumber += 1;
  room.tWord = D.pickWord(room);
  room.tOrder = shuffle(players.map(p => p.id));
  room.tTraitorId = room.tOrder[Math.floor(Math.random() * room.tOrder.length)];
  room.tTurnCount = 0;
  room.tCurrent = null;
  room.tVotes = new Map();
  room.state = 't_draw';

  D.broadcast(room, 'clear', {});
  D.pushRoomUpdate(room);

  // Zuerst die Spielansicht aufbauen (tBegin blendet das Overlay aus) …
  D.broadcast(room, 't_draw_begin', {
    order: room.tOrder.map(id => ({ id, name: nameOf(room, id) })),
    passes: PASSES, roundNumber: room.roundNumber, maxRounds: room.maxRounds,
  });
  // … DANACH die Rollen geheim zuweisen, damit das Rollen-Overlay stehen bleibt.
  // Ehrliche sehen das Wort, der Verräter nur die Kategorie.
  for (const p of players) {
    if (p.id === room.tTraitorId) {
      D.sendTo(room, p.id, 't_role', { traitor: true, category: room.tWord.category });
    } else {
      D.sendTo(room, p.id, 't_role', { traitor: false, word: room.tWord.text, category: room.tWord.category });
    }
  }
  nextTurn(room);
}

// ---- Zeichenzüge ----
function nextTurn(room) {
  clearTimer(room);
  const total = room.tOrder.length * PASSES;
  // getrennte Spieler überspringen
  while (room.tTurnCount < total) {
    const id = room.tOrder[room.tTurnCount % room.tOrder.length];
    const p = D.getPlayer(room, id);
    if (p && p.connected) break;
    room.tTurnCount += 1;
  }
  if (room.tTurnCount >= total) { beginVote(room); return; }
  const id = room.tOrder[room.tTurnCount % room.tOrder.length];
  room.tCurrent = id;
  const pass = Math.floor(room.tTurnCount / room.tOrder.length) + 1;
  D.broadcast(room, 't_turn', {
    currentId: id, currentName: nameOf(room, id),
    pass, passes: PASSES, turn: room.tTurnCount, total, remaining: TURN_SECONDS,
  });
  phaseTimer(room, TURN_SECONDS, () => { room.tTurnCount += 1; nextTurn(room); });
}

// Ein fertiger Strich (Pen-Up) beendet den Zug. stroke = {tool,color,lineWidth,points} (vorvalidiert).
function onStroke(room, playerId, stroke) {
  if (room.state !== 't_draw' || playerId !== room.tCurrent) return { ok: false };
  D.broadcast(room, 't_stroke', {
    playerId, tool: stroke.tool, color: stroke.color, lineWidth: stroke.lineWidth, points: stroke.points,
  }, playerId); // an alle außer den Zeichner (der sieht seinen Strich lokal)
  room.tTurnCount += 1;
  nextTurn(room);
  return { ok: true };
}

// ---- Abstimmung ----
function beginVote(room) {
  clearTimer(room);
  room.state = 't_vote';
  room.tVotes = new Map();
  room.tCurrent = null;
  D.pushRoomUpdate(room);
  const voters = eligible(room).length;
  D.broadcast(room, 't_vote_begin', {
    candidates: room.tOrder.map(id => ({ id, name: nameOf(room, id) })),
    voters, remaining: VOTE_SECONDS,
  });
  phaseTimer(room, VOTE_SECONDS, () => resolveVotes(room));
}

function onVote(room, playerId, targetId) {
  if (room.state !== 't_vote') return { ok: false };
  const voter = D.getPlayer(room, playerId);
  if (!voter || !voter.connected) return { ok: false };
  if (!room.tOrder.includes(targetId)) return { ok: false };
  if (targetId === playerId) return { ok: false }; // kein Selbstvotum
  room.tVotes.set(playerId, targetId);
  const voters = eligible(room).length;
  D.broadcast(room, 't_vote_update', { voted: room.tVotes.size, voters });
  if (room.tVotes.size >= voters) resolveVotes(room);
  return { ok: true };
}

function resolveVotes(room) {
  clearTimer(room);
  const counts = {};
  for (const t of room.tVotes.values()) counts[t] = (counts[t] || 0) + 1;
  let top = null, topN = -1, tie = false;
  for (const id in counts) {
    if (counts[id] > topN) { top = id; topN = counts[id]; tie = false; }
    else if (counts[id] === topN) { tie = true; }
  }
  const caught = !!top && !tie && top === room.tTraitorId;
  if (caught) {
    room.state = 't_steal';
    D.pushRoomUpdate(room);
    D.broadcast(room, 't_caught', {
      traitorId: room.tTraitorId, traitorName: nameOf(room, room.tTraitorId), category: room.tWord.category,
    });
    D.sendTo(room, room.tTraitorId, 't_steal_prompt', { category: room.tWord.category, remaining: STEAL_SECONDS });
    phaseTimer(room, STEAL_SECONDS, () => finishSteal(room, false));
  } else {
    award(room, 'traitor_win', top || null);
  }
}

// ---- Rateversuch des enttarnten Verräters ----
function onGuess(room, playerId, text) {
  if (room.state !== 't_steal' || playerId !== room.tTraitorId) return { ok: false };
  const correct = D.normalize(text) === room.tWord.normalizedText;
  finishSteal(room, correct);
  return { ok: true };
}
function finishSteal(room, correct) {
  clearTimer(room);
  award(room, correct ? 'traitor_steal' : 'innocents_win', null);
}

// ---- Punkte + Rundenende ----
function award(room, outcome, accusedId) {
  const players = eligible(room);
  const traitor = D.getPlayer(room, room.tTraitorId);
  if (outcome === 'innocents_win') {
    for (const p of players) if (p.id !== room.tTraitorId) p.score += PTS_INNOCENT;
  } else if (outcome === 'traitor_win' || outcome === 'traitor_steal') {
    if (traitor) traitor.score += PTS_TRAITOR;
  }
  endRound(room, outcome, accusedId);
}

function endRound(room, outcome, accusedId) {
  clearTimer(room);
  room.state = 't_end';
  room.isLastRound = room.roundNumber >= room.maxRounds;
  room.pendingTraitorEnd = true;
  D.pushRoomUpdate(room);
  D.broadcast(room, 't_round_end', {
    outcome, // innocents_win | traitor_win | traitor_steal
    traitorId: room.tTraitorId, traitorName: nameOf(room, room.tTraitorId),
    accusedId: accusedId || null,
    word: room.tWord.text,
    players: D.publicState(room).players,
    roundNumber: room.roundNumber, maxRounds: room.maxRounds, lastRound: room.isLastRound,
  });
  clearSafety(room);
  room.tSafety = setTimeout(() => { if (room.state === 't_end') advance(room); }, 120000);
}

function onContinue(room, playerId) {
  if (room.state !== 't_end') return;
  if (playerId !== room.hostId) return; // nur der Host schaltet weiter
  advance(room);
}
function advance(room) {
  clearSafety(room);
  if (room.isLastRound) { D.gameOver(room); return; }
  start(room);
}

module.exports = {
  init, start, onStroke, onVote, onGuess, onContinue, cleanup,
  MIN_PLAYERS, PASSES, TURN_SECONDS, VOTE_SECONDS, STEAL_SECONDS, PTS_INNOCENT, PTS_TRAITOR,
  _internals: { resolveVotes, beginVote, nextTurn, finishSteal }, // für Tests
};
