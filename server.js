// server.js
// Entry point: Express serves the static frontend from /public,
// Socket.IO handles real-time communication with players.

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const config = require('./game/config');
const { GROUPS, SQUARES } = require('./data/board');

// Render (and most hosts) give us the port in an environment variable.
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve everything in /public (index.html, css, js).
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

// --- Socket.IO ---
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  broadcastOnlineCount();

  // Ping round-trip test: the client sends its timestamp,
  // we immediately send it back through the acknowledgement callback.
  socket.on('latency:ping', (clientTime, ack) => {
    // Only reply if the client actually passed a callback function.
    if (typeof ack === 'function') {
      ack({ clientTime, serverTime: Date.now() });
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`Client disconnected: ${socket.id} (${reason})`);
    broadcastOnlineCount();
  });
});

// Tell every connected client how many clients are online.
function broadcastOnlineCount() {
  io.emit('online:count', io.engine.clientsCount);
}

server.listen(PORT, () => {
  console.log(`Bangla Monopoly server running at http://localhost:${PORT}`);
});
