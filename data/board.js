// data/board.js
// All 40 board squares, color groups, prices and the full rent table.
// This is plain editable data: change a number here and the game uses it.
//
// HOW RENTS WERE CALCULATED (CLAUDE.md, decided default #1):
//   Each property's classic Monopoly rents x (new price / classic price),
//   then rounded: under ৳50 -> nearest ৳1, ৳50 and above -> nearest ৳5.
//   "set" = rent when the owner has the full color group and no houses
//   (classic rule: exactly double the rounded base rent, so it is not
//   rounded again, e.g. ৳26 -> ৳52).
//
// After editing rents, run:  npm run check
// It checks that base < set < 1 house < 2 < 3 < 4 houses < hotel.
//
// Railroad rent, utility multipliers, GO salary etc. are NOT here;
// they are in game/config.js because they are not scaled.

// --- Color groups ---
// houseCost: cost of one house. A hotel costs 4 houses + 1 more houseCost (SPEC §7).
const GROUPS = {
  brown:     { name: 'বাদামি',   color: '#8d5524', houseCost: 50,  size: 2 },
  lightblue: { name: 'আকাশি',   color: '#7cc8ee', houseCost: 50,  size: 3 },
  pink:      { name: 'গোলাপি',  color: '#d6338a', houseCost: 100, size: 3 },
  orange:    { name: 'কমলা',    color: '#f28c18', houseCost: 100, size: 3 },
  red:       { name: 'লাল',     color: '#e0262f', houseCost: 150, size: 3 },
  yellow:    { name: 'হলুদ',    color: '#f5d90a', houseCost: 150, size: 3 },
  green:     { name: 'সবুজ',    color: '#1d9e54', houseCost: 200, size: 3 },
  darkblue:  { name: 'গাঢ় নীল', color: '#1f4fa8', houseCost: 200, size: 2 }
};

// --- Squares, index 0-39, clockwise from শুরু (GO) ---
// Property fields:
//   name   : district name printed on the board
//   group  : key in GROUPS above
//   price  : purchase price (৳)
//   rent   : { base, set, h1, h2, h3, h4, hotel }
//   note   : famous places (shown only in the detail card)
//   classic: the classic Monopoly square it replaces (reference for the rent formula)
// "iconKey" is display-only: the name of a small SVG line icon in
// public/js/icons.js (railroads, utilities, ভাগ্য, সমাজকল্যাণ and the শুরু arrow).
const SQUARES = [
  { index: 0, type: 'go', name: 'শুরু', iconKey: 'arrow' }, // arrow points the way players move

  { index: 1, type: 'property', name: 'নোয়াখালী', group: 'brown', price: 70,
    rent: { base: 2, set: 4, h1: 12, h2: 35, h3: 105, h4: 185, hotel: 290 },
    note: 'গান্ধী আশ্রম, নিঝুম দ্বীপ', classic: 'Mediterranean Ave (৳60: 2/10/30/90/160/250)' },

  { index: 2, type: 'community', name: 'সমাজকল্যাণ', iconKey: 'community' },

  { index: 3, type: 'property', name: 'দিনাজপুর', group: 'brown', price: 70,
    rent: { base: 5, set: 10, h1: 23, h2: 70, h3: 210, h4: 375, hotel: 525 },
    note: 'কান্তজীউ মন্দির', classic: 'Baltic Ave (৳60: 4/20/60/180/320/450)' },

  { index: 4, type: 'tax', name: 'খাজনা', amount: 200 },

  { index: 5, type: 'railroad', name: 'কমলাপুর রেলস্টেশন', price: 220, iconKey: 'train' },

  { index: 6, type: 'property', name: 'বাগেরহাট', group: 'lightblue', price: 110,
    rent: { base: 7, set: 14, h1: 33, h2: 100, h3: 295, h4: 440, hotel: 605 },
    note: 'ষাটগম্বুজ মসজিদ', classic: 'Oriental Ave (৳100: 6/30/90/270/400/550)' },

  { index: 7, type: 'chance', name: 'ভাগ্য', iconKey: 'chance' },

  { index: 8, type: 'property', name: 'নারায়ণগঞ্জ', group: 'lightblue', price: 110,
    rent: { base: 7, set: 14, h1: 33, h2: 100, h3: 295, h4: 440, hotel: 605 },
    note: 'পানাম নগর', classic: 'Vermont Ave (৳100: 6/30/90/270/400/550)' },

  { index: 9, type: 'property', name: 'বগুড়া', group: 'lightblue', price: 130,
    rent: { base: 9, set: 18, h1: 43, h2: 110, h3: 325, h4: 485, hotel: 650 },
    note: 'মহাস্থানগড়', classic: 'Connecticut Ave (৳120: 8/40/100/300/450/600)' },

  { index: 10, type: 'jail', name: 'হাজতখানা', subName: 'শুধু দেখতে আসা' },

  { index: 11, type: 'property', name: 'পটুয়াখালী', group: 'pink', price: 150,
    rent: { base: 11, set: 22, h1: 55, h2: 160, h3: 480, h4: 670, hotel: 805 },
    note: 'কুয়াকাটা', classic: 'St. Charles Place (৳140: 10/50/150/450/625/750)' },

  { index: 12, type: 'utility', name: 'তিতাস গ্যাস', price: 160, iconKey: 'flame' },

  { index: 13, type: 'property', name: 'রাঙামাটি', group: 'pink', price: 150,
    rent: { base: 11, set: 22, h1: 55, h2: 160, h3: 480, h4: 670, hotel: 805 },
    note: 'কাপ্তাই লেক', classic: 'States Ave (৳140: 10/50/150/450/625/750)' },

  { index: 14, type: 'property', name: 'নওগাঁ', group: 'pink', price: 170,
    rent: { base: 13, set: 26, h1: 65, h2: 190, h3: 530, h4: 745, hotel: 955 },
    note: 'সোমপুর মহাবিহার', classic: 'Virginia Ave (৳160: 12/60/180/500/700/900)' },

  { index: 15, type: 'railroad', name: 'বিমানবন্দর রেলস্টেশন', price: 220, iconKey: 'train' },

  { index: 16, type: 'property', name: 'টাঙ্গাইল', group: 'orange', price: 200,
    rent: { base: 16, set: 32, h1: 80, h2: 220, h3: 610, h4: 835, hotel: 1055 },
    note: 'মধুপুর গড়', classic: 'St. James Place (৳180: 14/70/200/550/750/950)' },

  { index: 17, type: 'community', name: 'সমাজকল্যাণ', iconKey: 'community' },

  { index: 18, type: 'property', name: 'কুষ্টিয়া', group: 'orange', price: 200,
    rent: { base: 16, set: 32, h1: 80, h2: 220, h3: 610, h4: 835, hotel: 1055 },
    note: 'লালন আখড়া', classic: 'Tennessee Ave (৳180: 14/70/200/550/750/950)' },

  { index: 19, type: 'property', name: 'ময়মনসিংহ', group: 'orange', price: 220,
    rent: { base: 18, set: 36, h1: 90, h2: 240, h3: 660, h4: 880, hotel: 1100 },
    note: 'আলেকজান্ডার ক্যাসেল', classic: 'New York Ave (৳200: 16/80/220/600/800/1000)' },

  { index: 20, type: 'free_parking', name: 'চায়ের দোকান' },

  { index: 21, type: 'property', name: 'কুমিল্লা', group: 'red', price: 240,
    rent: { base: 20, set: 40, h1: 100, h2: 275, h3: 765, h4: 955, hotel: 1145 },
    note: 'ময়নামতি', classic: 'Kentucky Ave (৳220: 18/90/250/700/875/1050)' },

  { index: 22, type: 'chance', name: 'ভাগ্য', iconKey: 'chance' },

  { index: 23, type: 'property', name: 'রংপুর', group: 'red', price: 240,
    rent: { base: 20, set: 40, h1: 100, h2: 275, h3: 765, h4: 955, hotel: 1145 },
    note: 'তাজহাট জমিদার বাড়ি', classic: 'Indiana Ave (৳220: 18/90/250/700/875/1050)' },

  { index: 24, type: 'property', name: 'যশোর', group: 'red', price: 260,
    rent: { base: 22, set: 44, h1: 110, h2: 325, h3: 815, h4: 1000, hotel: 1190 },
    note: 'মাইকেল মধুসূদন দত্তের বাড়ি', classic: 'Illinois Ave (৳240: 20/100/300/750/925/1100)' },

  { index: 25, type: 'railroad', name: 'আখাউড়া জংশন', price: 220, iconKey: 'train' },

  { index: 26, type: 'property', name: 'খুলনা', group: 'yellow', price: 280,
    rent: { base: 24, set: 48, h1: 120, h2: 355, h3: 860, h4: 1050, hotel: 1240 },
    note: 'সুন্দরবন', classic: 'Atlantic Ave (৳260: 22/110/330/800/975/1150)' },

  { index: 27, type: 'property', name: 'বান্দরবান', group: 'yellow', price: 280,
    rent: { base: 24, set: 48, h1: 120, h2: 355, h3: 860, h4: 1050, hotel: 1240 },
    note: 'নীলগিরি', classic: 'Ventnor Ave (৳260: 22/110/330/800/975/1150)' },

  { index: 28, type: 'utility', name: 'রূপপুর বিদ্যুৎ', price: 160, iconKey: 'bolt' },

  { index: 29, type: 'property', name: 'গাজীপুর', group: 'yellow', price: 300,
    rent: { base: 26, set: 52, h1: 130, h2: 385, h3: 910, h4: 1100, hotel: 1285 },
    note: 'ভাওয়াল জাতীয় উদ্যান', classic: 'Marvin Gardens (৳280: 24/120/360/850/1025/1200)' },

  { index: 30, type: 'go_to_jail', name: 'হাজতখানায় যাও' },

  { index: 31, type: 'property', name: 'সিলেট', group: 'green', price: 320,
    rent: { base: 28, set: 56, h1: 140, h2: 415, h3: 960, h4: 1175, hotel: 1360 },
    note: 'জাফলং, রাতারগুল', classic: 'Pacific Ave (৳300: 26/130/390/900/1100/1275)' },

  { index: 32, type: 'property', name: 'মৌলভীবাজার', group: 'green', price: 320,
    rent: { base: 28, set: 56, h1: 140, h2: 415, h3: 960, h4: 1175, hotel: 1360 },
    note: 'শ্রীমঙ্গল চা বাগান', classic: 'North Carolina Ave (৳300: 26/130/390/900/1100/1275)' },

  { index: 33, type: 'community', name: 'সমাজকল্যাণ', iconKey: 'community' },

  { index: 34, type: 'property', name: 'চট্টগ্রাম', group: 'green', price: 340,
    rent: { base: 30, set: 60, h1: 160, h2: 480, h3: 1065, h4: 1275, hotel: 1490 },
    note: 'পতেঙ্গা, বন্দর', classic: 'Pennsylvania Ave (৳320: 28/150/450/1000/1200/1400)' },

  { index: 35, type: 'railroad', name: 'পার্বতীপুর জংশন', price: 220, iconKey: 'train' },

  { index: 36, type: 'chance', name: 'ভাগ্য', iconKey: 'chance' },

  { index: 37, type: 'property', name: 'কক্সবাজার', group: 'darkblue', price: 380,
    rent: { base: 38, set: 76, h1: 190, h2: 545, h3: 1195, h4: 1410, hotel: 1630 },
    note: 'সমুদ্রসৈকত, সেন্ট মার্টিন', classic: 'Park Place (৳350: 35/175/500/1100/1300/1500)' },

  { index: 38, type: 'tax', name: 'ভ্যাট', amount: 100 },

  { index: 39, type: 'property', name: 'ঢাকা', group: 'darkblue', price: 440,
    rent: { base: 55, set: 110, h1: 220, h2: 660, h3: 1540, h4: 1870, hotel: 2200 },
    note: 'সংসদ ভবন, আহসান মঞ্জিল', classic: 'Boardwalk (৳400: 50/200/600/1400/1700/2000)' }
];

module.exports = { GROUPS, SQUARES };
