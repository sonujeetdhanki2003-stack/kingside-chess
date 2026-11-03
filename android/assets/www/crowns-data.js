// v1.8 Crowns 👑: the shop catalogue and the earning rules, shared by the server (prices, caps: the server decides) and the app (names, previews).
// Crowns buy looks and extras only, never playing strength. Prices and caps here are the single source of truth.
export const CROWNS_VERSION = 1;

// earning (Crowns per action) and daily caps; the server applies these, the app only shows them
export const EARN = {
  login: 10,                       // daily login bonus (once per India day)
  streak: { 3: 25, 7: 75, 30: 300 }, // streak milestones, once per streak run
  botWin: [[2000, 25], [1400, 15], [800, 10], [0, 5]], // win by checkmate vs a bot of at least this strength -> Crowns
  botWinsPerDay: 5,
  online: { win: 15, draw: 8, loss: 5 }, // a finished rated online game
  onlinePerDay: 10,
  daily: 15,                       // the Daily Puzzle, solved first try
  lesson: 10,                      // each Learn lesson, the first time
  lessonsPerDay: 12,
  ach: { first_win: 50, first_online: 30, first_share: 20 },
  welcomeExisting: 300,            // every account made before Crowns existed (once)
  welcomeNew: 100,                 // a new account (once)
  guestMergeMax: 1000,             // Crowns a guest phone can bring into an account
};
export const FREE_REVIEWS_PER_DAY = 2;  // full Game Reviews per day; a review you have already run is always free to reopen
export const FREEZE_MAX = 3;

// level 1..10 -> rough strength, for plain-level games (matches the bot labels)
export const LEVEL_ELO = [0, 250, 600, 800, 1000, 1300, 1700, 2000, 2200, 2500, 3000];
export const BOT_ELO = { chintu: 250, meera: 600, rocky: 1000, iyer: 1300, zara: 1500, vikram: 1800, natasha: 2200, titan: 3000 };
export function botWinCrowns(elo) { for (const [min, c] of EARN.botWin) if (elo >= min) return c; return 5; }

// type: theme | pieces | frame | avatar | bot | review | freeze
// legacy: free before v1.8, so every player who had the app before Crowns keeps it unlocked
export const ITEMS = [
  { id: 'theme:purple', type: 'theme', v: 'purple', price: 80, legacy: 1, name: ['Purple board', 'पर्पल बोर्ड'] },
  { id: 'theme:coral', type: 'theme', v: 'coral', price: 80, legacy: 1, name: ['Coral board', 'कोरल बोर्ड'] },
  { id: 'theme:royal', type: 'theme', v: 'royal', price: 150, isNew: 1, name: ['Royal Gold board', 'रॉयल गोल्ड बोर्ड'] },
  { id: 'theme:midnight', type: 'theme', v: 'midnight', price: 150, isNew: 1, name: ['Midnight Neon board', 'मिडनाइट नियॉन बोर्ड'] },
  { id: 'theme:sandal', type: 'theme', v: 'sandal', price: 120, isNew: 1, name: ['Sandalwood board', 'चंदन बोर्ड'] },
  { id: 'pieces:fantasy', type: 'pieces', v: 'fantasy', price: 120, legacy: 1, name: ['Fantasy pieces', 'फ़ैंटेसी मोहरे'] },
  { id: 'pieces:spatial', type: 'pieces', v: 'spatial', price: 120, legacy: 1, name: ['Spatial pieces', 'स्पेशियल मोहरे'] },
  { id: 'pieces:gold', type: 'pieces', v: 'gold', price: 200, isNew: 1, name: ['Gold & Onyx pieces', 'गोल्ड और ओनिक्स मोहरे'] },
  { id: 'pieces:ruby', type: 'pieces', v: 'ruby', price: 180, isNew: 1, name: ['Ruby & Ivory pieces', 'रूबी और आइवरी मोहरे'] },
  { id: 'frame:gold', type: 'frame', v: 'gold', price: 60, name: ['Gold frame', 'गोल्ड फ़्रेम'] },
  { id: 'frame:fire', type: 'frame', v: 'fire', price: 100, name: ['Fire frame', 'फ़ायर फ़्रेम'] },
  { id: 'frame:diamond', type: 'frame', v: 'diamond', price: 200, name: ['Diamond frame', 'डायमंड फ़्रेम'] },
  { id: 'frame:crown', type: 'frame', v: 'crown', price: 300, name: ['Royal Crown frame', 'शाही ताज फ़्रेम'] },
  { id: 'avatar:tiger', type: 'avatar', v: '🐯', price: 50, name: ['Tiger avatar', 'बाघ अवतार'] },
  { id: 'avatar:peacock', type: 'avatar', v: '🦚', price: 50, name: ['Peacock avatar', 'मोर अवतार'] },
  { id: 'avatar:elephant', type: 'avatar', v: '🐘', price: 50, name: ['Elephant avatar', 'हाथी अवतार'] },
  { id: 'avatar:lion', type: 'avatar', v: '🦁', price: 50, name: ['Lion avatar', 'शेर अवतार'] },
  { id: 'avatar:robot', type: 'avatar', v: '🤖', price: 50, name: ['Robot avatar', 'रोबोट अवतार'] },
  { id: 'avatar:king', type: 'avatar', v: '🤴', price: 80, name: ['Prince avatar', 'राजकुमार अवतार'] },
  { id: 'bot:natasha', type: 'bot', v: 'natasha', price: 250, legacy: 1, name: ['Unlock Natasha (~2200)', 'नताशा अनलॉक (~2200)'] },
  { id: 'bot:titan', type: 'bot', v: 'titan', price: 400, legacy: 1, name: ['Unlock Titan (~3000)', 'टाइटन अनलॉक (~3000)'] },
  { id: 'review:1', type: 'review', n: 1, price: 15, use: 1, name: ['1 extra Game Review', '1 अतिरिक्त गेम रिव्यू'] },
  { id: 'review:5', type: 'review', n: 5, price: 60, use: 1, name: ['5 extra Game Reviews', '5 अतिरिक्त गेम रिव्यू'] },
  { id: 'freeze:1', type: 'freeze', n: 1, price: 50, use: 1, name: ['Streak Freeze', 'स्ट्रीक फ़्रीज़'] },
];
export const itemById = (id) => ITEMS.find((x) => x.id === id) || null;
// v1.8.1: look an item up by what the app stores (type + value). An avatar's value is its emoji, not the id's tail.
export const itemOf = (type, v) => ITEMS.find((x) => x.type === type && x.v === v) || null;
// the counter a consumable fills ("review", "freeze")
export const stockOf = (it) => (it.type === 'review' ? 'tickets' : it.type === 'freeze' ? 'freeze' : null);
// is a cosmetic/bot free for everyone (true for anything not in the shop)
export const PREMIUM = new Set(ITEMS.filter((x) => !x.use).map((x) => x.type + ':' + x.v));
export const isPremium = (type, v) => PREMIUM.has(type + ':' + v);

// Crown packs for real money come later (Razorpay on web/APK/Windows, Google Play Billing in a Play Store build).
// The shop shows a disabled "coming soon" card while this list is empty.
export const PACKS = [];
