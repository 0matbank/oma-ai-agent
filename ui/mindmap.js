/**
 * Oma AI Agent - Mind map: Memory, Skills, Soul, Setting around the orb (Oma Halo).
 * Each module joins the orb's halo by an aurora ribbon: a few see-through coloured strands that wave
 * slowly and meet at both ends. Faster while Oma thinks or works. ~30 fps, paused while hidden.
 */

class OmaMindMap {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.nodes = [
      { id: 'memory', name: 'Memory', subtitle: 'Facts & Context', color: '#00e5ff', glow: 'rgba(0, 229, 255, 0.45)', icon: '🧠', tab: 'memory' },
      { id: 'skills', name: 'Skills', subtitle: 'Tools & Functions', color: '#ff5722', glow: 'rgba(255, 87, 34, 0.45)', icon: '⚡', tab: 'integrations' },
      { id: 'soul', name: 'Soul', subtitle: 'Persona & Logic', color: '#00e676', glow: 'rgba(0, 230, 118, 0.45)', icon: '✨', tab: 'brain' },
      { id: 'setting', name: 'Setting', subtitle: 'System Config', color: '#e0e0ff', glow: 'rgba(224, 224, 255, 0.45)', icon: '⚙️', tab: 'general' }
    ];
    this.time = 0;
    this.state = 'active';
    this.last = 0;

    this.initDOM();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (window.ResizeObserver && this.canvas.parentElement) new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement);
    requestAnimationFrame(ts => this.animate(ts));
  }

  initDOM() {
    const container = document.getElementById('nodes-group');
    if (!container) return;
    container.innerHTML = '';

    this.nodes.forEach(node => {
      const el = document.createElement('div');
      el.className = 'system-node';
      el.id = `node-${node.id}`;
      el.title = `${node.name} · ${node.subtitle}`;   // narrow windows show only the icon
      el.style.setProperty('--node-color', node.color);
      el.style.setProperty('--node-glow', node.glow);

      el.innerHTML = `
        <div class="node-icon-box" style="background:${node.color}15; border:1px solid ${node.color}35; color:${node.color};">
          ${node.icon}
        </div>
        <div class="node-info">
          <span class="node-title">${node.name}</span>
          <span class="node-subtitle">${node.subtitle}</span>
        </div>
        <div class="node-anchor" style="background:${node.color}; box-shadow:0 0 6px ${node.color};"></div>
      `;

      // Clicking any module opens its actual corresponding functional Settings tab!
      el.addEventListener('click', () => {
        if (window.omaPanels && window.omaPanels[node.id]) return window.omaPanels[node.id]();   // Core Memory / Skills dialogs
        if (window.OmaController && window.OmaController.openSettings) {
          window.OmaController.openSettings(node.tab);
        } else if (window.st && window.st.openSettings) {
          window.st.openSettings(node.tab);
        }
      });

      container.appendChild(el);
    });
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement ? this.canvas.parentElement.getBoundingClientRect() : this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = rect.width || 85;
    this.height = rect.height || 280;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setState(newState) {
    this.state = newState;
  }

  static rgb(hex) { const n = parseInt(hex.slice(1), 16); return `${n >> 16},${(n >> 8) & 255},${n & 255}`; }

  // one ribbon along a cubic curve P: strands wave around it and meet at both ends
  ribbon(P, cols, time, seed, amp) {
    const c = this.ctx, N = 56, at = t => { const m = 1 - t; return [0, 1].map(k => m * m * m * P[0][k] + 3 * m * m * t * P[1][k] + 3 * m * t * t * P[2][k] + t * t * t * P[3][k]); };
    const base = [], nrm = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, a = at(t), b = at(Math.min(1, t + 0.01)), d = at(Math.max(0, t - 0.01)), dx = b[0] - d[0], dy = b[1] - d[1], l = Math.hypot(dx, dy) || 1;
      base.push(a); nrm.push([-dy / l, dx / l]);
    }
    cols.forEach((col, k) => {
      const ph = seed + k * 1.9, f1 = 0.55 + (k % 3) * 0.2, f2 = 1.1 + k * 0.15, sp = 0.6 + k * 0.15;
      c.beginPath();
      base.forEach((p, i) => {
        const t = i / N, env = Math.pow(Math.sin(Math.PI * t), 0.9);
        const o = amp * env * (Math.sin(t * 6.283 * f1 + time * sp + ph) * 0.75 + Math.sin(t * 6.283 * f2 - time * sp * 0.7 + ph * 1.3) * 0.35);
        const x = p[0] + nrm[i][0] * o, y = p[1] + nrm[i][1] * o;
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      });
      c.strokeStyle = `rgba(${col},0.07)`; c.lineWidth = 16 + (k % 3) * 9; c.stroke();   // wide soft band
      c.strokeStyle = `rgba(${col},0.12)`; c.lineWidth = 5; c.stroke();
      c.strokeStyle = `rgba(${col},0.45)`; c.lineWidth = 1; c.stroke();                 // bright thread
    });
  }

  animate(ts) {
    requestAnimationFrame(t => this.animate(t));
    if (document.hidden || !this.ctx || !this.width || ts - this.last < 32) return;   // ~30 fps is plenty for slow waves
    const dt = Math.min(0.05, (ts - (this.last || ts)) / 1000);
    this.last = ts;
    const busy = { thinking: 2, planning: 2, executing: 1.6, working: 1.6, verifying: 1.6, listening: 1.4, speaking: 1.4 }[this.state] || 1;
    this.time += dt * 0.9 * busy;
    const c = this.ctx;
    c.clearRect(0, 0, this.width, this.height);
    const orb = window.holoOrb, box = this.canvas.getBoundingClientRect();
    if (!orb || !orb.ringAt || !this.canvas.offsetParent) return;
    const ring = orb.ringAt(), cx = ring.x - box.left, cy = ring.y - box.top;
    c.globalCompositeOperation = 'lighter';
    this.nodes.forEach((node, i) => {
      const el = document.getElementById(`node-${node.id}`); if (!el || !el.offsetParent) return;
      const r = el.getBoundingClientRect(), left = r.left + r.width / 2 < ring.x;
      const x0 = (left ? r.right : r.left) - box.left - (left ? 2 : -2), y0 = r.top + r.height / 2 - box.top;
      if (left ? x0 > cx - ring.r : x0 < cx + ring.r) return;                    // too narrow: no room for a line
      const ang = Math.atan2(y0 - cy, x0 - cx), xe = cx + Math.cos(ang) * ring.r, ye = cy + Math.sin(ang) * ring.r, xm = (x0 + xe) / 2;
      node.rgb = node.rgb || OmaMindMap.rgb(node.color);
      this.ribbon([[x0, y0], [xm, y0], [xm, ye], [xe, ye]], [node.rgb, node.rgb, '255,181,71', '150,110,255'], this.time, i * 1.7, Math.min(26, Math.abs(xe - x0) / 7));
    });
    c.globalCompositeOperation = 'source-over';
  }
}

window.OmaMindMap = OmaMindMap;
