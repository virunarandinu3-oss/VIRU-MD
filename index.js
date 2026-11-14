const http = require('http'), fs = require('fs'), path = require('path');
const { default: makeWASocket, initAuthCreds, BufferJSON, proto, DisconnectReason, Browsers,
  makeCacheableSignalKeyStore, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const log = require('pino')({ level: 'silent' });
const E = { ...require('./config'), ...process.env }; // config.js holds everything; real env vars (if any) override
const DB = (E.FIREBASE_DB_URL || '').replace(/\/$/, ''), SECRET = E.FIREBASE_SECRET || '';
const PREFIX = E.PREFIX || '.', OWNER = (E.OWNER_NUMBER || '').replace(/\D/g, '');
const N = (k, d) => (E[k] !== undefined && E[k] !== '' && Number.isFinite(+E[k]) ? +E[k] : d);
const MAX = N('MAX_SESSIONS', 100), PORT = N('PORT', 3000);
const PAIR_CODE = (E.PAIR_CODE || 'VIRUDEVS').toUpperCase().replace(/[^A-Z0-9]/g, '');
if (PAIR_CODE.length !== 8) { console.error('PAIR_CODE must be exactly 8 letters/numbers'); process.exit(1); }
const BOT_NAME = E.BOT_NAME || 'VIRU DEVS';
const L = { creact: N('LIMIT_CREACT', 20), vote: N('LIMIT_VOTE', 3), followers: N('LIMIT_FOLLOWERS', 1), autoreact: N('LIMIT_AUTOREACT_LIFETIME', 1) };
const MAX_VOTES = N('MAX_VOTES', 3000), MAX_REACTS = N('MAX_REACTS', 4000);
const EMO_REACT = E.DEFAULT_REACT_EMOJIS || '❤️,🔥,👍', EMO_AUTO = E.DEFAULT_AUTOREACT_EMOJIS || '❤️,🔥,👍,🎉,⚡';
const CHANNELS = (E.AUTO_FOLLOW_CHANNELS || '').split(',').map(x => x.trim().split('/channel/').pop().split(/[?/]/)[0]).filter(Boolean);
const PAIR_IP_LIMIT = N('PAIR_IP_LIMIT', 4), PAIR_GLOBAL_LIMIT = N('PAIR_GLOBAL_LIMIT', 60);
const FOLLOW_DELAY = N('FOLLOW_DELAY_MS', 2000), START_DELAY = N('START_DELAY_MS', 2500);
const crypto = require('crypto');
const ADMIN_PATH = '/' + (E.ADMIN_PATH || 'admin').replace(/^\/+|\/+$/g, '');
const ADMIN_HASH = E.ADMIN_PASSWORD_HASH || '', KEYWORD = (E.VERIFY_KEYWORD || 'VIRUDEVS').toUpperCase(), OWNER_NAME = E.OWNER_NAME || 'VIRU Dev';
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
  const save = now => now ? flush() : (clearTimeout(t), t = setTimeout(flush, 3000));
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
    generateHighQualityLinkPreview: false, getMessage: async () => undefined });
  S.set(id, sock);
  const ready = new Promise(r => sock.ev.on('connection.update', u => u.qr && r()));
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
    setTimeout(() => start(id).catch(() => {}), 5000);
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

// ---------- Commands (public: anyone can use them, limits are per sender) ----------
const MENU = `*${BOT_NAME} BOT*

${PREFIX}menu  ${PREFIX}alive  ${PREFIX}ping
${PREFIX}pair <number>
${PREFIX}owner

🔒 Linked users only (send ${PREFIX}pair first):
${PREFIX}creact <post link> <count> <emojis>
${PREFIX}vote <post link> <a|b|c> <count>
${PREFIX}autoreact <your channel link> <emojis>
${PREFIX}autoreact off
${PREFIX}follow <channel link>
${PREFIX}respond

Channels for autoreact/follow must have "${KEYWORD}" in the description.`;
const lastCmd = new Map();
const num = j => (j || '').split('@')[0].split(':')[0];
const isCh = l => /whatsapp\.com\/channel\//.test(l || '');
const isPost = l => /whatsapp\.com\/channel\/[\w-]+\/\d+/.test(l || '');
const codeOf = l => l.split('/channel/')[1].split(/[?/]/)[0];
const getCfg = async u => { if (!cfg.has(u)) { if (cfg.size > 3000) cfg.clear(); cfg.set(u, (await dbGet('cfg/' + u)) || {}); } return cfg.get(u); };
const saveCfg = (u, c) => { cfg.set(u, c); return Object.keys(c).length ? dbSet('cfg/' + u, c) : dbDel('cfg/' + u); };
const allow = async (u, p, max) => staff(u) || canUse(p, max);
const mark = (u, p) => staff(u) ? 0 : markUse(p);
async function verified(sock, link) {
  const meta = await sock.newsletterMetadata('invite', codeOf(link));
  if (!(meta.description || '').toUpperCase().includes(KEYWORD)) throw new Error(`Add "${KEYWORD}" to your channel description first.`);
  return meta;
}

async function handle(sock, id, m) {
  const jid = m.key.remoteJid;
  if (!m.message || !jid || jid === 'status@broadcast' || jid.endsWith('@newsletter')) return;
  const txt = m.message.conversation || m.message.extendedTextMessage?.text || '';
  if (!txt.startsWith(PREFIX)) return;
  const u = m.key.fromMe ? id : num(m.key.participant || jid);
  if (!u || banned.has(u)) return;
  const now = Date.now(); if (now - (lastCmd.get(u) || 0) < COOLDOWN) return;
  lastCmd.set(u, now); if (lastCmd.size > 5000) lastCmd.clear();
  const [cmd, ...a] = txt.slice(PREFIX.length).trim().split(/\s+/), cm = cmd.toLowerCase();
  const reply = t => sock.sendMessage(jid, { text: t }, { quoted: m }), o = {};
  if (['creact', 'vote', 'autoreact', 'follow', 'followers', 'respond'].includes(cm) && !KNOWN.has(u) && !staff(u))
    return reply(`🔒 ${PREFIX}${cm} is only for linked users.\n\nSend *${PREFIX}pair <your number>* to link your WhatsApp as a linked device first.`);
  try {
    switch (cm) {
      case 'menu': await reply(MENU); break;
      case 'alive': { const s = (Date.now() - started) / 1000 | 0;
        await reply(`*${BOT_NAME}* alive\nUptime: ${s / 3600 | 0}h ${s / 60 % 60 | 0}m\nRAM: ${(process.memoryUsage().rss / 1048576) | 0} MB\nSessions: ${S.size}/${MAX}`); break; }
      case 'ping': { const t = Date.now(); await reply('Pinging...'); await reply(`${Date.now() - t} ms`); break; }
      case 'pair': { const n = (a[0] || '').replace(/\D/g, ''), p = dayKey(u, 'pair');
        if (!(await allow(u, p, LIMIT_PAIR))) return reply(`Daily limit reached (${LIMIT_PAIR}/day).`);
        await pairNew(n); await mark(u, p);
        await reply(`Open WhatsApp > Linked devices > Link with phone number.\nCode: *${PAIR_CODE}*`); break; }
      case 'owner': await sock.sendMessage(jid, { contacts: { displayName: OWNER_NAME,
        contacts: [{ vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${OWNER_NAME}\nTEL;type=CELL;waid=${ST.owner}:+${ST.owner}\nEND:VCARD` }] } }); break;
      case 'creact': { if (!isPost(a[0])) return reply(`Usage: ${PREFIX}creact <post link> <count 1-${MAX_REACTS}> <emojis>`);
        let n = MAX_REACTS, em = EMO_REACT;
        for (const x of a.slice(1)) /^\d+$/.test(x) ? n = Math.min(Math.max(+x, 1), MAX_REACTS) : em = x;
        const p = dayKey(u, 'creact'); if (!(await allow(u, p, L.creact))) return reply(`Daily limit reached (${L.creact}/day).`);
        await reactApi({ link: a[0], emojis: em, reacts: n, hours: 0, minutes: 1 }); await mark(u, p);
        Object.assign(o, { reacts: n, link: a[0] }); await reply(`✅ ${n} reacts on the way.`); break; }
      case 'vote': { const op = (a[1] || '').toLowerCase(), n = Math.min(Math.max(+a[2] || 100, 1), MAX_VOTES);
        if (!isPost(a[0]) || !['a', 'b', 'c'].includes(op)) return reply(`Usage: ${PREFIX}vote <post link> <a|b|c> <count 1-${MAX_VOTES}>`);
        const p = dayKey(u, 'vote'); if (!(await allow(u, p, L.vote))) return reply(`Daily limit reached (${L.vote}/day).`);
        const mins = voteMins(n);
        await voteApi({ link: a[0], option: op, votes: n, hours: mins / 60 | 0, minutes: mins % 60 }); await mark(u, p);
        Object.assign(o, { votes: n, link: a[0] }); await reply(`✅ ${n} votes for option ${op.toUpperCase()} on the way (over ${mins} min).`); break; }
      case 'autoreact': { const c = await getCfg(u);
        if ((a[0] || '').toLowerCase() === 'off') {
          if (!c.arLink) return reply('Auto react is not active.');
          await autoApi('delete', c.arLink); delete c.arLink; await saveCfg(u, c);
          await reply('Auto react: OFF. Your lifetime use is spent.'); break; }
        if (!isCh(a[0])) return reply(`Usage: ${PREFIX}autoreact <your channel link> <emojis>\n${PREFIX}autoreact off\nLifetime limit: ${L.autoreact} use.`);
        if (c.arLink) return reply(`Already active. Use ${PREFIX}autoreact off to remove it.`);
        const p = `lifetime/${u}/autoreact`; if (!(await allow(u, p, L.autoreact))) return reply('Lifetime limit reached.');
        await verified(sock, a[0]); await autoApi('add', a[0], a[1] || EMO_AUTO); await mark(u, p);
        c.arLink = a[0]; await saveCfg(u, c); o.link = a[0]; await reply('✅ Auto react ON for your channel.'); break; }
      case 'follow': case 'followers': { if (!isCh(a[0])) return reply(`Usage: ${PREFIX}follow <channel link>`);
        const p = dayKey(u, 'followers'); if (!(await allow(u, p, L.followers))) return reply(`Daily limit reached (${L.followers}/day).`);
        const jid2 = (await verified(sock, a[0])).id; await mark(u, p); o.link = a[0];
        await reply(`✅ Started with ${S.size} bots.`);
        (async () => { for (const [, s2] of S) { try { await s2.newsletterFollow(jid2); } catch {} await sleep(FOLLOW_DELAY / 2 + Math.random() * FOLLOW_DELAY); } })();
        break; }
      case 'respond': await reply('🚧 Coming soon...'); break;
      default: return;
    }
    track(u, cm === 'followers' ? 'follow' : cm, o);
  } catch (e) { reply('❌ ' + (e.message || 'Error').slice(0, 120)).catch(() => {}); }
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
      } catch (e) { console.error('pair failed:', e.message); send(400, JSON.stringify({ error: /number|linked|full|blocked/.test(e.message) ? e.message : /Firebase|URL/.test(e.message) ? 'Database error. The owner must check the Firebase settings.' : 'Could not create a pairing code. Try again.' })); }
    });
    return;
  }
  send(404, '{"error":"Not found"}');
}).listen(PORT);

// ---------- Boot ----------
(async () => {
  try { if (!DB || !SECRET) throw new Error('FIREBASE_DB_URL / FIREBASE_SECRET are empty in config.js'); await dbSet('health', Date.now()); console.log('Firebase OK'); }
  catch (e) { console.error('Firebase FAILED:', e.message); }
  await loadSettings().catch(() => {}); syncReact();
  const ids = Object.keys((await dbGet('sessions?shallow=true').catch(() => null)) || {});
  ids.forEach(i => KNOWN.add(i));
  for (const id of ids) { await start(id).catch(() => {}); await sleep(START_DELAY); }
})();
process.on('SIGTERM', async () => { await Promise.all([...F.values()].map(f => f())); process.exit(0); });
if (!ADMIN_HASH) console.warn('ADMIN_PASSWORD_HASH missing: admin panel login is disabled');
process.on('unhandledRejection', () => {});
