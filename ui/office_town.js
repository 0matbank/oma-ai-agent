/* Oma Agent Town: pixel office (approved preview, Oct 28 2026). Workers move only on real task events (applyTask). */
(() => {
'use strict';
/* ======================================================================
   OMA AI - Agent Town (OfficeTown) preview
   All art is drawn procedurally. Logical tile = 16px.
   ====================================================================== */
const TILE = 16, MW = 48, MH = 24, LW = MW * TILE, LH = MH * TILE, DT = 1 / 60;
const WALK = 1.35 * TILE, HOLD = 3.6, SIT_T = 0.45, STAND_T = 0.4;
const OUT = '#1b1d27';
const STATE_COL = { IDLE: '#7d8597', WORKING: '#6fd3ff', VERIFYING: '#b79cff', WAITING: '#f2c46b', ASSIGNED: '#9fb4d8', PLANNING: '#9fb4d8',
  COMPLETED: '#7ee08a', DONE: '#7ee08a', FAILED: '#ff6b6b', PARTIAL: '#f2c46b', CANCELLED: '#9aa3b5', RUNNING: '#6fd3ff', RECEIVED: '#c9d2e6' };

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const P = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
function rects(g, list, ox = 0, oy = 0) { for (const [x, y, w, h, c] of list) { g.fillStyle = c; g.fillRect(ox + x, oy + y, w, h); } }

/* ---------------------------------------------------------------- rooms */
const ROOMS = [
  { id: 'library', name: 'Research Library', who: 'Alice', x: 1, y: 2, w: 10, h: 8, floor: 'wood', face: '#4a4044', accent: '#f0b878' },
  { id: 'browser', name: 'Browser Room', who: 'Bob', x: 12, y: 2, w: 9, h: 8, floor: 'carpet', face: '#3d4560', accent: '#8fb8ff' },
  { id: 'control', name: 'OMA Control Room', who: 'OMA', x: 22, y: 2, w: 13, h: 8, floor: 'tech', face: '#2f3b55', accent: '#6fd3ff' },
  { id: 'desktop', name: 'Desktop Automation', who: 'Carol', x: 36, y: 2, w: 11, h: 8, floor: 'teal', face: '#3c4b52', accent: '#8be0a4' },
  { id: 'qa', name: 'Verification / QA', who: 'Dave', x: 1, y: 14, w: 10, h: 8, floor: 'checker', face: '#45405a', accent: '#c3abff' },
  { id: 'studio', name: 'YouTube Studio', who: 'Eve', x: 12, y: 14, w: 9, h: 8, floor: 'purple', face: '#3a3046', accent: '#ff8a8a' },
  { id: 'lounge', name: 'Break Lounge', who: '', x: 22, y: 14, w: 15, h: 8, floor: 'warm', face: '#4d4540', accent: '#f2c46b' },
  { id: 'server', name: 'Server Room', who: '', x: 38, y: 14, w: 9, h: 8, floor: 'grate', face: '#2c313d', accent: '#8be08b' },
  { id: 'corridor', name: '', who: '', x: 1, y: 11, w: 46, h: 2, floor: 'corridor', face: '#3f4356', accent: '#9aa3b5' },
];
const ROOM_BY_ID = Object.fromEntries(ROOMS.map(r => [r.id, r]));
const DOORS = [[8, 10, 'library'], [16, 10, 'browser'], [27, 10, 'control'], [28, 10, 'control'], [40, 10, 'desktop'],
  [8, 13, 'qa'], [16, 13, 'studio'], [28, 13, 'lounge'], [29, 13, 'lounge'], [41, 13, 'server']];

const MAP = (() => {
  const kind = [...Array(MH)].map(() => new Array(MW).fill(0));
  const room = [...Array(MH)].map(() => new Array(MW).fill(null));
  for (const r of ROOMS) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { kind[y][x] = 1; room[y][x] = r.id; }
  for (const [x, y, rid] of DOORS) { kind[y][x] = 2; room[y][x] = rid; }
  return { kind, room };
})();
const isWall = (x, y) => x < 0 || y < 0 || x >= MW || y >= MH || MAP.kind[y][x] === 0;
const BLOCK = new Uint8Array(MW * MH);
for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (isWall(x, y)) BLOCK[y * MW + x] = 1;
const walkable = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH && !BLOCK[y * MW + x];

/* ---------------------------------------------------------------- A* (4-dir, turn penalty so routes look natural) */
function findPath(sx, sy, gx, gy) {
  if (sx === gx && sy === gy) return [];
  if (!walkable(gx, gy)) return null;
  const S = MW * MH * 5, gs = new Float64Array(S).fill(1e9), prev = new Int32Array(S).fill(-1);
  const heap = [];
  const push = (f, s) => { heap.push([f, s]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const H = (x, y) => Math.abs(x - gx) + Math.abs(y - gy);
  const D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const s0 = (sy * MW + sx) * 5 + 4; gs[s0] = 0; push(H(sx, sy), s0);
  while (heap.length) {
    const [f, s] = pop(); const idx = (s / 5) | 0, d = s % 5, x = idx % MW, y = (idx / MW) | 0;
    if (f > gs[s] + H(x, y) + 1e-9) continue;
    if (x === gx && y === gy) {
      const out = []; let c = s; while (c !== s0 && c >= 0) { const i = (c / 5) | 0; out.push([i % MW, (i / MW) | 0]); c = prev[c]; }
      return out.reverse();
    }
    for (let k = 0; k < 4; k++) {
      const nx = x + D[k][0], ny = y + D[k][1]; if (!walkable(nx, ny)) continue;
      const ns = (ny * MW + nx) * 5 + k, c = gs[s] + 1 + (d !== 4 && d !== k ? 0.35 : 0);
      if (c < gs[ns]) { gs[ns] = c; prev[ns] = s; push(c + H(nx, ny), ns); }
    }
  }
  return null;
}

/* ---------------------------------------------------------------- furniture sprites */
const C = { wood: '#8a6446', woodD: '#6a4a33', woodL: '#a37a58', deskTop: '#8d9bb6', deskTopL: '#a6b3cb', deskEdge: '#5d6983',
  bezel: '#151821', chair: '#3e63b6', chairL: '#5a80d0',
  leaf: '#4f9e64', leafD: '#3a7a4c', leafL: '#73c486', pot: '#b9703f', potD: '#8c5230', paper: '#eef1f6', paperS: '#c3cad8',
  orange: '#e58a3a', orangeD: '#b5652a', shadow: 'rgba(6,8,16,.30)' };
const BOOKS = ['#b5543a', '#3e7cb1', '#e0b24a', '#5aa86a', '#8a6fc9', '#d6679a', '#4fb0b0', '#c9cfdb', '#d9874a', '#6b7fa8'];

function monitor(g, mx, U) {
  P(g, mx + 1, U - 8, 14, 11, C.bezel); P(g, mx + 2, U - 7, 12, 8, '#1b2638');
  P(g, mx + 7, U + 3, 2, 2, '#2b303e'); P(g, mx + 5, U + 4, 6, 1, '#2b303e');
  P(g, mx + 3, U + 5, 10, 2, '#c9d0de'); P(g, mx + 3, U + 5, 10, 1, '#e3e8f1');
}
const DESK_EXTRA = {
  books(g, U) { rects(g, [[19, U - 1, 8, 2, '#3e7cb1'], [18, U + 1, 9, 2, '#b5543a'], [20, U - 3, 6, 2, '#e0b24a'], [20, U + 4, 7, 5, C.paper], [21, U + 5, 5, 1, C.paperS], [21, U + 7, 4, 1, C.paperS], [28, U + 3, 3, 3, '#ececec'], [28, U + 3, 3, 1, '#6b4a35']]); },
  monitor2(g, U) { rects(g, [[18, U - 6, 12, 9, C.bezel], [19, U - 5, 10, 6, '#1b2638'], [23, U + 3, 2, 2, '#2b303e'], [26, U + 6, 3, 2, '#d9dee8'], [19, U + 6, 5, 2, C.paper]]); },
  terminal(g, U) { rects(g, [[18, U - 6, 12, 9, C.bezel], [19, U - 5, 10, 6, '#101a14'], [23, U + 3, 2, 2, '#2b303e'], [19, U + 6, 4, 3, '#e0b24a'], [25, U + 6, 4, 2, '#d9dee8']]); },
  clipboard(g, U) { rects(g, [[19, U, 7, 9, '#a0703c'], [20, U + 1, 5, 7, C.paper], [21, U, 3, 1, '#6b7488'], [21, U + 3, 3, 1, '#5aa86a'], [21, U + 5, 3, 1, '#5aa86a'], [27, U + 1, 4, 4, '#2b2f3c'], [28, U + 2, 2, 2, '#9cc0de'], [30, U + 5, 1, 2, '#2b2f3c']]); },
  mic(g, U) { rects(g, [[26, U - 6, 1, 9, '#2b2f3c'], [22, U - 6, 5, 1, '#2b2f3c'], [20, U - 9, 3, 5, '#3a3f4f'], [20, U - 9, 3, 1, '#6b7488'], [18, U + 4, 7, 3, '#d64545'], [19, U + 5, 5, 1, '#a83333'], [27, U + 5, 3, 2, '#d9dee8']]); },
};
const DRAW = {
  desk: { up: 8, draw(g, W, H, U, o) {
    P(g, 1, U + 13, W - 2, 3, C.shadow);
    P(g, 0, U, W, 13, '#262a36'); P(g, 1, U + 1, W - 2, 8, o.top || C.deskTop); P(g, 1, U + 1, W - 2, 1, o.topL || C.deskTopL);
    P(g, 1, U + 9, W - 2, 3, o.edge || C.deskEdge); P(g, 1, U + 9, W - 2, 1, '#4d5872');
    P(g, 1, U + 12, 2, 3, '#2f3445'); P(g, W - 3, U + 12, 2, 3, '#2f3445');
    monitor(g, 0, U); if (o.extra) DESK_EXTRA[o.extra](g, U);
  } },
  chairSeat: { up: 0, draw(g) { rects(g, [[3, 2, 10, 7, '#1f2b48'], [4, 3, 8, 5, C.chair], [4, 3, 8, 1, C.chairL], [2, 4, 1, 4, '#2a2e3a'], [13, 4, 1, 4, '#2a2e3a']]); } },
  chairBack: { up: 0, draw(g) { rects(g, [[3, 7, 10, 7, '#1f2b48'], [4, 8, 8, 5, '#3458a6'], [4, 8, 8, 1, C.chairL], [7, 14, 2, 1, '#2a2e3a'], [4, 15, 2, 1, '#22252f'], [10, 15, 2, 1, '#22252f']]); } },
  omaChair: { up: 4, draw(g, W, H, U) { rects(g, [[2, U - 4, 12, 10, '#1a2238'], [3, U - 3, 10, 7, '#2d4f8f'], [3, U - 3, 10, 1, '#4b74c0'], [3, U + 5, 10, 6, C.chair], [3, U + 11, 10, 1, '#1f2b48']]); } },
  shelf: { up: 14, draw(g, W, H, U, o, r) {
    P(g, 0, 0, W, H - 1, '#3a2a20'); P(g, 1, 1, W - 2, H - 3, '#6e4c34'); P(g, 2, 2, W - 4, H - 5, '#2c2018');
    for (const yy of [9, 17, 25]) P(g, 1, yy, W - 2, 2, '#7d573b');
    for (const [top, bot] of [[2, 8], [11, 16], [19, 24]]) {
      let x = 2; while (x < W - 3) { const bw = 2 + Math.floor(r() * 2), bh = (bot - top + 1) - Math.floor(r() * 3); const col = BOOKS[Math.floor(r() * BOOKS.length)];
        if (r() < 0.08) { x += 2; continue; }
        P(g, x, bot - bh + 1, Math.min(bw, W - 2 - x), bh, col); P(g, x, bot - bh + 1, 1, bh, 'rgba(255,255,255,.18)'); x += bw; }
    }
    P(g, 0, H - 1, W, 1, 'rgba(0,0,0,.35)');
  } },
  plant: { up: 10, draw(g, W, H, U) {
    P(g, 3, U + 13, 10, 3, 'rgba(6,8,16,.28)');
    rects(g, [[5, U + 7, 6, 6, '#2a1e18'], [6, U + 8, 4, 5, C.pot], [4, U + 6, 8, 2, '#cf8350'], [4, U + 7, 8, 1, C.potD]]);
    rects(g, [[6, U - 10, 4, 6, C.leafD], [2, U - 6, 5, 6, C.leafD], [9, U - 7, 5, 7, C.leafD], [4, U - 4, 8, 9, C.leaf], [1, U - 1, 5, 5, C.leaf], [10, U - 1, 5, 5, C.leaf],
      [7, U - 9, 2, 4, C.leafL], [3, U - 5, 2, 3, C.leafL], [11, U - 6, 2, 3, C.leafL], [6, U - 2, 3, 3, C.leafL], [2, U + 1, 2, 2, C.leafL]]);
  } },
  cabinet: { up: 8, draw(g, W, H, U, o) {
    const b = o.color || '#8a93a8', d = o.dark || '#7a8398';
    P(g, 1, 0, 14, H - 1, '#22252f'); P(g, 2, 1, 12, H - 3, b); P(g, 2, 1, 12, 1, 'rgba(255,255,255,.25)');
    for (let i = 0; i < 3; i++) { P(g, 3, 3 + i * 7, 10, 5, d); P(g, 6, 5 + i * 7, 4, 1, '#d9dee8'); }
    P(g, 1, H - 1, 14, 1, 'rgba(0,0,0,.35)');
  } },
  printer: { up: 7, draw(g, W, H, U) { rects(g, [[1, U + 13, 14, 3, C.shadow], [1, U + 3, 14, 10, '#262a36'], [2, U + 4, 12, 8, '#5d6983'], [2, U + 12, 2, 2, '#2f3445'], [12, U + 12, 2, 2, '#2f3445'],
    [2, U - 5, 12, 9, '#262a36'], [3, U - 4, 10, 7, '#d9dee8'], [3, U - 4, 10, 1, '#f0f3f8'], [4, U - 7, 8, 3, C.paper], [10, U - 2, 2, 1, '#6fd3ff'], [4, U + 1, 8, 1, '#8f98ab']]); } },
  netCab: { up: 6, draw(g, W, H, U) { rects(g, [[1, U + 13, 14, 3, C.shadow], [1, U - 1, 14, 14, '#1d2029'], [2, U, 12, 12, '#323847'], [3, U + 3, 10, 1, '#262b36'], [3, U + 7, 10, 1, '#262b36'],
    [3, U - 6, 10, 5, '#1d2029'], [4, U - 5, 8, 3, '#3a4152'], [5, U - 8, 1, 3, '#2b2f3c'], [10, U - 8, 1, 3, '#2b2f3c']]); } },
  laptopDesk: { up: 6, draw(g, W, H, U) {
    P(g, 1, U + 13, W - 2, 3, C.shadow); P(g, 0, U, W, 13, '#262a36'); P(g, 1, U + 1, W - 2, 8, '#a08a73'); P(g, 1, U + 1, W - 2, 1, '#b8a28a'); P(g, 1, U + 9, W - 2, 3, '#7a6553');
    rects(g, [[1, U + 12, 2, 3, '#2f3445'], [W - 3, U + 12, 2, 3, '#2f3445'], [5, U - 5, 13, 9, C.bezel], [6, U - 4, 11, 7, '#1b2638'], [4, U + 4, 15, 3, '#b7bfd0'], [5, U + 5, 13, 1, '#9aa3b5'],
      [22, U + 2, 4, 7, '#222631'], [23, U + 3, 2, 5, '#2b4a6b'], [27, U + 3, 3, 3, '#ececec']]);
  } },
  readTable: { up: 6, draw(g, W, H, U) {
    P(g, 2, U + 27, W - 4, 4, C.shadow); P(g, 0, U, W, 27, '#2e2119'); P(g, 1, U + 1, W - 2, 21, C.wood); P(g, 1, U + 1, W - 2, 1, C.woodL); P(g, 1, U + 22, W - 2, 4, C.woodD);
    rects(g, [[2, U + 26, 2, 4, '#2e2119'], [W - 4, U + 26, 2, 4, '#2e2119'],
      [7, U + 5, 13, 9, C.paper], [13, U + 5, 1, 9, C.paperS], [8, U + 7, 4, 1, C.paperS], [8, U + 9, 4, 1, C.paperS], [8, U + 11, 3, 1, C.paperS], [15, U + 7, 4, 1, C.paperS], [15, U + 9, 4, 1, C.paperS],
      [24, U + 11, 9, 8, '#ffffff'], [25, U + 13, 6, 1, C.paperS], [25, U + 15, 5, 1, C.paperS], [27, U + 9, 8, 8, '#f3e7c9'], [28, U + 11, 5, 1, '#c9b78f'],
      [4, U + 15, 9, 3, '#3e7cb1'], [5, U + 13, 8, 2, '#b5543a'], [5, U + 18, 8, 2, '#5aa86a'],
      [37, U + 6, 5, 2, '#2b2f3c'], [39, U - 2, 1, 8, '#2b2f3c'], [36, U - 5, 7, 4, '#e0b24a'], [37, U - 5, 5, 1, '#f3d27a']]);
  } },
  globe: { up: 8, draw(g, W, H, U) { rects(g, [[4, U + 13, 8, 2, C.shadow], [7, U + 5, 2, 7, C.woodD], [5, U + 12, 6, 2, C.woodD], [5, U - 6, 6, 1, '#4f8fd0'], [4, U - 5, 8, 1, '#4f8fd0'], [3, U - 4, 10, 6, '#4f8fd0'], [4, U + 2, 8, 1, '#4f8fd0'], [5, U + 3, 6, 1, '#4f8fd0'],
    [5, U - 4, 3, 3, '#5aa86a'], [9, U - 1, 3, 2, '#5aa86a'], [6, U + 1, 2, 1, '#5aa86a'], [2, U - 4, 1, 8, '#c9a24a'], [5, U - 5, 2, 1, '#9cc8f0']]); } },
  floorLamp: { up: 14, draw(g, W, H, U) { rects(g, [[4, U + 13, 8, 2, C.shadow], [7, U - 8, 2, 21, '#2b2f3c'], [5, U + 12, 6, 2, '#2b2f3c'], [4, U - 14, 8, 7, '#e9d8a6'], [5, U - 14, 6, 1, '#fff2c8'], [4, U - 8, 8, 1, '#c9b27a']]); } },
  cart: { up: 6, draw(g, W, H, U) { rects(g, [[2, U + 13, 12, 3, C.shadow], [2, U - 2, 12, 13, '#4a3528'], [3, U - 1, 10, 4, '#2c2018'], [3, U + 5, 10, 4, '#2c2018'],
    [3, U - 5, 2, 4, '#b5543a'], [5, U - 4, 2, 3, '#3e7cb1'], [7, U - 5, 2, 4, '#e0b24a'], [10, U - 4, 2, 3, '#5aa86a'], [3, U + 1, 3, 2, '#8a6fc9'], [7, U + 1, 4, 2, '#d6679a'], [3, U + 11, 2, 2, '#22252f'], [11, U + 11, 2, 2, '#22252f']]); } },
  commandDesk: { up: 10, draw(g, W, H, U) {
    rects(g, [[2, U + 12, W - 4, 4, C.shadow], [0, U - 4, W, 17, '#151a27'], [1, U - 3, W - 2, 10, '#2e3a55'], [1, U - 3, W - 2, 1, '#4a5f86'], [1, U + 7, W - 2, 5, '#22304a'], [1, U + 7, W - 2, 1, '#3d7fa6'],
      [6, U - 10, 18, 8, C.bezel], [7, U - 9, 16, 6, '#2a3142'], [14, U - 2, 3, 2, '#1b2030'], [56, U - 10, 18, 8, C.bezel], [57, U - 9, 16, 6, '#2a3142'], [63, U - 2, 3, 2, '#1b2030'],
      [34, U + 1, 12, 4, '#152030'], [35, U + 1, 10, 1, '#3d7fa6'], [8, U + 1, 12, 3, '#c9d0de'], [60, U + 1, 12, 3, '#c9d0de'], [26, U - 1, 5, 4, C.paper], [50, U, 4, 3, '#ececec']]);
  } },
  console: { up: 6, draw(g, W, H, U, o) {
    const L = o.side === 'left';
    P(g, 1, 0, 14, H - 1, '#151a27'); P(g, 2, 1, 12, H - 3, '#2a3348'); P(g, L ? 2 : 11, 1, 3, H - 3, '#22304a');
    for (let i = 0; i < 3; i++) { P(g, L ? 6 : 3, 4 + i * 15, 7, 10, C.bezel); P(g, L ? 7 : 4, 5 + i * 15, 5, 8, '#16243a'); }
    P(g, 1, H - 1, 14, 1, 'rgba(0,0,0,.35)');
  } },
  pillar: { up: 12, draw(g, W, H, U) { rects(g, [[3, U + 13, 10, 3, C.shadow], [4, 0, 8, H - 2, '#1d2230'], [5, 1, 6, H - 4, '#2a3142'], [7, 2, 2, H - 7, '#16243a']]); } },
  workbench: { up: 10, draw(g, W, H, U) {
    rects(g, [[2, U + 27, W - 4, 4, C.shadow], [0, U, W, 27, '#262a36'], [1, U + 1, W - 2, 20, '#7a8396'], [1, U + 1, W - 2, 1, '#9aa3b5'], [1, U + 21, W - 2, 5, '#5d6476'], [2, U + 26, 2, 4, '#262a36'], [W - 4, U + 26, 2, 4, '#262a36'],
      [5, U + 4, 9, 6, '#d9a53a'], [6, U + 4, 7, 1, '#f0c75a'], [8, U - 6, 3, 11, '#f0c75a'], [7, U - 8, 5, 3, '#3a3f4f'], [11, U - 9, 10, 3, '#f0c75a'], [20, U - 10, 3, 6, '#3a3f4f'], [19, U - 5, 2, 2, '#3a3f4f'], [22, U - 5, 2, 2, '#3a3f4f'],
      [29, U - 6, 8, 16, '#1d2029'], [30, U - 5, 6, 14, '#2f3445'], [31, U - 3, 4, 1, '#8be0a4'], [31, U + 3, 4, 1, '#3a4152'], [31, U + 5, 4, 1, '#3a4152'],
      [39, U + 6, 7, 6, '#c44a3a'], [40, U + 5, 5, 1, '#2b2f3c'], [39, U + 8, 7, 1, '#8e3329'], [16, U + 13, 9, 2, '#b3bccd'], [27, U + 15, 6, 2, '#e0b24a'], [6, U + 15, 6, 3, '#2b2f3c']]);
  } },
  testBench: { up: 4, draw(g, W, H, U) {
    rects(g, [[2, U + 27, W - 4, 4, C.shadow], [0, U, W, 27, '#262a36'], [1, U + 1, W - 2, 20, '#8d9bb6'], [1, U + 1, W - 2, 1, '#a6b3cb'], [1, U + 21, W - 2, 5, '#5d6983'],
      [4, U + 4, 6, 10, '#1d2029'], [5, U + 5, 4, 7, '#2b4a6b'], [14, U + 6, 14, 10, '#1d2029'], [15, U + 7, 12, 8, '#2b4a6b'], [6, U + 16, 7, 3, '#2b2f3c'], [10, U + 14, 1, 3, '#e0b24a'], [20, U + 17, 8, 1, '#e0b24a']]);
  } },
  binders: { up: 8, draw(g, W, H, U, o, r) {
    P(g, 1, 0, 14, H - 1, '#3a2a20'); P(g, 2, 1, 12, H - 3, '#5b4636');
    for (const yy of [12, 25]) P(g, 2, yy, 12, 2, '#7d573b');
    for (const [t, b] of [[2, 11], [15, 24], [28, 37]]) { let x = 3; while (x < 13) { P(g, x, t + 1, 2, b - t, BOOKS[Math.floor(r() * BOOKS.length)]); x += 3; } }
    P(g, 1, H - 1, 14, 1, 'rgba(0,0,0,.35)');
  } },
  sofaS: { up: 7, draw(g, W, H, U) {
    rects(g, [[1, U + 12, W - 2, 4, C.shadow], [0, U - 7, W, 20, '#3a1f1c'], [1, U - 6, W - 2, 8, '#9e4f43'], [1, U - 6, W - 2, 1, '#c06a5c'], [1, U - 2, 5, 14, '#8e463b'], [W - 6, U - 2, 5, 14, '#8e463b'], [1, U - 2, 5, 1, '#b25d4f'], [W - 6, U - 2, 5, 1, '#b25d4f'],
      [6, U + 2, W - 12, 9, '#b25d4f'], [6, U + 2, W - 12, 1, '#c97566'], [18, U + 2, 1, 9, '#8e463b'], [30, U + 2, 1, 9, '#8e463b'], [6, U + 10, W - 12, 2, '#8e463b']]);
  } },
  sofaNSeat: { up: 0, draw(g, W) { rects(g, [[0, 0, W, 10, '#3a1f1c'], [1, 1, W - 2, 8, '#b25d4f'], [1, 1, W - 2, 1, '#c97566'], [16, 1, 1, 8, '#8e463b'], [32, 1, 1, 8, '#8e463b']]); } },
  sofaNBack: { up: 0, draw(g, W) { rects(g, [[0, 7, W, 9, '#3a1f1c'], [1, 8, W - 2, 6, '#9e4f43'], [1, 8, W - 2, 1, '#c06a5c'], [0, 0, 5, 15, '#3a1f1c'], [1, 1, 3, 13, '#8e463b'], [W - 5, 0, 5, 15, '#3a1f1c'], [W - 4, 1, 3, 13, '#8e463b']]); } },
  coffeeTable: { up: 0, draw(g, W) { rects(g, [[3, 12, W - 6, 3, C.shadow], [3, 2, W - 6, 10, '#3b2a20'], [4, 3, W - 8, 7, C.wood], [4, 3, W - 8, 1, C.woodL], [4, 10, W - 8, 1, C.woodD],
    [9, 4, 3, 3, '#f0f0f0'], [9, 4, 3, 1, '#6b4a35'], [34, 5, 3, 3, '#f0f0f0'], [34, 5, 3, 1, '#6b4a35'], [20, 4, 9, 5, '#d64545'], [21, 5, 7, 1, '#f2d15c']]); } },
  cooler: { up: 13, draw(g, W, H, U) { rects(g, [[3, U + 13, 10, 3, C.shadow], [3, U - 1, 10, 15, '#262a36'], [4, U, 8, 13, '#dfe6ef'], [4, U, 8, 1, '#ffffff'], [6, U + 3, 1, 2, '#3e63b6'], [9, U + 3, 1, 2, '#d64545'], [5, U + 7, 6, 1, '#b3bccd'],
    [5, U - 12, 6, 11, '#7fb7e6'], [6, U - 11, 1, 8, '#b8dcf7'], [6, U - 13, 4, 1, '#3e63b6']]); } },
  counter: { up: 11, draw(g, W, H, U) {
    rects(g, [[0, U - 3, W, 19, '#262a36'], [1, U - 2, W - 2, 4, '#8f98ab'], [1, U - 2, W - 2, 1, '#b3bccd'], [1, U + 2, W - 2, 13, '#c9cfdb'], [16, U + 3, 1, 11, '#9aa3b5'], [32, U + 3, 1, 11, '#9aa3b5'], [48, U + 3, 1, 11, '#9aa3b5'],
      [12, U + 7, 2, 2, '#6b7488'], [19, U + 7, 2, 2, '#6b7488'], [35, U + 7, 2, 2, '#6b7488'], [51, U + 7, 2, 2, '#6b7488'],
      [4, U - 11, 10, 9, '#1d2029'], [5, U - 10, 8, 4, '#2f3445'], [6, U - 5, 2, 2, '#ececec'], [11, U - 9, 1, 1, '#ff6b6b'],
      [22, U - 2, 12, 3, '#6b7488'], [27, U - 6, 2, 4, '#b3bccd'], [27, U - 6, 4, 1, '#b3bccd'], [42, U - 10, 16, 9, '#262a36'], [43, U - 9, 14, 7, '#d9dee8'], [44, U - 8, 9, 5, '#2b2f3c'], [54, U - 8, 2, 5, '#9aa3b5'],
      [37, U - 5, 3, 3, '#f0f0f0'], [36, U - 5, 1, 2, '#f0f0f0']]);
  } },
  vending: { up: 13, draw(g, W, H, U) {
    rects(g, [[1, U + 13, 14, 3, C.shadow], [0, U - 13, 16, 28, '#262a36'], [1, U - 12, 14, 26, C.orange], [1, U - 12, 14, 1, '#f2a25c'], [13, U - 12, 1, 26, C.orangeD], [3, U - 10, 8, 16, '#22304a'],
      [12, U - 9, 1, 6, '#2b2f3c'], [3, U + 9, 8, 3, '#1d2029'], [4, U - 9, 2, 2, '#ff6b6b'], [7, U - 9, 2, 2, '#6fd3ff'], [4, U - 5, 2, 2, '#f2d15c'], [7, U - 5, 2, 2, '#7ee08a'], [4, U - 1, 2, 2, '#c3abff'], [7, U - 1, 2, 2, '#ff8a8a'], [4, U + 3, 6, 1, '#3a4a6a']]);
  } },
  roundTable: { up: 2, draw(g, W, H, U) { rects(g, [[3, U + 12, 10, 3, C.shadow], [4, U + 1, 8, 1, '#3b2a20'], [3, U + 2, 10, 8, '#3b2a20'], [4, U + 2, 8, 7, C.wood], [4, U + 2, 8, 1, C.woodL], [7, U + 10, 2, 3, '#2b2f3c'], [5, U + 13, 6, 1, '#2b2f3c'], [6, U + 4, 3, 3, '#f0f0f0']]); } },
  stool: { up: 0, draw(g) { rects(g, [[4, 12, 8, 2, C.shadow], [4, 5, 8, 5, '#2c4a8a'], [5, 5, 6, 3, C.chair], [5, 10, 1, 3, '#2b2f3c'], [10, 10, 1, 3, '#2b2f3c']]); } },
  rack: { up: 12, draw(g, W, H) {
    P(g, 0, 0, 16, H - 1, '#12141b'); P(g, 1, 1, 14, H - 3, '#262b36'); P(g, 1, 1, 14, 1, '#3a4152');
    for (let y = 3; y < H - 6; y += 4) { P(g, 2, y, 12, 3, '#1b1f28'); P(g, 2, y, 12, 1, '#323947'); P(g, 3, y + 1, 5, 1, '#2a303c'); }
    P(g, 0, H - 1, 16, 1, 'rgba(0,0,0,.4)');
  } },
  cooling: { up: 10, draw(g, W, H) { P(g, 1, 0, 14, H - 1, '#22252f'); P(g, 2, 1, 12, H - 3, '#c9cfdb'); P(g, 2, 1, 12, 1, '#e3e8f1');
    for (let y = 6; y < H - 8; y += 3) P(g, 3, y, 10, 1, '#9aa3b5'); P(g, 4, 3, 8, 2, '#1d2029'); P(g, 5, 3, 3, 1, '#8be08b'); P(g, 1, H - 1, 14, 1, 'rgba(0,0,0,.35)'); } },
  ups: { up: 4, draw(g, W, H, U) { rects(g, [[2, U + 13, 12, 3, C.shadow], [2, U - 4, 12, 17, '#1d2029'], [3, U - 3, 10, 15, '#2f3445'], [5, U - 1, 6, 3, '#16243a'], [6, U, 3, 1, '#8be08b'], [4, U + 6, 8, 1, '#262b36'], [4, U + 9, 8, 1, '#262b36']]); } },
  beanbag: { up: 3, draw(g, W, H, U, o) { const a = o.dark || '#3f7f50', b = o.color || '#5aa86a', c = o.light || '#73c486'; rects(g, [[2, U + 12, 12, 3, C.shadow], [4, U - 2, 8, 2, a], [2, U, 12, 10, a], [3, U, 10, 9, b], [4, U, 6, 2, c], [3, U + 10, 10, 2, a]]); } },
  ringLight: { up: 17, draw(g, W, H, U) {
    rects(g, [[4, U + 13, 8, 2, C.shadow], [7, U - 4, 2, 17, '#2b2f3c'], [4, U + 12, 8, 1, '#2b2f3c'], [3, U + 13, 2, 1, '#2b2f3c'], [11, U + 13, 2, 1, '#2b2f3c']]);
    const cx = 8, cy = U - 11;
    for (let a = 0; a < 40; a++) { const t = a / 40 * Math.PI * 2; P(g, Math.round(cx - 0.5 + Math.cos(t) * 6), Math.round(cy + Math.sin(t) * 6), 1, 1, '#f6f1dc'); }
    for (let a = 0; a < 40; a++) { const t = a / 40 * Math.PI * 2; P(g, Math.round(cx - 0.5 + Math.cos(t) * 5), Math.round(cy + Math.sin(t) * 5), 1, 1, '#d9d2b5'); }
    P(g, 7, U - 13, 2, 4, '#222631');
  } },
  camera: { up: 12, draw(g, W, H, U) { rects(g, [[4, U + 13, 9, 2, C.shadow], [8, U - 3, 1, 10, '#2b2f3c'], [5, U + 6, 1, 7, '#2b2f3c'], [11, U + 6, 1, 7, '#2b2f3c'], [8, U + 6, 1, 7, '#2b2f3c'],
    [4, U - 10, 10, 7, '#1d2029'], [5, U - 9, 8, 5, '#3a3f4f'], [1, U - 8, 4, 4, '#151821'], [2, U - 7, 2, 2, '#4f8fd0'], [10, U - 12, 3, 2, '#2b2f3c']]); } },
  whiteboard: { up: 14, draw(g, W, H, U) { rects(g, [[3, U + 13, W - 6, 3, C.shadow], [2, U - 14, W - 4, 20, '#262833'], [3, U - 13, W - 6, 18, '#e9edf3'], [3, U + 5, W - 6, 1, '#9aa3b5'], [5, U + 6, 1, 8, '#2b2f3c'], [W - 6, U + 6, 1, 8, '#2b2f3c'], [4, U + 12, 4, 1, '#2b2f3c'], [W - 8, U + 12, 4, 1, '#2b2f3c'],
    [5, U - 11, 5, 4, '#f2d15c'], [11, U - 11, 5, 4, '#8fd3ff'], [17, U - 11, 5, 4, '#ff9fb0'], [5, U - 5, 8, 1, '#3e7cb1'], [5, U - 3, 12, 1, '#3e7cb1'], [5, U - 1, 6, 1, '#d64545'], [19, U - 5, 6, 5, '#7ee08a'], [20, U - 4, 4, 3, '#e9edf3']]); } },
  bench: { up: 4, draw(g, W, H, U) { rects(g, [[2, U + 11, W - 4, 3, C.shadow], [1, U - 1, W - 2, 9, '#3b2a20'], [2, U, W - 4, 6, C.wood], [2, U, W - 4, 1, C.woodL], [2, U + 3, W - 4, 1, C.woodD], [3, U + 8, 2, 4, '#2b2f3c'], [W - 5, U + 8, 2, 4, '#2b2f3c']]); } },
  kiosk: { up: 14, draw(g, W, H, U) { rects(g, [[3, U + 13, 10, 3, C.shadow], [2, U - 14, 12, 16, C.bezel], [3, U - 13, 10, 13, '#1b2638'], [7, U + 2, 2, 10, '#2b2f3c'], [4, U + 12, 8, 2, '#2b2f3c']]); } },
  boxes: { up: 6, draw(g, W, H, U) { rects(g, [[2, U + 13, 12, 3, C.shadow], [2, U + 2, 12, 11, '#6e4f32'], [3, U + 3, 10, 9, '#b98a55'], [3, U + 7, 10, 1, '#9a6f40'], [4, U - 6, 9, 9, '#6e4f32'], [5, U - 5, 7, 7, '#c99a62'], [5, U - 2, 7, 1, '#a37a48']]); } },
  armchair: { up: 6, draw(g, W, H, U, o) { const c = o.color || '#5b6fa8', d = o.dark || '#43528a'; rects(g, [[1, U + 12, 14, 3, C.shadow], [1, U - 6, 14, 18, '#22252f'], [2, U - 5, 12, 7, d], [2, U - 1, 3, 12, d], [11, U - 1, 3, 12, d], [5, U + 2, 6, 8, c], [5, U + 2, 6, 1, 'rgba(255,255,255,.25)']]); } },
};

/* ---------------------------------------------------------------- furniture placement */
const ITEMS = [];
function item(kind, tx, ty, tw = 1, th = 1, o = {}) {
  const d = DRAW[kind]; const up = o.up != null ? o.up : d.up;
  const it = { kind, tx, ty, tw, th, o, up, base: (ty + th) * TILE + (o.baseAdj || 0), sx: tx * TILE, sy: ty * TILE - up };
  if (!o.noBlock) for (let y = ty; y < ty + th; y++) for (let x = tx; x < tx + tw; x++) BLOCK[y * MW + x] = 1;
  ITEMS.push(it); return it;
}
function blockRect(x0, y0, w, h) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) BLOCK[y * MW + x] = 1; }
const DESK_OF = {};
function workerDesk(owner, tx, ty, extra, screenKind, screen2Kind) {
  const screens = [{ x: tx * TILE + 2, y: ty * TILE - 7, w: 12, h: 8, kind: screenKind }];
  if (screen2Kind) screens.push({ x: tx * TILE + 19, y: ty * TILE - 5, w: 10, h: 6, kind: screen2Kind });
  DESK_OF[owner] = item('desk', tx, ty, 2, 1, { extra, owner, screens });
  item('chairSeat', tx, ty + 1, 1, 1, { owner, baseAdj: -14 });
  item('chairBack', tx, ty + 1, 1, 1, { owner, noBlock: true, baseAdj: -0.5 });
}
// Research Library (Alice)
item('shelf', 1, 2, 2, 1); item('shelf', 3, 2, 2, 1); item('shelf', 7, 2, 2, 1); item('shelf', 9, 2, 2, 1);
workerDesk('alice', 4, 5, 'books', 'doc');
item('readTable', 7, 6, 3, 2); item('globe', 1, 5); item('cart', 1, 7); item('floorLamp', 6, 4); item('plant', 1, 9); item('plant', 10, 9);
// Browser Room (Bob)
item('cabinet', 12, 2); item('printer', 20, 2); item('plant', 16, 2);
workerDesk('bob', 15, 5, 'monitor2', 'browser', 'tabs');
item('laptopDesk', 19, 5, 2, 1, { owner: 'bob', screens: [{ x: 19 * TILE + 6, y: 5 * TILE - 4, w: 11, h: 7, kind: 'browser' }] });
item('netCab', 12, 5); item('plant', 12, 9); item('plant', 20, 9);
item('whiteboard', 18, 8, 2, 1); item('boxes', 12, 7); item('armchair', 20, 7);
// OMA Control Room
blockRect(23, 2, 7, 2); blockRect(31, 2, 3, 2);
item('plant', 22, 2); item('plant', 34, 2); item('plant', 22, 9); item('plant', 34, 9); item('pillar', 30, 2);
item('omaChair', 28, 4, 1, 1, { baseAdj: -12 });
item('commandDesk', 26, 5, 5, 1);
item('console', 22, 5, 1, 3, { side: 'left' }); item('console', 34, 5, 1, 3, { side: 'right' });
// Desktop Automation (Carol)
blockRect(38, 2, 5, 1);
item('cabinet', 36, 2); item('cabinet', 37, 2, 1, 1, { color: '#b04a3e', dark: '#8e3a30' });
workerDesk('carol', 40, 5, 'terminal', 'tools', 'term');
item('workbench', 44, 7, 3, 2); item('plant', 36, 9); item('plant', 46, 5);
item('kiosk', 37, 5, 1, 1, { owner: 'carol', screens: [{ x: 37 * TILE + 3, y: 5 * TILE - 13, w: 10, h: 13, kind: 'tools' }] }); item('boxes', 36, 7); item('stool', 43, 8);
// Verification / QA (Dave)
blockRect(2, 14, 4, 1);
workerDesk('dave', 4, 17, 'clipboard', 'check');
item('cabinet', 9, 14); item('cabinet', 10, 14); item('testBench', 8, 17, 2, 2); item('binders', 1, 16, 1, 2); item('plant', 1, 21); item('plant', 10, 21);
item('printer', 6, 14); item('roundTable', 7, 20); item('stool', 6, 20); item('stool', 8, 20);
// YouTube Studio (Eve)
blockRect(12, 14, 3, 1);
workerDesk('eve', 16, 17, 'mic', 'video');
item('ringLight', 14, 16, 1, 1, { owner: 'eve' }); item('camera', 18, 16, 1, 1, { owner: 'eve' }); item('beanbag', 12, 20, 1, 1, { color: '#d6679a', dark: '#a94b77', light: '#ea8cb6' }); item('plant', 20, 21); item('plant', 20, 14);
item('cabinet', 20, 17, 1, 1, { color: '#6a5488', dark: '#584573' }); item('boxes', 19, 21);
// Break Lounge
item('sofaS', 23, 15, 3, 1); item('coffeeTable', 23, 17, 3, 1);
item('sofaNSeat', 23, 19, 3, 1, { baseAdj: -14 }); item('sofaNBack', 23, 19, 3, 1, { noBlock: true, baseAdj: -0.5 });
item('cooler', 31, 14); item('counter', 33, 14, 4, 1); item('vending', 36, 17); item('roundTable', 31, 18); item('stool', 30, 18); item('stool', 32, 18);
item('plant', 22, 14); item('plant', 22, 21); item('plant', 36, 21); item('plant', 30, 21); item('floorLamp', 27, 15);
item('beanbag', 29, 20, 1, 1, { color: '#e0b24a', dark: '#b08a2a', light: '#f2d15c' }); item('beanbag', 28, 18, 1, 1, { color: '#4f8fd0', dark: '#3a6aa0', light: '#7fb7e6' }); item('shelf', 33, 21, 2, 1);
// Server Room
for (const x of [39, 40, 43, 44, 45]) { item('rack', x, 15, 1, 2, { rack: true }); item('rack', x, 18, 1, 2, { rack: true }); }
item('cooling', 46, 15, 1, 2); item('cooling', 46, 18, 1, 2); item('ups', 38, 20);
// Corridor
item('vending', 1, 11); item('plant', 46, 11);
item('bench', 4, 11, 2, 1); item('bench', 31, 11, 2, 1); item('bench', 44, 11, 2, 1); item('plant', 20, 11); item('plant', 36, 11);
ITEMS.sort((a, b) => a.base - b.base);

/* ---------------------------------------------------------------- lounge spots (used only while a worker is idle) */
const LOUNGE_SPOTS = [
  { key: 'l0', seat: [23, 15], tile: [23, 16], pose: 'front', say: 'Short break on the sofa …' },
  { key: 'l1', seat: [24, 15], tile: [24, 16], pose: 'front', say: 'Short break on the sofa …' },
  { key: 'l2', seat: [25, 15], tile: [25, 16], pose: 'front', say: 'Short break on the sofa …' },
  { key: 'l3', seat: [23, 19], tile: [23, 20], pose: 'back', say: 'Resting for a moment …' },
  { key: 'l4', seat: [25, 19], tile: [25, 20], pose: 'back', say: 'Resting for a moment …' },
  { key: 'l5', tile: [31, 15], face: 'up', act: 'cup', say: 'Getting some water …' },
  { key: 'l6', tile: [34, 15], face: 'up', act: 'cup', say: 'Coffee break …' },
];

/* ---------------------------------------------------------------- background (floors, walls, wall decor, rugs) */
function floorRect(g, style, x0, y0, w, h, r) {
  const sp = (n, cols) => { for (let i = 0; i < n; i++) P(g, x0 + Math.floor(r() * w), y0 + Math.floor(r() * h), 1, 1, cols[Math.floor(r() * cols.length)]); };
  switch (style) {
    case 'wood': P(g, x0, y0, w, h, '#6b5747');
      for (let row = 0; row * 4 < h; row++) { const yy = y0 + row * 4; P(g, x0, yy, w, 1, '#5d4a3c'); for (let gx = x0 - ((row * 11) % 24); gx < x0 + w; gx += 24) if (gx > x0) P(g, gx, yy + 1, 1, 3, '#55443a'); }
      sp(w * h / 40, ['#76614f', '#64503f']); break;
    case 'warm': P(g, x0, y0, w, h, '#6e5c4d');
      for (let col = 0; col * 6 < w; col++) { const xx = x0 + col * 6; P(g, xx, y0, 1, h, '#62513f'); for (let gy = y0 - ((col * 13) % 28); gy < y0 + h; gy += 28) if (gy > y0) P(g, xx + 1, gy, 5, 1, '#5d4c3d'); }
      sp(w * h / 45, ['#7a6756', '#665445']); break;
    case 'carpet': P(g, x0, y0, w, h, '#4a5a78'); for (let x = x0; x < x0 + w; x += 16) P(g, x, y0, 1, h, '#50617f'); for (let y = y0; y < y0 + h; y += 16) P(g, x0, y, w, 1, '#50617f'); sp(w * h / 18, ['#45556f', '#51627f']); break;
    case 'corridor': P(g, x0, y0, w, h, '#4a5a78'); for (let x = x0; x < x0 + w; x += 16) P(g, x, y0, 1, h, '#52638a'); for (let y = y0; y < y0 + h; y += 16) P(g, x0, y, w, 1, '#52638a'); sp(w * h / 30, ['#45556f']); break;
    case 'tech': P(g, x0, y0, w, h, '#36415b'); for (let x = x0; x < x0 + w; x += 8) P(g, x, y0, 1, h, '#3c4865'); for (let y = y0; y < y0 + h; y += 8) P(g, x0, y, w, 1, '#3c4865');
      for (let x = x0; x < x0 + w; x += 16) for (let y = y0; y < y0 + h; y += 16) P(g, x, y, 1, 1, '#566a92'); break;
    case 'teal': for (let y = y0; y < y0 + h; y += 8) for (let x = x0; x < x0 + w; x += 8) P(g, x, y, 8, 8, ((x + y) / 8) % 2 ? '#476070' : '#4b6574'); for (let x = x0; x < x0 + w; x += 16) P(g, x, y0, 1, h, '#425a66'); break;
    case 'checker': for (let y = y0; y < y0 + h; y += 8) for (let x = x0; x < x0 + w; x += 8) P(g, x, y, 8, 8, ((x + y) / 8) % 2 ? '#525d77' : '#58637d'); break;
    case 'purple': P(g, x0, y0, w, h, '#54486a'); sp(w * h / 10, ['#5b4f72', '#4e4262', '#584c6e']); break;
    case 'grate': P(g, x0, y0, w, h, '#353c4a'); for (let y = y0; y < y0 + h; y += 4) P(g, x0, y, w, 1, '#2c323e'); for (let x = x0; x < x0 + w; x += 16) P(g, x, y0, 1, h, '#2a2f3a');
      for (let x = x0; x < x0 + w; x += 16) for (let y = y0; y < y0 + h; y += 16) { P(g, x + 2, y + 2, 1, 1, '#4a5263'); P(g, x + 13, y + 2, 1, 1, '#4a5263'); P(g, x + 2, y + 13, 1, 1, '#4a5263'); P(g, x + 13, y + 13, 1, 1, '#4a5263'); } break;
  }
}
function rug(g, tx, ty, tw, th, c1, c2, c3) {
  const x = tx * TILE + 2, y = ty * TILE + 2, w = tw * TILE - 4, h = th * TILE - 4;
  P(g, x, y, w, h, c1); P(g, x + 2, y + 2, w - 4, h - 4, c2); P(g, x + 4, y + 4, w - 8, h - 8, c1);
  for (let i = x + 6; i < x + w - 6; i += 6) P(g, i, y + 6, 2, h - 12, c3);
}
function windowDeco(g, tx, ty, tw) { const X = tx * TILE, Y = ty * TILE, W = tw * TILE;
  rects(g, [[X + 1, Y + 3, W - 2, 12, '#262833'], [X + 2, Y + 4, W - 4, 9, '#6f93b8'], [X + 2, Y + 4, W - 4, 3, '#86a9ca'], [X + W / 2 - 1, Y + 4, 2, 9, '#262833'], [X + 1, Y + 13, W - 2, 2, '#7b86a0'], [X + 4, Y + 9, 2, 1, '#a9c6e0'], [X + 6, Y + 8, 2, 1, '#a9c6e0']]); }
function frameDeco(g, X, Y, w, h, inner) { P(g, X, Y, w, h, '#262833'); P(g, X + 1, Y + 1, w - 2, h - 2, '#c9a24a'); P(g, X + 2, Y + 2, w - 4, h - 4, inner[0]); if (inner[1]) P(g, X + 2, Y + h - 5, w - 4, 3, inner[1]); if (inner[2]) P(g, X + 4, Y + 3, 3, 2, inner[2]); }
function screenFrame(g, X, Y, W, H, legs) { P(g, X - 1, Y - 1, W + 2, H + 2, '#12141b'); P(g, X, Y, W, H, '#2a3142'); P(g, X + 2, Y + 2, W - 4, H - 4, '#13203a'); if (legs) { P(g, X + 8, Y + H + 1, 2, 3, '#22252f'); P(g, X + W - 10, Y + H + 1, 2, 3, '#22252f'); } }
function clockDeco(g, X, Y) { P(g, X, Y, 9, 9, '#262833'); P(g, X + 1, Y + 1, 7, 7, '#f0f3f8'); P(g, X + 4, Y + 2, 1, 3, '#2b2f3c'); P(g, X + 4, Y + 4, 2, 1, '#2b2f3c'); }
function extinguisher(g, X, Y) { P(g, X, Y, 4, 8, '#c44a3a'); P(g, X + 1, Y - 1, 2, 1, '#2b2f3c'); P(g, X, Y + 2, 4, 1, '#f0f0f0'); }
const WALL_SCREENS = {
  task: { x: 23 * TILE + 1, y: 17, w: 110, h: 38 },
  team: { x: 31 * TILE + 1, y: 17, w: 46, h: 38 },
  check: { x: 2 * TILE + 1, y: 13 * TILE + 2, w: 62, h: 28 },
  bob1: { x: 13 * TILE + 1, y: TILE + 3, w: 30, h: 11 },
  bob2: { x: 18 * TILE + 1, y: TILE + 3, w: 30, h: 11 },
  tools: { x: 38 * TILE + 2, y: TILE + 2, w: 76, h: 26 },
  video: { x: 12 * TILE + 2, y: 13 * TILE + 2, w: 44, h: 24 },
  srv: { x: 43 * TILE + 1, y: 13 * TILE + 4, w: 30, h: 9 },
  sign: { x: 30 * TILE + 2, y: 10 * TILE + 4, w: 60, h: 9 },
};
function renderBackground() {
  const c = mk(LW, LH), g = c.getContext('2d'), r = mulberry32(42);
  P(g, 0, 0, LW, LH, '#22242e');
  for (const rm of ROOMS) floorRect(g, rm.floor, rm.x * TILE, rm.y * TILE, rm.w * TILE, rm.h * TILE, r);
  rug(g, 3, 4, 4, 5, '#5b3f3a', '#7a5248', '#6a4a42');
  rug(g, 14, 4, 4, 5, '#3c4a68', '#56688e', '#475877');
  rug(g, 25, 7, 7, 2, '#22304a', '#2c4266', '#284062');
  rug(g, 38, 4, 5, 5, '#3a5560', '#4f7280', '#46646f');
  rug(g, 3, 16, 4, 5, '#4a4366', '#635a86', '#574f78');
  rug(g, 14, 16, 6, 5, '#3d2f4a', '#5a4470', '#4b3a5e');
  rug(g, 22, 15, 6, 6, '#6a3b35', '#8a5048', '#7a463f');
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const X = x * TILE, Y = y * TILE, k = MAP.kind[y][x];
    if (k === 0) {
      const face = y + 1 < MH && MAP.kind[y + 1][x] !== 0;
      if (face) {
        const rm = ROOM_BY_ID[MAP.room[y + 1][x]] || ROOM_BY_ID.corridor;
        P(g, X, Y, 16, 4, '#30323f'); P(g, X, Y + 3, 16, 1, '#4c5068'); P(g, X, Y + 4, 16, 10, rm.face); P(g, X, Y + 4, 16, 1, 'rgba(255,255,255,.06)');
        P(g, X + 15, Y + 4, 1, 10, 'rgba(0,0,0,.10)'); P(g, X, Y + 14, 16, 2, '#24262f');
      } else {
        P(g, X, Y, 16, 16, '#30323f'); P(g, X + 1, Y + 1, 14, 14, '#353746');
        if (!isWall(x - 1, y)) P(g, X, Y, 1, 16, '#4a4e62');
        if (!isWall(x + 1, y)) P(g, X + 15, Y, 1, 16, '#4a4e62');
        if (!isWall(x, y - 1)) P(g, X, Y, 16, 1, '#4a4e62');
      }
    } else {
      if (y > 0 && MAP.kind[y - 1][x] === 0) { P(g, X, Y, 16, 2, 'rgba(0,0,0,.28)'); P(g, X, Y + 2, 16, 2, 'rgba(0,0,0,.12)'); }
      if (isWall(x - 1, y)) P(g, X, Y, 2, 16, 'rgba(0,0,0,.18)');
      if (isWall(x + 1, y)) P(g, X + 15, Y, 1, 16, 'rgba(0,0,0,.12)');
    }
  }
  for (const [x, y] of DOORS) {
    const X = x * TILE, Y = y * TILE;
    P(g, X, Y, 16, 16, '#3a4058'); P(g, X, Y, 16, 3, '#30323f'); P(g, X, Y + 3, 16, 1, '#1f2129');
    P(g, X + 2, Y + 11, 12, 4, '#2b2f3c'); P(g, X + 3, Y + 12, 10, 2, '#363b4c');
    if (isWall(x - 1, y)) { P(g, X, Y + 3, 2, 13, C.orange); P(g, X, Y + 3, 1, 13, '#f2a25c'); P(g, X - 4, Y + 4, 4, 11, C.orange); P(g, X - 4, Y + 4, 1, 11, C.orangeD); P(g, X - 3, Y + 9, 1, 1, '#2b2f3c'); }
    if (isWall(x + 1, y)) { P(g, X + 14, Y + 3, 2, 13, C.orange); P(g, X + 15, Y + 3, 1, 13, C.orangeD); }
  }
  windowDeco(g, 5, 1, 2); windowDeco(g, 16, 1, 1); windowDeco(g, 43, 1, 1);
  { const X = 44 * TILE + 1, Y = TILE + 3; P(g, X, Y, 46, 11, '#8a6446'); P(g, X + 1, Y + 1, 44, 9, '#b08a5e');
    for (let i = X + 3; i < X + 44; i += 4) for (let j = Y + 3; j < Y + 10; j += 3) P(g, i, j, 1, 1, '#7a5a3c');
    rects(g, [[X + 5, Y + 2, 2, 7, '#8f98ab'], [X + 4, Y + 2, 4, 2, '#8f98ab'], [X + 12, Y + 3, 6, 2, '#c44a3a'], [X + 15, Y + 5, 1, 4, '#3a3f4f'], [X + 24, Y + 2, 1, 7, '#b3bccd'], [X + 30, Y + 3, 6, 5, '#e0b24a'], [X + 39, Y + 2, 2, 7, '#3a3f4f']]); }
  const S = WALL_SCREENS;
  screenFrame(g, S.task.x, S.task.y, S.task.w, S.task.h, true);
  screenFrame(g, S.team.x, S.team.y, S.team.w, S.team.h, true);
  screenFrame(g, S.bob1.x, S.bob1.y, S.bob1.w, S.bob1.h);
  screenFrame(g, S.bob2.x, S.bob2.y, S.bob2.w, S.bob2.h);
  screenFrame(g, S.tools.x, S.tools.y, S.tools.w, S.tools.h, true);
  { const s = S.check; P(g, s.x - 1, s.y - 1, s.w + 2, s.h + 2, '#262833'); P(g, s.x, s.y, s.w, s.h, '#9aa3b5'); P(g, s.x + 2, s.y + 2, s.w - 4, s.h - 4, '#e9edf3'); P(g, s.x + 2, s.y + s.h - 3, s.w - 4, 1, '#c3cad8'); P(g, s.x + 6, s.y + s.h + 1, 2, 3, '#22252f'); P(g, s.x + s.w - 8, s.y + s.h + 1, 2, 3, '#22252f'); }
  frameDeco(g, 6 * TILE + 3, 13 * TILE + 5, 10, 8, ['#4f8fd0', '#5aa86a', '#f2d15c']);
  screenFrame(g, S.video.x, S.video.y, S.video.w, S.video.h, true);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { const X = 17 * TILE + 3 + i * 7, Y = 13 * TILE + 4 + j * 5; P(g, X, Y, 6, 4, '#2a2333'); P(g, X + 1, Y + 1, 4, 2, '#3b3048'); }
  { const X = 15 * TILE + 3, Y = 13 * TILE + 4; P(g, X, Y, 9, 9, '#262833'); P(g, X + 1, Y + 1, 7, 7, '#d9dee8'); P(g, X + 3, Y + 3, 1, 3, '#d64545'); P(g, X + 4, Y + 4, 1, 1, '#d64545'); }
  frameDeco(g, 23 * TILE + 2, 13 * TILE + 4, 28, 9, ['#6f93b8', '#5aa86a', '#f2d15c']);
  clockDeco(g, 26 * TILE + 3, 13 * TILE + 4);
  { const X = 33 * TILE + 6, Y = 13 * TILE + 3; P(g, X, Y, 24, 6, '#2b2f3c'); P(g, X + 1, Y + 1, 22, 4, '#3a4152'); for (let i = 0; i < 4; i++) P(g, X + 3 + i * 5, Y + 2, 3, 1, '#f2d15c'); }
  screenFrame(g, S.srv.x, S.srv.y, S.srv.w, S.srv.h);
  extinguisher(g, 39 * TILE + 5, 13 * TILE + 5);
  frameDeco(g, 3 * TILE + 2, 10 * TILE + 4, 22, 9, ['#4f8fd0', '#3e7a4c', '#f2d15c']);
  frameDeco(g, 12 * TILE + 4, 10 * TILE + 4, 12, 9, ['#8a6fc9', '#d6679a']);
  frameDeco(g, 19 * TILE + 2, 10 * TILE + 4, 20, 9, ['#e0b24a', '#b5543a', '#fff2c8']);
  clockDeco(g, 24 * TILE + 4, 10 * TILE + 4);
  { const s = S.sign; P(g, s.x, s.y, s.w, s.h, '#141a28'); P(g, s.x, s.y, s.w, 1, '#3d7fa6'); P(g, s.x, s.y + s.h - 1, s.w, 1, '#3d7fa6'); }
  extinguisher(g, 36 * TILE + 5, 10 * TILE + 5);
  frameDeco(g, 43 * TILE + 2, 10 * TILE + 4, 24, 9, ['#3a5560', '#8be0a4', '#e9edf3']);
  P(g, 38 * TILE + 2, 17 * TILE + 6, 8 * TILE + 12, 2, '#2a2f3a'); P(g, 38 * TILE + 2, 20 * TILE + 6, 8 * TILE + 12, 2, '#2a2f3a');
  { const cx = 28 * TILE + 8, cy = 8 * TILE; for (let a = 0; a < 48; a++) { const t = a / 48 * Math.PI * 2; P(g, Math.round(cx + Math.cos(t) * 11), Math.round(cy + Math.sin(t) * 5), 1, 1, '#4a8fc0'); }
    P(g, cx - 2, cy - 1, 4, 2, '#6fd3ff'); }
  return c;
}
function renderLighting() {
  const c = mk(LW, LH), g = c.getContext('2d');
  for (const rm of ROOMS) {
    if (rm.id === 'corridor') continue;
    const cx = (rm.x + rm.w / 2) * TILE, cy = (rm.y + rm.h / 2) * TILE, R = Math.max(rm.w, rm.h) * TILE * 0.62;
    const gr = g.createRadialGradient(cx, cy, 4, cx, cy, R); gr.addColorStop(0, 'rgba(255,244,225,0.07)'); gr.addColorStop(1, 'rgba(255,244,225,0)');
    g.fillStyle = gr; g.fillRect(rm.x * TILE, rm.y * TILE, rm.w * TILE, rm.h * TILE);
  }
  for (const [lx, ly] of [[6 * TILE + 8, 3 * TILE], [27 * TILE + 8, 14 * TILE], [8 * TILE + 8, 6 * TILE]]) { const gr = g.createRadialGradient(lx, ly, 2, lx, ly, 40); gr.addColorStop(0, 'rgba(255,214,150,0.12)'); gr.addColorStop(1, 'rgba(255,214,150,0)'); g.fillStyle = gr; g.fillRect(lx - 40, ly - 40, 80, 80); }
  { const s = ROOM_BY_ID.server; P(g, s.x * TILE, s.y * TILE, s.w * TILE, s.h * TILE, 'rgba(20,40,70,0.16)'); }
  const v = g.createRadialGradient(LW / 2, LH / 2, LH * 0.35, LW / 2, LH / 2, LW * 0.62); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(4,5,10,0.26)');
  g.fillStyle = v; g.fillRect(0, 0, LW, LH);
  return c;
}
function buildSprites() {
  for (const it of ITEMS) {
    if (it.sprite) continue;
    const W = it.tw * TILE, H = it.th * TILE + it.up; const c = mk(W, H), g = c.getContext('2d');
    DRAW[it.kind].draw(g, W, H, it.up, it.o, mulberry32(it.tx * 131 + it.ty * 17 + 5));
    it.sprite = c;
  }
  return ITEMS;
}

/* ---------------------------------------------------------------- workers */
const WORKER_DEFS = {
  alice: { name: 'Alice', role: 'Research', room: 'library', chair: [4, 6], approach: [4, 7], idle: [7, 3], idleDir: 'up', style: 'long', lounge0: 26,
    pal: { skin: '#f2c9a5', skinS: '#d9a77f', blush: '#eaa08e', hair: '#b4533a', hairS: '#8c3d2b', hairL: '#cf6f52', shirt: '#3fa7a0', shirtS: '#2e7f7a', pants: '#2f3652', pantsS: '#252a40', shoes: '#1c1f2c' } },
  bob: { name: 'Bob', role: 'Browser', room: 'browser', chair: [15, 6], approach: [15, 7], idle: [18, 3], idleDir: 'up', style: 'short', glasses: true, lounge0: 9,
    pal: { skin: '#e8b98f', skinS: '#c99a72', blush: '#e09a80', hair: '#4a3326', hairS: '#33231a', hairL: '#64473a', shirt: '#4f7fd8', shirtS: '#3a60a8', pants: '#3a3f55', pantsS: '#2c3043', shoes: '#1c1f2c' } },
  carol: { name: 'Carol', role: 'Desktop', room: 'desktop', chair: [40, 6], approach: [40, 7], idle: [45, 6], idleDir: 'down', style: 'bun', lounge0: 41,
    pal: { skin: '#d9a07a', skinS: '#b98262', blush: '#d18a74', hair: '#2b2433', hairS: '#1c1722', hairL: '#463b52', shirt: '#5aa86a', shirtS: '#43804f', pants: '#3b3550', pantsS: '#2c283d', shoes: '#1c1f2c' } },
  dave: { name: 'Dave', role: 'Verification', room: 'qa', chair: [4, 18], approach: [4, 19], idle: [3, 15], idleDir: 'up', style: 'spiky', glasses: true, lounge0: 55,
    pal: { skin: '#f0c8a0', skinS: '#d4a77e', blush: '#e8a08a', hair: '#d8b45c', hairS: '#b08f3f', hairL: '#ecd08a', shirt: '#8a6fc9', shirtS: '#6a52a3', pants: '#2e3346', pantsS: '#232736', shoes: '#1c1f2c' } },
  eve: { name: 'Eve', role: 'YouTube', room: 'studio', chair: [16, 18], approach: [16, 19], idle: [13, 18], idleDir: 'down', style: 'pony', lounge0: 17,
    pal: { skin: '#f3cfb3', skinS: '#d8ae90', blush: '#ee9a9a', hair: '#d6679a', hairS: '#a94b77', hairL: '#ea8cb6', shirt: '#d64545', shirtS: '#a83333', pants: '#33304a', pantsS: '#262439', shoes: '#1c1f2c' } },
};
const OMA_DEF = { name: 'OMA', role: 'Coordinator', room: 'control', chair: [28, 4], style: 'oma', eye: '#1b6a9b',
  pal: { skin: '#cdeefc', skinS: '#a5d6ee', blush: '#9fe0f5', hair: '#f1fbff', hairS: '#bfe3f4', hairL: '#ffffff', shirt: '#2a3f63', shirtS: '#1f2f4b', pants: '#26324a', pantsS: '#1c2538', shoes: '#151a26', acc: '#6fd3ff' } };
const EYE = '#1f2130';

function painter(g, ox, oy, flip) { return (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(flip ? ox + 16 - x - w : ox + x, oy + y, w, h); }; }
function shadowAt(g, x, y) { g.fillStyle = 'rgba(8,10,18,.30)'; g.fillRect(x - 5, y - 1, 10, 3); g.fillRect(x - 6, y, 12, 1); }

function hairFront(q, p, d) {
  q(3, 1, 10, 1, p.hair); q(2, 2, 12, 3, p.hair); q(2, 5, 1, 4, p.hair); q(13, 5, 1, 4, p.hair);
  q(3, 5, 2, 1, p.hair); q(11, 5, 2, 1, p.hair); q(6, 5, 1, 1, p.hair); q(4, 2, 4, 1, p.hairL);
  switch (d.style) {
    case 'long': q(2, 5, 2, 10, p.hair); q(12, 5, 2, 10, p.hair); q(2, 14, 2, 1, p.hairS); q(12, 14, 2, 1, p.hairS); break;
    case 'bun': q(6, -1, 4, 2, p.hair); q(7, -2, 2, 1, p.hair); q(6, -1, 2, 1, p.hairL); break;
    case 'spiky': q(4, 0, 1, 1, p.hair); q(7, 0, 2, 1, p.hair); q(11, 0, 1, 1, p.hair); break;
    case 'pony': q(13, 4, 1, 1, '#ffd34d'); q(13, 5, 2, 5, p.hair); break;
    case 'oma': q(2, 6, 1, 3, p.acc); q(13, 6, 1, 3, p.acc); q(2, 2, 12, 1, p.hairS); q(12, 9, 2, 1, p.acc); break;
  }
}
function headFront(q, p, d, blink) {
  q(3, 3, 10, 8, p.skin); q(4, 11, 8, 1, p.skin); q(3, 10, 1, 1, p.skinS); q(12, 10, 1, 1, p.skinS);
  const e = d.eye || EYE;
  if (blink) { q(5, 8, 1, 1, e); q(10, 8, 1, 1, e); } else { q(5, 7, 1, 2, e); q(10, 7, 1, 2, e); }
  q(4, 9, 1, 1, p.blush); q(11, 9, 1, 1, p.blush); q(7, 10, 2, 1, p.skinS);
  hairFront(q, p, d);
  if (d.glasses) { q(4, 6, 3, 1, '#2a2c38'); q(9, 6, 3, 1, '#2a2c38'); q(7, 7, 2, 1, '#2a2c38'); q(4, 7, 1, 2, '#2a2c38'); q(11, 7, 1, 2, '#2a2c38'); }
}
function headBack(q, p, d) {
  q(3, 3, 10, 8, p.skin); q(6, 11, 4, 1, p.skinS);
  q(3, 1, 10, 1, p.hair); q(2, 2, 12, 8, p.hair); q(3, 10, 10, 1, p.hairS); q(4, 2, 5, 1, p.hairL);
  switch (d.style) {
    case 'long': q(3, 10, 10, 4, p.hair); q(3, 14, 10, 1, p.hairS); break;
    case 'bun': q(6, -1, 4, 2, p.hair); q(7, -2, 2, 1, p.hair); break;
    case 'spiky': q(4, 0, 1, 1, p.hair); q(7, 0, 2, 1, p.hair); q(11, 0, 1, 1, p.hair); break;
    case 'pony': q(7, 4, 2, 1, '#ffd34d'); q(7, 10, 2, 5, p.hair); q(7, 15, 2, 1, p.hairS); break;
    case 'oma': q(2, 6, 1, 3, p.acc); q(13, 6, 1, 3, p.acc); q(3, 2, 10, 1, p.acc); break;
  }
}
function headSide(q, p, d, blink) {
  q(4, 3, 9, 8, p.skin); q(5, 11, 7, 1, p.skin); q(13, 8, 1, 1, p.skin);
  q(3, 1, 10, 1, p.hair); q(2, 2, 11, 3, p.hair); q(2, 5, 5, 5, p.hair); q(3, 10, 3, 1, p.hairS); q(11, 5, 2, 1, p.hair); q(5, 2, 4, 1, p.hairL);
  const e = d.eye || EYE;
  if (blink) q(10, 8, 1, 1, e); else q(10, 7, 1, 2, e);
  q(11, 9, 1, 1, p.blush); q(12, 10, 1, 1, p.skinS);
  switch (d.style) {
    case 'long': q(2, 10, 4, 5, p.hair); break;
    case 'bun': q(3, -1, 4, 2, p.hair); break;
    case 'spiky': q(4, 0, 1, 1, p.hair); q(8, 0, 1, 1, p.hair); break;
    case 'pony': q(0, 5, 2, 6, p.hair); q(2, 5, 1, 1, '#ffd34d'); break;
    case 'oma': q(6, 6, 2, 3, p.acc); q(8, 9, 4, 1, p.acc); break;
  }
  if (d.glasses) { q(9, 6, 4, 1, '#2a2c38'); q(9, 7, 1, 2, '#2a2c38'); q(12, 7, 1, 2, '#2a2c38'); q(6, 7, 3, 1, '#2a2c38'); }
}
/* standing / walking (16x24, feet at y) */
function drawStanding(g, d, x, y, dir, frame, o) {
  const p = d.pal, side = dir === 'left' || dir === 'right', flip = dir === 'left';
  const ox = x - 8, oy = y - 22;
  shadowAt(g, x, y);
  const qL = painter(g, ox, oy, flip);
  const b = (frame === 1 || frame === 3) ? -1 : 0;
  const q = painter(g, ox, oy + b, flip);
  if (!side) {
    let lL = 0, lR = 0; if (frame === 1) lR = -1; if (frame === 3) lL = -1;
    qL(5, 18, 3, 3 + lL, p.pants); qL(8, 18, 3, 3 + lR, p.pants); qL(5, 21 + lL, 3, 1, p.shoes); qL(8, 21 + lR, 3, 1, p.shoes); qL(7, 18, 2, 1, p.pantsS);
    q(4, 12, 8, 6, p.shirt); q(10, 12, 2, 6, p.shirtS); q(4, 17, 8, 1, p.shirtS);
    if (dir === 'down') q(7, 12, 2, 1, p.skin);
    let aL = 0, aR = 0; if (frame === 1) { aL = -1; aR = 1; } if (frame === 3) { aL = 1; aR = -1; }
    q(3, 13 + aL, 1, 4, p.shirtS); q(3, 17 + aL, 1, 1, p.skin);
    if (o.raise) { q(12, 7, 1, 6, p.shirtS); q(12, 5, 1, 2, p.skin); } else { q(12, 13 + aR, 1, 4, p.shirtS); q(12, 17 + aR, 1, 1, p.skin); }
    if (dir === 'down') headFront(q, p, d, o.blink); else headBack(q, p, d);
    if (o.cup && dir === 'down') { q(2, 15, 2, 3, '#f2f2f2'); q(2, 15, 2, 1, '#6b4a35'); }
    if (o.cup && dir === 'up') { q(12, 9, 2, 3, '#f2f2f2'); }
  } else {
    if (frame === 1 || frame === 3) { qL(4, 18, 3, 3, p.pantsS); qL(3, 21, 3, 1, p.shoes); qL(9, 18, 3, 3, p.pants); qL(10, 21, 3, 1, p.shoes); }
    else { qL(6, 18, 4, 3, p.pants); qL(6, 21, 5, 1, p.shoes); }
    q(5, 12, 6, 6, p.shirt); q(5, 12, 1, 6, p.shirtS); q(5, 17, 6, 1, p.shirtS);
    const sw = frame === 1 ? 2 : frame === 3 ? -2 : 0;
    q(7 + sw, 13, 2, 4, p.shirtS); q(7 + sw, 17, 2, 1, p.skin);
    headSide(q, p, d, o.blink);
  }
}
/* seated, back to viewer (desk chair / north-facing sofa). sy = seat tile top + 8 */
function drawSeatedBack(g, d, cx, sy, o) {
  const p = d.pal, q = painter(g, cx - 8, sy - 20, false);
  q(4, 11, 8, 8, p.shirt); q(10, 11, 2, 8, p.shirtS);
  const hl = o.typing ? (o.phase ? 7 : 8) : 9, hr = o.typing ? (o.phase ? 8 : 7) : 9;
  q(3, 11, 1, 2, p.shirtS); q(12, 11, 1, 2, p.shirtS);
  q(2, hl + 1, 1, 12 - hl, p.shirtS); q(2, hl, 1, 1, p.skin);
  if (o.raise) { q(13, 1, 1, 11, p.shirtS); q(13, 0, 1, 1, p.skin); } else { q(13, hr + 1, 1, 12 - hr, p.shirtS); q(13, hr, 1, 1, p.skin); }
  headBack(q, p, d);
}
/* seated, facing viewer (south sofa, OMA). sy = seat tile top + 6 (sofa) */
function drawSeatedFront(g, d, cx, sy, o) {
  const p = d.pal, q = painter(g, cx - 8, sy - 14, false);
  q(5, 19, 2, 2, p.pants); q(9, 19, 2, 2, p.pants); q(5, 21, 2, 1, p.shoes); q(9, 21, 2, 1, p.shoes);
  q(4, 17, 8, 2, p.pants); q(4, 18, 8, 1, p.pantsS);
  q(4, 12, 8, 5, p.shirt); q(10, 12, 2, 5, p.shirtS); q(7, 12, 2, 1, p.skin);
  if (d.style === 'oma') { q(5, 13, 1, 3, p.acc); q(10, 13, 1, 3, p.acc); }
  if (o.typing) { const a = o.phase ? 0 : 1; q(3, 13, 1, 3, p.shirtS); q(4, 15 + a, 1, 1, p.skin); q(12, 13, 1, 3, p.shirtS); q(11, 16 - a, 1, 1, p.skin); }
  else if (!o.think) { q(3, 13, 1, 3, p.shirtS); q(4, 16, 1, 1, p.skin); q(12, 13, 1, 3, p.shirtS); q(11, 16, 1, 1, p.skin); }
  headFront(q, p, d, o.blink);
  if (o.think) { q(3, 13, 1, 3, p.shirtS); q(4, 16, 1, 1, p.skin); q(12, 12, 1, 3, p.shirtS); q(10, 11, 3, 1, p.skin); }
  if (o.cup) { q(11, 14, 2, 3, '#f2f2f2'); q(11, 14, 2, 1, '#6b4a35'); }
}

/* ---------------------------------------------------------------- tiny pixel icon bubbles */
const ICONS = {
  check: { c: '#2f9e4f', rows: ['......#', '.....#.', '#...#..', '.#.#...', '..#....'] },
  cross: { c: '#d64545', rows: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'] },
  bang: { c: '#d9952a', rows: ['#', '#', '#', '.', '#'] },
  quest: { c: '#2f7fc0', rows: ['.##.', '#..#', '..#.', '....', '..#.'] },
  clock: { c: '#3a4152', rows: ['.###.', '#.#.#', '#.###', '#...#', '.###.'] },
  mag: { c: '#5a46a0', rows: ['.##..', '#..#.', '#..#.', '.##..', '...##'] },
};
function iconBubble(g, x, y, type, t) { // x=center, y=tail tip
  const L = x - 5, T = y - 10;
  P(g, L + 1, T, 9, 1, OUT); P(g, L, T + 1, 1, 6, OUT); P(g, L + 10, T + 1, 1, 6, OUT); P(g, L + 1, T + 7, 9, 1, OUT);
  P(g, L + 1, T + 1, 9, 6, '#f7f8fb'); P(g, L + 4, T + 7, 3, 1, '#f7f8fb'); P(g, L + 4, T + 8, 1, 1, OUT); P(g, L + 6, T + 8, 1, 1, OUT); P(g, L + 5, T + 8, 1, 1, '#f7f8fb'); P(g, L + 5, T + 9, 1, 1, OUT);
  if (type === 'dots') { const a = Math.floor(t / 0.45) % 3; for (let i = 0; i < 3; i++) P(g, L + 2 + i * 3, T + (i === a ? 3 : 4), 1, 1, i === a ? '#1d8fd0' : '#3a4152'); return; }
  const ic = ICONS[type]; if (!ic) return; const w = ic.rows[0].length, ox = L + 1 + Math.floor((9 - w) / 2), oy = T + 1;
  g.fillStyle = ic.c; for (let r = 0; r < ic.rows.length; r++) for (let cI = 0; cI < w; cI++) if (ic.rows[r][cI] === '#') g.fillRect(ox + cI, oy + r, 1, 1);
}

/* ---------------------------------------------------------------- screen activity (only while the owner is WORKING / VERIFYING) */
function drawScreen(g, s, t, active) {
  const { x, y, w, h, kind } = s;
  if (!active) { P(g, x, y, w, h, '#1b2638'); P(g, x, y, w, 1, '#22324a'); P(g, x + 1, y + h - 2, 2, 1, '#2c3e5a'); return; }
  const step = Math.floor(t / 0.5);
  switch (kind) {
    case 'doc': P(g, x, y, w, h, '#e9eef6'); P(g, x, y, w, 2, '#3e7cb1'); P(g, x + 1, y, Math.min(w - 2, 5), 1, '#9cc0de');
      for (let i = 0; i < h - 3; i++) { const ln = (i + step) % 5; if (ln === 4) continue; P(g, x + 1, y + 3 + i, 3 + ((ln * 7 + i) % (w - 4)), 1, i === (step % (h - 3)) ? '#3e7cb1' : '#8d99b0'); } break;
    case 'browser': case 'tabs': P(g, x, y, w, h, '#f0f3f8'); P(g, x, y, w, 1, '#3a4152'); P(g, x + 1, y, 3, 1, '#8fb8ff'); P(g, x + 1, y + 1, w - 2, 1, '#c9d0de');
      for (let i = 0; i < h - 3; i++) { const k = (i + step) % 4; P(g, x + 1, y + 3 + i, k === 0 ? Math.max(2, w - 4) : k === 1 ? 4 : 0, 1, k === 0 ? '#4f7fd8' : '#9aa3b5'); if (k === 2) P(g, x + 1, y + 3 + i, 3, 1, '#e0b24a'); } break;
    case 'tools': P(g, x, y, w, h, '#1d2433'); P(g, x + 1, y + 1, 6, 4, '#3a4a6a'); P(g, x + 1, y + 1, 6, 1, '#6fd3ff'); P(g, x + 5, y + 3, 6, 4, '#4a5a7a'); P(g, x + 5, y + 3, 6, 1, '#8be0a4');
      { const cx = x + 2 + (step % (w - 3)), cy = y + 2 + ((step >> 1) % (h - 3)); P(g, cx, cy, 1, 2, '#ffffff'); } break;
    case 'term': P(g, x, y, w, h, '#0f1912'); for (let i = 0; i < h - 1; i++) { const n = (i + step) % 6; P(g, x + 1, y + 1 + i, 2 + (n * 3) % (w - 3), 1, n === 5 ? '#ffffff' : '#7ee08a'); } break;
    case 'check': P(g, x, y, w, h, '#eef1f6'); for (let i = 0; i < 3; i++) { const on = (step % 4) > i; P(g, x + 1, y + 1 + i * 2 + 1, 2, 1, on ? '#2f9e4f' : '#c3cad8'); P(g, x + 4, y + 2 + i * 2, w - 6, 1, '#9aa3b5'); } break;
    case 'video': P(g, x, y, w, h, '#151821'); P(g, x + 1, y + 1, w - 2, h - 3, '#3a2a3a'); P(g, x + 5, y + 2, 1, 3, '#ff4d4d'); P(g, x + 6, y + 3, 1, 1, '#ff4d4d');
      P(g, x + 1, y + h - 1, w - 2, 1, '#555b6b'); P(g, x + 1, y + h - 1, 1 + (step % (w - 2)), 1, '#ff4d4d'); break;
    default: P(g, x, y, w, h, '#2a4a6b');
  }
  P(g, x - 1, y - 1, w + 2, 1, 'rgba(111,211,255,.25)');
}

/* ======================================================================
   OfficeTown - public API
     new OfficeTown(canvasId, {panel?: elementId, seed?: number})
     applyTask(ev)                 the ONLY way worker/task state changes (one backend task event)
     applyReply(reply)             optional: final reply text for the coordinator panel
     updateFromBackendStatus(data) restore: every worker IDLE
     onTaskEvent(), setAgentWorking()   no-ops (compatibility with ui/agent_town.js callers)
     resize()
   Movement is visual only and never feeds back into state.
   ====================================================================== */
const SHORT_STATE = { WORKING: 'WORK', VERIFYING: 'VERIFY', WAITING: 'WAIT', COMPLETED: 'DONE', FAILED: 'FAIL', IDLE: 'idle', CANCELLED: 'STOP', ASSIGNED: 'ASSIGN', PLANNING: 'PLAN' };
const tileOfX = x => Math.round((x - 8) / TILE), tileOfY = y => Math.round((y - 13) / TILE);
const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

class OfficeTown {
  constructor(canvasId, opts = {}) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this._loop = this._loop.bind(this); this._raf = 0; this._dirty = true;
    this.ctx = this.canvas.getContext('2d');
    this.world = mk(LW, LH); this.g = this.world.getContext('2d');
    this.bg = renderBackground(); this.light = renderLighting(); this.items = buildSprites();
    this.onTick = null; this.paused = false; this.timeScale = 1;
    this.selected = null; this._panelT = 0;
    this.panel = opts.panel ? document.getElementById(opts.panel) : null;
    if (!this.panel) { this.panel = document.createElement('div'); this.panel.className = 'ot-panel'; const par = this.canvas.parentElement; if (par) { if (getComputedStyle(par).position === 'static') par.style.position = 'relative'; par.appendChild(this.panel); } }
    this.panel.addEventListener('click', e => { if (e.target && e.target.dataset && e.target.dataset.close) { this.selected = null; this._renderPanel(); } });
    this.selfCheck = this._selfCheck();
    this.reset(opts.seed || 1);
    this._acc = 0; this._last = performance.now(); this._lastRender = 0;
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden) { if (this._raf) cancelAnimationFrame(this._raf); this._raf = 0; } else { this._last = performance.now(); this._kick(); } });
    this.canvas.addEventListener('click', e => this._click(e));
    this.canvas.addEventListener('mousemove', e => { const h = this._hit(e); this.canvas.style.cursor = h ? 'pointer' : 'default'; });
    this.resize();
    this.render();
    this._kick();
  }

  /* ---------------- state reset */
  reset(seed) {
    this.clock = 0; this.rng = mulberry32(seed || 1);
    this.task = { id: '', text: '', status: '', stage: '', model: '', seq: 0, ended: false, resultAt: null, result: '', reply: '', notes: [], kind: '' };
    this.oma = { def: OMA_DEF, queue: [], bubble: null, badge: null };
    this.spotsTaken = {};
    this.chars = {}; this.charList = [];
    for (const [id, d] of Object.entries(WORKER_DEFS)) {
      const c = { id, def: d, x: d.idle[0] * TILE + 8, y: d.idle[1] * TILE + 13, dir: d.idleDir, mode: 'stand', place: 'idle', goal: null, path: [], walkT: 0, trans: null,
        seatPose: null, seatTY: 0, seatedAt: 0, badge: null, speech: null, loungeSpot: null, loungeUntil: null, nextLoungeAt: d.lounge0 + this.rng() * 4,
        lookDir: null, lookNext: 3 + this.rng() * 5, blinkOff: this.rng() * 4,
        rec: { state: 'IDLE', step: '', done: 0, failed: 0, taskId: '', taskText: '', steps: [], lastOutput: '', errors: [], evidence: [], resultAt: null, finalBadge: null, released: true } };
      c.deskGoal = { key: 'desk', place: 'desk', tile: d.approach, seat: { tile: d.chair, pose: 'back' }, face: 'up' };
      c.idleGoal = { key: 'idle', place: 'idle', tile: d.idle, face: d.idleDir };
      c.atGoal = c.idleGoal;
      this.chars[id] = c; this.charList.push(c);
    }
    this._acc = 0; this.requestRender && this.requestRender(); this._renderPanel && this._renderPanel();
  }

  /* ---------------- public API */
  applyTask(ev) {
    if (!ev || typeof ev !== 'object') return;
    const T = this.task, now = this.clock;
    if (ev.task_id && (ev.kind === 'task' || ev.task_id !== T.id)) {
      Object.assign(T, { id: ev.task_id, text: ev.kind === 'task' ? (ev.detail || '') : T.text, status: '', stage: '', model: '', seq: 0, ended: false, resultAt: null, result: '', reply: '', notes: [] });
      this.oma.badge = null; this.oma.queue = [];
      for (const c of this.charList) Object.assign(c.rec, { taskId: ev.task_id, taskText: T.text, steps: [], lastOutput: '', errors: [], evidence: [], resultAt: null, finalBadge: null, released: false });
      if (ev.kind === 'task') this._omaSay('New task: ' + (ev.detail || ''));
    }
    if (ev.status) T.status = ev.status;
    if (ev.stage) T.stage = ev.stage;
    if (ev.seq) T.seq = ev.seq;
    T.kind = ev.kind || '';
    if (ev.active_model) T.model = ev.active_model.resolved || ev.active_model.model || '';
    if (ev.kind === 'stage' && ev.detail) this._omaSay(ev.detail);
    if (ev.kind === 'model' && ev.detail) this._omaSay('Model: ' + ev.detail);
    if (ev.kind === 'note' && ev.detail) T.notes.push(ev.detail);
    if (ev.workers && typeof ev.workers === 'object') {
      for (const c of this.charList) {
        const w = ev.workers[c.id]; if (!w) continue;
        const prev = c.rec.state;
        c.rec.state = String(w.state || 'IDLE').toUpperCase(); c.rec.step = w.step || ''; c.rec.done = w.done | 0; c.rec.failed = w.failed | 0;
        if (c.rec.state !== 'IDLE' && prev === 'IDLE') { c.rec.taskId = ev.task_id || c.rec.taskId; c.rec.taskText = T.text; }
      }
    }
    if (ev.kind === 'step' && ev.step && this.chars[ev.worker || ev.step.worker]) {
      const c = this.chars[ev.worker || ev.step.worker], s = ev.step, r = c.rec;
      let row = r.steps.find(x => x.id && x.id === s.id); if (!row) { row = { id: s.id || '', label: s.label || '' }; r.steps.push(row); }
      Object.assign(row, { label: s.label || row.label, status: s.status || '', output: s.output || '', error: s.error || '' });
      if (s.status === 'RUNNING') this._omaSay('Assigning ' + c.def.name + ': ' + (s.label || ''));
      if (s.status === 'DONE') { if (s.output) r.lastOutput = s.output; c.badge = { type: 'check', until: now + 2.2 }; }
      if (s.status === 'FAILED') { r.errors.push((s.label || 'step') + ': ' + (s.error || 'failed')); c.badge = { type: 'cross', until: now + 3 }; }
    }
    if (ev.kind === 'worker' && this.chars[ev.worker]) this._omaSay('Asking ' + this.chars[ev.worker].def.name + ': ' + (ev.detail || ''));
    if (ev.kind === 'evidence' && this.chars.dave) { const r = this.chars.dave.rec; r.evidence.push({ ok: ev.ok === true ? true : ev.ok === false ? false : null, detail: ev.detail || '' }); r.lastOutput = ev.detail || r.lastOutput; }
    if (ev.kind === 'result') {
      T.ended = true; T.resultAt = now; T.result = ev.detail || '';
      this.oma.badge = { type: ev.status === 'COMPLETED' ? 'check' : ev.status === 'PARTIAL' ? 'bang' : 'cross', until: now + 6 };
      this._omaSay((ev.status || 'Finished') + ': ' + (ev.detail || ''));
      for (const c of this.charList) if (c.rec.state !== 'IDLE' && !c.rec.released) { c.rec.resultAt = now; c.rec.finalBadge = (c.rec.state === 'FAILED' || c.rec.state === 'CANCELLED') ? 'cross' : 'check'; }
    }
    this.lastEvent = ev;
    this._renderPanel(); this.requestRender();
  }
  applyReply(rep) { if (!rep) return; this.task.reply = rep.reply || ''; this._renderPanel(); }
  updateFromBackendStatus(data) {
    for (const c of this.charList) Object.assign(c.rec, { state: 'IDLE', step: '', released: true, resultAt: null, finalBadge: null });
    if (data && data.task_id) this.task.id = data.task_id;
    this.task.ended = true; this._renderPanel(); this.requestRender();
  }
  onTaskEvent() { }
  setAgentWorking() { }

  /* ---------------- clock / loop */
  setPaused(p) { this.paused = !!p; this._last = performance.now(); this._kick(); }
  advance(sec) { const n = Math.max(0, Math.round(sec / DT)); for (let i = 0; i < n; i++) this._fixedStep(); this.requestRender(); }
  requestRender() { this._dirty = true; this._kick(); }
  _kick() { if (!this._raf && !document.hidden && this._loop) this._raf = requestAnimationFrame(this._loop); }
  _loop(now) {
    this._raf = 0; if (document.hidden) return;
    let dt = (now - this._last) / 1000; this._last = now; if (dt > 0.25) dt = 0.25; if (dt < 0) dt = 0;
    if (!this.paused) { this._acc += dt * this.timeScale; let n = 0; while (this._acc >= DT && n < 600) { this._fixedStep(); this._acc -= DT; n++; } if (n >= 600) this._acc = 0; }
    const moving = this.charList.some(c => c.mode === 'walk' || c.mode === 'trans');
    const active = moving || (this.task.id && !this.task.ended) || this.charList.some(c => c.rec.state !== 'IDLE' && !c.rec.released);
    const interval = moving ? 0 : active ? 1000 / 30 : 1000 / 15;
    if (this._dirty || (!this.paused && now - this._lastRender >= interval - 2)) { this.render(); this._lastRender = now; this._dirty = false; }
    if (!this.paused) this._raf = requestAnimationFrame(this._loop);
  }
  _fixedStep() { this.clock += DT; if (this.onTick) this.onTick(this.clock); this._update(DT); }
  _update(dt) {
    const o = this.oma, now = this.clock;
    if ((!o.bubble || now >= o.bubble.until) && o.queue.length) { const txt = o.queue.shift(); o.bubble = { text: txt, until: now + (o.queue.length ? 2.2 : 4.5) }; }
    for (const c of this.charList) this._updateChar(c, dt);
  }
  _omaSay(text) { const q = this.oma.queue; q.push(text); while (q.length > 2) q.shift(); }
  _say(c, text, dur) { c.speech = { text, until: this.clock + dur }; }

  /* ---------------- worker behaviour (visual only) */
  _busy(c) { return c.rec.state !== 'IDLE' && !c.rec.released; }
  _goal(c) { if (this._busy(c)) return c.deskGoal; if (c.loungeSpot) return c.loungeSpot.goal; return c.idleGoal; }
  _pickSpot(c) {
    const free = LOUNGE_SPOTS.filter(s => !this.spotsTaken[s.key]); if (!free.length) return null;
    const s = free[Math.floor(this.rng() * free.length)]; this.spotsTaken[s.key] = c.id;
    return { def: s, goal: { key: 'lounge:' + s.key, place: 'lounge', tile: s.tile, seat: s.seat ? { tile: s.seat, pose: s.pose } : null, face: s.face || 'down', act: s.act } };
  }
  _freeSpot(c) { if (c.loungeSpot) { delete this.spotsTaken[c.loungeSpot.def.key]; c.loungeSpot = null; c.loungeUntil = null; } }
  _updateChar(c, dt) {
    const r = c.rec, now = this.clock;
    if (r.resultAt != null && !r.released && r.state !== 'IDLE' && c.mode === 'seated' && c.place === 'desk') {
      if (now >= Math.max(r.resultAt, c.seatedAt) + HOLD) { r.released = true; this._say(c, r.finalBadge === 'cross' ? 'That step failed. Heading back …' : 'Done. Heading back …', 2.8); }
    }
    const busy = this._busy(c);
    if (busy && c.loungeSpot) { this._freeSpot(c); c.nextLoungeAt = now + 40 + this.rng() * 40; }
    if (!busy) {
      if (c.loungeSpot && c.place === 'lounge' && c.mode !== 'walk' && c.mode !== 'trans' && c.loungeUntil != null && now >= c.loungeUntil) {
        this._freeSpot(c); c.nextLoungeAt = now + 45 + this.rng() * 45; this._say(c, 'Back to my spot …', 2.4);
      } else if (!c.loungeSpot && c.place === 'idle' && c.mode === 'stand' && now >= c.nextLoungeAt) {
        const s = this._pickSpot(c); if (s) { c.loungeSpot = s; this._say(c, s.def.say, 2.6); } else c.nextLoungeAt = now + 15;
      }
    }
    const goal = this._goal(c);
    if (c.mode === 'trans') {
      const T = c.trans; T.t += dt; const k = Math.min(1, T.t / T.dur);
      c.x = T.fx + (T.tx - T.fx) * k; c.y = T.fy + (T.ty - T.fy) * k; c.walkT += dt;
      if (T.type === 'sit' && T.pose === 'front' && k > 0.7) c.dir = 'down';
      if (k >= 1) {
        c.trans = null;
        if (T.type === 'sit') { c.mode = 'seated'; c.seatPose = T.pose; c.seatTY = T.seatTY; c.seatedAt = now; c.atGoal = T.goal; c.place = T.goal.place; c.dir = T.pose === 'back' ? 'up' : 'down'; if (T.goal.place === 'lounge') c.loungeUntil = now + 14 + this.rng() * 12; }
        else { c.mode = 'stand'; c.atGoal = { key: '_transit' }; c.place = null; }
      }
      return;
    }
    if (c.mode === 'seated') { if (goal.key !== c.atGoal.key) this._startStand(c); return; }
    if (c.mode === 'walk') { if (goal.key !== c.goal.key) this._repath(c, goal); this._walk(c, dt); return; }
    if (goal.key !== (c.atGoal && c.atGoal.key)) { this._startWalk(c, goal); return; }
    if (c.place === 'idle' && now >= c.lookNext) {
      if (c.lookDir) { c.lookDir = null; c.lookNext = now + 5 + this.rng() * 6; } else { c.lookDir = this.rng() < 0.5 ? 'left' : 'right'; c.lookNext = now + 1.4 + this.rng(); }
    }
  }
  _startWalk(c, goal) {
    const sx = tileOfX(c.x), sy = tileOfY(c.y);
    const path = findPath(sx, sy, goal.tile[0], goal.tile[1]);
    c.lookDir = null;
    if (!path) { console.warn('OfficeTown: no route', c.id, [sx, sy], goal.tile); c.atGoal = goal; c.place = goal.place; return; }
    c.goal = goal; c.path = path; c.mode = 'walk'; c.atGoal = null; c.place = null; c.walkT = 0;
    if (goal.place === 'desk') this._say(c, c.rec.state === 'VERIFYING' ? 'Checking the evidence …' : c.rec.step ? 'On it: ' + clip(c.rec.step, 42) : 'Heading to my desk …', 3);
    if (!path.length) this._arrive(c);
  }
  _repath(c, goal) {
    const from = c.path.length ? c.path[0] : [tileOfX(c.x), tileOfY(c.y)];
    const p = findPath(from[0], from[1], goal.tile[0], goal.tile[1]);
    if (!p) return;
    c.path = c.path.length ? [from].concat(p) : p; c.goal = goal;
  }
  _walk(c, dt) {
    let step = WALK * dt; c.walkT += dt;
    while (step > 1e-6 && c.path.length) {
      const [tx, ty] = c.path[0]; const px = tx * TILE + 8, py = ty * TILE + 13; const dx = px - c.x, dy = py - c.y;
      if (dx) c.dir = dx > 0 ? 'right' : 'left'; else if (dy) c.dir = dy > 0 ? 'down' : 'up';
      const d = Math.abs(dx) + Math.abs(dy);
      if (d <= step) { c.x = px; c.y = py; step -= d; c.path.shift(); }
      else { if (dx) c.x += Math.sign(dx) * step; else c.y += Math.sign(dy) * step; step = 0; }
    }
    if (!c.path.length) this._arrive(c);
  }
  _arrive(c) {
    const goal = c.goal;
    if (goal.seat) {
      const [sx, sy] = goal.seat.tile;
      c.trans = { type: 'sit', t: 0, dur: SIT_T, fx: c.x, fy: c.y, tx: sx * TILE + 8, ty: sy * TILE + 13, pose: goal.seat.pose, seatTY: sy, goal };
      c.mode = 'trans'; c.dir = 'up';
    } else {
      c.mode = 'stand'; c.dir = goal.face; c.atGoal = goal; c.place = goal.place;
      if (goal.place === 'lounge') c.loungeUntil = this.clock + 14 + this.rng() * 12;
    }
  }
  _startStand(c) {
    const g = c.atGoal; const [ax, ay] = g.tile;
    c.trans = { type: 'stand', t: 0, dur: STAND_T, fx: c.x, fy: c.y, tx: ax * TILE + 8, ty: ay * TILE + 13 };
    c.mode = 'trans'; c.dir = 'down'; c.place = null; c.seatPose = null;
  }

  /* ---------------- rendering */
  _charBase(c) { return c.mode === 'seated' ? (c.seatPose === 'front' ? c.seatTY * TILE + 16.5 : c.seatTY * TILE + 14) : c.y; }
  _headTop(c) { if (c.mode === 'seated') return c.seatPose === 'front' ? c.seatTY * TILE - 7 : c.seatTY * TILE - 11; return Math.round(c.y) - 21; }
  _drawChar(g, c) {
    const t = this.clock, x = Math.round(c.x), y = Math.round(c.y), d = c.def, st = c.rec.state;
    const blink = ((t + c.blinkOff) % 4.2) < 0.13;
    if (c.mode === 'seated') {
      const atDesk = c.place === 'desk';
      const cup = c.place === 'lounge' && ((t + c.blinkOff) % 6) < 2;
      if (c.seatPose === 'back') drawSeatedBack(g, d, x, c.seatTY * TILE + 8, { typing: atDesk && (st === 'WORKING' || st === 'VERIFYING'), phase: Math.floor(t / 0.22) % 2, raise: atDesk && st === 'WAITING' });
      else drawSeatedFront(g, d, x, c.seatTY * TILE + 6, { blink, cup });
      return;
    }
    let dir = c.dir, frame = 0;
    if (c.mode === 'walk') frame = Math.floor(c.walkT / 0.16) % 4;
    else if (c.mode === 'trans') frame = Math.floor(c.walkT / 0.16) % 4;
    else if (c.place === 'idle' && c.lookDir) dir = c.lookDir;
    const cup = c.mode === 'stand' && c.place === 'lounge' && c.atGoal && c.atGoal.act === 'cup' && ((t + c.blinkOff) % 5) < 1.8;
    drawStanding(g, d, x, y, dir, frame, { blink, cup });
  }
  _omaPose() {
    const T = this.task, run = T.id && !T.ended;
    return { think: run && ['received', 'analyzing', 'planning'].includes(T.stage), typing: run && T.stage === 'executing', verify: run && T.stage === 'verifying' };
  }
  _drawOma(g) {
    const t = this.clock, p = this._omaPose();
    drawSeatedFront(g, OMA_DEF, 28 * TILE + 8, 4 * TILE + 8, { blink: (t % 3.7) < 0.13, think: p.think, typing: p.typing, phase: Math.floor(t / 0.22) % 2 });
  }
  _itemDyn(g, it, t) {
    const o = it.o, running = this.task.id && !this.task.ended;
    if (o.screens) { const c = this.chars[o.owner]; const act = c && (c.rec.state === 'WORKING' || c.rec.state === 'VERIFYING'); for (const s of o.screens) drawScreen(g, s, t, act); }
    if (o.rack) {
      for (let u = 0; u < 7; u++) {
        const yy = it.sy + 3 + u * 4 + 1, ph = (it.tx * 0.37 + it.ty * 0.11 + u * 0.23) % 1;
        const a = running ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin((t / 2.6 + ph) * Math.PI * 2)) : 0.45;
        g.globalAlpha = a; P(g, it.sx + 10, yy, 1, 1, '#5be37a'); P(g, it.sx + 12, yy, 1, 1, u % 3 === 0 ? '#6fd3ff' : '#5be37a'); g.globalAlpha = 1;
        if (running && u === 2 && ((t + ph * 2) % 1.8) < 0.9) P(g, it.sx + 9, yy, 1, 1, '#f2c46b');
      }
    }
    if (it.kind === 'commandDesk') {
      const cx = it.sx + 40, cy = it.sy + it.up + 3;
      const a = running ? 0.75 + 0.25 * Math.sin(t * 2.1) : 0.35;
      g.globalAlpha = a * 0.35; P(g, cx - 5, cy - 1, 10, 4, '#6fd3ff'); g.globalAlpha = a;
      P(g, cx - 2, cy - 1, 4, 1, '#bff0ff'); P(g, cx - 3, cy, 6, 2, '#6fd3ff'); P(g, cx - 2, cy + 2, 4, 1, '#3d9fd0');
      if (running) { const k = Math.floor(t / 0.25) % 8, pts = [[-5, 1], [-4, 0], [-2, -1], [1, -1], [3, 0], [4, 1], [2, 3], [-2, 3]]; P(g, cx + pts[k][0], cy + pts[k][1], 1, 1, '#ffffff'); }
      g.globalAlpha = 1;
      for (const [mx, my] of [[7, 1], [57, 1]]) { P(g, it.sx + mx, it.sy + my, 16, 1, running ? '#3d7fa6' : '#2a3142'); }
    }
    if (it.kind === 'pillar') { const a = running ? 0.55 + 0.45 * Math.sin(t * 1.6) : 0.25; g.globalAlpha = a; P(g, it.sx + 7, it.sy + 2, 2, it.th * TILE + it.up - 7, running ? '#6fd3ff' : '#3d7fa6'); g.globalAlpha = 1; }
    if (it.kind === 'console') { const step = Math.floor(t / 0.6); for (let i = 0; i < 3; i++) { const X = it.sx + (o.side === 'left' ? 7 : 4), Y = it.sy + 5 + i * 15; P(g, X, Y + 1 + ((step + i) % 6), 5, 1, running ? '#6fd3ff' : '#2c4a6a'); P(g, X, Y + 6, 3, 1, '#2c4a6a'); } }
    if (it.kind === 'netCab') { const bob = this.chars.bob, on = bob.rec.state === 'WORKING'; for (let i = 0; i < 3; i++) P(g, it.sx + 5 + i * 2, it.sy + 4, 1, 1, on && ((t * 1.2 + i * 0.3) % 1) < 0.5 ? '#7ee08a' : '#3a6a4a'); }
    if (it.kind === 'ringLight' && this.chars.eve.rec.state === 'WORKING') { g.globalAlpha = 0.18; P(g, it.sx + 1, it.sy + it.up - 18, 14, 14, '#fff6d8'); g.globalAlpha = 1; }
    if (it.kind === 'camera' && this.chars.eve.rec.state === 'WORKING' && (t % 1.6) < 0.8) P(g, it.sx + 11, it.sy + it.up - 9, 1, 1, '#ff4d4d');
  }
  _drawWallDyn(g, t) {
    const S = WALL_SCREENS, T = this.task, running = T.id && !T.ended, step = Math.floor(t / 0.5);
    { const s = S.task; const col = STATE_COL[T.status] || '#2a3a5a'; P(g, s.x + 2, s.y + 2, s.w - 4, 1, T.id ? col : '#2a3a5a'); if (running) { const k = step % (s.w - 8); g.globalAlpha = 0.5; P(g, s.x + 3 + k, s.y + s.h - 4, 4, 1, '#6fd3ff'); g.globalAlpha = 1; } }
    { const s = S.team; this.charList.forEach((c, i) => { const st = c.rec.state, col = STATE_COL[st] || '#7d8597'; const busy = st !== 'IDLE' && !c.rec.released; g.globalAlpha = busy && BUSY_LIGHT.has(st) ? 0.6 + 0.4 * Math.sin(t * 2 + i) : busy ? 1 : 0.55; P(g, s.x + 4, s.y + 4 + i * 6 + 1, 3, 3, col); g.globalAlpha = 1; }); }
    { const s = S.check, ev = this.chars.dave.rec.evidence.slice(-3);
      for (let i = 0; i < 3; i++) { const e = ev[i], X = s.x + 4, Y = s.y + 10 + i * 6; P(g, X, Y, 4, 4, '#9aa3b5'); P(g, X + 1, Y + 1, 2, 2, e ? (e.ok === true ? '#2f9e4f' : e.ok === false ? '#d64545' : '#d9952a') : '#e9edf3'); if (!e) P(g, X + 7, Y + 1, s.w - 14, 1, '#d3d8e2'); } }
    const bobOn = this.chars.bob.rec.state === 'WORKING';
    for (const k of ['bob1', 'bob2']) { const s = S[k]; drawScreen(g, { x: s.x + 2, y: s.y + 2, w: s.w - 4, h: s.h - 4, kind: 'browser' }, t + (k === 'bob2' ? 0.25 : 0), bobOn); }
    { const s = S.tools, on = this.chars.carol.rec.state === 'WORKING', X = s.x + 2, Y = s.y + 2, W = s.w - 4, H = s.h - 4;
      P(g, X, Y, W, H, on ? '#1d2a40' : '#16223a');
      const wins = [[2, 2, 22, 13, '#3e7cb1'], [27, 4, 20, 12, '#5aa86a'], [50, 2, 20, 10, '#8a6fc9'], [10, 12, 26, 8, '#e0b24a']];
      for (const [wx, wy, ww, wh, wc] of wins) { P(g, X + wx, Y + wy, ww, wh, on ? '#d9dee8' : '#2a3650'); P(g, X + wx, Y + wy, ww, 2, on ? wc : '#33415e'); }
      P(g, X, Y + H - 2, W, 2, '#0f1626'); for (let i = 0; i < 6; i++) P(g, X + 3 + i * 5, Y + H - 2, 3, 1, on ? '#6fd3ff' : '#2c3e5a');
      if (on) { const k = step % 24, px = X + 4 + (k < 12 ? k * 5 : (24 - k) * 5), py = Y + 6 + (k % 6); P(g, px, py, 1, 3, '#ffffff'); P(g, px + 1, py + 1, 1, 1, '#ffffff'); } }
    { const s = S.video, on = this.chars.eve.rec.state === 'WORKING', X = s.x + 2, Y = s.y + 2, W = s.w - 4, H = s.h - 4;
      P(g, X, Y, W, H, '#151821'); for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { P(g, X + 2 + i * 13, Y + 2 + j * 8, 11, 6, on ? ['#6a3a4a', '#3a4a6a', '#4a6a3a'][(i + j + (on ? step : 0)) % 3] : '#22283a'); }
      P(g, X + 18, Y + 6, 3, 4, on ? '#ff4d4d' : '#5a2a2a'); P(g, X + 21, Y + 7, 1, 2, on ? '#ff4d4d' : '#5a2a2a');
      P(g, X + 1, Y + H - 2, W - 2, 1, '#3a3f4f'); if (on) P(g, X + 1, Y + H - 2, 1 + (step % (W - 2)), 1, '#ff4d4d'); }
    { const s = S.srv; for (let i = 0; i < 6; i++) { const a = running ? 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 1.8 + i)) : 0.5; g.globalAlpha = a; P(g, s.x + 3 + i * 4, s.y + 3, 2, 2, i === 5 && running ? '#f2c46b' : '#5be37a'); g.globalAlpha = 1; } }
  }
  _iconFor(c) {
    const now = this.clock, r = c.rec, seatedDesk = c.mode === 'seated' && c.place === 'desk';
    if (c.badge && now < c.badge.until) return c.badge.type;
    if (seatedDesk && r.resultAt != null && !r.released) return r.finalBadge;
    if (seatedDesk && r.state === 'WAITING') return 'clock';
    if (seatedDesk && r.state === 'VERIFYING') return 'mag';
    if (seatedDesk && r.state === 'WORKING') return 'dots';
    return null;
  }
  render() {
    if (!this.ctx) return;
    const g = this.g, t = this.clock;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.bg, 0, 0);
    this._drawWallDyn(g, t);
    const list = this.items.slice();
    for (const c of this.charList) list.push({ base: this._charBase(c), ch: c });
    list.push({ base: 4 * TILE + 16.5, oma: true });
    list.sort((a, b) => a.base - b.base);
    for (const e of list) {
      if (e.ch) this._drawChar(g, e.ch); else if (e.oma) this._drawOma(g);
      else { g.drawImage(e.sprite, e.sx, e.sy); this._itemDyn(g, e, t); }
    }
    g.drawImage(this.light, 0, 0);
    for (const c of this.charList) { const ic = this._iconFor(c); if (ic) iconBubble(g, Math.round(c.x), this._headTop(c) - 2, ic, t); }
    { const p = this._omaPose(), o = this.oma; let ic = null;
      if (o.badge && t < o.badge.until) ic = o.badge.type; else if (p.think) ic = 'quest'; else if (p.verify) ic = 'mag'; else if (p.typing) ic = 'dots';
      if (ic) iconBubble(g, 28 * TILE + 8, 4 * TILE - 8, ic, t); }
    // ---- to screen
    const ctx = this.ctx, cw = this.canvas.width, ch = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#12141b'; ctx.fillRect(0, 0, cw, ch);
    if (!this.sharp) { ctx.imageSmoothingEnabled = false; ctx.drawImage(this.world, this.ox, this.oy, this.dw, this.dh); }
    else {
      const k = this.preK, pg = this.pre.getContext('2d'); pg.imageSmoothingEnabled = false; pg.drawImage(this.world, 0, 0, LW * k, LH * k);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(this.pre, this.ox, this.oy, this.dw, this.dh);
    }
    this._overlay(ctx);
    if (this.selected && performance.now() - this._panelT > 250) this._renderPanel();
  }

  /* ---------------- crisp text overlay (screen space) */
  _sx(lx) { return this.ox + lx * this.u; }
  _sy(ly) { return this.oy + ly * this.u; }
  _font(px, weight, mono) { return `${weight || 400} ${Math.round(px)}px ${mono ? '"Cascadia Mono", Consolas, "Courier New", monospace' : '"Segoe UI", system-ui, sans-serif'}`; }
  _wrap(ctx, text, maxW, maxLines) {
    const words = String(text || '').replace(/\s+/g, ' ').trim().split(' '); const lines = []; let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width <= maxW) { cur = test; continue; }
      if (cur) lines.push(cur); cur = w;
      while (ctx.measureText(cur).width > maxW && cur.length > 1) { let k = cur.length - 1; while (k > 1 && ctx.measureText(cur.slice(0, k)).width > maxW) k--; lines.push(cur.slice(0, k)); cur = cur.slice(k); }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) { const out = lines.slice(0, maxLines); let last = out[maxLines - 1] + '…'; while (ctx.measureText(last).width > maxW && last.length > 2) last = last.slice(0, -2) + '…'; out[maxLines - 1] = last; return out; }
    return lines;
  }
  _fitText(ctx, s, maxW) { s = String(s || ''); if (ctx.measureText(s).width <= maxW) return s; while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1); return s + '…'; }
  _rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  _bubble(ctx, cx, tipY, text, o) {
    const u = this.u, fs = o.fs, lw = Math.max(1, Math.round(u / 2));
    ctx.font = this._font(fs, 500, true);
    const lines = this._wrap(ctx, text, o.maxW, o.lines || 3), lh = Math.round(fs * 1.28), padX = Math.round(fs * 0.6), padY = Math.round(fs * 0.4);
    const w = Math.ceil(Math.max(...lines.map(l => ctx.measureText(l).width)) + padX * 2), h = lines.length * lh + padY * 2, tail = Math.round(fs * 0.55);
    let x = Math.round(cx - w / 2); x = Math.max(this.ox + 2, Math.min(this.ox + this.dw - w - 2, x));
    const y = o.below ? Math.round(tipY + tail) : Math.round(tipY - tail - h);
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    ctx.fillStyle = 'rgba(0,0,0,.25)'; this._rr(ctx, x + lw * 2, y + lw * 2, w, h, Math.round(fs * 0.35)); ctx.fill();
    ctx.fillStyle = '#f7f8fb'; ctx.strokeStyle = '#1e2230'; ctx.lineWidth = lw;
    this._rr(ctx, x + 0.5, y + 0.5, w, h, Math.round(fs * 0.35)); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    if (o.below) { ctx.moveTo(cx - tail, y + 1); ctx.lineTo(cx, tipY); ctx.lineTo(cx + tail, y + 1); } else { ctx.moveTo(cx - tail, y + h - 0.5); ctx.lineTo(cx, tipY); ctx.lineTo(cx + tail, y + h - 0.5); }
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f7f8fb'; ctx.fillRect(cx - tail + lw, o.below ? y + 0.5 : y + h - lw, tail * 2 - lw * 2, lw * 1.5);
    ctx.fillStyle = '#1e2230'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    lines.forEach((l, i) => ctx.fillText(l, x + padX, y + padY + i * lh + Math.round(fs * 0.08)));
    ctx.globalAlpha = 1;
  }
  _tag(ctx, cx, y, name, state, nameBg) {
    const u = this.u, fs = Math.max(9, Math.round(u * 4.3));
    ctx.font = this._font(fs, 700); const nw = Math.ceil(ctx.measureText(name).width) + Math.round(fs * 0.7);
    let sw = 0, sTxt = ''; if (state) { sTxt = state; ctx.font = this._font(fs * 0.9, 700); sw = Math.ceil(ctx.measureText(sTxt).width) + Math.round(fs * 0.7); }
    const h = Math.round(fs * 1.25), tw = nw + sw; let x = Math.round(cx - tw / 2); const yy = Math.round(y);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x + 1, yy + 1, tw, h);
    ctx.fillStyle = nameBg || '#f2d15c'; ctx.fillRect(x, yy, nw, h);
    ctx.fillStyle = '#1d1f2a'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.font = this._font(fs, 700); ctx.fillText(name, x + nw / 2, yy + h / 2 + 0.5);
    if (state) { ctx.fillStyle = '#1b1e29'; ctx.fillRect(x + nw, yy, sw, h); ctx.fillStyle = STATE_COL[state] || '#c9d2e6'; ctx.font = this._font(fs * 0.9, 700); ctx.fillText(sTxt, x + nw + sw / 2, yy + h / 2 + 0.5); }
    ctx.textAlign = 'left';
  }
  _overlay(ctx) {
    const u = this.u, now = this.clock, S = WALL_SCREENS, T = this.task;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    // room labels on the dark wall caps
    const lfs = Math.max(9, Math.min(15, Math.round(u * 5)));
    for (const rm of ROOMS) {
      if (rm.id === 'corridor') continue;
      const top = rm.y < 10, ly = top ? 8 : 22 * TILE + 16, lx = rm.x * TILE + 3;
      ctx.font = this._font(lfs, 700); const label = rm.name.toUpperCase();
      ctx.fillStyle = rm.accent; ctx.fillRect(this._sx(lx), this._sy(ly) - lfs * 0.32, Math.round(lfs * 0.6), Math.round(lfs * 0.6));
      ctx.fillStyle = rm.accent; ctx.fillText(this._fitText(ctx, label, (rm.w * TILE - 10) * u - lfs * 2.5), this._sx(lx) + lfs, this._sy(ly));
      if (rm.who) { const w = ctx.measureText(label).width; ctx.font = this._font(lfs * 0.9, 500); ctx.fillStyle = '#9aa3b5'; const tx = this._sx(lx) + lfs + w + lfs * 0.6; if (tx + ctx.measureText(rm.who).width < this._sx((rm.x + rm.w) * TILE - 2)) ctx.fillText(rm.who, tx, this._sy(ly)); }
    }
    // corridor sign
    { const s = S.sign; ctx.font = this._font(Math.round(s.h * u * 0.72), 800); ctx.fillStyle = '#6fd3ff'; ctx.textAlign = 'center'; ctx.fillText('OMA AI', this._sx(s.x + s.w / 2), this._sy(s.y + s.h / 2) + 1); ctx.textAlign = 'left'; }
    // task board
    { const s = S.task, X = this._sx(s.x + 4), Y = this._sy(s.y + 4), W = (s.w - 8) * u, H = (s.h - 8) * u;
      const fs = Math.max(8, Math.round(u * 4.1)), lh = Math.round(fs * 1.22); ctx.save(); ctx.beginPath(); ctx.rect(X, Y, W, H); ctx.clip(); ctx.textBaseline = 'top';
      ctx.font = this._font(fs * 0.9, 700); ctx.fillStyle = '#7f8db0'; ctx.fillText('CURRENT TASK', X, Y);
      if (T.id) {
        ctx.textAlign = 'right'; ctx.fillStyle = STATE_COL[T.status] || '#c9d2e6'; ctx.fillText(T.status || '', X + W, Y); ctx.textAlign = 'left';
        ctx.font = this._font(fs, 600); ctx.fillStyle = '#eef3ff'; const nl = Math.max(1, Math.min(2, Math.floor(H / lh) - 3));
        const tl = this._wrap(ctx, T.text || '(no text)', W, nl); tl.forEach((l, i) => ctx.fillText(l, X, Y + lh * (1 + i)));
        ctx.font = this._font(fs * 0.9, 400); ctx.fillStyle = '#9fb0d0'; let row = 1 + tl.length;
        ctx.fillText(this._fitText(ctx, 'stage · ' + (T.stage || '-') + (T.model ? '   model · ' + T.model : ''), W), X, Y + lh * row); row++;
        if ((row + 1) * lh <= H + 2) ctx.fillText(this._fitText(ctx, T.id + ' · seq ' + T.seq, W), X, Y + lh * row);
      } else { ctx.font = this._font(fs, 600); ctx.fillStyle = '#c9d2e6'; ctx.fillText('No task running', X, Y + lh); ctx.font = this._font(fs * 0.9, 400); ctx.fillStyle = '#7f8db0'; ctx.fillText('Waiting for a command', X, Y + lh * 2); }
      ctx.restore(); }
    // team board
    { const s = S.team, fs = Math.max(8, Math.round(u * 4.0)); ctx.save(); ctx.beginPath(); ctx.rect(this._sx(s.x + 2), this._sy(s.y + 2), (s.w - 4) * u, (s.h - 4) * u); ctx.clip();
      this.charList.forEach((c, i) => { const cy = this._sy(s.y + 4 + i * 6 + 2.5); ctx.font = this._font(fs, 600); ctx.fillStyle = '#dfe6f5'; ctx.textBaseline = 'middle'; ctx.fillText(c.def.name, this._sx(s.x + 9), cy);
        ctx.textAlign = 'right'; ctx.font = this._font(fs * 0.85, 700); ctx.fillStyle = STATE_COL[c.rec.state] || '#7d8597'; ctx.fillText(SHORT_STATE[c.rec.state] || c.rec.state, this._sx(s.x + s.w - 3), cy); ctx.textAlign = 'left'; });
      ctx.restore(); }
    // QA checklist board
    { const s = S.check, fs = Math.max(8, Math.round(u * 3.9)), ev = this.chars.dave.rec.evidence.slice(-3); ctx.save(); ctx.beginPath(); ctx.rect(this._sx(s.x + 2), this._sy(s.y + 2), (s.w - 4) * u, (s.h - 4) * u); ctx.clip();
      ctx.font = this._font(fs * 0.9, 800); ctx.fillStyle = '#5a46a0'; ctx.textBaseline = 'middle'; ctx.fillText('QA CHECKLIST', this._sx(s.x + 4), this._sy(s.y + 6));
      ctx.font = this._font(fs * 0.85, 500); ctx.fillStyle = '#2b2f3c';
      ev.forEach((e, i) => ctx.fillText(this._fitText(ctx, e.detail, (s.w - 15) * u), this._sx(s.x + 10), this._sy(s.y + 12 + i * 6)));
      ctx.restore(); }
    // name tags
    const tagged = this.charList.slice().sort((a, b) => this._charBase(a) - this._charBase(b));
    for (const c of tagged) {
      const r = c.rec, showState = r.state !== 'IDLE' && !r.released;
      const ty = c.mode === 'seated' ? (c.seatPose === 'front' ? c.seatTY * TILE + 15 : c.seatTY * TILE + 15) : c.y + 2;
      this._tag(ctx, this._sx(c.x), this._sy(ty), c.def.name, showState ? r.state : '');
    }
    this._tag(ctx, this._sx(28 * TILE + 8), this._sy(6 * TILE + 1), 'OMA', T.id && !T.ended ? (T.stage || '').toUpperCase() : '', '#8fe3ff');
    // bubbles
    const bfs = Math.max(9, Math.round(u * 4.6));
    for (const c of this.charList) {
      const r = c.rec, seatedDesk = c.mode === 'seated' && c.place === 'desk', busy = r.state !== 'IDLE' && !r.released;
      let big = null;
      if (seatedDesk && busy && (r.state === 'WORKING' || r.state === 'VERIFYING' || r.state === 'WAITING')) big = r.state === 'WAITING' ? 'Waiting for your OK …' : (r.step || 'Working …');
      const ic = this._iconFor(c) ? 12 : 0;
      const tipY = this._sy(this._headTop(c) - 2 - ic);
      if (big) this._bubble(ctx, this._sx(c.x), tipY, big, { fs: bfs, maxW: 120 * u, lines: 3 });
      else if (c.speech && now < c.speech.until) this._bubble(ctx, this._sx(c.x), tipY, c.speech.text, { fs: Math.max(8, Math.round(bfs * 0.9)), maxW: 96 * u, lines: 2, alpha: Math.min(1, (c.speech.until - now) / 0.4) });
    }
    const ob = this.oma.bubble;
    if (ob && now < ob.until) this._bubble(ctx, this._sx(28 * TILE + 8), this._sy(6 * TILE + 9), ob.text, { fs: bfs, maxW: 150 * u, lines: 3, below: true, alpha: Math.min(1, (ob.until - now) / 0.4) });
  }

  /* ---------------- hit testing + detail panel */
  _hit(e) {
    const r = this.canvas.getBoundingClientRect(), dpr = this.dpr || 1;
    const lx = ((e.clientX - r.left) * dpr - this.ox) / this.u, ly = ((e.clientY - r.top) * dpr - this.oy) / this.u;
    if (lx < 0 || ly < 0 || lx > LW || ly > LH) return null;
    const cs = this.charList.slice().sort((a, b) => this._charBase(b) - this._charBase(a));
    for (const c of cs) { const top = this._headTop(c) - 1, bot = c.mode === 'seated' ? c.seatTY * TILE + 14 : c.y + 1; if (lx >= c.x - 7 && lx <= c.x + 7 && ly >= top && ly <= bot) return c.id; }
    if (lx >= 26 * TILE && lx <= 31 * TILE && ly >= 3.5 * TILE && ly <= 6 * TILE) return 'oma';
    for (const [id, it] of Object.entries(DESK_OF)) if (lx >= it.tx * TILE && lx <= (it.tx + 2) * TILE && ly >= it.ty * TILE - 8 && ly <= (it.ty + 2) * TILE) return id;
    return null;
  }
  _click(e) { const h = this._hit(e); this.selected = h; this._renderPanel(); }
  _movement(c) {
    if (c.mode === 'walk') return c.goal.place === 'desk' ? 'walking to desk' : c.goal.place === 'lounge' ? 'walking to the lounge' : 'walking back to idle spot';
    if (c.mode === 'trans') return c.trans.type === 'sit' ? 'sitting down' : 'standing up';
    if (c.mode === 'seated') { if (c.place === 'desk') { const s = c.rec.state; return s === 'WORKING' || s === 'VERIFYING' ? 'seated at desk, typing' : s === 'WAITING' ? 'seated at desk, hand raised' : 'seated at desk'; } return 'sitting in the lounge'; }
    return c.place === 'lounge' ? 'standing in the lounge' : 'standing at idle spot';
  }
  _renderPanel() {
    const el = this.panel; if (!el) return; this._panelT = performance.now();
    if (!this.selected) { el.style.display = 'none'; el.innerHTML = ''; return; }
    const T = this.task, st = s => `<span class="st" style="background:${STATE_COL[s] || '#9aa3b5'}">${esc(s || '-')}</span>`;
    let h = '<button class="x" data-close="1" title="Close">×</button>';
    if (this.selected === 'oma') {
      h += `<h3>OMA</h3><div class="sub">Coordinator · OMA Control Room</div><dl>
        <dt>Task ID</dt><dd>${esc(T.id || '-')}</dd><dt>Task</dt><dd>${esc(T.text || '-')}</dd>
        <dt>Status</dt><dd>${T.status ? st(T.status) : '-'}</dd><dt>Stage</dt><dd>${esc(T.stage || '-')}</dd>
        <dt>Model</dt><dd>${esc(T.model || '-')}</dd><dt>Last event</dt><dd>${this.lastEvent ? esc('seq ' + this.lastEvent.seq + ' · ' + this.lastEvent.kind + ' · ' + (this.lastEvent.detail || '')) : '-'}</dd>
        <dt>Result</dt><dd>${esc(T.result || '-')}</dd>
        <dt>Notes</dt><dd>${T.notes.length ? '<ul>' + T.notes.map(n => `<li>${esc(n)}</li>`).join('') + '</ul>' : '-'}</dd>
        <dt>Reply</dt><dd>${T.reply ? `<pre>${esc(T.reply)}</pre>` : '-'}</dd></dl>`;
    } else {
      const c = this.chars[this.selected]; if (!c) { el.style.display = 'none'; return; }
      const r = c.rec, d = c.def, room = ROOM_BY_ID[d.room];
      const done = r.steps.filter(s => s.status === 'DONE'), failed = r.steps.filter(s => s.status === 'FAILED');
      h += `<h3>${esc(d.name)}</h3><div class="sub">${esc(d.role)} worker · ${esc(room ? room.name : '')}</div><dl>
        <dt>State</dt><dd>${st(r.state)} <span style="color:#8d95a9">from task events</span></dd>
        <dt>Movement</dt><dd>${esc(this._movement(c))} <span style="color:#8d95a9">(visual only)</span></dd>
        <dt>Task ID</dt><dd>${esc(r.taskId || '-')}</dd><dt>Task</dt><dd>${esc(r.taskText || '-')}</dd>
        <dt>Current step</dt><dd>${esc(r.step || '-')}</dd>
        <dt>Steps</dt><dd>${esc(r.done)} done · ${esc(r.failed)} failed</dd>
        <dt>Completed</dt><dd>${done.length ? '<ul>' + done.map(s => `<li>${esc(s.label)}</li>`).join('') + '</ul>' : '-'}</dd>
        ${failed.length ? `<dt>Failed</dt><dd><ul>${failed.map(s => `<li>${esc(s.label)}</li>`).join('')}</ul></dd>` : ''}
        ${c.id === 'dave' ? `<dt>Evidence</dt><dd>${r.evidence.length ? '<ul>' + r.evidence.map(e => `<li>${e.ok === true ? '✓' : e.ok === false ? '✕' : '?'} ${esc(e.detail)}</li>`).join('') + '</ul>' : '-'}</dd>` : ''}
        <dt>Last output</dt><dd>${r.lastOutput ? `<pre>${esc(clip(r.lastOutput, 1200))}</pre>` : '-'}</dd>
        <dt>Errors</dt><dd>${r.errors.length ? '<ul>' + r.errors.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>' : '-'}</dd></dl>`;
    }
    h += '<div class="note">State comes only from Oma task events; walking and sitting are animation.</div>';
    el.innerHTML = h; el.style.display = 'block';
  }
  _selfCheck() {
    const bad = [];
    const spots = Object.values(WORKER_DEFS).flatMap(d => [d.idle, d.approach]).concat(LOUNGE_SPOTS.map(s => s.tile));
    for (const a of spots) if (!walkable(a[0], a[1])) bad.push('blocked spot ' + a);
    for (const d of Object.values(WORKER_DEFS)) for (const b of spots) { if (!findPath(d.idle[0], d.idle[1], b[0], b[1]) && !(d.idle[0] === b[0] && d.idle[1] === b[1])) bad.push(`no route ${d.name} -> ${b}`); }
    if (bad.length) console.error('OfficeTown self-check:', bad);
    return bad;
  }
  resize() {
    if (!this.canvas) return;
    const r = this.canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(r.width * dpr)), ch = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
    const m = Math.round(8 * dpr), fit = Math.max(0.1, Math.min((cw - 2 * m) / LW, (ch - 2 * m) / LH));
    let u = Math.floor(fit); this.sharp = false;
    if (u < 1 || u / fit < 0.72) { u = fit; this.sharp = true; const k = Math.max(1, Math.ceil(fit)); if (!this.pre || this.preK !== k) { this.pre = mk(LW * k, LH * k); this.preK = k; } }
    this.u = u; this.dpr = dpr; this.dw = Math.round(LW * u); this.dh = Math.round(LH * u);
    this.ox = Math.floor((cw - this.dw) / 2); this.oy = Math.floor((ch - this.dh) / 2);
    this.requestRender && this._loop && this.requestRender();
  }
}
const BUSY_LIGHT = new Set(['WORKING', 'VERIFYING', 'WAITING']);
window.OfficeTown = OfficeTown;
})();
