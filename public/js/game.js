// public/js/game.js
// Game page (game.html?room=CODE).
// Step 3: identifies the player from localStorage, shows the board,
// the pieces on শুরু and the player list. No turns or dice yet.

const gameMessage = document.getElementById('gameMessage');
const gameMessageText = document.getElementById('gameMessageText');
const gameMessageHome = document.getElementById('gameMessageHome');
const gameLayout = document.getElementById('gameLayout');
const gameRoomCode = document.getElementById('gameRoomCode');
const gamePlayers = document.getElementById('gamePlayers');
const connectionBanner = document.getElementById('connectionBanner');

let setup = null;        // tokens, colors and limits from /api/setup
let myPlayerId = null;   // my public player id

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

// ---------- Player list ----------

function renderPlayers(state) {
  gamePlayers.innerHTML = '';
  state.players.forEach((player) => {
    const piece = findById(setup.pieces, player.piece);
    const color = findById(setup.colors, player.color);

    const li = document.createElement('li');
    li.className = 'game-player';
    if (player.id === myPlayerId) li.classList.add('me');
    if (!player.connected) li.classList.add('offline');
    if (color) li.style.borderLeftColor = color.hex;

    let badges = '';
    if (player.id === state.hostId) badges += '<span class="badge badge-host">হোস্ট</span>';
    if (player.id === myPlayerId) badges += '<span class="badge badge-me">আপনি</span>';
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

function renderState(state) {
  gameRoomCode.textContent = state.code;
  renderPlayers(state);
  renderPieces(state.players, setup);
}

// ---------- Start ----------

async function startGamePage() {
  const roomCode = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  const session = loadSession();

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

  const socket = io();

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
    renderState(response.state);
    showGame();
  });

  socket.on('disconnect', () => {
    connectionBanner.hidden = false;
  });

  // Live updates (someone disconnected, later: moves, money, ...)
  socket.on('room:state', (state) => {
    if (!myPlayerId || state.code !== roomCode) return;
    renderState(state);
  });
}

startGamePage();
