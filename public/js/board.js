// public/js/board.js
// Draws the board from /api/board, shows a detail card when a square is
// clicked, and draws the players' pieces on their squares.
// Needs js/common.js (money, escapeHtml). No game logic here.
//
// Use from a page script:
//   await loadBoard();              // fetch data and draw the 40 squares
//   renderPieces(players, setup);   // put each player's piece on its square

const boardEl = document.getElementById('board');
const detailDialog = document.getElementById('detailDialog');
const detailContent = document.getElementById('detailContent');
const detailClose = document.getElementById('detailClose');

// Filled in after loading /api/board
let GROUPS = {};
let SQUARES = [];
let RULES = {};

// Who owns each square, for the detail card. Filled by renderOwnership():
//   OWNERS[squareIndex] = { name, colorHex, mortgaged }
let OWNERS = {};

// Group colors that need white text on top of them (the rest use black text).
const DARK_GROUPS = ['brown', 'pink', 'red', 'green', 'darkblue'];

// ---------- Small helpers ----------

// Mortgage value = price x mortgageRatio (half price).
function mortgageValue(square) {
  return Math.round(square.price * RULES.mortgageRatio);
}

// Unmortgage cost = mortgage value + 10%, rounded up to a whole taka.
function unmortgageCost(square) {
  return Math.ceil(mortgageValue(square) * (1 + RULES.unmortgageInterestRate));
}

// ---------- Board layout ----------

// Work out where square "index" (0-39) sits in the 11x11 grid.
// Index 0 (শুরু) is the bottom-right corner, and play moves clockwise:
//   0-10  bottom row, right to left
//   10-20 left column, bottom to top
//   20-30 top row, left to right
//   30-39 right column, top to bottom
function gridPosition(index) {
  if (index <= 10) return { row: 11, col: 11 - index, side: 'bottom' };
  if (index <= 20) return { row: 21 - index, col: 1, side: 'left' };
  if (index <= 30) return { row: 1, col: index - 19, side: 'top' };
  return { row: index - 29, col: 11, side: 'right' };
}

function isCorner(index) {
  return index % 10 === 0;
}

// Text shown at the bottom of a square (price, or tax amount).
function squarePriceText(square) {
  if (square.type === 'tax') return money(square.amount) + ' দিন';
  if (square.price) return money(square.price);
  return '';
}

// Build one square element.
function createSquareElement(square) {
  const pos = gridPosition(square.index);
  const el = document.createElement('div');

  el.className = 'square side-' + pos.side;
  if (isCorner(square.index)) el.classList.add('corner');
  el.style.gridRow = pos.row;
  el.style.gridColumn = pos.col;
  el.dataset.index = square.index;

  // Make squares keyboard-accessible (Tab + Enter opens the detail card).
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', square.name);

  // Colored strip, only for properties
  if (square.type === 'property') {
    const strip = document.createElement('div');
    strip.className = 'strip';
    strip.style.background = GROUPS[square.group].color;
    el.appendChild(strip);
  }

  // Name, optional sub-name/icon, price
  const body = document.createElement('div');
  body.className = 'square-body';

  let html = '<span class="square-name">' + escapeHtml(square.name) + '</span>';
  if (square.subName) {
    html += '<span class="square-sub">' + escapeHtml(square.subName) + '</span>';
  }
  if (square.icon) {
    html += '<span class="square-icon">' + square.icon + '</span>';
  }
  const priceText = squarePriceText(square);
  if (priceText) {
    html += '<span class="square-price">' + escapeHtml(priceText) + '</span>';
  }
  body.innerHTML = html;
  el.appendChild(body);

  // Players' pieces standing on this square are drawn in here.
  const pieces = document.createElement('div');
  pieces.className = 'square-pieces';
  el.appendChild(pieces);

  return el;
}

function renderBoard() {
  SQUARES.forEach((square) => {
    boardEl.appendChild(createSquareElement(square));
  });
}

// Show owners on the board: an inset border + corner marker in the owner's
// color. Mortgaged squares get the "mortgaged" class (dimmed, Step 7).
// properties = state.game.properties, setup = { colors } from /api/setup.
function renderOwnership(properties, players, setup) {
  OWNERS = {};
  boardEl.querySelectorAll('.square').forEach((squareEl) => {
    const index = Number(squareEl.dataset.index);
    const owned = properties[index];
    const owner = owned ? players.find((p) => p.id === owned.ownerId) : null;
    const color = owner ? findById(setup.colors, owner.color) : null;

    squareEl.classList.toggle('owned', Boolean(owner));
    squareEl.classList.toggle('mortgaged', Boolean(owned && owned.mortgaged));
    if (owner) {
      squareEl.style.setProperty('--owner-color', color ? color.hex : '#333');
      OWNERS[index] = { name: owner.name, colorHex: color ? color.hex : '#333', mortgaged: owned.mortgaged };
    } else {
      squareEl.style.removeProperty('--owner-color');
    }
  });
}

// "ব্যাংক" or the owner's name (+ mortgaged note) for the detail card.
function ownerText(index) {
  const owner = OWNERS[index];
  if (!owner) return 'ব্যাংক';
  return '<span class="owner-dot" style="background:' + owner.colorHex + '"></span>' +
    escapeHtml(owner.name) + (owner.mortgaged ? ' (বন্ধক রাখা)' : '');
}

// Draw every player's piece on the square at player.position.
// setup = { pieces, colors } from /api/setup.
function renderPieces(players, setup) {
  boardEl.querySelectorAll('.square-pieces').forEach((el) => {
    el.innerHTML = '';
  });

  players.forEach((player) => {
    const piece = findById(setup.pieces, player.piece);
    const color = findById(setup.colors, player.color);
    const squareEl = boardEl.querySelector('.square[data-index="' + player.position + '"]');
    if (!piece || !squareEl) return;

    const marker = document.createElement('span');
    marker.className = 'piece-marker';
    marker.textContent = piece.emoji;
    marker.title = player.name;
    if (color) marker.style.borderColor = color.hex;
    squareEl.querySelector('.square-pieces').appendChild(marker);
  });
}

// ---------- Detail card ----------

// One row of a rent table: label on the left, amount on the right.
function row(label, value) {
  return '<tr><td>' + escapeHtml(label) + '</td><td>' + escapeHtml(value) + '</td></tr>';
}

function propertyDetailHtml(square) {
  const group = GROUPS[square.group];
  const rent = square.rent;
  const headerClass = DARK_GROUPS.includes(square.group) ? 'detail-header dark-bg' : 'detail-header';

  return (
    '<div class="' + headerClass + '" style="background:' + group.color + '">' +
      '<span class="detail-group">' + escapeHtml(group.name) + ' রঙ</span>' +
      '<h2>' + escapeHtml(square.name) + '</h2>' +
    '</div>' +
    '<div class="detail-body">' +
      '<p>দাম: <strong>' + money(square.price) + '</strong></p>' +
      '<table class="rent-table">' +
        row('ভাড়া', money(rent.base)) +
        row('পুরো রঙের সেট (বাড়ি ছাড়া)', money(rent.set)) +
        row('1টি বাড়িসহ', money(rent.h1)) +
        row('2টি বাড়িসহ', money(rent.h2)) +
        row('3টি বাড়িসহ', money(rent.h3)) +
        row('4টি বাড়িসহ', money(rent.h4)) +
        row('হোটেলসহ', money(rent.hotel)) +
      '</table>' +
      '<table class="rent-table">' +
        row('প্রতিটি বাড়ির দাম', money(group.houseCost)) +
        row('হোটেলের দাম', '4টি বাড়ি + ' + money(group.houseCost)) +
        row('বন্ধকী মূল্য', money(mortgageValue(square))) +
        row('বন্ধক ছাড়াতে', money(unmortgageCost(square))) +
      '</table>' +
      '<p>মালিক: ' + ownerText(square.index) + '</p>' +
      '<div class="detail-note">📍 বিখ্যাত: ' + escapeHtml(square.note) + '</div>' +
    '</div>'
  );
}

function railroadDetailHtml(square) {
  const r = RULES.railroadRent;
  return (
    '<div class="detail-header">' +
      '<span class="detail-icon">' + square.icon + '</span>' +
      '<h2>' + escapeHtml(square.name) + '</h2>' +
    '</div>' +
    '<div class="detail-body">' +
      '<p>দাম: <strong>' + money(square.price) + '</strong></p>' +
      '<table class="rent-table">' +
        row('1টি রেলস্টেশন থাকলে', money(r[0])) +
        row('2টি রেলস্টেশন থাকলে', money(r[1])) +
        row('3টি রেলস্টেশন থাকলে', money(r[2])) +
        row('4টি রেলস্টেশন থাকলে', money(r[3])) +
        row('বন্ধকী মূল্য', money(mortgageValue(square))) +
        row('বন্ধক ছাড়াতে', money(unmortgageCost(square))) +
      '</table>' +
      '<p>মালিক: ' + ownerText(square.index) + '</p>' +
    '</div>'
  );
}

function utilityDetailHtml(square) {
  const m = RULES.utilityMultipliers;
  return (
    '<div class="detail-header">' +
      '<span class="detail-icon">' + square.icon + '</span>' +
      '<h2>' + escapeHtml(square.name) + '</h2>' +
    '</div>' +
    '<div class="detail-body">' +
      '<p>দাম: <strong>' + money(square.price) + '</strong></p>' +
      '<table class="rent-table">' +
        row('1টি ইউটিলিটি থাকলে', 'পাশার যোগফল × ' + m[0]) +
        row('2টি ইউটিলিটি থাকলে', 'পাশার যোগফল × ' + m[1]) +
        row('বন্ধকী মূল্য', money(mortgageValue(square))) +
        row('বন্ধক ছাড়াতে', money(unmortgageCost(square))) +
      '</table>' +
      '<p>মালিক: ' + ownerText(square.index) + '</p>' +
    '</div>'
  );
}

// Short Bangla description for every non-buyable square type.
function specialDescription(square) {
  switch (square.type) {
    case 'go':
      return 'এই ঘর পার হলে বা এখানে থামলে ' + money(RULES.goSalary) + ' পাবেন।';
    case 'tax':
      return 'এখানে থামলে ব্যাংককে ' + money(square.amount) + ' দিতে হবে।';
    case 'chance':
      return 'এখানে থামলে একটি ভাগ্য কার্ড তুলুন।';
    case 'community':
      return 'এখানে থামলে একটি সমাজকল্যাণ কার্ড তুলুন।';
    case 'jail':
      return 'হাজতখানা থেকে বের হতে ' + money(RULES.jailFine) +
        ' জরিমানা দিন, জামিন কার্ড ব্যবহার করুন, অথবা জোড়া ফেলুন। শুধু থামলে আপনি "শুধু দেখতে আসা" — কোনো জরিমানা নেই।';
    case 'free_parking':
      return 'বিশ্রামের জায়গা। এখানে কিছুই ঘটে না — এক কাপ চা খান! ☕';
    case 'go_to_jail':
      return 'সরাসরি হাজতখানায় যান। শুরু পার হলেও টাকা পাবেন না।';
    default:
      return '';
  }
}

function specialDetailHtml(square) {
  const title = square.subName ? square.name + ' / ' + square.subName : square.name;
  return (
    '<div class="detail-header">' +
      '<span class="detail-icon">' + (square.icon || '') + '</span>' +
      '<h2>' + escapeHtml(title) + '</h2>' +
    '</div>' +
    '<div class="detail-body">' +
      '<p>' + escapeHtml(specialDescription(square)) + '</p>' +
    '</div>'
  );
}

function showDetail(index) {
  const square = SQUARES[index];
  let html;
  if (square.type === 'property') html = propertyDetailHtml(square);
  else if (square.type === 'railroad') html = railroadDetailHtml(square);
  else if (square.type === 'utility') html = utilityDetailHtml(square);
  else html = specialDetailHtml(square);

  detailContent.innerHTML = html;
  detailDialog.showModal();
}

// ---------- Events ----------

// One click listener on the whole board (event delegation).
boardEl.addEventListener('click', (event) => {
  const squareEl = event.target.closest('.square');
  if (squareEl) showDetail(Number(squareEl.dataset.index));
});

// Enter or Space on a focused square also opens it.
boardEl.addEventListener('keydown', (event) => {
  const squareEl = event.target.closest('.square');
  if (squareEl && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    showDetail(Number(squareEl.dataset.index));
  }
});

detailClose.addEventListener('click', () => detailDialog.close());

// Clicking the dark backdrop (outside the card) closes it too.
detailDialog.addEventListener('click', (event) => {
  if (event.target === detailDialog) detailDialog.close();
});

// ---------- Loading ----------

// Fetch the board data and draw it. Throws if the data cannot be loaded,
// so the page script can show an error message.
async function loadBoard() {
  const response = await fetch('/api/board');
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const data = await response.json();
  GROUPS = data.groups;
  SQUARES = data.squares;
  RULES = data.rules;
  renderBoard();
}
