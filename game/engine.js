// game/engine.js
// Core game loop: turns, dice, movement, GO salary, jail, landing effects
// (buy / auction / rent / tax / cards) and the server-side timers.
//
// TURN PHASES (room.game.phase):
//
//   'roll'     -- waiting for the current player to roll.
//      |         Roll timer (ROLL_TIMEOUT_SECONDS); on timeout the server rolls.
//      |         A JAILED player may first pay ৳50 or use a jail-free card
//      |         (then rolls normally); rolling = trying for doubles (see Jail).
//      |  rollDice() or timeout
//      v
//   'moving'   -- the piece walks (clients animate it). Nobody can act.
//      |  onArrive(): resolve the landing square
//      |    - rent / tax are paid automatically
//      |    - ভাগ্য / সমাজকল্যাণ -> phase 'card': the card is shown for
//      |      CARD_SHOW_MS, then its effect happens (a card move is a normal
//      |      move: walk, then onArrive() again)
//      |    - unowned property -> pending decision:
//      |        'buy'  -- "কিনুন" or "কিনব না" (BUY_DECISION_SECONDS).
//      |                  Not buying (or timeout): it simply stays unowned.
//      |    - own property -> pending decision (house rule C):
//      |        'ownerAuction' -- "নিলামে তুলুন" or "রেখে দিন"
//      |           |              (OWNER_AUCTION_DECISION_SECONDS, timeout = keep)
//      |           v
//      |        'auction' -- the OTHER players bid; the winner pays the owner
//      |                     (AUCTION_SECONDS, restarted after each bid)
//      |  finishDecision()
//      v
//   short pause (TURN_END_DELAY_MS), then continueTurn():
//      doubles -> same player, phase 'roll' with a new timer
//      otherwise -> next player, phase 'roll' with a new timer
//
// Buildings and mortgages (Step 7) are not part of the turn: any player may
// build/sell/mortgage at any time except during an auction (see below).
//
// Going to jail (3rd double in a row, হাজতখানায় যাও, or a card) ends the
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
const { SQUARES, GROUPS } = require('../data/board');
const { CHANCE, COMMUNITY, DECK_NAMES } = require('../data/cards');

// All cards by id, so decks can store just ids
const CARDS_BY_ID = {};
CHANCE.forEach((card) => { CARDS_BY_ID[card.id] = { ...card, deck: 'chance' }; });
COMMUNITY.forEach((card) => { CARDS_BY_ID[card.id] = { ...card, deck: 'community' }; });

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
  notOwnerAuctionTime: 'এখন নিলামে তোলার সিদ্ধান্ত নেওয়ার সময় নয়।',
  cannotAuctionMortgaged: 'বন্ধক রাখা সম্পত্তি নিলামে তোলা যাবে না।',
  cannotAuctionBuildings: 'এই রঙের কোনো সম্পত্তিতে বাড়ি/হোটেল থাকলে নিলামে তোলা যাবে না।',
  noAuction: 'এখন কোনো নিলাম চলছে না।',
  sellerCannotBid: 'নিজের সম্পত্তির নিলামে দর দেওয়া যাবে না।',
  alreadyPassed: 'আপনি এই নিলামে পাস করেছেন, আর দর দিতে পারবেন না।',
  badBid: 'দরটি ঠিক নেই।',
  bidBelowMin: (min) => `সর্বনিম্ন দর ৳${min}।`,
  bidTooLow: 'দর বর্তমান সর্বোচ্চ দরের চেয়ে বেশি হতে হবে।',
  bidTooHigh: 'আপনার কাছে এত টাকা নেই।',
  alreadyHighest: 'আপনিই এখন সর্বোচ্চ দরদাতা।',
  highestCannotPass: 'সর্বোচ্চ দরদাতা পাস করতে পারবেন না।',
  notInJail: 'আপনি হাজতে নেই।',
  jailOptionsOnlyBeforeRoll: 'পাশা ফেলার আগেই শুধু এটি করা যায়।',
  cannotAffordFine: `জরিমানা ৳${config.jailFine} দেওয়ার মতো টাকা নেই।`,
  noJailFreeCard: 'আপনার কাছে জেল-মুক্তি কার্ড নেই।',
  // DEBUG_DICE card picker
  debugOff: 'পরীক্ষা মোড (DEBUG_DICE) চালু নেই।',
  unknownCard: 'এই কার্ডটি পাওয়া যায়নি।',
  cardIsHeld: 'এই কার্ডটি এখন একজন খেলোয়াড়ের হাতে আছে।',
  // Buildings and mortgage
  auctionRunning: 'নিলাম চলার সময় এটি করা যাবে না।',
  notYourProperty: 'এটি আপনার সম্পত্তি নয়।',
  cannotBuildHere: 'রেলস্টেশন বা ইউটিলিটিতে বাড়ি হয় না',
  noFullSet: 'পুরো রঙের সেট নেই',
  groupMortgaged: 'এই রঙের কোনো সম্পত্তি বন্ধক রাখা',
  notEnoughMoney: 'টাকা যথেষ্ট নয়',
  buildEvenly: 'সমানভাবে বানাতে হবে',
  sellEvenly: 'সমানভাবে বিক্রি করতে হবে',
  nextIsHotel: '4টি বাড়ি হয়ে গেছে — এবার হোটেল',
  needFourHouses: 'রঙের প্রতিটি সম্পত্তিতে 4টি বাড়ি লাগবে',
  alreadyHotel: 'ইতিমধ্যে হোটেল আছে',
  noHousesInBank: 'ব্যাংকে আর বাড়ি নেই',
  noHotelsInBank: 'ব্যাংকে আর হোটেল নেই',
  sellHotelFirst: 'আগে হোটেল বিক্রি করুন',
  noHouseToSell: 'বিক্রি করার মতো বাড়ি নেই',
  noHotelToSell: 'এখানে হোটেল নেই',
  bankHousesForHotel: (n) => `হোটেল বিক্রি করলে 4টি বাড়ি ফেরত লাগে, কিন্তু ব্যাংকে আছে ${n}টি। আগে কোথাও বাড়ি বিক্রি করুন।`,
  alreadyMortgaged: 'ইতিমধ্যে বন্ধক রাখা',
  notMortgaged: 'বন্ধক রাখা নেই',
  sellBuildingsFirst: 'আগে এই রঙের সব বাড়ি/হোটেল বিক্রি করুন'
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
    p.jailTurns = 0;      // failed "try for doubles" attempts in jail
    p.jailFreeCards = []; // held jail-free cards: [{ deck, cardId }]
  });

  room.game = {
    turnIndex: 0,          // index into room.players (seat order)
    phase: 'roll',         // 'roll' | 'moving' | 'card' | 'buy' | 'ownerAuction' | 'auction'
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
    // Houses and hotels the bank still has (first come, first served)
    bank: { houses: config.bankHouses, hotels: config.bankHotels },
    // A decision that must be answered before the turn can go on:
    //   { type: 'buy', playerId, squareIndex, deadline }
    //   { type: 'ownerAuction', playerId, squareIndex, minBid, deadline }
    //   { type: 'auction', squareIndex, sellerId, minBid, highestBid,
    //     highestBidderId, passedIds, deadline }   (sellerId null = bank)
    pendingDecision: null,
    // Card decks: arrays of card ids, top = index 0. Shuffled at game start.
    decks: {
      chance: shuffle(CHANCE.map((c) => c.id)),
      community: shuffle(COMMUNITY.map((c) => c.id))
    },
    // The card being shown right now (everyone sees it), or null:
    //   { id, deck, deckName, text, effect, until }
    card: null,
    cardCounter: 0,
    // Set by "nearest railroad/utility" cards for the next landing only:
    //   'railroadDouble' | 'utility10' | null
    landingModifier: null,
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

// Fisher-Yates shuffle with the server's secure random numbers.
function shuffle(list) {
  const result = list.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
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

// Straight to হাজতখানা: no ৳200, and the turn will end (no extra roll).
function sendToJail(room, player) {
  player.position = JAIL_INDEX;
  player.inJail = true;
  player.jailTurns = 0;
  room.game.extraRoll = false;
}

function leaveJail(player) {
  player.inJail = false;
  player.jailTurns = 0;
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

// The rent that applies right now if someone lands on this owned square
// (display only, for the title-deed cards). Utilities depend on the dice,
// so they return the multiplier instead of an amount.
function currentRent(room, squareIndex) {
  const square = SQUARES[squareIndex];
  const owner = ownerOf(room, squareIndex);
  if (square.type === 'utility') {
    return { multiplier: config.utilityMultipliers[countOwned(room, owner, 'utility') - 1] };
  }
  return { amount: calculateRent(room, square, owner, 0).amount };
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

  // In jail: this roll is a "try for doubles" (CLAUDE.md default #3).
  if (player.inJail) {
    rollInJail(room, player, total, isDouble);
    return;
  }

  // Three doubles in a row: straight to jail, no movement, turn ends.
  if (isDouble) game.doublesCount += 1;
  if (game.doublesCount >= config.maxDoublesBeforeJail) {
    addLog(room, `${player.name} পরপর ${config.maxDoublesBeforeJail} বার জোড়া ফেলেছেন — সোজা হাজতখানায়!`);
    jumpToJail(room, player, []);
    return;
  }

  const { from, path } = movePlayer(room, player, total);
  game.extraRoll = isDouble; // doubles: same player rolls again after this turn part
  finishMove(room, player, from, path);
}

// Jailed player rolled (by choice or by timeout).
//   doubles          -> leave jail, move by this roll, NO extra roll
//   no doubles       -> jailTurns + 1; turn ends without moving
//   3rd failed roll  -> pay the fine (TEMP: may go negative) and move by this roll
function rollInJail(room, player, total, isDouble) {
  const game = room.game;

  if (isDouble) {
    leaveJail(player);
    addLog(room, `জোড়া পড়েছে! ${player.name} হাজতখানা থেকে বের হলেন (এই চালে আর বাড়তি পাশা নেই)।`);
  } else {
    player.jailTurns += 1;
    if (player.jailTurns < config.maxJailTurns) {
      addLog(room, `${player.name}-এর জোড়া পড়েনি (${player.jailTurns}/${config.maxJailTurns})। হাজতেই থাকলেন।`);
      game.lastMove = null;
      waitThenContinue(room); // turn ends, no movement
      return;
    }
    // Third failed attempt: pay and move by this roll.
    // TEMP until Step 9: the fine is taken even if money goes negative.
    pay(room, player, null, config.jailFine);
    leaveJail(player);
    addLog(room, `${config.maxJailTurns} বার চেষ্টায়ও জোড়া পড়েনি — ${player.name} ৳${config.jailFine} জরিমানা দিয়ে বের হলেন।`);
  }

  game.extraRoll = false; // leaving jail by rolling never gives an extra roll
  const { from, path } = movePlayer(room, player, total);
  finishMove(room, player, from, path);
}

// Move a player along the board, one square at a time.
//   steps > 0: forward (clockwise); passing or landing on শুরু pays ৳200
//   steps < 0: backward (e.g. "3 ঘর পিছিয়ে যান"); never pays ৳200
// Returns { from, path } for the walk animation.
function movePlayer(room, player, steps) {
  const from = player.position;
  const direction = steps > 0 ? 1 : -1;
  const path = [];
  for (let i = 1; i <= Math.abs(steps); i++) {
    path.push((from + direction * i + BOARD_SIZE) % BOARD_SIZE);
  }
  const to = path[path.length - 1];
  player.position = to;

  // Forward past 39 -> the position "wrapped around": passed or landed on শুরু.
  if (direction > 0 && to < from) {
    player.money += config.goSalary;
    addLog(room, to === 0
      ? `${player.name} শুরু-তে থেমে ৳${config.goSalary} পেলেন।`
      : `${player.name} শুরু পার হয়ে ৳${config.goSalary} পেলেন।`);
  }
  return { from, path };
}

// After a move (dice or card): log the square, handle হাজতখানায় যাও, and
// start the walk animation. The landing itself is resolved in onArrive().
function finishMove(room, player, from, path) {
  const game = room.game;
  const square = SQUARES[player.position];
  addLog(room, `${player.name} পৌঁছালেন: ${square.name}`);

  // Landing on হাজতখানায় যাও: to jail, no GO salary, turn ends.
  if (square.type === 'go_to_jail') {
    addLog(room, `${player.name} হাজতখানায় গেলেন!`);
    jumpToJail(room, player, path, from);
    return;
  }

  game.lastMove = { id: ++game.moveCounter, playerId: player.id, from, path, jumpTo: null };
  startMoving(room);
}

// Send to jail with an animation: walk "path" (may be empty), then jump.
function jumpToJail(room, player, path, from = player.position) {
  const game = room.game;
  sendToJail(room, player);
  game.lastMove = { id: ++game.moveCounter, playerId: player.id, from, path, jumpTo: JAIL_INDEX };
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

  // A pending decision (buy / owner auction) pauses the turn; its handler
  // calls finishDecision(). A drawn card runs its own timer (phase 'card').
  if (game.pendingDecision || game.phase === 'card') return;

  waitThenContinue(room);
}

// What happens on the square the player landed on.
function resolveLanding(room, player) {
  const game = room.game;
  const square = SQUARES[player.position];
  // Set by a "nearest railroad/utility" card; only for this one landing.
  const modifier = game.landingModifier;
  game.landingModifier = null;

  if (square.type === 'tax') {
    pay(room, player, null, square.amount);
    addLog(room, `${player.name} ${square.name} বাবদ ব্যাংককে ৳${square.amount} দিলেন।`);
    return;
  }

  if (square.type === 'chance' || square.type === 'community') {
    drawCard(room, player, square.type);
    return;
  }

  // শুরু, হাজতখানা (শুধু দেখতে আসা) and চায়ের দোকান: nothing happens.
  if (!BUYABLE_TYPES.includes(square.type)) return;

  const owner = ownerOf(room, square.index);

  // Unowned: the player decides to buy it or not.
  if (!owner) {
    startBuyDecision(room, player, square);
    return;
  }

  // Own square (house rule C): the owner may put it up for auction.
  if (owner === player) {
    if (ownerAuctionProblem(room, square) === null) {
      startOwnerAuctionDecision(room, player, square);
    } else {
      addLog(room, `${player.name} নিজের সম্পত্তিতে থামলেন।`);
    }
    return;
  }

  if (game.properties[square.index].mortgaged) {
    addLog(room, `${square.name} বন্ধক রাখা — কোনো ভাড়া দিতে হবে না।`);
    return;
  }

  let rent;
  if (modifier === 'railroadDouble') {
    // ভাগ্য card: double the normal railroad rent
    const normal = calculateRent(room, square, owner, 0);
    rent = { amount: normal.amount * 2, detail: normal.detail + ', কার্ড: দ্বিগুণ ভাড়া' };
  } else if (modifier === 'utility10') {
    // ভাগ্য card: roll the dice now and pay 10 x the total
    const dice = randomDice();
    const total = dice[0] + dice[1];
    game.dice = dice; // show this roll on the dice
    addLog(room, `${player.name} ভাড়ার জন্য পাশা ফেললেন: ${dice[0]} + ${dice[1]} = ${total}`);
    rent = { amount: total * 10, detail: `কার্ড: পাশা ${total} × 10` };
  } else {
    const diceTotal = game.dice[0] + game.dice[1];
    rent = calculateRent(room, square, owner, diceTotal);
  }
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
  const next = currentPlayer(room);
  addLog(room, next.inJail
    ? `এখন পালা: ${next.name} (হাজতে — বের হওয়ার উপায় বেছে নিন)`
    : `এখন পালা: ${next.name}`);
  startRollTimer(room);
}

// ---------- Buying ----------
// House rule C: not buying does NOT start an auction. The square simply
// stays with the bank and the turn goes on.

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
  // No answer in time: not bought.
  setGameTimer(room, ms, () => {
    addLog(room, `সময় শেষ! ${player.name} সিদ্ধান্ত নেননি — ${square.name} কেনা হলো না।`);
    finishDecision(room);
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

// "কিনব না": the square stays with the bank.
function declineProperty(room, player) {
  const square = requireBuyDecision(room, player);
  addLog(room, `${player.name} ${square.name} কিনলেন না।`);
  finishDecision(room);
}

// ---------- Owner auction (house rule C) ----------
// A player who lands on their own square may sell it by auction to the
// other players. The winner pays the owner.

// Minimum first bid: OWNER_AUCTION_MIN_RATIO x list price, rounded UP to ৳10.
function ownerAuctionMinBid(square) {
  return Math.ceil((square.price * config.OWNER_AUCTION_MIN_RATIO) / 10) * 10;
}

// Returns null if this square may be put up for auction, else the reason.
// Not allowed: mortgaged, or any square of its color group has buildings.
function ownerAuctionProblem(room, square) {
  const state = room.game.properties[square.index];
  if (state.mortgaged) return MSG.cannotAuctionMortgaged;
  if (square.group) {
    const groupHasBuildings = SQUARES.some((s) =>
      s.group === square.group &&
      room.game.properties[s.index] &&
      room.game.properties[s.index].houses > 0);
    if (groupHasBuildings) return MSG.cannotAuctionBuildings;
  }
  return null;
}

function startOwnerAuctionDecision(room, player, square) {
  const game = room.game;
  const ms = config.OWNER_AUCTION_DECISION_SECONDS * 1000;
  game.phase = 'ownerAuction';
  game.pendingDecision = {
    type: 'ownerAuction',
    playerId: player.id,
    squareIndex: square.index,
    minBid: ownerAuctionMinBid(square),
    deadline: Date.now() + ms
  };
  // No answer in time: the owner keeps it.
  setGameTimer(room, ms, () => {
    addLog(room, `সময় শেষ — ${player.name} ${square.name} রেখে দিলেন।`);
    finishDecision(room);
  });
}

function requireOwnerAuctionDecision(room, player) {
  requireTurn(room, player);
  const decision = room.game.pendingDecision;
  if (room.game.phase !== 'ownerAuction' || !decision || decision.playerId !== player.id) {
    fail(MSG.notOwnerAuctionTime);
  }
  return decision;
}

// "নিলামে তুলুন": the other players may bid.
function startOwnerAuction(room, player) {
  const decision = requireOwnerAuctionDecision(room, player);
  const square = SQUARES[decision.squareIndex];
  // Check again (the server never trusts that the button was allowed).
  const problem = ownerAuctionProblem(room, square);
  if (problem) fail(problem);

  addLog(room, `${player.name} ${square.name} নিলামে তুললেন (সর্বনিম্ন দর ৳${decision.minBid})।`);
  startAuction(room, square.index, { sellerId: player.id, minBid: decision.minBid });
}

// "রেখে দিন": the owner keeps it.
function keepProperty(room, player) {
  const decision = requireOwnerAuctionDecision(room, player);
  addLog(room, `${player.name} ${SQUARES[decision.squareIndex].name} রেখে দিলেন।`);
  finishDecision(room);
}

// ---------- Auction (reusable) ----------
// One auction engine for every kind of sale:
//   - owner auction (house rule C): sellerId = owner, minBid from the ratio
//   - Step 9 bankruptcy: sellerId = null (bank), minBid = config.auction.startingBid
// The seller cannot bid; everyone else may bid or pass.
// The winner pays the seller (or the bank) and gets the square.

function startAuction(room, squareIndex, { sellerId = null, minBid = config.auction.startingBid } = {}) {
  const game = room.game;
  game.phase = 'auction';
  game.pendingDecision = {
    type: 'auction',
    squareIndex,
    sellerId,          // null = the bank is selling
    minBid,            // lowest allowed first bid
    highestBid: 0,
    highestBidderId: null,
    passedIds: [],
    deadline: null     // set by restartAuctionTimer
  };
  addLog(room, `নিলাম শুরু: ${SQUARES[squareIndex].name} (সর্বনিম্ন দর ৳${minBid})`);

  // Nobody can bid at all (e.g. no other players): finish at once.
  if (everyoneElsePassed(room)) {
    endAuction(room);
    return;
  }
  restartAuctionTimer(room);
}

function restartAuctionTimer(room) {
  const ms = config.AUCTION_SECONDS * 1000;
  room.game.pendingDecision.deadline = Date.now() + ms;
  setGameTimer(room, ms, () => endAuction(room));
}

// Players who may bid in this auction: everyone except the seller.
// (Step 9: bankrupt players will be left out here too.)
function canBid(auction, player) {
  return player.id !== auction.sellerId;
}

function requireAuction(room, player) {
  requirePlaying(room);
  const auction = room.game.pendingDecision;
  if (room.game.phase !== 'auction' || !auction || auction.type !== 'auction') fail(MSG.noAuction);
  if (!canBid(auction, player)) fail(MSG.sellerCannotBid);
  if (auction.passedIds.includes(player.id)) fail(MSG.alreadyPassed);
  return auction;
}

function placeBid(room, player, amount) {
  const auction = requireAuction(room, player);

  if (!Number.isInteger(amount)) fail(MSG.badBid);
  if (auction.highestBidderId === player.id) fail(MSG.alreadyHighest);
  if (amount < auction.minBid) fail(MSG.bidBelowMin(auction.minBid));
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

// True when nobody can still outbid: every bidder except the highest one
// (or simply every bidder, if there is no bid yet) has passed.
function everyoneElsePassed(room) {
  const auction = room.game.pendingDecision;
  return room.players
    .filter((p) => canBid(auction, p))
    .every((p) => p.id === auction.highestBidderId || auction.passedIds.includes(p.id));
}

function endAuction(room) {
  const auction = room.game.pendingDecision;
  const square = SQUARES[auction.squareIndex];
  const seller = auction.sellerId ? playerById(room, auction.sellerId) : null;
  const winner = auction.highestBidderId ? playerById(room, auction.highestBidderId) : null;

  if (winner) {
    pay(room, winner, seller, auction.highestBid); // seller null = bank
    giveProperty(room, winner, square.index);      // new owner, not mortgaged, no buildings
    addLog(room, seller
      ? `${winner.name} নিলামে ${square.name} কিনলেন ৳${auction.highestBid}-এ — টাকা পেলেন ${seller.name}।`
      : `${winner.name} নিলামে ${square.name} কিনলেন ৳${auction.highestBid}-এ।`);
  } else {
    addLog(room, seller
      ? `কেউ দর দেননি — ${square.name} ${seller.name}-এর কাছেই রইল।`
      : `কেউ দর দেননি — ${square.name} ব্যাংকের কাছেই রইল।`);
  }

  // Step 9: a bankruptcy auction may need to continue differently
  // (e.g. the next property to auction) instead of finishing the turn.
  finishDecision(room);
}

// ---------- Cards (ভাগ্য / সমাজকল্যাণ) ----------
// Draw from the top, put the card back at the bottom. A jail-free card
// stays with the player and goes back to the bottom of its own deck when
// it is used. The card is shown to everyone for CARD_SHOW_MS, then its
// effect happens.

function drawCard(room, player, deckKey) {
  const game = room.game;
  const deck = game.decks[deckKey];
  const cardId = deck.shift();
  const card = CARDS_BY_ID[cardId];

  if (card.action.type === 'jailFree') {
    player.jailFreeCards.push({ deck: deckKey, cardId }); // kept, not returned yet
  } else {
    deck.push(cardId); // back to the bottom
  }

  game.phase = 'card';
  game.card = {
    id: ++game.cardCounter,
    deck: deckKey,
    deckName: DECK_NAMES[deckKey],
    playerId: player.id,
    text: card.text,
    effect: describeCardEffect(room, player, card.action),
    until: Date.now() + config.CARD_SHOW_MS
  };
  addLog(room, `${player.name} ${DECK_NAMES[deckKey]} কার্ড তুললেন: "${card.text}"`);

  setGameTimer(room, config.CARD_SHOW_MS, () => {
    game.card = null;
    applyCard(room, player, card.action);
  });
}

// Short Bangla summary of what the card does (shown under the card text).
function describeCardEffect(room, player, action) {
  switch (action.type) {
    case 'moveTo': return `${SQUARES[action.index].name}-এ যান`;
    case 'moveBy': return action.steps < 0 ? `${-action.steps} ঘর পিছিয়ে যান` : `${action.steps} ঘর এগিয়ে যান`;
    case 'collect': return `৳${action.amount} পাবেন`;
    case 'pay': return `৳${action.amount} দিতে হবে`;
    case 'collectFromEach': return `প্রত্যেকের কাছ থেকে ৳${action.amount}`;
    case 'payEach': return `প্রত্যেককে ৳${action.amount}`;
    case 'repairs': {
      const { houses, hotels, total } = repairCost(room, player, action);
      return `মেরামত খরচ ৳${total} (${houses}টি বাড়ি, ${hotels}টি হোটেল)`;
    }
    case 'goToJail': return 'হাজতখানায় যান';
    case 'jailFree': return 'জেল-মুক্তি কার্ড পেলেন';
    case 'nearestRailroad': return `নিকটতম রেলস্টেশন: ${SQUARES[nextSquareOfType(player.position, 'railroad')].name}`;
    case 'nearestUtility': return `নিকটতম ইউটিলিটি: ${SQUARES[nextSquareOfType(player.position, 'utility')].name}`;
    default: return '';
  }
}

// The next square of a type going FORWARD from "position".
function nextSquareOfType(position, type) {
  for (let step = 1; step <= BOARD_SIZE; step++) {
    const index = (position + step) % BOARD_SIZE;
    if (SQUARES[index].type === type) return index;
  }
  return position;
}

// Repairs: houses (1-4 per property) and hotels (5 = hotel) the player owns.
function repairCost(room, player, action) {
  let houses = 0;
  let hotels = 0;
  Object.values(room.game.properties).forEach((state) => {
    if (state.ownerId !== player.id) return;
    if (state.houses === 5) hotels += 1;
    else houses += state.houses;
  });
  return { houses, hotels, total: houses * action.perHouse + hotels * action.perHotel };
}

// Forward move to a square (passing শুরু pays ৳200), resolved like a roll.
function cardMoveTo(room, player, index) {
  const steps = (index - player.position + BOARD_SIZE) % BOARD_SIZE;
  const { from, path } = movePlayer(room, player, steps);
  finishMove(room, player, from, path);
}

// Do what the card says. Money cards finish the turn part; move cards
// start a new walk, and the new square is resolved like any landing.
function applyCard(room, player, action) {
  const others = room.players.filter((p) => p !== player);

  switch (action.type) {
    case 'moveTo':
      cardMoveTo(room, player, action.index);
      return;

    case 'moveBy': {
      const { from, path } = movePlayer(room, player, action.steps);
      finishMove(room, player, from, path);
      return;
    }

    case 'nearestRailroad':
      room.game.landingModifier = 'railroadDouble';
      cardMoveTo(room, player, nextSquareOfType(player.position, 'railroad'));
      return;

    case 'nearestUtility':
      room.game.landingModifier = 'utility10';
      cardMoveTo(room, player, nextSquareOfType(player.position, 'utility'));
      return;

    case 'goToJail':
      addLog(room, `${player.name} হাজতখানায় গেলেন!`);
      jumpToJail(room, player, []);
      return;

    case 'collect':
      player.money += action.amount;
      addLog(room, `${player.name} ব্যাংক থেকে ৳${action.amount} পেলেন।`);
      break;

    case 'pay':
      pay(room, player, null, action.amount); // TEMP until Step 9: may go negative
      addLog(room, `${player.name} ব্যাংককে ৳${action.amount} দিলেন।`);
      break;

    case 'collectFromEach':
      others.forEach((other) => pay(room, other, player, action.amount)); // TEMP until Step 9
      addLog(room, `${player.name} প্রত্যেকের কাছ থেকে ৳${action.amount} করে পেলেন।`);
      break;

    case 'payEach':
      others.forEach((other) => pay(room, player, other, action.amount)); // TEMP until Step 9
      addLog(room, `${player.name} প্রত্যেককে ৳${action.amount} করে দিলেন।`);
      break;

    case 'repairs': {
      const { total } = repairCost(room, player, action);
      if (total > 0) pay(room, player, null, total); // TEMP until Step 9
      addLog(room, `${player.name} মেরামত বাবদ ৳${total} দিলেন।`);
      break;
    }

    case 'jailFree':
      addLog(room, `${player.name} একটি জেল-মুক্তি কার্ড পেলেন।`);
      break;

    default:
      break;
  }

  waitThenContinue(room);
}

// ---------- Jail: leaving before the roll ----------
// On a jailed player's turn (phase 'roll', normal roll timer):
//   "৳50 দিয়ে বের হও"           payJailFine()
//   "জেল-মুক্তি কার্ড ব্যবহার করো"  useJailFreeCard()
//   "জোড়া পড়ার চেষ্টা করো"        = rollDice() (also what a timeout does)
// After paying or using a card the player takes a normal roll
// (doubles give an extra roll as usual).

function requireJailChoice(room, player) {
  requireTurn(room, player);
  if (!player.inJail) fail(MSG.notInJail);
  if (room.game.phase !== 'roll') fail(MSG.jailOptionsOnlyBeforeRoll);
}

function payJailFine(room, player) {
  requireJailChoice(room, player);
  if (player.money < config.jailFine) fail(MSG.cannotAffordFine);

  pay(room, player, null, config.jailFine);
  leaveJail(player);
  addLog(room, `${player.name} ৳${config.jailFine} জরিমানা দিয়ে হাজতখানা থেকে বের হলেন। এবার পাশা ফেলুন।`);
  startRollTimer(room); // fresh timer for the normal roll
}

function useJailFreeCard(room, player) {
  requireJailChoice(room, player);
  if (player.jailFreeCards.length === 0) fail(MSG.noJailFreeCard);

  // The used card goes back to the bottom of its own deck.
  const held = player.jailFreeCards.shift();
  room.game.decks[held.deck].push(held.cardId);
  leaveJail(player);
  addLog(room, `${player.name} জেল-মুক্তি কার্ড দিয়ে হাজতখানা থেকে বের হলেন। এবার পাশা ফেলুন।`);
  startRollTimer(room);
}

// ---------- DEBUG_DICE only: choose the next card ----------
// Moves a card to the top of its deck so the next draw from that deck is it.
// Ignored (refused) when the server runs without DEBUG_DICE=1.

function debugSetNextCard(room, player, cardId) {
  requirePlaying(room);
  if (!config.debugDice) fail(MSG.debugOff);
  const card = CARDS_BY_ID[cardId];
  if (!card) fail(MSG.unknownCard);

  const deck = room.game.decks[card.deck];
  const position = deck.indexOf(cardId);
  if (position === -1) fail(MSG.cardIsHeld); // a jail-free card a player is holding
  deck.splice(position, 1);
  deck.unshift(cardId);
  addLog(room, `[পরীক্ষা] ${player.name} পরের ${DECK_NAMES[card.deck]} কার্ড বেছে নিলেন।`);
}

// ---------- Buildings and mortgage (Step 7) ----------
// Any player, any time (also off-turn and in jail), except while an
// auction is running. Each check below returns null when the action is
// allowed, otherwise a short Bangla reason. The same checks are used to
// refuse requests AND to explain disabled buttons in the manage view.
//
// houses: 0-4 = number of houses, 5 = hotel.
// Bank stock: room.game.bank = { houses, hotels } (config.bankHouses/Hotels).

const HOTEL = 5;

function groupSquares(group) {
  return SQUARES.filter((s) => s.group === group);
}

function housesOn(room, index) {
  const state = room.game.properties[index];
  return state ? state.houses : 0;
}

function groupHasMortgage(room, group) {
  return groupSquares(group).some((s) => room.game.properties[s.index] && room.game.properties[s.index].mortgaged);
}

function groupHasBuildings(room, group) {
  return groupSquares(group).some((s) => housesOn(room, s.index) > 0);
}

function houseCostOf(square) {
  return GROUPS[square.group].houseCost;
}

function mortgageValueOf(square) {
  return Math.round(square.price * config.mortgageRatio);
}

function unmortgageCostOf(square) {
  return Math.ceil(mortgageValueOf(square) * (1 + config.unmortgageInterestRate));
}

// Things every manage action needs: game running, no auction, my square.
function basicProblem(room, player, index) {
  if (room.status !== 'playing' || !room.game || room.game.stopped) return MSG.notPlaying;
  if (room.game.phase === 'auction') return MSG.auctionRunning;
  const square = SQUARES[index];
  if (!square || !BUYABLE_TYPES.includes(square.type)) return MSG.notYourProperty;
  const state = room.game.properties[index];
  if (!state || state.ownerId !== player.id) return MSG.notYourProperty;
  return null;
}

// Checks shared by building houses and hotels (money is checked last, so
// the player sees the more important reason first).
function buildBaseProblem(room, player, index) {
  const square = SQUARES[index];
  if (square.type !== 'property') return MSG.cannotBuildHere;
  if (!ownsWholeGroup(room, player, square.group)) return MSG.noFullSet;
  if (groupHasMortgage(room, square.group)) return MSG.groupMortgaged;
  return null;
}

function buildHouseProblem(room, player, index) {
  const problem = basicProblem(room, player, index) || buildBaseProblem(room, player, index);
  if (problem) return problem;
  const square = SQUARES[index];
  const houses = housesOn(room, index);
  if (houses === HOTEL) return MSG.alreadyHotel;
  if (houses === 4) return MSG.nextIsHotel;
  // Even building: only on a square with the LOWEST count in its group.
  const lowest = Math.min(...groupSquares(square.group).map((s) => housesOn(room, s.index)));
  if (houses > lowest) return MSG.buildEvenly;
  if (room.game.bank.houses < 1) return MSG.noHousesInBank;
  if (player.money < houseCostOf(square)) return MSG.notEnoughMoney;
  return null;
}

function buildHotelProblem(room, player, index) {
  const problem = basicProblem(room, player, index) || buildBaseProblem(room, player, index);
  if (problem) return problem;
  const square = SQUARES[index];
  if (housesOn(room, index) === HOTEL) return MSG.alreadyHotel;
  // Every square of the group needs 4 houses (or already a hotel).
  const allFour = groupSquares(square.group).every((s) => housesOn(room, s.index) >= 4);
  if (housesOn(room, index) !== 4 || !allFour) return MSG.needFourHouses;
  if (room.game.bank.hotels < 1) return MSG.noHotelsInBank;
  if (player.money < houseCostOf(square)) return MSG.notEnoughMoney;
  return null;
}

function sellHouseProblem(room, player, index) {
  const problem = basicProblem(room, player, index);
  if (problem) return problem;
  const square = SQUARES[index];
  if (square.type !== 'property') return MSG.cannotBuildHere;
  const houses = housesOn(room, index);
  if (houses === HOTEL) return MSG.sellHotelFirst;
  if (houses === 0) return MSG.noHouseToSell;
  // Even selling: only from a square with the HIGHEST count in its group.
  const highest = Math.max(...groupSquares(square.group).map((s) => housesOn(room, s.index)));
  if (houses < highest) return MSG.sellEvenly;
  return null;
}

// Selling a hotel gives back 4 houses from the bank. If the bank has fewer
// than 4 houses, it is refused (simplest rule that always keeps the group even).
function sellHotelProblem(room, player, index) {
  const problem = basicProblem(room, player, index);
  if (problem) return problem;
  if (SQUARES[index].type !== 'property') return MSG.cannotBuildHere;
  if (housesOn(room, index) !== HOTEL) return MSG.noHotelToSell;
  if (room.game.bank.houses < 4) return MSG.bankHousesForHotel(room.game.bank.houses);
  return null;
}

function mortgageProblem(room, player, index) {
  const problem = basicProblem(room, player, index);
  if (problem) return problem;
  const square = SQUARES[index];
  if (room.game.properties[index].mortgaged) return MSG.alreadyMortgaged;
  if (square.group && groupHasBuildings(room, square.group)) return MSG.sellBuildingsFirst;
  return null;
}

function unmortgageProblem(room, player, index) {
  const problem = basicProblem(room, player, index);
  if (problem) return problem;
  if (!room.game.properties[index].mortgaged) return MSG.notMortgaged;
  if (player.money < unmortgageCostOf(SQUARES[index])) return MSG.notEnoughMoney;
  return null;
}

// Turn a "problem" check into a request check (throws the Bangla reason).
function checkOrFail(problem) {
  if (problem) fail(problem);
}

// Read the square index sent by the client.
function readIndex(index) {
  if (!Number.isInteger(index) || index < 0 || index >= BOARD_SIZE) fail(MSG.notYourProperty);
  return index;
}

function buildHouse(room, player, rawIndex) {
  const index = readIndex(rawIndex);
  checkOrFail(buildHouseProblem(room, player, index));
  const square = SQUARES[index];
  const cost = houseCostOf(square);
  pay(room, player, null, cost);
  room.game.properties[index].houses += 1;
  room.game.bank.houses -= 1;
  addLog(room, `${player.name} ${square.name}-এ একটি বাড়ি বানালেন (৳${cost})। এখন ${room.game.properties[index].houses}টি বাড়ি।`);
}

function buildHotel(room, player, rawIndex) {
  const index = readIndex(rawIndex);
  checkOrFail(buildHotelProblem(room, player, index));
  const square = SQUARES[index];
  const cost = houseCostOf(square); // a hotel = 4 houses + 1 more house price
  pay(room, player, null, cost);
  room.game.properties[index].houses = HOTEL;
  room.game.bank.houses += 4; // the 4 houses go back to the bank
  room.game.bank.hotels -= 1;
  addLog(room, `${player.name} ${square.name}-এ হোটেল বানালেন (৳${cost}); 4টি বাড়ি ব্যাংকে ফেরত গেল।`);
}

function sellHouse(room, player, rawIndex) {
  const index = readIndex(rawIndex);
  checkOrFail(sellHouseProblem(room, player, index));
  const square = SQUARES[index];
  const refund = houseCostOf(square) / 2;
  player.money += refund;
  room.game.properties[index].houses -= 1;
  room.game.bank.houses += 1;
  addLog(room, `${player.name} ${square.name}-এর একটি বাড়ি বিক্রি করে ৳${refund} পেলেন।`);
}

function sellHotel(room, player, rawIndex) {
  const index = readIndex(rawIndex);
  checkOrFail(sellHotelProblem(room, player, index));
  const square = SQUARES[index];
  const refund = houseCostOf(square) / 2; // half the hotel price
  player.money += refund;
  room.game.properties[index].houses = 4; // back to 4 houses
  room.game.bank.hotels += 1;
  room.game.bank.houses -= 4;
  addLog(room, `${player.name} ${square.name}-এর হোটেল বিক্রি করে ৳${refund} পেলেন (এখন 4টি বাড়ি)।`);
}

function mortgageProperty(room, player, rawIndex) {
  const index = readIndex(rawIndex);
  checkOrFail(mortgageProblem(room, player, index));
  const square = SQUARES[index];
  const value = mortgageValueOf(square);
  player.money += value;
  room.game.properties[index].mortgaged = true;
  addLog(room, `${player.name} ${square.name} বন্ধক রেখে ৳${value} পেলেন।`);
}

function unmortgageProperty(room, player, rawIndex) {
  const index = readIndex(rawIndex);
  checkOrFail(unmortgageProblem(room, player, index));
  const square = SQUARES[index];
  const cost = unmortgageCostOf(square);
  pay(room, player, null, cost);
  room.game.properties[index].mortgaged = false;
  addLog(room, `${player.name} ৳${cost} দিয়ে ${square.name}-এর বন্ধক ছাড়ালেন।`);
}

// What the owner may do with this square right now (for the manage view).
// Each entry: { amount, reason } — reason null = allowed.
function manageOptions(room, index) {
  const square = SQUARES[index];
  const owner = ownerOf(room, index);
  const options = {
    mortgage: { amount: mortgageValueOf(square), reason: mortgageProblem(room, owner, index) },
    unmortgage: { amount: unmortgageCostOf(square), reason: unmortgageProblem(room, owner, index) }
  };
  if (square.type === 'property') {
    const cost = houseCostOf(square);
    options.buildHouse = { amount: cost, reason: buildHouseProblem(room, owner, index) };
    options.sellHouse = { amount: cost / 2, reason: sellHouseProblem(room, owner, index) };
    options.buildHotel = { amount: cost, reason: buildHotelProblem(room, owner, index) };
    options.sellHotel = { amount: cost / 2, reason: sellHotelProblem(room, owner, index) };
  }
  return options;
}

// ---------- What clients may see ----------

function publicGame(room) {
  const game = room.game;

  // Owned squares, each with the rent that applies right now (rentNow).
  const properties = {};
  Object.keys(game.properties).forEach((index) => {
    properties[index] = {
      ...game.properties[index],
      rentNow: currentRent(room, Number(index)),
      options: manageOptions(room, Number(index)) // what the owner may do now
    };
  });

  return {
    currentPlayerId: currentPlayer(room).id,
    phase: game.phase,
    doublesCount: game.doublesCount,
    dice: game.dice,
    lastMove: game.lastMove,
    rollDeadline: game.rollDeadline, // clients show a countdown to this
    properties,
    pendingDecision: game.pendingDecision,
    card: game.card, // the card being shown right now, or null
    bank: game.bank, // houses/hotels left in the bank
    serverTime: Date.now(),          // lets clients correct for clock differences
    log: game.log
  };
}

module.exports = {
  setGameChangedListener,
  initGame,
  stopGame,
  rollDice,
  payJailFine,
  useJailFreeCard,
  debugSetNextCard,
  buildHouse,
  buildHotel,
  sellHouse,
  sellHotel,
  mortgageProperty,
  unmortgageProperty,
  buyProperty,
  declineProperty,
  startOwnerAuction,
  keepProperty,
  startAuction, // Step 9: bank auctions for bankruptcy
  placeBid,
  passAuction,
  publicGame
};
