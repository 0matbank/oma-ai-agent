/**
 * Oma particle orb (Stonic-style voice globe), Canvas 2D.
 * A sphere of particles with a glowing core and a tilted orbital ring. Driven only by real state:
 *   idle | listening | thinking | active | speaking | waiting | partial | completed | error
 * setAudioLevel(0..1) comes from the real microphone level. Same public API as the old OmaHoloFace, so it is a drop-in
 * for ui/orb.js (window.OmaHoloOrb). Themes: stonic (teal), hacker (green), cyberpunk (magenta), danger (red).
 * Cost: ~3k particles, fillRect only, 60 fps while busy, 30 fps idle, paused when hidden.
 */
class OmaParticleOrb {
  constructor(canvasId, opts = {}) {
    this.canvas = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
    this.ctx = this.canvas.getContext('2d');
    this.state = 'idle';
    this.theme = opts.theme || 'stonic';
    this.audio = 0; this.audioTarget = 0;
    this.speed = 1; this.reduceMotion = false; this.fpsCap = 60;
    this.rotY = 0; this.targetRotX = 0; this.targetRotY = 0; this.tilt = 0.38;
    this.mix = this.palette(this.colorsFor('idle'));   // current colours, eased toward the state's
    this.energy = 0.25; this.energyTarget = 0.25;       // core brightness / particle alpha
    this.swirl = 0; this.swirlTarget = 0;               // differential rotation (thinking)
    this.burst = 0;                                      // completion / error shock ring 0..1
    this.t = 0; this.last = 0; this.hidden = false;
    this.build(opts.count || 3000);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { this.hidden = document.hidden; if (!this.hidden) this.kick(); });
    this.wireDrag();
    this.kick();
  }

  static THEMES = {
    stonic:    { a: [45, 226, 230], b: [138, 243, 255], core: [232, 255, 255] },
    hacker:    { a: [57, 255, 106], b: [170, 255, 190], core: [235, 255, 240] },
    cyberpunk: { a: [255, 43, 214], b: [122, 92, 255], core: [255, 225, 250] },
    danger:    { a: [255, 51, 68],  b: [255, 138, 138], core: [255, 236, 236] },
  };
  static STATE = {   // colour override, energy, swirl, label
    idle:      { energy: 0.22, swirl: 0,    label: 'STANDBY' },
    listening: { energy: 0.65, swirl: 0.1,  label: 'LISTENING' },
    thinking:  { energy: 0.75, swirl: 1,    label: 'CALIBRATING', tint: [255, 181, 71] },
    active:    { energy: 0.9,  swirl: 0.25, label: 'ACTIVE' },
    speaking:  { energy: 1,    swirl: 0.15, label: 'SPEAKING' },
    waiting:   { energy: 0.55, swirl: 0,    label: 'WAITING FOR YOU', tint: [255, 200, 87] },
    partial:   { energy: 0.6,  swirl: 0,    label: 'PARTIAL', tint: [255, 200, 87] },
    completed: { energy: 0.95, swirl: 0,    label: 'DONE', tint: [0, 245, 155] },
    error:     { energy: 0.8,  swirl: 0,    label: 'FAILED', tint: [255, 64, 80] },
  };

  colorsFor(state) {
    const th = OmaParticleOrb.THEMES[this.theme] || OmaParticleOrb.THEMES.stonic;
    const tint = (OmaParticleOrb.STATE[state] || {}).tint;
    if (!tint) return th;
    const lift = c => c.map(v => Math.min(255, v + 70));
    return { a: tint, b: lift(tint), core: [255, 248, 230] };
  }
  palette(c) { return { a: c.a.slice(), b: c.b.slice(), core: c.core.slice() }; }

  build(n) {   // Fibonacci sphere: even spacing, no poles clumping
    this.p = [];
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y0 = 1 - (i / (n - 1)) * 2, th = ga * i + (Math.random() - 0.5) * 0.35;   // jitter breaks the spiral rows
      const y = Math.max(-1, Math.min(1, y0 + (Math.random() - 0.5) * 0.03)), r = Math.sqrt(1 - y * y), d = 0.94 + Math.random() * 0.1;
      this.p.push({ x: Math.cos(th) * r * d, y: y * d, z: Math.sin(th) * r * d, ph: Math.random() * 6.283, sz: Math.random() < 0.08 ? 2 : 1, lat: y,
                    k: 0.75 + Math.random() * 0.5 });
    }
    this.dust = Array.from({ length: 90 }, () => ({ a: Math.random() * 6.283, b: Math.acos(2 * Math.random() - 1), r: 1.15 + Math.random() * 0.6,
                                                     s: 0.2 + Math.random() * 0.6, ph: Math.random() * 6.283 }));
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height); this.dpr = dpr;
    this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.R = Math.min(this.w, this.h) * 0.3;
    this.cy = this.h * (this.h > 260 ? 0.44 : 0.5);
  }

  wireDrag() {
    let down = null;
    this.canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY, this.targetRotY, this.targetRotX]; });
    window.addEventListener('pointermove', e => {
      if (!down) return;
      this.targetRotY = down[2] + (e.clientX - down[0]) * 0.01;
      this.targetRotX = Math.max(-0.8, Math.min(0.8, down[3] + (e.clientY - down[1]) * 0.01));
    });
    window.addEventListener('pointerup', () => { down = null; });
  }

  setState(s) {
    if (!OmaParticleOrb.STATE[s]) s = 'active';
    if (s === this.state) return;
    if (s === 'completed' || s === 'error') this.burst = 1;
    this.state = s;
    const st = OmaParticleOrb.STATE[s];
    this.energyTarget = st.energy; this.swirlTarget = st.swirl;
    this.onLabel?.(st.label, s);
    this.kick();
  }
  setTheme(name) { if (OmaParticleOrb.THEMES[name]) { this.theme = name; this.kick(); } }
  setAudioLevel(v) { this.audioTarget = Math.max(0, Math.min(1, +v || 0)); }
  setSpeedMode(m) { this.speed = { slow: 0.5, normal: 1, fast: 1.6 }[m] || 1; }
  setReduceMotion(on) { this.reduceMotion = !!on; }
  setFpsLimit(f) { this.fpsCap = Math.max(10, Math.min(60, f | 0)); }
  label() { return OmaParticleOrb.STATE[this.state].label; }

  kick() { if (!this.raf) this.raf = requestAnimationFrame(ts => this.frame(ts)); }

  frame(ts) {
    this.raf = 0;
    if (this.hidden) return;
    const cap = this.state === 'idle' ? Math.min(30, this.fpsCap) : this.fpsCap;
    if (ts - this.last >= 1000 / cap - 1) {
      const dt = Math.min(0.05, (ts - (this.last || ts)) / 1000);
      this.last = ts;
      this.step(dt);
      this.draw();
    }
    this.kick();
  }

  step(dt) {
    const e = (a, b, k) => a + (b - a) * Math.min(1, dt * k);
    const sp = this.reduceMotion ? 0.3 : this.speed;
    this.t += dt * sp;
    this.audio = e(this.audio, this.audioTarget, 14);
    this.energy = e(this.energy, this.energyTarget + this.audio * 0.25, 4);
    this.swirl = e(this.swirl, this.swirlTarget, 3);
    this.burst = Math.max(0, this.burst - dt * 0.9);
    const want = this.colorsFor(this.state);
    for (const k of ['a', 'b', 'core']) for (let i = 0; i < 3; i++) this.mix[k][i] = e(this.mix[k][i], want[k][i], 3);
    this.rotY += dt * sp * (0.18 + this.energy * 0.35 + this.swirl * 0.6);
    this.rx = e(this.rx || 0, this.targetRotX, 5);
    this.ry = e(this.ry || 0, this.targetRotY, 5);
  }

  draw() {
    const c = this.ctx, w = this.w, h = this.h, cx = w / 2, cy = this.cy, R = this.R, t = this.t, m = this.mix;
    const rgb = (v, a) => `rgba(${v[0] | 0},${v[1] | 0},${v[2] | 0},${a})`;
    c.clearRect(0, 0, w, h);
    c.globalCompositeOperation = 'lighter';

    // halo + core
    const en = this.energy, au = this.audio;
    let g = c.createRadialGradient(cx, cy, 0, cx, cy, R * 1.6);
    g.addColorStop(0, rgb(m.a, 0.10 + en * 0.12)); g.addColorStop(0.55, rgb(m.a, 0.03 + en * 0.04)); g.addColorStop(1, rgb(m.a, 0));
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    const coreR = R * (0.16 + en * 0.16 + au * 0.18 + Math.sin(t * 3) * 0.015);
    g = c.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2.2);
    g.addColorStop(0, rgb(m.core, 0.55 * en + 0.1)); g.addColorStop(0.25, rgb(m.a, 0.35 * en)); g.addColorStop(1, rgb(m.a, 0));
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, coreR * 2.2, 0, 6.283); c.fill();

    // orbital ring: back half before the sphere, front half after
    const ring = (front) => {   // a thin tilted ellipse with one bright satellite riding it
      const rr = R * 1.3, k = Math.sin(this.tilt + 0.55), n = 220, rot = t * 0.55;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.283, dz = Math.sin(a);
        if ((dz > 0) !== front) continue;
        c.fillStyle = rgb(m.b, (0.08 + (dz + 1) * 0.14) * (0.45 + en * 0.55));
        c.fillRect(cx + Math.cos(a) * rr - 0.7, cy + dz * rr * k - 0.7, 1.4, 1.4);
      }
      const sa = rot % 6.283, sz = Math.sin(sa);
      if ((sz > 0) === front) {
        const sx = cx + Math.cos(sa) * rr, sy = cy + sz * rr * k, gg = c.createRadialGradient(sx, sy, 0, sx, sy, 8);
        gg.addColorStop(0, rgb(m.core, 0.95 * (0.4 + en * 0.6))); gg.addColorStop(1, rgb(m.b, 0));
        c.fillStyle = gg; c.beginPath(); c.arc(sx, sy, 8, 0, 6.283); c.fill();
      }
    };
    ring(false);

    // particles
    const cosY = Math.cos(this.rotY + this.ry), sinY = Math.sin(this.rotY + this.ry);
    const tx = this.tilt + this.rx, cosX = Math.cos(tx), sinX = Math.sin(tx);
    const think = this.swirl, st = this.state;
    const jitter = st === 'error' ? 0.035 : 0;
    const breath = st === 'waiting' ? Math.sin(t * 2.2) * 0.03 : 0;
    const shock = this.burst > 0 ? (1 - this.burst) : -1;
    for (let i = 0; i < this.p.length; i++) {
      const p = this.p[i];
      // differential swirl: latitudes turn at different speeds while thinking
      const sw = think * t * (0.8 + p.lat * 1.6), cs = Math.cos(sw), sn = Math.sin(sw);
      let x = p.x * cs - p.z * sn, z = p.x * sn + p.z * cs, y = p.y;
      const wave = Math.sin(p.ph + t * (1.4 + think * 2)) * (0.025 + en * 0.03) + au * 0.22 * Math.sin(p.ph * 3 + t * 9) * p.k + breath
                 + (jitter ? (Math.random() - 0.5) * jitter : 0) + (shock >= 0 ? Math.max(0, 0.18 - Math.abs(p.y * 0.5 + 0.5 - shock) * 0.6) : 0);
      const r = 1 + wave;
      x *= r; y *= r; z *= r;
      const x1 = x * cosY - z * sinY, z1 = x * sinY + z * cosY;
      const y2 = y * cosX - z1 * sinX, z2 = y * sinX + z1 * cosX;
      const depth = (z2 + 1.3) / 2.6;   // 0 back .. 1 front
      const a = (0.08 + depth * 0.75) * (0.35 + en * 0.65);
      const col = p.sz > 1 ? m.b : m.a;
      c.fillStyle = rgb(col, a);
      const s = (p.sz + depth * 0.9) * (R / 110);
      c.fillRect(cx + x1 * R - s / 2, cy + y2 * R - s / 2, s, s);
    }

    // drifting dust outside the sphere
    for (const d of this.dust) {
      const a = d.a + t * 0.15 * d.s, r = d.r + Math.sin(t * d.s + d.ph) * 0.05 + au * 0.3;
      const x = Math.sin(d.b) * Math.cos(a) * r, z = Math.sin(d.b) * Math.sin(a) * r, y = Math.cos(d.b) * r;
      const y2 = y * cosX - z * sinX, z2 = y * sinX + z * cosX;
      c.fillStyle = rgb(m.b, (0.05 + (z2 + 1.5) / 3 * 0.25) * en);
      c.fillRect(cx + x * R, cy + y2 * R, 1.3, 1.3);
    }
    ring(true);

    // completion / error shock wave
    if (this.burst > 0) {
      c.strokeStyle = rgb(m.b, this.burst * 0.5); c.lineWidth = 1.5;
      c.beginPath(); c.arc(cx, cy, R * (1.05 + (1 - this.burst) * 0.7), 0, 6.283); c.stroke();
    }
    c.globalCompositeOperation = 'source-over';
  }
}
window.OmaParticleOrb = OmaParticleOrb;
