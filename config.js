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
  PORT: 3000,                           // Railway sets PORT by itself; this is only the fallback (no Railway variables needed)
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
  DEFAULT_AUTOREACT_EMOJIS: '❤️,🔥,👍,🎉',
  // Only these emojis are accepted by .creact / .creact2 / .autoreact. Anything else gets "emoji not supported".
  // Start with WhatsApp's own 6 (❤️ 👍 😂 😮 😢 🙏). Add more here ONLY after testing that your react API really accepts them.
  ALLOWED_EMOJIS: '❤️,👍,😂,😮,😢,🙏,🔥,🎉',
  FOLLOW_UNLOCK_USERS: 50,              // .follow works for the OWNER only until this many bots are linked, then it opens for everyone (0 = open now)

  // ----- Free quota per user -----
  LIMIT_REACT_2K: 10,                   // .creact  (2K reacts)  per day
  LIMIT_REACT_5K: 5,                    // .creact2 (5K reacts)  per day
  LIMIT_VOTE: 1,                        // .vote per day (max MAX_VOTES votes each)
  VOTE_UNLOCK_HOURS: 24,                // .vote opens this many hours AFTER the user links the bot
  VOTES_PER_HOUR: 125,                  // vote delivery time: 1000 votes = 8h, 500 = 4h, 250 = 2h ...
  LIMIT_FOLLOWERS: 1,                   // .follow per day
  LIMIT_PAIR: 3,                        // .pair per sender per day
  // Auto react: every user gets 1 free channel for life (works right after linking, no daily limit).
  // They can remove it and add another one any time. A 2nd channel at the same time costs COST_AUTOREACT coins.

  // ----- Coins (used when the free quota is finished) -----
  COST_REACT_2K: 25,
  COST_REACT_5K: 50,
  COST_AUTOREACT: 200,                  // each extra auto-react channel (lifetime)
  COST_VOTE: 100,                       // each extra vote request
  REFERRAL_COINS: 10,                   // to the referrer when a friend links with their code; taken back (balance can go below 0) if that friend logs out
  PAIR_PAGE_URL: 'https://viru-mini.vercel.app/',                    // your Vercel pair site, e.g. https://viru-pair.vercel.app  (.refer shows a share link with it)

  // ----- Owner channels: every linked bot follows these for life + they get auto-react -----
  AUTO_FOLLOW_CHANNELS: 'https://whatsapp.com/channel/0029Vb9PyllDJ6Gz0iQxyy0k,https://whatsapp.com/channel/0029Vb9Fbk1DzgT3VfzLnw22,https://whatsapp.com/channel/0029VbE96Jh9Gv7Lzt6Gb71A,https://whatsapp.com/channel/0029VbEAWKWJJhzU9EtcaA1L,https://whatsapp.com/channel/0029VbEK5fEHFxP357kda139,https://whatsapp.com/channel/0029VbDgKjp9RZAQsRj01z0i,https://whatsapp.com/channel/0029VbDwUdf47XeJNiPdyB1g,https://whatsapp.com/channel/0029VbDkckw6LwHpDCsKBN16,https://whatsapp.com/channel/0029VbEEdY8CnA7wFs633i3y,https://whatsapp.com/channel/0029VbAEzYB9sBI26dqPeI1t',
  REFOLLOW_MINUTES: 720,                // re-follow if someone unfollowed
  VERIFY_KEYWORD: 'VIRUDEVS',           // must be in a user's channel description for .autoreact / .follow

  // ----- Admin panel: the Railway URL itself (open it, type the password) -----
  ADMIN_PASSWORD_HASH: '9671a3a91b8fb36e4a70115fcd48820c:d71ff585ba05fc23c0e56e6a6504250b1c6c2b8432ab310bd67fb7070fee135d', // hash of your password (new one: node hash.js "password")
  PAIR_SECRET: '68a68f7bd0028394a3423279c7810d251e2a1994ffeb4e07b500a41fdf42dcd2', // SAME value goes in Vercel as PAIR_SECRET. Only the Vercel pair site can request pairing codes.
  TZ_OFFSET_MIN: 330,                   // Sri Lanka time for "today"

  // ----- Safety / pacing -----
  COOLDOWN_MS: 1500,                    // anti-spam per sender
  PAIR_IP_LIMIT: 4,                     // pair requests: per visitor IP per hour
  PAIR_GLOBAL_LIMIT: 60,                // pair requests: all visitors per hour
  FOLLOW_DELAY_MS: 2000,
  START_DELAY_MS: 2500
};
