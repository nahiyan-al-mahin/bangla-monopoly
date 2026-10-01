// game/config.js
// Central place for game settings and rule defaults.
// Values here come from SPEC.md and the "Decided defaults" section of CLAUDE.md.
// Board data (property names, prices, rents, house costs) lives in data/board.js.

const config = {
  // --- Money ---
  startingMoney: 1500, // SPEC §4
  goSalary: 200,
  jailFine: 50,

  // --- Rent rules that are NOT scaled (CLAUDE.md default #2) ---
  railroadRent: [25, 50, 100, 200], // rent when the owner has 1, 2, 3, 4 railroads
  utilityMultipliers: [4, 10],      // dice total x4 with one utility, x10 with both

  // --- Mortgage (SPEC §7) ---
  mortgageRatio: 0.5,          // mortgage value = half of the price
  unmortgageInterestRate: 0.1, // unmortgage cost = mortgage value + 10%,
                               // rounded UP to a whole taka (e.g. ৳35 -> ৳39)

  // --- Buildings (SPEC §8) ---
  bankHouses: 32,
  bankHotels: 12,

  // --- Turns / dice ---
  // The current player has this long to roll; then the server rolls for them.
  ROLL_TIMEOUT_SECONDS: 30,
  // Pause after a piece finishes moving, so everyone sees where it landed,
  // before the turn passes on (or the extra roll after doubles starts).
  TURN_END_DELAY_MS: 1500,
  // Piece animation speed. The server needs it too: it waits for the walk
  // to finish (path length x moveStepMs, + moveJumpPauseMs for a jump to
  // jail) before starting TURN_END_DELAY_MS. Sent to clients via /api/setup.
  moveStepMs: 180,
  moveJumpPauseMs: 540,
  maxDoublesBeforeJail: 3, // 3 doubles in a row -> straight to jail
  logLimit: 50,            // event log keeps the latest 50 entries
  // Testing helper: start the server with DEBUG_DICE=1 to let the current
  // player choose the dice values. Without it, client dice are ignored.
  debugDice: process.env.DEBUG_DICE === '1',

  // --- Cards (ভাগ্য / সমাজকল্যাণ) ---
  // How long the drawn card is shown to everyone before its effect happens.
  CARD_SHOW_MS: 3500,

  // --- Jail ---
  maxJailTurns: 3, // on the 3rd failed doubles attempt: pay fine and move

  // --- Bankruptcy ---
  mortgageInterestRate: 0.1, // 10% paid when receiving a mortgaged property

  // --- Buying / auction (house rule C, see CLAUDE.md) ---
  // Time to decide "buy or not" after landing on an unowned square.
  // Not buying (or timeout): the square stays with the bank. No auction.
  BUY_DECISION_SECONDS: 20,
  // Landing on your own square: time to choose "auction it" or "keep it".
  // Timeout = keep.
  OWNER_AUCTION_DECISION_SECONDS: 10,
  // Owner auction minimum first bid = this x list price, rounded up to ৳10.
  OWNER_AUCTION_MIN_RATIO: 0.5,
  // Auction countdown. Starts when the auction opens and restarts after
  // every valid bid. When it runs out, the highest bidder wins.
  AUCTION_SECONDS: 10,
  auction: {
    startingBid: 10,              // minimum first bid for BANK auctions (Step 9)
    bidIncrements: [10, 50, 100]  // buttons: current highest bid + these
  },

  // --- Players / rooms ---
  minPlayers: 2,
  maxPlayers: 4, // SPEC §3: 2-4 players per room
  nameMaxLength: 20, // player names: 1-20 characters after trimming
  // Player colors (CLAUDE.md default #7). id is used in code, name/hex for display.
  playerColors: [
    { id: 'red',    name: 'লাল',    hex: '#e03131' },
    { id: 'green',  name: 'সবুজ',   hex: '#2f9e44' },
    { id: 'blue',   name: 'নীল',    hex: '#1971c2' },
    { id: 'yellow', name: 'হলুদ',   hex: '#f2c200' },
    { id: 'purple', name: 'বেগুনি', hex: '#7048e8' },
    { id: 'orange', name: 'কমলা',   hex: '#f76707' }
  ],
  roomCodeLength: 4,
  roomCodeLetters: 'ABCDEFGHJKLMNPQRSTUVWXYZ', // A-Z without I and O

  // --- Disconnects / cleanup (milliseconds) ---
  // In the LOBBY, a disconnected player keeps their seat for this long
  // (so a page refresh does not kick them out). After that they are removed,
  // and if they were the host, the next player in seat order becomes host.
  lobbyDisconnectGraceMs: 15 * 1000,
  disconnectSkipAfterMs: 60 * 1000,         // host may skip turn after 60s
  disconnectBankruptAfterMs: 3 * 60 * 1000, // host may bankrupt after 3 min
  emptyRoomDeleteAfterMs: 10 * 60 * 1000    // empty room removed after 10 min
};

module.exports = config;
