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
// Free quotas per user (daily, except autoreact = lifetime) and what extra uses cost in coins
const L = { r2k: N('LIMIT_REACT_2K', 10), r5k: N('LIMIT_REACT_5K', 5), vote: N('LIMIT_VOTE', 1), followers: N('LIMIT_FOLLOWERS', 1) };
const COST = { r2k: N('COST_REACT_2K', 25), r5k: N('COST_REACT_5K', 50), auto: N('COST_AUTOREACT', 200), vote: N('COST_VOTE', 100) };
const REF_COINS = N('REFERRAL_COINS', 10), MAX_VOTES = N('MAX_VOTES', 1000), VOTE_UNLOCK = N('VOTE_UNLOCK_HOURS', 24), VPH = N('VOTES_PER_HOUR', 125); // 1000 votes = 8h, 500 = 4h
const OWNER_AUTO_API = E.OWNER_AUTOREACT_API || 'auto-react-5000', USER_AUTO_API = E.USER_AUTOREACT_API || 'auto-react-2000', PAIR_PAGE_URL = (E.PAIR_PAGE_URL || '').replace(/\/$/, '');
// Emojis the react API accepts. Anything else is refused with a clear message (edit ALLOWED_EMOJIS in config.js)
const strip = g => g.replace(/[\uFE0E\uFE0F]/g, ''); // ❤ and ❤️ count as the same emoji
const ALLOWED = new Map(String(E.ALLOWED_EMOJIS || '❤️,👍,😂,😮,😢,🙏,🔥,🎉').split(',').map(x => x.trim()).filter(Boolean).map(e => [strip(e), e]));
const ALLOWED_LIST = [...ALLOWED.values()];
const onlyAllowed = (str, d) => { const r = String(str || '').split(',').map(x => ALLOWED.get(strip(x.trim()))).filter(Boolean); return (r.length ? r : d).join(','); };
const EMO_REACT = onlyAllowed(E.DEFAULT_REACT_EMOJIS, ALLOWED_LIST.slice(0, 3)), EMO_AUTO = onlyAllowed(E.DEFAULT_AUTOREACT_EMOJIS, ALLOWED_LIST.slice(0, 5)); // defaults can never contain an unsupported emoji
const FOLLOW_UNLOCK = N('FOLLOW_UNLOCK_USERS', 50);
const CHANNELS = (E.AUTO_FOLLOW_CHANNELS || '').split(',').map(x => x.trim().split('/channel/').pop().split(/[?/]/)[0]).filter(Boolean);
const PAIR_IP_LIMIT = N('PAIR_IP_LIMIT', 4), PAIR_GLOBAL_LIMIT = N('PAIR_GLOBAL_LIMIT', 60);
const FOLLOW_DELAY = N('FOLLOW_DELAY_MS', 2000), START_DELAY = N('START_DELAY_MS', 2500);
const crypto = require('crypto');
const PAIR_SECRET = String(E.PAIR_SECRET || ''); // shared with the Vercel pair site; the ONLY way to request a pairing code
const ADMIN_HASH = E.ADMIN_PASSWORD_HASH || '', KEYWORD = (E.VERIFY_KEYWORD || 'VIRUDEVS').toUpperCase(), KEYS = KEYWORD.split(',').map(k => k.replace(/[^A-Z0-9]/g, '')).filter(Boolean), OWNER_NAME = E.OWNER_NAME || 'VIRU DEV';
const COOLDOWN = N('COOLDOWN_MS', 1500), REFOLLOW_MIN = N('REFOLLOW_MINUTES', 720), LIMIT_PAIR = N('LIMIT_PAIR', 3), TZ = N('TZ_OFFSET_MIN', 330);
const SECRET_KEY = crypto.createHash('sha256').update(SECRET + ':' + ADMIN_HASH).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const started = Date.now();
setInterval(() => { const m = process.memoryUsage(); RAMS.push({ t: Date.now(), rss: m.rss, heap: m.heapUsed, on: OPEN.size }); if (RAMS.length > 360) RAMS.shift(); }, 30000).unref(); // last 3 hours, every 30s

// ---------- Firebase (REST, no SDK) ----------
const U = p => { const [a, q] = p.split('?'); return `${DB}/${a}.json?auth=${SECRET}${q ? '&' + q : ''}`; };
const okf = async r => { if (!r.ok) throw new Error(`Firebase error ${r.status}: ${(await r.text()).slice(0, 120)}`); return r; };
const dbGet = async p => (await okf(await fetch(U(p)))).json();
const dbSet = async (p, v) => okf(await fetch(U(p), { method: 'PUT', body: JSON.stringify(v) }));
const dbDel = async p => okf(await fetch(U(p), { method: 'DELETE' }));

const OPEN = new Set(), RAMS = [], JOBS = []; let jobSeq = 0; // OPEN = bots really connected right now, RAMS = RAM/online samples for the admin charts, JOBS = admin actions (follow / react from active bots)
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
const followLocked = u => u !== ST.owner && KNOWN.size < FOLLOW_UNLOCK; // .follow: owner only until FOLLOW_UNLOCK_USERS bots are linked
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
async function backfill() { // one time: build the new admin counters from the old per-user usage logs, so charts are not empty
  if (await dbGet('settings/bf1').catch(() => 1)) return;
  const tot = { reacts: 0, votes: 0 }, cmds = {}, days = {}, chs = {};
  for (const u of Object.keys((await dbGet('usage?shallow=true')) || {})) {
    const us = (await dbGet('usage/' + u)) || {}; let re = 0, vo = 0;
    for (const [d, x] of Object.entries(us)) { re += x.reacts || 0; vo += x.votes || 0;
      for (const [k, n] of Object.entries(x.cmds || {})) { cmds[k] = (cmds[k] || 0) + n; ((days[d] ||= {}).c ||= {})[k] = (days[d].c[k] || 0) + n; }
      for (const e of Object.values(x.ev || {})) { const c = (e.l || '').split('/channel/')[1]?.split('/')[0]; if (!c) continue; const h = chs[c] ||= { reacts: 0, votes: 0, n: 0, last: 0 };
        if (e.c === 'vote') h.votes += e.n || 0; else h.reacts += e.n || 0; h.n++; h.last = Math.max(h.last, e.t || 0); } }
    if (re) await dbSet(`users/${u}/reacts`, re); if (vo) await dbSet(`users/${u}/votes`, vo);
  }
  if (Object.keys(cmds).length) await dbSet('stats/total/c', cmds);
  for (const [d, v] of Object.entries(days)) await dbSet(`stats/day/${d}/c`, v.c);
  for (const [c, v] of Object.entries(chs)) await dbSet('chstats/' + c, v);
  await dbSet('settings/bf1', Date.now());
}
function track(u, cmd, o = {}) {
  if (!u) return; const d = dayStr();
  for (const b of ['stats/total', 'stats/day/' + d]) { inc(b + '/cmds'); inc(b + '/c/' + cmd); if (o.reacts) inc(b + '/reacts', o.reacts); if (o.votes) inc(b + '/votes', o.votes); if (cmd === 'follow') inc(b + '/follows'); }
  inc(`users/${u}/cmds`); dbSet(`users/${u}/last`, Date.now()).catch(() => {}); inc(`usage/${u}/${d}/cmds/${cmd}`);
  if (o.reacts) inc(`users/${u}/reacts`, o.reacts); if (o.votes) inc(`users/${u}/votes`, o.votes);
  if (o.link && (o.reacts || o.votes)) { const c = o.link.split('/channel/')[1]?.split('/')[0]; if (c) { inc(`chstats/${c}/reacts`, o.reacts || 0); inc(`chstats/${c}/votes`, o.votes || 0); inc(`chstats/${c}/n`); dbSet(`chstats/${c}/last`, Date.now()).catch(() => {}); } }
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
  const save = now => now ? flush() : (clearTimeout(t), t = setTimeout(flush, 8000));
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
let VER; const getVer = async () => VER || (VER = (await fetchLatestBaileysVersion().catch(() => ({}))).version);
async function start(id, pairing) {
  const { state, saveCreds } = await useFbAuth(id);
  const version = await getVer();
  const sock = makeWASocket({ version, logger: log, browser: Browsers.macOS('Safari'),
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, log) },
    printQRInTerminal: false, markOnlineOnConnect: false, syncFullHistory: false, shouldIgnoreJid: j => !!j && j.endsWith('@broadcast'),
    generateHighQualityLinkPreview: false, msgRetryCounterCache: retryCache, getMessage: async k => SENT.get(k.id) });
  S.set(id, sock);
  const ready = new Promise(r => sock.ev.on('connection.update', u => u.qr && r()));
  const send0 = sock.sendMessage.bind(sock);
  sock.sendMessage = async (...a) => { const r = await send0(...a);
    if (r?.key?.id && r.message) { SENT.set(r.key.id, r.message); if (SENT.size > 150) SENT.delete(SENT.keys().next().value); } return r; };
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type === 'notify') for (const m of messages) handle(sock, id, m).catch(() => {}); });
  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') { OPEN.add(id); onOpen(sock, id); }
    if (connection === 'close') OPEN.delete(id);
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
  await clawback(id).catch(() => {});
  for (const [k, j] of [...AR]) if (j.u === id) { await autoDel(j.link, j.api).catch(() => {}); await dropAR(k); }
  const c = (await dbGet('cfg/' + id).catch(() => null)) || {};
  if (c.arLink) await autoDel(c.arLink).catch(() => {});
  cfg.delete(id); F.delete(id); KNOWN.delete(id); OPEN.delete(id);
  return Promise.all(['sessions/', 'meta/', 'cfg/'].map(p => dbDel(p + id)));
}

async function pairNew(num, refRaw) {
  if (!/^\d{9,15}$/.test(num)) throw new Error('Enter a valid number with country code.');
  if (!READY) throw new Error('Server is starting, try again in a minute.');
  if (banned.has(num)) throw new Error('This number is blocked.');
  if (S.has(num)) throw new Error('This number is already linked.');
  if (S.size >= MAX) throw new Error('Server is full. Try again later.');
  const by = await validateRef(num, refRaw);
  if (by) PENDING.set(num, { by, t: Date.now() });
  try { return await start(num, true); }
  catch (e) { PENDING.delete(num); const s = S.get(num); if (s) { s.dead = true; try { s.end(); } catch {} } S.delete(num); wipe(num).catch(() => {}); throw e; }
}

const FQ = []; let fbusy = false;
function qFollow(id, front) { if (FQ.includes(id)) return; front ? FQ.unshift(id) : FQ.push(id); if (!fbusy) runFQ(); }
async function runFQ() {
  fbusy = true;
  while (FQ.length) {
    const sock = S.get(FQ.shift()); if (!sock) continue;
    for (const c of ST.follow) {
      try { const jid = JIDS[c] || (JIDS[c] = unwrapMeta(await sock.newsletterMetadata('invite', c)).id); await sock.newsletterFollow(jid); } catch {}
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
  const ever = await dbGet('everlinked/' + id).catch(() => 1);
  let by = null;
  if (!ever) { dbSet('everlinked/' + id, Date.now()).catch(() => {}); by = await rewardRef(id).catch(() => null); }
  qFollow(id, !m);
  if (!m) setTimeout(async () => {
    const code = await refCodeOf(id).catch(() => '-');
    sock.sendMessage(id + '@s.whatsapp.net', { text: WELCOME(id, code) }, Q).catch(() => {});
    ownerNote(id, by);
  }, 4000);
}

const dayKey = (id, cmd) => `limits/${id}/${dayStr()}/${cmd}`;
const canUse = async (p, max) => ((await dbGet(p)) || 0) < max;
const markUse = async p => dbSet(p, ((await dbGet(p)) || 0) + 1);
const BAD = /err|fail|invalid|denied|unauthor|forbid|reject|not.?found|limit|expired|wrong|unknown/i;
async function call(base, key, path, params) {
  if (!base || !key) throw new Error('API not configured');
  const r = await fetch(`${base.replace(/\/$/, '')}${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({})), st = String(j.status ?? '').trim(), msg = String(j.message ?? j.error ?? j.detail ?? '').trim();
  console.log('API', path.replace('/api/owner/', ''), r.status, JSON.stringify(j).slice(0, 200)); // see the real API answers in the Railway logs
  const good = j.success === true || j.ok === true || /^(ok|success|succeeded|done|queued|started|added|deleted|removed|processing|running|completed|accepted|pending|scheduled|true)$/i.test(st);
  if (!r.ok || j.success === false || j.ok === false || j.error || BAD.test(st) || (!good && BAD.test(msg))) throw new Error((msg || st || 'API error (' + r.status + ')').slice(0, 120));
  return j;
}
// Owner API: https://<OWNER_API_BASE>/api/owner/<endpoint>?owner_key=...  (vote, react-2000, react-5000, auto-react-2000, auto-react-5000)
const ownerCall = (endpoint, params) => call(E.OWNER_API_BASE, E.OWNER_API_KEY, '/api/owner/' + endpoint, { owner_key: E.OWNER_API_KEY, ...params });
const autoApi = (action, link, emojis, api = OWNER_AUTO_API) => ownerCall(api, { action, link, ...(emojis && { emojis }) });
const AUTO_APIS = ['auto-react-2000', 'auto-react-5000'];
async function autoDel(link, api) { // delete on the endpoint it was added with, then try the other one
  let last; for (const x of [api, ...AUTO_APIS.filter(y => y !== api)].filter(Boolean)) { try { return await autoApi('delete', link, null, x); } catch (e) { last = e; } }
  throw last || new Error('API error');
}
const reactApi = (amount, link, emojis) => ownerCall('react-' + amount, { link, emojis });
const voteApi = (link, option, votes, mins) => ownerCall('vote', { link, option, votes, hours: mins / 60 | 0, minutes: mins % 60 });

// ---------- Coins ----------
const getCoins = async u => +(await dbGet('coins/' + u).catch(() => 0)) || 0;
const addCoins = (u, n) => dbSet('coins/' + u, { '.sv': { increment: n } });
const notify = (u, title, ...lines) => { try { Promise.resolve(S.get(u)?.sendMessage(u + '@s.whatsapp.net', { text: box(title, ...lines) }, Q)).catch(() => {}); } catch {} };
const mask = n => String(n).length > 7 ? String(n).slice(0, 4) + '*'.repeat(String(n).length - 7) + String(n).slice(-3) : '***'; // other users never see a full number
const dur = m => m >= 60 ? `${m / 60 | 0}h${m % 60 ? ' ' + m % 60 + 'm' : ''}` : `${m}m`;
// Use the free quota first; when it is used up, pay with coins. commit() is called only after the API call worked.
async function quota(u, kind, freeMax, cost, lifetime = false) {
  if (staff(u)) return { commit: async () => {}, line: '👑 Staff • unlimited' };
  const p = lifetime ? `lifetime/${u}/${kind}` : dayKey(u, kind), used = (await dbGet(p)) || 0;
  if (used < freeMax) return { commit: () => markUse(p), line: `🎁 Free use • ${freeMax - used - 1} left${lifetime ? '' : ' today'}` };
  const bal = await getCoins(u);
  if (bal >= cost) return { commit: () => addCoins(u, -cost), line: `🪙 Paid ${cost} coins • Balance ${bal - cost}` };
  return { block: [`📊 Free limit used (${freeMax}${lifetime ? ' lifetime' : ' per day'})`, `🪙 Needs ${cost} coins • you have ${bal}`, '', `👥 Earn coins : *${PREFIX}refer*`, `💰 Wallet     : *${PREFIX}coins*`] };
}

// ---------- Referral system ----------
// refcode/<number> = code, refowner/<code> = number, referred/<number> = {by,status,coins}, everlinked/<number> = first link time
const PENDING = new Map(); // number -> { by, t } while that number is pairing
const RC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
async function refCodeOf(u) {
  let c = await dbGet('refcode/' + u); if (c) return c;
  for (let i = 0; i < 5; i++) {
    c = 'VD' + Array.from(crypto.randomBytes(6), b => RC[b % 32]).join('');
    if (!(await dbGet('refowner/' + c))) { await dbSet('refowner/' + c, u); await dbSet('refcode/' + u, c); return c; }
  }
  throw new Error('Could not create a code, try again.');
}
async function validateRef(num, raw) {
  const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (!code) return null;
  const by = await dbGet('refowner/' + code);
  if (!by) throw new Error('Invalid referral code.');
  if (by === num) throw new Error('You cannot use your own referral code.');
  if (!KNOWN.has(by) && !staff(by)) throw new Error('This referral code is not active anymore.');
  if (await dbGet('everlinked/' + num)) throw new Error('This number was linked before, so a referral code cannot be used. Leave it empty.');
  return by;
}
async function rewardRef(id) { // first-ever link of a number that came with a referral code -> returns the referrer
  const p = PENDING.get(id); PENDING.delete(id);
  if (!p || Date.now() - p.t > 600000 || await dbGet('referred/' + id)) return null;
  await dbSet('referred/' + id, { by: p.by, at: Date.now(), status: 'active', coins: REF_COINS });
  await addCoins(p.by, REF_COINS); inc(`refstats/${p.by}/total`); inc(`refstats/${p.by}/active`);
  notify(p.by, '🎉 NEW REFERRAL 🎉', `👤 Number : *+${mask(id)}*`, '✅ Connected a bot with your code', '', `🪙 +${REF_COINS} coins`, `💰 Balance : ${await getCoins(p.by)}`);
  return p.by;
}
async function clawback(id) { // the referred bot logged out -> referrer loses those coins (once, may go below 0)
  const r = await dbGet('referred/' + id).catch(() => null);
  if (!r || r.status !== 'active') return;
  await dbSet('referred/' + id, { ...r, status: 'left', left: Date.now() });
  await addCoins(r.by, -r.coins); inc(`refstats/${r.by}/active`, -1);
  const bal = await getCoins(r.by);
  notify(r.by, '⚠️ REFERRAL LOGGED OUT ⚠️', `👤 Number : *+${mask(id)}*`, '❌ Unlinked the bot', '', `🪙 -${r.coins} coins`, `💰 Balance : ${bal}`, ...(bal < 0 ? ['', '⚠️ Balance is below 0. Earn coins to use paid features.'] : []));
}
function ownerNote(id, by) { // "server" message: sent by the OWNER's own linked bot to the owner's own chat (never from the new user's number)
  const s = S.get(ST.owner); if (!s) return;
  const t = new Date(Date.now() + TZ * 60000).toISOString().replace('T', ' ').slice(0, 16);
  s.sendMessage(ST.owner + '@s.whatsapp.net', { text: box('🔔 NEW BOT CONNECTED 🔔', `📱 Number : *+${id}*`, `🎁 Referred by : ${by ? '+' + by : 'none'}`, `🤖 Online : ${S.size} / ${MAX}`, `🕒 Time : ${t}`) }, Q).catch(() => {});
}

// ---------- Auto-react channels (lifetime). 1 free channel slot per user, extra channels cost coins ----------
const AR = new Map(); // "<number>_<channelCode>" -> { u, link, code, api, em, paid }
const arKey = (u, code) => u + '_' + code;
const userAR = u => [...AR.values()].filter(j => j.u === u);
const dropAR = k => { AR.delete(k); return dbDel('arjobs/' + k).catch(() => {}); };
async function loadAR() { for (const [k, v] of Object.entries((await dbGet('arjobs').catch(() => null)) || {})) AR.set(k, v); }

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
const menuFor = (u, linked) => {
  const locked = followLocked(u);
  const pub = ['🌍 *GENERAL*', `🔹 ${PREFIX}alive`, `🔹 ${PREFIX}ping`, `🔹 ${PREFIX}pair <number> [code]`, `🔹 ${PREFIX}owner`];
  if (!linked) return box('📖 𝗠𝗘𝗡𝗨 📖', '👋 Welcome! Link your WhatsApp and get all of this *FREE*', '', ...pub, '',
    '🎁 *FREE AFTER YOU LINK*',
    '🗳️ *Poll Votes*  ➜ ✅ Available', `     ${L.vote} free / day • up to ${MAX_VOTES} votes`, `     (opens ${VOTE_UNLOCK}h after linking)`,
    '🚀 *Channel Reacts*  ➜ ✅ Available', `     2K reacts ×${L.r2k} + 5K reacts ×${L.r5k} / day`,
    '🤖 *Auto React*  ➜ ✅ Available', '     1 channel free for life',
    '👥 *Add Followers*  ➜ ' + (locked ? '🔒 Coming soon' : '✅ Available'), ...(locked ? [] : [`     ${L.followers} free / day`]),
    '💰 *Referral Coins*  ➜ ✅ Available', `     +${REF_COINS} coins for every friend you invite`, '',
    '⚡ *START IN 3 STEPS*', `1️⃣ Send *${PREFIX}pair 947XXXXXXXX*`, '2️⃣ Link with the 8 letter code', `3️⃣ Send *${PREFIX}menu* again`, '',
    `🔐 Send *${PREFIX}pair <your number>* now to unlock everything!`);
  return box('📖 𝗠𝗘𝗡𝗨 📖', ...pub, '',
    '🚀 *REACTS*', `🔹 ${PREFIX}creact <post link> <emojis>`, `🔹 ${PREFIX}creact2 <post link> <emojis>`, '',
    '🗳️ *POLL VOTES*', `🔹 ${PREFIX}vote <post link> <a|b|c> [count]`, '',
    '🤖 *AUTO REACT*', `🔹 ${PREFIX}autoreact <channel link> <emojis>`, `🔹 ${PREFIX}autoreact off [channel link]`, '',
    '👥 *CHANNEL*', `🔹 ${PREFIX}follow <channel link>${locked ? ' 🔒' : ''}`, '',
    '💰 *COINS*', `🔹 ${PREFIX}coins`, `🔹 ${PREFIX}refer`,
    ...(staff(u) ? ['', '👑 *STAFF*', `🔹 ${PREFIX}addcoins <number> <amount>`, ...(u === ST.owner ? [`📊 Linked bots : ${KNOWN.size} / ${MAX}`] : [])] : []));
};
const WELCOME = (id, code) => box('🎉 𝗖𝗢𝗡𝗡𝗘𝗖𝗧𝗘𝗗 𝗦𝗨𝗖𝗖𝗘𝗦𝗦𝗙𝗨𝗟𝗟𝗬 🎉',
  '✅ Your WhatsApp is linked to the bot!', `📱 Number : *+${id}*`, '🟢 Status : Online 24/7', '',
  '🎁 *YOU GET FREE*', `🚀 2K reacts ×${L.r2k} • 5K reacts ×${L.r5k} / day`, `🗳️ Poll votes ×${L.vote} / day (opens in ${VOTE_UNLOCK}h)`, '🤖 Auto react : 1 channel for life', '',
  '💰 *EARN COINS*', `🔑 Your code : *${code}*`, `👥 A friend links with it ➜ +${REF_COINS} coins`, '',
  `📖 Send *${PREFIX}menu* to start`);
const lastCmd = new Map();
const num = j => (j || '').split('@')[0].split(':')[0];
const isCh = l => /whatsapp\.com\/channel\//.test(l || '');
const isPost = l => /whatsapp\.com\/channel\/[\w-]+\/\d+/.test(l || '');
const codeOf = l => l.split('/channel/')[1].split(/[?/]/)[0];
const postLink = l => { const m = /whatsapp\.com\/channel\/([\w-]+)\/(\d+)/.exec(l); return `https://whatsapp.com/channel/${m[1]}/${m[2]}`; };
const SEG = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const emojisOf = t => { // "❤️🔥👍", "❤️, 🔥 ,👍", "❤️ 🔥" -> { ok: ['❤️','🔥','👍'] (supported, once each, max 10), bad: [unsupported emojis] }
  const ok = [], bad = [];
  for (const { segment: g } of SEG.segment(t.join(' '))) {
    if (!/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(g)) continue;
    const c = ALLOWED.get(strip(g));
    if (c) { if (!ok.includes(c)) ok.push(c); } else if (!bad.includes(g)) bad.push(g);
  }
  return { ok: ok.slice(0, 10), bad };
};
const noEmoji = (R, cmd) => R('😕 NO EMOJI FOUND 😕', '⚠️ I could not find any emoji in your message.', `💡 Example: ${PREFIX}${cmd} <link> ${ALLOWED_LIST.slice(0, 3).join('')}`);
const badEmoji = (R, cmd, bad) => R('🚫 EMOJI NOT SUPPORTED 🚫', `❌ This emoji is not supported : ${bad.slice(0, 5).join(' ')}`, '✂️ Remove it and send the command again.', '', '✅ *SUPPORTED EMOJIS*', ALLOWED_LIST.join('  '), '', `💡 Example: ${PREFIX}${cmd} <link> ${ALLOWED_LIST.slice(0, 3).join('')}`);
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
  const ke = new Error('Copy the word below, add it to your channel description, save it, wait 1-2 minutes and try again.'); ke.keyword = KEYWORD.split(',')[0]; throw ke;
}

async function senderOf(sock, id, m) { // WhatsApp now uses LIDs; find the real phone number
  const k = m.key; if (k.fromMe) return id;
  const who = k.participant || k.remoteJid, alt = k.participantAlt || k.remoteJidAlt;
  const pn = [alt, who].find(j => j && j.endsWith('@s.whatsapp.net'));
  if (pn) return num(pn);
  try { const r = await sock.signalRepository?.lidMapping?.getPNForLID?.(who); if (r) return num(r); } catch {}
  return num(who);
}

const PUBLIC_CMDS = new Set(['menu', 'alive', 'ping', 'pair', 'owner']);
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
  if (!PUBLIC_CMDS.has(cm) && u !== id) return; // someone else texting this bot can only use the public commands
  const R = (title, ...lines) => sock.sendMessage(jid, { text: box(title, ...lines) }, Q);
  if (['creact', 'creact2', 'vote', 'autoreact', 'follow', 'followers', 'coins', 'wallet', 'balance', 'refer', 'referral'].includes(cm) && !KNOWN.has(u) && !staff(u))
    return R('🔒 LOCKED 🔒', `🚫 *${PREFIX}${cm}* is for linked users only.`, '', `🔗 Send *${PREFIX}pair <your number>*`, '📲 to link your WhatsApp first.');
  const limitMsg = (what, n, per) => R('⛔ LIMIT REACHED ⛔', `📊 ${what}: ${n} per ${per}.`, '⏳ Try again later.');
  try {
    switch (cm) {
      case 'menu': await sock.sendMessage(jid, { text: menuFor(u, KNOWN.has(u) || staff(u)) }, Q); break;
      case 'alive': { const s = (Date.now() - started) / 1000 | 0;
        await R('🟢 ALIVE 🟢', '👋 Hey! I am online and running smooth.', '', `⏱️ Uptime : ${s / 3600 | 0}h ${s / 60 % 60 | 0}m`, `💾 RAM    : ${(process.memoryUsage().rss / 1048576) | 0} MB`, '🚀 Status : Active'); break; }
      case 'ping': { const t = Date.now(), sent = await R('🏓 PING 🏓', '⚡ Testing speed...'), out = box('🏓 PONG 🏓', `⚡ Speed : ${Date.now() - t} ms`, '🟢 Status : Online');
        try { await sock.sendMessage(jid, { text: out, edit: sent.key }); } catch { await sock.sendMessage(jid, { text: out }, Q); } break; }
      case 'pair': { const n = (a[0] || '').replace(/\D/g, ''), p = dayKey(u, 'pair');
        if (!n) return R('🔗 USAGE 🔗', `📌 ${PREFIX}pair <your number> [referral code]`, `💡 Example: ${PREFIX}pair 94771234567 VDABC123`);
        if (!(await allow(u, p, LIMIT_PAIR))) return limitMsg('Pair', LIMIT_PAIR, 'day');
        await pairNew(n, a[1]); await mark(u, p);
        await R('🔗 PAIR CODE 🔗', '🎉 Your pairing code is ready!', '', `🔑 Code : *${PAIR_CODE}*`, '', '📱 *How to link*', '1️⃣ Open WhatsApp', '2️⃣ Settings ➜ Linked devices', '3️⃣ Link a device', '4️⃣ Link with phone number instead', '5️⃣ Enter the code above', '', '⏳ Valid for 3 minutes', ...(a[1] ? ['🎁 Referral code applied ✅'] : []), `📖 After linking, send *${PREFIX}menu*`);
        await sock.sendMessage(jid, { text: PAIR_CODE }); break; } // code alone in its own message: long-press to copy
      case 'owner': // contact card -> its "Message" button opens a chat with the number THIS bot is linked to
        await sock.sendMessage(jid, { contacts: { displayName: OWNER_NAME,
          contacts: [{ displayName: OWNER_NAME, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:;${OWNER_NAME};;;\nFN:${OWNER_NAME}\nTEL;type=CELL;type=VOICE;waid=${id}:+${id}\nEND:VCARD` }] } }, Q);
        await R('👑 OWNER 👑', `👤 *${OWNER_NAME}*`, '', '👆 Tap *Message* on the contact card', '💬 to chat with the owner.'); break;
      case 'creact': case 'creact2': { const big = cm === 'creact2', amt = big ? 5000 : 2000, kind = big ? 'r5k' : 'r2k', free = big ? L.r5k : L.r2k, cost = big ? COST.r5k : COST.r2k;
        if (!isPost(a[0])) return R(big ? '💥 USAGE 💥' : '🚀 USAGE 🚀', `📌 ${PREFIX}${cm} <post link> <emojis>`, `🎯 Sends *${amt / 1000}K* reacts`, `🎁 Free ${free} per day, then ${cost} coins`, '🔗 Link must include the post id.');
        const ev = emojisOf(a.slice(1)); if (ev.bad.length) return badEmoji(R, cm, ev.bad); if (a.length > 1 && !ev.ok.length) return noEmoji(R, cm);
        const em = ev.ok.join(',') || EMO_REACT;
        const q = await quota(u, kind, free, cost);
        if (q.block) return R('⛔ LIMIT REACHED ⛔', ...q.block);
        await reactApi(amt, postLink(a[0]), em); await q.commit();
        Object.assign(o, { reacts: amt, link: postLink(a[0]) });
        await R(big ? '💥 5K REACTS SENT ✅' : '🚀 2K REACTS SENT ✅', `🎯 Reacts : *${amt}*`, `😍 Emojis : ${em}`, '⏱️ Status : Processing', '', q.line); break; }
      case 'vote': { const op = (a[1] || '').toLowerCase(), n = Math.min(Math.max(+a[2] || MAX_VOTES, 1), MAX_VOTES);
        if (!isPost(a[0]) || !['a', 'b', 'c'].includes(op)) return R('🗳️ USAGE 🗳️', `📌 ${PREFIX}vote <post link> <a|b|c> [count]`, `🔢 Max ${MAX_VOTES} votes per request`, `⏱️ ${MAX_VOTES} votes = ${dur(Math.round(MAX_VOTES / VPH * 60))}, fewer votes = less time`, `🎁 Free ${L.vote} per day, then ${COST.vote} coins`, '🔗 Link must include the post id.');
        const meta = await dbGet('meta/' + u).catch(() => null), wait = !staff(u) && meta?.linkedAt ? meta.linkedAt + VOTE_UNLOCK * 3600e3 - Date.now() : 0;
        if (wait > 0) return R('🔒 VOTES LOCKED 🔒', `⏳ Poll votes open ${VOTE_UNLOCK} hours after you link your bot.`, `🕒 Time left : ${dur(Math.ceil(wait / 60000))}`, '', `🚀 Reacts and auto react work right now.`);
        const q = await quota(u, 'vote', L.vote, COST.vote);
        if (q.block) return R('⛔ LIMIT REACHED ⛔', ...q.block);
        const mins = Math.max(1, Math.round(n / VPH * 60));
        await voteApi(postLink(a[0]), op, n, mins); await q.commit();
        Object.assign(o, { votes: n, link: postLink(a[0]) });
        await R('🗳️ VOTES SENT ✅', `🎯 Option   : *${op.toUpperCase()}*`, `🔢 Count    : *${n}*`, `⏱️ Delivery : over ${dur(mins)}`, '', q.line); break; }
      case 'autoreact': { const sub = (a[0] || '').toLowerCase(), mine = userAR(u), freeSlot = () => !userAR(u).some(j => !j.paid);
        if (sub === 'off') {
          const code = isCh(a[1]) ? codeOf(a[1]) : null, jobs = code ? mine.filter(j => j.code === code) : mine;
          if (!jobs.length) return R('🤖 AUTO REACT 🤖', '⚠️ No active auto react found.');
          for (const j of jobs) { await autoDel(j.link, j.api); await dropAR(arKey(u, j.code)); }
          await R('🛑 AUTO REACT OFF 🛑', `🗑️ Removed ${jobs.length} channel(s).`, freeSlot() ? '🎁 Your free slot is ready, add a new channel!' : '⚠️ Paid channels are not refunded.'); break; }
        if (!isCh(a[0])) return R('🤖 USAGE 🤖', `📌 ${PREFIX}autoreact <channel link> <emojis>`, `🛑 ${PREFIX}autoreact off [channel link]`, '🎁 1 free channel for life (remove & change anytime)', `🪙 Extra channel : ${COST.auto} coins`,
          ...(mine.length ? ['', '📢 *ACTIVE*', ...mine.map(j => `• ${j.code.slice(0, 10)}… ${j.paid ? '🪙 paid' : '🎁 free'}`)] : []));
        const link = chLink(a[0]), code = codeOf(link), k = arKey(u, code);
        if (AR.has(k)) return R('🤖 AUTO REACT 🤖', '✅ Already active on this channel.');
        const ev = emojisOf(a.slice(1)); if (ev.bad.length) return badEmoji(R, 'autoreact', ev.bad); if (a.length > 1 && !ev.ok.length) return noEmoji(R, 'autoreact');
        const em = ev.ok.join(',') || EMO_AUTO; let q;
        if (staff(u) || freeSlot()) q = { paid: false, commit: async () => {}, line: staff(u) ? '👑 Staff • unlimited' : '🎁 Free channel slot' };
        else { const bal = await getCoins(u);
          if (bal < COST.auto) return R('⛔ LIMIT REACHED ⛔', '📊 Your free channel is already in use', `🪙 One more channel needs ${COST.auto} coins • you have ${bal}`, '', `🛑 Remove it first : *${PREFIX}autoreact off*`, `👥 Or earn coins : *${PREFIX}refer*`);
          q = { paid: true, commit: () => addCoins(u, -COST.auto), line: `🪙 Paid ${COST.auto} coins • Balance ${bal - COST.auto}` }; }
        await verified(sock, link); await autoApi('add', link, em, USER_AUTO_API); await q.commit();
        const job = { u, link, code, api: USER_AUTO_API, em, paid: q.paid }; AR.set(k, job); await dbSet('arjobs/' + k, job); o.link = link;
        await R('🤖 AUTO REACT ON ✅', '🎉 New posts in your channel get reacts', `😍 Emojis : ${em}`, '♾️ Active for life', '', q.line); break; }
      case 'coins': case 'wallet': case 'balance': { const bal = await getCoins(u), lf = async (k, m) => Math.max(0, m - ((await dbGet(dayKey(u, k))) || 0));
        const [x, y, v] = await Promise.all([lf('r2k', L.r2k), lf('r5k', L.r5k), lf('vote', L.vote)]), slot = !userAR(u).some(j => !j.paid);
        await R('💰 WALLET 💰', `🪙 Coins : *${bal}*`, ...(bal < 0 ? ['⚠️ Below 0: a friend you referred logged out.', '    Earn coins to use paid features again.'] : []), '',
          '🎁 *FREE LEFT TODAY*', `🚀 2K reacts : ${x}/${L.r2k}`, `💥 5K reacts : ${y}/${L.r5k}`, `🗳️ Poll vote : ${v}/${L.vote} (max ${MAX_VOTES})`, `🤖 Auto react : ${slot ? '1 free channel ready' : 'free channel in use'}`, '',
          '🛒 *PRICES (after free limit)*', `🚀 2K react    : ${COST.r2k} coins`, `💥 5K react    : ${COST.r5k} coins`, `🗳️ ${MAX_VOTES} votes  : ${COST.vote} coins`, `🤖 Extra channel : ${COST.auto} coins`, '', `👥 Earn ${REF_COINS} coins per friend : *${PREFIX}refer*`); break; }
      case 'refer': case 'referral': { const code = await refCodeOf(u), st = (await dbGet('refstats/' + u).catch(() => null)) || {};
        await R('🎁 REFERRAL 🎁', `🔑 Your code : *${code}*`, `👥 Friends active : ${Math.max(0, st.active || 0)} (total ${st.total || 0})`, `🪙 Reward : +${REF_COINS} coins per friend`, '',
          '📤 *HOW IT WORKS*', '1️⃣ Share your code with a friend', `2️⃣ Friend enters it on the pair page${PAIR_PAGE_URL ? ` (${PAIR_PAGE_URL}/?ref=${code})` : ''}`, `    or sends *${PREFIX}pair <number> ${code}*`, `3️⃣ When they link, you get ${REF_COINS} coins`, '',
          `⚠️ If they unlink the bot, ${REF_COINS} coins are taken back`, '♻️ Linking again gives no new coins', '🆕 Works only for numbers never linked before'); break; }
      case 'addcoins': { if (!staff(u)) return; const t = (a[0] || '').replace(/\D/g, ''), n = parseInt(a[1], 10);
        if (!t || !Number.isFinite(n)) return R('🪙 USAGE 🪙', `📌 ${PREFIX}addcoins <number> <amount>`);
        await addCoins(t, n); await R('🪙 COINS UPDATED ✅', `👤 +${t}`, `➕ ${n}`, `💰 Balance : ${await getCoins(t)}`); break; }
      case 'follow': case 'followers': {
        if (followLocked(u)) return R('🔒 FOLLOW LOCKED 🔒', '👥 Followers are not open yet.', '🚀 They will open soon.', '', '🎁 Until then use reacts, poll votes & auto react.', `📖 Send *${PREFIX}menu*`);
        if (!isCh(a[0])) return R('👥 USAGE 👥', `📌 ${PREFIX}follow <channel link>`);
        const p = dayKey(u, 'followers'); if (!(await allow(u, p, L.followers))) return limitMsg('Follow', L.followers, 'day');
        const meta = await verified(sock, chLink(a[0])); await mark(u, p); o.link = chLink(a[0]);
        await R('👥 FOLLOW STARTED ✅', `📢 Channel : *${meta.name || 'your channel'}*`, '⏳ Takes a few minutes'); // no bot count shown
        (async () => { for (const [, s2] of S) { try { await s2.newsletterFollow(meta.id); } catch {} await sleep(FOLLOW_DELAY / 2 + Math.random() * FOLLOW_DELAY); } })();
        break; }
      default: return;
    }
    track(u, cm === 'followers' ? 'follow' : cm, o);
  } catch (e) { R('❌ ERROR ❌', '⚠️ ' + (e.message || 'Something went wrong').slice(0, 150)).then(() => e.keyword && sock.sendMessage(jid, { text: e.keyword })).catch(() => {}); } // keyword goes in its own message so it is easy to copy
}

// ---------- Secure web server (pair page) ----------
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Strict-Transport-Security': 'max-age=31536000',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; img-src data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
const hits = new Map();
setInterval(() => hits.clear(), 3600e3).unref();
const tooMany = (k, max) => { const n = (hits.get(k) || 0) + 1; hits.set(k, n); return n > max; };
const FC = new Map(); const file = f => FC.get(f) || (FC.set(f, fs.readFileSync(path.join(__dirname, 'public', f))), FC.get(f));

const sign = x => crypto.createHmac('sha256', SECRET_KEY).update(x).digest('hex');
const eq = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
const adminOk = pw => { try { const [salt, h] = ADMIN_HASH.split(':'); return crypto.timingSafeEqual(crypto.scryptSync(String(pw), salt, 32), Buffer.from(h, 'hex')); } catch { return false; } };
// Login cookie: on https (Railway, any host) it is the strict __Host- cookie; on plain http (local testing) a normal HttpOnly cookie, so the panel opens in both cases.
const isHttps = req => !!req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
const authed = req => { const m = new RegExp('(?:^|;\\s*)' + (isHttps(req) ? '__Host-vd_admin' : 'vd_admin') + '=(\\d+)\\.([a-f0-9]{64})').exec(req.headers.cookie || ''); return !!m && +m[1] > Date.now() && eq(sign(m[1]), m[2]); };
const cookie = (req, v, age) => isHttps(req) ? `__Host-vd_admin=${v}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${age}` : `vd_admin=${v}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}`;
const locks = new Map(); let gfail = 0; setInterval(() => { gfail = 0; }, 3600e3).unref(); // global failed-login counter: every wrong guess makes the next ones slower
const readBody = req => new Promise(r => { let b = ''; req.on('data', d => { b += d; if (b.length > 4096) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });

// ---------- Admin actions that use the ACTIVE bots (follow a channel / react to a post) ----------
const ADM_DELAY = N('ADMIN_ACTION_DELAY_MS', 700);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const openBots = () => [...OPEN].filter(id => S.has(id)).map(id => [id, S.get(id)]);
const newJob = (type, target, total, note = '') => { const j = { id: ++jobSeq, type, target, total, done: 0, ok: 0, fail: 0, status: 'running', t: Date.now(), note }; JOBS.unshift(j); if (JOBS.length > 40) JOBS.pop(); return j; };
async function chJid(code) { // channel invite code -> channel id, asked through any connected bot
  if (JIDS[code]) return JIDS[code];
  for (const [, s] of openBots()) { try { const m = unwrapMeta(await s.newsletterMetadata('invite', code)); if (m.id) return (JIDS[code] = m.id); } catch {} }
  throw new Error('Could not read that channel (no connected bot, or wrong link).');
}
function jobFollow(code) {
  const bots = shuffle(openBots()), job = newJob('follow', code, bots.length);
  (async () => { try { const jid = await chJid(code);
    for (const [, s] of bots) { try { await s.newsletterFollow(jid); job.ok++; } catch { job.fail++; } job.done++; await sleep(ADM_DELAY + Math.random() * ADM_DELAY); }
    job.status = 'done'; } catch (e) { job.status = 'failed'; job.note = e.message; } })();
  return job;
}
function jobReact(code, post, emojis, limit, follow) { // every chosen connected bot reacts to the post itself (random emoji from the list)
  let bots = shuffle(openBots()); if (limit > 0) bots = bots.slice(0, limit);
  const job = newJob('react', code + '/' + post, bots.length, emojis.join(' '));
  (async () => { try { const jid = await chJid(code);
    for (const [, s] of bots) { try { if (follow) await s.newsletterFollow(jid).catch(() => {}); await s.newsletterReactMessage(jid, post, emojis[Math.random() * emojis.length | 0]); job.ok++; } catch { job.fail++; } job.done++; await sleep(ADM_DELAY + Math.random() * ADM_DELAY); }
    job.status = 'done'; } catch (e) { job.status = 'failed'; job.note = e.message; } })();
  return job;
}
const CHM = new Map(); let chBusy = false; // channel name + follower count cache for the panel (filled in the background)
const subsOf = m => +(m.thread_metadata?.subscribers_count ?? m.subscribers ?? 0) || 0;
async function chFill(codes) {
  if (chBusy) return; chBusy = true;
  try { const bot = openBots()[0]?.[1]; if (!bot) return;
    for (const c of codes) { const h = CHM.get(c); if (h && Date.now() - h.t < 600000) continue;
      try { const m = unwrapMeta(await bot.newsletterMetadata('invite', c)); CHM.set(c, { name: nameOf(m), subs: subsOf(m), t: Date.now() }); } catch { CHM.set(c, { name: h?.name || '', subs: h?.subs || 0, t: Date.now() }); }
      await sleep(400); } }
  finally { chBusy = false; }
}
const chInfo = codes => { chFill(codes).catch(() => {}); return codes.map(c => ({ code: c, name: CHM.get(c)?.name || '', subs: CHM.get(c)?.subs || 0 })); };

async function adminRoute(req, res, url, send) {
  const sub = url, J = o => send(200, JSON.stringify(o));
  if (req.method === 'GET' && sub === '/') return send(200, file('admin.html'), 'text/html; charset=utf-8');
  if (req.method === 'GET' && sub === '/admin.js') return send(200, file('admin.js'), 'text/javascript');
  if (req.headers['x-admin'] !== '1') return send(403, '{"error":"Forbidden"}');
  if (req.method === 'POST') try { if (new URL(req.headers.origin || '').host !== req.headers.host) throw 0; } catch { return send(403, '{"error":"Forbidden"}'); }
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').pop().trim();
  if (sub === '/api/login' && req.method === 'POST') {
    const lk = locks.get(ip) || { n: 0, until: 0 };
    if (lk.until > Date.now()) return send(429, '{"error":"Too many attempts. Locked for 15 minutes."}');
    const b = await readBody(req);
    if (adminOk(b.password || '')) {
      locks.delete(ip); const exp = String(Date.now() + 12 * 3600e3);
      res.writeHead(200, { ...SEC, 'Content-Type': 'application/json', 'Set-Cookie': cookie(req, `${exp}.${sign(exp)}`, 43200) }); return res.end('{"ok":true}');
    }
    if (++lk.n >= 5) { lk.until = Date.now() + 15 * 60000; lk.n = 0; } locks.set(ip, lk);
    gfail++; await sleep(800 + Math.min(gfail * 150, 5000)); return send(401, '{"error":"Wrong password"}');
  }
  if (!authed(req)) return send(401, '{"error":"Unauthorized"}');
  if (tooMany('adm' + ip, 6000)) return send(429, '{}');
  const q = new URL(req.url, 'http://x').searchParams;
  if (sub === '/api/logout') { res.writeHead(200, { ...SEC, 'Content-Type': 'application/json', 'Set-Cookie': cookie(req, '', 0) }); return res.end('{"ok":true}'); }
  if (sub === '/api/overview') { const mem = process.memoryUsage(), [today, all, st] = await Promise.all([dbGet('stats/day/' + dayStr()), dbGet('stats/total'), dbGet('sessions?shallow=true')]);
    return J({ today: today || {}, all: all || {}, rss: mem.rss, heap: mem.heapUsed, ext: mem.external, heapLimit: require('v8').getHeapStatistics().heap_size_limit, up: (Date.now() - started) / 1000 | 0,
      online: OPEN.size, running: S.size, max: MAX, stored: Object.keys(st || {}).length, ar: AR.size, banned: banned.size, node: process.version, samples: RAMS, jobs: JOBS.filter(j => j.status === 'running').length, day: dayStr(), tz: TZ, emojis: ALLOWED_LIST, maxVotes: MAX_VOTES, vph: VPH, botName: BOT_NAME }); }
  if (sub === '/api/trend') { const n = Math.min(Math.max(+q.get('days') || 30, 1), 365), d = (await dbGet('stats/day?orderBy=%22$key%22&limitToLast=' + n)) || {}, out = [];
    for (let i = n - 1; i >= 0; i--) { const k = new Date(Date.now() + TZ * 60000 - i * 864e5).toISOString().slice(0, 10), x = d[k] || {}; out.push({ d: k, linked: x.linked || 0, logouts: x.logouts || 0, cmds: x.cmds || 0, reacts: x.reacts || 0, votes: x.votes || 0, follows: x.follows || 0 }); }
    return J(out); }
  if (sub === '/api/cmds') { const r = q.get('range') || 'today'; let c = {};
    if (r === 'all') c = (await dbGet('stats/total/c')) || {};
    else if (r === 'today') c = (await dbGet(`stats/day/${dayStr()}/c`)) || {};
    else for (const x of Object.values((await dbGet('stats/day?orderBy=%22$key%22&limitToLast=' + Math.min(+r || 7, 365))) || {})) for (const [k, n] of Object.entries(x.c || {})) c[k] = (c[k] || 0) + n;
    return J(Object.entries(c).map(([cmd, n]) => ({ cmd, n })).sort((a, b) => b.n - a.n)); }
  if (sub === '/api/bots') { const [ss, meta, us, coins] = await Promise.all(['sessions?shallow=true', 'meta', 'users', 'coins'].map(p => dbGet(p).then(x => x || {})));
    return J(Object.keys(ss).map(id => { const u = us[id] || {}; return { id, online: OPEN.has(id), linkedAt: meta[id]?.linkedAt || 0, cmds: u.cmds || 0, reacts: u.reacts || 0, votes: u.votes || 0, last: u.last || 0, coins: +coins[id] || 0, ar: userAR(id).length, banned: banned.has(id) }; })); }
  if (sub === '/api/users') { const [us, ss] = await Promise.all([dbGet('users'), dbGet('sessions?shallow=true')]);
    return J(Object.entries(us || {}).map(([id, v]) => ({ id, cmds: v.cmds || 0, reacts: v.reacts || 0, votes: v.votes || 0, last: v.last || 0, online: OPEN.has(id), linked: !!(ss || {})[id], banned: banned.has(id) }))); }
  if (sub === '/api/user') { const id = String(q.get('id') || '').replace(/\D/g, '');
    const [usage, c, meta, life, ref] = await Promise.all(['usage/', 'cfg/', 'meta/', 'lifetime/', 'refstats/'].map(p => dbGet(p + id)));
    return J({ id, coins: await getCoins(id), ar: userAR(id).map(j => ({ link: j.link, em: j.em, paid: !!j.paid })), today: dayStr(), usage: usage || {}, cfg: c || {}, meta: meta || {}, life: life || {}, ref: ref || {}, online: OPEN.has(id), banned: banned.has(id) }); }
  if (sub === '/api/sessions') { const meta = (await dbGet('meta')) || {};
    return J(Object.keys((await dbGet('sessions?shallow=true')) || {}).map(id => ({ id, online: OPEN.has(id), linkedAt: meta[id]?.linkedAt || 0 }))); }
  if (sub === '/api/events') return J(Object.values((await dbGet('events?orderBy=%22$key%22&limitToLast=300')) || {}).sort((x, y) => y.t - x.t));
  if (sub === '/api/chstats') { const d = (await dbGet('chstats')) || {}, top = Object.entries(d).map(([code, v]) => ({ code, reacts: v.reacts || 0, votes: v.votes || 0, n: v.n || 0, last: v.last || 0 })).sort((a, b) => b.reacts + b.votes - a.reacts - a.votes).slice(0, 60);
    const info = Object.fromEntries(chInfo(top.slice(0, 25).map(x => x.code)).map(x => [x.code, x])); return J(top.map(x => ({ ...x, name: info[x.code]?.name || CHM.get(x.code)?.name || '', subs: CHM.get(x.code)?.subs || 0 }))); }
  if (sub === '/api/channels') return J({ follow: chInfo(ST.follow), react: chInfo(Object.keys(ST.react)).map(x => ({ ...x, active: !!ST.react[x.code] })) });
  if (sub === '/api/jobs') return J(JOBS);
  if (sub === '/api/settings') return J({ owner: ST.owner, admins: [...ST.admins], follow: ST.follow, react: ST.react, banned: [...banned] });
  if (sub === '/api/act' && req.method === 'POST') {
    const b = await readBody(req), v = String(b.value || '').trim(), dg = v.replace(/\D/g, ''), code = v.includes('/channel/') ? codeOf(v) : v;
    const needCode = () => { if (!/^[\w-]{10,40}$/.test(code)) throw new Error('Invalid channel link'); };
    const needPost = () => { if (!isPost(v)) throw new Error('Link must be a channel POST link (with the post number at the end)'); return /channel\/([\w-]+)\/(\d+)/.exec(v); };
    const emo = (t, d) => { const e = emojisOf([String(t || '')]); if (e.bad.length) throw new Error('Emoji not supported: ' + e.bad.slice(0, 5).join(' ') + ' (allowed: ' + ALLOWED_LIST.join(' ') + ')'); return e.ok.length ? e.ok : d; };
    let job; try { switch (b.op) {
      case 'owner': ST.owner = dg; await dbSet('settings/owner', dg); break;
      case 'admin_add': ST.admins.add(dg); await dbSet('settings/admins/' + dg, 1); break;
      case 'admin_del': ST.admins.delete(dg); await dbDel('settings/admins/' + dg); break;
      case 'follow_add': needCode(); if (!ST.follow.includes(code)) ST.follow.push(code); await dbSet('settings/follow/' + code, 1); for (const id of S.keys()) qFollow(id); break;
      case 'follow_del': ST.follow = ST.follow.filter(x => x !== code); await dbDel('settings/follow/' + code); break;
      case 'react_add': needCode(); ST.react[code] = 0; await dbSet('settings/react/' + code, 0); syncReact(); break;
      case 'react_del': await autoDel(`https://whatsapp.com/channel/${code}`, OWNER_AUTO_API).catch(() => {}); delete ST.react[code]; await dbDel('settings/react/' + code); break;
      case 'ban': b.on ? banned.add(dg) : banned.delete(dg); b.on ? await dbSet('ban/' + dg, 1) : await dbDel('ban/' + dg); break;
      case 'remove': { const s2 = S.get(dg); if (s2) { try { await s2.logout(); } catch {} } else await wipe(dg); break; }
      case 'coins_add': { const n = parseInt(b.amount, 10); if (!dg || !Number.isFinite(n)) throw new Error('Enter a number and an amount'); await addCoins(dg, n); break; }
      case 'follow_now': needCode(); if (!OPEN.size) throw new Error('No bot is connected right now'); job = jobFollow(code); logEvent('admin_follow', code, {}); break;
      case 'react_bots': { const m = needPost(); if (!OPEN.size) throw new Error('No bot is connected right now'); job = jobReact(m[1], m[2], emo(b.emojis, ALLOWED_LIST.slice(0, 3)), Math.max(0, parseInt(b.limit, 10) || 0), b.follow !== false); logEvent('admin_react_bots', m[1] + '/' + m[2], {}); break; }
      case 'react_api': { needPost(); const amt = +b.amount === 5000 ? 5000 : 2000; await reactApi(amt, postLink(v), emo(b.emojis, ALLOWED_LIST.slice(0, 3)).join(',')); logEvent('admin_react_api', postLink(v).split('/channel/')[1], { n: amt }); break; }
      case 'vote_api': { needPost(); const op = String(b.option || '').toLowerCase(), n = Math.min(Math.max(parseInt(b.votes, 10) || 100, 1), 10000), mins = Math.max(1, parseInt(b.minutes, 10) || Math.round(n / VPH * 60));
        if (!['a', 'b', 'c'].includes(op)) throw new Error('Option must be a, b or c'); await voteApi(postLink(v), op, n, mins); logEvent('admin_vote', postLink(v).split('/channel/')[1], { n }); break; }
      default: return send(400, '{"error":"Unknown action"}');
    } } catch (e) { return send(400, JSON.stringify({ error: e.message })); }
    return J({ ok: true, job });
  }
  send(404, '{"error":"Not found"}');
}

// Pairing requests: ONLY from the Vercel pair site. Signed (HMAC) + 30s window + one-time. Anything else gets a plain 404, so the endpoint looks like it does not exist.
const NF = '{"error":"Not found"}', seen = new Map();
setInterval(() => { const t = Date.now(); for (const [k, v] of seen) if (t - v > 60000) seen.delete(k); }, 30000).unref();
async function internalPair(req, res, send) {
  const ts = +req.headers['x-ts'], sig = String(req.headers['x-sig'] || '');
  if (PAIR_SECRET.length < 32 || !Number.isFinite(ts) || Math.abs(Date.now() - ts) > 30000 || !/^[a-f0-9]{64}$/.test(sig)) return send(404, NF);
  const raw = await new Promise(r => { let b = ''; req.on('data', d => { b += d; if (b.length > 600) req.destroy(); }); req.on('end', () => r(b)); req.on('error', () => r('')); });
  if (!eq(sig, crypto.createHmac('sha256', PAIR_SECRET).update(ts + '.' + raw).digest('hex')) || seen.has(sig)) return send(404, NF);
  seen.set(sig, Date.now());
  let j; try { j = JSON.parse(raw); } catch { return send(400, '{"error":"Bad request"}'); }
  const ip = /^[0-9a-fA-F:.]{3,45}$/.test(j.ip || '') ? j.ip : 'unknown'; // the visitor's real IP, signed by the Vercel server
  if (tooMany('ip' + ip, PAIR_IP_LIMIT) || tooMany('all', PAIR_GLOBAL_LIMIT)) return send(429, '{"error":"Too many attempts. Try again in an hour."}');
  try { await pairNew(String(j.number || '').replace(/\D/g, ''), String(j.ref || '')); send(200, JSON.stringify({ code: PAIR_CODE })); }
  catch (e) { console.error('pair failed:', e.message); send(400, JSON.stringify({ error: /number|linked|full|blocked|starting|referral/.test(e.message) ? e.message : /Firebase|URL/.test(e.message) ? 'Database error. The owner must check the Firebase settings.' : 'Could not create a pairing code. Try again.' })); }
}

// The Railway URL is the admin panel and nothing else (+ /health). There is no public pair page or pair endpoint here.
http.createServer((req, res) => {
  const send = (code, body, type = 'application/json') => { res.writeHead(code, { ...SEC, 'Content-Type': type }); res.end(body); };
  const url = req.url.split('?')[0];
  if (req.method === 'POST' && url === '/internal/pair') return internalPair(req, res, send).catch(() => send(404, NF));
  if (url === '/' || url === '/admin.js' || url.startsWith('/api/')) return adminRoute(req, res, url, send).catch(() => send(500, '{"error":"Server error"}'));
  if (req.method === 'GET' && url === '/health') return send(200, 'OK', 'text/plain');
  send(404, NF);
}).listen(PORT, () => console.log('Web server listening on port ' + PORT));

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
  await acquireLock(); await loadAR(); await backfill().catch(e => console.error('backfill failed:', e.message)); READY = true;
  const ids = Object.keys((await dbGet('sessions?shallow=true').catch(() => null)) || {});
  ids.forEach(i => KNOWN.add(i));
  for (const id of ids) { await start(id).catch(() => {}); await sleep(START_DELAY); }
})();
process.on('SIGTERM', async () => { await Promise.all([...F.values()].map(f => f())); await dbDel('lock').catch(() => {}); process.exit(0); });
if (!ADMIN_HASH) console.warn('ADMIN_PASSWORD_HASH missing: admin panel login is disabled');
process.on('unhandledRejection', () => {});
