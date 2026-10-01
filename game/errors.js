// game/errors.js
// A GameError is an expected, player-caused problem (wrong room code,
// not your turn, ...). Its message is Bangla text shown to the player.
// server.js catches GameErrors and sends the message back; any other
// error is a real bug and is logged on the server.

class GameError extends Error {}

function fail(message) {
  throw new GameError(message);
}

module.exports = { GameError, fail };
