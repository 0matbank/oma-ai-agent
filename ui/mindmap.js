/**
 * Oma AI Agent - Neural Mind Map & Glowing Connector Cables
 * Connects Memory, Skills, Soul, Setting to the Central Holographic AI Face.
 * Recreates the exact multi-colored curved bezier cables, bus junction, and
 * seamless data-flow connection toward the central OMA visualization.
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
    this.pulses = [];
    this.time = 0;
    this.state = 'active';

    this.initDOM();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.animate();

    // Smooth, restrained pulse generator (data packet flow)
    setInterval(() => {
      if (document.hidden || this.pulses.length > 24) return;   // rAF is paused while hidden: don't queue a burst
      const idx = Math.floor(Math.random() * this.nodes.length);
      this.pulses.push({
        nodeIndex: idx,
        progress: 0,
        speed: 0.012 + Math.random() * 0.008, // Slow, comfortable data-flow
        color: this.nodes[idx].color
      });
    }, 600);
  }

  initDOM() {
    const container = document.getElementById('nodes-group');
    if (!container) return;
    container.innerHTML = '';

    this.nodes.forEach(node => {
      const el = document.createElement('div');
      el.className = 'system-node';
      el.id = `node-${node.id}`;
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
    this.ctx.scale(dpr, dpr);
  }

  setState(newState) {
    this.state = newState;
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.time += 0.015;

    if (!this.ctx || !this.width) return;
    this.ctx.clearRect(0, 0, this.width, this.height);

    const junctionX = this.width - 18;
    const junctionY = this.height / 2;
    const busEndX = this.width;

    // Cable origins from the 4 DOM nodes
    const nodeYPositions = [];
    const parentRect = this.canvas.getBoundingClientRect();

    this.nodes.forEach((node, idx) => {
      const el = document.getElementById(`node-${node.id}`);
      let startY = 35 + idx * 65;
      if (el) {
        const r = el.getBoundingClientRect();
        startY = r.top - parentRect.top + r.height / 2;
      }
      nodeYPositions.push(startY);
    });

    // 1. Draw glowing multi-colored bezier cables
    this.nodes.forEach((node, idx) => {
      const startX = 0;
      const startY = nodeYPositions[idx];

      // Subtle backing track
      this.ctx.save();
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      this.ctx.lineWidth = 1.2;
      this.ctx.beginPath();
      this.ctx.moveTo(startX, startY);
      this.ctx.bezierCurveTo(startX + (junctionX - startX) * 0.45, startY, startX + (junctionX - startX) * 0.65, junctionY, junctionX, junctionY);
      this.ctx.stroke();

      // Glowing neon cable
      this.ctx.strokeStyle = node.color;
      this.ctx.lineWidth = 1.8;
      this.ctx.shadowColor = node.color;
      this.ctx.shadowBlur = 8;
      this.ctx.beginPath();
      this.ctx.moveTo(startX, startY);
      this.ctx.bezierCurveTo(startX + (junctionX - startX) * 0.45, startY, startX + (junctionX - startX) * 0.65, junctionY, junctionX, junctionY);
      this.ctx.stroke();
      this.ctx.restore();
    });

    // 2. Horizontal Main Bus Line from Junction directly into AI Face Card
    this.ctx.save();
    this.ctx.strokeStyle = '#00e5ff';
    this.ctx.lineWidth = 2.4;
    this.ctx.shadowColor = '#00e5ff';
    this.ctx.shadowBlur = 10;
    this.ctx.beginPath();
    this.ctx.moveTo(junctionX, junctionY);
    this.ctx.lineTo(busEndX, junctionY);
    this.ctx.stroke();

    // 3. Junction Node with subtle pulsing ring
    const pulseRing = Math.sin(this.time * 2) * 2;
    this.ctx.fillStyle = '#00e5ff';
    this.ctx.shadowColor = '#00e5ff';
    this.ctx.shadowBlur = 10;
    this.ctx.beginPath();
    this.ctx.arc(junctionX, junctionY, 4.5, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
    this.ctx.lineWidth = 1.0;
    this.ctx.beginPath();
    this.ctx.arc(junctionX, junctionY, 7.5 + pulseRing, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.restore();

    // 4. Moving Data Packet Pulses
    let speedMult = 1.0;
    if (this.state === 'thinking' || this.state === 'planning') speedMult = 1.6;
    else if (this.state === 'executing' || this.state === 'working') speedMult = 1.4;

    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.progress += p.speed * speedMult;

      if (p.progress >= 1.0) {
        this.pulses.splice(i, 1);
        continue;
      }

      const startX = 0;
      const startY = nodeYPositions[p.nodeIndex];
      let px, py;

      if (p.progress < 0.8) {
        // Traveling along the curved cable into the junction
        const t = p.progress / 0.8;
        const p0x = startX, p0y = startY;
        const p1x = startX + (junctionX - startX) * 0.45, p1y = startY;
        const p2x = startX + (junctionX - startX) * 0.65, p2y = junctionY;
        const p3x = junctionX, p3y = junctionY;

        // Cubic Bezier interpolation
        const u = 1 - t;
        px = u * u * u * p0x + 3 * u * u * t * p1x + 3 * u * t * t * p2x + t * t * t * p3x;
        py = u * u * u * p0y + 3 * u * u * t * p1y + 3 * u * t * t * p2y + t * t * t * p3y;
      } else {
        // Traveling along the horizontal bus into the face card
        const t = (p.progress - 0.8) / 0.2;
        px = junctionX + (busEndX - junctionX) * t;
        py = junctionY;
      }

      this.ctx.save();
      this.ctx.fillStyle = '#ffffff';
      this.ctx.shadowColor = p.color;
      this.ctx.shadowBlur = 8;
      this.ctx.beginPath();
      this.ctx.arc(px, py, 2.4, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }
  }
}

window.OmaMindMap = OmaMindMap;
