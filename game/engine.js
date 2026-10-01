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
// DEBTS (Step 9): money never goes below zero. A payment the player can't
// cover becomes a debt (see "Debts and bankruptcy"); while any debt or a
// bankruptcy sale is open, the turn flow is PAUSED (the next roll / move /
// turn end waits) and continues when everything is settled.
//
// Trading (Step 8) has its own timers and never changes the turn.
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
  sellBuildingsFirst: 'আগে এই রঙের সব বাড়ি/হোটেল বিক্রি করুন',
  // Trading
  tradeAuction: 'নিলাম চলার সময় বাণিজ্য করা যাবে না।',
  tradeNoTarget: 'এই খেলোয়াড়কে পাওয়া যায়নি।',
  tradeSelf: 'নিজের সাথে বাণিজ্য করা যায় না।',
  tradeOnePending: 'আপনার একটি প্রস্তাব ইতিমধ্যে অপেক্ষায় আছে।',
  tradeEmpty: 'কিছু না দিয়ে বা না চেয়ে প্রস্তাব পাঠানো যায় না।',
  tradeBadData: 'প্রস্তাবটি ঠিক নেই।',
  tradeBuildings: 'আগে এই রঙের সব বাড়ি বিক্রি করুন',
  tradeInDecision: 'এই সম্পত্তি নিয়ে এখন সিদ্ধান্ত বা নিলাম চলছে',
  tradeNotOwned: (square, name) => `${square} এখন আর ${name}-এর নয়।`,
  tradeCashTooMuch: (name) => `${name}-এর কাছে এত টাকা নেই।`,
  tradeJailCards: (name) => `${name}-এর কাছে এতগুলো জেল-মুক্তি কার্ড নেই।`,
  tradeCantAfford: (name, total) => `${name} মোট ৳${total} (টাকা + বন্ধকী ফি) দিতে পারবেন না।`,
  tradePlayerGone: 'একজন খেলোয়াড় আর খেলায় নেই।',
  tradeNotFound: 'এই প্রস্তাবটি আর নেই।',
  tradeNotYours: 'এই প্রস্তাবটি আপনার জন্য নয়।',
  // Debts, bankruptcy, end of game
  waitForDebts: 'দেনা মেটানো পর্যন্ত অপেক্ষা করুন।',
  noDebt: 'আপনার কোনো দেনা নেই।',
  notEnoughForDebt: 'দেনা শোধ করার মতো টাকা এখনো নেই।',
  youAreBankrupt: 'আপনি দেউলিয়া — এখন শুধু খেলা দেখতে পারবেন।',
  cannotResignNow: 'এখন খেলা ছাড়া যাবে না — চলমান সিদ্ধান্ত, কার্ড বা নিলাম শেষ হোক।',
  cannotResignDebts: 'অন্য কারও দেনা মেটানো শেষ হলে চেষ্টা করুন।',
  notHost: 'শুধু হোস্ট এটি করতে পারেন।',
  badAmount: 'টাকার পরিমাণ ঠিক নেই।'
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
    p.bankrupt = false;   // bankrupt players only watch
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
    // Pending trade offers (see "Trading"), and an id counter for them
    trades: [],
    tradeCounter: 0,
    // Open debts (see "Debts and bankruptcy"):
    //   { id, playerId, amount, creditorId: playerId | 'bank' | 'each',
    //     recipientIds (for 'each'), perPlayer (for 'each'), reason, deadline }
    debts: [],
    debtCounter: 0,
    // Turn-flow pause: the step (roll timer / move / turn end) that was
    // held back while debts or a bankruptcy sale were open: { ms, fn, isRoll }
    paused: null,
    step: null,            // the pausable step whose timer is running now
    // Bankruptcy to the bank: the bankrupt's properties are auctioned one
    // after another: { active, queue: [square indexes] }
    bankSale: { active: false, queue: [] },
    bankruptOrder: [],     // player ids in the order they went bankrupt
    over: null,            // end of game: { winnerId, ranking: [...] }
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
  stopAllTrades(room); // trade offer timers too
  stopAllDebts(room);  // and debt timers
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

// Move money that the payer is known to have (checked before).
// "to" = null means the bank. Money never goes below zero.
function pay(room, from, to, amount) {
  from.money -= amount;
  if (to) to.money += amount;
}

// A payment the player might NOT be able to cover (rent, tax, cards, fees).
// Enough cash: paid now, returns true. Otherwise nothing is paid and a debt
// is opened (the turn flow pauses until it is settled), returns false.
function charge(room, from, to, amount, reason) {
  if (amount <= 0) return true;
  if (from.money >= amount) {
    pay(room, from, to, amount);
    return true;
  }
  createDebt(room, from, to ? to.id : 'bank', amount, reason);
  return false;
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
// options.pausable: a turn-flow step (roll timer, move, turn end). While a
// debt or a bankruptcy sale is open it does not start; it is kept in
// game.paused and started by resumeFlow() once everything is settled.
function setGameTimer(room, ms, fn, options = {}) {
  clearGameTimer(room);
  const game = room.game;
  const step = options.pausable ? { ms, fn, isRoll: Boolean(options.isRoll) } : null;
  if (step && isFlowPaused(room)) {
    game.paused = step;
    game.step = null;
    if (step.isRoll) game.rollDeadline = null;
    return;
  }
  game.step = step;
  game.timer = setTimeout(() => {
    game.timer = null;
    game.step = null;
    if (game.stopped || room.game !== game) return;
    fn();
    onGameChanged(room);
  }, ms);
}

// Is the turn flow on hold? (open debts or a running bankruptcy sale)
function isFlowPaused(room) {
  return room.game.debts.length > 0 || room.game.bankSale.active;
}

// Hold the turn flow now: if a pausable step is waiting on its timer, stop
// that timer and keep the step for later.
function pauseFlow(room) {
  const game = room.game;
  if (game.timer && game.step) {
    clearGameTimer(room);
    game.paused = game.step;
    game.step = null;
    game.rollDeadline = null;
  }
}

// Continue the turn flow after debts / bankruptcy sales are settled.
function resumeFlow(room) {
  const game = room.game;
  if (!game || game.stopped || game.over || isFlowPaused(room)) return;
  const step = game.paused;
  game.paused = null;

  // The current player went bankrupt: their turn is over.
  if (currentPlayer(room).bankrupt) {
    game.pendingDecision = null;
    game.card = null;
    game.landingModifier = null;
    game.extraRoll = false;
    advanceTurn(room);
    return;
  }
  if (step) {
    if (step.isRoll) startRollTimer(room); // fresh roll timer
    else setGameTimer(room, step.ms, step.fn, { pausable: true });
  } else if (!game.timer && (game.phase === 'roll' || game.phase === 'moving' || game.phase === 'auction')) {
    // Nothing was waiting (should not happen): make sure the game goes on.
    game.pendingDecision = null;
    startRollTimer(room);
  }
}

// Phase 'roll': the current player has ROLL_TIMEOUT_SECONDS to roll.
function startRollTimer(room) {
  const game = room.game;
  const ms = config.ROLL_TIMEOUT_SECONDS * 1000;
  game.phase = 'roll';
  game.rollDeadline = Date.now() + ms;
  setGameTimer(room, ms, () => autoRoll(room), { pausable: true, isRoll: true });
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
  if (isFlowPaused(room)) fail(MSG.waitForDebts);
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
    // Third failed attempt: pay the fine and move by this roll. If the
    // player can't pay, it becomes a debt (the landing waits for it).
    leaveJail(player);
    if (charge(room, player, null, config.jailFine, 'হাজতের জরিমানা')) {
      addLog(room, `${config.maxJailTurns} বার চেষ্টায়ও জোড়া পড়েনি — ${player.name} ৳${config.jailFine} জরিমানা দিয়ে বের হলেন।`);
    }
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
  setGameTimer(room, moveAnimationMs(room.game.lastMove), () => onArrive(room), { pausable: true });
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
    if (charge(room, player, null, square.amount, square.name)) {
      addLog(room, `${player.name} ${square.name} বাবদ ব্যাংককে ৳${square.amount} দিলেন।`);
    }
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
  if (charge(room, player, owner, rent.amount, `${square.name}-এর ভাড়া`)) {
    addLog(room,
      `${player.name} ${owner.name}-কে ৳${rent.amount} ভাড়া দিলেন ` +
      `(${square.name}${rent.detail ? ', ' + rent.detail : ''})।`);
  }
}

// A decision has been resolved: short pause, then the turn goes on.
function finishDecision(room) {
  room.game.pendingDecision = null;
  waitThenContinue(room);
}

// Phase stays 'moving' for TURN_END_DELAY_MS so everyone sees the result.
function waitThenContinue(room) {
  room.game.phase = 'moving';
  setGameTimer(room, config.TURN_END_DELAY_MS, () => continueTurn(room), { pausable: true });
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
  // Next player in seat order who is not bankrupt
  do {
    game.turnIndex = (game.turnIndex + 1) % room.players.length;
  } while (room.players[game.turnIndex].bankrupt);
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
  return player.id !== auction.sellerId && !player.bankrupt;
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
  let winner = auction.highestBidderId ? playerById(room, auction.highestBidderId) : null;
  // Safety: money never goes negative. A winner who can no longer pay (or
  // went bankrupt meanwhile) does not get the property.
  if (winner && (winner.bankrupt || winner.money < auction.highestBid)) {
    addLog(room, `${winner.name} আর দাম দিতে পারছেন না — নিলাম বাতিল।`);
    winner = null;
  }

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

  // Bankruptcy sale: go on with the next property instead of the turn.
  if (room.game.bankSale.active) {
    continueBankSale(room);
    return;
  }
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
  const others = room.players.filter((p) => p !== player && !p.bankrupt);

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
      if (charge(room, player, null, action.amount, 'কার্ডের খরচ')) {
        addLog(room, `${player.name} ব্যাংককে ৳${action.amount} দিলেন।`);
      }
      break;

    case 'collectFromEach':
      // Each other player pays; whoever can't pay gets their own debt.
      others.forEach((other) => {
        if (charge(room, other, player, action.amount, `${player.name}-কে কার্ডের টাকা`)) {
          addLog(room, `${other.name} ${player.name}-কে ৳${action.amount} দিলেন।`);
        }
      });
      break;

    case 'payEach': {
      // All or nothing: if the player can't pay everyone, one debt to "each".
      const total = action.amount * others.length;
      if (player.money >= total) {
        others.forEach((other) => pay(room, player, other, action.amount));
        addLog(room, `${player.name} প্রত্যেককে ৳${action.amount} করে দিলেন।`);
      } else if (total > 0) {
        createDebt(room, player, 'each', total, 'প্রত্যেককে কার্ডের টাকা', {
          recipientIds: others.map((o) => o.id),
          perPlayer: action.amount
        });
      }
      break;
    }

    case 'repairs': {
      const { total } = repairCost(room, player, action);
      if (charge(room, player, null, total, 'মেরামত খরচ')) {
        addLog(room, `${player.name} মেরামত বাবদ ৳${total} দিলেন।`);
      }
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
  if (isFlowPaused(room)) fail(MSG.waitForDebts);
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
  if (player.bankrupt) return MSG.youAreBankrupt;
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

// ---------- Trading (Step 8) ----------
// Any player may offer a trade to another player at any time, except while
// an auction is running. One outgoing pending offer per player.
//
// An offer: { id, fromId, toId, give, get, deadline }
//   give = what the proposer gives, get = what the proposer wants
//   each side: { properties: [square indexes], cash, jailFree (count) }
//
// Everything is checked when the offer is made, again when it is accepted,
// and after every change to the game (cleanupTrades): an offer that is no
// longer valid is cancelled automatically.
//
// Mortgaged properties stay mortgaged; whoever RECEIVES one pays the bank
// 10% of its mortgage value (rounded up) when the trade completes.
//
// Trade timers are separate from the turn timer: trading never changes
// whose turn it is and never pauses the turn.

const tradeTimers = new Map(); // trade id -> setTimeout handle (not sent to clients)

// Why this square can't be traded right now, or null.
function propertyTradeProblem(room, index) {
  const square = SQUARES[index];
  if (square.group && groupHasBuildings(room, square.group)) return MSG.tradeBuildings;
  const decision = room.game.pendingDecision;
  if (decision && decision.squareIndex === index) return MSG.tradeInDecision;
  return null;
}

// Mortgage fee the receiver pays for these squares (10% of mortgage value each).
function mortgageFee(room, indexes) {
  return indexes.reduce((sum, index) => {
    const state = room.game.properties[index];
    if (!state || !state.mortgaged) return sum;
    return sum + Math.ceil(mortgageValueOf(SQUARES[index]) * config.mortgageInterestRate);
  }, 0);
}

// Read one side of an offer from the client: { properties, cash, jailFree }.
function readTradeSide(raw) {
  const side = raw && typeof raw === 'object' ? raw : {};
  const properties = Array.isArray(side.properties) ? side.properties : [];
  const cash = side.cash === undefined ? 0 : side.cash;
  const jailFree = side.jailFree === undefined ? 0 : side.jailFree;
  const valid =
    properties.length <= BOARD_SIZE &&
    properties.every((i) => Number.isInteger(i) && i >= 0 && i < BOARD_SIZE) &&
    new Set(properties).size === properties.length &&
    Number.isInteger(cash) && cash >= 0 &&
    Number.isInteger(jailFree) && jailFree >= 0;
  if (!valid) fail(MSG.tradeBadData);
  return { properties: properties.slice().sort((a, b) => a - b), cash, jailFree };
}

// Can "player" give this side? Returns a Bangla reason or null.
// (Cash is checked against what the player has right now.)
function tradeSideProblem(room, player, side) {
  for (const index of side.properties) {
    const square = SQUARES[index];
    const state = room.game.properties[index];
    if (!BUYABLE_TYPES.includes(square.type) || !state || state.ownerId !== player.id) {
      return MSG.tradeNotOwned(square.name, player.name);
    }
    const problem = propertyTradeProblem(room, index);
    if (problem) return `${square.name}: ${problem}`;
  }
  if (side.cash > player.money) return MSG.tradeCashTooMuch(player.name);
  if (side.jailFree > player.jailFreeCards.length) return MSG.tradeJailCards(player.name);
  return null;
}

// Is the whole offer still valid? (Not the "can they afford the fees"
// check, which only happens at acceptance.)
function tradeProblem(room, trade) {
  const from = playerById(room, trade.fromId);
  const to = playerById(room, trade.toId);
  if (!from || !to || from.bankrupt || to.bankrupt) return MSG.tradePlayerGone;
  return tradeSideProblem(room, from, trade.give) || tradeSideProblem(room, to, trade.get);
}

function isEmptySide(side) {
  return side.properties.length === 0 && side.cash === 0 && side.jailFree === 0;
}

// Short Bangla list of one side, e.g. "নোয়াখালী (বন্ধক), ৳100, 1টি জেল-মুক্তি কার্ড"
function describeTradeSide(room, side) {
  const parts = side.properties.map((index) => {
    const state = room.game.properties[index];
    return SQUARES[index].name + (state && state.mortgaged ? ' (বন্ধক)' : '');
  });
  if (side.cash > 0) parts.push(`৳${side.cash}`);
  if (side.jailFree > 0) parts.push(`${side.jailFree}টি জেল-মুক্তি কার্ড`);
  return parts.length ? parts.join(', ') : 'কিছু না';
}

function findTrade(room, tradeId) {
  const trade = room.game.trades.find((t) => t.id === tradeId);
  if (!trade) fail(MSG.tradeNotFound);
  return trade;
}

// Remove an offer and stop its timer.
function removeTrade(room, trade) {
  clearTimeout(tradeTimers.get(trade.id));
  tradeTimers.delete(trade.id);
  room.game.trades = room.game.trades.filter((t) => t !== trade);
}

function proposeTrade(room, player, request) {
  requirePlaying(room);
  if (room.game.phase === 'auction') fail(MSG.tradeAuction);
  if (player.bankrupt) fail(MSG.youAreBankrupt);
  const to = playerById(room, request && request.toId);
  if (!to || to.bankrupt) fail(MSG.tradeNoTarget);
  if (to === player) fail(MSG.tradeSelf);
  if (room.game.trades.some((t) => t.fromId === player.id)) fail(MSG.tradeOnePending);

  const give = readTradeSide(request.give);
  const get = readTradeSide(request.get);
  if (isEmptySide(give) && isEmptySide(get)) fail(MSG.tradeEmpty);

  const trade = {
    id: ++room.game.tradeCounter,
    fromId: player.id,
    toId: to.id,
    give,
    get,
    deadline: Date.now() + config.TRADE_RESPONSE_SECONDS * 1000
  };
  const problem = tradeProblem(room, trade);
  if (problem) fail(problem);

  room.game.trades.push(trade);
  addLog(room, `${player.name} ${to.name}-কে বাণিজ্যের প্রস্তাব দিলেন।`);

  // No answer in time = rejected. (Own timer: the turn timer is not touched.)
  const game = room.game;
  tradeTimers.set(trade.id, setTimeout(() => {
    if (game.stopped || room.game !== game || !game.trades.includes(trade)) return;
    removeTrade(room, trade);
    addLog(room, `${to.name} সময়মতো উত্তর দেননি — ${player.name}-এর বাণিজ্যের প্রস্তাব বাতিল হলো।`);
    onGameChanged(room);
  }, config.TRADE_RESPONSE_SECONDS * 1000));
}

function cancelTrade(room, player, tradeId) {
  requirePlaying(room);
  const trade = findTrade(room, tradeId);
  if (trade.fromId !== player.id) fail(MSG.tradeNotYours);
  removeTrade(room, trade);
  addLog(room, `${player.name} বাণিজ্যের প্রস্তাব ফিরিয়ে নিলেন।`);
}

function rejectTrade(room, player, tradeId) {
  requirePlaying(room);
  const trade = findTrade(room, tradeId);
  if (trade.toId !== player.id) fail(MSG.tradeNotYours);
  removeTrade(room, trade);
  addLog(room, `${player.name} ${playerById(room, trade.fromId).name}-এর বাণিজ্যের প্রস্তাব প্রত্যাখ্যান করলেন।`);
}

// The receiver accepts: check everything again, then swap.
// If the trade is no longer possible it is cancelled (logged) and the
// Bangla reason is sent back to the receiver.
function acceptTrade(room, player, tradeId) {
  requirePlaying(room);
  const trade = findTrade(room, tradeId);
  if (trade.toId !== player.id) fail(MSG.tradeNotYours);
  if (room.game.phase === 'auction') fail(MSG.tradeAuction); // stays pending

  const from = playerById(room, trade.fromId);
  const to = player;
  let problem = tradeProblem(room, trade);

  // Each side must afford the cash it gives + the fees for mortgaged
  // properties it receives (incoming cash does not count).
  const feeFrom = mortgageFee(room, trade.get.properties); // proposer receives "get"
  const feeTo = mortgageFee(room, trade.give.properties);  // receiver receives "give"
  if (!problem && trade.give.cash + feeFrom > from.money) problem = MSG.tradeCantAfford(from.name, trade.give.cash + feeFrom);
  if (!problem && trade.get.cash + feeTo > to.money) problem = MSG.tradeCantAfford(to.name, trade.get.cash + feeTo);

  if (problem) {
    removeTrade(room, trade);
    addLog(room, `বাণিজ্য বাতিল (${from.name} ও ${to.name}): ${problem}`);
    fail(problem);
  }

  // Log the full contents before anything moves (names + mortgage marks).
  const fromText = describeTradeSide(room, trade.give);
  const toText = describeTradeSide(room, trade.get);

  // Swap properties (mortgaged ones stay mortgaged; no buildings possible)
  trade.give.properties.forEach((index) => { room.game.properties[index].ownerId = to.id; });
  trade.get.properties.forEach((index) => { room.game.properties[index].ownerId = from.id; });

  // Cash
  from.money -= trade.give.cash; to.money += trade.give.cash;
  to.money -= trade.get.cash; from.money += trade.get.cash;

  // Jail-free cards (the actual cards move, so they return to their own deck later)
  for (let i = 0; i < trade.give.jailFree; i++) to.jailFreeCards.push(from.jailFreeCards.shift());
  for (let i = 0; i < trade.get.jailFree; i++) from.jailFreeCards.push(to.jailFreeCards.shift());

  removeTrade(room, trade);
  addLog(room, `বাণিজ্য সম্পন্ন: ${from.name} দিলেন — ${fromText}; ${to.name} দিলেন — ${toText}।`);

  // Mortgage fees to the bank
  if (feeFrom > 0) { from.money -= feeFrom; addLog(room, `${from.name} বন্ধকী সম্পত্তির ফি ৳${feeFrom} ব্যাংককে দিলেন।`); }
  if (feeTo > 0) { to.money -= feeTo; addLog(room, `${to.name} বন্ধকী সম্পত্তির ফি ৳${feeTo} ব্যাংককে দিলেন।`); }
}

// After any change: cancel offers that are no longer valid
// (a property changed owner or got buildings, cash or cards are gone, ...).
function cleanupTrades(room) {
  if (!room.game || room.game.stopped) return;
  room.game.trades.slice().forEach((trade) => {
    const problem = tradeProblem(room, trade);
    if (!problem) return;
    const from = playerById(room, trade.fromId);
    const to = playerById(room, trade.toId);
    removeTrade(room, trade);
    addLog(room, `বাণিজ্য বাতিল${from && to ? ` (${from.name} → ${to.name})` : ''}: ${problem}`);
  });
}

// Offers as sent to clients, with the mortgage fees each side would pay.
function publicTrades(room) {
  return room.game.trades.map((trade) => ({
    ...trade,
    feeFrom: mortgageFee(room, trade.get.properties),
    feeTo: mortgageFee(room, trade.give.properties)
  }));
}

function stopAllTrades(room) {
  if (!room.game) return;
  room.game.trades.forEach((trade) => {
    clearTimeout(tradeTimers.get(trade.id));
    tradeTimers.delete(trade.id);
  });
}

// ---------- Debts and bankruptcy (Step 9) ----------
// A payment a player can't cover is never paid partly. Instead the player
// gets a DEBT: { amount, creditor (a player, the bank, or "each" other
// player) }. While any debt is open the turn flow is paused.
//
// The debtor has DEBT_RESOLVE_SECONDS to raise money (sell buildings,
// mortgage, trade) and press "পরিশোধ করুন", or to declare bankruptcy.
// When the time runs out the server sells buildings (cheapest groups
// first, evenly) and mortgages the cheapest properties until the debt is
// covered. If that is still not enough, the player goes bankrupt.
//
// BANKRUPTCY
//   1. All buildings are sold to the bank at half price.
//   2a. To a player: they get all cash, properties and jail-free cards.
//       For each mortgaged property they pay the bank 10% interest (may
//       become a debt of their own).
//   2b. To the bank: jail-free cards go back to their decks, properties
//       become unowned + unmortgaged and are auctioned by the bank one
//       after another (min ৳10, all remaining players may bid).
//       For a "pay each player" card the cash is split between the others.
//   3. The player is out (token removed, skipped in turn order).
//   4. One player left -> game over.

const debtTimers = new Map(); // debt id -> setTimeout handle

function activePlayers(room) {
  return room.players.filter((p) => !p.bankrupt);
}

function debtOf(room, player) {
  return room.game.debts.find((d) => d.playerId === player.id) || null;
}

function creditorName(room, debt) {
  if (debt.creditorId === 'bank') return 'ব্যাংক';
  if (debt.creditorId === 'each') return 'প্রত্যেক খেলোয়াড়';
  const creditor = playerById(room, debt.creditorId);
  return creditor ? creditor.name : 'ব্যাংক';
}

// Half price of a square's buildings (a hotel counts as 5 houses).
function buildingsSaleValue(square, houses) {
  return (houseCostOf(square) / 2) * houses;
}

// Most money a player could raise: cash + half value of all buildings +
// mortgage value of unmortgaged properties.
function maxRaisable(room, player) {
  if (!player) return 0;
  let total = player.money;
  Object.keys(room.game.properties).forEach((key) => {
    const index = Number(key);
    const state = room.game.properties[index];
    if (state.ownerId !== player.id) return;
    const square = SQUARES[index];
    if (state.houses > 0) total += buildingsSaleValue(square, state.houses);
    if (!state.mortgaged) total += mortgageValueOf(square);
  });
  return total;
}

function createDebt(room, player, creditorId, amount, reason, extra = {}) {
  const game = room.game;
  const debt = {
    id: ++game.debtCounter,
    playerId: player.id,
    amount,
    creditorId,
    recipientIds: extra.recipientIds || null,
    perPlayer: extra.perPlayer || null,
    reason,
    deadline: Date.now() + config.DEBT_RESOLVE_SECONDS * 1000
  };
  game.debts.push(debt);
  pauseFlow(room);
  addLog(room, `${player.name}-এর কাছে যথেষ্ট টাকা নেই — ${creditorName(room, debt)}-এর কাছে ৳${amount} দেনা (${reason})। ` +
    `টাকা জোগাড়ের সময় ${config.DEBT_RESOLVE_SECONDS} সেকেন্ড।`);

  debtTimers.set(debt.id, setTimeout(() => {
    if (game.stopped || room.game !== game || !game.debts.includes(debt)) return;
    debtTimeout(room, debt);
    onGameChanged(room);
  }, config.DEBT_RESOLVE_SECONDS * 1000));
}

function removeDebt(room, debt) {
  clearTimeout(debtTimers.get(debt.id));
  debtTimers.delete(debt.id);
  room.game.debts = room.game.debts.filter((d) => d !== debt);
}

function stopAllDebts(room) {
  if (!room.game || !room.game.debts) return;
  room.game.debts.forEach((d) => {
    clearTimeout(debtTimers.get(d.id));
    debtTimers.delete(d.id);
  });
}

// Pay a debt the player can now cover.
function settleDebt(room, player, debt) {
  if (debt.creditorId === 'each') {
    debt.recipientIds.forEach((id) => {
      const recipient = playerById(room, id);
      pay(room, player, recipient && !recipient.bankrupt ? recipient : null, debt.perPlayer);
    });
  } else {
    const creditor = debt.creditorId === 'bank' ? null : playerById(room, debt.creditorId);
    // A creditor who went bankrupt meanwhile: the money goes to the bank.
    pay(room, player, creditor && !creditor.bankrupt ? creditor : null, debt.amount);
  }
  removeDebt(room, debt);
  addLog(room, `${player.name} ${creditorName(room, debt)}-কে ৳${debt.amount} দেনা শোধ করলেন।`);
}

// "পরিশোধ করুন"
function payDebt(room, player) {
  requirePlaying(room);
  const debt = debtOf(room, player);
  if (!debt) fail(MSG.noDebt);
  if (player.money < debt.amount) fail(MSG.notEnoughForDebt);
  settleDebt(room, player, debt);
  resumeFlow(room);
}

// "দেউলিয়া ঘোষণা করুন" (bankrupt to the creditor of the open debt)
function declareBankruptcy(room, player) {
  requirePlaying(room);
  const debt = debtOf(room, player);
  if (!debt) fail(MSG.noDebt);
  goBankrupt(room, player, debt.creditorId, debt.recipientIds);
  resumeFlow(room);
}

// "খেলা ছেড়ে দিন": bankrupt to the bank. Only at calm moments, so the
// bank sale does not interrupt someone's decision, card or auction.
function resignGame(room, player) {
  requirePlaying(room);
  if (player.bankrupt) fail(MSG.youAreBankrupt);
  const othersInDebt = room.game.debts.some((d) => d.playerId !== player.id);
  if (othersInDebt) fail(MSG.cannotResignDebts);
  if (!debtOf(room, player) && room.game.phase !== 'roll' && room.game.phase !== 'moving') fail(MSG.cannotResignNow);
  pauseFlow(room);
  addLog(room, `${player.name} খেলা ছেড়ে দিলেন।`);
  goBankrupt(room, player, 'bank', null);
  resumeFlow(room);
}

// Time is up: sell / mortgage automatically, then pay or go bankrupt.
function debtTimeout(room, debt) {
  const player = playerById(room, debt.playerId);
  addLog(room, `${player.name}-এর দেনা মেটানোর সময় শেষ — স্বয়ংক্রিয়ভাবে বিক্রি/বন্ধক রাখা হচ্ছে।`);
  while (player.money < debt.amount && sellOneBuildingForDebt(room, player)) { /* keep selling */ }
  while (player.money < debt.amount && mortgageOneForDebt(room, player)) { /* keep mortgaging */ }

  if (player.money >= debt.amount) {
    settleDebt(room, player, debt);
  } else {
    goBankrupt(room, player, debt.creditorId, debt.recipientIds);
  }
  resumeFlow(room);
}

// Sell one building: cheapest group first, from the square with the most
// buildings (keeps the group even). Returns false when nothing is left.
function sellOneBuildingForDebt(room, player) {
  const built = SQUARES.filter((s) => {
    const state = room.game.properties[s.index];
    return state && state.ownerId === player.id && state.houses > 0;
  });
  if (built.length === 0) return false;

  built.sort((a, b) => houseCostOf(a) - houseCostOf(b) || a.index - b.index);
  const group = built[0].group;
  const inGroup = built.filter((s) => s.group === group);
  const square = inGroup.reduce((best, s) => (housesOn(room, s.index) > housesOn(room, best.index) ? s : best));
  const state = room.game.properties[square.index];
  const half = houseCostOf(square) / 2;

  if (state.houses === HOTEL && room.game.bank.houses >= 4) {
    state.houses = 4; // hotel back to 4 houses
    room.game.bank.hotels += 1;
    room.game.bank.houses -= 4;
    player.money += half;
    addLog(room, `${player.name}-এর ${square.name}-এর হোটেল বিক্রি হলো (৳${half})।`);
  } else if (state.houses === HOTEL) {
    // Not enough houses in the bank to break the hotel: sell it completely.
    state.houses = 0;
    room.game.bank.hotels += 1;
    player.money += half * 5;
    addLog(room, `${player.name}-এর ${square.name}-এর হোটেল পুরোপুরি বিক্রি হলো (৳${half * 5})।`);
  } else {
    state.houses -= 1;
    room.game.bank.houses += 1;
    player.money += half;
    addLog(room, `${player.name}-এর ${square.name}-এর একটি বাড়ি বিক্রি হলো (৳${half})।`);
  }
  return true;
}

// Mortgage the cheapest unmortgaged property (without buildings in its group).
function mortgageOneForDebt(room, player) {
  const candidates = SQUARES.filter((s) => {
    const state = room.game.properties[s.index];
    return state && state.ownerId === player.id && !state.mortgaged &&
      !(s.group && groupHasBuildings(room, s.group));
  }).sort((a, b) => a.price - b.price || a.index - b.index);
  if (candidates.length === 0) return false;
  const square = candidates[0];
  room.game.properties[square.index].mortgaged = true;
  player.money += mortgageValueOf(square);
  addLog(room, `${player.name}-এর ${square.name} বন্ধক রাখা হলো (৳${mortgageValueOf(square)})।`);
  return true;
}

// The player goes bankrupt to creditorId: a player id, 'bank' or 'each'.
function goBankrupt(room, player, creditorId, recipientIds) {
  const game = room.game;
  // Their own open debts are replaced by the bankruptcy.
  game.debts.filter((d) => d.playerId === player.id).forEach((d) => removeDebt(room, d));

  // 1. All buildings to the bank at half price
  let buildingCash = 0;
  const owned = SQUARES.filter((s) => game.properties[s.index] && game.properties[s.index].ownerId === player.id);
  owned.forEach((square) => {
    const state = game.properties[square.index];
    if (state.houses === 0) return;
    buildingCash += buildingsSaleValue(square, state.houses);
    if (state.houses === HOTEL) game.bank.hotels += 1;
    else game.bank.houses += state.houses;
    state.houses = 0;
  });
  player.money += buildingCash;
  if (buildingCash > 0) addLog(room, `${player.name}-এর সব বাড়ি/হোটেল ব্যাংকে বিক্রি হলো (৳${buildingCash})।`);

  const creditor = creditorId !== 'bank' && creditorId !== 'each' ? playerById(room, creditorId) : null;
  const toPlayer = creditor && !creditor.bankrupt;

  if (toPlayer) {
    // 2a. Everything to the creditor
    const cash = player.money;
    creditor.money += cash;
    owned.forEach((square) => { game.properties[square.index].ownerId = creditor.id; });
    player.jailFreeCards.forEach((card) => creditor.jailFreeCards.push(card));
    addLog(room, `${player.name} দেউলিয়া হলেন! ${creditor.name} পেলেন ৳${cash}` +
      (owned.length ? ` ও ${owned.map((s) => s.name).join(', ')}` : '') + '।');
    // 10% interest for every mortgaged property received
    const interest = mortgageFee(room, owned.filter((s) => game.properties[s.index].mortgaged).map((s) => s.index));
    if (interest > 0 && charge(room, creditor, null, interest, 'বন্ধকী সম্পত্তির 10% সুদ')) {
      addLog(room, `${creditor.name} বন্ধকী সম্পত্তির সুদ ৳${interest} ব্যাংককে দিলেন।`);
    }
  } else {
    // 2b. To the bank (or a "pay each" card: cash split between the others)
    if (creditorId === 'each' && recipientIds) {
      const recipients = recipientIds.map((id) => playerById(room, id)).filter((p) => p && !p.bankrupt);
      const share = recipients.length ? Math.floor(player.money / recipients.length) : 0;
      recipients.forEach((p) => { p.money += share; });
      if (recipients.length) {
        addLog(room, `${player.name}-এর ৳${share * recipients.length} বাকি খেলোয়াড়দের মধ্যে ভাগ হলো (প্রত্যেকে ৳${share})।`);
      }
    }
    player.jailFreeCards.forEach((card) => game.decks[card.deck].push(card.cardId));
    owned.forEach((square) => { delete game.properties[square.index]; }); // unowned, unmortgaged
    addLog(room, `${player.name} দেউলিয়া হলেন! সম্পত্তি ব্যাংকের কাছে গেল।`);
  }

  // 3. Out of the game
  player.money = 0;
  player.jailFreeCards = [];
  player.inJail = false;
  player.bankrupt = true;
  game.bankruptOrder.push(player.id);

  // 4. One player left: game over
  const left = activePlayers(room);
  if (left.length === 1) {
    endGame(room, left[0]);
    return;
  }

  if (!toPlayer && owned.length > 0) startBankSale(room, owned.map((s) => s.index));
}

// Bank auctions of a bankrupt player's properties, one after another.
function startBankSale(room, indexes) {
  pauseFlow(room);
  room.game.bankSale = { active: true, queue: indexes.slice() };
  addLog(room, `ব্যাংক নিলামে তুলছে: ${indexes.map((i) => SQUARES[i].name).join(', ')}`);
  continueBankSale(room);
}

function continueBankSale(room) {
  const game = room.game;
  game.pendingDecision = null;
  if (game.bankSale.queue.length === 0) {
    game.bankSale = { active: false, queue: [] };
    game.phase = 'moving';
    addLog(room, 'ব্যাংকের নিলাম শেষ।');
    resumeFlow(room);
    return;
  }
  const index = game.bankSale.queue.shift();
  startAuction(room, index, { sellerId: null, minBid: config.auction.startingBid });
}

// Net worth for the final ranking: cash + properties (mortgaged ones count
// price minus mortgage value) + buildings at cost.
function netWorth(room, player) {
  let total = player.money;
  Object.keys(room.game.properties).forEach((key) => {
    const index = Number(key);
    const state = room.game.properties[index];
    if (state.ownerId !== player.id) return;
    const square = SQUARES[index];
    total += state.mortgaged ? square.price - mortgageValueOf(square) : square.price;
    if (state.houses > 0) total += houseCostOf(square) * state.houses;
  });
  return total;
}

function endGame(room, winner) {
  const game = room.game;
  // Ranking: winner first, then the reverse order of bankruptcy
  const order = [winner.id, ...game.bankruptOrder.slice().reverse()];
  game.over = {
    winnerId: winner.id,
    ranking: order.map((id, place) => {
      const p = playerById(room, id);
      return { id, name: p.name, place: place + 1, money: p.money, netWorth: netWorth(room, p), bankrupt: p.bankrupt };
    })
  };
  addLog(room, `খেলা শেষ! বিজয়ী: ${winner.name}`);
  stopGame(room);
  room.status = 'finished';
}

// DEBUG_DICE=1 only: the host sets any player's cash (for testing).
function debugSetMoney(room, player, targetId, amount) {
  requirePlaying(room);
  if (!config.debugDice) fail(MSG.debugOff);
  if (room.hostId !== player.id) fail(MSG.notHost);
  const target = playerById(room, targetId);
  if (!target || target.bankrupt) fail(MSG.tradeNoTarget);
  if (!Number.isInteger(amount) || amount < 0 || amount > 100000) fail(MSG.badAmount);
  target.money = amount;
  addLog(room, `[পরীক্ষা] হোস্ট ${target.name}-এর টাকা ৳${amount} করলেন।`);
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
      options: manageOptions(room, Number(index)), // what the owner may do now
      tradeBlock: propertyTradeProblem(room, Number(index)) // why it can't be traded, or null
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
    trades: publicTrades(room), // pending trade offers (with mortgage fees)
    debts: game.debts.map((d) => ({ ...d, maxRaisable: maxRaisable(room, playerById(room, d.playerId)) })),
    paused: isFlowPaused(room), // turn flow on hold (debts / bankruptcy sale)
    bankSale: game.bankSale.active,
    bankruptOrder: game.bankruptOrder,
    over: game.over,            // end of game, or null
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
  payDebt,
  declareBankruptcy,
  resignGame,
  debugSetMoney,
  proposeTrade,
  acceptTrade,
  rejectTrade,
  cancelTrade,
  cleanupTrades,
  buyProperty,
  declineProperty,
  startOwnerAuction,
  keepProperty,
  startAuction, // Step 9: bank auctions for bankruptcy
  placeBid,
  passAuction,
  publicGame
};
