// public/js/game.js
// Game page (game.html?room=CODE).
// Shows the board, dice, turn controls, buy/auction panel, player list
// and event log. The server decides everything; this page only draws the
// state it sends and passes the player's clicks on as requests.

const gameMessage = document.getElementById('gameMessage');
const gameMessageText = document.getElementById('gameMessageText');
const gameMessageHome = document.getElementById('gameMessageHome');
const gameLayout = document.getElementById('gameLayout');
const gameRoomCode = document.getElementById('gameRoomCode');
const gamePlayers = document.getElementById('gamePlayers');
const connectionBanner = document.getElementById('connectionBanner');
const eventLog = document.getElementById('eventLog');
const myDeeds = document.getElementById('myDeeds');

const turnInfo = document.getElementById('turnInfo');
const die1 = document.getElementById('die1');
const die2 = document.getElementById('die2');
const turnHint = document.getElementById('turnHint');
const rollBtn = document.getElementById('rollBtn');
const jailButtons = document.getElementById('jailButtons');

// Card display (ভাগ্য / সমাজকল্যাণ)
const cardModal = document.getElementById('cardModal');
const cardBox = document.getElementById('cardBox');
const cardDeckIcon = document.getElementById('cardDeckIcon');
const cardDeckName = document.getElementById('cardDeckName');
const cardPlayer = document.getElementById('cardPlayer');
const cardText = document.getElementById('cardText');
const cardEffect = document.getElementById('cardEffect');
const actionError = document.getElementById('actionError');
const debugDiceBox = document.getElementById('debugDice');
const debugDie1 = document.getElementById('debugDie1');
const debugDie2 = document.getElementById('debugDie2');
const debugCard = document.getElementById('debugCard');
const bankStock = document.getElementById('bankStock');

// Debts, bankruptcy, end of game (Step 9)
const debtPanel = document.getElementById('debtPanel');
const debtTitle = document.getElementById('debtTitle');
const debtInfo = document.getElementById('debtInfo');
const debtTimerFill = document.getElementById('debtTimerFill');
const debtTimerText = document.getElementById('debtTimerText');
const debtTimer = debtTimerFill.closest('.decision-timer');
const debtButtons = document.getElementById('debtButtons');
const debtPay = document.getElementById('debtPay');
const debtManage = document.getElementById('debtManage');
const debtBankrupt = document.getElementById('debtBankrupt');
const debtHint = document.getElementById('debtHint');
const debtError = document.getElementById('debtError');
const winnerScreen = document.getElementById('winnerScreen');
const winnerName = document.getElementById('winnerName');
const winnerRanking = document.getElementById('winnerRanking');
const newGameBtn = document.getElementById('newGameBtn');
const resignBtn = document.getElementById('resignBtn');
const debugMoney = document.getElementById('debugMoney');
const debugMoneyPlayer = document.getElementById('debugMoneyPlayer');
const debugMoneyAmount = document.getElementById('debugMoneyAmount');
const debugMoneySet = document.getElementById('debugMoneySet');

// Trading
const outgoingTrade = document.getElementById('outgoingTrade');
const tradeDialog = document.getElementById('tradeDialog');
const tradeTitle = document.getElementById('tradeTitle');
const tradeGiveChips = document.getElementById('tradeGiveChips');
const tradeGetChips = document.getElementById('tradeGetChips');
const tradeGiveBlocked = document.getElementById('tradeGiveBlocked');
const tradeGetBlocked = document.getElementById('tradeGetBlocked');
const tradeGiveCash = document.getElementById('tradeGiveCash');
const tradeGetCash = document.getElementById('tradeGetCash');
const tradeGiveJail = document.getElementById('tradeGiveJail');
const tradeGetJail = document.getElementById('tradeGetJail');
const tradeGiveJailRow = document.getElementById('tradeGiveJailRow');
const tradeGetJailRow = document.getElementById('tradeGetJailRow');
const tradeSummary = document.getElementById('tradeSummary');
const tradeError = document.getElementById('tradeError');
const tradeSend = document.getElementById('tradeSend');
const tradeCancel = document.getElementById('tradeCancel');
const incomingTrade = document.getElementById('incomingTrade');
const incomingTitle = document.getElementById('incomingTitle');
const incomingGet = document.getElementById('incomingGet');
const incomingGive = document.getElementById('incomingGive');
const incomingFees = document.getElementById('incomingFees');
const incomingTimerFill = document.getElementById('incomingTimerFill');
const incomingTimerText = document.getElementById('incomingTimerText');
const incomingTimer = incomingTimerFill.closest('.decision-timer');
const incomingAccept = document.getElementById('incomingAccept');
const incomingReject = document.getElementById('incomingReject');
const incomingError = document.getElementById('incomingError');

// Manage view (build / sell / mortgage one of my properties)
const manageDialog = document.getElementById('manageDialog');
const manageHeader = document.getElementById('manageHeader');
const manageStatus = document.getElementById('manageStatus');
const manageActions = document.getElementById('manageActions');
const manageError = document.getElementById('manageError');
const manageDetails = document.getElementById('manageDetails');
const manageClose = document.getElementById('manageClose');
const rollTimer = document.getElementById('rollTimer');
const rollTimerFill = document.getElementById('rollTimerFill');
const rollTimerText = document.getElementById('rollTimerText');

// Buy / auction panel
const decisionPanel = document.getElementById('decisionPanel');
const decisionStrip = document.getElementById('decisionStrip');
const decisionTitle = document.getElementById('decisionTitle');
const decisionSubtitle = document.getElementById('decisionSubtitle');
const decisionInfo = document.getElementById('decisionInfo');
const decisionTimerFill = document.getElementById('decisionTimerFill');
const decisionTimerText = document.getElementById('decisionTimerText');
const decisionTimer = decisionTimerFill.closest('.decision-timer');
const decisionMyCash = document.getElementById('decisionMyCash');
const decisionButtons = document.getElementById('decisionButtons');
const decisionError = document.getElementById('decisionError');

// Countdowns turn red when this many seconds (or fewer) are left.
const ROLL_WARNING_SECONDS = 10;
const DECISION_WARNING_SECONDS = 5;

let socket = null;
let session = null;      // { code, playerToken } from localStorage
let setup = null;        // tokens, colors, limits, timings from /api/setup
let myPlayerId = null;   // my public player id
let latestState = null;  // newest room state from the server

// Token animation: where each piece is DRAWN right now (may lag behind
// the server position while a piece is walking).
const displayPositions = {};
let lastAnimatedMoveId = null;
let animating = false;
let animationRun = 0;    // increases when a new animation replaces an old one
let waitingForServer = false;

// Server clock minus our clock (ms). Deadlines are server timestamps,
// so we correct for a phone whose clock is a bit off.
let clockOffsetMs = 0;

// ---------- Small helpers ----------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function playerById(id) {
  return latestState.players.find((p) => p.id === id) || null;
}

// Color for a square's chip/strip: the group color, or grey for
// railroads and utilities.
function squareColor(square) {
  return square.group ? GROUPS[square.group].color : '#6c757d';
}

// Show a full-page message instead of the game (with a link home).
function showMessage(text) {
  gameLayout.hidden = true;
  gameMessage.hidden = false;
  gameMessageText.textContent = text;
  gameMessageHome.hidden = false;
}

function showGame() {
  gameMessage.hidden = true;
  gameLayout.hidden = false;
}

// ---------- Dice ----------

// Which of the 9 cells (3x3 grid, numbered 0-8) have a pip for each value.
const PIP_CELLS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8]
};

function renderDie(dieEl, value) {
  dieEl.innerHTML = '';
  const cells = PIP_CELLS[value] || [];
  for (let i = 0; i < 9; i++) {
    const pip = document.createElement('span');
    pip.className = cells.includes(i) ? 'pip on' : 'pip';
    dieEl.appendChild(pip);
  }
  dieEl.classList.toggle('empty', !value);
}

// Short shake when new dice arrive.
function shakeDice() {
  [die1, die2].forEach((dieEl) => {
    dieEl.classList.remove('rolling');
    void dieEl.offsetWidth; // restart the CSS animation
    dieEl.classList.add('rolling');
  });
}

// ---------- Player list ----------

// Rent text on a title-deed card: "৳76", or "পাশা × 4" for utilities.
// rentNow comes from the server (it knows full sets, railroad counts, ...).
function deedRentText(owned) {
  if (owned.mortgaged) return 'বন্ধক'; // mortgaged: no rent
  const rent = owned.rentNow;
  if (!rent) return '';
  return rent.multiplier ? `পাশা × ${rent.multiplier}` : money(rent.amount);
}

// Mini title-deed cards for one player's squares, grouped by color group
// in board order (railroads and utilities form their own groups).
// Each card is a button; clicking it opens the square's detail card.
function deedsHtml(playerId, properties) {
  const groups = []; // [{ key, cards: [] }] in board order
  SQUARES.forEach((square) => {
    const owned = properties[square.index];
    if (!owned || owned.ownerId !== playerId) return;
    const key = square.group || square.type;
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, cards: [] };
      groups.push(group);
    }
    group.cards.push({ square, owned });
  });

  if (groups.length === 0) return '';

  return groups.map((group) =>
    '<div class="deed-group">' + group.cards.map(({ square, owned }) => {
      // Properties: header strip in the group color.
      // Railroads/utilities: plain header with their icon instead.
      const head = square.group
        ? '<span class="deed-head" style="background:' + GROUPS[square.group].color + '"></span>'
        : '<span class="deed-head deed-head-icon">' + squareIconSvg(square) + '</span>';
      return '<button type="button" class="deed' + (owned.mortgaged ? ' mortgaged' : '') + '"' +
          ' data-index="' + square.index + '" title="' + escapeHtml(square.name) + '">' +
        head +
        '<span class="deed-name">' + escapeHtml(square.name) + '</span>' +
        buildingsHtml(owned.houses, 'deed-buildings') +
        '<span class="deed-rent">' + escapeHtml(deedRentText(owned)) + '</span>' +
      '</button>';
    }).join('') + '</div>'
  ).join('');
}

// "আমার সম্পত্তি" panel (left of the board on wide screens).
function renderMyDeeds(state) {
  const html = deedsHtml(myPlayerId, state.game.properties);
  myDeeds.innerHTML = html || '<p class="deeds-empty">এখনো কোনো সম্পত্তি নেই।</p>';
}

function renderPlayers(state) {
  const currentId = state.game.currentPlayerId;
  gamePlayers.innerHTML = '';

  state.players.forEach((player) => {
    const piece = findById(setup.pieces, player.piece);
    const color = findById(setup.colors, player.color);

    const li = document.createElement('li');
    li.className = 'game-player';
    if (player.id === currentId) li.classList.add('current');
    if (player.id === myPlayerId) li.classList.add('me');
    if (!player.connected) li.classList.add('offline');
    if (player.bankrupt) li.classList.add('bankrupt');
    if (color) li.style.setProperty('--player-color', color.hex);

    let badges = '';
    if (player.bankrupt) badges += '<span class="badge badge-bankrupt">দেউলিয়া</span>';
    if (player.id === currentId && !state.game.over) badges += '<span class="badge badge-turn">▶ পালা</span>';
    if (player.id === state.hostId) badges += '<span class="badge badge-host">হোস্ট</span>';
    if (player.id === myPlayerId) badges += '<span class="badge badge-me">আপনি</span>';
    if (player.inJail) badges += '<span class="badge badge-jail">হাজতে</span>';
    if (player.jailFreeCount > 0) {
      badges += '<span class="badge badge-card">জেল-মুক্তি কার্ড ×' + player.jailFreeCount + '</span>';
    }
    if (!player.connected) badges += '<span class="badge badge-offline">সংযোগ বিচ্ছিন্ন</span>';

    // A player with an open debt: money shown in red
    const inDebt = state.game.debts.some((d) => d.playerId === player.id);
    const moneyClass = inDebt ? 'game-player-money negative' : 'game-player-money';

    li.innerHTML =
      '<div class="game-player-row">' +
        tokenHtml(piece, color ? color.hex : null, player.name, 'game-player-token') +
        '<span class="game-player-info">' +
          '<span class="game-player-name">' + escapeHtml(player.name) + '</span>' +
          '<span class="game-player-badges">' + badges + '</span>' +
        '</span>' +
        '<span class="' + moneyClass + '">' + money(player.money) + '</span>' +
      '</div>' +
      // My own properties are in the "আমার সম্পত্তি" panel, not here.
      (player.id === myPlayerId || player.bankrupt ? '' :
        '<div class="game-player-actions">' +
          otherPlayerPropertiesHtml(player.id, state.game.properties) +
          tradeButtonHtml(state, player) +
        '</div>');

    gamePlayers.appendChild(li);
  });
}

// Other players: "3টি সম্পত্তি" badge. Tapping it shows/hides a compact
// list of name chips in their group colors (collapsed by default).
// Which lists are open is remembered across redraws.
const expandedPlayerIds = new Set();

function otherPlayerPropertiesHtml(playerId, properties) {
  const owned = SQUARES.filter((square) =>
    properties[square.index] && properties[square.index].ownerId === playerId);
  if (owned.length === 0) {
    return '<span class="props-none">কোনো সম্পত্তি নেই</span>';
  }

  const open = expandedPlayerIds.has(playerId);
  let html =
    '<button type="button" class="props-toggle" data-player-id="' + playerId + '" aria-expanded="' + open + '">' +
      `${owned.length}টি সম্পত্তি ` + (open ? '▴' : '▾') +
    '</button>';

  if (open) {
    html += '<div class="mini-chips">' + owned.map((square) => {
      const dark = !square.group || DARK_GROUPS.includes(square.group);
      const mortgaged = properties[square.index].mortgaged;
      return '<button type="button" class="mini-chip' + (dark ? ' dark' : '') + (mortgaged ? ' mortgaged' : '') + '"' +
          ' data-index="' + square.index + '" style="--chip-color:' + squareColor(square) + '">' +
        squareIconSvg(square, 'chip-icon') + escapeHtml(square.name) +
      '</button>';
    }).join('') + '</div>';
  }
  return html;
}

// ---------- Board center and controls ----------

// Board center: whose turn it is, and the dice.
function renderTurnInfo(state) {
  const current = playerById(state.game.currentPlayerId);
  const piece = findById(setup.pieces, current.piece);
  const color = findById(setup.colors, current.color);
  const isMe = current.id === myPlayerId;

  turnInfo.style.setProperty('--player-color', color ? color.hex : '#333');
  turnInfo.innerHTML =
    '<span class="turn-label">' + (isMe ? 'আপনার পালা!' : 'এখন পালা') + '</span>' +
    '<span class="turn-name">' + tokenHtml(piece, color ? color.hex : null, current.name, 'turn-token') +
      escapeHtml(current.name) + '</span>';

  const dice = state.game.dice || [null, null];
  renderDie(die1, dice[0]);
  renderDie(die2, dice[1]);
}

// The roll button is shown only to the current player while they may roll.
function renderControls(state) {
  const game = state.game;
  const isMyTurn = game.currentPlayerId === myPlayerId;
  // While debts / a bankruptcy sale are open (game.paused) nobody rolls.
  const canRoll = isMyTurn && game.phase === 'roll' && !game.paused && !game.over;
  const me = playerById(myPlayerId);
  const jailChoice = canRoll && me.inJail; // jailed: show the jail options instead

  rollBtn.hidden = !canRoll || jailChoice;
  rollBtn.disabled = animating || waitingForServer;
  debugDiceBox.hidden = !(setup.debugDice && canRoll);
  renderJailButtons(jailChoice, me);

  const current = playerById(game.currentPlayerId);
  const debt = game.debts[0];
  if (game.over) {
    turnHint.textContent = 'খেলা শেষ!';
  } else if (debt) {
    const debtor = playerById(debt.playerId);
    turnHint.textContent = debtor.id === myPlayerId
      ? 'দেনা মেটান — বিক্রি, বন্ধক বা বাণিজ্য করে টাকা জোগাড় করুন।'
      : `${debtor.name}-এর দেনা মেটানোর অপেক্ষা…`;
  } else if (game.bankSale) {
    turnHint.textContent = 'দেউলিয়া খেলোয়াড়ের সম্পত্তি ব্যাংক নিলামে তুলছে…';
  } else if (me.bankrupt) {
    turnHint.textContent = 'আপনি দেউলিয়া — খেলা দেখছেন।';
  } else if (game.phase === 'card') {
    turnHint.textContent = 'কার্ড পড়া হচ্ছে…';
  } else if (game.phase === 'roll' && current.inJail) {
    turnHint.textContent = isMyTurn
      ? `আপনি হাজতে (চেষ্টা ${current.jailTurns + 1}/${setup.maxJailTurns})। বের হওয়ার উপায় বেছে নিন।`
      : `${current.name} হাজতে — সিদ্ধান্তের অপেক্ষায়…`;
  } else if (game.phase === 'buy') {
    turnHint.textContent = isMyTurn ? 'কিনবেন কি না, সিদ্ধান্ত নিন।' : `${current.name} ভাবছেন কিনবেন কিনা…`;
  } else if (game.phase === 'ownerAuction') {
    turnHint.textContent = isMyTurn ? 'নিলামে তুলবেন কি না, সিদ্ধান্ত নিন।' : `${current.name} ভাবছেন নিলামে তুলবেন কিনা…`;
  } else if (game.phase === 'auction') {
    turnHint.textContent = 'নিলাম চলছে!';
  } else if (game.phase === 'moving') {
    turnHint.textContent = isMyTurn ? 'আপনার চাল চলছে…' : `${current.name}-এর চাল চলছে…`;
  } else if (!isMyTurn) {
    turnHint.textContent = `${current.name}-এর পাশা ফেলার অপেক্ষায়…`;
  } else {
    turnHint.textContent = game.doublesCount > 0
      ? 'জোড়া পড়েছে! আবার পাশা ফেলুন।'
      : 'আপনার পালা! পাশা ফেলুন।';
  }
}

// Jail options for the jailed current player (server checks them again):
//   "৳50 দিয়ে বের হও" only if they can afford it,
//   "জেল-মুক্তি কার্ড ব্যবহার করো" only if they hold one,
//   "জোড়া পড়ার চেষ্টা করো" = a normal roll request (also what a timeout does).
function renderJailButtons(show, me) {
  jailButtons.hidden = !show;
  jailButtons.innerHTML = '';
  if (!show) return;

  const busy = animating || waitingForServer;
  if (me.money >= setup.jailFine) {
    jailButtons.appendChild(makeButton(`৳${setup.jailFine} দিয়ে বের হও`, 'control-btn secondary', busy,
      () => sendRequest('jail:pay', {}, actionError)));
  }
  if (me.jailFreeCount > 0) {
    jailButtons.appendChild(makeButton('জেল-মুক্তি কার্ড ব্যবহার করো', 'control-btn secondary', busy,
      () => sendRequest('jail:useCard', {}, actionError)));
  }
  jailButtons.appendChild(makeButton('জোড়া পড়ার চেষ্টা করো', 'control-btn', busy, () => {
    const dice = chosenDebugDice();
    sendRequest('game:roll', dice ? { dice } : {}, actionError);
  }));
}

// ---------- Bank stock ----------

function renderBankStock(state) {
  const bank = state.game.bank;
  bankStock.textContent = `ব্যাংকে: বাড়ি ${bank.houses} · হোটেল ${bank.hotels}`;
}

// ---------- Manage view: build / sell / mortgage ----------
// Opened by clicking one of MY title-deed cards. The server sends, for each
// owned square, what is allowed right now and why not (options.*.reason),
// so the buttons and reasons always match the server's rules.

let managedIndex = null; // square index shown in the manage view, or null

function openManage(index) {
  managedIndex = index;
  manageError.textContent = '';
  renderManage(latestState);
  if (managedIndex !== null && !manageDialog.open) manageDialog.showModal();
}

function closeManage() {
  managedIndex = null;
  if (manageDialog.open) manageDialog.close();
}

function buildingsText(houses) {
  if (houses === 5) return 'হোটেল';
  if (houses > 0) return `${houses}টি বাড়ি`;
  return 'কোনো বাড়ি নেই';
}

function renderManage(state) {
  if (managedIndex === null) return;
  const owned = state.game.properties[managedIndex];
  if (!owned || owned.ownerId !== myPlayerId) {
    closeManage(); // sold or lost in the meantime
    return;
  }
  const square = SQUARES[managedIndex];
  const options = owned.options;

  // Header: group color (or grey + icon for railroads/utilities) + name
  const dark = !square.group || DARK_GROUPS.includes(square.group);
  manageHeader.className = 'manage-header' + (dark ? ' dark-bg' : '');
  manageHeader.style.background = squareColor(square);
  manageHeader.innerHTML = squareIconSvg(square, 'title-icon') +
    '<h2>' + escapeHtml(square.name) + '</h2>' +
    (square.group ? '<span class="detail-group">' + escapeHtml(GROUPS[square.group].name) + ' রঙ</span>' : '');

  const parts = [];
  if (square.type === 'property') parts.push(buildingsText(owned.houses));
  if (owned.mortgaged) parts.push('বন্ধক রাখা — কোনো ভাড়া নেই');
  else parts.push('এখনকার ভাড়া: ' + deedRentText(owned));
  manageStatus.textContent = parts.join(' · ');

  // One row per action: [label, option, event, amount text]
  const rows = [];
  if (options.buildHouse) {
    rows.push(['বাড়ি বানাও', options.buildHouse, 'property:buildHouse', money(options.buildHouse.amount)]);
    rows.push(['বাড়ি বিক্রি', options.sellHouse, 'property:sellHouse', '+' + money(options.sellHouse.amount)]);
    if (owned.houses === 5) {
      rows.push(['হোটেল বিক্রি', options.sellHotel, 'property:sellHotel', '+' + money(options.sellHotel.amount)]);
    } else {
      rows.push(['হোটেল বানাও', options.buildHotel, 'property:buildHotel', money(options.buildHotel.amount)]);
    }
  }
  if (owned.mortgaged) {
    rows.push(['বন্ধক ছাড়াও', options.unmortgage, 'property:unmortgage', money(options.unmortgage.amount)]);
  } else {
    rows.push(['বন্ধক রাখো', options.mortgage, 'property:mortgage', '+' + money(options.mortgage.amount)]);
  }

  manageActions.innerHTML = '';
  rows.forEach(([label, option, eventName, amountText]) => {
    const row = document.createElement('div');
    row.className = 'manage-row';
    const button = makeButton('', 'manage-btn', Boolean(option.reason) || waitingForServer,
      () => sendRequest(eventName, { index: managedIndex }, manageError));
    button.innerHTML = '<span>' + escapeHtml(label) + '</span><span class="manage-amount">' + escapeHtml(amountText) + '</span>';
    row.appendChild(button);
    if (option.reason) {
      const reason = document.createElement('span');
      reason.className = 'manage-reason';
      reason.textContent = option.reason;
      row.appendChild(reason);
    }
    manageActions.appendChild(row);
  });
}

manageClose.addEventListener('click', closeManage);
manageDialog.addEventListener('close', () => { managedIndex = null; });
manageDialog.addEventListener('click', (event) => {
  if (event.target === manageDialog) closeManage(); // click on the backdrop
});
manageDetails.addEventListener('click', () => {
  const index = managedIndex;
  closeManage();
  if (index !== null) showDetail(index);
});

// ---------- Debts (Step 9) ----------
// The debtor sees what they owe, their cash, the most they could raise,
// and a countdown. Selling/mortgaging (manage view) and trading stay
// available. Everyone else sees who the game is waiting for.

function creditorText(debt) {
  if (debt.creditorId === 'bank') return 'ব্যাংক';
  if (debt.creditorId === 'each') return 'প্রত্যেক খেলোয়াড়';
  const creditor = playerById(debt.creditorId);
  return creditor ? creditor.name : 'ব্যাংক';
}

function renderDebt(state) {
  // My own debt first; otherwise the first open debt (watch only)
  const debt = state.game.debts.find((d) => d.playerId === myPlayerId) || state.game.debts[0];
  if (!debt || state.game.over) {
    debtPanel.hidden = true;
    debtError.textContent = '';
    return;
  }
  const debtor = playerById(debt.playerId);
  const mine = debtor.id === myPlayerId;
  debtPanel.hidden = false;
  debtPanel.classList.toggle('watching', !mine);

  debtTitle.textContent = mine ? 'আপনার দেনা' : `${debtor.name}-এর দেনা মেটানোর অপেক্ষা…`;
  debtInfo.innerHTML =
    '<p>দেনা: <strong>' + money(debt.amount) + '</strong> → ' + escapeHtml(creditorText(debt)) +
      ' <span class="debt-reason">(' + escapeHtml(debt.reason) + ')</span></p>' +
    '<p>' + (mine ? 'আপনার' : escapeHtml(debtor.name) + '-এর') + ' টাকা: <strong>' + money(debtor.money) + '</strong>' +
      ' · সর্বোচ্চ জোগাড় করা যাবে: <strong>' + money(debt.maxRaisable) + '</strong></p>';

  debtButtons.hidden = !mine;
  if (mine) {
    debtPay.disabled = debtor.money < debt.amount || waitingForServer;
    debtBankrupt.disabled = waitingForServer;
    debtHint.textContent = debtor.money >= debt.amount
      ? 'যথেষ্ট টাকা হয়েছে — পরিশোধ করুন।'
      : (debt.maxRaisable >= debt.amount
        ? 'আমার সম্পত্তি থেকে বাড়ি বিক্রি বা বন্ধক রাখুন, অথবা বাণিজ্য করুন। সময় শেষ হলে স্বয়ংক্রিয়ভাবে বিক্রি হবে।'
        : 'সব বিক্রি করলেও দেনা মেটানো যাবে না। সময় শেষে দেউলিয়া হবেন।');
  } else {
    debtHint.textContent = '';
  }
}

debtPay.addEventListener('click', () => sendRequest('debt:pay', {}, debtError));
debtManage.addEventListener('click', () => {
  document.querySelector('.my-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
debtBankrupt.addEventListener('click', () => {
  if (window.confirm('আপনি কি সত্যিই দেউলিয়া ঘোষণা করতে চান? আপনার সব সম্পত্তি পাওনাদারের কাছে যাবে এবং আপনি খেলা থেকে বাদ পড়বেন।')) {
    sendRequest('debt:bankrupt', {}, debtError);
  }
});

resignBtn.addEventListener('click', () => {
  if (window.confirm('আপনি কি সত্যিই খেলা ছেড়ে দিতে চান? আপনি ব্যাংকের কাছে দেউলিয়া হবেন এবং আপনার সম্পত্তি নিলামে উঠবে।')) {
    sendRequest('game:resign', {}, actionError);
  }
});

// ---------- End of game ----------

function renderEndOfGame(state) {
  const me = playerById(myPlayerId);
  resignBtn.hidden = Boolean(state.game.over) || me.bankrupt;
  renderDebugMoney(state);

  const over = state.game.over;
  if (!over) {
    winnerScreen.hidden = true;
    return;
  }
  const winner = playerById(over.winnerId);
  winnerName.textContent = 'বিজয়ী: ' + winner.name;
  winnerRanking.innerHTML = over.ranking.map((row) => {
    const p = playerById(row.id);
    const piece = findById(setup.pieces, p.piece);
    const color = findById(setup.colors, p.color);
    return '<li class="' + (row.place === 1 ? 'first' : '') + '">' +
      '<span class="rank">' + row.place + '</span>' +
      tokenHtml(piece, color ? color.hex : null, p.name, 'rank-token') +
      '<span class="rank-name">' + escapeHtml(row.name) + (row.bankrupt ? ' <span class="badge badge-bankrupt">দেউলিয়া</span>' : '') + '</span>' +
      '<span class="rank-money">' + money(row.money) + '<small>মোট সম্পদ ' + money(row.netWorth) + '</small></span>' +
    '</li>';
  }).join('');
  winnerScreen.hidden = false;
}

newGameBtn.addEventListener('click', () => {
  clearSession();
  location.href = '/';
});

// DEBUG_DICE=1 and host only: set any player's cash (server checks both).
function renderDebugMoney(state) {
  const show = setup.debugDice && state.hostId === myPlayerId && !state.game.over;
  debugMoney.hidden = !show;
  if (!show) return;
  const active = state.players.filter((p) => !p.bankrupt);
  const selected = debugMoneyPlayer.value;
  debugMoneyPlayer.innerHTML = active.map((p) =>
    '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>').join('');
  if (active.some((p) => p.id === selected)) debugMoneyPlayer.value = selected;
}

debugMoneySet.addEventListener('click', () => {
  const amount = Math.floor(Number(debugMoneyAmount.value));
  sendRequest('debug:setMoney', { targetId: debugMoneyPlayer.value, amount }, actionError);
});

// ---------- Trading ----------
// The server checks everything (again at acceptance). The builder only
// helps: it shows what can be traded, the mortgage fees, and a preview.

let tradeTargetId = null;        // player I am building an offer for
const tradeGiveSet = new Set();  // square indexes I give
const tradeGetSet = new Set();   // square indexes I want

function myOutgoingTrade(state) {
  return state.game.trades.find((tr) => tr.fromId === myPlayerId) || null;
}

function myIncomingTrade(state) {
  return state.game.trades.find((tr) => tr.toId === myPlayerId) || null; // oldest first
}

// Why I can't start a new offer right now, or null.
function tradeStartProblem(state) {
  if (state.game.phase === 'auction') return 'নিলাম চলার সময় বাণিজ্য করা যাবে না';
  if (myOutgoingTrade(state)) return 'আপনার একটি প্রস্তাব অপেক্ষায় আছে';
  return null;
}

function tradeButtonHtml(state, player) {
  if (playerById(myPlayerId).bankrupt || state.game.over) return '';
  const problem = tradeStartProblem(state);
  return '<button type="button" class="trade-btn" data-player-id="' + player.id + '"' +
    (problem ? ' disabled title="' + escapeHtml(problem) + '"' : '') + '>বাণিজ্য</button>';
}

// Fee for receiving a mortgaged property: 10% of its mortgage value, rounded up.
function tradeFee(indexes) {
  return indexes.reduce((sum, index) => {
    const owned = latestState.game.properties[index];
    return owned && owned.mortgaged ? sum + Math.ceil(mortgageValue(SQUARES[index]) * setup.mortgageFeeRate) : sum;
  }, 0);
}

// "নোয়াখালী (বন্ধক), ৳100, 1টি জেল-মুক্তি কার্ড" or "কিছু না"
function describeSide(side) {
  const parts = side.properties.map((index) => {
    const owned = latestState.game.properties[index];
    return SQUARES[index].name + (owned && owned.mortgaged ? ' (বন্ধক)' : '');
  });
  if (side.cash > 0) parts.push(money(side.cash));
  if (side.jailFree > 0) parts.push(side.jailFree + 'টি জেল-মুক্তি কার্ড');
  return parts.length ? parts.join(', ') : 'কিছু না';
}

// Property chips for one player in the builder. Non-tradable ones are
// disabled; their reasons are listed under the chips.
function renderTradeChips(container, blockedEl, ownerId, selected) {
  const properties = latestState.game.properties;
  const owned = SQUARES.filter((s) => properties[s.index] && properties[s.index].ownerId === ownerId);
  container.innerHTML = '';
  const blockedNotes = [];

  // Drop selections that are no longer possible (sold, built on, ...)
  [...selected].forEach((index) => {
    const p = properties[index];
    if (!p || p.ownerId !== ownerId || p.tradeBlock) selected.delete(index);
  });

  if (owned.length === 0) {
    container.innerHTML = '<span class="trade-none">কোনো সম্পত্তি নেই</span>';
  }
  owned.forEach((square) => {
    const state = properties[square.index];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'trade-chip' + (selected.has(square.index) ? ' selected' : '') + (state.mortgaged ? ' mortgaged' : '');
    button.style.setProperty('--chip-color', squareColor(square));
    button.disabled = Boolean(state.tradeBlock);
    button.innerHTML = '<span class="trade-chip-color"></span>' + escapeHtml(square.name) +
      (state.mortgaged ? '<span class="trade-chip-tag">বন্ধক</span>' : '');
    if (state.tradeBlock) {
      button.title = state.tradeBlock;
      blockedNotes.push(square.name + ': ' + state.tradeBlock);
    }
    button.addEventListener('click', () => {
      if (selected.has(square.index)) selected.delete(square.index);
      else selected.add(square.index);
      renderTradeBuilder();
    });
    container.appendChild(button);
  });
  blockedEl.textContent = blockedNotes.join(' · ');
}

// Read a whole-number input, limited to 0..max.
function readCount(input, max) {
  const value = Math.floor(Number(input.value) || 0);
  return Math.max(0, Math.min(value, max));
}

function currentOffer() {
  const me = playerById(myPlayerId);
  const them = playerById(tradeTargetId);
  return {
    give: {
      properties: [...tradeGiveSet].sort((a, b) => a - b),
      cash: readCount(tradeGiveCash, Math.max(0, me.money)),
      jailFree: readCount(tradeGiveJail, me.jailFreeCount)
    },
    get: {
      properties: [...tradeGetSet].sort((a, b) => a - b),
      cash: readCount(tradeGetCash, Math.max(0, them.money)),
      jailFree: readCount(tradeGetJail, them.jailFreeCount)
    }
  };
}

function openTradeBuilder(playerId) {
  tradeTargetId = playerId;
  tradeGiveSet.clear();
  tradeGetSet.clear();
  [tradeGiveCash, tradeGetCash, tradeGiveJail, tradeGetJail].forEach((input) => { input.value = 0; });
  tradeError.textContent = '';
  renderTradeBuilder();
  if (!tradeDialog.open) tradeDialog.showModal();
}

function closeTradeBuilder() {
  tradeTargetId = null;
  if (tradeDialog.open) tradeDialog.close();
}

function renderTradeBuilder() {
  if (tradeTargetId === null || !latestState) return;
  const me = playerById(myPlayerId);
  const them = playerById(tradeTargetId);
  if (!them) {
    closeTradeBuilder();
    return;
  }
  tradeTitle.textContent = 'বাণিজ্য: ' + them.name;
  renderTradeChips(tradeGiveChips, tradeGiveBlocked, myPlayerId, tradeGiveSet);
  renderTradeChips(tradeGetChips, tradeGetBlocked, tradeTargetId, tradeGetSet);

  // Limits for cash and jail-free cards
  tradeGiveCash.max = Math.max(0, me.money);
  tradeGetCash.max = Math.max(0, them.money);
  tradeGiveJail.max = me.jailFreeCount;
  tradeGetJail.max = them.jailFreeCount;
  tradeGiveJailRow.hidden = me.jailFreeCount === 0;
  tradeGetJailRow.hidden = them.jailFreeCount === 0;

  // Preview with mortgage fees for both sides
  const offer = currentOffer();
  const myFee = tradeFee(offer.get.properties);    // I receive "get"
  const theirFee = tradeFee(offer.give.properties); // they receive "give"
  let html =
    '<p><strong>আপনি দিচ্ছেন:</strong> ' + escapeHtml(describeSide(offer.give)) + '</p>' +
    '<p><strong>আপনি চাইছেন:</strong> ' + escapeHtml(describeSide(offer.get)) + '</p>';
  if (myFee > 0) html += '<p class="trade-fee-line">আপনাকে বন্ধকী ফি দিতে হবে: ' + money(myFee) + '</p>';
  if (theirFee > 0) html += '<p class="trade-fee-line">' + escapeHtml(them.name) + '-কে বন্ধকী ফি দিতে হবে: ' + money(theirFee) + '</p>';
  tradeSummary.innerHTML = html;

  const empty = offer.give.properties.length + offer.give.cash + offer.give.jailFree +
    offer.get.properties.length + offer.get.cash + offer.get.jailFree === 0;
  const problem = tradeStartProblem(latestState);
  tradeSend.disabled = empty || Boolean(problem) || waitingForServer;
  tradeSend.title = problem || (empty ? 'কিছু বাছাই করুন' : '');
}

[tradeGiveCash, tradeGetCash, tradeGiveJail, tradeGetJail].forEach((input) => {
  input.addEventListener('input', renderTradeBuilder);
});
tradeCancel.addEventListener('click', closeTradeBuilder);
tradeDialog.addEventListener('close', () => { tradeTargetId = null; });
tradeSend.addEventListener('click', async () => {
  const offer = currentOffer();
  tradeError.textContent = '';
  waitingForServer = true;
  tradeSend.disabled = true;
  const response = await request(socket, 'trade:propose', { ...session, toId: tradeTargetId, ...offer });
  waitingForServer = false;
  if (response.ok) closeTradeBuilder();
  else {
    tradeError.textContent = response.error;
    renderTradeBuilder();
  }
});

// Incoming offer panel + my outgoing offer status
function renderTrades(state) {
  renderTradeBuilder();

  // Incoming
  const incoming = myIncomingTrade(state);
  incomingTrade.hidden = !incoming;
  if (incoming) {
    const from = playerById(incoming.fromId);
    incomingTitle.textContent = from.name + ' আপনাকে বাণিজ্যের প্রস্তাব দিয়েছেন';
    incomingGet.textContent = describeSide(incoming.give); // what they give = what I get
    incomingGive.textContent = describeSide(incoming.get);
    const fees = [];
    if (incoming.feeTo > 0) fees.push('আপনাকে বন্ধকী ফি দিতে হবে: ' + money(incoming.feeTo));
    if (incoming.feeFrom > 0) fees.push(from.name + '-কে বন্ধকী ফি দিতে হবে: ' + money(incoming.feeFrom));
    incomingFees.textContent = fees.join(' · ');
    incomingAccept.disabled = state.game.phase === 'auction' || waitingForServer;
    incomingAccept.title = state.game.phase === 'auction' ? 'নিলাম শেষ হলে গ্রহণ করা যাবে' : '';
    incomingReject.disabled = waitingForServer;
    incomingTrade.dataset.tradeId = incoming.id;
  } else {
    incomingError.textContent = '';
  }

  // Outgoing
  const outgoing = myOutgoingTrade(state);
  outgoingTrade.hidden = !outgoing;
  if (outgoing) {
    const to = playerById(outgoing.toId);
    outgoingTrade.innerHTML =
      '<span class="outgoing-text">' + escapeHtml(to.name) + '-এর উত্তরের অপেক্ষায় · <span class="outgoing-time"></span></span>' +
      '<button type="button" class="outgoing-cancel">বাতিল করুন</button>';
    outgoingTrade.querySelector('.outgoing-cancel').addEventListener('click', () =>
      sendRequest('trade:cancel', { tradeId: outgoing.id }, actionError));
    outgoingTrade.dataset.deadline = outgoing.deadline;
  }
  updateTradeCountdowns();
}

function updateTradeCountdowns() {
  if (!latestState) return;
  const incoming = myIncomingTrade(latestState);
  if (incoming && !incomingTrade.hidden) {
    showCountdown(incomingTimerFill, incomingTimerText, incomingTimer, incoming.deadline,
      setup.tradeResponseSeconds, DECISION_WARNING_SECONDS);
  }
  const outgoing = myOutgoingTrade(latestState);
  const timeEl = outgoingTrade.querySelector('.outgoing-time');
  if (outgoing && timeEl) {
    const left = Math.max(0, Math.ceil((outgoing.deadline - (Date.now() + clockOffsetMs)) / 1000));
    timeEl.textContent = left + ' সেকেন্ড';
  }
}

incomingAccept.addEventListener('click', () =>
  sendRequest('trade:accept', { tradeId: Number(incomingTrade.dataset.tradeId) }, incomingError));
incomingReject.addEventListener('click', () =>
  sendRequest('trade:reject', { tradeId: Number(incomingTrade.dataset.tradeId) }, incomingError));

// ---------- Card display (ভাগ্য / সমাজকল্যাণ) ----------
// The server shows a drawn card for CARD_SHOW_MS, then applies it and
// clears it. We hide it when it is cleared or its time is up.

function renderCard(state) {
  const card = state.game.card;
  if (!card || cardTimeIsUp(card)) {
    cardModal.hidden = true;
    return;
  }
  const player = playerById(card.playerId);
  cardBox.className = 'card-box deck-' + card.deck;
  cardDeckIcon.innerHTML = iconSvg(card.deck === 'chance' ? 'chance' : 'community');
  cardDeckName.textContent = card.deckName;
  cardPlayer.textContent = player ? `${player.name} কার্ড তুলেছেন` : '';
  cardText.textContent = card.text;
  cardEffect.textContent = card.effect;
  cardModal.hidden = false;
}

function cardTimeIsUp(card) {
  return Date.now() + clockOffsetMs > card.until;
}

// ---------- Buy / owner-auction / auction panel ----------

// Decision types that use the panel, with their countdown length.
function decisionSeconds(type) {
  if (type === 'buy') return setup.buyDecisionSeconds;
  if (type === 'ownerAuction') return setup.ownerAuctionDecisionSeconds;
  if (type === 'auction') return setup.auctionSeconds;
  return null; // not a panel decision (Step 6+: jail options, ...)
}

// One-line rent summary for the decision panel.
function rentSummary(square) {
  if (square.type === 'railroad') {
    return 'ভাড়া: ' + RULES.railroadRent.map(money).join(' / ') + ' (1-4টি রেলস্টেশন)';
  }
  if (square.type === 'utility') {
    const m = RULES.utilityMultipliers;
    return `ভাড়া: পাশার যোগফল × ${m[0]} (1টি), × ${m[1]} (2টি)`;
  }
  return `ভাড়া ${money(square.rent.base)} · পুরো সেট ${money(square.rent.set)} · হোটেল ${money(square.rent.hotel)}`;
}

function makeButton(label, className, disabled, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener('click', onClick);
  return button;
}

function renderDecision(state) {
  const decision = state.game.pendingDecision;
  if (!decision || decisionSeconds(decision.type) === null) {
    decisionPanel.hidden = true;
    decisionError.textContent = '';
    return;
  }

  const square = SQUARES[decision.squareIndex];
  const me = playerById(myPlayerId);
  decisionPanel.hidden = false;
  decisionStrip.style.background = squareColor(square);
  decisionButtons.innerHTML = '';
  decisionMyCash.textContent = `আপনার টাকা: ${money(me.money)}`;

  if (decision.type === 'buy') {
    const decider = playerById(decision.playerId);
    const isMe = decider.id === myPlayerId;
    const canAfford = me.money >= square.price;

    decisionTitle.innerHTML = squareIconSvg(square, 'title-icon') + escapeHtml(square.name);
    decisionSubtitle.textContent = isMe ? 'আপনি কি এটি কিনবেন?' : `${decider.name} ভাবছেন কিনবেন কিনা…`;
    decisionInfo.innerHTML =
      '<p class="decision-price">দাম: <strong>' + money(square.price) + '</strong></p>' +
      '<p class="decision-rent">' + escapeHtml(rentSummary(square)) + '</p>' +
      (isMe && !canAfford ? '<p class="decision-note">যথেষ্ট টাকা নেই।</p>' : '');
    decisionMyCash.hidden = !isMe;

    if (isMe) {
      decisionButtons.appendChild(makeButton('কিনুন (' + money(square.price) + ')', 'decision-btn primary',
        !canAfford || waitingForServer, () => sendDecision('game:buy', {})));
      decisionButtons.appendChild(makeButton('কিনব না', 'decision-btn secondary',
        waitingForServer, () => sendDecision('game:decline', {})));
    }
    return;
  }

  if (decision.type === 'ownerAuction') {
    const owner = playerById(decision.playerId);
    const isMe = owner.id === myPlayerId;

    decisionTitle.innerHTML = squareIconSvg(square, 'title-icon') + escapeHtml(square.name);
    decisionSubtitle.textContent = isMe
      ? 'নিজের সম্পত্তিতে থামলেন। নিলামে তুলবেন?'
      : `${owner.name} ভাবছেন নিলামে তুলবেন কিনা…`;
    decisionInfo.innerHTML =
      '<p class="decision-price">তালিকা মূল্য: ' + money(square.price) + '</p>' +
      '<p class="decision-rent">সর্বনিম্ন দর: <strong>' + money(decision.minBid) + '</strong>' +
      ' · অন্যরা দর দেবেন, টাকা পাবেন আপনি</p>';
    decisionMyCash.hidden = true;

    if (isMe) {
      decisionButtons.appendChild(makeButton('নিলামে তুলুন', 'decision-btn primary',
        waitingForServer, () => sendDecision('game:ownerAuction', {})));
      decisionButtons.appendChild(makeButton('রেখে দিন', 'decision-btn secondary',
        waitingForServer, () => sendDecision('game:ownerKeep', {})));
    }
    return;
  }

  // Auction: everyone sees the same panel; bidders get buttons.
  const seller = decision.sellerId ? playerById(decision.sellerId) : null;
  // The seller and bankrupt players only watch the auction.
  const iAmSeller = decision.sellerId === myPlayerId || me.bankrupt;
  const highest = decision.highestBidderId ? playerById(decision.highestBidderId) : null;
  const iPassed = decision.passedIds.includes(myPlayerId);
  const iAmHighest = decision.highestBidderId === myPlayerId;
  const passedNames = decision.passedIds.map((id) => playerById(id).name);

  decisionTitle.innerHTML = 'নিলাম: ' + squareIconSvg(square, 'title-icon') + escapeHtml(square.name);
  decisionSubtitle.innerHTML = highest
    ? 'সর্বোচ্চ দর: <strong>' + money(decision.highestBid) + '</strong> — ' + escapeHtml(highest.name)
    : `এখনো কোনো দর নেই (সর্বনিম্ন ${money(decision.minBid)})`;
  decisionInfo.innerHTML =
    '<p class="decision-price">বিক্রেতা: ' + (seller ? escapeHtml(seller.name) : 'ব্যাংক') +
      ' · তালিকা মূল্য: ' + money(square.price) + '</p>' +
    '<p class="decision-rent">' + escapeHtml(rentSummary(square)) + '</p>' +
    (passedNames.length ? '<p class="decision-note">পাস করেছেন: ' + escapeHtml(passedNames.join(', ')) + '</p>' : '') +
    (iAmSeller ? '<p class="decision-note good">আপনার সম্পত্তি নিলামে — অন্যরা দর দিচ্ছেন।</p>' : '') +
    (iPassed ? '<p class="decision-note">আপনি পাস করেছেন।</p>' : '') +
    (iAmHighest ? '<p class="decision-note good">আপনিই সর্বোচ্চ দরদাতা!</p>' : '');
  decisionMyCash.hidden = iAmSeller;

  if (iAmSeller) return; // the seller only watches

  // Bid buttons: highest bid + increment. Before the first bid they start
  // at the minimum bid (e.g. min ৳80 -> ৳80 / ৳120 / ৳170).
  const base = decision.highestBidderId
    ? decision.highestBid
    : decision.minBid - setup.bidIncrements[0];
  setup.bidIncrements.forEach((increment) => {
    const amount = base + increment;
    const disabled = iPassed || iAmHighest || amount > me.money || waitingForServer;
    const label = decision.highestBidderId ? `+${money(increment)} (${money(amount)})` : money(amount);
    decisionButtons.appendChild(makeButton(label, 'decision-btn primary',
      disabled, () => sendDecision('auction:bid', { amount })));
  });
  decisionButtons.appendChild(makeButton('পাস', 'decision-btn secondary',
    iPassed || iAmHighest || waitingForServer, () => sendDecision('auction:pass', {})));
}

// ---------- Countdowns ----------
// The server owns all timers; we only count down to its deadlines.

// Fill a bar + text for a deadline. Returns false if there is no deadline.
function showCountdown(fillEl, textEl, containerEl, deadline, totalSeconds, warningSeconds) {
  if (!deadline) return false;
  const leftMs = Math.max(0, deadline - (Date.now() + clockOffsetMs));
  const leftSeconds = Math.ceil(leftMs / 1000);
  fillEl.style.width = Math.min(100, (leftMs / (totalSeconds * 1000)) * 100) + '%';
  textEl.textContent = `${leftSeconds} সেকেন্ড`;
  containerEl.classList.toggle('warning', leftSeconds <= warningSeconds);
  return true;
}

function updateCountdown() {
  if (!latestState) return;
  const game = latestState.game;

  // Roll timer (board center)
  const rolling = game.phase === 'roll' &&
    showCountdown(rollTimerFill, rollTimerText, rollTimer, game.rollDeadline,
      setup.rollTimeoutSeconds, ROLL_WARNING_SECONDS);
  rollTimer.hidden = !rolling;

  // Trade offers (incoming panel + my outgoing offer)
  updateTradeCountdowns();

  // Debt countdown
  const openDebt = game.debts && game.debts[0];
  if (openDebt && !debtPanel.hidden) {
    showCountdown(debtTimerFill, debtTimerText, debtTimer, openDebt.deadline,
      setup.debtResolveSeconds, DECISION_WARNING_SECONDS * 3);
  }

  // Auto-close the card when its time is up
  if (game.card && !cardModal.hidden && cardTimeIsUp(game.card)) cardModal.hidden = true;

  // Buy / owner-auction / auction timer (decision panel)
  const decision = game.pendingDecision;
  const total = decision ? decisionSeconds(decision.type) : null;
  if (total !== null) {
    showCountdown(decisionTimerFill, decisionTimerText, decisionTimer, decision.deadline,
      total, DECISION_WARNING_SECONDS);
  }
}

// A few updates per second is plenty for a seconds display.
setInterval(updateCountdown, 250);

// ---------- Drawing everything ----------

function renderLog(state) {
  eventLog.innerHTML = '';
  state.game.log.forEach((entry) => {
    const li = document.createElement('li');
    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = new Date(entry.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    li.appendChild(time);
    li.appendChild(document.createTextNode(' ' + entry.text)); // textContent: safe for names
    eventLog.appendChild(li);
  });
}

// Draw pieces at their DISPLAY positions (which lag during animation).
function drawPieces() {
  const players = latestState.players.filter((p) => !p.bankrupt).map((p) => ({
    ...p,
    position: displayPositions[p.id] !== undefined ? displayPositions[p.id] : p.position
  }));
  renderPieces(players, setup);
}

// Snap every piece to its real (server) position.
function syncPositions() {
  latestState.players.forEach((p) => {
    displayPositions[p.id] = p.position;
  });
}

function renderAll() {
  const state = latestState;
  gameRoomCode.textContent = state.code;
  renderMyDeeds(state);
  renderPlayers(state);
  renderBankStock(state);
  renderManage(state);
  renderTrades(state);
  renderDebt(state);
  renderEndOfGame(state);
  renderTurnInfo(state);
  renderControls(state);
  renderDecision(state);
  renderCard(state);
  renderOwnership(state.game.properties, state.players, setup);
  renderLog(state);
  drawPieces();
  updateCountdown();
}

// ---------- Token animation ----------

// Walk a piece square by square along move.path, then jump if needed
// (e.g. হাজতখানায় যাও -> হাজতখানা).
async function animateMove(move) {
  const run = ++animationRun;
  animating = true;
  renderControls(latestState);

  // Everyone else (including a piece whose walk was cut short) snaps to
  // their real position; the moving piece starts where it came from.
  syncPositions();
  displayPositions[move.playerId] = move.from;
  drawPieces();

  for (const index of move.path) {
    await sleep(setup.moveStepMs);
    if (run !== animationRun) return; // a newer move took over
    displayPositions[move.playerId] = index;
    drawPieces();
  }

  if (move.jumpTo !== null) {
    await sleep(setup.moveJumpPauseMs);
    if (run !== animationRun) return;
    displayPositions[move.playerId] = move.jumpTo;
    drawPieces();
  }

  animating = false;
  syncPositions();
  renderAll();
}

// ---------- New state from the server ----------

function handleState(state, isFirstLoad) {
  latestState = state;
  clockOffsetMs = state.game.serverTime - Date.now();
  const move = state.game.lastMove;
  const isNewMove = move && move.id !== lastAnimatedMoveId;

  if (isFirstLoad || !isNewMove) {
    // Nothing to animate (page just loaded, the turn passed on, a bid, ...).
    if (move) lastAnimatedMoveId = move.id;
    if (!animating) syncPositions();
    renderAll();
    return;
  }

  // A new move: show the dice, then walk the piece.
  lastAnimatedMoveId = move.id;
  renderAll();
  shakeDice();
  animateMove(move);
}

// ---------- Actions ----------

// Debug dice: [a, b] if both selects have a value, otherwise null.
function chosenDebugDice() {
  if (!setup.debugDice) return null;
  const a = Number(debugDie1.value);
  const b = Number(debugDie2.value);
  return a && b ? [a, b] : null;
}

// Send a request with our identity; show a Bangla error in errorEl if it fails.
async function sendRequest(eventName, extraData, errorEl) {
  errorEl.textContent = '';
  waitingForServer = true;
  renderControls(latestState);
  renderDecision(latestState);
  renderManage(latestState); // disables the manage buttons too (no double clicks)

  const response = await request(socket, eventName, { ...session, ...extraData });

  waitingForServer = false;
  renderControls(latestState);
  renderDecision(latestState);
  renderManage(latestState);
  if (!response.ok) errorEl.textContent = response.error;
  // On success the server broadcasts room:state, which redraws everything.
}

function sendDecision(eventName, extraData) {
  sendRequest(eventName, extraData, decisionError);
}

gameLayout.addEventListener('click', (event) => {
  // Clicking a title-deed card or a property chip opens the same detail
  // card as clicking the board square.
  // My own title-deed cards open the manage view (build/sell/mortgage);
  // other cards and chips open the normal detail card.
  const card = event.target.closest('.deed, .mini-chip');
  if (card) {
    const index = Number(card.dataset.index);
    if (card.closest('#myDeeds')) openManage(index);
    else showDetail(index);
    return;
  }

  // "বাণিজ্য" button: open the trade builder for that player.
  const tradeButton = event.target.closest('.trade-btn');
  if (tradeButton) {
    openTradeBuilder(tradeButton.dataset.playerId);
    return;
  }

  // "3টি সম্পত্তি" badge: show/hide that player's property list.
  const toggle = event.target.closest('.props-toggle');
  if (toggle) {
    const id = toggle.dataset.playerId;
    if (expandedPlayerIds.has(id)) expandedPlayerIds.delete(id);
    else expandedPlayerIds.add(id);
    renderPlayers(latestState);
  }
});

rollBtn.addEventListener('click', () => {
  const dice = chosenDebugDice();
  sendRequest('game:roll', dice ? { dice } : {}, actionError);
});

// Fill the debug selects: "random" plus 1-6.
function setupDebugDice() {
  // Next-card picker: choosing a card puts it on top of its deck (the server
  // accepts this only with DEBUG_DICE=1). The select then resets.
  debugCard.innerHTML = '<option value="">পরের কার্ড: এলোমেলো</option>';
  [['chance', 'ভাগ্য'], ['community', 'সমাজকল্যাণ']].forEach(([deck, label]) => {
    const group = document.createElement('optgroup');
    group.label = label;
    setup.debugCards.filter((c) => c.deck === deck).forEach((c) => {
      const option = document.createElement('option');
      option.value = c.id;
      option.textContent = c.text.length > 48 ? c.text.slice(0, 48) + '…' : c.text;
      group.appendChild(option);
    });
    debugCard.appendChild(group);
  });
  debugCard.addEventListener('change', () => {
    const cardId = debugCard.value;
    debugCard.value = '';
    if (cardId) sendRequest('debug:nextCard', { cardId }, actionError);
  });

  [debugDie1, debugDie2].forEach((select) => {
    select.innerHTML = '<option value="">এলোমেলো</option>';
    for (let value = 1; value <= 6; value++) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }
  });
}

// ---------- Start ----------

async function startGamePage() {
  const roomCode = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  session = loadSession();

  if (!roomCode) {
    showMessage('রুম কোড পাওয়া যায়নি। হোম পেজ থেকে রুমে যোগ দিন।');
    return;
  }
  if (!session || session.code !== roomCode) {
    showMessage('আপনি এই রুমের খেলোয়াড় নন। হোম পেজ থেকে রুমে যোগ দিন।');
    return;
  }

  try {
    setup = await fetchSetup();
    await loadBoard();
  } catch (err) {
    console.error('Could not load game data:', err);
    showMessage('খেলার তথ্য লোড করা যায়নি। পেজটি আবার চালু করুন।');
    return;
  }
  if (setup.debugDice) setupDebugDice();

  socket = io();

  // On every (re)connect, tell the server who we are using the saved token.
  socket.on('connect', async () => {
    connectionBanner.hidden = true;
    const response = await request(socket, 'room:resume', session);

    if (!response.ok) {
      clearSession();
      showMessage(response.error);
      socket.disconnect();
      return;
    }
    if (response.state.status === 'lobby') {
      // Game has not started yet: the home page shows the lobby.
      location.href = '/';
      return;
    }

    myPlayerId = response.playerId;
    handleState(response.state, true);
    showGame();
  });

  socket.on('disconnect', () => {
    connectionBanner.hidden = false;
  });

  // Live updates: rolls, moves, purchases, bids, turn changes...
  socket.on('room:state', (state) => {
    if (!myPlayerId || state.code !== roomCode || !state.game) return;
    handleState(state, false);
  });
}

startGamePage();
