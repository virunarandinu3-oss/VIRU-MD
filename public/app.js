const $ = id => document.getElementById(id);
const rm = matchMedia('(prefers-reduced-motion: reduce)').matches;
// ---- background: particle network + confetti ----
const cv = $('bg'), cx = cv.getContext('2d'); let W, H, P = [], B = [], M = { x: -999, y: -999 };
function size() { W = cv.width = innerWidth; H = cv.height = innerHeight;
  P = Array.from({ length: Math.min(80, W / 14 | 0) }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .4, vy: (Math.random() - .5) * .4 })); }
addEventListener('resize', size); addEventListener('pointermove', e => { M.x = e.clientX; M.y = e.clientY; }); size();
function frame() {
  cx.clearRect(0, 0, W, H);
  for (const p of P) { p.x += p.vx; p.y += p.vy; if (p.x < 0 || p.x > W) p.vx *= -1; if (p.y < 0 || p.y > H) p.vy *= -1;
    const dx = M.x - p.x, dy = M.y - p.y; if (Math.hypot(dx, dy) < 160) { p.x += dx * .004; p.y += dy * .004; }
    cx.fillStyle = 'rgba(255,93,143,.85)'; cx.beginPath(); cx.arc(p.x, p.y, 1.8, 0, 7); cx.fill(); }
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) { const d = Math.hypot(P[i].x - P[j].x, P[i].y - P[j].y);
    if (d < 110) { cx.strokeStyle = `rgba(150,130,255,${.28 * (1 - d / 110)})`; cx.beginPath(); cx.moveTo(P[i].x, P[i].y); cx.lineTo(P[j].x, P[j].y); cx.stroke(); } }
  for (let i = B.length - 1; i >= 0; i--) { const b = B[i]; b.x += b.vx; b.y += b.vy; b.vy += .14; b.l--;
    cx.globalAlpha = Math.max(b.l / 80, 0); cx.fillStyle = b.c; cx.fillRect(b.x, b.y, 6, 6); cx.globalAlpha = 1; if (b.l <= 0) B.splice(i, 1); }
  requestAnimationFrame(frame);
}
if (!rm) frame();
function confetti() { if (rm) return; const r = $('tiles').getBoundingClientRect(), cs = ['#ff5d8f', '#7a5cff', '#35e0ff', '#ffd166', '#3dffa0'];
  for (let i = 0; i < 110; i++) { const a = Math.random() * 6.28, v = 3 + Math.random() * 7;
    B.push({ x: r.left + r.width / 2, y: r.top + 20, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 4, l: 80, c: cs[i % 5] }); } }
// ---- typewriter ----
const ph = ['Link your WhatsApp in under a minute.', 'Auto follow. Auto react. Zero setup.', 'Light, fast and always online.']; let pi = 0, ci = 0, del = false;
(function tw() { const t = ph[pi]; $('type').textContent = t.slice(0, ci);
  if (!del && ci === t.length) { del = true; return setTimeout(tw, 1800); }
  if (del && ci === 0) { del = false; pi = (pi + 1) % ph.length; }
  ci += del ? -1 : 1; setTimeout(tw, del ? 25 : 55); })();
// ---- live stats ----
let shown = 0;
function count(to, max) { const s = shown, t0 = performance.now(); shown = to;
  (function st(t) { const k = Math.min((t - t0) / 700, 1); $('live').textContent = `${Math.round(s + (to - s) * k)} / ${max} bots online`; if (k < 1) requestAnimationFrame(st); })(t0); }
async function stats() { try { const j = await (await fetch('/api/stats')).json(); if (j.max) count(j.online, j.max); } catch { $('live').textContent = 'Offline'; } }
stats(); setInterval(stats, 15000);
// ---- 3D tilt ----
const card = $('card');
card.addEventListener('pointermove', e => { if (rm) return; const r = card.getBoundingClientRect();
  card.style.transform = `rotateY(${((e.clientX - r.left) / r.width - .5) * 8}deg) rotateX(${-((e.clientY - r.top) / r.height - .5) * 8}deg)`; });
card.addEventListener('pointerleave', () => { card.style.transform = ''; });
// ---- pairing ----
const f = $('f'), out = $('out'), err = $('err'), btn = $('btn'); let timer;
f.addEventListener('submit', async e => {
  e.preventDefault(); err.textContent = ''; out.hidden = true; clearInterval(timer);
  btn.disabled = true; btn.classList.add('load'); btn.textContent = 'Requesting code...';
  try {
    const r = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number: f.number.value, website: f.website.value }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Something went wrong.');
    const tiles = $('tiles'); tiles.textContent = '';
    [...j.code].forEach((ch, i) => { const s = document.createElement('span'); s.textContent = ch; s.style.animationDelay = i * 90 + 'ms'; tiles.appendChild(s); });
    out.hidden = false; setTimeout(confetti, 500); stats();
    let left = 180; $('bar').style.width = '100%';
    const tick = () => { $('tm').textContent = left > 0 ? `Code valid for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Code expired. Request a new one.';
      $('bar').style.width = left / 1.8 + '%'; if (left-- <= 0) clearInterval(timer); };
    tick(); timer = setInterval(tick, 1000); $('copy').textContent = 'Copy code';
    $('copy').onclick = async () => { try { await navigator.clipboard.writeText(j.code); $('copy').textContent = 'Copied'; } catch {} };
  } catch (x) { err.textContent = x.message; }
  btn.disabled = false; btn.classList.remove('load'); btn.textContent = 'Get pairing code';
});
