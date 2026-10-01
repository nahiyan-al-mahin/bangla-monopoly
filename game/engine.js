// game/engine.js
// Core game loop: turn order, dice, movement, GO salary, going to jail,
// and the server-side turn timers.
//
// TURN PHASES (room.game.phase):
//
//   'roll'    -- waiting for the current player to roll.
//      |        A roll timer runs (ROLL_TIMEOUT_SECONDS). If it runs out,
//      |        the server rolls for the player (normal random dice).
//      |  rollDice() or timeout
//      v
//   'moving'  -- the piece is walking; nobody can act.
//      |        A short timer waits for the walk animation + TURN_END_DELAY_MS.
//      |  afterMove()
//      v
//   [Step 5+: a pending decision (buy/auction, jail options) pauses here]
//      |
//      v
//   continueTurn(): doubles -> same player, phase 'roll' with a new timer
//                   otherwise -> next player, phase 'roll' with a new timer
//
// Going to jail (3rd double in a row, or landing on হাজতখানায় যাও) ends the
// turn: no extra roll, even after doubles (classic rule).
//
// Only ONE timer runs per game at a time (room.game.timer). It is always
// cleared before a new one starts, and stopGame() clears it for good.
//
// The server is the only one that rolls dice (crypto.randomInt).
// Client dice values are used ONLY when config.debugDice is on, and never
// for automatic (timeout) rolls.

const crypto = require('crypto');
const config = require('./config');
const { fail } = require('./errors');
const { SQUARES } = require('../data/board');

const BOARD_SIZE = SQUARES.length; // 40
const JAIL_INDEX = SQUARES.findIndex((s) => s.type === 'jail'); // 10

// --- Player-facing error messages (Bangla) ---
const MSG = {
  notPlaying: 'খেলা এখনো শুরু হয়নি।',
  notYourTurn: 'এখন আপনার পালা নয়।',
  cannotRollNow: 'এখন পাশা ফেলা যাবে না।',
  badDebugDice: 'পরীক্ষার পাশার মান 1 থেকে 6 হতে হবে।'
};

// server.js registers a function here. Timers change the game without any
// player request (auto roll, turn passing), so they call this to broadcast.
let onGameChanged = () => {};

function setGameChangedListener(listener) {
  onGameChanged = listener;
}

// ---------- Setup and shutdown ----------

// Called once by rooms.startGame().
function initGame(room) {
  room.players.forEach((p) => {
    p.money = config.startingMoney;
    p.position = 0; // everyone starts on শুরু
    p.inJail = false;
  });

  room.game = {
    turnIndex: 0,          // index into room.players (seat order)
    phase: 'roll',         // 'roll' | 'moving'
    doublesCount: 0,       // doubles rolled in a row during this turn
    extraRoll: false,      // true after a double: same player rolls again
    dice: null,            // last roll, e.g. [3, 5]
    lastMove: null,        // last movement, so clients can animate it
    moveCounter: 0,        // gives every move a unique id
    rollDeadline: null,    // when the roll timer runs out (ms timestamp)
    // Step 5+: a decision that must be answered before the turn can go on
    // (e.g. { type: 'buy', ... }). Always null in Step 4.
    pendingDecision: null,
    timer: null,           // the one running timer (setTimeout handle)
    stopped: false,        // true after stopGame(): timers must do nothing
    log: []                // newest first, at most config.logLimit entries
  };

  addLog(room, `খেলা শুরু হলো! প্রথম চাল: ${currentPlayer(room).name}`);
  startRollTimer(room);
}

// Stop all game timers. Called when the room is deleted, and (Step 9)
// when the game ends.
function stopGame(room) {
  if (!room.game) return;
  clearGameTimer(room);
  room.game.stopped = true;
  room.game.rollDeadline = null;
}

// ---------- Helpers ----------

function currentPlayer(room) {
  return room.players[room.game.turnIndex];
}

function addLog(room, text) {
  room.game.log.unshift({ text, time: Date.now() });
  room.game.log.length = Math.min(room.game.log.length, config.logLimit);
}

// Check that the game is running and it is this player's turn.
function requireTurn(room, player) {
  if (room.status !== 'playing' || !room.game || room.game.stopped) fail(MSG.notPlaying);
  if (currentPlayer(room) !== player) fail(MSG.notYourTurn);
}

// Roll two dice on the server: numbers 1-6.
function randomDice() {
  return [crypto.randomInt(1, 7), crypto.randomInt(1, 7)];
}

// DEBUG_DICE only: accept [a, b] with whole numbers 1-6 from the client.
// Returns null if the client sent nothing (then we roll normally).
function readDebugDice(requestedDice) {
  if (requestedDice === undefined || requestedDice === null) return null;
  const valid =
    Array.isArray(requestedDice) &&
    requestedDice.length === 2 &&
    requestedDice.every((d) => Number.isInteger(d) && d >= 1 && d <= 6);
  if (!valid) fail(MSG.badDebugDice);
  return [requestedDice[0], requestedDice[1]];
}

function sendToJail(room, player) {
  player.position = JAIL_INDEX;
  player.inJail = true;
}

// ---------- Timers ----------

function clearGameTimer(room) {
  clearTimeout(room.game.timer);
  room.game.timer = null;
}

// Run fn after ms, unless the game was stopped in the meantime.
// Replaces any timer that is already running.
function setGameTimer(room, ms, fn) {
  clearGameTimer(room);
  const game = room.game;
  game.timer = setTimeout(() => {
    game.timer = null;
    if (game.stopped || room.game !== game) return;
    fn();
    onGameChanged(room);
  }, ms);
}

// Phase 'roll': the current player has ROLL_TIMEOUT_SECONDS to roll.
function startRollTimer(room) {
  const game = room.game;
  const ms = config.ROLL_TIMEOUT_SECONDS * 1000;
  game.phase = 'roll';
  game.rollDeadline = Date.now() + ms;
  setGameTimer(room, ms, () => autoRoll(room));
}

// Time ran out: roll for the player with normal random dice.
function autoRoll(room) {
  const player = currentPlayer(room);
  addLog(room, `সময় শেষ! ${player.name}-এর হয়ে স্বয়ংক্রিয়ভাবে পাশা ফেলা হলো।`);
  performRoll(room, player, randomDice(), false);
}

// How long clients need to animate a move (must match public/js/game.js).
function moveAnimationMs(move) {
  return move.path.length * config.moveStepMs + (move.jumpTo !== null ? config.moveJumpPauseMs : 0);
}

// ---------- Turn flow ----------

// The current player rolls. requestedDice is only used with DEBUG_DICE=1.
function rollDice(room, player, requestedDice) {
  requireTurn(room, player);
  if (room.game.phase !== 'roll') fail(MSG.cannotRollNow);

  // Client dice are ignored completely unless debug mode is on.
  const debugDice = config.debugDice ? readDebugDice(requestedDice) : null;
  performRoll(room, player, debugDice || randomDice(), Boolean(debugDice));
}

// Roll, move and resolve the landing. Used by rollDice() and autoRoll().
function performRoll(room, player, dice, isDebug) {
  const game = room.game;
  clearGameTimer(room); // the roll timer is no longer needed
  game.rollDeadline = null;

  const total = dice[0] + dice[1];
  const isDouble = dice[0] === dice[1];
  game.dice = dice;
  game.extraRoll = false;

  addLog(room,
    `${player.name} পাশা ফেললেন: ${dice[0]} + ${dice[1]} = ${total}` +
    (isDouble ? ' (জোড়া!)' : '') +
    (isDebug ? ' [পরীক্ষা]' : ''));

  // TEMP until Step 6: no jail escape rules yet. A jailed player simply
  // leaves jail on their next turn and rolls normally.
  if (player.inJail) {
    player.inJail = false;
    addLog(room, `${player.name} হাজতখানা থেকে বের হলেন (অস্থায়ী নিয়ম)।`);
  }

  // Three doubles in a row: straight to jail, no movement, turn ends.
  if (isDouble) game.doublesCount += 1;
  if (game.doublesCount >= config.maxDoublesBeforeJail) {
    const from = player.position;
    sendToJail(room, player);
    game.lastMove = { id: ++game.moveCounter, playerId: player.id, from, path: [], jumpTo: JAIL_INDEX };
    addLog(room, `${player.name} পরপর ${config.maxDoublesBeforeJail} বার জোড়া ফেলেছেন — সোজা হাজতখানায়!`);
    startMoving(room);
    return;
  }

  // Move clockwise one square at a time (the path is used for animation).
  const from = player.position;
  const path = [];
  for (let step = 1; step <= total; step++) {
    path.push((from + step) % BOARD_SIZE);
  }
  const to = path[path.length - 1];
  player.position = to;

  // Passing or landing on শুরু: the new position "wrapped around" past 39.
  if (to < from) {
    player.money += config.goSalary;
    addLog(room, to === 0
      ? `${player.name} শুরু-তে থেমে ৳${config.goSalary} পেলেন।`
      : `${player.name} শুরু পার হয়ে ৳${config.goSalary} পেলেন।`);
  }

  const square = SQUARES[to];
  addLog(room, `${player.name} পৌঁছালেন: ${square.name}`);

  // Landing on হাজতখানায় যাও: to jail, no GO salary, turn ends.
  if (square.type === 'go_to_jail') {
    sendToJail(room, player);
    game.lastMove = { id: ++game.moveCounter, playerId: player.id, from, path, jumpTo: JAIL_INDEX };
    addLog(room, `${player.name} হাজতখানায় গেলেন!`);
    startMoving(room);
    return;
  }

  game.lastMove = { id: ++game.moveCounter, playerId: player.id, from, path, jumpTo: null };

  // ------------------------------------------------------------------
  // STEP 5-6 HOOK: resolve the landing square here (buy/auction, rent,
  // tax, cards). If the player must make a choice, set
  //   game.pendingDecision = { type: 'buy', ... }
  // afterMove() will then wait instead of ending the turn.
  // ------------------------------------------------------------------

  game.extraRoll = isDouble; // doubles: same player rolls again after the move
  startMoving(room);
}

// Phase 'moving': wait for the animation + TURN_END_DELAY_MS, then go on.
function startMoving(room) {
  const game = room.game;
  game.phase = 'moving';
  const waitMs = moveAnimationMs(game.lastMove) + config.TURN_END_DELAY_MS;
  setGameTimer(room, waitMs, () => afterMove(room));
}

// The move has been shown to everyone.
function afterMove(room) {
  // ------------------------------------------------------------------
  // STEP 5+ HOOK: a pending decision pauses the automatic turn end.
  // The decision's handler (e.g. "buy" / "auction") must clear
  // game.pendingDecision and then call continueTurn(room) itself.
  // ------------------------------------------------------------------
  if (room.game.pendingDecision) return;

  continueTurn(room);
}

// Extra roll after doubles, or pass the turn to the next player.
function continueTurn(room) {
  const game = room.game;
  if (game.extraRoll) {
    game.extraRoll = false;
    addLog(room, `জোড়া পড়েছে! ${currentPlayer(room).name} আবার পাশা ফেলবেন।`);
    startRollTimer(room); // fresh timer for the extra roll
    return;
  }
  advanceTurn(room);
}

// Move on to the next player in seat order and start their roll timer.
function advanceTurn(room) {
  const game = room.game;
  game.turnIndex = (game.turnIndex + 1) % room.players.length;
  game.doublesCount = 0;
  game.extraRoll = false;
  addLog(room, `এখন পালা: ${currentPlayer(room).name}`);
  startRollTimer(room);
}

// ---------- What clients may see ----------

function publicGame(room) {
  const game = room.game;
  return {
    currentPlayerId: currentPlayer(room).id,
    phase: game.phase,
    doublesCount: game.doublesCount,
    dice: game.dice,
    lastMove: game.lastMove,
    rollDeadline: game.rollDeadline, // clients show a countdown to this
    serverTime: Date.now(),          // lets clients correct for clock differences
    log: game.log
  };
}

module.exports = {
  setGameChangedListener,
  initGame,
  stopGame,
  rollDice,
  publicGame
};
