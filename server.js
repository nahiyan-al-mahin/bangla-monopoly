// server.js
// Entry point: Express serves the static frontend from /public,
// Socket.IO handles real-time communication with players.
// Room rules live in game/rooms.js; this file only wires sockets to them.

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const config = require('./game/config');
const rooms = require('./game/rooms');
const engine = require('./game/engine');
const { GameError } = require('./game/errors');
const { GROUPS, SQUARES } = require('./data/board');
const { PIECES } = require('./data/pieces');
const { CHANCE, COMMUNITY } = require('./data/cards');

// Render (and most hosts) give us the port in an environment variable.
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve everything in /public (html, css, js).
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint (used by Render to know the server is alive).
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});

// Board data for the browser. The board is defined once in data/board.js;
// the client fetches it from here instead of keeping its own copy.
app.get('/api/board', (req, res) => {
  res.json({
    groups: GROUPS,
    squares: SQUARES,
    rules: {
      goSalary: config.goSalary,
      jailFine: config.jailFine,
      railroadRent: config.railroadRent,
      utilityMultipliers: config.utilityMultipliers,
      mortgageRatio: config.mortgageRatio,
      unmortgageInterestRate: config.unmortgageInterestRate
    }
  });
});

// Lobby options for the browser: tokens, colors and limits.
app.get('/api/setup', (req, res) => {
  res.json({
    pieces: PIECES,
    colors: config.playerColors,
    minPlayers: config.minPlayers,
    maxPlayers: config.maxPlayers,
    nameMaxLength: config.nameMaxLength,
    roomCodeLength: config.roomCodeLength,
    roomCodeLetters: config.roomCodeLetters,
    debugDice: config.debugDice, // DEBUG_DICE=1: show the dice + next-card pickers
    // Card list for the DEBUG next-card picker (only sent in debug mode)
    debugCards: config.debugDice
      ? [...CHANCE.map((c) => ({ id: c.id, deck: 'chance', text: c.text })),
         ...COMMUNITY.map((c) => ({ id: c.id, deck: 'community', text: c.text }))]
      : [],
    rollTimeoutSeconds: config.ROLL_TIMEOUT_SECONDS,
    maxJailTurns: config.maxJailTurns,
    jailFine: config.jailFine,
    buyDecisionSeconds: config.BUY_DECISION_SECONDS,
    ownerAuctionDecisionSeconds: config.OWNER_AUCTION_DECISION_SECONDS,
    auctionSeconds: config.AUCTION_SECONDS,
    bidIncrements: config.auction.bidIncrements,
    moveStepMs: config.moveStepMs,          // piece animation speed
    moveJumpPauseMs: config.moveJumpPauseMs // pause before jumping to jail
  });
});

// ---------- Socket.IO ----------

// Send the latest room state to everyone in the room.
function broadcastRoom(room) {
  io.to(room.code).emit('room:state', rooms.publicState(room));
}

// Timers inside rooms.js (e.g. removing a disconnected lobby player) and
// engine.js (auto roll, passing the turn) call this so everyone sees the change.
rooms.setRoomChangedListener(broadcastRoom);
engine.setGameChangedListener(broadcastRoom);

// Register a socket event whose handler may throw a GameError.
// The client always gets an answer through the acknowledgement callback:
//   success: { ok: true, ...whatever the handler returned }
//   failure: { ok: false, error: 'Bangla message' }
function handle(socket, eventName, handler) {
  socket.on(eventName, (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const request = data && typeof data === 'object' ? data : {};
    try {
      const result = handler(request) || {};
      reply({ ok: true, ...result });
    } catch (err) {
      if (err instanceof GameError) {
        reply({ ok: false, error: err.message });
      } else {
        console.error(`Error in "${eventName}":`, err);
        reply({ ok: false, error: 'সার্ভারে একটি সমস্যা হয়েছে। আবার চেষ্টা করুন।' });
      }
    }
  });
}

io.on('connection', (socket) => {
  // Link this socket to a player: join the Socket.IO room for broadcasts
  // and remember who it is (only used to notice the disconnect).
  function attach(room, player) {
    if (socket.data.code && socket.data.code !== room.code) {
      socket.leave(socket.data.code);
    }
    socket.join(room.code);
    socket.data.code = room.code;
    socket.data.playerToken = player.token;
    rooms.connectPlayer(room, player, socket.id);
  }

  // What create/join/resume send back to the player.
  function sessionReply(room, player) {
    return {
      code: room.code,
      playerToken: player.token,
      playerId: player.id,
      state: rooms.publicState(room)
    };
  }

  // Every request after create/join carries { code, playerToken }.
  // The player is found by that token, never by socket id.
  function findPlayer(request) {
    return rooms.getRoomAndPlayer(request.code, request.playerToken);
  }

  // --- Create / join / resume ---

  handle(socket, 'room:create', (request) => {
    const { room, player } = rooms.createRoom(request.name);
    attach(room, player);
    broadcastRoom(room);
    return sessionReply(room, player);
  });

  handle(socket, 'room:join', (request) => {
    const { room, player } = rooms.joinRoom(request.code, request.name);
    attach(room, player);
    broadcastRoom(room);
    return sessionReply(room, player);
  });

  // Page loaded or refreshed: "I already have a seat, here is my token".
  handle(socket, 'room:resume', (request) => {
    const { room, player } = findPlayer(request);
    attach(room, player);
    broadcastRoom(room);
    return sessionReply(room, player);
  });

  // --- Lobby ---

  handle(socket, 'lobby:choosePiece', (request) => {
    const { room, player } = findPlayer(request);
    rooms.choosePiece(room, player, request.piece);
    broadcastRoom(room);
  });

  handle(socket, 'lobby:chooseColor', (request) => {
    const { room, player } = findPlayer(request);
    rooms.chooseColor(room, player, request.color);
    broadcastRoom(room);
  });

  handle(socket, 'lobby:leave', (request) => {
    const { room, player } = findPlayer(request);
    rooms.leaveRoom(room, player);
    socket.leave(room.code);
    socket.data.code = null;
    socket.data.playerToken = null;
    broadcastRoom(room);
  });

  handle(socket, 'game:start', (request) => {
    const { room, player } = findPlayer(request);
    rooms.startGame(room, player);
    broadcastRoom(room); // status "playing" -> clients open game.html
  });

  // --- Game (turn checks happen in game/engine.js) ---

  handle(socket, 'game:roll', (request) => {
    const { room, player } = findPlayer(request);
    // request.dice is only looked at when DEBUG_DICE=1 (see engine.rollDice)
    engine.rollDice(room, player, request.dice);
    broadcastRoom(room);
  });

  // Jail: leave before rolling ("জোড়া পড়ার চেষ্টা" is just game:roll)
  handle(socket, 'jail:pay', (request) => {
    const { room, player } = findPlayer(request);
    engine.payJailFine(room, player);
    broadcastRoom(room);
  });

  handle(socket, 'jail:useCard', (request) => {
    const { room, player } = findPlayer(request);
    engine.useJailFreeCard(room, player);
    broadcastRoom(room);
  });

  // DEBUG_DICE=1 only (the engine refuses it otherwise): choose the next card
  handle(socket, 'debug:nextCard', (request) => {
    const { room, player } = findPlayer(request);
    engine.debugSetNextCard(room, player, request.cardId);
    broadcastRoom(room);
  });

  // --- Buildings and mortgage (any player, any time except during an auction) ---
  // request.index = the square index of the player's property
  const propertyActions = {
    'property:buildHouse': engine.buildHouse,
    'property:sellHouse': engine.sellHouse,
    'property:buildHotel': engine.buildHotel,
    'property:sellHotel': engine.sellHotel,
    'property:mortgage': engine.mortgageProperty,
    'property:unmortgage': engine.unmortgageProperty
  };
  Object.keys(propertyActions).forEach((eventName) => {
    handle(socket, eventName, (request) => {
      const { room, player } = findPlayer(request);
      propertyActions[eventName](room, player, request.index);
      broadcastRoom(room);
    });
  });

  // There is no "end turn" request: the server passes the turn on
  // automatically after each move (see game/engine.js).

  // Buy decision (only the current player, only in phase 'buy')
  handle(socket, 'game:buy', (request) => {
    const { room, player } = findPlayer(request);
    engine.buyProperty(room, player);
    broadcastRoom(room);
  });

  handle(socket, 'game:decline', (request) => {
    const { room, player } = findPlayer(request);
    engine.declineProperty(room, player);
    broadcastRoom(room);
  });

  // Owner auction decision (house rule C): the current player landed on
  // their own square and may put it up for auction or keep it.
  handle(socket, 'game:ownerAuction', (request) => {
    const { room, player } = findPlayer(request);
    engine.startOwnerAuction(room, player);
    broadcastRoom(room);
  });

  handle(socket, 'game:ownerKeep', (request) => {
    const { room, player } = findPlayer(request);
    engine.keepProperty(room, player);
    broadcastRoom(room);
  });

  // Auction (any player except the seller who has not passed)
  handle(socket, 'auction:bid', (request) => {
    const { room, player } = findPlayer(request);
    engine.placeBid(room, player, request.amount);
    broadcastRoom(room);
  });

  handle(socket, 'auction:pass', (request) => {
    const { room, player } = findPlayer(request);
    engine.passAuction(room, player);
    broadcastRoom(room);
  });

  // --- Disconnect ---

  socket.on('disconnect', () => {
    if (!socket.data.code) return;
    const room = rooms.disconnectSocket(socket.data.code, socket.data.playerToken, socket.id);
    if (room) broadcastRoom(room);
  });
});

server.listen(PORT, () => {
  console.log(`Bangla Monopoly server running at http://localhost:${PORT}`);
  if (config.debugDice) {
    console.log('DEBUG_DICE is ON: players can choose dice values. Do not use in a real game.');
  }
});
