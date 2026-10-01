// public/js/common.js
// Small helpers shared by the home/lobby page and the game page.

// ---------- Session (who am I?) ----------
// After creating or joining a room, the server gives us a secret playerToken.
// We keep it in localStorage together with the room code, so a refresh
// (or opening game.html) can tell the server "this is me again".

const SESSION_KEY = 'bm.session';
const NAME_KEY = 'bm.name';

// Returns { code, playerToken } or null.
function loadSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (session && typeof session.code === 'string' && typeof session.playerToken === 'string') {
      return session;
    }
  } catch (err) {
    // Storage blocked or broken JSON: behave as if there is no session.
  }
  return null;
}

function saveSession(code, playerToken) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ code, playerToken }));
  } catch (err) {
    console.warn('Could not save session:', err);
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (err) {
    // nothing to do
  }
}

// Remember the last used name so the player does not retype it.
function loadSavedName() {
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch (err) {
    return '';
  }
}

function saveName(name) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch (err) {
    // not important
  }
}

// ---------- Talking to the server ----------

// Send a request and wait for the server's answer.
// Always resolves with { ok: true, ... } or { ok: false, error: '...' }.
function request(socket, eventName, data) {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(eventName, data, (err, response) => {
      if (err) {
        resolve({ ok: false, error: 'সার্ভারের সাড়া পাওয়া যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।' });
      } else {
        resolve(response);
      }
    });
  });
}

// Lobby options (tokens, colors, limits) from the server.
async function fetchSetup() {
  const response = await fetch('/api/setup');
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}

// ---------- Formatting ----------

// Format money: 1500 -> "৳1500" (English digits by default, SPEC §9)
function money(amount) {
  return '৳' + amount;
}

// Escape text before putting it inside HTML (player names come from users!).
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Find an item by id in a list like setup.pieces or setup.colors.
function findById(list, id) {
  return list.find((item) => item.id === id) || null;
}
