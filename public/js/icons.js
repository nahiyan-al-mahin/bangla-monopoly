// public/js/icons.js
// Small single-color line icons as inline SVG (no image files).
// All icons use a 24x24 grid and "currentColor", so CSS decides the color.
//
// Used by:
//   - board squares: railroads, the two utilities, ভাগ্য, সমাজকল্যাণ and
//     the শুরু arrow (data/board.js "iconKey")
//   - player tokens: a circle in the player's color with the token icon
//     (data/pieces.js "iconKey")

// Inner SVG shapes for each icon key.
const ICON_SHAPES = {
  // --- Board squares ---
  train:
    '<rect x="5" y="3" width="14" height="13" rx="3"/>' +
    '<path d="M5 10h14"/><path d="M9 13h.01M15 13h.01"/>' +
    '<path d="M8 16l-2 5M16 16l2 5"/>',
  flame: // তিতাস গ্যাস
    '<path d="M12 3c.5 3 4.5 5 4.5 9.5a4.5 4.5 0 0 1-9 0c0-1.7.8-3 1.7-3.8.2 1.6 1 2.6 2.1 2.6 0-3.2-1.1-5.4.7-8.3z"/>',
  bolt: // রূপপুর বিদ্যুৎ
    '<path d="M13 2L5 13h6l-1 9 8-11h-6l1-9z"/>',
  chance: // ভাগ্য: question mark in a circle
    '<circle cx="12" cy="12" r="9"/>' +
    '<path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5v.7"/><path d="M12 17h.01"/>',
  community: // সমাজকল্যাণ: heart
    '<path d="M12 20s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 7.6 4.2 4.2 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z"/>',
  arrow: // শুরু: points left, the way players move from শুরু (bottom-right corner)
    '<path d="M20 12H5"/><path d="M11 6l-6 6 6 6"/>',

  // --- Player tokens ---
  rickshaw:
    '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/>' +
    '<path d="M6 17l4-6h4l4 6"/><path d="M3.5 11.5c.8-3.5 4-5 7.5-4.5v4"/><path d="M18 17l-1.5-8h2.5"/>',
  boat:
    '<path d="M3 15h18l-2.5 4.5h-13z"/><path d="M12 15V3"/><path d="M12 4l6 9h-6"/>',
  fish:
    '<path d="M2.5 12c2.5-3.5 6-5 9.5-5s6 2 7.5 5c-1.5 3-4 5-7.5 5s-7-1.5-9.5-5z"/>' +
    '<path d="M19.5 12l2.5-3.5v7z"/><path d="M7 11h.01"/>',
  fan: // হাতপাখা: round hand fan with a handle
    '<circle cx="12" cy="9" r="6.5"/><circle cx="12" cy="9" r="2"/><path d="M12 15.5V22"/>',
  lungi: // checked cloth
    '<path d="M6 3h12l1.5 18h-15z"/><path d="M5.3 9.5h13.4M5 15h14"/><path d="M12 3v18"/>',
  rice: // পান্তা ভাত: bowl with a rice mound
    '<path d="M3 12h18a9 8 0 0 1-18 0z"/><path d="M6.5 12a5.5 4 0 0 1 11 0"/>'
};

// Full <svg> markup for an icon key, or '' if there is no such icon.
function iconSvg(key, className) {
  const shapes = ICON_SHAPES[key];
  if (!shapes) return '';
  return '<svg class="icon' + (className ? ' ' + className : '') + '" viewBox="0 0 24 24"' +
    ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"' +
    ' stroke-linejoin="round" aria-hidden="true">' + shapes + '</svg>';
}

// Icon for a board square (railroads, utilities, ভাগ্য, সমাজকল্যাণ), or ''.
function squareIconSvg(square, className) {
  return square && square.iconKey ? iconSvg(square.iconKey, className) : '';
}

// Is this a light color (e.g. yellow)? Then the token icon is drawn dark
// instead of white so it stays visible.
function isLightColor(hex) {
  const value = parseInt(String(hex).replace('#', ''), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  // Perceived brightness (0-255)
  return (r * 299 + g * 587 + b * 114) / 1000 > 170;
}

// A player token: a solid circle in the player's color with the token icon.
// Without a token yet (lobby), it shows the first letter of the name.
//   piece: { iconKey } or null, colorHex: '#e03131' or null
function tokenHtml(piece, colorHex, name, className) {
  const color = colorHex || '#adb5bd'; // grey until a color is picked
  const classes = 'token' + (isLightColor(color) ? ' token-light' : '') + (className ? ' ' + className : '');
  const inner = piece && ICON_SHAPES[piece.iconKey]
    ? iconSvg(piece.iconKey)
    : '<span class="token-initial">' + escapeHtml(Array.from(name || '?')[0]) + '</span>';
  return '<span class="' + classes + '" style="--token-color:' + color + '">' + inner + '</span>';
}
