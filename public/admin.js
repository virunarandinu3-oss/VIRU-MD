'use strict';
// ============================================================
//  VIRU DEVS admin panel (no libraries: charts are plain SVG)
//  All text from the server goes in through textContent / text nodes only.
// ============================================================
const $ = s => document.querySelector(s), SVN = 'http://www.w3.org/2000/svg';
const kids = (e, k) => { for (const x of k.flat(Infinity)) if (x != null && x !== false) e.append(x.nodeType ? x : String(x)); };
const el = (t, p = {}, ...k) => { const e = document.createElement(t);
  for (const [a, v] of Object.entries(p)) { if (v == null || v === false) continue;
    if (a === 'class') e.className = v; else if (a.startsWith('on') || a === 'value' || a === 'checked' || a === 'disabled') e[a] = v; else e.setAttribute(a, v === true ? '' : v); }
  kids(e, k); return e; };
const sv = (t, p = {}, ...k) => { const e = document.createElementNS(SVN, t); for (const [a, v] of Object.entries(p)) if (v != null) e.setAttribute(a, v); kids(e, k); return e; };

// ---------- api ----------
const api = async (p, body) => {
  const r = await fetch('/api/' + p, { method: body ? 'POST' : 'GET', headers: { 'X-Admin': '1', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && p !== 'login') { showApp(false); throw new Error('Unauthorized'); }
  if (!r.ok) throw new Error(j.error || 'Error ' + r.status);
  return j;
};

// ---------- formats ----------
const fmt = n => Number(n || 0).toLocaleString();
const compact = n => { n = Number(n || 0); const a = Math.abs(n); return a >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : a >= 1e4 ? (n / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'K' : Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1); };
const mb = b => (b / 1048576).toFixed(b < 1e8 ? 1 : 0) + ' MB';
const dt = t => t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '-';
const ago = t => { if (!t) return '-'; const s = (Date.now() - t) / 1000 | 0; return s < 60 ? 'just now' : s < 3600 ? (s / 60 | 0) + 'm ago' : s < 86400 ? (s / 3600 | 0) + 'h ago' : (s / 86400 | 0) + 'd ago'; };
const dur = s => s >= 86400 ? `${s / 86400 | 0}d ${s / 3600 % 24 | 0}h` : `${s / 3600 | 0}h ${s / 60 % 60 | 0}m`;
const md = d => d.slice(5);
const hm = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const short = (c, n = 16) => c.length > n ? c.slice(0, n) + '…' : c;
const codeOfLink = l => { const m = /channel\/([\w-]+)/.exec(l || ''); return m ? m[1] : ''; };

// ---------- ui bits ----------
const toast = (m, err) => { const t = el('div', { class: 'toast' + (err ? ' err' : '') }, (err ? '✕ ' : '✓ ') + m); $('#toasts').append(t); setTimeout(() => t.remove(), 4200); };
const tipEl = $('#tip');
const showTip = (x, y, title, rows) => {
  tipEl.replaceChildren(el('div', { class: 't' }, title), ...rows.map(([c, v, n]) => el('div', { class: 'r' }, c ? el('i', { style: 'border-color:' + c }) : null, el('b', {}, v), el('span', { style: 'color:var(--t3)' }, n || ''))));
  tipEl.hidden = false; const w = tipEl.offsetWidth, h = tipEl.offsetHeight; let l = x + 14, t = y - h - 10; if (l + w > innerWidth - 8) l = x - w - 14; if (t < 8) t = y + 16; tipEl.style.left = Math.max(8, l) + 'px'; tipEl.style.top = t + 'px'; };
const hideTip = () => { tipEl.hidden = true; };
const btn = (t, f, c = '') => el('button', { class: c, onclick: f, type: 'button' }, t);
const chip = (t, k = '') => el('span', { class: 'chip ' + k }, t);
const status = on => on ? chip('● Online', 'ok') : chip('○ Offline', 'off');
const seg = (opts, cur, set) => el('div', { class: 'seg' }, opts.map(([v, l]) => btn(l, () => set(v), v === cur ? 'on' : '')));
async function act(body, ok, then) { try { const r = await api('act', body); toast(ok || 'Done'); if (then) await then(r); return r; } catch (e) { if (e.message !== 'Unauthorized') toast(e.message, true); } }

// ---------- charts ----------
const niceMax = m => { if (m <= 4) return 4; const r = m / 4, p = 10 ** Math.floor(Math.log10(r)); return 4 * p * [1, 2, 5, 10].find(k => k * p >= r); }; // 4 clean steps (whole numbers)
const xIdx = n => [...new Set(Array.from({ length: Math.min(6, n) }, (_, k) => Math.round(k * (n - 1) / Math.max(1, Math.min(6, n) - 1))))];
function frame(W, h, l, r, t, b, max, labels, label) {
  const n = labels.length, pw = W - l - r, ph = h - t - b, Y = v => t + ph - v / max * ph, s = sv('svg', { viewBox: `0 0 ${W} ${h}`, role: 'img', 'aria-label': label, tabindex: 0 });
  for (let i = 0; i <= 4; i++) { const y = Y(max * i / 4); s.append(sv('line', { class: 'gl', x1: l, x2: W - r, y1: y, y2: y }), sv('text', { class: 'ax', x: l - 6, y: y + 4, 'text-anchor': 'end' }, compact(max * i / 4))); }
  return { s, Y, pw, ph };
}
function lineChart({ labels, series, fv = fmt, fx = x => x, h = 210, area = false, label = '' }) {
  const W = 640, l = 42, r = 46, t = 12, b = 26, n = labels.length, max = niceMax(Math.max(0, ...series.flatMap(s => s.values)));
  const { s, Y, pw, ph } = frame(W, h, l, r, t, b, max, labels, label), X = i => l + (n < 2 ? pw / 2 : i * pw / (n - 1));
  xIdx(n).forEach((i, k, a) => s.append(sv('text', { class: 'ax', x: X(i), y: h - 6, 'text-anchor': k === 0 && n > 1 ? 'start' : k === a.length - 1 && n > 1 ? 'end' : 'middle' }, fx(labels[i]))));
  let prevY = -99;
  series.forEach(sr => {
    const d = sr.values.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join('');
    if (area && series.length === 1 && n > 1) s.append(sv('path', { d: d + `L${X(n - 1)},${t + ph}L${X(0)},${t + ph}Z`, fill: sr.color, opacity: .1 }));
    s.append(sv('path', { class: 'ln', d, stroke: sr.color }));
  });
  series.forEach(sr => { const v = sr.values[n - 1], y = Y(v); s.append(sv('circle', { cx: X(n - 1), cy: y, r: 4, fill: sr.color, stroke: '#1a1a19', 'stroke-width': 2 }));
    if (Math.abs(y - prevY) >= 14) { s.append(sv('text', { class: 'lbl', x: X(n - 1) + 9, y: y + 4 }, compact(v))); prevY = y; } });
  const cx = sv('line', { class: 'cx', y1: t, y2: t + ph, visibility: 'hidden' }), dots = series.map(sr => sv('circle', { r: 4, fill: sr.color, stroke: '#1a1a19', 'stroke-width': 2, visibility: 'hidden' }));
  const hit = sv('rect', { x: l, y: t, width: pw, height: ph, fill: 'transparent' }); s.append(cx, ...dots, hit);
  const at = (i, px, py) => { cx.setAttribute('x1', X(i)); cx.setAttribute('x2', X(i)); cx.setAttribute('visibility', 'visible');
    dots.forEach((d, k) => { d.setAttribute('cx', X(i)); d.setAttribute('cy', Y(series[k].values[i])); d.setAttribute('visibility', 'visible'); });
    showTip(px, py, fx(labels[i]), series.map(sr => [sr.color, fv(sr.values[i]), sr.name])); };
  const off = () => { cx.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); hideTip(); };
  let cur = n - 1;
  hit.addEventListener('pointermove', e => { const bb = s.getBoundingClientRect(), x = (e.clientX - bb.left) * W / bb.width; cur = Math.max(0, Math.min(n - 1, Math.round((x - l) / (pw / Math.max(1, n - 1))))); at(cur, e.clientX, e.clientY); });
  hit.addEventListener('pointerleave', off); s.addEventListener('blur', off);
  s.addEventListener('keydown', e => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault(); cur = Math.max(0, Math.min(n - 1, cur + (e.key === 'ArrowLeft' ? -1 : 1))); const bb = s.getBoundingClientRect(); at(cur, bb.left + X(cur) * bb.width / W, bb.top + 40); });
  return el('div', { class: 'ch' }, s);
}
function barChart({ labels, values, color, fv = fmt, fx = x => x, name = '', h = 190, label = '' }) {
  const W = 640, l = 42, r = 12, t = 12, b = 26, n = labels.length, max = niceMax(Math.max(0, ...values));
  const { s, Y, pw, ph } = frame(W, h, l, r, t, b, max, labels, label), band = pw / n, bw = Math.min(24, band * .7);
  xIdx(n).forEach(i => s.append(sv('text', { class: 'ax', x: l + band * i + band / 2, y: h - 6, 'text-anchor': 'middle' }, fx(labels[i]))));
  values.forEach((v, i) => { const x = l + band * i + (band - bw) / 2, y = Y(v), hh = t + ph - y;
    if (v > 0) { const q = Math.min(4, bw / 2, hh); s.append(sv('path', { class: 'b', fill: color, d: `M${x},${y + hh}L${x},${y + q}Q${x},${y} ${x + q},${y}L${x + bw - q},${y}Q${x + bw},${y} ${x + bw},${y + q}L${x + bw},${y + hh}Z` })); }
    const hit = sv('rect', { x: l + band * i, y: t, width: band, height: ph, fill: 'transparent' });
    hit.addEventListener('pointermove', e => showTip(e.clientX, e.clientY, fx(labels[i]), [[color, fv(v), name]])); hit.addEventListener('pointerleave', hideTip); s.append(hit); });
  const last = values[n - 1]; if (last > 0) s.append(sv('text', { class: 'lbl', x: l + band * (n - 1) + band / 2, y: Y(last) - 6, 'text-anchor': 'middle' }, compact(last)));
  return el('div', { class: 'ch' }, s);
}
function spark(values, color) {
  const w = 84, h = 30, n = values.length, mx = Math.max(1, ...values), X = i => 4 + (n < 2 ? 38 : i * (w - 8) / (n - 1)), Y = v => h - 5 - v / mx * (h - 10);
  return sv('svg', { class: 'sp', width: w, height: h, viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true' },
    sv('path', { d: values.map((v, i) => (i ? 'L' : 'M') + X(i) + ',' + Y(v)).join(''), fill: 'none', stroke: 'var(--t3)', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    sv('circle', { cx: X(n - 1), cy: Y(values[n - 1]), r: 4, fill: color, stroke: '#1a1a19', 'stroke-width': 2 }));
}
function hbars(list, color = 'var(--c1)') {
  if (!list.length) return el('div', { class: 'empty' }, 'No data yet');
  const mx = Math.max(1, ...list.map(x => x.n));
  return el('div', {}, list.map(x => { const row = el('div', { class: 'hb' }, el('span', { class: 'nm', title: x.name }, x.name), el('div', { class: 'tr' }, el('div', { class: 'bar', style: `width:${Math.max(1, x.n / mx * 78)}%;background:${color}` }), el('span', { class: 'v' }, fmt(x.n))));
    row.onpointermove = e => showTip(e.clientX, e.clientY, x.name, [[color, fmt(x.n), x.note || '']]); row.onpointerleave = hideTip; return row; }));
}
function table(head, rows, o = {}) {
  if (!rows.length) return el('div', { class: 'empty' }, o.empty || 'No data yet');
  return el('div', { class: 'tw' }, el('table', {}, el('thead', {}, el('tr', {}, head.map((h, i) => el('th', { class: (o.num || []).includes(i) ? 'n' : '' }, h)))),
    el('tbody', {}, rows.map(r => el('tr', {}, r.map((c, i) => el('td', { class: ((o.num || []).includes(i) ? 'n ' : '') + ((o.wrap || []).includes(i) ? 'w' : '') }, c))))))); }
// a chart card with a legend and a "Table" switch (every chart value is reachable without hovering)
function chartCard(title, sub, chart, legend, tb) {
  const box = el('div'), tview = tb ? table(tb.head, tb.rows, { num: tb.num || [] }) : null; let showT = false;
  const sw = tb ? btn('Table', () => { showT = !showT; box.replaceChildren(showT ? tview : chart); sw.textContent = showT ? 'Chart' : 'Table'; }, 'tbtn') : null; box.append(chart);
  return el('div', { class: 'card' }, el('div', { class: 'hd' }, el('div', {}, el('h3', {}, title), el('div', { class: 'sub' }, sub)), sw),
    legend && legend.length > 1 ? el('div', { class: 'lg' }, legend.map(([n, c]) => el('span', {}, el('i', { style: 'border-color:' + c }), n))) : null, box);
}
const tile = (k, v, sub, sp) => el('div', { class: 'tile' }, el('small', {}, k), el('b', {}, v), el('i', {}, sub || ''), sp || null);

// ---------- state / routing ----------
const st = { days: 30, cmdRange: 'today', q: '', filter: 'all', sort: { k: 'linkedAt', d: -1 }, evType: 'all', uq: '' };
let timer = 0, tok = 0;
const later = (f, ms) => { clearTimeout(timer); timer = setTimeout(f, ms); };
const ICON = { dashboard: 'M3 13h8V3H3zM13 21h8V11h-8zM13 3v6h8V3zM3 21h8v-6H3z', bots: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2', channels: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM16 8a5 5 0 0 1 0 8',
  boost: 'M13 2L4 14h7l-1 8 9-12h-7z', events: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' };
const NAV = [['dashboard', 'Dashboard'], ['bots', 'Bots'], ['channels', 'Channels'], ['boost', 'Boost'], ['events', 'Events'], ['settings', 'Settings']];
const go = h => { location.hash = h; };
function showApp(on) { $('#login').hidden = on; $('#app').hidden = !on; if (on) route(); else { clearTimeout(timer); tok++; } }
function route() {
  const [, page = 'dashboard', arg = ''] = location.hash.split('/'), my = ++tok, v = $('#view'); clearTimeout(timer); hideTip();
  $('#nav').replaceChildren(...NAV.map(([k, n]) => { const a = el('a', { class: (page === k || (page === 'bot' && k === 'bots')) ? 'on' : '', onclick: () => go('#/' + k) }, sv('svg', { viewBox: '0 0 24 24' }, sv('path', { d: ICON[k] })), el('span', {}, n)); return a; }));
  const V = { dashboard, bots, bot: () => bot(arg), channels, boost, events, settings }[page] || dashboard;
  Promise.resolve(V(my)).catch(e => { if (e.message !== 'Unauthorized' && my === tok) v.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'empty' }, 'Error: ' + e.message))); });
}
addEventListener('hashchange', route);
// put new content in without blanking the screen (keeps the old frame until the data is ready)
const paint = (my, ...nodes) => { if (my !== tok) return false; const v = $('#view'); v.replaceChildren(...nodes); return true; };
const head = (title, ...right) => el('div', { class: 'top' }, el('h2', {}, title), ...right);

// ---------- Dashboard ----------
async function dashboard(my) {
  const [o, tr, cm] = await Promise.all([api('overview'), api('trend?days=' + st.days), api('cmds?range=' + st.cmdRange)]);
  const T = o.today, A = o.all, L = x => tr.map(r => r[x]), lab = tr.map(r => r.d), sm = o.samples || [];
  const heapPct = o.rss / o.heapLimit * 100;
  const tiles = el('div', { class: 'g' },
    tile('Bots online', `${o.online} / ${o.max}`, `${o.running} sessions running`, sm.length > 1 ? spark(sm.map(x => x.on), 'var(--c3)') : null),
    tile('Linked devices (total)', fmt(o.stored), `${fmt(A.linked)} linked all time`),
    tile('Linked today', fmt(T.linked), 'new bots today', spark(L('linked').slice(-12), 'var(--c1)')),
    tile('Logouts today', fmt(T.logouts), `net ${(T.linked || 0) - (T.logouts || 0) >= 0 ? '+' : ''}${(T.linked || 0) - (T.logouts || 0)} today`, spark(L('logouts').slice(-12), 'var(--c2)')),
    tile('Commands today', fmt(T.cmds), `${fmt(A.cmds)} all time`, spark(L('cmds').slice(-12), 'var(--c1)')),
    tile('Reacts today', fmt(T.reacts), `${fmt(A.reacts)} all time`, spark(L('reacts').slice(-12), 'var(--c1)')),
    tile('Votes today', fmt(T.votes), `${fmt(A.votes)} all time`),
    tile('Follow cmds today', fmt(T.follows), `${fmt(A.follows)} all time`),
    tile('RAM (rss)', mb(o.rss), `heap ${mb(o.heap)} / ${mb(o.heapLimit)}`),
    tile('Uptime', dur(o.up), `Node ${o.node}`),
    tile('Auto-react jobs', fmt(o.ar), `${o.banned} banned numbers`));
  const ramSeries = [{ name: 'RAM (rss)', color: 'var(--c1)', values: sm.map(x => +(x.rss / 1048576).toFixed(1)) }, { name: 'Heap used', color: 'var(--c3)', values: sm.map(x => +(x.heap / 1048576).toFixed(1)) }];
  const meterCol = heapPct > 85 ? 'var(--bad)' : heapPct > 65 ? 'var(--warn)' : 'var(--c3)';
  const ramCard = el('div', { class: 'card' }, el('div', { class: 'hd' }, el('div', {}, el('h3', {}, 'Memory'), el('div', { class: 'sub' }, 'RAM used by the bot process, last 3 hours'))),
    el('div', { class: 'row', style: 'margin-bottom:10px' }, el('b', {}, mb(o.rss)), el('span', { class: 'note' }, `of ${mb(o.heapLimit)} heap limit`), chip(heapPct > 85 ? '⚠ High' : heapPct > 65 ? '⚠ Warm' : '✓ Healthy', heapPct > 85 ? 'bad' : heapPct > 65 ? 'warn' : 'ok')),
    el('div', { class: 'meter', style: 'margin-bottom:12px' }, el('b', { style: `width:${Math.min(100, heapPct).toFixed(1)}%;background:${meterCol}` })),
    sm.length > 1 ? el('div', {}, el('div', { class: 'lg' }, ramSeries.map(s => el('span', {}, el('i', { style: 'border-color:' + s.color }), s.name))), lineChart({ labels: sm.map(x => x.t), series: ramSeries, fv: v => v + ' MB', fx: hm, h: 170, label: 'Memory over time' })) : el('div', { class: 'empty' }, 'Collecting samples (one every 30 s)…'));
  const onCard = el('div', { class: 'card' }, el('div', { class: 'hd' }, el('div', {}, el('h3', {}, 'Bots online'), el('div', { class: 'sub' }, 'Connected bots, last 3 hours'))),
    sm.length > 1 ? lineChart({ labels: sm.map(x => x.t), series: [{ name: 'Online bots', color: 'var(--c3)', values: sm.map(x => x.on) }], fx: hm, h: 170, area: true, label: 'Online bots over time' }) : el('div', { class: 'empty' }, 'Collecting samples…'));
  const cmdCard = el('div', { class: 'card' }, el('div', { class: 'hd' }, el('div', {}, el('h3', {}, 'Top commands'), el('div', { class: 'sub' }, 'What the bots are used for')),
    seg([['today', 'Today'], ['7', '7 days'], ['all', 'All time']], st.cmdRange, r => { st.cmdRange = r; route(); })),
    hbars(cm.slice(0, 12).map(x => ({ name: '.' + x.cmd, n: x.n }))));
  const pr = el('div', { class: 'top' }, el('h2', {}, 'Dashboard'), seg([[7, '7 days'], [14, '14 days'], [30, '30 days'], [90, '90 days']], st.days, d => { st.days = d; route(); }), btn('Refresh', route), el('span', { class: 'note' }, 'Updated ' + new Date().toLocaleTimeString()));
  const tb = f => ({ head: ['Date', ...f.map(x => x[0])], rows: tr.map(r => [r.d, ...f.map(x => fmt(r[x[1]]))]), num: f.map((_, i) => i + 1) });
  paint(my, pr, tiles,
    el('div', { class: 'grid2' },
      chartCard('Linked vs logged out', `Daily, last ${st.days} days`, lineChart({ labels: lab, series: [{ name: 'Linked', color: 'var(--c1)', values: L('linked') }, { name: 'Logouts', color: 'var(--c2)', values: L('logouts') }], fx: md, label: 'Linked and logged out per day' }), [['Linked', 'var(--c1)'], ['Logouts', 'var(--c2)']], tb([['Linked', 'linked'], ['Logouts', 'logouts']])),
      chartCard('Commands per day', `Last ${st.days} days`, barChart({ labels: lab, values: L('cmds'), color: 'var(--c1)', fx: md, name: 'Commands', label: 'Commands per day' }), null, tb([['Commands', 'cmds']]))),
    el('div', { class: 'grid2' },
      chartCard('Reacts per day', `Last ${st.days} days`, barChart({ labels: lab, values: L('reacts'), color: 'var(--c3)', fx: md, name: 'Reacts', label: 'Reacts per day' }), null, tb([['Reacts', 'reacts'], ['Votes', 'votes'], ['Follow cmds', 'follows']])), cmdCard),
    el('div', { class: 'grid2' }, ramCard, onCard));
  later(() => { if (my === tok) route(); }, 15000);
}

// ---------- Bots ----------
const COLS = [['id', 'Number'], ['online', 'Status'], ['linkedAt', 'Linked'], ['cmds', 'Commands', 1], ['reacts', 'Reacts', 1], ['votes', 'Votes', 1], ['coins', 'Coins', 1], ['ar', 'Auto-react', 1], ['last', 'Last active']];
async function bots(my) {
  const rows = await api('bots'), box = el('div'), q = el('input', { placeholder: 'Search number…', value: st.q, 'aria-label': 'Search number' });
  const draw = () => {
    const f = rows.filter(r => r.id.includes(st.q) && (st.filter === 'all' || (st.filter === 'online') === r.online)), { k, d } = st.sort;
    f.sort((a, b) => (typeof a[k] === 'string' ? a[k].localeCompare(b[k]) : (+a[k] || 0) - (+b[k] || 0)) * d);
    box.replaceChildren(el('div', { class: 'tw' }, el('table', {}, el('thead', {}, el('tr', {}, COLS.map(([key, h, n]) => el('th', { class: 's' + (n ? ' n' : ''), onclick: () => { st.sort = { k: key, d: st.sort.k === key ? -st.sort.d : -1 }; draw(); } }, h + (st.sort.k === key ? (st.sort.d > 0 ? ' ▲' : ' ▼') : ''))))),
      el('tbody', {}, f.map(r => el('tr', { class: 'k', onclick: () => go('#/bot/' + r.id) }, el('td', {}, r.id, r.banned ? ' ' : '', r.banned ? chip('banned', 'bad') : null), el('td', {}, status(r.online)), el('td', { title: dt(r.linkedAt) }, ago(r.linkedAt)),
        el('td', { class: 'n' }, fmt(r.cmds)), el('td', { class: 'n' }, fmt(r.reacts)), el('td', { class: 'n' }, fmt(r.votes)), el('td', { class: 'n' }, fmt(r.coins)), el('td', { class: 'n' }, fmt(r.ar)), el('td', { title: dt(r.last) }, ago(r.last))))))), f.length ? null : el('div', { class: 'empty' }, 'No bots match'));
  };
  q.oninput = () => { st.q = q.value.trim(); draw(); };
  const on = rows.filter(r => r.online).length, csv = () => { const t = [COLS.map(c => c[1]).join(','), ...rows.map(r => COLS.map(([k]) => k === 'linkedAt' || k === 'last' ? (r[k] ? new Date(r[k]).toISOString() : '') : r[k]).join(','))].join('\n');
    const a = el('a', { href: URL.createObjectURL(new Blob([t], { type: 'text/csv' })), download: 'bots.csv' }); a.click(); URL.revokeObjectURL(a.href); };
  const sf = el('div'); const mk = () => sf.replaceChildren(seg([['all', 'All'], ['online', 'Online'], ['offline', 'Offline']], st.filter, v => { st.filter = v; mk(); draw(); })); mk();
  paint(my, head('Bots', btn('Export CSV', csv), btn('Refresh', route)),
    el('div', { class: 'g' }, tile('Linked devices', fmt(rows.length)), tile('Online now', fmt(on)), tile('Offline', fmt(rows.length - on)), tile('Total commands', fmt(rows.reduce((a, r) => a + r.cmds, 0)), 'by these bots'), tile('Total reacts', fmt(rows.reduce((a, r) => a + r.reacts, 0)), 'by these bots')),
    el('div', { class: 'card' }, el('div', { class: 'row', style: 'margin-bottom:10px' }, el('div', { class: 'grow' }, q), sf), box));
  draw(); later(() => { if (my === tok && document.activeElement !== q) route(); }, 20000);
}

// ---------- One bot ----------
async function bot(id) {
  const my = tok, d = await api('user?id=' + id), days = Object.keys(d.usage).sort(), box = el('div');
  const sel = el('select', { 'aria-label': 'Period', style: 'width:auto;min-width:150px' }, el('option', { value: 'all' }, 'Lifetime'), [...days].reverse().map(x => el('option', { value: x }, x === d.today ? x + ' (today)' : x)));
  const draw = () => {
    const set = sel.value === 'all' ? days : [sel.value], cm = {}, ch = {}, ev = []; let re = 0, vo = 0;
    for (const x of set) { const u = d.usage[x]; re += u.reacts || 0; vo += u.votes || 0; for (const [k, n] of Object.entries(u.cmds || {})) cm[k] = (cm[k] || 0) + n; for (const e of Object.values(u.ev || {})) ev.push(e); }
    ev.sort((a, b) => b.t - a.t);
    for (const e of ev) { const c = codeOfLink(e.l) || '?', h = ch[c] ||= { reacts: 0, votes: 0, uses: 0, last: 0 }; if (e.c === 'vote') h.votes += e.n || 0; else h.reacts += e.n || 0; h.uses++; h.last = Math.max(h.last, e.t); }
    const last30 = Array.from({ length: 30 }, (_, i) => new Date(Date.now() + 19800000 - (29 - i) * 864e5).toISOString().slice(0, 10)), cmdTotal = Object.values(cm).reduce((a, b) => a + b, 0);
    box.replaceChildren(
      el('div', { class: 'g' }, tile('Commands', fmt(cmdTotal)), tile('Reacts sent', fmt(re)), tile('Votes sent', fmt(vo)), tile('Channels used', fmt(Object.keys(ch).length))),
      el('div', { class: 'grid2' },
        chartCard('Commands per day', 'Last 30 days', barChart({ labels: last30, values: last30.map(x => Object.values(d.usage[x]?.cmds || {}).reduce((a, b) => a + b, 0)), color: 'var(--c1)', fx: md, name: 'Commands', h: 170, label: 'Commands per day' }), null, { head: ['Date', 'Commands'], rows: last30.map(x => [x, fmt(Object.values(d.usage[x]?.cmds || {}).reduce((a, b) => a + b, 0))]), num: [1] }),
        el('div', { class: 'card' }, el('h3', {}, 'Commands used'), el('div', { class: 'sub' }, sel.value === 'all' ? 'Lifetime' : sel.value), hbars(Object.entries(cm).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ name: '.' + k, n }))))),
      el('div', { class: 'card' }, el('h3', {}, 'Channels this bot reacted / voted on'), el('div', { class: 'sub' }, 'Grouped by channel'),
        table(['Channel', 'Reacts', 'Votes', 'Times', 'Last used'], Object.entries(ch).sort((a, b) => b[1].reacts + b[1].votes - a[1].reacts - a[1].votes).map(([c, h]) => [c, fmt(h.reacts), fmt(h.votes), fmt(h.uses), ago(h.last)]), { num: [1, 2, 3], wrap: [0], empty: 'This bot has not used reacts or votes in this period' })),
      el('div', { class: 'sp' }),
      el('div', { class: 'card' }, el('h3', {}, 'Recent links'), el('div', { class: 'sub' }, 'Latest 100 posts used'),
        table(['Time', 'Command', 'Link', 'Count'], ev.slice(0, 100).map(e => [dt(e.t), '.' + e.c, e.l, fmt(e.n)]), { num: [3], wrap: [2] })));
  };
  sel.onchange = draw;
  const coin = el('input', { placeholder: 'Coins (e.g. 50 or -50)', type: 'number', style: 'max-width:200px' });
  paint(my, head(id, btn('← Back', () => go('#/bots')), btn('Refresh', route)),
    el('div', { class: 'card', style: 'margin-bottom:14px' }, el('div', { class: 'row' }, status(d.online), d.banned ? chip('banned', 'bad') : null, el('span', { class: 'note' }, `Linked ${dt(d.meta.linkedAt)}`), el('span', { class: 'note' }, `Coins: ${fmt(d.coins)}`)),
      el('div', { class: 'sp' }),
      el('div', { class: 'note' }, 'Auto-react: ' + (d.ar.length ? d.ar.map(x => short(codeOfLink(x.link), 14) + ' ' + (x.em || '') + (x.paid ? ' (paid)' : ' (free)')).join(' | ') : 'none')),
      el('div', { class: 'sp' }),
      el('div', { class: 'row' }, btn(d.banned ? 'Unban' : 'Ban', () => act({ op: 'ban', value: id, on: !d.banned }, d.banned ? 'Unbanned' : 'Banned', route), 'd'),
        d.online ? btn('Remove bot session', async () => { if (confirm('Logout ' + id + '?')) await act({ op: 'remove', value: id }, 'Bot removed', () => go('#/bots')); }, 'd') : null,
        coin, btn('Add coins', () => coin.value && act({ op: 'coins_add', value: id, amount: coin.value }, 'Coins updated', route)), el('span', { class: 'grow' }), sel)),
    box);
  draw();
}

// ---------- Channels ----------
async function channels(my) {
  const [c, top] = await Promise.all([api('channels'), api('chstats')]), nm = x => (x.name ? x.name + ' · ' : '') + short(x.code, 14);
  const addBox = (ph, op, text) => { const i = el('input', { placeholder: ph, 'aria-label': ph }); return el('div', { class: 'row', style: 'margin-top:12px' }, el('div', { class: 'grow' }, i), btn(text, () => i.value.trim() && act({ op, value: i.value }, 'Saved', route), 'p')); };
  paint(my, head('Channels', btn('Refresh', route)),
    el('div', { class: 'grid2' },
      el('div', { class: 'card' }, el('h3', {}, 'Auto-follow channels'), el('div', { class: 'sub' }, 'Every linked bot follows these for life (re-checked every 12 hours)'),
        table(['Channel', 'Followers', ''], c.follow.map(x => [nm(x), x.subs ? fmt(x.subs) : '-', btn('Remove', () => confirm('Remove from auto-follow?') && act({ op: 'follow_del', value: x.code }, 'Removed', route), 'sm d')]), { num: [1], empty: 'No channels' }), addBox('Channel link', 'follow_add', 'Add & follow')),
      el('div', { class: 'card' }, el('h3', {}, 'Owner auto-react channels'), el('div', { class: 'sub' }, 'New posts in these channels get reacts automatically'),
        table(['Channel', 'Status', ''], c.react.map(x => [nm(x), x.active ? chip('✓ Active', 'ok') : chip('… Pending', 'warn'), btn('Remove', () => confirm('Remove auto-react?') && act({ op: 'react_del', value: x.code }, 'Removed', route), 'sm d')]), { empty: 'No channels' }), addBox('Channel link', 'react_add', 'Add auto-react'))),
    el('div', { class: 'card' }, el('h3', {}, 'Channels users reacted / voted on'), el('div', { class: 'sub' }, 'Top 60 by total reacts + votes, from all bots'),
      table(['Channel', 'Reacts', 'Votes', 'Times', 'Followers', 'Last used'], top.map(x => [nm(x), fmt(x.reacts), fmt(x.votes), fmt(x.n), x.subs ? fmt(x.subs) : '-', ago(x.last)]), { num: [1, 2, 3, 4], empty: 'No reacts or votes recorded yet' })));
  if ([...c.follow, ...c.react, ...top.slice(0, 25)].some(x => !x.name)) later(() => { if (my === tok) route(); }, 6000); // names are fetched in the background
}

// ---------- Boost (actions on the active bots) ----------
function emojiPicker(list, pre) { const on = new Set(pre); const row = el('div', { class: 'emo' }, list.map(e => { const b = btn(e, () => { on.has(e) ? on.delete(e) : on.add(e); b.classList.toggle('on', on.has(e)); }, on.has(e) ? 'on' : ''); b.setAttribute('aria-label', e); return b; })); return { node: row, get: () => [...on].join('') }; }
async function boost(my) {
  const o = await api('overview'), jobsBox = el('div');
  const doJob = (b, fn) => async () => { b.disabled = true; try { await fn(); } finally { b.disabled = false; } };
  const f1 = el('input', { placeholder: 'https://whatsapp.com/channel/…' }), b1 = btn('Follow with all active bots', null, 'p'); b1.onclick = doJob(b1, () => act({ op: 'follow_now', value: f1.value }, 'Started', loadJobs));
  const f2 = el('input', { placeholder: 'https://whatsapp.com/channel/…/123' }), e2 = emojiPicker(o.emojis, o.emojis.slice(0, 3)), n2 = el('input', { type: 'number', min: 0, placeholder: '0 = all active bots', value: '' }), fo = el('input', { type: 'checkbox', checked: true, id: 'fo' }), b2 = btn('React with active bots', null, 'p');
  b2.onclick = doJob(b2, () => act({ op: 'react_bots', value: f2.value, emojis: e2.get(), limit: n2.value, follow: fo.checked }, 'Started', loadJobs));
  const f3 = el('input', { placeholder: 'https://whatsapp.com/channel/…/123' }), e3 = emojiPicker(o.emojis, o.emojis.slice(0, 3)), a3 = el('select', {}, el('option', { value: 2000 }, '2K reacts'), el('option', { value: 5000 }, '5K reacts')), b3 = btn('Send reacts (API)', null, 'p');
  b3.onclick = doJob(b3, () => act({ op: 'react_api', value: f3.value, emojis: e3.get(), amount: a3.value }, 'Request sent', loadJobs));
  const f4 = el('input', { placeholder: 'https://whatsapp.com/channel/…/123' }), o4 = el('select', {}, ['a', 'b', 'c'].map(x => el('option', { value: x }, 'Option ' + x.toUpperCase()))), n4 = el('input', { type: 'number', min: 1, max: o.maxVotes, placeholder: 'Votes', value: '100' }), b4 = btn('Send votes (API)', null, 'p');
  b4.onclick = doJob(b4, () => act({ op: 'vote_api', value: f4.value, option: o4.value, votes: n4.value }, 'Request sent', loadJobs));
  const loadJobs = async () => { const js = await api('jobs').catch(() => []); jobsBox.replaceChildren(...(js.length ? js.map(j => el('div', { class: 'job' }, el('div', { class: 'row' }, chip(j.type === 'follow' ? 'Follow' : 'React'), el('span', { class: 'grow note', title: j.target }, short(j.target, 34) + (j.note && j.type === 'react' ? ' · ' + j.note : '')), chip(j.status === 'running' ? '… Running' : j.status === 'done' ? '✓ Done' : '✕ Failed', j.status === 'done' ? 'ok' : j.status === 'failed' ? 'bad' : 'warn')),
    el('div', { class: 'note' }, `${j.done} / ${j.total} bots · ${j.ok} ok · ${j.fail} failed · ${ago(j.t)}${j.status === 'failed' && j.note ? ' · ' + j.note : ''}`), el('div', { class: 'meter' }, el('b', { style: `width:${j.total ? j.done / j.total * 100 : 100}%;background:var(--c1)` })))) : [el('div', { class: 'empty' }, 'No actions yet')]));
    if (js.some(j => j.status === 'running') && my === tok) later(loadJobs, 2000); };
  const lab = (t, n) => [el('label', {}, t), n];
  paint(my, head('Boost', el('span', { class: 'chip ' + (o.online ? 'ok' : 'bad') }, (o.online ? '● ' : '○ ') + o.online + ' active bots'), btn('Refresh', route)),
    el('div', { class: 'grid2' },
      el('div', { class: 'card' }, el('h3', {}, 'Follow a channel'), el('div', { class: 'sub' }, 'Every connected bot follows the channel (one by one, with a short pause)'), el('div', { class: 'frm' }, lab('Channel link', f1), b1)),
      el('div', { class: 'card' }, el('h3', {}, 'React with active bots'), el('div', { class: 'sub' }, 'Each chosen bot reacts to the post itself with a random emoji from your selection'),
        el('div', { class: 'frm' }, lab('Post link (with post number)', f2), el('label', {}, 'Emojis'), e2.node, lab('How many bots', n2), el('label', { style: 'display:flex;gap:8px;align-items:center;color:var(--t2)' }, fo, 'Follow the channel first'), b2))),
    el('div', { class: 'grid2' },
      el('div', { class: 'card' }, el('h3', {}, 'Reacts through the owner API'), el('div', { class: 'sub' }, 'Uses the react API (2K or 5K), no bot needed'), el('div', { class: 'frm' }, lab('Post link', f3), el('label', {}, 'Emojis'), e3.node, lab('Amount', a3), b3)),
      el('div', { class: 'card' }, el('h3', {}, 'Poll votes through the owner API'), el('div', { class: 'sub' }, `Delivery speed about ${o.vph} votes per hour`), el('div', { class: 'frm' }, lab('Poll post link', f4), el('div', { class: 'two' }, el('div', {}, el('label', {}, 'Option'), o4), el('div', {}, el('label', {}, 'Votes'), n4)), b4))),
    el('div', { class: 'card' }, el('h3', {}, 'Recent actions'), el('div', { class: 'sub' }, 'Progress of follow and react jobs'), jobsBox));
  await loadJobs();
}

// ---------- Events ----------
async function events(my) {
  const ev = await api('events'), types = ['all', ...new Set(ev.map(e => e.type))], kind = t => t === 'link' ? 'ok' : t === 'logout' ? 'bad' : '', lbl = t => t === 'link' ? '+ link' : t === 'logout' ? '− logout' : t.replace('admin_', 'admin ');
  const f = ev.filter(e => st.evType === 'all' || e.type === st.evType);
  paint(my, head('Events', btn('Refresh', route)), el('div', { class: 'card' }, el('div', { class: 'row', style: 'margin-bottom:10px' }, seg(types.map(t => [t, t === 'all' ? 'All' : lbl(t)]), st.evType, t => { st.evType = t; route(); })),
    table(['Time', 'Event', 'Number / target'], f.map(e => [dt(e.t), chip(lbl(e.type), kind(e.type)), e.id]), { wrap: [2], empty: 'No events' })));
  later(() => { if (my === tok) route(); }, 20000);
}

// ---------- Settings ----------
async function settings(my) {
  const s = await api('settings'), o = el('input', { value: s.owner, placeholder: '94XXXXXXXXX', 'aria-label': 'Owner number' });
  const list = (title, sub, items, add, del, ph) => { const i = el('input', { placeholder: ph, 'aria-label': ph });
    return el('div', { class: 'card' }, el('h3', {}, title), el('div', { class: 'sub' }, sub), table(['Number', ''], items.map(x => [x, btn(del === 'ban' ? 'Unban' : 'Remove', () => act(del === 'ban' ? { op: 'ban', value: x, on: false } : { op: del, value: x }, 'Saved', route), 'sm d')]), { empty: 'None' }),
      el('div', { class: 'row', style: 'margin-top:12px' }, el('div', { class: 'grow' }, i), btn('Add', () => i.value.trim() && act(add === 'ban' ? { op: 'ban', value: i.value, on: true } : { op: add, value: i.value }, 'Saved', route), 'p'))); };
  paint(my, head('Settings'), el('div', { class: 'grid2' },
    el('div', { class: 'card' }, el('h3', {}, 'Owner number'), el('div', { class: 'sub' }, 'Country code, digits only. The owner has no limits.'), el('div', { class: 'row' }, el('div', { class: 'grow' }, o), btn('Save', () => act({ op: 'owner', value: o.value }, 'Saved', route), 'p'))),
    list('Admin numbers', 'No limits, can use staff commands', s.admins, 'admin_add', 'admin_del', '94XXXXXXXXX'),
    list('Banned numbers', 'Cannot use the bot or pair', s.banned, 'ban', 'ban', '94XXXXXXXXX')));
}

// ---------- login ----------
$('#lf').onsubmit = async e => { e.preventDefault(); const b = $('#go'); b.disabled = true; $('#e').textContent = '';
  try { await api('login', { password: $('#pw').value }); $('#pw').value = ''; showApp(true); } catch (x) { $('#e').textContent = x.message; } b.disabled = false; };
$('#out').onclick = async () => { try { await api('logout', {}); } catch {} showApp(false); };
api('overview').then(() => showApp(true)).catch(() => { $('#login').hidden = false; });
