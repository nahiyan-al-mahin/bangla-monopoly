// game/engine.js
// Core game loop: turns, dice, movement, GO salary, jail, landing effects
// (buy / auction / rent / tax) and the server-side timers.
//
// TURN PHASES (room.game.phase):
//
//   'roll'     -- waiting for the current player to roll.
//      |         Roll timer (ROLL_TIMEOUT_SECONDS); on timeout the server rolls.
//      |  rollDice() or timeout
//      v
//   'moving'   -- the piece walks (clients animate it). Nobody can act.
//      |  onArrive(): resolve the landing square
//      |    - rent / tax are paid automatically
//      |    - unowned property -> pending decision:
//      |
//      |      'buy'      -- current player: "buy" or "auction"
//      |         |          (BUY_DECISION_SECONDS, timeout = auction)
//      |         v
//      |      'auction'  -- everyone bids or passes
//      |                    (AUCTION_SECONDS, restarted after each bid)
//      |         |
//      |      finishDecision()
//      v
//   short pause (TURN_END_DELAY_MS), then continueTurn():
//      doubles -> same player, phase 'roll' with a new timer
//      otherwise -> next player, phase 'roll' with a new timer
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
const BUYABLE_TYPES = ['property', 'railroad', 'utility'];

// Rent key in data/board.js for 0-5 buildings (5 = hotel). Buildings: Step 7.
const BUILDING_RENT_KEYS = ['base', 'h1', 'h2', 'h3', 'h4', 'hotel'];

// --- Player-facing error messages (Bangla) ---
const MSG = {
  notPlaying: 'খেলা এখনো শুরু হয়নি।',
  notYourTurn: 'এখন আপনার পালা নয়।',
  cannotRollNow: 'এখন পাশা ফেলা যাবে না।',
  badDebugDice: 'পরীক্ষার পাশার মান 1 থেকে 6 হতে হবে।',
  notBuyTime: 'এখন কেনার সিদ্ধান্ত নেওয়ার সময় নয়।',
  cannotAfford: 'আপনার কাছে যথেষ্ট টাকা নেই।',
  noAuction: 'এখন কোনো নিলাম চলছে না।',
  alreadyPassed: 'আপনি এই নিলামে পাস করেছেন, আর দর দিতে পারবেন না।',
  badBid: 'দরটি ঠিক নেই।',
  bidBelowMin: `সর্বনিম্ন দর ৳${config.auction.startingBid}।`,
  bidTooLow: 'দর বর্তমান সর্বোচ্চ দরের চেয়ে বেশি হতে হবে।',
  bidTooHigh: 'আপনার কাছে এত টাকা নেই।',
  alreadyHighest: 'আপনিই এখন সর্বোচ্চ দরদাতা।',
  highestCannotPass: 'সর্বোচ্চ দরদাতা পাস করতে পারবেন না।'
};

// server.js registers a function here. Timers change the game without any
// player request (auto roll, auction end, turn passing), so they call this
// to broadcast the new state.
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
    phase: 'roll',         // 'roll' | 'moving' | 'buy' | 'auction'
    doublesCount: 0,       // doubles rolled in a row during this turn
    extraRoll: false,      // true after a double: same player rolls again
    dice: null,            // last roll, e.g. [3, 5]
    lastMove: null,        // last movement, so clients can animate it
    moveCounter: 0,        // gives every move a unique id
    rollDeadline: null,    // when the roll timer runs out (ms timestamp)
    // Owned squares, keyed by square index:
    //   { ownerId, mortgaged (Step 7), houses: 0-4, 5 = hotel (Step 7) }
    // A square that is not in here belongs to the bank.
    properties: {},
    // A decision that must be answered before the turn can go on:
    //   { type: 'buy', playerId, squareIndex, deadline }
    //   { type: 'auction', squareIndex, highestBid, highestBidderId, passedIds, deadline }
    // Step 6 adds jail options here.
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

function playerById(room, id) {
  return room.players.find((p) => p.id === id) || null;
}

function addLog(room, text) {
  room.game.log.unshift({ text, time: Date.now() });
  room.game.log.length = Math.min(room.game.log.length, config.logLimit);
}

function requirePlaying(room) {
  if (room.status !== 'playing' || !room.game || room.game.stopped) fail(MSG.notPlaying);
}

// Check that the game is running and it is this player's turn.
function requireTurn(room, player) {
  requirePlaying(room);
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

// Move money. "to" = null means the bank.
// TEMP until Step 9: money may go below zero. Selling/mortgaging to raise
// cash and bankruptcy come in Step 9; until then the debt simply stays.
function pay(room, from, to, amount) {
  from.money -= amount;
  if (to) to.money += amount;
  if (from.money < 0) {
    addLog(room, `${from.name}-এর টাকা শূন্যের নিচে নেমে গেছে (${from.money})।`);
  }
}

// ---------- Ownership and rent ----------

function ownerOf(room, squareIndex) {
  const state = room.game.properties[squareIndex];
  return state ? playerById(room, state.ownerId) : null;
}

function giveProperty(room, player, squareIndex) {
  room.game.properties[squareIndex] = { ownerId: player.id, mortgaged: false, houses: 0 };
}

// How many squares of this type (e.g. 'railroad') the player owns.
// Mortgaged ones count too (classic rule).
function countOwned(room, player, type) {
  return SQUARES.filter((s) => s.type === type && ownerOf(room, s.index) === player).length;
}

// Does the player own every property of this color group?
// Mortgaged properties still count (classic: rent is still doubled).
function ownsWholeGroup(room, player, group) {
  return SQUARES
    .filter((s) => s.group === group)
    .every((s) => ownerOf(room, s.index) === player);
}

// Rent for landing on an owned square. Returns { amount, detail } where
// detail is a short Bangla explanation for the log.
function calculateRent(room, square, owner, diceTotal) {
  if (square.type === 'railroad') {
    const count = countOwned(room, owner, 'railroad');
    return { amount: config.railroadRent[count - 1], detail: `${count}টি রেলস্টেশন` };
  }

  if (square.type === 'utility') {
    const count = countOwned(room, owner, 'utility');
    const multiplier = config.utilityMultipliers[count - 1];
    return { amount: diceTotal * multiplier, detail: `পাশা ${diceTotal} × ${multiplier}` };
  }

  // Property
  const houses = room.game.properties[square.index].houses;
  if (houses > 0) {
    const detail = houses === 5 ? 'হোটেলসহ' : `${houses}টি বাড়িসহ`;
    return { amount: square.rent[BUILDING_RENT_KEYS[houses]], detail };
  }
  if (ownsWholeGroup(room, owner, square.group)) {
    return { amount: square.rent.set, detail: 'পুরো রঙের সেট' };
  }
  return { amount: square.rent.base, detail: '' };
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

// ---------- Rolling and moving ----------

// The current player rolls. requestedDice is only used with DEBUG_DICE=1.
function rollDice(room, player, requestedDice) {
  requireTurn(room, player);
  if (room.game.phase !== 'roll') fail(MSG.cannotRollNow);

  // Client dice are ignored completely unless debug mode is on.
  const debugDice = config.debugDice ? readDebugDice(requestedDice) : null;
  performRoll(room, player, debugDice || randomDice(), Boolean(debugDice));
}

// Roll and move. Used by rollDice() and autoRoll().
// The landing square is resolved later, in onArrive(), once the walk
// animation has finished, so everyone sees the piece arrive first.
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
  game.extraRoll = isDouble; // doubles: same player rolls again after this turn part
  startMoving(room);
}

// Phase 'moving': wait for the walk animation, then resolve the landing.
function startMoving(room) {
  room.game.phase = 'moving';
  setGameTimer(room, moveAnimationMs(room.game.lastMove), () => onArrive(room));
}

// The piece has arrived (animation done).
function onArrive(room) {
  const game = room.game;
  const sentToJail = game.lastMove.jumpTo !== null;
  if (!sentToJail) resolveLanding(room, currentPlayer(room));

  // A pending decision (buy/auction; Step 6: jail options) pauses the turn.
  // Its handler calls finishDecision() when it is resolved.
  if (game.pendingDecision) return;

  waitThenContinue(room);
}

// What happens on the square the player landed on.
function resolveLanding(room, player) {
  const game = room.game;
  const square = SQUARES[player.position];

  if (square.type === 'tax') {
    pay(room, player, null, square.amount);
    addLog(room, `${player.name} ${square.name} বাবদ ব্যাংককে ৳${square.amount} দিলেন।`);
    return;
  }

  // Step 6: ভাগ্য / সমাজকল্যাণ cards go here.
  // শুরু, হাজতখানা (just visiting) and চায়ের দোকান: nothing happens.
  if (!BUYABLE_TYPES.includes(square.type)) return;

  const owner = ownerOf(room, square.index);

  // Unowned: the player decides to buy or send it to auction.
  if (!owner) {
    startBuyDecision(room, player, square);
    return;
  }

  if (owner === player) {
    addLog(room, `${player.name} নিজের সম্পত্তিতে থামলেন।`);
    return;
  }

  if (game.properties[square.index].mortgaged) {
    addLog(room, `${square.name} বন্ধক রাখা — কোনো ভাড়া দিতে হবে না।`);
    return;
  }

  const diceTotal = game.dice[0] + game.dice[1];
  const rent = calculateRent(room, square, owner, diceTotal);
  pay(room, player, owner, rent.amount);
  addLog(room,
    `${player.name} ${owner.name}-কে ৳${rent.amount} ভাড়া দিলেন ` +
    `(${square.name}${rent.detail ? ', ' + rent.detail : ''})।`);
}

// A decision has been resolved: short pause, then the turn goes on.
function finishDecision(room) {
  room.game.pendingDecision = null;
  waitThenContinue(room);
}

// Phase stays 'moving' for TURN_END_DELAY_MS so everyone sees the result.
function waitThenContinue(room) {
  room.game.phase = 'moving';
  setGameTimer(room, config.TURN_END_DELAY_MS, () => continueTurn(room));
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

// ---------- Buying ----------

function startBuyDecision(room, player, square) {
  const game = room.game;
  const ms = config.BUY_DECISION_SECONDS * 1000;
  game.phase = 'buy';
  game.pendingDecision = {
    type: 'buy',
    playerId: player.id,
    squareIndex: square.index,
    deadline: Date.now() + ms
  };
  // No answer in time: the property goes to auction.
  setGameTimer(room, ms, () => {
    addLog(room, `সময় শেষ! ${player.name} সিদ্ধান্ত নেননি — ${square.name} নিলামে উঠল।`);
    startAuction(room, square);
  });
}

function requireBuyDecision(room, player) {
  requireTurn(room, player);
  const decision = room.game.pendingDecision;
  if (room.game.phase !== 'buy' || !decision || decision.playerId !== player.id) fail(MSG.notBuyTime);
  return SQUARES[decision.squareIndex];
}

// "কিনুন": pay the list price to the bank.
function buyProperty(room, player) {
  const square = requireBuyDecision(room, player);
  if (player.money < square.price) fail(MSG.cannotAfford);

  pay(room, player, null, square.price);
  giveProperty(room, player, square.index);
  addLog(room, `${player.name} ${square.name} কিনলেন ৳${square.price}-এ।`);
  finishDecision(room);
}

// "নিলাম": the player does not buy; everyone may bid.
function declineProperty(room, player) {
  const square = requireBuyDecision(room, player);
  addLog(room, `${player.name} ${square.name} কিনলেন না।`);
  startAuction(room, square);
}

// ---------- Auction ----------
// Open to all players, including the one who declined.

function startAuction(room, square) {
  const game = room.game;
  game.phase = 'auction';
  game.pendingDecision = {
    type: 'auction',
    squareIndex: square.index,
    highestBid: 0,
    highestBidderId: null,
    passedIds: [],
    deadline: null // set by restartAuctionTimer
  };
  addLog(room, `নিলাম শুরু: ${square.name} (সর্বনিম্ন দর ৳${config.auction.startingBid})`);
  restartAuctionTimer(room);
}

function restartAuctionTimer(room) {
  const ms = config.AUCTION_SECONDS * 1000;
  room.game.pendingDecision.deadline = Date.now() + ms;
  setGameTimer(room, ms, () => endAuction(room));
}

function requireAuction(room, player) {
  requirePlaying(room);
  const auction = room.game.pendingDecision;
  if (room.game.phase !== 'auction' || !auction || auction.type !== 'auction') fail(MSG.noAuction);
  if (auction.passedIds.includes(player.id)) fail(MSG.alreadyPassed);
  return auction;
}

function placeBid(room, player, amount) {
  const auction = requireAuction(room, player);

  if (!Number.isInteger(amount)) fail(MSG.badBid);
  if (auction.highestBidderId === player.id) fail(MSG.alreadyHighest);
  if (amount < config.auction.startingBid) fail(MSG.bidBelowMin);
  if (amount <= auction.highestBid) fail(MSG.bidTooLow);
  if (amount > player.money) fail(MSG.bidTooHigh);

  auction.highestBid = amount;
  auction.highestBidderId = player.id;
  addLog(room, `${player.name} দর দিলেন ৳${amount}`);

  if (everyoneElsePassed(room)) {
    endAuction(room);
  } else {
    restartAuctionTimer(room);
  }
}

function passAuction(room, player) {
  const auction = requireAuction(room, player);
  if (auction.highestBidderId === player.id) fail(MSG.highestCannotPass);

  auction.passedIds.push(player.id);
  addLog(room, `${player.name} নিলামে পাস করলেন।`);

  if (everyoneElsePassed(room)) endAuction(room);
  // Otherwise the countdown keeps running (passing does not restart it).
}

// True when nobody can still outbid: everyone except the highest bidder
// (or simply everyone, if there is no bid yet) has passed.
function everyoneElsePassed(room) {
  const auction = room.game.pendingDecision;
  return room.players.every((p) =>
    p.id === auction.highestBidderId || auction.passedIds.includes(p.id));
}

function endAuction(room) {
  const auction = room.game.pendingDecision;
  const square = SQUARES[auction.squareIndex];
  const winner = auction.highestBidderId ? playerById(room, auction.highestBidderId) : null;

  if (winner) {
    pay(room, winner, null, auction.highestBid);
    giveProperty(room, winner, square.index);
    addLog(room, `${winner.name} নিলামে ${square.name} কিনলেন ৳${auction.highestBid}-এ।`);
  } else {
    addLog(room, `কেউ দর দেননি — ${square.name} ব্যাংকের কাছেই রইল।`);
  }
  finishDecision(room);
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
    properties: game.properties,
    pendingDecision: game.pendingDecision,
    serverTime: Date.now(),          // lets clients correct for clock differences
    log: game.log
  };
}

module.exports = {
  setGameChangedListener,
  initGame,
  stopGame,
  rollDice,
  buyProperty,
  declineProperty,
  placeBid,
  passAuction,
  publicGame
};
