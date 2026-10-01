// data/cards.js
// ভাগ্য (Chance) and সমাজকল্যাণ (Community Chest) decks, 16 cards each.
// Classic card mix and classic amounts, with Bangladesh-flavored texts.
// Edit texts or amounts freely; keep the "action" shape the same.
//
// ACTION TYPES (handled by game/engine.js):
//   { type: 'moveTo', index }            go forward to a square (৳200 if passing শুরু)
//   { type: 'moveBy', steps }            move by steps (negative = backwards, no ৳200)
//   { type: 'collect', amount }          the bank pays you
//   { type: 'pay', amount }              you pay the bank
//   { type: 'collectFromEach', amount }  every other player pays you
//   { type: 'payEach', amount }          you pay every other player
//   { type: 'repairs', perHouse, perHotel }  pay for each of your houses/hotels
//   { type: 'goToJail' }                 straight to হাজতখানা, no ৳200, turn ends
//   { type: 'jailFree' }                 keep this card; use it to leave jail
//   { type: 'nearestRailroad' }          go forward to the nearest railroad:
//                                        owned by someone else -> pay DOUBLE rent,
//                                        unowned -> you may buy it
//   { type: 'nearestUtility' }           go forward to the nearest utility:
//                                        owned by someone else -> roll the dice and
//                                        pay 10 x the total, unowned -> you may buy it
//
// Square numbers: শুরু 0, পটুয়াখালী 11, যশোর 24, ঢাকা 39, কমলাপুর রেলস্টেশন 5.

const CHANCE = [
  { id: 'chance-01', text: 'ভোরের ট্রেন ধরে সোজা শুরু-তে চলে যান। ৳200 সংগ্রহ করুন।',
    action: { type: 'moveTo', index: 0 } },
  { id: 'chance-02', text: 'যশোরের খেজুরের গুড় কিনতে চলুন — যশোরে যান। শুরু পার হলে ৳200 পাবেন।',
    action: { type: 'moveTo', index: 24 } },
  { id: 'chance-03', text: 'কুয়াকাটায় সূর্যোদয় দেখতে পটুয়াখালী যান। শুরু পার হলে ৳200 পাবেন।',
    action: { type: 'moveTo', index: 11 } },
  { id: 'chance-04', text: 'ঢাকায় চাকরির ইন্টারভিউ! সোজা ঢাকায় যান।',
    action: { type: 'moveTo', index: 39 } },
  { id: 'chance-05', text: 'ঈদের ট্রেনের টিকিট কাটতে কমলাপুর রেলস্টেশনে যান। শুরু পার হলে ৳200 পাবেন।',
    action: { type: 'moveTo', index: 5 } },
  { id: 'chance-06', text: 'ঈদের ছুটিতে বাড়ি ফেরা! সামনের নিকটতম রেলস্টেশনে যান। মালিক থাকলে দ্বিগুণ ভাড়া দিন; না থাকলে কিনতে পারেন।',
    action: { type: 'nearestRailroad' } },
  { id: 'chance-07', text: 'ট্রেন ছেড়ে দিচ্ছে, দৌড়ান! সামনের নিকটতম রেলস্টেশনে যান। মালিক থাকলে দ্বিগুণ ভাড়া দিন; না থাকলে কিনতে পারেন।',
    action: { type: 'nearestRailroad' } },
  { id: 'chance-08', text: 'লোডশেডিং! সামনের নিকটতম ইউটিলিটিতে যান। মালিক থাকলে পাশা ফেলে যোগফলের 10 গুণ ভাড়া দিন; না থাকলে কিনতে পারেন।',
    action: { type: 'nearestUtility' } },
  { id: 'chance-09', text: 'সঞ্চয়পত্রের মুনাফা এসেছে! ব্যাংক আপনাকে ৳50 দিল।',
    action: { type: 'collect', amount: 50 } },
  { id: 'chance-10', text: 'জামিন মঞ্জুর! এই কার্ড দিয়ে হাজতখানা থেকে বিনা জরিমানায় বের হতে পারবেন। দরকার না হওয়া পর্যন্ত রেখে দিন।',
    action: { type: 'jailFree' } },
  { id: 'chance-11', text: 'ভুল বাসে উঠে পড়েছেন! 3 ঘর পিছিয়ে যান।',
    action: { type: 'moveBy', steps: -3 } },
  { id: 'chance-12', text: 'মোবাইল কোর্টের অভিযান! সোজা হাজতখানায় যান। শুরু পার হলেও ৳200 পাবেন না।',
    action: { type: 'goToJail' } },
  { id: 'chance-13', text: 'বর্ষায় ছাদ চুইয়ে পানি পড়ছে! প্রতিটি বাড়ির মেরামতে ৳25 আর প্রতিটি হোটেলের মেরামতে ৳100 দিন।',
    action: { type: 'repairs', perHouse: 25, perHotel: 100 } },
  { id: 'chance-14', text: 'ট্রাফিক জ্যামে সিগন্যাল অমান্য করেছেন — জরিমানা ৳15 দিন।',
    action: { type: 'pay', amount: 15 } },
  { id: 'chance-15', text: 'বন্ধুদের ইফতার পার্টি খাওয়ানোর পালা আপনার! প্রত্যেক খেলোয়াড়কে ৳50 করে দিন।',
    action: { type: 'payEach', amount: 50 } },
  { id: 'chance-16', text: 'প্রবাসী ভাইয়ের পাঠানো রেমিট্যান্স এসেছে! ৳150 সংগ্রহ করুন।',
    action: { type: 'collect', amount: 150 } }
];

const COMMUNITY = [
  { id: 'community-01', text: 'পহেলা বৈশাখের শুভেচ্ছা! শুরু-তে চলে যান এবং ৳200 সংগ্রহ করুন।',
    action: { type: 'moveTo', index: 0 } },
  { id: 'community-02', text: 'ব্যাংকের হিসাবে ভুল, তাও আপনার পক্ষে! ৳200 সংগ্রহ করুন।',
    action: { type: 'collect', amount: 200 } },
  { id: 'community-03', text: 'মাস শেষে বিদ্যুৎ বিল এসেছে। ৳50 পরিশোধ করুন।',
    action: { type: 'pay', amount: 50 } },
  { id: 'community-04', text: 'পুরনো সাইকেল বিক্রি করে ৳50 পেলেন।',
    action: { type: 'collect', amount: 50 } },
  { id: 'community-05', text: 'উকিল চাচা জামিনের কাগজ করে দিয়েছেন! এই কার্ড দিয়ে হাজতখানা থেকে বিনা জরিমানায় বের হতে পারবেন। দরকার না হওয়া পর্যন্ত রেখে দিন।',
    action: { type: 'jailFree' } },
  { id: 'community-06', text: 'জাল নোটসহ ধরা পড়েছেন! সোজা হাজতখানায় যান। শুরু পার হলেও ৳200 পাবেন না।',
    action: { type: 'goToJail' } },
  { id: 'community-07', text: 'ঈদ বোনাস পেয়েছেন! ৳100 সংগ্রহ করুন।',
    action: { type: 'collect', amount: 100 } },
  { id: 'community-08', text: 'আয়কর রিটার্নের টাকা ফেরত এসেছে। ৳20 সংগ্রহ করুন।',
    action: { type: 'collect', amount: 20 } },
  { id: 'community-09', text: 'আজ আপনার জন্মদিন! প্রত্যেক খেলোয়াড় আপনাকে ৳10 করে উপহার দিলেন।',
    action: { type: 'collectFromEach', amount: 10 } },
  { id: 'community-10', text: 'জীবন বিমার মেয়াদ পূর্ণ হয়েছে। ৳100 সংগ্রহ করুন।',
    action: { type: 'collect', amount: 100 } },
  { id: 'community-11', text: 'ডেঙ্গু জ্বরে হাসপাতালে ভর্তি — হাসপাতালের বিল ৳100 দিন।',
    action: { type: 'pay', amount: 100 } },
  { id: 'community-12', text: 'বাড়ি ফেরার পথে পদ্মা সেতুর টোল ৳50 দিন।',
    action: { type: 'pay', amount: 50 } },
  { id: 'community-13', text: 'পাশের বাসার ছেলেকে প্রাইভেট পড়িয়ে ৳25 পেলেন।',
    action: { type: 'collect', amount: 25 } },
  { id: 'community-14', text: 'পৌরসভার রাস্তা সংস্কার কর: প্রতিটি বাড়ির জন্য ৳40 আর প্রতিটি হোটেলের জন্য ৳115 দিন।',
    action: { type: 'repairs', perHouse: 40, perHotel: 115 } },
  { id: 'community-15', text: 'পাড়ার পিঠা উৎসবে দ্বিতীয় পুরস্কার! ৳10 সংগ্রহ করুন।',
    action: { type: 'collect', amount: 10 } },
  { id: 'community-16', text: 'গ্রামের বাড়ির জমির অংশ পেয়েছেন — উত্তরাধিকার সূত্রে ৳100 সংগ্রহ করুন।',
    action: { type: 'collect', amount: 100 } }
];

// Deck names as shown to players
const DECK_NAMES = {
  chance: 'ভাগ্য',
  community: 'সমাজকল্যাণ'
};

module.exports = { CHANCE, COMMUNITY, DECK_NAMES };
