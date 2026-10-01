// scripts/check-board.js
// Sanity check for data/board.js. Run with:  npm run check
//
// For every property, rent must strictly increase:
//   base < full set < 1 house < 2 houses < 3 houses < 4 houses < hotel
// The script prints the rent table and exits with code 1 if any check fails.

const { GROUPS, SQUARES } = require('../data/board');

// Rent steps in the order they must increase.
const STEPS = ['base', 'set', 'h1', 'h2', 'h3', 'h4', 'hotel'];

const errors = [];

SQUARES.forEach((square, i) => {
  // Squares must be listed in order 0-39.
  if (square.index !== i) {
    errors.push(`Square at position ${i} has index ${square.index}`);
  }

  if (square.type !== 'property') return;

  if (!GROUPS[square.group]) {
    errors.push(`${square.name}: unknown group "${square.group}"`);
  }

  // Every rent step must exist and be bigger than the one before it.
  for (let s = 0; s < STEPS.length; s++) {
    const value = square.rent[STEPS[s]];
    if (typeof value !== 'number' || value <= 0) {
      errors.push(`${square.name}: rent.${STEPS[s]} is missing or not positive`);
      continue;
    }
    if (s > 0) {
      const previous = square.rent[STEPS[s - 1]];
      if (!(value > previous)) {
        errors.push(`${square.name}: rent.${STEPS[s]} (${value}) must be greater than rent.${STEPS[s - 1]} (${previous})`);
      }
    }
  }

  // Print one row of the table.
  console.log(
    String(square.index).padStart(2) + '  ' +
    square.name.padEnd(12) + ' ৳' + String(square.price).padEnd(4) + ' | ' +
    STEPS.map((step) => String(square.rent[step]).padStart(5)).join(' ')
  );
});

if (SQUARES.length !== 40) {
  errors.push(`Board must have 40 squares, found ${SQUARES.length}`);
}

if (errors.length > 0) {
  console.error('\nBoard check FAILED:');
  errors.forEach((e) => console.error('  - ' + e));
  process.exit(1);
}

console.log('\nBoard check passed: all rents increase from base to hotel.');
