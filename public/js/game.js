// public/js/game.js
// Game page (game.html?room=CODE).
// Shows the board, dice, turn controls, player list and event log.
// The server decides everything; this page only draws the state it sends
// and passes the player's clicks on as requests.

const gameMessage = document.getElementById('gameMessage');
const gameMessageText = document.getElementById('gameMessageText');
const gameMessageHome = document.getElementById('gameMessageHome');
const gameLayout = document.getElementById('gameLayout');
const gameRoomCode = document.getElementById('gameRoomCode');
const gamePlayers = document.getElementById('gamePlayers');
const connectionBanner = document.getElementById('connectionBanner');
const eventLog = document.getElementById('eventLog');

const turnInfo = document.getElementById('turnInfo');
const die1 = document.getElementById('die1');
const die2 = document.getElementById('die2');
const turnHint = document.getElementById('turnHint');
const rollBtn = document.getElementById('rollBtn');
const actionError = document.getElementById('actionError');
const debugDiceBox = document.getElementById('debugDice');
const debugDie1 = document.getElementById('debugDie1');
const debugDie2 = document.getElementById('debugDie2');
const rollTimer = document.getElementById('rollTimer');
const rollTimerFill = document.getElementById('rollTimerFill');
const rollTimerText = document.getElementById('rollTimerText');

// Countdown turns red when this many seconds (or fewer) are left.
const TIMER_WARNING_SECONDS = 10;

let socket = null;
let session = null;      // { code, playerToken } from localStorage
let setup = null;        // tokens, colors, limits, debugDice from /api/setup
let myPlayerId = null;   // my public player id
let latestState = null;  // newest room state from the server

// Token animation: where each piece is DRAWN right now (may lag behind
// the server position while a piece is walking).
const displayPositions = {};
let lastAnimatedMoveId = null;
let animating = false;
let animationRun = 0;    // increases when a new animation replaces an old one
let waitingForServer = false;

// Server clock minus our clock (ms). The roll deadline is a server
// timestamp, so we correct for a phone whose clock is a bit off.
let clockOffsetMs = 0;

// ---------- Small helpers ----------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function playerById(id) {
  return latestState.players.find((p) => p.id === id) || null;
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

// ---------- Drawing ----------

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
    if (color) li.style.setProperty('--player-color', color.hex);

    let badges = '';
    if (player.id === currentId) badges += '<span class="badge badge-turn">▶ পালা</span>';
    if (player.id === state.hostId) badges += '<span class="badge badge-host">হোস্ট</span>';
    if (player.id === myPlayerId) badges += '<span class="badge badge-me">আপনি</span>';
    if (player.inJail) badges += '<span class="badge badge-jail">হাজতে</span>';
    if (!player.connected) badges += '<span class="badge badge-offline">সংযোগ বিচ্ছিন্ন</span>';

    li.innerHTML =
      '<span class="game-player-piece">' + (piece ? piece.emoji : '❔') + '</span>' +
      '<span class="game-player-info">' +
        '<span class="game-player-name">' + escapeHtml(player.name) + '</span>' +
        '<span class="game-player-badges">' + badges + '</span>' +
      '</span>' +
      '<span class="game-player-money">' + money(player.money) + '</span>';

    gamePlayers.appendChild(li);
  });
}

// Board center: whose turn it is, and the dice.
function renderTurnInfo(state) {
  const current = playerById(state.game.currentPlayerId);
  const piece = findById(setup.pieces, current.piece);
  const color = findById(setup.colors, current.color);
  const isMe = current.id === myPlayerId;

  turnInfo.style.setProperty('--player-color', color ? color.hex : '#333');
  turnInfo.innerHTML =
    '<span class="turn-label">' + (isMe ? 'আপনার পালা!' : 'এখন পালা') + '</span>' +
    '<span class="turn-name">' + (piece ? piece.emoji + ' ' : '') + escapeHtml(current.name) + '</span>';

  const dice = state.game.dice || [null, null];
  renderDie(die1, dice[0]);
  renderDie(die2, dice[1]);
}

// The roll button is shown only to the current player while they may roll.
function renderControls(state) {
  const game = state.game;
  const isMyTurn = game.currentPlayerId === myPlayerId;
  const canRoll = isMyTurn && game.phase === 'roll';

  rollBtn.hidden = !canRoll;
  rollBtn.disabled = animating || waitingForServer;
  debugDiceBox.hidden = !(setup.debugDice && canRoll);

  const current = playerById(game.currentPlayerId);
  if (game.phase === 'moving') {
    turnHint.textContent = isMyTurn ? 'আপনার চাল চলছে…' : `${current.name}-এর চাল চলছে…`;
  } else if (!isMyTurn) {
    turnHint.textContent = `${current.name}-এর পাশা ফেলার অপেক্ষায়…`;
  } else {
    turnHint.textContent = game.doublesCount > 0
      ? 'জোড়া পড়েছে! আবার পাশা ফেলুন।'
      : 'আপনার পালা! পাশা ফেলুন।';
  }
}

// ---------- Roll countdown ----------
// The server owns the timer; we only count down to its deadline.

function updateCountdown() {
  if (!latestState) return;
  const game = latestState.game;

  if (game.phase !== 'roll' || !game.rollDeadline) {
    rollTimer.hidden = true;
    return;
  }

  const totalMs = setup.rollTimeoutSeconds * 1000;
  const leftMs = Math.max(0, game.rollDeadline - (Date.now() + clockOffsetMs));
  const leftSeconds = Math.ceil(leftMs / 1000);

  rollTimer.hidden = false;
  rollTimerFill.style.width = Math.min(100, (leftMs / totalMs) * 100) + '%';
  rollTimerText.textContent = `⏱ ${leftSeconds} সেকেন্ড`;
  rollTimer.classList.toggle('warning', leftSeconds <= TIMER_WARNING_SECONDS);
}

// A few updates per second is plenty for a seconds display.
setInterval(updateCountdown, 250);

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
  const players = latestState.players.map((p) => ({
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
  renderPlayers(state);
  renderTurnInfo(state);
  renderControls(state);
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
    // Nothing to animate (page just loaded, the turn passed on, ...).
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

async function sendAction(eventName, extraData) {
  actionError.textContent = '';
  waitingForServer = true;
  renderControls(latestState);

  const response = await request(socket, eventName, { ...session, ...extraData });

  waitingForServer = false;
  renderControls(latestState);
  if (!response.ok) actionError.textContent = response.error;
  // On success the server broadcasts room:state, which redraws everything.
}

rollBtn.addEventListener('click', () => {
  const dice = chosenDebugDice();
  sendAction('game:roll', dice ? { dice } : {});
});

// Fill the debug selects: "random" plus 1-6.
function setupDebugDice() {
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

  // Live updates: rolls, moves, turn changes, connections...
  socket.on('room:state', (state) => {
    if (!myPlayerId || state.code !== roomCode || !state.game) return;
    handleState(state, false);
  });
}

startGamePage();
