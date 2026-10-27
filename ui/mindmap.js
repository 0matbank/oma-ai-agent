/**
 * Oma AI Agent - Neural Mind Map & Glowing Connector Cables
 * Connects Memory, Skills, Soul, Setting to the Central Holographic AI Face.
 * Recreates the exact multi-colored curved bezier cables and bus junction from the reference video.
 */

class OmaMindMap {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.nodes = [
      { id: 'memory', name: 'Memory', subtitle: 'Facts & Context', color: '#00e5ff', glow: 'rgba(0, 229, 255, 0.5)', icon: '🧠', tab: 'memory' },
      { id: 'skills', name: 'Skills', subtitle: 'Tools & Functions', color: '#ff5722', glow: 'rgba(255, 87, 34, 0.5)', icon: '⚡', tab: 'tasks' },
      { id: 'soul', name: 'Soul', subtitle: 'Persona & Logic', color: '#00e676', glow: 'rgba(0, 230, 118, 0.5)', icon: '✨', tab: 'brain' },
      { id: 'setting', name: 'Setting', subtitle: 'System Config', color: '#e0e0ff', glow: 'rgba(224, 224, 255, 0.5)', icon: '⚙️', tab: 'settings' }
    ];
    this.pulses = [];
    this.time = 0;
    this.state = 'active';

    this.initDOM();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.animate();

    // Pulse generator
    setInterval(() => {
      const idx = Math.floor(Math.random() * this.nodes.length);
      this.pulses.push({
        nodeIndex: idx,
        progress: 0,
        speed: 0.018 + Math.random() * 0.012,
        color: this.nodes[idx].color
      });
    }, 400);
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
        <div class="node-icon-box" style="background:${node.color}18; border:1px solid ${node.color}40; color:${node.color};">
          ${node.icon}
        </div>
        <div class="node-info">
          <span class="node-title">${node.name}</span>
          <span class="node-subtitle">${node.subtitle}</span>
        </div>
        <div class="node-anchor" style="background:${node.color}; box-shadow:0 0 8px ${node.color};"></div>
      `;

      el.addEventListener('click', () => {
        if (node.id === 'setting') {
          if (window.OmaController && window.OmaController.openSettings) {
            window.OmaController.openSettings();
          } else if (window.st && window.st.openSettings) {
            window.st.openSettings();
          }
        } else {
          this.openDrawer(node.id, node.name, node.subtitle);
        }
      });

      container.appendChild(el);
    });
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement ? this.canvas.parentElement.getBoundingClientRect() : this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width || 120;
    this.height = rect.height || 260;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.scale(dpr, dpr);
  }

  setState(newState) {
    this.state = newState;
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.time += 0.02;

    if (!this.ctx || !this.width) return;
    this.ctx.clearRect(0, 0, this.width, this.height);

    // The junction point where the 4 curves converge (near the right edge of this connector area)
    const junctionX = this.width - 24;
    const junctionY = this.height / 2;
    const busEndX = this.width;

    // Cable origins from the 4 DOM nodes
    const nodeYPositions = [];
    const container = document.getElementById('nodes-group');
    const parentRect = this.canvas.getBoundingClientRect();

    this.nodes.forEach((node, idx) => {
      const el = document.getElementById(`node-${node.id}`);
      let startY = 30 + idx * 60;
      if (el) {
        const r = el.getBoundingClientRect();
        startY = r.top - parentRect.top + r.height / 2;
      }
      nodeYPositions.push(startY);
    });

    // 1. Draw glowing background cables
    this.nodes.forEach((node, idx) => {
      const startX = 0;
      const startY = nodeYPositions[idx];

      // Draw faint background cable
      this.ctx.save();
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      this.ctx.lineWidth = 1.5;
      this.ctx.beginPath();
      this.ctx.moveTo(startX, startY);
      this.ctx.bezierCurveTo(startX + (junctionX - startX) * 0.45, startY, startX + (junctionX - startX) * 0.65, junctionY, junctionX, junctionY);
      this.ctx.stroke();

      // Draw neon colored glowing cable
      this.ctx.strokeStyle = node.color;
      this.ctx.lineWidth = 2.0;
      this.ctx.shadowColor = node.color;
      this.ctx.shadowBlur = 10;
      this.ctx.beginPath();
      this.ctx.moveTo(startX, startY);
      this.ctx.bezierCurveTo(startX + (junctionX - startX) * 0.45, startY, startX + (junctionX - startX) * 0.65, junctionY, junctionX, junctionY);
      this.ctx.stroke();
      this.ctx.restore();
    });

    // 2. Draw Horizontal Main Bus Line from Junction into the AI Face Card
    this.ctx.save();
    this.ctx.strokeStyle = '#00e5ff';
    this.ctx.lineWidth = 2.8;
    this.ctx.shadowColor = '#00e5ff';
    this.ctx.shadowBlur = 12;
    this.ctx.beginPath();
    this.ctx.moveTo(junctionX, junctionY);
    this.ctx.lineTo(busEndX, junctionY);
    this.ctx.stroke();

    // 3. Draw Junction Node with Pulsing Concentric Rings
    const pulseRing = Math.sin(this.time * 3) * 3;
    this.ctx.fillStyle = '#00e5ff';
    this.ctx.shadowColor = '#00e5ff';
    this.ctx.shadowBlur = 14;
    this.ctx.beginPath();
    this.ctx.arc(junctionX, junctionY, 5, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.6)';
    this.ctx.lineWidth = 1.2;
    this.ctx.beginPath();
    this.ctx.arc(junctionX, junctionY, 9 + pulseRing, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.restore();

    // 4. Update and Draw Moving Energy Pulses (Packets)
    let speedMult = 1.0;
    if (this.state === 'thinking' || this.state === 'planning') speedMult = 2.5;
    else if (this.state === 'executing') speedMult = 2.0;

    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.progress += p.speed * speedMult;

      if (p.progress >= 1.3) {
        this.pulses.splice(i, 1);
        continue;
      }

      let ptX = 0;
      let ptY = 0;

      if (p.progress <= 1.0) {
        // Curve phase
        const t = p.progress;
        const startX = 0;
        const startY = nodeYPositions[p.nodeIndex];
        const cp1x = startX + (junctionX - startX) * 0.45;
        const cp1y = startY;
        const cp2x = startX + (junctionX - startX) * 0.65;
        const cp2y = junctionY;

        // Cubic bezier formula
        const invT = 1 - t;
        ptX = invT * invT * invT * startX + 3 * invT * invT * t * cp1x + 3 * invT * t * t * cp2x + t * t * t * junctionX;
        ptY = invT * invT * invT * startY + 3 * invT * invT * t * cp1y + 3 * invT * t * t * cp2y + t * t * t * junctionY;
      } else {
        // Bus phase: from junction to busEnd
        const t = (p.progress - 1.0) / 0.3;
        ptX = junctionX + (busEndX - junctionX) * t;
        ptY = junctionY;
      }

      this.ctx.save();
      this.ctx.fillStyle = '#ffffff';
      this.ctx.shadowColor = p.color;
      this.ctx.shadowBlur = 12;
      this.ctx.beginPath();
      this.ctx.arc(ptX, ptY, 3.2, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }
  }

  openDrawer(id, name, subtitle) {
    const drawer = document.getElementById('node-drawer');
    const title = document.getElementById('drawer-title');
    const content = document.getElementById('drawer-content');
    if (!drawer || !title || !content) return;

    title.textContent = `${name.toUpperCase()} INSPECTOR`;

    if (id === 'memory') {
      content.innerHTML = `
        <div style="font-size:12px; color:var(--text-secondary); margin-bottom:12px;">Active Memory &amp; System Rules (from memory.md)</div>
        <div id="memory-rules-list" style="display:flex; flex-direction:column; gap:8px;">
          <div class="drawer-card" style="padding:10px; background:rgba(0,0,0,0.3); border-radius:6px; border:1px solid rgba(255,255,255,0.08); font-size:12px;">
            <b style="color:var(--neon-cyan);">Context Anchor:</b> Windows 11 PC 2070 Cybernetic Environment.
          </div>
          <div class="drawer-card" style="padding:10px; background:rgba(0,0,0,0.3); border-radius:6px; border:1px solid rgba(255,255,255,0.08); font-size:12px;">
            <b style="color:var(--neon-cyan);">Language Mode:</b> Bilingual (Bengali &amp; English) Natural Speech.
          </div>
        </div>
      `;
    } else if (id === 'skills') {
      content.innerHTML = `
        <div style="font-size:12px; color:var(--text-secondary); margin-bottom:12px;">Authorized Windows Tools &amp; Capabilities</div>
        <div style="display:flex; flex-direction:column; gap:8px; font-size:12px;">
          <div style="padding:8px; background:rgba(0,0,0,0.3); border-radius:6px; border:1px solid rgba(255,255,255,0.08);">⚡ tool_open_app(app_name): Fast launch &amp; focus</div>
          <div style="padding:8px; background:rgba(0,0,0,0.3); border-radius:6px; border:1px solid rgba(255,255,255,0.08);">⚡ tool_place_window(app, pos): Snap &amp; arrange</div>
          <div style="padding:8px; background:rgba(0,0,0,0.3); border-radius:6px; border:1px solid rgba(255,255,255,0.08);">⚡ tool_search_web(query): DuckDuckGo &amp; Google</div>
          <div style="padding:8px; background:rgba(0,0,0,0.3); border-radius:6px; border:1px solid rgba(255,255,255,0.08);">⚡ tool_screenshot(): Screen vision &amp; OCR</div>
        </div>
      `;
    } else if (id === 'soul') {
      content.innerHTML = `
        <div style="font-size:12px; color:var(--text-secondary); margin-bottom:12px;">Autonomous Persona &amp; Core Logic</div>
        <div style="padding:10px; background:rgba(0,0,0,0.3); border-radius:6px; border:1px solid rgba(255,255,255,0.08); font-size:12px; line-height:1.6;">
          <b style="color:var(--neon-green);">Oma AI Core:</b> Polite, hyper-responsive personal assistant.
          <br>Always verifies Windows actions before reporting completion.
          <br>Multi-AI automatic failover: Claude Code ➔ Ollama Local ➔ Cloud fallback.
        </div>
      `;
    }

    drawer.classList.add('open');
  }
}

window.OmaMindMap = OmaMindMap;
