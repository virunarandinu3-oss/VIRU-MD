// ============================================================
//  VIRU DEVS BOT - all settings live here (no .env needed).
//  Fill the 3 things marked FILL, then deploy anywhere.
//  KEEP THIS REPO PRIVATE. Never make it public.
// ============================================================
module.exports = {
  // ----- Identity -----
  BOT_NAME: 'VIRU MD',
  OWNER_NAME: 'VIRU Dev',               // name shown on the .owner contact card
  OWNER_NUMBER: '94718120118',          // FILL: your number, country code, digits only
  PAIR_CODE: 'VIRUDEVS',                // exactly 8 letters/numbers
  PREFIX: '.',
  MAX_SESSIONS: 100,

  // ----- Firebase (session storage) -----
  FIREBASE_DB_URL: 'https://viru-md-default-rtdb.firebaseio.com',                  // FILL: https://YOUR-PROJECT-default-rtdb.firebaseio.com
  FIREBASE_SECRET: '36cyKul2chcI7prFoR8CSYOKBrTRaRSXVhAd1pye',                  // FILL: Firebase database secret

  // ----- Vote + React API -----
  VOTE_API_BASE: 'https://viru-votes.vercel.app',
  VOTE_API_KEY: 'VIRUDEVS-C00A-503CC2',
  MAX_VOTES: 3000,
  MAX_REACTS: 4000,
  DEFAULT_REACT_EMOJIS: '❤️,🔥,👍',

  // ----- Auto-react API (owner API) -----
  OWNER_API_BASE: 'https://vote-api-production-4581.up.railway.app',
  OWNER_API_KEY: 'VIRUDEVS-OWNER-ULTRA-MAX',
  DEFAULT_AUTOREACT_EMOJIS: '❤️,🔥,👍,🎉,⚡',

  // ----- Per-user limits -----
  LIMIT_CREACT: 20,                     // per day
  LIMIT_VOTE: 3,                        // per day
  LIMIT_FOLLOWERS: 1,                   // per day
  LIMIT_AUTOREACT_LIFETIME: 1,          // lifetime
  LIMIT_PAIR: 3,                        // .pair per sender per day

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
