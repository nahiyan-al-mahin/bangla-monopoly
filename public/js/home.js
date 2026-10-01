// public/js/home.js
// Home page (enter name, create/join a room) and the lobby.
// The server decides everything; this file only shows the state it sends
// and passes the player's clicks on as requests.

const socket = io();

// --- Page elements ---
const views = {
  connecting: document.getElementById('connectingView'),
  home: document.getElementById('homeView'),
  lobby: document.getElementById('lobbyView')
};

const homeForm = document.getElementById('homeForm');
const nameInput = document.getElementById('nameInput');
const codeInput = document.getElementById('codeInput');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const homeError = document.getElementById('homeError');

const roomCodeEl = document.getElementById('roomCode');
const copyCodeBtn = document.getElementById('copyCodeBtn');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const copyStatus = document.getElementById('copyStatus');
const playerCountEl = document.getElementById('playerCount');
const playerListEl = document.getElementById('playerList');
const pieceOptionsEl = document.getElementById('pieceOptions');
const colorOptionsEl = document.getElementById('colorOptions');
const lobbyError = document.getElementById('lobbyError');
const startBtn = document.getElementById('startBtn');
const startStatus = document.getElementById('startStatus');
const leaveBtn = document.getElementById('leaveBtn');

// --- Page state ---
let setup = null;        // tokens, colors and limits from /api/setup
let myPlayerId = null;   // my public player id in the current room
let roomState = null;    // latest room state from the server
let busy = false;        // true while waiting for create/join

// Load lobby options once. Everything else waits for this.
const setupReady = fetchSetup()
  .then((data) => {
    setup = data;
    // Input limits follow the server config.
    nameInput.maxLength = setup.nameMaxLength;
    codeInput.maxLength = setup.roomCodeLength;
  })
  .catch((err) => {
    console.error('Could not load setup:', err);
    showView('home');
    homeError.textContent = 'পেজ লোড করা যায়নি। পেজটি আবার চালু করুন।';
  });

// ---------- Views ----------

function showView(name) {
  Object.keys(views).forEach((key) => {
    views[key].hidden = key !== name;
  });
}

// ---------- Home page ----------

// Prefill the name and, if the link was ".../?join=ABCD", the room code.
nameInput.value = loadSavedName();
const joinParam = new URLSearchParams(location.search).get('join');
if (joinParam) codeInput.value = joinParam.toUpperCase();

// Keep the code input clean: uppercase, only allowed letters.
codeInput.addEventListener('input', () => {
  let value = codeInput.value.toUpperCase();
  if (setup) {
    value = Array.from(value).filter((ch) => setup.roomCodeLetters.includes(ch)).join('');
  }
  codeInput.value = value;
});

// Quick check in the browser (the server checks again).
function readName() {
  const name = nameInput.value.replace(/\s+/g, ' ').trim();
  const max = setup ? setup.nameMaxLength : 20;
  if (name.length === 0) return { error: 'আপনার নাম লিখুন।' };
  if (Array.from(name).length > max) return { error: `নাম সর্বোচ্চ ${max} অক্ষরের হতে পারে।` };
  return { name };
}

async function createRoom() {
  if (busy) return;
  homeError.textContent = '';
  const { name, error } = readName();
  if (error) {
    homeError.textContent = error;
    nameInput.focus();
    return;
  }
  setBusy(true);
  const response = await request(socket, 'room:create', { name });
  setBusy(false);
  if (!response.ok) {
    homeError.textContent = response.error;
    return;
  }
  saveName(name);
  enterRoom(response);
}

async function joinRoom() {
  if (busy) return;
  homeError.textContent = '';
  const { name, error } = readName();
  if (error) {
    homeError.textContent = error;
    nameInput.focus();
    return;
  }
  const code = codeInput.value.trim().toUpperCase();
  const codeLength = setup ? setup.roomCodeLength : 4;
  if (code.length !== codeLength) {
    homeError.textContent = `${codeLength} অক্ষরের রুম কোড দিন।`;
    codeInput.focus();
    return;
  }
  setBusy(true);
  const response = await request(socket, 'room:join', { code, name });
  setBusy(false);
  if (!response.ok) {
    homeError.textContent = response.error;
    return;
  }
  saveName(name);
  enterRoom(response);
}

function setBusy(value) {
  busy = value;
  createBtn.disabled = value;
  joinBtn.disabled = value;
}

createBtn.addEventListener('click', createRoom);

// Pressing Enter: join if a code is typed, otherwise create a room.
homeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (codeInput.value.trim() !== '') joinRoom();
  else createRoom();
});

// ---------- Entering a room ----------

// Called after a successful create, join or resume.
// response = { code, playerToken, playerId, state }
function enterRoom(response) {
  saveSession(response.code, response.playerToken);
  myPlayerId = response.playerId;
  // The ?join= link has done its job; remove it so a refresh stays clean.
  if (location.search) history.replaceState(null, '', location.pathname);
  showRoomState(response.state);
}

function showRoomState(state) {
  roomState = state;
  if (state.status === 'playing') {
    // Game started: everyone moves to the game page.
    location.href = 'game.html?room=' + encodeURIComponent(state.code);
    return;
  }
  renderLobby();
  showView('lobby');
}

// Every time we (re)connect: if we have a saved seat, ask to resume it.
socket.on('connect', async () => {
  await setupReady;
  if (!setup) return;

  const session = loadSession();
  if (!session) {
    showView('home');
    return;
  }

  const response = await request(socket, 'room:resume', session);
  if (response.ok) {
    enterRoom(response);
  } else {
    // The room is gone or we are no longer in it: back to the home page.
    clearSession();
    myPlayerId = null;
    roomState = null;
    showView('home');
    homeError.textContent = 'আগের রুমে ফেরা যায়নি: ' + response.error;
  }
});

// Lost connection: show the "connecting" card until we are back.
socket.on('disconnect', () => {
  showView('connecting');
});

// Live updates from the server (someone joined, picked a token, ...).
socket.on('room:state', (state) => {
  if (!roomState || state.code !== roomState.code) return;

  const stillInRoom = state.players.some((p) => p.id === myPlayerId);
  if (!stillInRoom) {
    clearSession();
    myPlayerId = null;
    roomState = null;
    showView('home');
    homeError.textContent = 'আপনাকে রুম থেকে সরিয়ে দেওয়া হয়েছে।';
    return;
  }
  showRoomState(state);
});

// ---------- Lobby ----------

function renderLobby() {
  const state = roomState;
  const me = state.players.find((p) => p.id === myPlayerId);
  const isHost = state.hostId === myPlayerId;

  roomCodeEl.textContent = state.code;
  playerCountEl.textContent = `(${state.players.length}/${setup.maxPlayers})`;

  renderPlayerList(state);
  renderPieceOptions(state, me);
  renderColorOptions(state, me);

  // Start button: only the host sees it. The server sends canStart and,
  // if the game cannot start yet, the reason (startProblem).
  startBtn.hidden = !isHost;
  startBtn.disabled = !state.canStart;
  if (state.canStart) {
    startStatus.textContent = isHost
      ? 'সবাই প্রস্তুত! খেলা শুরু করুন।'
      : 'সবাই প্রস্তুত। হোস্টের খেলা শুরু করার অপেক্ষায়…';
  } else {
    startStatus.textContent = state.startProblem || '';
  }
}

function renderPlayerList(state) {
  playerListEl.innerHTML = '';
  state.players.forEach((player) => {
    const piece = findById(setup.pieces, player.piece);
    const color = findById(setup.colors, player.color);

    const li = document.createElement('li');
    if (player.id === myPlayerId) li.classList.add('me');
    if (!player.connected) li.classList.add('offline');

    let html =
      '<span class="player-piece">' + (piece ? piece.emoji : '❔') + '</span>' +
      '<span class="color-dot" style="background:' + (color ? color.hex : '#fff') + '"></span>' +
      '<span class="player-name">' + escapeHtml(player.name) + '</span>';
    if (player.id === state.hostId) html += '<span class="badge badge-host">হোস্ট</span>';
    if (player.id === myPlayerId) html += '<span class="badge badge-me">আপনি</span>';
    if (!player.connected) html += '<span class="badge badge-offline">সংযোগ বিচ্ছিন্ন</span>';

    li.innerHTML = html;
    playerListEl.appendChild(li);
  });
}

// Who (other than me) has chosen this piece/color? Returns the player or null.
function takenByOther(state, field, value) {
  return state.players.find((p) => p.id !== myPlayerId && p[field] === value) || null;
}

function renderPieceOptions(state, me) {
  pieceOptionsEl.innerHTML = '';
  setup.pieces.forEach((piece) => {
    const owner = takenByOther(state, 'piece', piece.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option';
    if (me && me.piece === piece.id) button.classList.add('selected');
    button.disabled = Boolean(owner);

    button.innerHTML =
      '<span class="option-emoji">' + piece.emoji + '</span>' +
      '<span>' + escapeHtml(piece.name) + '</span>' +
      (owner ? '<span class="option-taken">' + escapeHtml(owner.name) + '</span>' : '');

    button.addEventListener('click', () => sendLobbyChoice('lobby:choosePiece', { piece: piece.id }));
    pieceOptionsEl.appendChild(button);
  });
}

function renderColorOptions(state, me) {
  colorOptionsEl.innerHTML = '';
  setup.colors.forEach((color) => {
    const owner = takenByOther(state, 'color', color.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option';
    if (me && me.color === color.id) button.classList.add('selected');
    button.disabled = Boolean(owner);

    button.innerHTML =
      '<span class="color-swatch" style="background:' + color.hex + '"></span>' +
      '<span>' + escapeHtml(color.name) + '</span>' +
      (owner ? '<span class="option-taken">' + escapeHtml(owner.name) + '</span>' : '');

    button.addEventListener('click', () => sendLobbyChoice('lobby:chooseColor', { color: color.id }));
    colorOptionsEl.appendChild(button);
  });
}

// Send a lobby request with our identity (room code + playerToken).
async function sendLobbyChoice(eventName, extraData) {
  lobbyError.textContent = '';
  const session = loadSession();
  if (!session) return;
  const response = await request(socket, eventName, { ...session, ...extraData });
  if (!response.ok) lobbyError.textContent = response.error;
  // On success the server broadcasts room:state, which redraws the lobby.
}

startBtn.addEventListener('click', async () => {
  lobbyError.textContent = '';
  startBtn.disabled = true;
  const response = await request(socket, 'game:start', loadSession());
  if (!response.ok) {
    lobbyError.textContent = response.error;
    renderLobby(); // restores the button state
  }
  // On success, room:state arrives with status "playing" and we move to game.html.
});

leaveBtn.addEventListener('click', async () => {
  lobbyError.textContent = '';
  const response = await request(socket, 'lobby:leave', loadSession());
  if (!response.ok) {
    lobbyError.textContent = response.error;
    return;
  }
  clearSession();
  myPlayerId = null;
  roomState = null;
  homeError.textContent = '';
  showView('home');
});

// ---------- Copy code / link ----------

copyCodeBtn.addEventListener('click', () => {
  copyText(roomState.code, 'রুম কোড কপি হয়েছে।');
});

copyLinkBtn.addEventListener('click', () => {
  const link = location.origin + '/?join=' + encodeURIComponent(roomState.code);
  copyText(link, 'লিংক কপি হয়েছে। বন্ধুদের পাঠিয়ে দিন!');
});

async function copyText(text, successMessage) {
  try {
    // Modern way (needs https or localhost)
    await navigator.clipboard.writeText(text);
    copyStatus.textContent = successMessage;
  } catch (err) {
    // Fallback for plain http (e.g. testing on a phone via your PC's IP address)
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    copyStatus.textContent = copied ? successMessage : 'কপি করা যায়নি। কোডটি নিজে লিখে নিন: ' + text;
  }
}
