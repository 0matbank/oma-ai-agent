/* Oma Agent Town: pixel office. OMA (the boss) has a glass cabin at the top; five workers sit at desks in the open office below.
   Everything that moves reflects a real backend task event (applyTask); idle means sitting still. */
(() => {
'use strict';
/* ======================================================================
   OMA AI - Agent Town (OfficeTown)
   All art is drawn procedurally. Logical tile = 16px. Map 44 x 24 tiles.
   ====================================================================== */
const TILE = 16, MW = 44, MH = 24, LW = MW * TILE, LH = MH * TILE, DT = 1 / 60;
const WALK = 2.4 * TILE, OMA_WALK = 3 * TILE, SIT_T = 0.4, STAND_T = 0.35;
const HOLD = 5;            // seconds a finished worker's monitor keeps showing the result
const REST_AFTER = 8;      // a worker who finished goes to rest this long after the task ended
const REST_FOR = 45;       // and rests this long before going back to the desk
const OUT = '#1b1d27';
const STATE_COL = { IDLE: '#7d8597', WORKING: '#6fd3ff', VERIFYING: '#b79cff', WAITING: '#f2c46b', ASSIGNED: '#9fb4d8', PLANNING: '#9fb4d8',
  COMPLETED: '#7ee08a', DONE: '#7ee08a', FAILED: '#ff6b6b', PARTIAL: '#f2c46b', CANCELLED: '#9aa3b5', RUNNING: '#6fd3ff', RECEIVED: '#c9d2e6' };
const BUSY = new Set(['ASSIGNED', 'WORKING', 'VERIFYING', 'WAITING']);
const STEP_STATE = { RUNNING: 'WORKING', DONE: 'COMPLETED', FAILED: 'FAILED', SKIPPED: 'CANCELLED' };

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const P = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
function rects(g, list, ox = 0, oy = 0) { for (const [x, y, w, h, c] of list) { g.fillStyle = c; g.fillRect(ox + x, oy + y, w, h); } }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------------------------------------------------------------- rooms
   office: the whole open floor. cabin: OMA's glass office (top centre). lounge: bottom right, behind a wall. */
const ROOMS = [
  { id: 'office', x: 1, y: 2, w: 42, h: 21, floor: 'office', face: '#3d4560' },
  { id: 'cabin', x: 13, y: 2, w: 18, h: 7, floor: 'exec', face: '#3a2f3f' },
  { id: 'lounge', x: 37, y: 14, w: 6, h: 9, floor: 'warm', face: '#4d4540' },
];
const ROOM_BY_ID = Object.fromEntries(ROOMS.map(r => [r.id, r]));
const MAP = (() => {
  const kind = [...Array(MH)].map(() => new Array(MW).fill(0));
  const room = [...Array(MH)].map(() => new Array(MW).fill(null));
  for (const r of ROOMS) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { kind[y][x] = 1; room[y][x] = r.id; }
  for (let x = 36; x <= 42; x++) { kind[13][x] = 0; room[13][x] = null; }               // lounge wall
  for (let y = 13; y <= 22; y++) if (y !== 17 && y !== 18) { kind[y][36] = 0; room[y][36] = null; } else room[y][36] = 'lounge';
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

/* ---------------------------------------------------------------- new sprites: workstations, OMA's desk, glass walls */
const DESK_SIDE = {
  books(g, U) { rects(g, [[2, U - 1, 6, 2, '#3e7cb1'], [1, U + 1, 7, 2, '#b5543a'], [2, U - 3, 5, 2, '#e0b24a'], [57, U + 2, 4, 4, '#ececec'], [57, U + 2, 4, 1, '#6b4a35']]); },
  browser(g, U) { rects(g, [[1, U + 1, 7, 6, '#2b2f3c'], [2, U + 2, 5, 4, '#4f7fd8'], [3, U + 3, 2, 1, '#d9e6ff'], [57, U + 2, 4, 4, '#ececec'], [57, U + 2, 4, 1, '#6b4a35']]); },
  terminal(g, U) { rects(g, [[1, U, 7, 5, '#c44a3a'], [2, U - 1, 5, 1, '#2b2f3c'], [1, U + 2, 7, 1, '#8e3329'], [56, U + 1, 6, 6, '#2b2f3c'], [57, U + 2, 4, 1, '#8be0a4']]); },
  clipboard(g, U) { rects(g, [[1, U - 1, 7, 9, '#a0703c'], [2, U, 5, 7, C.paper], [3, U - 1, 3, 1, '#6b7488'], [3, U + 2, 3, 1, '#5aa86a'], [3, U + 4, 3, 1, '#5aa86a'], [56, U + 1, 4, 4, '#2b2f3c'], [57, U + 2, 2, 2, '#9cc0de'], [59, U + 5, 1, 2, '#2b2f3c']]); },
  mic(g, U) { rects(g, [[4, U - 8, 1, 12, '#2b2f3c'], [2, U - 11, 4, 5, '#3a3f4f'], [2, U - 11, 4, 1, '#6b7488'], [1, U + 4, 7, 2, '#2b2f3c'], [56, U + 1, 6, 2, '#d64545'], [56, U + 3, 1, 3, '#d64545'], [61, U + 3, 1, 3, '#d64545']]); },
};
Object.assign(DRAW, {
  // a work desk with a low back partition (name plate on top) and a big monitor; 4 tiles wide
  workstation: { up: 30, draw(g, W, H, U, o) {
    P(g, 1, U + 13, W - 2, 3, C.shadow);
    P(g, 0, U - 28, W, 30, '#22252f'); P(g, 1, U - 27, W - 2, 28, o.fab || '#3d4560');
    for (let x = 3; x < W - 2; x += 4) for (let y = U - 24; y < U; y += 4) P(g, x + ((y >> 2) & 1) * 2, y, 1, 1, 'rgba(255,255,255,.06)');
    P(g, 0, U - 28, W, 2, '#8f98ab'); P(g, 0, U - 28, W, 1, '#b3bccd'); P(g, 1, U - 26, W - 2, 1, o.acc || '#6fd3ff');
    P(g, 0, U, W, 13, '#262a36'); P(g, 1, U + 1, W - 2, 8, C.deskTop); P(g, 1, U + 1, W - 2, 1, C.deskTopL);
    P(g, 1, U + 9, W - 2, 3, C.deskEdge); P(g, 1, U + 9, W - 2, 1, '#4d5872'); P(g, 1, U + 12, 2, 3, '#2f3445'); P(g, W - 3, U + 12, 2, 3, '#2f3445');
    P(g, 9, U - 22, 46, 26, C.bezel); P(g, 11, U - 20, 42, 22, '#0d131f'); P(g, 30, U + 3, 4, 1, '#3a4152');
    P(g, 27, U + 4, 10, 2, '#2b303e'); P(g, 16, U + 6, 18, 2, '#c9d0de'); P(g, 16, U + 6, 18, 1, '#e3e8f1'); P(g, 42, U + 6, 3, 2, '#d9dee8');
    if (o.side) DESK_SIDE[o.side](g, U);
  } },
  // OMA's executive desk: dark wood, gold trim, lamp, laptop (seen from behind), in-tray
  execDesk: { up: 14, draw(g, W, H, U) {
    rects(g, [[2, U + 12, W - 4, 4, C.shadow], [0, U - 4, W, 17, '#2a1d16'], [1, U - 3, W - 2, 9, '#7a5034'], [1, U - 3, W - 2, 1, '#9a6a48'], [1, U + 5, W - 2, 1, '#c9a24a'],
      [1, U + 6, W - 2, 6, '#5e3c27'], [4, U + 7, 26, 4, '#6b452d'], [W - 30, U + 7, 26, 4, '#6b452d'], [W / 2 - 15, U + 7, 30, 4, '#c9a24a'], [W / 2 - 14, U + 8, 28, 2, '#1b2030'],
      [7, U - 14, 2, 11, '#2b2f3c'], [4, U - 16, 8, 4, '#e0b24a'], [5, U - 16, 6, 1, '#f3d27a'], [5, U - 4, 6, 2, '#2b2f3c'],
      [16, U - 11, 16, 9, '#8f98ab'], [17, U - 10, 14, 7, '#a6b0c4'], [23, U - 7, 2, 2, '#6fd3ff'], [15, U - 2, 18, 2, '#b7bfd0'],
      [60, U - 2, 8, 5, C.paper], [61, U - 1, 6, 1, C.paperS], [61, U + 1, 5, 1, C.paperS], [52, U - 3, 3, 3, '#ececec'], [52, U - 3, 3, 1, '#6b4a35'],
      [76, U - 2, 14, 6, '#2b2f3c'], [77, U - 1, 12, 4, '#3a4152'], [77, U - 1, 12, 1, '#4a5263']]);
  } },
  glassH: { up: 14, draw(g, W, H, U) {
    P(g, 0, 2, W, U + 8, 'rgba(150,210,255,0.17)');
    for (let x = 0; x < W; x += 32) { P(g, x + 7, 6, 1, 1, 'rgba(255,255,255,.55)'); for (let i = 0; i < 9; i++) P(g, x + 9 + i, 5 + i, 1, 1, 'rgba(255,255,255,.22)'); for (let i = 0; i < 5; i++) P(g, x + 16 + i, 4 + i, 1, 1, 'rgba(255,255,255,.16)'); }
    for (let x = 0; x <= W - 2; x += 32) P(g, x, 2, 2, U + 8, '#2a3142');
    P(g, W - 2, 2, 2, U + 8, '#2a3142');
    P(g, 0, 0, W, 2, '#3a4560'); P(g, 0, 0, W, 1, '#7b8fb8');
    P(g, 0, U + 8, W, 4, '#2a3142'); P(g, 0, U + 8, W, 1, '#8fa3c8'); P(g, 0, U + 12, W, 2, 'rgba(6,8,16,.25)');
  } },
  glassV: { up: 14, draw(g, W, H) {
    P(g, 6, 0, 4, H - 2, 'rgba(150,210,255,0.24)'); P(g, 5, 0, 1, H - 2, '#2a3142'); P(g, 10, 0, 1, H - 2, '#2a3142');
    P(g, 7, 3, 1, H - 8, 'rgba(255,255,255,.28)'); P(g, 5, 0, 6, 2, '#7b8fb8'); P(g, 4, H - 4, 8, 4, '#2a3142'); P(g, 4, H - 4, 8, 1, '#8fa3c8');
  } },
  glassDoor: { up: 16, draw(g, W, H, U) {
    P(g, 2, 7, 5, U + 4, 'rgba(150,210,255,0.22)'); P(g, W - 7, 7, 5, U + 4, 'rgba(150,210,255,0.22)');
    P(g, 0, 0, 2, U + 12, '#2a3142'); P(g, W - 2, 0, 2, U + 12, '#2a3142'); P(g, 0, 0, W, 7, '#2a3142'); P(g, 0, 0, W, 1, '#7b8fb8');
    P(g, 3, 1, W - 6, 5, '#c9a24a'); P(g, 4, 2, W - 8, 3, '#1b2030');
    P(g, 2, U + 12, W - 4, 1, '#8fa3c8');
  } },
});

/* ---------------------------------------------------------------- furniture placement */
const ITEMS = [];
function item(kind, tx, ty, tw = 1, th = 1, o = {}) {
  const d = DRAW[kind]; const up = o.up != null ? o.up : d.up;
  const it = { kind, tx, ty, tw, th, o, up, base: (ty + th) * TILE + (o.baseAdj || 0), sx: tx * TILE + (o.dx || 0), sy: ty * TILE - up };
  if (!o.noBlock) for (let y = ty; y < ty + th; y++) for (let x = tx; x < tx + tw; x++) BLOCK[y * MW + x] = 1;
  ITEMS.push(it); return it;
}
function blockRect(x0, y0, w, h) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) BLOCK[y * MW + x] = 1; }

/* workers: desk = top-left tile of a 4-wide workstation; the worker sits centred below it */
const WORKER_DEFS = {
  alice: { name: 'Alice', role: 'Research', desk: [8, 12], side: 'books', fab: '#5a4a4a', acc: '#f0b878', style: 'long',
    pal: { skin: '#f2c9a5', skinS: '#d9a77f', blush: '#eaa08e', hair: '#b4533a', hairS: '#8c3d2b', hairL: '#cf6f52', shirt: '#3fa7a0', shirtS: '#2e7f7a', pants: '#2f3652', pantsS: '#252a40', shoes: '#1c1f2c' } },
  bob: { name: 'Bob', role: 'Browser', desk: [20, 12], side: 'browser', fab: '#3d4f70', acc: '#8fb8ff', style: 'short', glasses: true,
    pal: { skin: '#e8b98f', skinS: '#c99a72', blush: '#e09a80', hair: '#4a3326', hairS: '#33231a', hairL: '#64473a', shirt: '#4f7fd8', shirtS: '#3a60a8', pants: '#3a3f55', pantsS: '#2c3043', shoes: '#1c1f2c' } },
  carol: { name: 'Carol', role: 'Desktop', desk: [32, 12], side: 'terminal', fab: '#3c5a52', acc: '#8be0a4', style: 'bun',
    pal: { skin: '#d9a07a', skinS: '#b98262', blush: '#d18a74', hair: '#2b2433', hairS: '#1c1722', hairL: '#463b52', shirt: '#5aa86a', shirtS: '#43804f', pants: '#3b3550', pantsS: '#2c283d', shoes: '#1c1f2c' } },
  dave: { name: 'Dave', role: 'Verification', desk: [14, 18], side: 'clipboard', fab: '#4f466a', acc: '#c3abff', style: 'spiky', glasses: true,
    pal: { skin: '#f0c8a0', skinS: '#d4a77e', blush: '#e8a08a', hair: '#d8b45c', hairS: '#b08f3f', hairL: '#ecd08a', shirt: '#8a6fc9', shirtS: '#6a52a3', pants: '#2e3346', pantsS: '#232736', shoes: '#1c1f2c' } },
  eve: { name: 'Eve', role: 'YouTube', desk: [26, 18], side: 'mic', fab: '#5a3d52', acc: '#ff8a8a', style: 'pony',
    pal: { skin: '#f3cfb3', skinS: '#d8ae90', blush: '#ee9a9a', hair: '#d6679a', hairS: '#a94b77', hairL: '#ea8cb6', shirt: '#d64545', shirtS: '#a83333', pants: '#33304a', pantsS: '#262439', shoes: '#1c1f2c' } },
};
const DESK_OF = {};
for (const [id, d] of Object.entries(WORKER_DEFS)) {
  const [tx, ty] = d.desk;
  d.chair = [tx + 1, ty + 1]; d.approach = [tx + 1, ty + 2];
  d.screen = { x: tx * TILE + 11, y: ty * TILE - 20, w: 42, h: 22 };
  d.drop = { x: tx * TILE + 57, y: ty * TILE + 3 };              // where a paper from OMA lands
  DESK_OF[id] = item('workstation', tx, ty, 4, 1, { owner: id, side: d.side, fab: d.fab, acc: d.acc });
  item('chairSeat', tx + 1, ty + 1, 1, 1, { owner: id, baseAdj: -14, dx: 8 });
  item('chairBack', tx + 1, ty + 1, 1, 1, { owner: id, noBlock: true, baseAdj: -0.5, dx: 8 });
  blockRect(tx + 2, ty + 1, 1, 1);
  blockRect(tx, ty - 1, 4, 1);   // nobody walks behind the partition (it would hide them)
}
// OMA's cabin: glass walls, door with name plate, wall screen, big desk
const CABIN_SCREEN = { x: 17 * TILE, y: 17, w: 160, h: 40 };
blockRect(17, 2, 10, 2);
blockRect(13, 2, 1, 7); blockRect(30, 2, 1, 7); blockRect(13, 8, 8, 1); blockRect(23, 8, 8, 1);
item('glassV', 13, 2, 1, 7, { noBlock: true }); item('glassV', 30, 2, 1, 7, { noBlock: true });
item('glassH', 13, 8, 8, 1, { noBlock: true }); item('glassH', 23, 8, 8, 1, { noBlock: true });
item('glassDoor', 21, 8, 2, 1, { noBlock: true, baseAdj: -4 });
item('shelf', 14, 2, 2, 1); item('plant', 16, 2); item('plant', 27, 2); item('shelf', 28, 2, 2, 1);
item('omaChair', 21, 4, 1, 1, { baseAdj: -12, dx: 8 }); blockRect(22, 4, 1, 1);
const EXEC = item('execDesk', 19, 5, 6, 1);
const TRAY = { x: 19 * TILE + 83, y: 5 * TILE - 14 + 13 };
item('armchair', 14, 5, 1, 1, { color: '#6a4a8a', dark: '#54386f' }); item('floorLamp', 14, 4, 1, 1, { noBlock: true, baseAdj: -2 });
item('globe', 29, 5); item('plant', 14, 7); item('plant', 29, 7); item('cabinet', 29, 4, 1, 1, { color: '#7a5034', dark: '#5e3c27' });
// records corner (top left)
item('shelf', 1, 2, 2, 1); item('shelf', 3, 2, 2, 1); item('plant', 5, 2);
item('cabinet', 9, 2); item('cabinet', 10, 2, 1, 1, { color: '#5b6fa8', dark: '#4a5c90' }); item('printer', 12, 2);
item('armchair', 2, 6, 1, 1, { color: '#5b6fa8', dark: '#43528a' }); item('globe', 1, 6); item('plant', 1, 9); item('plant', 12, 9);
// pantry (top right)
item('plant', 31, 2); item('cooler', 33, 2); item('counter', 35, 2, 4, 1); item('vending', 41, 2); item('plant', 42, 2);
item('roundTable', 38, 7); item('stool', 37, 7); item('stool', 39, 7); item('plant', 42, 10); item('beanbag', 41, 7, 1, 1, { color: '#4f8fd0', dark: '#3a6aa0', light: '#7fb7e6' });
// meeting corner (bottom left) and the space between the desk rows
item('whiteboard', 2, 14, 2, 1); item('binders', 1, 17, 1, 2); item('roundTable', 4, 20); item('stool', 3, 20); item('stool', 5, 20);
item('plant', 1, 22); item('plant', 12, 22); item('plant', 1, 13); item('cabinet', 11, 14); item('boxes', 12, 14);
item('whiteboard', 21, 18, 2, 1); item('plant', 20, 22); item('plant', 23, 22); item('plant', 34, 22); item('printer', 31, 21);
// lounge (bottom right)
item('sofaS', 38, 15, 3, 1); item('coffeeTable', 38, 17, 3, 1);
item('sofaNSeat', 38, 19, 3, 1, { baseAdj: -14 }); item('sofaNBack', 38, 19, 3, 1, { noBlock: true, baseAdj: -0.5 });
item('floorLamp', 37, 14); item('plant', 42, 14); item('vending', 42, 17); item('beanbag', 42, 21, 1, 1, { color: '#e0b24a', dark: '#b08a2a', light: '#f2d15c' }); item('plant', 37, 22);
ITEMS.sort((a, b) => a.base - b.base);

const LOUNGE_SPOTS = [
  { key: 'l0', seat: [38, 15], tile: [38, 16], pose: 'front' },
  { key: 'l1', seat: [40, 15], tile: [40, 16], pose: 'front' },
  { key: 'l2', seat: [39, 15], tile: [39, 16], pose: 'front' },
  { key: 'l3', seat: [38, 19], tile: [38, 20], pose: 'back' },
  { key: 'l4', seat: [40, 19], tile: [40, 20], pose: 'back' },
];

/* ---------------------------------------------------------------- background */
function floorArea(g, style, x0, y0, w, h, r) {
  const sp = (n, cols) => { for (let i = 0; i < n; i++) P(g, x0 + Math.floor(r() * w), y0 + Math.floor(r() * h), 1, 1, cols[Math.floor(r() * cols.length)]); };
  if (style === 'office') {
    for (let y = y0; y < y0 + h; y += 16) for (let x = x0; x < x0 + w; x += 16) P(g, x, y, 16, 16, ((x + y) / 16) % 2 ? '#4d566c' : '#525b72');
    for (let x = x0; x < x0 + w; x += 16) P(g, x, y0, 1, h, '#485066'); for (let y = y0; y < y0 + h; y += 16) P(g, x0, y, w, 1, '#485066');
    sp(w * h / 26, ['#4a5368', '#57607a']); return;
  }
  if (style === 'exec') {
    P(g, x0, y0, w, h, '#5b4334');
    for (let row = 0; row * 5 < h; row++) { const yy = y0 + row * 5; P(g, x0, yy, w, 1, '#4b372b'); for (let gx = x0 - ((row * 13) % 30); gx < x0 + w; gx += 30) if (gx > x0) P(g, gx, yy + 1, 1, 4, '#46332a'); }
    sp(w * h / 40, ['#644a3a', '#523c2f']); return;
  }
  floorRect(g, style, x0, y0, w, h, r);
}
function execRug(g, tx, ty, tw, th) {
  const x = tx * TILE + 2, y = ty * TILE + 2, w = tw * TILE - 4, h = th * TILE - 4;
  P(g, x, y, w, h, '#c9a24a'); P(g, x + 1, y + 1, w - 2, h - 2, '#1c2640'); P(g, x + 3, y + 3, w - 6, h - 6, '#c9a24a'); P(g, x + 4, y + 4, w - 8, h - 8, '#24345a');
  for (let i = x + 10; i < x + w - 10; i += 12) { P(g, i, y + 8, 2, 2, '#3a5288'); P(g, i + 6, y + h - 10, 2, 2, '#3a5288'); }
}
function renderBackground() {
  const c = mk(LW, LH), g = c.getContext('2d'), r = mulberry32(42);
  P(g, 0, 0, LW, LH, '#22242e');
  for (const rm of ROOMS) floorArea(g, rm.floor, rm.x * TILE, rm.y * TILE, rm.w * TILE, rm.h * TILE, r);
  for (const y of [17, 18]) floorArea(g, 'warm', 36 * TILE, y * TILE, TILE, TILE, r);
  execRug(g, 16, 4, 12, 4);
  { const x = 20 * TILE + 4, y = 9 * TILE, w = 4 * TILE - 8, h = 2 * TILE + 6; P(g, x, y, w, h, '#c9a24a'); P(g, x + 1, y, w - 2, h - 1, '#24345a'); P(g, x + 3, y, w - 6, h - 3, '#2c3f6a'); }   // runner from OMA's door
  rug(g, 37, 15, 5, 7, '#6a3b35', '#8a5048', '#7a463f');
  rug(g, 2, 19, 5, 3, '#3c4a68', '#56688e', '#475877');
  rug(g, 1, 5, 4, 3, '#4a3d3a', '#64524c', '#574843');
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const X = x * TILE, Y = y * TILE, k = MAP.kind[y][x];
    if (k === 0) {
      const face = y + 1 < MH && MAP.kind[y + 1][x] !== 0;
      if (face) {
        const rm = ROOM_BY_ID[MAP.room[y + 1][x]] || ROOM_BY_ID.office;
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
  // cabin back wall: wood panels with a gold rail
  for (let x = 13 * TILE; x < 31 * TILE; x += 8) { P(g, x, TILE + 4, 8, 10, '#4a3a33'); P(g, x, TILE + 4, 1, 10, '#3b2e28'); }
  P(g, 13 * TILE, TILE + 4, 18 * TILE, 1, '#c9a24a'); P(g, 13 * TILE, TILE + 13, 18 * TILE, 1, '#8a6a32');
  { const s = CABIN_SCREEN; screenFrame(g, s.x, s.y, s.w, s.h, false); P(g, s.x - 2, s.y - 2, s.w + 4, 1, '#c9a24a'); }
  windowDeco(g, 6, 1, 2); windowDeco(g, 39, 1, 1);
  clockDeco(g, 8 * TILE + 3, TILE + 4); frameDeco(g, 32 * TILE + 2, TILE + 4, 14, 9, ['#4f8fd0', '#5aa86a', '#f2d15c']);
  frameDeco(g, 38 * TILE + 3, 13 * TILE + 4, 24, 9, ['#6f93b8', '#5aa86a', '#f2d15c']); extinguisher(g, 41 * TILE + 8, 13 * TILE + 5);
  return c;
}
const LAMPS = [[CABIN_SCREEN.x + 80, 80, 130], ...Object.values(WORKER_DEFS).map(d => [(d.desk[0] + 2) * TILE, d.desk[1] * TILE + 4, 46]),
  [37 * TILE + 8, 14 * TILE - 2, 54], [39 * TILE, 18 * TILE, 56], [36 * TILE, 4 * TILE, 50], [6 * TILE, 4 * TILE, 52], [4 * TILE, 19 * TILE, 46], [14 * TILE + 8, 3 * TILE, 40]];
function renderLighting(night) {
  const c = mk(LW, LH), g = c.getContext('2d');
  const pool = (x, y, r, col, a) => { const gr = g.createRadialGradient(x, y, 2, x, y, r); gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); };
  if (night) {
    g.fillStyle = 'rgba(4,8,22,0.34)'; g.fillRect(0, 0, LW, LH);
    g.globalCompositeOperation = 'destination-out';
    for (const [x, y, r] of LAMPS) pool(x, y, r, '0,0,0', 0.85);
    g.globalCompositeOperation = 'source-over';
    pool(CABIN_SCREEN.x + 80, 90, 120, '120,210,255', 0.07);
    for (const [x, y, r] of LAMPS.slice(6)) pool(x, y, r * 0.8, '255,200,130', 0.08);
  } else {
    pool(LW / 2, 80, 170, '225,245,255', 0.09);
    for (const [x, y, r] of LAMPS.slice(1)) pool(x, y, r * 1.2, '255,244,225', 0.06);
  }
  const v = g.createRadialGradient(LW / 2, LH / 2, LH * 0.35, LW / 2, LH / 2, LW * 0.62); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(4,5,10,${night ? 0.4 : 0.22})`);
  g.fillStyle = v; g.fillRect(0, 0, LW, LH);
  return c;
}
function tonedCopy(src) { const c = mk(src.width, src.height); c.getContext('2d').drawImage(src, 0, 0); nightTone(c); return c; }

/* ---------------------------------------------------------------- floors and wall decor (shared helpers) */
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

function buildSprites() {
  for (const it of ITEMS) {
    if (it.sprite) continue;
    const W = it.tw * TILE, H = it.th * TILE + it.up; const c = mk(W, H), g = c.getContext('2d');
    DRAW[it.kind].draw(g, W, H, it.up, it.o, mulberry32(it.tx * 131 + it.ty * 17 + 5));
    it.sprite = c;
  }
  return ITEMS;
}
// Stonic look: the same office at night, desaturated toward slate blue and dimmed (workers keep their colours)
function nightTone(c) {
  if (c._toned) return; c._toned = true;
  const g = c.getContext('2d'), im = g.getImageData(0, 0, c.width, c.height), d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
    d[i] = (d[i] * 0.4 + l * 0.6) * 0.74; d[i + 1] = (d[i + 1] * 0.4 + l * 0.6) * 0.8; d[i + 2] = (d[i + 2] * 0.4 + l * 0.6) * 0.98 + 6;
  }
  g.putImageData(im, 0, 0);
}

/* ---------------------------------------------------------------- characters */
const OMA_DEF = { name: 'OMA', role: 'Boss', style: 'oma', eye: '#1b6a9b',
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
  zz: { c: '#2f7fc0', rows: ['#####', '...#.', '..#..', '.#...', '#####'] },
};
function iconBubble(g, x, y, type, t) { // x=center, y=tail tip
  const L = x - 5, T = y - 10;
  P(g, L + 1, T, 9, 1, OUT); P(g, L, T + 1, 1, 6, OUT); P(g, L + 10, T + 1, 1, 6, OUT); P(g, L + 1, T + 7, 9, 1, OUT);
  P(g, L + 1, T + 1, 9, 6, '#f7f8fb'); P(g, L + 4, T + 7, 3, 1, '#f7f8fb'); P(g, L + 4, T + 8, 1, 1, OUT); P(g, L + 6, T + 8, 1, 1, OUT); P(g, L + 5, T + 8, 1, 1, '#f7f8fb'); P(g, L + 5, T + 9, 1, 1, OUT);
  if (type === 'dots') { const a = Math.floor(t / 0.45) % 3; for (let i = 0; i < 3; i++) P(g, L + 2 + i * 3, T + (i === a ? 3 : 4), 1, 1, i === a ? '#1d8fd0' : '#3a4152'); return; }
  const ic = ICONS[type]; if (!ic) return; const w = ic.rows[0].length, ox = L + 1 + Math.floor((9 - w) / 2), oy = T + 1;
  g.fillStyle = ic.c; for (let r = 0; r < ic.rows.length; r++) for (let cI = 0; cI < w; cI++) if (ic.rows[r][cI] === '#') g.fillRect(ox + cI, oy + r, 1, 1);
}

// OMA's "thinking" cloud (pixel art): rounded box, three dots, two small puffs instead of a tail
function thinkBubble(g, x, y, t) {
  const L = x - 6, T = y - 12;
  P(g, L + 2, T, 9, 1, OUT); P(g, L + 1, T + 1, 1, 1, OUT); P(g, L + 11, T + 1, 1, 1, OUT); P(g, L, T + 2, 1, 4, OUT); P(g, L + 12, T + 2, 1, 4, OUT);
  P(g, L + 1, T + 6, 1, 1, OUT); P(g, L + 11, T + 6, 1, 1, OUT); P(g, L + 2, T + 7, 9, 1, OUT);
  P(g, L + 2, T + 1, 9, 6, '#f7f8fb'); P(g, L + 1, T + 2, 11, 4, '#f7f8fb');
  P(g, L + 3, T + 8, 3, 2, OUT); P(g, L + 4, T + 8, 1, 1, '#f7f8fb'); P(g, L + 5, T + 11, 1, 1, OUT);
  const a = Math.floor(t / 0.4) % 3; for (let i = 0; i < 3; i++) P(g, L + 3 + i * 3, T + (i === a ? 3 : 4), 2, 1, i === a ? '#1d8fd0' : '#3a4152');
}
function paperSprite(g, x, y, kind) {
  x = Math.round(x) - 3; y = Math.round(y) - 4;
  P(g, x, y, 7, 8, OUT); P(g, x + 1, y + 1, 5, 6, '#f4f6fa'); P(g, x + 2, y + 2, 3, 1, '#9aa3b5'); P(g, x + 2, y + 4, 3, 1, '#9aa3b5');
  if (kind === 'ok') { P(g, x + 4, y + 5, 1, 1, '#2f9e4f'); P(g, x + 3, y + 6, 1, 1, '#2f9e4f'); P(g, x + 5, y + 4, 1, 1, '#2f9e4f'); }
  if (kind === 'fail') { P(g, x + 3, y + 5, 2, 2, '#d64545'); }
}

/* ======================================================================
   OfficeTown - public API
     new OfficeTown(canvasId, {panel?: elementId, seed?: number, look?: 'auto'|'classic'|'day'|'night'|'stonic', keepAlive?: bool})
     applyTask(ev)                 the ONLY way worker/task state changes (one backend task event)
     applyReply(reply)             final reply text (OMA popup)
     updateFromBackendStatus(data) restore: every worker IDLE
     select(id|null)               open / close the popup for 'alice'..'eve' or 'oma'
     setVisible(bool)              the host hides / shows the panel (no frames while hidden)
     setLook(look)                 'auto' follows the PC clock (06:00-18:00 day), 'classic'/'day' or 'night'/'stonic' fix it
     portrait(id, px), resize(), onTaskEvent(), setAgentWorking()
   OMA's "?" (a worker WAITING for permission) calls window.OmaTask.answerPrompt() when it exists.
   Movement is visual only and never feeds back into state.
   ====================================================================== */
const tileOfX = x => Math.round((x - 8) / TILE), tileOfY = y => Math.round((y - 13) / TILE);
const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const hhmmss = ms => { try { return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch (e) { return ''; } };
const isNightHour = h => h < 6 || h >= 18;

class OfficeTown {
  constructor(canvasId, opts = {}) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.opts = opts;
    this._loop = this._loop.bind(this); this._raf = 0; this._timer = 0; this._dirty = true; this._asleep = true;
    this.keepAlive = !!opts.keepAlive; this.visible = true; this.frames = 0;
    this.ctx = this.canvas.getContext('2d');
    this.world = mk(LW, LH); this.g = this.world.getContext('2d');
    this.bgDay = renderBackground(); this.lightDay = renderLighting(false); this.items = buildSprites();
    this.look = opts.look || 'auto'; this.hourFn = opts.hourFn || (() => new Date().getHours());
    this.night = null; this._applyLook();
    this.paused = false; this.timeScale = 1; this.onTick = null;
    this.selected = null; this._askRect = null;
    this.panel = opts.panel ? document.getElementById(opts.panel) : null;
    if (!this.panel) { this.panel = document.createElement('div'); this.panel.className = 'ot-panel'; const par = this.canvas.parentElement; if (par) { if (getComputedStyle(par).position === 'static') par.style.position = 'relative'; par.appendChild(this.panel); } }
    this.panel.addEventListener('click', e => { if (e.target && e.target.dataset && e.target.dataset.close) this.select(null); });
    this.selfCheck = this._selfCheck();
    this.reset(opts.seed || 1);
    this._last = performance.now(); this._lastRender = 0;
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this._kick(); });
    document.addEventListener('pointerdown', e => {   // a click anywhere else closes the popup
      if (!this.selected) return; const t = e.target;
      if (t === this.canvas || this.panel.contains(t) || (t && t.closest && t.closest('.agent-chip'))) return;
      this.select(null);
    }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && this.selected) this.select(null); });
    this.canvas.addEventListener('click', e => this._click(e));
    this.canvas.addEventListener('mousemove', e => { const h = this._hit(e); this.canvas.style.cursor = h ? 'pointer' : 'default'; });
    if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(this.canvas);
    if (window.IntersectionObserver) new IntersectionObserver(es => { this._onScreen = es[es.length - 1].isIntersecting; if (this._onScreen) this.requestRender(); }).observe(this.canvas);
    setInterval(() => { if (this._applyLook()) this.requestRender(); }, 60000);
    this.resize();
    this.render();
  }

  /* ---------------- day / night */
  setLook(look) { this.look = look || 'auto'; if (this._applyLook()) this.requestRender(); }
  _applyLook() {
    const L = this.look, night = L === 'night' || L === 'stonic' ? true : L === 'classic' || L === 'day' ? false : isNightHour(this.hourFn());
    if (night === this.night) return false;
    this.night = night;
    if (night) { this.bgNight = this.bgNight || tonedCopy(this.bgDay); this.lightNight = this.lightNight || renderLighting(true); for (const it of this.items) it.spriteN = it.spriteN || tonedCopy(it.sprite); }
    this.bg = night ? this.bgNight : this.bgDay; this.light = night ? this.lightNight : this.lightDay;
    return true;
  }

  /* ---------------- state reset */
  reset(seed) {
    this.clock = 0; this.rng = mulberry32(seed || 1);
    this.task = { id: '', text: '', status: '', stage: '', detail: '', model: '', seq: 0, ended: false, result: '', reply: '', notes: [], question: '', waiting: false, returned: 0 };
    this.papers = []; this.spotsTaken = {};
    const omaSeat = { key: 'seat', place: 'seat', tile: [20, 4], seat: { tile: [21, 4], pose: 'front', dx: 8, sy: 8 }, face: 'down' };
    this.oma = { id: 'oma', isOma: true, def: OMA_DEF, x: 21 * TILE + 16, y: 4 * TILE + 13, dir: 'down', mode: 'seated', place: 'seat', seatPose: 'front', seatTY: 4, seatSy: 8,
      goal: null, path: [], walkT: 0, trans: null, badge: null, seatGoal: omaSeat, doorGoal: { key: 'door', place: 'door', tile: [21, 8], face: 'down', dx: 8 } };
    this.oma.atGoal = omaSeat;
    this.chars = {}; this.charList = [];
    for (const [id, d] of Object.entries(WORKER_DEFS)) {
      const c = { id, def: d, x: (d.chair[0] + 1) * TILE, y: d.chair[1] * TILE + 13, dir: 'up', mode: 'seated', place: 'desk', seatPose: 'back', seatTY: d.chair[1], seatSy: 8,
        goal: null, path: [], walkT: 0, trans: null, badge: null, loungeSpot: null, restUntil: null, finishedAt: null, doneAt: null, doneOk: true,
        paperOnDesk: false, paperLandedAt: 0, returnKind: null, returnAt: null,
        rec: { state: 'IDLE', step: '', done: 0, failed: 0, taskId: '', stepTask: '', history: [], evidence: [] } };
      c.deskGoal = { key: 'desk', place: 'desk', tile: d.approach, seat: { tile: d.chair, pose: 'back', dx: 8 }, face: 'up' };
      c.atGoal = c.deskGoal;
      this.chars[id] = c; this.charList.push(c);
    }
    this.selected = null; if (this.panel) { this.panel.style.display = 'none'; this.panel.innerHTML = ''; }
    this.requestRender && this._loop && this.requestRender();
  }

  /* ---------------- public API */
  applyTask(ev) {
    if (!ev || typeof ev !== 'object') return;
    this._syncClock();
    const T = this.task, now = this.clock, ts = ev.ts ? ev.ts * 1000 : Date.now();
    if (ev.task_id && (ev.kind === 'task' || ev.task_id !== T.id)) {
      Object.assign(T, { id: ev.task_id, text: ev.kind === 'task' ? (ev.detail || '') : '', status: '', stage: '', detail: '', model: '', seq: 0, ended: false, result: '', reply: '', notes: [], question: '', waiting: false, returned: 0 });
      this.oma.badge = null;
      for (const c of this.charList) c.rec.evidence = [];
    }
    if (ev.status) T.status = ev.status;
    if (ev.stage) T.stage = ev.stage;
    if (ev.seq) T.seq = ev.seq;
    if (ev.active_model) T.model = ev.active_model.resolved || ev.active_model.model || '';
    if (ev.detail && (ev.kind === 'stage' || ev.kind === 'worker')) T.detail = ev.detail;
    if (ev.detail && ev.kind === 'model') T.detail = 'Model: ' + ev.detail;
    if (ev.kind === 'note' && ev.detail) T.notes.push(ev.detail);
    if (ev.kind === 'permission') T.question = ev.detail || T.question;
    // a step event first (it names the step and whether it succeeded)
    let stepWorker = null, stepOk = true;
    if (ev.kind === 'step' && ev.step) {
      const c = this.chars[ev.worker || ev.step.worker];
      if (c) {
        const s = ev.step; c.rec.stepTask = ev.task_id; stepWorker = c.id; stepOk = s.status !== 'FAILED';
        this._hist(c, ev.task_id, 's:' + (s.id || s.label), s.label || ev.detail || '', STEP_STATE[s.status] || s.status || 'WORKING', ts);
        if (s.status === 'DONE') c.badge = { type: 'check', until: now + 2.2 };
        if (s.status === 'FAILED') c.badge = { type: 'cross', until: now + 3 };
      }
    }
    let anyWaiting = false;
    if (ev.workers && typeof ev.workers === 'object') {
      for (const c of this.charList) {
        const w = ev.workers[c.id]; if (!w) continue;
        const r = c.rec, prev = r.state, st = String(w.state || 'IDLE').toUpperCase();
        r.state = st; r.step = w.step || ''; r.done = w.done | 0; r.failed = w.failed | 0;
        if (BUSY.has(st)) r.taskId = ev.task_id || r.taskId;
        if (st === 'WAITING') anyWaiting = true;
        if (!BUSY.has(prev) && BUSY.has(st)) this._assign(c);
        else if (BUSY.has(prev) && !BUSY.has(st)) this._finish(c, c.id === stepWorker ? stepOk : st === 'COMPLETED' || st === 'DONE');
        if (st !== 'IDLE' && w.step) {
          if (r.stepTask !== ev.task_id) this._hist(c, ev.task_id, 'w:' + w.step, w.step, st, ts);
          else if (st === 'WAITING' || st === 'WORKING') { const e = r.history.slice().reverse().find(h => h.task === ev.task_id && (h.state === 'WORKING' || h.state === 'WAITING')); if (e) e.state = st; }
        }
      }
    }
    if (ev.kind === 'evidence' && this.chars.dave) {
      const d = this.chars.dave, ok = ev.ok === true ? true : ev.ok === false ? false : null;
      d.rec.evidence.push({ ok, detail: ev.detail || '', ts }); if (d.rec.evidence.length > 6) d.rec.evidence.shift();
      if (ok !== null) d.badge = { type: ok ? 'check' : 'cross', until: now + 3 };
    }
    if (ev.kind === 'result') {
      T.ended = true; T.result = ev.detail || '';
      this.oma.badge = { type: ev.status === 'COMPLETED' ? 'check' : ev.status === 'PARTIAL' ? 'bang' : 'cross', until: now + 6 };
    }
    T.waiting = !T.ended && (ev.kind === 'permission' || T.status === 'WAITING' || anyWaiting);
    this.lastEvent = ev;
    if (this.selected) this._renderPanel();
    this.requestRender();
  }
  applyReply(rep) { if (!rep) return; this.task.reply = rep.reply || ''; if (this.selected === 'oma') this._renderPanel(); }
  updateFromBackendStatus(data) {
    this._syncClock();
    for (const c of this.charList) { Object.assign(c.rec, { state: 'IDLE', step: '' }); Object.assign(c, { finishedAt: null, doneAt: null, returnKind: null, returnAt: null, paperOnDesk: false }); }
    this.papers = [];
    if (data && data.task_id) this.task.id = data.task_id;
    this.task.ended = true; this.task.waiting = false;
    if (this.selected) this._renderPanel(); this.requestRender();
  }
  onTaskEvent() { }
  setAgentWorking() { }
  select(id) {
    this.selected = id && (id === 'oma' || this.chars[id]) ? id : null;
    this._renderPanel();
  }
  setVisible(v) { this.visible = !!v; if (!this.visible) { if (this.selected) this.select(null); } else { this.resize(); this.requestRender(); } }

  _hist(c, task, key, text, state, ts) {
    const h = c.rec.history, e = h.find(x => x.task === task && x.key === key);
    if (e) { e.state = state; if (text && text.length > e.text.length) e.text = text; return; }
    h.push({ ts, task, key, text, state }); while (h.length > 5) h.shift();
  }
  _assign(c) {
    if (c.returnKind && c.paperOnDesk) this._paper(c, 'back', c.returnKind);
    Object.assign(c, { doneAt: null, finishedAt: null, returnKind: null, returnAt: null });
    if (c.loungeSpot) this._freeSpot(c);
    this._paper(c, 'out');
  }
  _finish(c, ok) {
    c.doneAt = this.clock; c.doneOk = ok; c.finishedAt = this.clock;
    c.returnKind = ok ? 'ok' : 'fail'; c.returnAt = null;
  }
  _paper(c, dir, kind) {
    const dk = c.def.drop, from = dir === 'out' ? TRAY : dk, to = dir === 'out' ? dk : TRAY;
    if (dir === 'back') c.paperOnDesk = false;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    this.papers.push({ c, dir, kind: kind || 'task', t: 0, dur: 0.6 + dist / 300, fx: from.x, fy: from.y, tx: to.x, ty: to.y, h: 14 + dist * 0.16 });
  }

  /* ---------------- clock / loop (sleeps when nothing changes) */
  setPaused(p) { this.paused = !!p; this._last = performance.now(); this.requestRender(); }
  advance(sec) { const n = Math.max(0, Math.round(sec / DT)); for (let i = 0; i < n; i++) this._fixedStep(); this.requestRender(); }
  requestRender() { this._dirty = true; this._kick(); }
  _canRun() {
    if (document.hidden || !this.visible || !this.canvas.isConnected || this._onScreen === false) return false;
    return this.canvas.clientWidth > 0 && this.canvas.clientHeight > 0;
  }
  _kick() {
    if (this._raf || !this._loop || !this.canvas) return;
    if (!this._canRun()) { if (!this._asleep) { this._asleep = true; this._last = performance.now(); } return; }
    if (this._timer) { clearTimeout(this._timer); this._timer = 0; }
    this._raf = requestAnimationFrame(this._loop);
  }
  _syncClock() {   // after a sleep the clock catches up in one jump (nothing was moving)
    if (!this._asleep) return;
    const n = performance.now(); if (!this.paused) this.clock += Math.max(0, (n - this._last) / 1000) * this.timeScale; this._last = n;
  }
  _loop(now) {
    this._raf = 0;
    if (!this._canRun()) { if (!this._asleep) { this._asleep = true; this._last = now; } return; }
    if (this._asleep) { this._syncClock(); this._asleep = false; this._last = now; if (!this.paused) this._update(0); }   // a woken deadline acts at once
    let dt = (now - this._last) / 1000; this._last = now; if (dt > 0.25) dt = 0.25; if (dt < 0) dt = 0;
    if (!this.paused) { this._acc = (this._acc || 0) + dt * this.timeScale; let n = 0; while (this._acc >= DT && n < 600) { this._fixedStep(); this._acc -= DT; n++; } if (n >= 600) this._acc = 0; }
    const motion = !this.paused && this._motion(), active = !this.paused && (motion || this._activity());
    this._anim = active;
    if (this._dirty || (motion && now - this._lastRender >= 15) || (active && now - this._lastRender >= 1000 / 12 - 2)) { this.render(); this._lastRender = now; this._dirty = false; }
    if (motion || (this.keepAlive && !this.paused)) { this._raf = requestAnimationFrame(this._loop); return; }
    if (active) { this._timer = setTimeout(() => { this._timer = 0; this._kick(); }, 1000 / 12); return; }
    this._asleep = true; this._last = now;
    const dl = this.paused ? null : this._nextDeadline();
    if (dl != null) this._timer = setTimeout(() => { this._timer = 0; this.requestRender(); }, Math.max(16, (dl - this.clock) * 1000 / this.timeScale + 30));
  }
  _motion() { return this.papers.length > 0 || this.oma.mode === 'walk' || this.oma.mode === 'trans' || this.charList.some(c => c.mode === 'walk' || c.mode === 'trans'); }
  _activity() { const T = this.task; return (T.id && !T.ended) || T.waiting || this.charList.some(c => BUSY.has(c.rec.state) || c.returnKind); }
  _nextDeadline() {
    const now = this.clock; let best = null; const add = v => { if (v != null && v > now && (best == null || v < best)) best = v; };
    for (const c of this.charList) {
      if (c.badge) add(c.badge.until); if (c.doneAt != null) add(c.doneAt + HOLD); add(c.restUntil);
      if (c.finishedAt != null && this.task.ended) add(c.finishedAt + REST_AFTER);
    }
    if (this.oma.badge) add(this.oma.badge.until);
    return best;
  }
  _fixedStep() { this.clock += DT; if (this.onTick) this.onTick(this.clock); this._update(DT); }
  _update(dt) {
    const now = this.clock;
    if (this.papers.length) {
      for (const p of this.papers) p.t += dt;
      const keep = [];
      for (const p of this.papers) {
        if (p.t < p.dur) { keep.push(p); continue; }
        if (p.dir === 'out') { p.c.paperOnDesk = true; p.c.paperLandedAt = now; } else this.task.returned++;
      }
      this.papers = keep;
    }
    for (const c of this.charList) { this._workerLogic(c); this._moveChar(c, dt); }
    this._moveChar(this.oma, dt);
  }
  _workerLogic(c) {
    const r = c.rec, now = this.clock;
    if (c.returnKind && !this.papers.some(p => p.c === c && p.dir === 'out')) {
      if (!c.paperOnDesk) { c.returnKind = null; c.returnAt = null; }
      else {
        if (c.returnAt == null) c.returnAt = Math.max(now, c.paperLandedAt + 1.2);
        if (now >= c.returnAt) { this._paper(c, 'back', c.returnKind); c.returnKind = null; c.returnAt = null; }
      }
    }
    if (BUSY.has(r.state)) { if (c.loungeSpot) this._freeSpot(c); return; }
    if (!c.loungeSpot) {
      if (c.finishedAt != null && this.task.ended && now >= c.finishedAt + REST_AFTER && c.mode === 'seated' && c.place === 'desk' && !c.returnKind) {
        c.finishedAt = null; const s = this._pickSpot(c); if (s) c.loungeSpot = s;
      }
    } else if (c.place === 'lounge' && c.mode === 'seated' && c.restUntil != null && now >= c.restUntil) this._freeSpot(c);
  }
  _goal(c) {
    if (c.isOma) return this.task.waiting ? c.doorGoal : c.seatGoal;
    if (BUSY.has(c.rec.state)) return c.deskGoal;
    return c.loungeSpot ? c.loungeSpot.goal : c.deskGoal;
  }
  _pickSpot(c) {
    const free = LOUNGE_SPOTS.filter(s => !this.spotsTaken[s.key]); if (!free.length) return null;
    const s = free[Math.floor(this.rng() * free.length)]; this.spotsTaken[s.key] = c.id;
    return { def: s, goal: { key: 'lounge:' + s.key, place: 'lounge', tile: s.tile, seat: { tile: s.seat, pose: s.pose, sy: 6 }, face: 'down' } };
  }
  _freeSpot(c) { if (c.loungeSpot) { delete this.spotsTaken[c.loungeSpot.def.key]; c.loungeSpot = null; } c.restUntil = null; }

  /* ---------------- movement (visual only) */
  _moveChar(c, dt) {
    const goal = this._goal(c), now = this.clock;
    if (c.mode === 'trans') {
      const T = c.trans; T.t += dt; const k = Math.min(1, T.t / T.dur);
      c.x = T.fx + (T.tx - T.fx) * k; c.y = T.fy + (T.ty - T.fy) * k; c.walkT += dt;
      if (T.type === 'sit' && T.pose === 'front' && k > 0.6) c.dir = 'down';
      if (k >= 1) {
        c.trans = null;
        if (T.type === 'sit') { c.mode = 'seated'; c.seatPose = T.pose; c.seatTY = T.seatTY; c.seatSy = T.sy; c.atGoal = T.goal; c.place = T.goal.place; c.dir = T.pose === 'back' ? 'up' : 'down'; if (T.goal.place === 'lounge') c.restUntil = now + REST_FOR; }
        else if (T.type === 'shift') { c.mode = 'stand'; c.atGoal = T.goal; c.place = T.goal.place; c.dir = T.goal.face; }
        else { c.mode = 'stand'; c.atGoal = { key: '_transit' }; c.place = null; }
      }
      return;
    }
    if (c.mode === 'seated') { if (goal.key !== c.atGoal.key) this._startStand(c); return; }
    if (c.mode === 'walk') { if (goal.key !== c.goal.key) this._repath(c, goal); this._walk(c, dt); return; }
    if (goal.key !== (c.atGoal && c.atGoal.key)) this._startWalk(c, goal);
  }
  _startWalk(c, goal) {
    const sx = tileOfX(c.x), sy = tileOfY(c.y);
    const path = findPath(sx, sy, goal.tile[0], goal.tile[1]);
    if (!path) { console.warn('OfficeTown: no route', c.id, [sx, sy], goal.tile); this._place(c, goal); return; }
    c.goal = goal; c.path = path; c.mode = 'walk'; c.atGoal = null; c.place = null; c.walkT = 0;
    if (!path.length) this._arrive(c);
  }
  _place(c, goal) {   // no route (should not happen): put the character there without walking
    if (goal.seat) { const [sx, sy] = goal.seat.tile; Object.assign(c, { x: sx * TILE + 8 + (goal.seat.dx || 0), y: sy * TILE + 13, mode: 'seated', seatPose: goal.seat.pose, seatTY: sy, seatSy: goal.seat.sy || 8, atGoal: goal, place: goal.place }); }
    else Object.assign(c, { x: goal.tile[0] * TILE + 8 + (goal.dx || 0), y: goal.tile[1] * TILE + 13, mode: 'stand', dir: goal.face, atGoal: goal, place: goal.place });
  }
  _repath(c, goal) {
    const from = c.path.length ? c.path[0] : [tileOfX(c.x), tileOfY(c.y)];
    const p = findPath(from[0], from[1], goal.tile[0], goal.tile[1]);
    if (!p) return;
    c.path = c.path.length ? [from].concat(p) : p; c.goal = goal;
  }
  _walk(c, dt) {
    let step = (c.isOma ? OMA_WALK : WALK) * dt; c.walkT += dt;
    while (step > 1e-6 && c.path.length) {
      const [tx, ty] = c.path[0]; const px = tx * TILE + 8, py = ty * TILE + 13; const dx = px - c.x, dy = py - c.y;
      if (dx) c.dir = dx > 0 ? 'right' : 'left'; else if (dy) c.dir = dy > 0 ? 'down' : 'up';
      const d = Math.abs(dx) + Math.abs(dy);
      if (d <= step) { c.x = px; c.y = py; step -= d; c.path.shift(); }
      else { if (dx) c.x += Math.sign(dx) * Math.min(step, Math.abs(dx)); else c.y += Math.sign(dy) * step; step = 0; }
    }
    if (!c.path.length) this._arrive(c);
  }
  _arrive(c) {
    const goal = c.goal;
    if (goal.seat) {
      const [sx, sy] = goal.seat.tile;
      c.trans = { type: 'sit', t: 0, dur: SIT_T, fx: c.x, fy: c.y, tx: sx * TILE + 8 + (goal.seat.dx || 0), ty: sy * TILE + 13, pose: goal.seat.pose, seatTY: sy, sy: goal.seat.sy || 8, goal };
      c.mode = 'trans'; c.dir = goal.seat.pose === 'back' ? 'up' : 'down';
    } else if (goal.dx) {
      c.trans = { type: 'shift', t: 0, dur: 0.15, fx: c.x, fy: c.y, tx: c.x + goal.dx, ty: c.y, goal }; c.mode = 'trans'; c.dir = goal.face;
    } else { c.mode = 'stand'; c.dir = goal.face; c.atGoal = goal; c.place = goal.place; }
  }
  _startStand(c) {
    const [ax, ay] = c.atGoal.tile;
    c.trans = { type: 'stand', t: 0, dur: STAND_T, fx: c.x, fy: c.y, tx: ax * TILE + 8, ty: ay * TILE + 13 };
    c.mode = 'trans'; c.dir = 'down'; c.place = null; c.seatPose = null;
  }

  /* ---------------- rendering */
  _charBase(c) { return c.mode === 'seated' ? (c.seatPose === 'front' ? c.seatTY * TILE + 16.5 : c.seatTY * TILE + 14) : c.y; }
  _headTop(c) { if (c.mode === 'seated') return c.seatPose === 'front' ? c.seatTY * TILE + c.seatSy - 13 : c.seatTY * TILE - 11; return Math.round(c.y) - 21; }
  _omaPose() {
    const T = this.task, run = T.id && !T.ended && !T.waiting;
    return { think: run && ['received', 'analyzing', 'planning', 'fallback', 'retry'].includes(T.stage), typing: run && T.stage === 'executing', verify: run && T.stage === 'verifying' };
  }
  _drawChar(g, c) {
    const t = this.clock, x = Math.round(c.x), y = Math.round(c.y), d = c.def;
    const blink = this._anim && ((t + (c.isOma ? 0.7 : c.def.desk[0] * 0.13)) % 4.2) < 0.13;
    if (c.mode === 'seated') {
      if (c.seatPose === 'back') { const st = c.rec.state, atDesk = c.place === 'desk'; drawSeatedBack(g, d, x, c.seatTY * TILE + 8, { typing: atDesk && (st === 'WORKING' || st === 'VERIFYING'), phase: Math.floor(t / 0.22) % 2, raise: atDesk && st === 'WAITING' }); }
      else { const p = c.isOma ? this._omaPose() : {}; drawSeatedFront(g, d, x, c.seatTY * TILE + c.seatSy, { blink, think: p.think, typing: p.typing, phase: Math.floor(t / 0.22) % 2 }); }
      return;
    }
    let frame = 0; if (c.mode === 'walk' || c.mode === 'trans') frame = Math.floor(c.walkT / 0.14) % 4;
    drawStanding(g, d, x, y, c.dir, frame, { blink, raise: c.isOma && c.place === 'door' });
  }
  _held(c) { return c.doneAt != null && this.clock < c.doneAt + HOLD; }
  _iconFor(c) {
    const now = this.clock, r = c.rec, atDesk = c.mode === 'seated' && c.place === 'desk';
    if (c.badge && now < c.badge.until) return c.badge.type;
    if (atDesk && r.state === 'WAITING') return 'clock';
    if (atDesk && r.state === 'VERIFYING') return 'mag';
    if (this.night && !BUSY.has(r.state) && !this._held(c) && c.mode === 'seated') return 'zz';
    return null;
  }
  _omaIcon() {
    const o = this.oma, T = this.task;
    if (T.waiting) return null;
    if (o.badge && this.clock < o.badge.until) return o.badge.type;
    if (o.mode !== 'seated') return null;
    const p = this._omaPose(); return p.think ? 'think' : p.verify ? 'mag' : null;
  }
  _itemDyn(g, it, t) {
    if (it.kind === 'workstation') {
      const c = this.chars[it.o.owner], s = c.def.screen, r = c.rec, busy = BUSY.has(r.state), held = this._held(c);
      if (busy) {
        P(g, s.x, s.y, s.w, s.h, r.state === 'WAITING' ? '#2a2414' : '#0f2036'); P(g, s.x, s.y, s.w, 2, c.def.acc); P(g, s.x + 1, s.y, 4, 1, '#ffffff');
        if (r.state !== 'WAITING' && Math.floor(t / 0.5) % 2) P(g, s.x + s.w - 4, s.y + s.h - 4, 2, 2, '#bfe9ff');
        g.globalAlpha = 0.12; P(g, s.x - 6, s.y + s.h + 2, s.w + 12, 8, '#9fdcff'); g.globalAlpha = 1;
      } else if (held) { P(g, s.x, s.y, s.w, s.h, c.doneOk ? '#0f2a1c' : '#2a1414'); P(g, s.x, s.y, s.w, 2, c.doneOk ? '#7ee08a' : '#ff6b6b'); }
      else { P(g, s.x, s.y, s.w, s.h, '#0d131f'); P(g, s.x + 2, s.y + 2, 10, 1, '#1a2436'); P(g, s.x + 2, s.y + 4, 6, 1, '#1a2436'); }
      if (c.paperOnDesk) paperSprite(g, c.def.drop.x, c.def.drop.y, 'task');
    }
    if (it.kind === 'execDesk') {
      for (let i = 0; i < Math.min(4, this.task.returned); i++) { P(g, TRAY.x - 5, TRAY.y - 1 - i, 10, 1, i % 2 ? '#dfe4ee' : '#f4f6fa'); }
      if (this.task.id && !this.task.ended) { P(g, it.sx + 23, it.sy + 7, 2, 2, Math.floor(t / 0.6) % 2 ? '#bff0ff' : '#6fd3ff'); }
    }
  }
  _drawWallDyn(g, t) {
    const s = CABIN_SCREEN, T = this.task, running = T.id && !T.ended;
    P(g, s.x + 2, s.y + 2, s.w - 4, s.h - 4, T.waiting ? '#241d10' : '#0e1a2e');
    P(g, s.x + 2, s.y + 2, s.w - 4, 1, T.waiting ? '#f2c46b' : T.id ? (STATE_COL[T.status] || '#3d7fa6') : '#2a3a5a');
    if (running && !T.waiting) { const k = Math.floor(t / 0.25) % (s.w - 12); g.globalAlpha = 0.6; P(g, s.x + 4 + k, s.y + s.h - 4, 6, 1, '#6fd3ff'); g.globalAlpha = 1; }
    if (T.waiting) { g.globalAlpha = 0.45 + 0.35 * Math.sin(t * 4); P(g, s.x + 2, s.y + s.h - 3, s.w - 4, 1, '#f2c46b'); g.globalAlpha = 1; }
  }
  render() {
    if (!this.ctx) return;
    this.frames++;
    const g = this.g, t = this.clock, N = this.night;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.bg, 0, 0);
    this._drawWallDyn(g, t);
    const list = this.items.slice();
    for (const c of this.charList) list.push({ base: this._charBase(c), ch: c });
    list.push({ base: this._charBase(this.oma), ch: this.oma });
    list.sort((a, b) => a.base - b.base);
    for (const e of list) {
      if (e.ch) this._drawChar(g, e.ch);
      else { g.drawImage(N ? e.spriteN : e.sprite, e.sx, e.sy); this._itemDyn(g, e, t); }
    }
    g.drawImage(this.light, 0, 0);
    for (const p of this.papers) { const k = Math.min(1, p.t / p.dur); paperSprite(g, p.fx + (p.tx - p.fx) * k, p.fy + (p.ty - p.fy) * k - p.h * 4 * k * (1 - k), p.kind); }
    for (const c of this.charList) { const ic = this._iconFor(c); if (!ic) continue; const side = c.mode === 'seated' && c.seatPose === 'back';   // beside the head, so the monitor stays readable
      iconBubble(g, Math.round(c.x) + (side ? 13 : 0), this._headTop(c) + (side ? 9 : -2), ic, t); }
    { const o = this.oma, ic = this._omaIcon(), sx = o.mode === 'seated' ? 15 : 0, sy = o.mode === 'seated' ? 11 : -1;   // beside OMA, clear of the wall screen
      if (ic === 'think') thinkBubble(g, Math.round(o.x) + sx, this._headTop(o) + sy, t); else if (ic) iconBubble(g, Math.round(o.x) + sx, this._headTop(o) + sy - 1, ic, t); }
    // ---- to screen
    const ctx = this.ctx, cw = this.canvas.width, ch = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = N ? '#05060a' : '#12141b'; ctx.fillRect(0, 0, cw, ch);
    if (!this.sharp) { ctx.imageSmoothingEnabled = false; ctx.drawImage(this.world, this.ox, this.oy, this.dw, this.dh); }
    else {
      const k = this.preK, pg = this.pre.getContext('2d'); pg.imageSmoothingEnabled = false; pg.drawImage(this.world, 0, 0, LW * k, LH * k);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(this.pre, this.ox, this.oy, this.dw, this.dh);
    }
    this._overlay(ctx);
  }

  /* ---------------- crisp text overlay (screen space) */
  _sx(lx) { return this.ox + lx * this.u; }
  _sy(ly) { return this.oy + ly * this.u; }
  _font(px, weight, mono) { return `${weight || 400} ${Math.round(px)}px ${mono ? '"Cascadia Mono", Consolas, "Courier New", monospace' : '"Segoe UI", "Nirmala UI", system-ui, sans-serif'}`; }
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
  _plate(ctx, cx, cy, text, o = {}) {
    const fs = o.fs; ctx.font = this._font(fs, o.weight || 700);
    const dotW = o.dot ? Math.round(fs * 0.9) : 0, pad = Math.round(fs * 0.45), tw = Math.ceil(ctx.measureText(text).width);
    const w = tw + pad * 2 + dotW, h = Math.round(fs * 1.35), x = Math.round(cx - w / 2), y = Math.round(cy - h / 2);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x + 1, y + 1, w, h);
    ctx.fillStyle = o.border || '#c9a24a'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = o.bg || '#161b28'; ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    if (o.dot) { const r = Math.max(2, Math.round(fs * 0.24)); ctx.fillStyle = o.dot; ctx.beginPath(); ctx.arc(x + pad + r, y + h / 2, r, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = o.color || '#f3ead2'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(text, x + pad + dotW, y + h / 2 + 0.5);
    return { x, y, w, h };
  }
  _overlay(ctx) {
    const u = this.u, T = this.task, now = this.clock;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    // OMA's wall screen: the current task, from events
    { const s = CABIN_SCREEN, X = this._sx(s.x + 5), Y = this._sy(s.y + 4), W = (s.w - 10) * u, H = (s.h - 7) * u;
      const fs = clamp(Math.round(u * 6.2), 8, 16), lh = Math.round(fs * 1.2);
      ctx.save(); ctx.beginPath(); ctx.rect(X, Y, W, H); ctx.clip(); ctx.textBaseline = 'top';
      const head = (l, r, rc) => { ctx.font = this._font(fs * 0.82, 800); ctx.fillStyle = '#7f8db0'; ctx.fillText(l, X, Y); if (r) { ctx.textAlign = 'right'; ctx.fillStyle = rc; ctx.fillText(r, X + W, Y); ctx.textAlign = 'left'; } };
      const rows = Math.max(1, Math.floor(H / lh) - 1);
      if (T.waiting) {
        head('NEEDS YOUR OK', 'WAITING', '#f2c46b');
        ctx.font = this._font(fs, 600); ctx.fillStyle = '#ffe7b0';
        const tl = this._wrap(ctx, T.question || 'A worker is waiting for your permission', W, Math.max(1, rows - 1)); tl.forEach((l, i) => ctx.fillText(l, X, Y + lh * (1 + i)));
        if (rows > tl.length) { ctx.font = this._font(fs * 0.85, 500); ctx.fillStyle = '#c9a66a'; ctx.fillText(this._fitText(ctx, 'Click the ? at the door to answer', W), X, Y + lh * (1 + tl.length)); }
      } else if (T.id) {
        head('CURRENT TASK', T.status || '', STATE_COL[T.status] || '#c9d2e6');
        ctx.font = this._font(fs, 600); ctx.fillStyle = '#eef3ff';
        const tl = this._wrap(ctx, T.text || T.id, W, Math.max(1, Math.min(2, rows - 1))); tl.forEach((l, i) => ctx.fillText(l, X, Y + lh * (1 + i)));
        if (rows > tl.length) { ctx.font = this._font(fs * 0.85, 400); ctx.fillStyle = '#9fb0d0'; ctx.fillText(this._fitText(ctx, T.ended ? (T.result || T.status) : (T.stage || '-') + (T.detail ? ' · ' + T.detail : ''), W), X, Y + lh * (1 + tl.length)); }
      } else {
        head('CURRENT TASK', '', '');
        ctx.font = this._font(fs, 600); ctx.fillStyle = '#c9d2e6'; ctx.fillText('No task running', X, Y + lh);
        ctx.font = this._font(fs * 0.85, 400); ctx.fillStyle = '#7f8db0'; ctx.fillText('Waiting for a command', X, Y + lh * 2);
      }
      ctx.restore(); }
    // door name plate
    this._plate(ctx, this._sx(22 * TILE), this._sy(8 * TILE - 13), 'OMA AI', { fs: clamp(Math.round(u * 5.4), 9, 14), color: '#8fe3ff', weight: 800 });
    // lounge sign
    this._plate(ctx, this._sx(40 * TILE), this._sy(13 * TILE - 4), 'LOUNGE', { fs: clamp(Math.round(u * 4.6), 8, 12), color: '#f2c46b', border: '#7a6a4a' });
    // workstations: name plate on the partition, the real step on the monitor
    const pfs = clamp(Math.round(u * 5), 8, 13);
    for (const c of this.charList) {
      const d = c.def, r = c.rec, busy = BUSY.has(r.state), held = this._held(c);
      const dot = busy ? (STATE_COL[r.state] || '#6fd3ff') : held ? (c.doneOk ? STATE_COL.COMPLETED : STATE_COL.FAILED) : '#5b6274';
      this._plate(ctx, this._sx((d.desk[0] + 2) * TILE), this._sy(d.desk[1] * TILE - 26), `${d.name} · ${d.role}`, { fs: pfs, dot });
      if (busy || held) this._monitorText(ctx, c, busy, held);
    }
    // name tags for anyone away from the desk
    const tfs = clamp(Math.round(u * 4.4), 8, 12);
    for (const c of this.charList) if (!(c.mode === 'seated' && c.place === 'desk')) this._plate(ctx, this._sx(c.x), this._sy((c.mode === 'seated' ? this._charBase(c) : c.y) + 6), c.def.name, { fs: tfs, border: '#3a4158', color: '#e6ebf5' });
    if (this.oma.mode !== 'seated') this._plate(ctx, this._sx(this.oma.x), this._sy(this.oma.y + 6), 'OMA', { fs: tfs, border: '#3d7fa6', color: '#8fe3ff' });
    // OMA asks for permission: a "?" bubble you can click
    this._askRect = null;
    if (T.waiting) {
      const o = this.oma, fs = clamp(Math.round(u * 8), 14, 22), cx = this._sx(o.x), tip = this._sy(Math.min(this._headTop(o) - 1, 8 * TILE - 19));   // above the door plate
      ctx.font = this._font(fs * 0.55, 700); const cap = 'Your OK?', cw = ctx.measureText(cap).width;
      const h = Math.round(fs * 1.45), w = Math.round(fs * 1.1 + cw + fs * 0.9), x = Math.round(cx - w / 2), y = Math.round(tip - h - fs * 0.45);
      const pulse = 0.5 + 0.5 * Math.sin(now * 4);
      ctx.strokeStyle = `rgba(242,196,107,${0.25 + 0.5 * pulse})`; ctx.lineWidth = Math.max(2, Math.round(fs * 0.18)); this._rr(ctx, x - 3, y - 3, w + 6, h + 6, h / 2 + 3); ctx.stroke();
      ctx.fillStyle = '#fff7e2'; ctx.strokeStyle = '#1e2230'; ctx.lineWidth = Math.max(1, Math.round(u / 2)); this._rr(ctx, x, y, w, h, h / 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - fs * 0.3, y + h - 1); ctx.lineTo(cx, tip); ctx.lineTo(cx + fs * 0.3, y + h - 1); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff7e2'; ctx.fillRect(cx - fs * 0.3 + 1, y + h - 3, fs * 0.6 - 2, 3);
      ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.font = this._font(fs, 900); ctx.fillStyle = '#d9952a'; ctx.fillText('?', x + fs * 0.75, y + h / 2 + 1);
      ctx.textAlign = 'left'; ctx.font = this._font(fs * 0.55, 700); ctx.fillStyle = '#3a3020'; ctx.fillText(cap, x + fs * 1.3, y + h / 2 + 1);
      this._askRect = { x: x - 4, y: y - 4, w: w + 8, h: h + 8 + (tip - y - h) };
    }
  }
  _monitorText(ctx, c, busy, held) {
    const u = this.u, s = c.def.screen, r = c.rec;
    const X = this._sx(s.x + 2), Y = this._sy(s.y + 3), W = (s.w - 4) * u, H = (s.h - 5) * u;
    const fs = clamp(Math.floor(H / 2.4), 8, 13), lh = Math.round(fs * 1.12), rows = Math.max(1, Math.floor(H / lh));
    let text = r.state === 'WAITING' ? 'Waiting for your OK' : (r.step || (r.state === 'ASSIGNED' ? 'Assigned' : r.state === 'VERIFYING' ? 'Verifying' : 'Working'));
    if (!busy && held) text = (c.doneOk ? '✓' : '✕') + (r.step || (c.doneOk ? 'Done' : 'Failed'));
    ctx.save(); ctx.beginPath(); ctx.rect(X, Y, W, H); ctx.clip();
    ctx.font = this._font(fs, 600); ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    const lines = this._wrap(ctx, text, W, 40), pages = Math.max(1, Math.ceil(lines.length / rows));
    const pg = busy && pages > 1 ? Math.floor(this.clock / 2) % pages : 0;
    ctx.fillStyle = busy ? (r.state === 'WAITING' ? '#ffd88a' : '#d4f1ff') : c.doneOk ? '#9ff0a8' : '#ffb0b0';
    lines.slice(pg * rows, pg * rows + rows).forEach((l, i) => ctx.fillText(pages > 1 && !busy && i === rows - 1 ? this._fitText(ctx, l + '…', W) : l, X, Y + i * lh));
    ctx.restore();
  }

  /* ---------------- hit testing + popup */
  _hit(e) {
    const r = this.canvas.getBoundingClientRect(), dpr = this.dpr || 1;
    const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr;
    const a = this._askRect; if (a && px >= a.x && px <= a.x + a.w && py >= a.y && py <= a.y + a.h) return 'ask';
    const lx = (px - this.ox) / this.u, ly = (py - this.oy) / this.u;
    if (lx < 0 || ly < 0 || lx > LW || ly > LH) return null;
    const all = this.charList.concat([this.oma]).sort((p, q) => this._charBase(q) - this._charBase(p));
    for (const c of all) { const top = this._headTop(c) - 1, bot = c.mode === 'seated' ? this._charBase(c) : c.y + 1; if (lx >= c.x - 7 && lx <= c.x + 7 && ly >= top && ly <= bot) return c.id; }
    for (const [id, it] of Object.entries(DESK_OF)) if (lx >= it.tx * TILE && lx <= (it.tx + 4) * TILE && ly >= it.ty * TILE - 30 && ly <= (it.ty + 2) * TILE) return id;
    if ((lx >= EXEC.tx * TILE && lx <= (EXEC.tx + 6) * TILE && ly >= EXEC.ty * TILE - 14 && ly <= (EXEC.ty + 1) * TILE) ||
      (lx >= CABIN_SCREEN.x && lx <= CABIN_SCREEN.x + CABIN_SCREEN.w && ly >= CABIN_SCREEN.y && ly <= CABIN_SCREEN.y + CABIN_SCREEN.h)) return 'oma';
    return null;
  }
  _click(e) {
    const h = this._hit(e);
    if (h === 'ask') {
      const ot = window.OmaTask;
      if (ot && typeof ot.answerPrompt === 'function') { try { ot.answerPrompt(); } catch (err) { console.error(err); } }
      else this.select('oma');
      return;
    }
    this.select(h === this.selected ? null : h);
  }
  _renderPanel() {
    const el = this.panel; if (!el) return;
    if (!this.selected) { el.style.display = 'none'; el.innerHTML = ''; return; }
    const T = this.task, st = s => `<span class="st" style="background:${STATE_COL[s] || '#9aa3b5'}">${esc(s || '-')}</span>`;
    let h = '<button class="x" data-close="1" title="Close">×</button>', anchor;
    if (this.selected === 'oma') {
      h += `<h3>OMA AI <span class="role">· Boss</span></h3><div class="sub">${T.waiting ? st('WAITING') + ' needs your OK' : T.id ? st(T.status || 'RUNNING') + ' ' + esc(T.stage || '') : 'No task running'}</div><dl>
        <dt>Task</dt><dd>${esc(T.text || T.id || '-')}</dd>
        ${T.waiting ? `<dt>Question</dt><dd>${esc(T.question || '-')}</dd>` : ''}
        <dt>Model</dt><dd>${esc(T.model || '-')}</dd>
        <dt>Result</dt><dd>${esc(clip(T.result || '-', 300))}</dd>
        ${T.reply ? `<dt>Reply</dt><dd>${esc(clip(T.reply, 400))}</dd>` : ''}</dl>`;
      anchor = { x: this.oma.x + 40, y: this.oma.y - 30, w: 0 };
    } else {
      const c = this.chars[this.selected]; if (!c) { el.style.display = 'none'; return; }
      const r = c.rec, d = c.def, rows = r.history.slice().reverse();
      h += `<h3>${esc(d.name)} <span class="role">· ${esc(d.role)}</span></h3><div class="sub">${st(r.state)}${BUSY.has(r.state) && r.step ? ' ' + esc(clip(r.step, 90)) : ''}</div>`;
      h += rows.length ? '<div class="lbl">Last steps</div><ol class="steps">' + rows.map(x => `<li><time>${esc(hhmmss(x.ts))}</time>${st(x.state)}<span class="tx">${esc(x.text)}</span></li>`).join('') + '</ol>'
        : '<div class="note">No steps yet: this worker has not been given work since Oma started.</div>';
      if (c.id === 'dave' && r.evidence.length) h += '<div class="lbl">Evidence</div><ul class="ev">' + r.evidence.slice(-3).map(e => `<li><b class="${e.ok === true ? 'ok' : e.ok === false ? 'bad' : ''}">${e.ok === true ? '✓' : e.ok === false ? '✕' : '?'}</b> ${esc(clip(e.detail, 160))}</li>`).join('') + '</ul>';
      anchor = { x: (d.desk[0] + 2) * TILE, y: d.desk[1] * TILE - 30, w: 32 };
    }
    el.innerHTML = h; el.style.display = 'block';
    const par = el.offsetParent || this.canvas.parentElement; if (!par) return;
    const dpr = this.dpr || 1, PW = par.clientWidth, PH = par.clientHeight, pw = el.offsetWidth, ph = el.offsetHeight;
    const ax = this.canvas.offsetLeft + this._sx(anchor.x) / dpr, ay = this.canvas.offsetTop + this._sy(anchor.y) / dpr, aw = anchor.w * this.u / dpr;
    let left = ax + aw + 10; if (left + pw > PW - 8) left = ax - aw - 10 - pw; left = clamp(left, 8, Math.max(8, PW - pw - 8));
    const top = clamp(ay, 8, Math.max(8, PH - ph - 8));
    el.style.left = Math.round(left) + 'px'; el.style.top = Math.round(top) + 'px';
  }
  _selfCheck() {
    const bad = [];
    const spots = Object.values(WORKER_DEFS).map(d => d.approach).concat(LOUNGE_SPOTS.map(s => s.tile), [[20, 4], [21, 8]]);
    for (const a of spots) if (!walkable(a[0], a[1])) bad.push('blocked spot ' + a);
    for (const d of Object.values(WORKER_DEFS)) for (const s of LOUNGE_SPOTS) if (!findPath(d.approach[0], d.approach[1], s.tile[0], s.tile[1])) bad.push(`no route ${d.name} -> ${s.tile}`);
    if (!findPath(20, 4, 21, 8)) bad.push('no route OMA seat -> door');
    if (bad.length) console.error('OfficeTown self-check:', bad);
    return bad;
  }
  // head-and-shoulders picture of a worker (the same pixel sprite), for the chips above the office
  portrait(id, px = 44) {
    const d = WORKER_DEFS[id]; if (!d) return '';
    const s = mk(20, 28); drawStanding(s.getContext('2d'), d, 10, 26, 'down', 0, {});
    const c = mk(px, px), g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    g.drawImage(s, 2, 2, 16, 16, 0, 0, px, px);
    return c.toDataURL();
  }
  resize() {
    if (!this.canvas) return;
    const r = this.canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(r.width * dpr)), ch = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
    const m = Math.round(6 * dpr), fit = Math.max(0.1, Math.min((cw - 2 * m) / LW, (ch - 2 * m) / LH));
    let u = Math.floor(fit); this.sharp = false;
    if (u < 1 || u / fit < 0.8) { u = fit; this.sharp = true; const k = Math.max(1, Math.ceil(fit)); if (!this.pre || this.preK !== k) { this.pre = mk(LW * k, LH * k); this.preK = k; } }
    this.u = u; this.dpr = dpr; this.dw = Math.round(LW * u); this.dh = Math.round(LH * u);
    this.ox = Math.floor((cw - this.dw) / 2); this.oy = Math.floor((ch - this.dh) / 2);
    if (this._loop) { this.requestRender(); if (this.selected) this._renderPanel(); }
  }
}
window.OfficeTown = OfficeTown;
})();
