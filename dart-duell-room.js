/* Dart Duell 1v1 rooms live alongside Kritzelkönig on the same Render service.
 * It has its own WebSocket path and in-memory room state, so it cannot affect
 * Kritzelkönig’s HTTP/SSE game flow. */
const { randomUUID } = require('crypto');
const { WebSocketServer } = require('ws');

const ROOM_PATH = '/dart-duell/ws';
const PROFILE_NAMES = new Set([
  'Blaze Booker', 'Bullseye Bobby', 'Bully Bob', 'Cool Hand Harry', 'Ferret Fred', 'Flying Benny',
  'Frost Roar Ben', 'Green Thunder Greg', 'Iceman Ian', 'Little Bull Blitz', 'Lucky Lance',
  'Madcap Mason', 'Queenie Quinn', 'Rocket Robbie', 'Sassy Sasha', 'Shocky Shane', 'Snakehawk Scott',
  'Spinmaster Nate', 'Turbo Trevor', 'Voltage Vinny',
]);

function codeFor(rooms) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  while (rooms.has(code));
  return code;
}

function safeProfile(value) { return PROFILE_NAMES.has(String(value)) ? String(value) : 'Blaze Booker'; }
function safeName(value) { return String(value || 'Player').replace(/[<>\r\n\t]/g, '').trim().slice(0, 18) || 'Player'; }

function publicRoom(room) {
  return {
    code: room.code, started: room.started, hostId: room.hostId, settings: room.settings,
    players: [...room.players.values()].map(({ id, name, profile }) => ({ id, name, profile })),
    match: room.match,
  };
}

function send(socket, payload) {
  if (socket.readyState === 1) socket.send(JSON.stringify(payload));
}

function broadcast(room) {
  const payload = { type: 'room-state', room: publicRoom(room) };
  for (const player of room.players.values()) send(player.socket, payload);
}

function leave(rooms, player) {
  if (!player.roomCode) return;
  const room = rooms.get(player.roomCode);
  if (!room) return;
  room.players.delete(player.id);
  if (room.players.size === 0) rooms.delete(room.code);
  else {
    if (room.hostId === player.id) room.hostId = room.players.keys().next().value;
    broadcast(room);
  }
  player.roomCode = '';
}

function startMatch(room) {
  room.started = true;
  room.match = {
    playerIds: [...room.players.keys()],
    scores: [room.settings.x01Start, room.settings.x01Start],
    turnStarts: [room.settings.x01Start, room.settings.x01Start],
    activePlayer: 0, dartsInTurn: 0, round: 1, winner: null, lastThrow: null,
  };
}

function applyThrow(room, player, message) {
  const match = room.match;
  if (!match || match.winner !== null) throw new Error('The match is not active.');
  if (match.playerIds[match.activePlayer] !== player.id) throw new Error('It is not your turn.');
  const score = Number(message.score);
  const multiplier = Number(message.multiplier);
  const validScore =
    (multiplier === 0 && score === 0) ||
    (multiplier === 1 && score >= 1 && score <= 20) ||
    (multiplier === 2 && ((score >= 2 && score <= 40 && score % 2 === 0) || score === 50)) ||
    (multiplier === 3 && score >= 3 && score <= 60 && score % 3 === 0);
  if (!Number.isInteger(score) || !validScore) throw new Error('Invalid throw.');

  const current = match.scores[match.activePlayer];
  const next = current - score;
  const invalidCheckout = next === 0 && multiplier !== 2;
  const bust = next < 0 || next === 1 || invalidCheckout;
  const finished = next === 0 && multiplier === 2;
  match.lastThrow = { player: match.activePlayer, score, multiplier, bust, finished };
  if (finished) { match.scores[match.activePlayer] = 0; match.winner = match.activePlayer; return; }
  if (!bust) match.scores[match.activePlayer] = next;
  match.dartsInTurn += 1;
  if (bust || match.dartsInTurn >= 3) {
    match.activePlayer = match.activePlayer === 0 ? 1 : 0;
    if (match.activePlayer === 0) match.round += 1;
    match.dartsInTurn = 0;
    match.turnStarts[match.activePlayer] = match.scores[match.activePlayer];
  }
}

function attachDartDuellRooms(server) {
  const rooms = new Map();
  const wss = new WebSocketServer({ server, path: ROOM_PATH });
  wss.on('connection', (socket) => {
    const player = { id: randomUUID(), name: 'Player', profile: 'Blaze Booker', roomCode: '', socket };
    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === 'create') {
          leave(rooms, player);
          const settings = message.settings && typeof message.settings === 'object' ? message.settings : {};
          const room = {
            code: codeFor(rooms), started: false, hostId: player.id,
            settings: {
              x01Start: [301, 501, 701].includes(Number(settings.x01Start)) ? Number(settings.x01Start) : 501,
              location: ['clubhouse', 'pub', 'stage'].includes(String(settings.location)) ? String(settings.location) : 'clubhouse',
            },
            players: new Map(), match: null,
          };
          player.name = safeName(message.name); player.profile = safeProfile(message.profile); player.roomCode = room.code;
          room.players.set(player.id, player); rooms.set(room.code, room);
          send(socket, { type: 'joined', playerId: player.id, room: publicRoom(room) }); broadcast(room);
        } else if (message.type === 'join') {
          leave(rooms, player);
          const room = rooms.get(String(message.code || '').trim().toUpperCase());
          if (!room) throw new Error('Room not found.');
          if (room.started || room.players.size >= 2) throw new Error('This room is no longer available.');
          const profile = safeProfile(message.profile);
          if ([...room.players.values()].some((member) => member.profile === profile)) throw new Error('Dieser Spieler wurde bereits gewählt.');
          player.name = safeName(message.name); player.profile = profile; player.roomCode = room.code;
          room.players.set(player.id, player);
          send(socket, { type: 'joined', playerId: player.id, room: publicRoom(room) }); broadcast(room);
        } else if (message.type === 'start' && player.roomCode) {
          const room = rooms.get(player.roomCode);
          if (!room || room.hostId !== player.id) throw new Error('Only the host can start the match.');
          if (room.players.size !== 2) throw new Error('Wait for one opponent.');
          startMatch(room); broadcast(room);
        } else if (message.type === 'throw' && player.roomCode) {
          const room = rooms.get(player.roomCode);
          if (!room) throw new Error('Room not found.');
          applyThrow(room, player, message); broadcast(room);
        }
      } catch (error) { send(socket, { type: 'error', message: error instanceof Error ? error.message : 'Invalid room message.' }); }
    });
    socket.on('close', () => leave(rooms, player));
  });
  console.log(`Dart Duell rooms ready at ${ROOM_PATH}`);
}

module.exports = { attachDartDuellRooms, ROOM_PATH };
