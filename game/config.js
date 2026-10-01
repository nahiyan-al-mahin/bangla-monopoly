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

  // --- Jail ---
  maxJailTurns: 3, // on the 3rd failed doubles attempt: pay fine and move

  // --- Bankruptcy ---
  mortgageInterestRate: 0.1, // 10% paid when receiving a mortgaged property

  // --- Auction ---
  auction: {
    startingBid: 10,
    bidIncrements: [10, 50, 100],
    countdownSeconds: 10 // resets after every bid
  },

  // --- Players / rooms ---
  minPlayers: 2,
  maxPlayers: 4, // SPEC §3: 2-4 players per room
  playerColors: ['red', 'green', 'blue', 'yellow', 'purple', 'orange'],
  roomCodeLength: 4,
  roomCodeLetters: 'ABCDEFGHJKLMNPQRSTUVWXYZ', // A-Z without I and O

  // --- Disconnects / cleanup (milliseconds) ---
  disconnectSkipAfterMs: 60 * 1000,         // host may skip turn after 60s
  disconnectBankruptAfterMs: 3 * 60 * 1000, // host may bankrupt after 3 min
  emptyRoomDeleteAfterMs: 10 * 60 * 1000    // empty room removed after 10 min
};

module.exports = config;
