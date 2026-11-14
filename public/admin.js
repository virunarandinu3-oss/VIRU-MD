const $ = s => document.querySelector(s), B = location.pathname.replace(/\/$/, '');
const el = (t, p = {}, ...k) => { const e = document.createElement(t); for (const [a, v] of Object.entries(p)) a === 'onclick' ? e.onclick = v : e.setAttribute(a, v); e.append(...k.flat().filter(x => x != null)); return e; };
const api = async (p, body) => {
  const r = await fetch(B + '/api/' + p, { method: body ? 'POST' : 'GET', headers: { 'X-Admin': '1', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (r.status === 401 && p !== 'login') show(false); if (!r.ok) throw new Error(j.error || 'Error'); return j; };
const fmt = n => Number(n || 0).toLocaleString(), mb = b => (b / 1048576).toFixed(0) + ' MB', ago = t => t ? new Date(t).toLocaleString() : '-', dur = s => `${s / 3600 | 0}h ${s / 60 % 60 | 0}m`;
const card = (k, v) => el('div', { class: 'c' }, el('small', {}, k), el('b', {}, v));
const table = (head, rows) => el('div', { class: 'tw' }, el('table', {}, el('tr', {}, head.map(h => el('th', {}, h))), rows.map(r => el('tr', {}, r.map(c => el('td', {}, c))))));
const btn = (t, f, c = '') => el('button', { class: 's ' + c, onclick: f }, t);
let tab = 'Overview', range = 'today', timer;
const show = on => { $('#login').hidden = on; $('#app').hidden = !on; if (on) go(tab); else clearInterval(timer); };

async function detail(id) {
  const d = await api('user?id=' + id), v = $('#view'); v.textContent = ''; clearInterval(timer);
  const days = Object.keys(d.usage).sort().reverse(), out = el('div');
  const sel = el('select', {}, el('option', { value: 'all' }, 'Lifetime'), days.map(x => el('option', { value: x }, x === d.today ? x + ' (today)' : x)));
  const draw = () => {
    const set = sel.value === 'all' ? days : [sel.value], cm = {}, ev = []; let re = 0, vo = 0;
    for (const x of set) { const u = d.usage[x]; re += u.reacts || 0; vo += u.votes || 0; for (const [k, n] of Object.entries(u.cmds || {})) cm[k] = (cm[k] || 0) + n; ev.push(...Object.values(u.ev || {})); }
    ev.sort((a, b) => b.t - a.t); out.textContent = '';
    out.append(el('div', { class: 'g' }, card('Commands', fmt(Object.values(cm).reduce((a, b) => a + b, 0))), card('Reacts sent', fmt(re)), card('Votes sent', fmt(vo))),
      el('h3', {}, 'Commands used'), table(['Command', 'Times'], Object.entries(cm).map(([k, n]) => ['.' + k, n])),
      el('h3', {}, 'Links used'), table(['Time', 'Cmd', 'Link', 'Count'], ev.slice(0, 100).map(e => [ago(e.t), e.c, e.l, e.n])));
  };
  sel.onchange = draw;
  v.append(btn('Back', () => go('Users')), el('h2', {}, id),
    el('p', {}, `Linked: ${ago(d.meta.linkedAt)} | Bot ${d.online ? 'online' : 'offline'} | Auto-react: ${d.cfg.arLink || 'none'} | Auto-react used: ${d.life.autoreact || 0}`),
    btn(d.banned ? 'Unban' : 'Ban', async () => { await api('act', { op: 'ban', value: id, on: !d.banned }); detail(id); }, 'bad'),
    d.online ? btn('Remove bot session', async () => { if (confirm('Logout ' + id + '?')) { await api('act', { op: 'remove', value: id }); go('Users'); } }, 'bad') : null, sel, out);
  draw();
}

const V = {
  async Overview(v) {
    const d = await api('overview?range=' + range), s = d.stats;
    v.append(el('div', {}, ['today', 'all'].map(r => btn(r === 'today' ? 'Today' : 'Lifetime', () => { range = r; go('Overview'); }, r === range ? 'on' : ''))),
      el('div', { class: 'g' }, card('Bots online', `${d.online} / ${d.max}`), card('Linked devices (stored)', fmt(d.stored)), card('New links', fmt(s.linked)), card('Logouts', fmt(s.logouts)),
        card('Commands used', fmt(s.cmds)), card('Reacts sent', fmt(s.reacts)), card('Votes sent', fmt(s.votes)), card('Follow cmds', fmt(s.follows)),
        card('RAM (rss)', mb(d.rss)), card('Heap used', mb(d.heap)), card('Uptime', dur(d.up))));
  },
  async Users(v) {
    const us = (await api('users')).sort((a, b) => b.last - a.last), box = el('div'), q = el('input', { placeholder: 'Search number' });
    const draw = () => { box.textContent = ''; box.append(table(['Number', 'Commands', 'Last seen', 'Status', ''], us.filter(u => u.id.includes(q.value)).map(u => [u.id, fmt(u.cmds), ago(u.last), (u.online ? 'bot online ' : '') + (u.banned ? 'banned' : ''), btn('Open', () => detail(u.id))]))); };
    q.oninput = draw; v.append(q, box); draw();
  },
  async Sessions(v) {
    const ss = (await api('sessions')).sort((a, b) => b.linkedAt - a.linkedAt);
    v.append(el('p', {}, `${ss.length} linked, ${ss.filter(x => x.online).length} online`), table(['Number', 'Status', 'Linked at', ''], ss.map(x => [x.id, x.online ? 'online' : 'offline', ago(x.linkedAt), btn('Remove', async () => { if (confirm('Logout ' + x.id + '?')) { await api('act', { op: 'remove', value: x.id }); go('Sessions'); } }, 'bad')])));
  },
  async Settings(v) {
    const s = await api('settings'), o = el('input', { value: s.owner, placeholder: '94XXXXXXXXX' });
    const list = (title, items, add, del, ph) => { const i = el('input', { placeholder: ph });
      return el('section', {}, el('h3', {}, title), table(['Value', ''], items.map(x => [x.label || x, btn('Remove', async () => { await api('act', { op: del, value: x.value || x }); go('Settings'); }, 'bad')])),
        i, btn('Add', async () => { if (i.value.trim()) try { await api('act', { op: add, value: i.value }); go('Settings'); } catch (e) { alert(e.message); } })); };
    v.append(el('section', {}, el('h3', {}, 'Owner number (country code, digits only)'), o, btn('Save', async () => { await api('act', { op: 'owner', value: o.value }); go('Settings'); })),
      list('Admin numbers (no limits)', s.admins, 'admin_add', 'admin_del', '94XXXXXXXXX'),
      list('Auto-follow channels (lifetime)', s.follow, 'follow_add', 'follow_del', 'Channel link'),
      list('Auto-react channels (owner)', Object.entries(s.react).map(([c, ok]) => ({ label: c + (ok ? ' (active)' : ' (pending)'), value: c })), 'react_add', 'react_del', 'Channel link'));
  },
  async Events(v) { v.append(table(['Time', 'Type', 'Number'], (await api('events')).map(e => [ago(e.t), e.type, e.id]))); }
};
async function go(t) {
  tab = t; clearInterval(timer); const v = $('#view'); v.textContent = ''; $('#nav').textContent = '';
  $('#nav').append(...Object.keys(V).map(k => btn(k, () => go(k), k === t ? 'on' : '')));
  try { await V[t](v); if (t === 'Overview') timer = setInterval(() => go('Overview'), 15000); } catch (e) { if (e.message !== 'Unauthorized') v.append(el('p', {}, e.message)); }
}
$('#go').onclick = async () => { try { await api('login', { password: $('#pw').value }); $('#pw').value = ''; $('#e').textContent = ''; show(true); } catch (e) { $('#e').textContent = e.message; } };
$('#pw').onkeydown = e => e.key === 'Enter' && $('#go').click();
$('#out').onclick = async () => { await api('logout', {}); show(false); };
api('overview').then(() => show(true)).catch(() => show(false));
