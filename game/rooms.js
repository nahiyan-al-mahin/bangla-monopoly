// game/rooms.js
// In-memory room store: create/join rooms, lobby choices, starting the game.
//
// Every function here checks its input and throws a GameError with a
// Bangla message when something is not allowed. server.js catches the error
// and sends the message to the player. This file never talks to sockets
// directly, so all game rules stay in one place.
//
// Players are identified by a secret random "playerToken" (saved in the
// browser's localStorage), NOT by socket id. A page refresh gives a new
// socket, but the same token, so the player keeps their seat.

const crypto = require('crypto');
const config = require('./config');
const engine = require('./engine');
const { fail } = require('./errors');
const { PIECES } = require('../data/pieces');

// All rooms, keyed by room code (e.g. "KBTX").
const rooms = new Map();

// --- Player-facing error messages (Bangla) ---
const MSG = {
  badRequest: 'অনুরোধটি ঠিক নেই। পেজটি আবার চালু করুন।',
  nameEmpty: 'আপনার নাম লিখুন।',
  nameTooLong: `নাম সর্বোচ্চ ${config.nameMaxLength} অক্ষরের হতে পারে।`,
  nameTaken: 'এই নামে রুমে আগে থেকেই একজন আছেন। অন্য নাম দিন।',
  codeInvalid: `রুম কোড ঠিক নেই। ${config.roomCodeLength} অক্ষরের কোড দিন (I ও O বাদে ইংরেজি বড় হাতের অক্ষর)।`,
  roomNotFound: 'এই কোডের কোনো রুম পাওয়া যায়নি।',
  roomFull: `রুমটি পূর্ণ। সর্বোচ্চ ${config.maxPlayers} জন খেলতে পারেন।`,
  gameStarted: 'এই রুমে খেলা ইতিমধ্যে শুরু হয়ে গেছে।',
  notMember: 'আপনি এই রুমের খেলোয়াড় নন।',
  notInLobby: 'খেলা শুরু হওয়ার পর এটি করা যাবে না।',
  pieceInvalid: 'এই টোকেনটি পাওয়া যায়নি।',
  pieceTaken: 'এই টোকেনটি অন্য একজন নিয়ে নিয়েছেন।',
  colorInvalid: 'এই রংটি পাওয়া যায়নি।',
  colorTaken: 'এই রংটি অন্য একজন নিয়ে নিয়েছেন।',
  notHost: 'শুধু হোস্ট খেলা শুরু করতে পারেন।',
  notEnoughPlayers: `খেলা শুরু করতে কমপক্ষে ${config.minPlayers} জন খেলোয়াড় লাগবে।`,
  tooManyPlayers: `সর্বোচ্চ ${config.maxPlayers} জন খেলোয়াড় খেলতে পারেন।`,
  notAllReady: 'সবাইকে টোকেন ও রং বাছাই করতে হবে।',
  someoneDisconnected: 'সব খেলোয়াড়কে সংযুক্ত থাকতে হবে।'
};


// server.js registers a function here so that changes made by timers
// (removing a disconnected player) can be broadcast to the room.
let onRoomChanged = () => {};

function setRoomChangedListener(listener) {
  onRoomChanged = listener;
}

// ---------- Validation helpers ----------

// Returns a clean name (trimmed, single spaces) or throws.
function validateName(rawName) {
  if (typeof rawName !== 'string') fail(MSG.nameEmpty);
  const name = rawName
    .replace(/[\u0000-\u001f\u007f]/g, '') // remove invisible control characters
    .replace(/\s+/g, ' ')
    .trim();
  // Array.from counts characters correctly (not UTF-16 code units).
  const length = Array.from(name).length;
  if (length === 0) fail(MSG.nameEmpty);
  if (length > config.nameMaxLength) fail(MSG.nameTooLong);
  return name;
}

// Code format: exactly roomCodeLength letters from roomCodeLetters.
const CODE_PATTERN = new RegExp(`^[${config.roomCodeLetters}]{${config.roomCodeLength}}$`);

// Returns the code in uppercase, or throws if the format is wrong.
function normalizeCode(rawCode) {
  if (typeof rawCode !== 'string') fail(MSG.codeInvalid);
  const code = rawCode.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) fail(MSG.codeInvalid);
  return code;
}

function randomId(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

// Make a new room code that is not in use yet.
function generateCode() {
  const letters = config.roomCodeLetters;
  let code;
  do {
    code = '';
    for (let i = 0; i < config.roomCodeLength; i++) {
      code += letters[crypto.randomInt(letters.length)];
    }
  } while (rooms.has(code));
  return code;
}

function requireLobby(room) {
  if (room.status !== 'lobby') fail(MSG.notInLobby);
}

// ---------- Creating and joining ----------

// Add a new player to a room and return it.
function addPlayer(room, name) {
  const player = {
    id: 'p' + randomId(4),   // public id, safe to show to everyone
    token: randomId(16),     // SECRET: only this player's browser knows it
    name,
    piece: null,             // piece id from data/pieces.js
    color: null,             // color id from config.playerColors
    connected: false,
    socketId: null,
    removeTimer: null,       // lobby: removes the player after a long disconnect
    money: 0,                // set when the game starts
    position: 0,
    inJail: false
  };
  room.players.push(player);
  // A room with no host (everyone left) gets the new player as host.
  if (!room.hostId) room.hostId = player.id;
  return player;
}

function createRoom(rawName) {
  const name = validateName(rawName);
  const room = {
    code: generateCode(),
    status: 'lobby',      // 'lobby' -> 'playing'
    hostId: null,
    players: [],          // seat order = join order
    deleteTimer: null,    // deletes the room when nobody is connected
    game: null,           // turn/dice/log state, created by engine.initGame
    createdAt: Date.now()
  };
  rooms.set(room.code, room);
  const player = addPlayer(room, name);
  console.log(`Room ${room.code} created by "${name}"`);
  return { room, player };
}

function joinRoom(rawCode, rawName) {
  const code = normalizeCode(rawCode);
  const name = validateName(rawName);
  const room = rooms.get(code);

  if (!room) fail(MSG.roomNotFound);
  if (room.status !== 'lobby') fail(MSG.gameStarted);
  if (room.players.length >= config.maxPlayers) fail(MSG.roomFull);

  const nameInUse = room.players.some((p) => p.name.toLowerCase() === name.toLowerCase());
  if (nameInUse) fail(MSG.nameTaken);

  const player = addPlayer(room, name);
  console.log(`"${name}" joined room ${code}`);
  return { room, player };
}

// Find the room and the player who owns this playerToken, or throw.
function getRoomAndPlayer(rawCode, playerToken) {
  const code = normalizeCode(rawCode);
  if (typeof playerToken !== 'string' || playerToken === '') fail(MSG.badRequest);

  const room = rooms.get(code);
  if (!room) fail(MSG.roomNotFound);

  const player = room.players.find((p) => p.token === playerToken);
  if (!player) fail(MSG.notMember);

  return { room, player };
}

// ---------- Connection tracking ----------

// A socket has identified itself as this player (create, join or resume).
function connectPlayer(room, player, socketId) {
  player.connected = true;
  player.socketId = socketId;
  clearTimeout(player.removeTimer);
  player.removeTimer = null;
  updateEmptyRoomTimer(room);
}

// A socket disconnected. Returns the room if something changed, else null.
function disconnectSocket(code, playerToken, socketId) {
  const room = rooms.get(code);
  if (!room) return null;
  const player = room.players.find((p) => p.token === playerToken);
  // Ignore old sockets (e.g. a second tab that was replaced by a newer one).
  if (!player || player.socketId !== socketId) return null;

  player.connected = false;
  player.socketId = null;

  // In the lobby, free the seat if the player does not come back soon.
  // During a game the seat is kept (reconnection rules come in Step 10).
  if (room.status === 'lobby') {
    player.removeTimer = setTimeout(() => {
      if (rooms.get(room.code) !== room) return; // room already deleted
      console.log(`"${player.name}" removed from room ${room.code} (disconnected)`);
      removePlayer(room, player);
      onRoomChanged(room);
    }, config.lobbyDisconnectGraceMs);
  }

  updateEmptyRoomTimer(room);
  return room;
}

// When nobody is connected, delete the room after emptyRoomDeleteAfterMs.
// As soon as someone connects again, the countdown is cancelled.
function updateEmptyRoomTimer(room) {
  const anyoneConnected = room.players.some((p) => p.connected);
  if (anyoneConnected) {
    clearTimeout(room.deleteTimer);
    room.deleteTimer = null;
  } else if (!room.deleteTimer) {
    room.deleteTimer = setTimeout(() => deleteRoom(room), config.emptyRoomDeleteAfterMs);
  }
}

function deleteRoom(room) {
  room.players.forEach((p) => clearTimeout(p.removeTimer));
  clearTimeout(room.deleteTimer);
  engine.stopGame(room); // stops the roll / turn timers, if a game is running
  rooms.delete(room.code);
  console.log(`Room ${room.code} deleted (empty)`);
}

// ---------- Leaving ----------

function removePlayer(room, player) {
  clearTimeout(player.removeTimer);
  const seat = room.players.indexOf(player);
  if (seat === -1) return;
  room.players.splice(seat, 1);

  // Host left: the next player in seat order becomes host.
  // After splice, the next player now sits at index "seat".
  if (room.hostId === player.id) {
    room.hostId = pickNextHost(room, seat);
  }
  updateEmptyRoomTimer(room);
}

// Prefer the next CONNECTED player in seat order (wrapping around);
// if nobody is connected, just take the next seat.
function pickNextHost(room, startSeat) {
  const count = room.players.length;
  if (count === 0) return null;
  for (let i = 0; i < count; i++) {
    const candidate = room.players[(startSeat + i) % count];
    if (candidate.connected) return candidate.id;
  }
  return room.players[startSeat % count].id;
}

// Player clicked "leave" in the lobby.
function leaveRoom(room, player) {
  requireLobby(room);
  console.log(`"${player.name}" left room ${room.code}`);
  removePlayer(room, player);
}

// ---------- Lobby choices ----------

function choosePiece(room, player, pieceId) {
  requireLobby(room);
  if (!PIECES.some((p) => p.id === pieceId)) fail(MSG.pieceInvalid);
  const takenByOther = room.players.some((p) => p !== player && p.piece === pieceId);
  if (takenByOther) fail(MSG.pieceTaken);
  player.piece = pieceId;
}

function chooseColor(room, player, colorId) {
  requireLobby(room);
  if (!config.playerColors.some((c) => c.id === colorId)) fail(MSG.colorInvalid);
  const takenByOther = room.players.some((p) => p !== player && p.color === colorId);
  if (takenByOther) fail(MSG.colorTaken);
  player.color = colorId;
}

// ---------- Starting ----------

// Returns null if the game can start, otherwise the reason (Bangla text).
function startProblem(room) {
  const count = room.players.length;
  if (count < config.minPlayers) return MSG.notEnoughPlayers;
  if (count > config.maxPlayers) return MSG.tooManyPlayers;
  if (room.players.some((p) => !p.piece || !p.color)) return MSG.notAllReady;
  if (room.players.some((p) => !p.connected)) return MSG.someoneDisconnected;
  return null;
}

function startGame(room, player) {
  requireLobby(room);
  if (room.hostId !== player.id) fail(MSG.notHost);
  const problem = startProblem(room);
  if (problem) fail(problem);

  room.status = 'playing';
  room.players.forEach((p) => {
    clearTimeout(p.removeTimer);
    p.removeTimer = null;
  });
  engine.initGame(room); // money, positions, turn order, log
  console.log(`Room ${room.code}: game started with ${room.players.length} players`);
}

// ---------- What clients are allowed to see ----------

// Everything a player may know about the room.
// Player tokens and socket ids are secret and never included.
function publicState(room) {
  const problem = room.status === 'lobby' ? startProblem(room) : null;
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      piece: p.piece,
      color: p.color,
      connected: p.connected,
      money: p.money,
      position: p.position,
      inJail: p.inJail
    })),
    canStart: room.status === 'lobby' && problem === null,
    startProblem: problem,
    game: room.game ? engine.publicGame(room) : null // null while in the lobby
  };
}

module.exports = {
  setRoomChangedListener,
  createRoom,
  joinRoom,
  getRoomAndPlayer,
  connectPlayer,
  disconnectSocket,
  leaveRoom,
  choosePiece,
  chooseColor,
  startGame,
  publicState
};
