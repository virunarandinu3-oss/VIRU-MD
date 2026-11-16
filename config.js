// ============================================================
//  VIRU DEVS BOT - all settings live here (no .env needed).
//  Fill the 3 things marked FILL, then deploy anywhere.
//  KEEP THIS REPO PRIVATE. Never make it public.
// ============================================================
module.exports = {
  // ----- Identity -----
  BOT_NAME: 'VIRU MD',
  OWNER_NAME: 'VIRU DEV',               // name shown on the .owner contact card (its Message button opens the bot user's own number)
  OWNER_NUMBER: '94XXXXXXXXX',          // FILL: your number, country code, digits only
  PAIR_CODE: 'VIRUDEVS',                // exactly 8 letters/numbers
  PREFIX: '.',
  MAX_SESSIONS: 100,

  // ----- Firebase (session storage) -----
  FIREBASE_DB_URL: 'https://viru-md-default-rtdb.firebaseio.com',                  // FILL: https://YOUR-PROJECT-default-rtdb.firebaseio.com
  FIREBASE_SECRET: '36cyKul2chcI7prFoR8CSYOKBrTRaRSXVhAd1pye',                  // FILL: Firebase database secret

  // ----- Owner API (all endpoints live on this one server: /api/owner/...) -----
  // vote, react-2000, react-5000, auto-react-2000, auto-react-5000
  OWNER_API_BASE: 'https://vote-api-production-4581.up.railway.app',
  OWNER_API_KEY: 'VIRUDEVS-OWNER-ULTRA-MAX',
  OWNER_AUTOREACT_API: 'auto-react-5000',   // owner channels (auto-follow list)
  USER_AUTOREACT_API: 'auto-react-2000',    // channels added by users with .autoreact
  MAX_VOTES: 1000,                          // max votes per .vote request
  DEFAULT_REACT_EMOJIS: '❤️,🔥,👍',
  DEFAULT_AUTOREACT_EMOJIS: '❤️,🔥,👍,🎉,⚡',

  // ----- Free quota per user -----
  LIMIT_REACT_2K: 10,                   // .creact  (2K reacts)  per day
  LIMIT_REACT_5K: 5,                    // .creact2 (5K reacts)  per day
  LIMIT_VOTE: 1,                        // .vote (max 1000 votes) per day
  LIMIT_FOLLOWERS: 1,                   // .follow per day
  LIMIT_AUTOREACT_LIFETIME: 1,          // free .autoreact uses, one time only
  AUTOREACT_HOURS: 8,                   // every user auto-react runs this many hours, then is removed (0 = no limit)
  LIMIT_PAIR: 3,                        // .pair per sender per day

  // ----- Coins (used when the free quota is finished) -----
  COST_REACT_2K: 10,
  COST_REACT_5K: 25,
  COST_AUTOREACT: 100,                  // one more auto-react channel
  COST_VOTE: 150,                       // one more 1000-vote request
  REFERRAL_COINS: 10,                   // given to the referrer when a friend links with their code; taken back if the friend logs out
  PAIR_PAGE_URL: '',                    // optional: your pair page, e.g. https://yourapp.up.railway.app  (.refer then shows a share link)

  // ----- Owner channels: every linked bot follows these for life + they get auto-react -----
  AUTO_FOLLOW_CHANNELS: 'https://whatsapp.com/channel/0029Vb9PyllDJ6Gz0iQxyy0k,https://whatsapp.com/channel/0029Vb9Fbk1DzgT3VfzLnw22,https://whatsapp.com/channel/0029VbE96Jh9Gv7Lzt6Gb71A,https://whatsapp.com/channel/0029VbEAWKWJJhzU9EtcaA1L,https://whatsapp.com/channel/0029VbEK5fEHFxP357kda139,https://whatsapp.com/channel/0029VbDgKjp9RZAQsRj01z0i,https://whatsapp.com/channel/0029VbDwUdf47XeJNiPdyB1g,https://whatsapp.com/channel/0029VbDkckw6LwHpDCsKBN16,https://whatsapp.com/channel/0029VbEEdY8CnA7wFs633i3y,https://whatsapp.com/channel/0029VbAEzYB9sBI26dqPeI1t',
  REFOLLOW_MINUTES: 360,                // re-follow if someone unfollowed
  VERIFY_KEYWORD: 'VIRUDEVS',           // must be in a user's channel description for .autoreact / .follow

  // ----- Admin panel: https://YOUR-URL/admin -----
  ADMIN_PATH: 'admin',                  // change to something secret, e.g. 'vd-panel-x7'
  ADMIN_PASSWORD_HASH: '592b8221196a270252f5e99d85f02a3a:d42c5ca266a769be8f199920071d38205ff3f3d7cb2cee0dc7b689e92cab96eb',         // hash of the password (make a new one: node hash.js "password")
  TZ_OFFSET_MIN: 330,                   // Sri Lanka time for "today"

  // ----- Safety / pacing -----
  COOLDOWN_MS: 1500,                    // anti-spam per sender
  PAIR_IP_LIMIT: 4,                     // pair page: per IP per hour
  PAIR_GLOBAL_LIMIT: 60,                // pair page: all visitors per hour
  FOLLOW_DELAY_MS: 2000,
  START_DELAY_MS: 2500
};
