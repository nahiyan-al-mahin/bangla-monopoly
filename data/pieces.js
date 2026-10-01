// data/pieces.js
// Player tokens (game pieces) from SPEC §4. Each player picks one in the lobby.
// "emoji" is what is shown on screen; swap it for an image later if you like.
//   - হাতপাখা uses 🪭 (folding fan, Emoji 15, 2022). Very old phones may show a box.
//   - There is no lungi emoji, so লুঙ্গি uses 🩳 as a stand-in.

const PIECES = [
  { id: 'rickshaw', name: 'রিকশা',     emoji: '🛺' },
  { id: 'boat',     name: 'নৌকা',      emoji: '⛵' },
  { id: 'hilsa',    name: 'ইলিশ মাছ',  emoji: '🐟' },
  { id: 'fan',      name: 'হাতপাখা',   emoji: '🪭' },
  { id: 'lungi',    name: 'লুঙ্গি',     emoji: '🩳' },
  { id: 'panta',    name: 'পান্তা ভাত', emoji: '🍚' }
];

module.exports = { PIECES };
