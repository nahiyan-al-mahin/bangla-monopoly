// data/pieces.js
// Player tokens (game pieces) from SPEC §4. Each player picks one in the lobby.
// "iconKey" is the name of a small SVG line icon in public/js/icons.js.
// On the board a token is drawn as a circle in the player's color with
// this icon in white.

const PIECES = [
  { id: 'rickshaw', name: 'রিকশা',     iconKey: 'rickshaw' },
  { id: 'boat',     name: 'নৌকা',      iconKey: 'boat' },
  { id: 'hilsa',    name: 'ইলিশ মাছ',  iconKey: 'fish' },
  { id: 'fan',      name: 'হাতপাখা',   iconKey: 'fan' },
  { id: 'lungi',    name: 'লুঙ্গি',     iconKey: 'lungi' },
  { id: 'panta',    name: 'পান্তা ভাত', iconKey: 'rice' }
];

module.exports = { PIECES };
