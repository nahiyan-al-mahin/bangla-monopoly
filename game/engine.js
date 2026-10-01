// game/engine.js
// Core game loop: turn order, dice, movement, GO salary, going to jail.
//
// TURN PHASES (room.game.phase):
//
//   'roll'  -- the current player must roll the dice.
//      |
//      |  rollDice()
//      v
//   'moved' -- the piece has moved; the player may end the turn.
//      |       (Steps 5-7 add buying, rent, building, ... in this phase.)
//      |  endTurn()
//      v
//   next player, phase 'roll'
//
// Special cases inside rollDice():
//   - Doubles: the phase stays 'roll', so the same player rolls again.
//   - 3rd double in a row, or landing on হাজতখানায় যাও: the player goes to
//     jail (no GO salary) and the turn ends automatically (classic rule:
//     going to jail ends your turn, even after doubles).
//
// The server is the only one that rolls dice (crypto.randomInt).
// Client dice values are used ONLY when config.debugDice is on.

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
  cannotRollNow: 'এখন পাশা ফেলা যাবে না। আপনার চাল শেষ করুন।',
  rollFirst: 'আগে পাশা ফেলুন।',
  rollAgainFirst: 'জোড়া পড়েছে! আগে আবার পাশা ফেলুন।',
  badDebugDice: 'পরীক্ষার পাশার মান 1 থেকে 6 হতে হবে।'
};

// ---------- Setup ----------

// Called once by rooms.startGame().
function initGame(room) {
  room.players.forEach((p) => {
    p.money = config.startingMoney;
    p.position = 0; // everyone starts on শুরু
    p.inJail = false;
  });

  room.game = {
    turnIndex: 0,      // index into room.players (seat order)
    phase: 'roll',
    doublesCount: 0,   // doubles rolled in a row during this turn
    dice: null,        // last roll, e.g. [3, 5]
    lastMove: null,    // last movement, so clients can animate it
    moveCounter: 0,    // gives every move a unique id
    log: []            // newest first, at most config.logLimit entries
  };

  addLog(room, `খেলা শুরু হলো! প্রথম চাল: ${currentPlayer(room).name}`);
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
  if (room.status !== 'playing' || !room.game) fail(MSG.notPlaying);
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

// Move on to the next player in seat order.
function advanceTurn(room) {
  const game = room.game;
  game.turnIndex = (game.turnIndex + 1) % room.players.length;
  game.phase = 'roll';
  game.doublesCount = 0;
  addLog(room, `এখন পালা: ${currentPlayer(room).name}`);
}

// ---------- Actions ----------

// The current player rolls. requestedDice is only used with DEBUG_DICE=1.
function rollDice(room, player, requestedDice) {
  requireTurn(room, player);
  const game = room.game;
  if (game.phase !== 'roll') fail(MSG.cannotRollNow);

  // Client dice are ignored completely unless debug mode is on.
  const debugDice = config.debugDice ? readDebugDice(requestedDice) : null;
  const dice = debugDice || randomDice();
  const total = dice[0] + dice[1];
  const isDouble = dice[0] === dice[1];
  game.dice = dice;

  addLog(room,
    `${player.name} পাশা ফেললেন: ${dice[0]} + ${dice[1]} = ${total}` +
    (isDouble ? ' (জোড়া!)' : '') +
    (debugDice ? ' [পরীক্ষা]' : ''));

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
    advanceTurn(room);
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
  // Landing effects (buy, rent, tax, cards) come in Steps 5-6.

  // Landing on হাজতখানায় যাও: to jail, no GO salary, turn ends.
  if (square.type === 'go_to_jail') {
    sendToJail(room, player);
    game.lastMove = { id: ++game.moveCounter, playerId: player.id, from, path, jumpTo: JAIL_INDEX };
    addLog(room, `${player.name} হাজতখানায় গেলেন!`);
    advanceTurn(room);
    return;
  }

  game.lastMove = { id: ++game.moveCounter, playerId: player.id, from, path, jumpTo: null };

  if (isDouble) {
    game.phase = 'roll'; // same player rolls again
    addLog(room, `জোড়া পড়েছে! ${player.name} আবার পাশা ফেলবেন।`);
  } else {
    game.phase = 'moved';
  }
}

// The current player ends their turn (only after moving).
function endTurn(room, player) {
  requireTurn(room, player);
  const game = room.game;
  if (game.phase === 'roll') {
    fail(game.doublesCount > 0 ? MSG.rollAgainFirst : MSG.rollFirst);
  }
  addLog(room, `${player.name} চাল শেষ করলেন।`);
  advanceTurn(room);
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
    log: game.log
  };
}

module.exports = { initGame, rollDice, endTurn, publicGame };
