if (!globalThis.crypto) globalThis.crypto = require('crypto').webcrypto; // Baileys needs global crypto (Node 18)
const http = require('http'), fs = require('fs'), path = require('path');
let makeWASocket, initAuthCreds, BufferJSON, proto, DisconnectReason, Browsers, makeCacheableSignalKeyStore, fetchLatestBaileysVersion; // loaded in boot (Baileys 7 is ESM)
const log = require('pino')({ level: 'silent' });
const E = { ...require('./config'), ...process.env }; // config.js holds everything; real env vars (if any) override
const DB = (E.FIREBASE_DB_URL || '').replace(/\/$/, ''), SECRET = E.FIREBASE_SECRET || '';
const PREFIX = E.PREFIX || '.', OWNER = (E.OWNER_NUMBER || '').replace(/\D/g, '');
const N = (k, d) => (E[k] !== undefined && E[k] !== '' && Number.isFinite(+E[k]) ? +E[k] : d);
const MAX = N('MAX_SESSIONS', 100), PORT = N('PORT', 3000);
const PAIR_CODE = (E.PAIR_CODE || 'VIRUDEVS').toUpperCase().replace(/[^A-Z0-9]/g, '');
if (PAIR_CODE.length !== 8) { console.error('PAIR_CODE must be exactly 8 letters/numbers'); process.exit(1); }
const BOT_NAME = E.BOT_NAME || 'VIRU MD';
const fancy = t => t.replace(/[A-Za-z]/g, c => String.fromCodePoint(0x1D5D4 + (c.toUpperCase().charCodeAt(0) - 65))); // A-Z -> bold sans letters
const BOT_STYLED = fancy(BOT_NAME);
const L = { creact: N('LIMIT_CREACT', 20), vote: N('LIMIT_VOTE', 1), followers: N('LIMIT_FOLLOWERS', 1), autoreact: N('LIMIT_AUTOREACT_LIFETIME', 1) };
const MAX_VOTES = N('MAX_VOTES', 1000), MAX_REACTS = N('MAX_REACTS', 4000);
const EMO_REACT = E.DEFAULT_REACT_EMOJIS || '❤️,🔥,👍', EMO_AUTO = E.DEFAULT_AUTOREACT_EMOJIS || '❤️,🔥,👍,🎉,⚡';
const CHANNELS = (E.AUTO_FOLLOW_CHANNELS || '').split(',').map(x => x.trim().split('/channel/').pop().split(/[?/]/)[0]).filter(Boolean);
const PAIR_IP_LIMIT = N('PAIR_IP_LIMIT', 4), PAIR_GLOBAL_LIMIT = N('PAIR_GLOBAL_LIMIT', 60);
const FOLLOW_DELAY = N('FOLLOW_DELAY_MS', 2000), START_DELAY = N('START_DELAY_MS', 2500);
const crypto = require('crypto');
const ADMIN_PATH = '/' + (E.ADMIN_PATH || 'admin').replace(/^\/+|\/+$/g, '');
const ADMIN_HASH = E.ADMIN_PASSWORD_HASH || '', KEYWORD = (E.VERIFY_KEYWORD || 'VIRUDEVS').toUpperCase(), KEYS = KEYWORD.split(',').map(k => k.replace(/[^A-Z0-9]/g, '')).filter(Boolean), OWNER_NAME = E.OWNER_NAME || 'VIRU DEV';
const COOLDOWN = N('COOLDOWN_MS', 1500), REFOLLOW_MIN = N('REFOLLOW_MINUTES', 360), LIMIT_PAIR = N('LIMIT_PAIR', 3), TZ = N('TZ_OFFSET_MIN', 330);
const SECRET_KEY = crypto.createHash('sha256').update(SECRET + ':' + ADMIN_HASH).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const started = Date.now();

// ---------- Firebase (REST, no SDK) ----------
const U = p => { const [a, q] = p.split('?'); return `${DB}/${a}.json?auth=${SECRET}${q ? '&' + q : ''}`; };
const okf = async r => { if (!r.ok) throw new Error(`Firebase error ${r.status}: ${(await r.text()).slice(0, 120)}`); return r; };
const dbGet = async p => (await okf(await fetch(U(p)))).json();
const dbSet = async (p, v) => okf(await fetch(U(p), { method: 'PUT', body: JSON.stringify(v) }));
const dbDel = async p => okf(await fetch(U(p), { method: 'DELETE' }));

const S = new Map(), cfg = new Map(), F = new Map(), KNOWN = new Set(); // KNOWN = linked numbers; // sessions, settings, flushers
const JIDS = {};
const SENT = new Map(), RETRY = new Map(); // sent-message cache + retry counters (fixes "waiting for this message")
const retryCache = { get: k => RETRY.get(k), set: (k, v) => { if (RETRY.size > 500) RETRY.clear(); RETRY.set(k, v); }, del: k => RETRY.delete(k), flushAll: () => RETRY.clear() };
const INST = crypto.randomBytes(4).toString('hex'); let READY = false;
async function acquireLock() { // only one running copy may touch the sessions (Railway redeploys overlap)
  for (;;) {
    const l = await dbGet('lock').catch(() => null);
    if (!l || l.id === INST || Date.now() - l.t > 25000) break;
    await sleep(3000);
  }
  const beat = () => dbSet('lock', { id: INST, t: Date.now() }).catch(() => {});
  await beat(); setInterval(beat, 10000).unref();
}
const dayStr = () => new Date(Date.now() + TZ * 60000).toISOString().slice(0, 10);
const inc = (p, n = 1) => dbSet(p, { '.sv': { increment: n } }).catch(() => {});
const push = (p, v) => fetch(U(p), { method: 'POST', body: JSON.stringify(v) }).catch(() => {});
const logEvent = (type, id, extra) => push('events', { t: Date.now(), type, id, ...extra });
const ST = { owner: OWNER, admins: new Set(), follow: [], react: {} }, banned = new Set();
const staff = u => u === ST.owner || ST.admins.has(u);
async function loadSettings() {
  const d = (await dbGet('settings').catch(() => null)) || {};
  if (!d.seeded) { // first boot: seed owner channels from env
    d.follow = Object.fromEntries(CHANNELS.map(c => [c, 1])); d.react = Object.fromEntries(CHANNELS.map(c => [c, 0]));
    d.owner = OWNER; d.seeded = 1; await dbSet('settings', d);
  }
  ST.owner = d.owner || OWNER; ST.admins = new Set(Object.keys(d.admins || {})); ST.follow = Object.keys(d.follow || {}); ST.react = d.react || {};
  banned.clear(); for (const k of Object.keys((await dbGet('ban').catch(() => null)) || {})) banned.add(k);
}
async function syncReact() { // owner channels -> auto-react API
  for (const [c, ok] of Object.entries(ST.react)) if (!ok) try { await autoApi('add', `https://whatsapp.com/channel/${c}`, EMO_AUTO); await dbSet(`settings/react/${c}`, 1); ST.react[c] = 1; } catch {}
}
function track(u, cmd, o = {}) {
  if (!u) return; const d = dayStr();
  for (const b of ['stats/total', 'stats/day/' + d]) { inc(b + '/cmds'); if (o.reacts) inc(b + '/reacts', o.reacts); if (o.votes) inc(b + '/votes', o.votes); if (cmd === 'follow') inc(b + '/follows'); }
  inc(`users/${u}/cmds`); dbSet(`users/${u}/last`, Date.now()).catch(() => {}); inc(`usage/${u}/${d}/cmds/${cmd}`);
  if (o.reacts) inc(`usage/${u}/${d}/reacts`, o.reacts);
  if (o.votes) inc(`usage/${u}/${d}/votes`, o.votes);
  if (o.link) push(`usage/${u}/${d}/ev`, { t: Date.now(), c: cmd, l: o.link, n: o.reacts || o.votes || 0 });
}

async function useFbAuth(id) {
  const raw = await dbGet('sessions/' + id);
  const d = raw ? JSON.parse(raw, BufferJSON.reviver) : { creds: initAuthCreds(), keys: {} };
  let t;
  const flush = () => { clearTimeout(t); return dbSet('sessions/' + id, JSON.stringify(d, BufferJSON.replacer)).catch(() => {}); };
  F.set(id, flush);
  const save = now => now ? flush() : (clearTimeout(t), t = setTimeout(flush, 1500));
  return {
    state: { creds: d.creds, keys: {
      get: async (type, ids) => { const r = {}; for (const i of ids) { let v = d.keys[type + '-' + i];
        if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v); r[i] = v; } return r; },
      set: async data => { for (const c in data) for (const i in data[c]) { const v = data[c][i];
        if (v) d.keys[c + '-' + i] = v; else delete d.keys[c + '-' + i]; } save(); } } },
    saveCreds: () => save(true)
  };
}

// ---------- Session manager ----------
async function start(id, pairing) {
  const { state, saveCreds } = await useFbAuth(id);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({}));
  const sock = makeWASocket({ version, logger: log, browser: Browsers.macOS('Safari'),
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, log) },
    printQRInTerminal: false, markOnlineOnConnect: false, syncFullHistory: false,
    generateHighQualityLinkPreview: false, msgRetryCounterCache: retryCache, getMessage: async k => SENT.get(k.id) });
  S.set(id, sock);
  const ready = new Promise(r => sock.ev.on('connection.update', u => u.qr && r()));
  const send0 = sock.sendMessage.bind(sock);
  sock.sendMessage = async (...a) => { const r = await send0(...a);
    if (r?.key?.id && r.message) { SENT.set(r.key.id, r.message); if (SENT.size > 300) SENT.delete(SENT.keys().next().value); } return r; };
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type === 'notify') for (const m of messages) handle(sock, id, m).catch(() => {}); });
  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') onOpen(sock, id);
    if (connection !== 'close' || sock.dead) return;
    S.delete(id);
    const code = lastDisconnect?.error?.output?.statusCode;
    if (code === DisconnectReason.loggedOut) { for (const b of ['stats/total', 'stats/day/' + dayStr()]) inc(b + '/logouts'); logEvent('logout', id); return wipe(id); }
    if (!state.creds.registered) return wipe(id);
    await (F.get(id) || (() => 0))(); setTimeout(() => start(id).catch(() => {}), code === DisconnectReason.restartRequired ? 800 : 5000);
  });
  if (pairing && !state.creds.registered) {
    await Promise.race([ready, sleep(15000)]);
    let code;
    for (let i = 0; i < 3 && !code; i++) {
      try { code = await sock.requestPairingCode(id, PAIR_CODE); }
      catch (e) { console.error('requestPairingCode failed:', e.message); if (i === 2) throw e; await sleep(2000); }
    }
    setTimeout(() => { if (!state.creds.registered) { sock.dead = true; try { sock.end(); } catch {} S.delete(id); wipe(id); } }, 180000);
    return code;
  }
}
async function wipe(id) {
  const c = (await dbGet('cfg/' + id).catch(() => null)) || {};
  if (c.arLink) await autoApi('delete', c.arLink).catch(() => {});
  cfg.delete(id); F.delete(id); KNOWN.delete(id);
  return Promise.all(['sessions/', 'meta/', 'cfg/'].map(p => dbDel(p + id)));
}

async function pairNew(num) {
  if (!/^\d{9,15}$/.test(num)) throw new Error('Enter a valid number with country code.');
  if (!READY) throw new Error('Server is starting, try again in a minute.');
  if (banned.has(num)) throw new Error('This number is blocked.');
  if (S.has(num)) throw new Error('This number is already linked.');
  if (S.size >= MAX) throw new Error('Server is full. Try again later.');
  try { return await start(num, true); }
  catch (e) { const s = S.get(num); if (s) { s.dead = true; try { s.end(); } catch {} } S.delete(num); wipe(num).catch(() => {}); throw e; }
}

const FQ = []; let fbusy = false;
function qFollow(id, front) { if (FQ.includes(id)) return; front ? FQ.unshift(id) : FQ.push(id); if (!fbusy) runFQ(); }
async function runFQ() {
  fbusy = true;
  while (FQ.length) {
    const sock = S.get(FQ.shift()); if (!sock) continue;
    for (const c of ST.follow) {
      try { const jid = JIDS[c] || (JIDS[c] = (await sock.newsletterMetadata('invite', c)).id); await sock.newsletterFollow(jid); } catch {}
      await sleep(FOLLOW_DELAY + Math.random() * FOLLOW_DELAY);
    }
  }
  fbusy = false;
}
setInterval(() => { for (const id of S.keys()) qFollow(id); }, REFOLLOW_MIN * 60000).unref(); // re-follow if someone unfollowed
async function onOpen(sock, id) {
  KNOWN.add(id);
  const m = await dbGet('meta/' + id).catch(() => 1);
  if (!m) { dbSet('meta/' + id, { linkedAt: Date.now() }); for (const b of ['stats/total', 'stats/day/' + dayStr()]) inc(b + '/linked'); logEvent('link', id); }
  qFollow(id, !m);
  if (!m) setTimeout(() => sock.sendMessage(id + '@s.whatsapp.net', { text: WELCOME(id) }, Q).catch(() => {}), 4000);
}

const dayKey = (id, cmd) => `limits/${id}/${dayStr()}/${cmd}`;
const canUse = async (p, max) => ((await dbGet(p)) || 0) < max;
const markUse = async p => dbSet(p, ((await dbGet(p)) || 0) + 1);
async function call(base, key, path, params) {
  if (!base || !key) throw new Error('API not configured');
  const r = await fetch(`${base.replace(/\/$/, '')}${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({}));
  if (!j.status || j.status === 'ERROR') throw new Error(j.message || 'API error');
  return j;
}
const autoApi = (action, link, emojis) => call(E.OWNER_API_BASE, E.OWNER_API_KEY, '/api/owner/auto-react', { owner_key: E.OWNER_API_KEY, action, link, ...(emojis && { emojis }) });
const voteApi = p => call(E.VOTE_API_BASE, E.VOTE_API_KEY, '/api/vote', { apikey: E.VOTE_API_KEY, ...p });
const reactApi = p => call(E.VOTE_API_BASE, E.VOTE_API_KEY, '/api/react', { apikey: E.VOTE_API_KEY, ...p });
const voteMins = n => n <= 100 ? 1 : n <= 250 ? 10 : n <= 500 ? 25 : n <= 1000 ? 60 : n <= 2000 ? 180 : 360;

// ---------- Look & feel: every reply uses this box + the Meta AI verified quote ----------
const LINE = '━━━━━━━━━━━━━━━━━━━━';
const FOOT = '⚡ _Powered BY VIRU MD_ ⚡';
const box = (title, ...lines) => `╭${LINE}⬣\n│ 💎 ${BOT_STYLED} 💎\n├${LINE}⬣\n│ *${title}*\n├${LINE}⬣\n${lines.map(l => l ? '│ ' + l : '│').join('\n')}\n╰${LINE}⬣\n\n${FOOT}`;
// Fake quoted card from Meta AI's verified number, shown with the name VIRU MD (the blue-tick look).
const META_NAME = 'VIRU MD', META_JID = '13135550002';
const META = { key: { remoteJid: 'status@broadcast', fromMe: false, participant: META_JID + '@s.whatsapp.net', id: 'VIRUMD' + crypto.randomBytes(6).toString('hex').toUpperCase() },
  message: { contactMessage: { displayName: META_NAME, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:;${META_NAME};;;\nFN:${META_NAME}\nitem1.TEL;waid=${META_JID}:+${META_JID}\nitem1.X-ABLabel:Ponsel\nEND:VCARD` } } };
const Q = { quoted: META };

// ---------- Commands (public: menu alive ping pair owner | linked users only: the rest) ----------
const MENU = box('📖 𝗠𝗔𝗜𝗡 𝗠𝗘𝗡𝗨 📖',
  '🌍 *PUBLIC*', `🔹 ${PREFIX}menu`, `🔹 ${PREFIX}alive`, `🔹 ${PREFIX}ping`, `🔹 ${PREFIX}pair <number>`, `🔹 ${PREFIX}owner`, '',
  '🔐 *LINKED USERS*', `🚀 ${PREFIX}creact <post link> <count> <emojis>`, `🗳️ ${PREFIX}vote <post link> <a|b|c> <count>`, `🤖 ${PREFIX}autoreact <channel link> <emojis>`,
  `🛑 ${PREFIX}autoreact off`, `👥 ${PREFIX}follow <channel link>`, `💬 ${PREFIX}respond`, '',
  `📝 _Channels for autoreact/follow need_ *${KEYWORD.split(',')[0]}* _in the description._`);
const WELCOME = id => box('🎉 CONNECTED SUCCESSFULLY ✅', `📱 Your bot is linked to *+${id}*`, '', '🔔 Owner channels are being followed for you.', `📖 Send *${PREFIX}menu* to see all commands.`, `🔓 ${PREFIX}creact ${PREFIX}vote ${PREFIX}autoreact ${PREFIX}follow are unlocked.`);
const lastCmd = new Map();
const num = j => (j || '').split('@')[0].split(':')[0];
const isCh = l => /whatsapp\.com\/channel\//.test(l || '');
const isPost = l => /whatsapp\.com\/channel\/[\w-]+\/\d+/.test(l || '');
const codeOf = l => l.split('/channel/')[1].split(/[?/]/)[0];
const chLink = l => 'https://whatsapp.com/channel/' + codeOf(l); // clean link (no ?mode=..., no extra text) for the APIs
const getCfg = async u => { if (!cfg.has(u)) { if (cfg.size > 3000) cfg.clear(); cfg.set(u, (await dbGet('cfg/' + u)) || {}); } return cfg.get(u); };
const saveCfg = (u, c) => { cfg.set(u, c); return Object.keys(c).length ? dbSet('cfg/' + u, c) : dbDel('cfg/' + u); };
const allow = async (u, p, max) => staff(u) || canUse(p, max);
const mark = (u, p) => staff(u) ? 0 : markUse(p);
const normKey = t => (t || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); // "VIRU DEVS", "viru-devs", "VIRUDEVS" all match
// Baileys 7.0.0-rc returns the RAW channel data: name/description sit under thread_metadata.*.text
// (older versions had meta.description directly). Read every shape so it never comes back empty.
const unwrapMeta = m => (m && m.result && m.result.id ? m.result : m) || {};
const textOf = v => typeof v === 'string' ? v : (v && typeof v.text === 'string' ? v.text : '');
const descOf = m => { m = unwrapMeta(m); return textOf(m.thread_metadata?.description) || textOf(m.description) || ''; };
const nameOf = m => { m = unwrapMeta(m); return textOf(m.thread_metadata?.name) || textOf(m.name) || ''; };
async function verified(sock, link) {
  let meta, tries = 0;
  for (;;) {
    try { meta = unwrapMeta(await sock.newsletterMetadata('invite', codeOf(link))); }
    catch (e) { throw new Error('Could not read that channel. Check the link and try again.'); }
    if (!meta || !meta.id) throw new Error('Channel not found. Check the link.');
    const d = normKey(descOf(meta));
    if (KEYS.some(k => d.includes(k))) return { id: meta.id, name: nameOf(meta) };
    if (++tries >= 3) break; // WhatsApp may be slow to show a fresh edit, so look again
    await sleep(2000);
  }
  throw new Error(`Add "${KEYWORD.split(',')[0]}" to your channel description, save it, wait 1-2 minutes and try again.`);
}

async function senderOf(sock, id, m) { // WhatsApp now uses LIDs; find the real phone number
  const k = m.key; if (k.fromMe) return id;
  const who = k.participant || k.remoteJid, alt = k.participantAlt || k.remoteJidAlt;
  const pn = [alt, who].find(j => j && j.endsWith('@s.whatsapp.net'));
  if (pn) return num(pn);
  try { const r = await sock.signalRepository?.lidMapping?.getPNForLID?.(who); if (r) return num(r); } catch {}
  return num(who);
}

async function handle(sock, id, m) {
  const jid = m.key.remoteJid;
  if (!m.message || !jid || jid === 'status@broadcast' || jid.endsWith('@newsletter')) return;
  const txt = m.message.conversation || m.message.extendedTextMessage?.text || '';
  if (!txt.startsWith(PREFIX)) return;
  const u = await senderOf(sock, id, m);
  if (!u || banned.has(u)) return;
  const now = Date.now(); if (now - (lastCmd.get(u) || 0) < COOLDOWN) return;
  lastCmd.set(u, now); if (lastCmd.size > 5000) lastCmd.clear();
  const [cmd, ...a] = txt.slice(PREFIX.length).trim().split(/\s+/), cm = cmd.toLowerCase(), o = {};
  const R = (title, ...lines) => sock.sendMessage(jid, { text: box(title, ...lines) }, Q);
  if (['creact', 'vote', 'autoreact', 'follow', 'followers', 'respond'].includes(cm) && !KNOWN.has(u) && !staff(u))
    return R('🔒 LOCKED 🔒', `🚫 *${PREFIX}${cm}* is for linked users only.`, '', `🔗 Send *${PREFIX}pair <your number>*`, '📲 to link your WhatsApp first.');
  const limitMsg = (what, n, per) => R('⛔ LIMIT REACHED ⛔', `📊 ${what}: ${n} per ${per}.`, '⏳ Try again later.');
  try {
    switch (cm) {
      case 'menu': await sock.sendMessage(jid, { text: MENU }, Q); break;
      case 'alive': { const s = (Date.now() - started) / 1000 | 0;
        await R('🟢 ALIVE 🟢', '👋 Hey! I am online and running smooth.', '', `⏱️ Uptime : ${s / 3600 | 0}h ${s / 60 % 60 | 0}m`, `💾 RAM    : ${(process.memoryUsage().rss / 1048576) | 0} MB`, '🚀 Status : Active'); break; }
      case 'ping': { const t = Date.now(), sent = await R('🏓 PING 🏓', '⚡ Testing speed...'), out = box('🏓 PONG 🏓', `⚡ Speed : ${Date.now() - t} ms`, '🟢 Status : Online');
        try { await sock.sendMessage(jid, { text: out, edit: sent.key }); } catch { await sock.sendMessage(jid, { text: out }, Q); } break; }
      case 'pair': { const n = (a[0] || '').replace(/\D/g, ''), p = dayKey(u, 'pair');
        if (!n) return R('🔗 USAGE 🔗', `📌 ${PREFIX}pair <your number>`, `💡 Example: ${PREFIX}pair 94771234567`);
        if (!(await allow(u, p, LIMIT_PAIR))) return limitMsg('Pair', LIMIT_PAIR, 'day');
        await pairNew(n); await mark(u, p);
        await R('🔗 PAIR CODE 🔗', '🎉 Your pairing code is ready!', '', `🔑 Code : *${PAIR_CODE}*`, '', '📱 *How to link*', '1️⃣ Open WhatsApp', '2️⃣ Settings ➜ Linked devices', '3️⃣ Link a device', '4️⃣ Link with phone number instead', '5️⃣ Enter the code above', '', '⏳ Valid for 3 minutes', `📖 After linking, send *${PREFIX}menu*`); break; }
      case 'owner': // contact card -> its "Message" button opens a chat with the number THIS bot is linked to
        await sock.sendMessage(jid, { contacts: { displayName: OWNER_NAME,
          contacts: [{ displayName: OWNER_NAME, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:;${OWNER_NAME};;;\nFN:${OWNER_NAME}\nTEL;type=CELL;type=VOICE;waid=${id}:+${id}\nEND:VCARD` }] } }, Q);
        await R('👑 OWNER 👑', `👤 *${OWNER_NAME}*`, '', '👆 Tap *Message* on the contact card', '💬 to chat with the owner.'); break;
      case 'creact': { if (!isPost(a[0])) return R('🚀 USAGE 🚀', `📌 ${PREFIX}creact <post link> <count> <emojis>`, `🔢 Count: 1 - ${MAX_REACTS}`, '🔗 Link must include the post id.');
        let n = MAX_REACTS; const ems = [];
        for (const x of a.slice(1)) /^\d+$/.test(x) ? n = Math.min(Math.max(+x, 1), MAX_REACTS) : ems.push(x);
        const em = ems.join(',').replace(/,+/g, ',').replace(/^,|,$/g, '') || EMO_REACT;
        const p = dayKey(u, 'creact'); if (!(await allow(u, p, L.creact))) return limitMsg('Reacts', L.creact, 'day');
        await reactApi({ link: a[0], emojis: em, reacts: n, hours: 0, minutes: 1 }); await mark(u, p);
        Object.assign(o, { reacts: n, link: a[0] }); await R('🚀 REACTS SENT ✅', `🔢 Count    : *${n}*`, `😍 Emojis   : ${em}`, '⏱️ Delivery : about 1 minute'); break; }
      case 'vote': { const op = (a[1] || '').toLowerCase(), n = Math.min(Math.max(+a[2] || 100, 1), MAX_VOTES);
        if (!isPost(a[0]) || !['a', 'b', 'c'].includes(op)) return R('🗳️ USAGE 🗳️', `📌 ${PREFIX}vote <post link> <a|b|c> <count>`, `🔢 Count: 1 - ${MAX_VOTES}`, '🔗 Link must include the post id.');
        const p = dayKey(u, 'vote'); if (!(await allow(u, p, L.vote))) return limitMsg('Votes', L.vote, 'day');
        const mins = voteMins(n);
        await voteApi({ link: a[0], option: op, votes: n, hours: mins / 60 | 0, minutes: mins % 60 }); await mark(u, p);
        Object.assign(o, { votes: n, link: a[0] }); await R('🗳️ VOTES SENT ✅', `🎯 Option   : *${op.toUpperCase()}*`, `🔢 Count    : *${n}*`, `⏱️ Delivery : over ${mins} min`); break; }
      case 'autoreact': { const c = await getCfg(u);
        if ((a[0] || '').toLowerCase() === 'off') {
          if (!c.arLink) return R('🤖 AUTO REACT 🤖', '⚠️ Auto react is not active.');
          await autoApi('delete', c.arLink); delete c.arLink; await saveCfg(u, c);
          await R('🛑 AUTO REACT OFF 🛑', '🗑️ Your channel was removed.', '⚠️ Your lifetime use is spent.'); break; }
        if (!isCh(a[0])) return R('🤖 USAGE 🤖', `📌 ${PREFIX}autoreact <channel link> <emojis>`, `🛑 ${PREFIX}autoreact off`, `♾️ Lifetime limit: ${L.autoreact} use`);
        if (c.arLink) return R('🤖 AUTO REACT 🤖', '✅ Already active.', `🛑 Use *${PREFIX}autoreact off* to remove it.`);
        const p = `lifetime/${u}/autoreact`; if (!(await allow(u, p, L.autoreact))) return R('⛔ LIMIT REACHED ⛔', '♾️ Auto react lifetime limit used.');
        const link = chLink(a[0]), em = a.slice(1).join(',').replace(/,+/g, ',').replace(/^,|,$/g, '') || EMO_AUTO;
        await verified(sock, link); await autoApi('add', link, em); await mark(u, p);
        c.arLink = link; await saveCfg(u, c); o.link = link; await R('🤖 AUTO REACT ON ✅', '🎉 Every new post in your channel', '😍 will get reacts automatically.', `✨ Emojis : ${em}`); break; }
      case 'follow': case 'followers': { if (!isCh(a[0])) return R('👥 USAGE 👥', `📌 ${PREFIX}follow <channel link>`);
        const p = dayKey(u, 'followers'); if (!(await allow(u, p, L.followers))) return limitMsg('Follow', L.followers, 'day');
        const meta = await verified(sock, chLink(a[0])); await mark(u, p); o.link = chLink(a[0]);
        await R('👥 FOLLOW STARTED ✅', `📢 Channel : *${meta.name || 'your channel'}*`, '⏳ Takes a few minutes'); // no bot count shown
        (async () => { for (const [, s2] of S) { try { await s2.newsletterFollow(meta.id); } catch {} await sleep(FOLLOW_DELAY / 2 + Math.random() * FOLLOW_DELAY); } })();
        break; }
      case 'respond': await R('💬 RESPOND 💬', '🚧 Coming soon...'); break;
      default: return;
    }
    track(u, cm === 'followers' ? 'follow' : cm, o);
  } catch (e) { R('❌ ERROR ❌', '⚠️ ' + (e.message || 'Something went wrong').slice(0, 150)).catch(() => {}); }
}

// ---------- Secure web server (pair page) ----------
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Strict-Transport-Security': 'max-age=31536000',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
const hits = new Map();
setInterval(() => hits.clear(), 3600e3).unref();
const tooMany = (k, max) => { const n = (hits.get(k) || 0) + 1; hits.set(k, n); return n > max; };
const file = f => fs.readFileSync(path.join(__dirname, 'public', f));
const PAGES = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript'] };

const sign = x => crypto.createHmac('sha256', SECRET_KEY).update(x).digest('hex');
const eq = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
const adminOk = pw => { try { const [salt, h] = ADMIN_HASH.split(':'); return crypto.timingSafeEqual(crypto.scryptSync(String(pw), salt, 32), Buffer.from(h, 'hex')); } catch { return false; } };
const authed = req => { const m = /vd_admin=(\d+)\.([a-f0-9]{64})/.exec(req.headers.cookie || ''); return !!m && +m[1] > Date.now() && eq(sign(m[1]), m[2]); };
const locks = new Map();
const readBody = req => new Promise(r => { let b = ''; req.on('data', d => { b += d; if (b.length > 2048) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
const cookie = (v, age) => `vd_admin=${v}; HttpOnly; Secure; SameSite=Strict; Path=${ADMIN_PATH}; Max-Age=${age}`;

async function adminRoute(req, res, url, send) {
  const sub = url.slice(ADMIN_PATH.length) || '/', J = o => send(200, JSON.stringify(o));
  if (req.method === 'GET' && sub === '/') return send(200, file('admin.html').toString().replace(/__P__/g, ADMIN_PATH), 'text/html; charset=utf-8');
  if (req.method === 'GET' && sub === '/app.js') return send(200, file('admin.js'), 'text/javascript');
  if (req.headers['x-admin'] !== '1') return send(403, '{"error":"Forbidden"}');
  if (req.method === 'POST') try { if (new URL(req.headers.origin || '').host !== req.headers.host) throw 0; } catch { return send(403, '{"error":"Forbidden"}'); }
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').pop().trim();
  if (sub === '/api/login' && req.method === 'POST') {
    const lk = locks.get(ip) || { n: 0, until: 0 };
    if (lk.until > Date.now()) return send(429, '{"error":"Too many attempts. Locked for 15 minutes."}');
    const b = await readBody(req);
    if (adminOk(b.password || '')) {
      locks.delete(ip); const exp = String(Date.now() + 12 * 3600e3);
      res.writeHead(200, { ...SEC, 'Content-Type': 'application/json', 'Set-Cookie': cookie(`${exp}.${sign(exp)}`, 43200) }); return res.end('{"ok":true}');
    }
    if (++lk.n >= 5) { lk.until = Date.now() + 15 * 60000; lk.n = 0; } locks.set(ip, lk);
    await sleep(800); return send(401, '{"error":"Wrong password"}');
  }
  if (!authed(req)) return send(401, '{"error":"Unauthorized"}');
  if (tooMany('adm' + ip, 3000)) return send(429, '{}');
  const q = new URL(req.url, 'http://x').searchParams;
  if (sub === '/api/logout') { res.writeHead(200, { ...SEC, 'Content-Type': 'application/json', 'Set-Cookie': cookie('', 0) }); return res.end('{"ok":true}'); }
  if (sub === '/api/overview') { const mem = process.memoryUsage();
    return J({ stats: (await dbGet(q.get('range') === 'all' ? 'stats/total' : 'stats/day/' + dayStr())) || {}, rss: mem.rss, heap: mem.heapUsed, up: (Date.now() - started) / 1000 | 0,
      online: S.size, max: MAX, stored: Object.keys((await dbGet('sessions?shallow=true')) || {}).length }); }
  if (sub === '/api/users') return J(Object.entries((await dbGet('users')) || {}).map(([id, v]) => ({ id, cmds: v.cmds || 0, last: v.last || 0, online: S.has(id), banned: banned.has(id) })));
  if (sub === '/api/user') { const id = String(q.get('id') || '').replace(/\D/g, '');
    const [usage, c, meta, life] = await Promise.all(['usage/', 'cfg/', 'meta/', 'lifetime/'].map(p => dbGet(p + id)));
    return J({ id, today: dayStr(), usage: usage || {}, cfg: c || {}, meta: meta || {}, life: life || {}, online: S.has(id), banned: banned.has(id) }); }
  if (sub === '/api/sessions') { const meta = (await dbGet('meta')) || {};
    return J(Object.keys((await dbGet('sessions?shallow=true')) || {}).map(id => ({ id, online: S.has(id), linkedAt: meta[id]?.linkedAt || 0 }))); }
  if (sub === '/api/events') return J(Object.values((await dbGet('events?orderBy=%22$key%22&limitToLast=150')) || {}).sort((x, y) => y.t - x.t));
  if (sub === '/api/settings') return J({ owner: ST.owner, admins: [...ST.admins], follow: ST.follow, react: ST.react });
  if (sub === '/api/act' && req.method === 'POST') {
    const b = await readBody(req), v = String(b.value || '').trim(), dg = v.replace(/\D/g, ''), code = v.includes('/channel/') ? codeOf(v) : v;
    const needCode = () => { if (!/^[\w-]{10,40}$/.test(code)) throw new Error('Invalid channel link'); };
    try { switch (b.op) {
      case 'owner': ST.owner = dg; await dbSet('settings/owner', dg); break;
      case 'admin_add': ST.admins.add(dg); await dbSet('settings/admins/' + dg, 1); break;
      case 'admin_del': ST.admins.delete(dg); await dbDel('settings/admins/' + dg); break;
      case 'follow_add': needCode(); if (!ST.follow.includes(code)) ST.follow.push(code); await dbSet('settings/follow/' + code, 1); for (const id of S.keys()) qFollow(id); break;
      case 'follow_del': ST.follow = ST.follow.filter(x => x !== code); await dbDel('settings/follow/' + code); break;
      case 'react_add': needCode(); ST.react[code] = 0; await dbSet('settings/react/' + code, 0); syncReact(); break;
      case 'react_del': await autoApi('delete', `https://whatsapp.com/channel/${code}`).catch(() => {}); delete ST.react[code]; await dbDel('settings/react/' + code); break;
      case 'ban': b.on ? banned.add(dg) : banned.delete(dg); b.on ? await dbSet('ban/' + dg, 1) : await dbDel('ban/' + dg); break;
      case 'remove': { const s2 = S.get(dg); if (s2) { try { await s2.logout(); } catch {} } else await wipe(dg); break; }
      default: return send(400, '{"error":"Unknown action"}');
    } } catch (e) { return send(400, JSON.stringify({ error: e.message })); }
    return J({ ok: true });
  }
  send(404, '{"error":"Not found"}');
}

http.createServer((req, res) => {
  const send = (code, body, type = 'application/json') => { res.writeHead(code, { ...SEC, 'Content-Type': type }); res.end(body); };
  const url = req.url.split('?')[0];
  if (url === ADMIN_PATH || url.startsWith(ADMIN_PATH + '/')) return adminRoute(req, res, url, send).catch(() => send(500, '{"error":"Server error"}'));
  if (req.method === 'GET' && url === '/health') return send(200, 'OK', 'text/plain');
  if (req.method === 'GET' && PAGES[url]) return send(200, file(PAGES[url][0]), PAGES[url][1]);
  if (req.method === 'GET' && url === '/api/stats') {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').pop().trim();
    if (tooMany('st' + ip, 600)) return send(429, '{}');
    return send(200, JSON.stringify({ online: S.size, max: MAX }));
  }
  if (req.method === 'POST' && url === '/api/pair') {
    try { if (new URL(req.headers.origin || '').host !== req.headers.host) throw 0; } catch { return send(403, '{"error":"Forbidden"}'); }
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').pop().trim();
    if (tooMany('ip' + ip, PAIR_IP_LIMIT) || tooMany('all', PAIR_GLOBAL_LIMIT)) return send(429, '{"error":"Too many attempts. Try again in an hour."}');
    let body = '';
    req.on('data', d => { body += d; if (body.length > 512) req.destroy(); });
    req.on('end', async () => {
      try {
        const j = JSON.parse(body);
        if (j.website) return send(400, '{"error":"Bad request"}'); // honeypot
        await pairNew(String(j.number || '').replace(/\D/g, ''));
        send(200, JSON.stringify({ code: PAIR_CODE }));
      } catch (e) { console.error('pair failed:', e.message); send(400, JSON.stringify({ error: /number|linked|full|blocked|starting/.test(e.message) ? e.message : /Firebase|URL/.test(e.message) ? 'Database error. The owner must check the Firebase settings.' : 'Could not create a pairing code. Try again.' })); }
    });
    return;
  }
  send(404, '{"error":"Not found"}');
}).listen(PORT);

// ---------- Boot ----------
(async () => {
  try {
    const bw = await import('@whiskeysockets/baileys');
    ({ default: makeWASocket, initAuthCreds, BufferJSON, proto, DisconnectReason, Browsers, makeCacheableSignalKeyStore, fetchLatestBaileysVersion } = bw);
    console.log('Baileys loaded');
  } catch (e) { console.error('Baileys load FAILED:', e.message); return; }
  try { if (!DB || !SECRET) throw new Error('FIREBASE_DB_URL / FIREBASE_SECRET are empty in config.js'); await dbSet('health', Date.now()); console.log('Firebase OK'); }
  catch (e) { console.error('Firebase FAILED:', e.message); }
  await loadSettings().catch(() => {}); syncReact();
  await acquireLock(); READY = true;
  const ids = Object.keys((await dbGet('sessions?shallow=true').catch(() => null)) || {});
  ids.forEach(i => KNOWN.add(i));
  for (const id of ids) { await start(id).catch(() => {}); await sleep(START_DELAY); }
})();
process.on('SIGTERM', async () => { await Promise.all([...F.values()].map(f => f())); await dbDel('lock').catch(() => {}); process.exit(0); });
if (!ADMIN_HASH) console.warn('ADMIN_PASSWORD_HASH missing: admin panel login is disabled');
process.on('unhandledRejection', () => {});
