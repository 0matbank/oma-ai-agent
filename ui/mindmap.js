/**
 * Oma AI Agent - Neural Mind Map & Animated Connector Cables
 * Connects Memory, Skills, Soul, Setting to the Central Neural Core.
 */
class OmaMindMap {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.nodes = [
      { id: 'memory', name: 'Memory', subtitle: 'Facts & Context', color: '#00e5ff', glow: 'rgba(0, 229, 255, 0.4)', icon: '🧠' },
      { id: 'skills', name: 'Skills', subtitle: 'Tools & Functions', color: '#b388ff', glow: 'rgba(179, 136, 255, 0.4)', icon: '⚡' },
      { id: 'soul', name: 'Soul', subtitle: 'Persona & Logic', color: '#00f59b', glow: 'rgba(0, 245, 155, 0.4)', icon: '✨' },
      { id: 'setting', name: 'Setting', subtitle: 'System Config', color: '#ffb300', glow: 'rgba(255, 179, 0, 0.4)', icon: '⚙️' }
    ];
    this.pulses = [];
    this.time = 0;

    this.initDOM();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.animate();
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
        <div class="node-icon-box">${node.icon}</div>
        <div class="node-info">
          <span class="node-title">${node.name}</span>
          <span class="node-subtitle">${node.subtitle}</span>
        </div>
      `;

      el.addEventListener('click', () => {
        this.openDrawer(node.id);
      });

      container.appendChild(el);
    });

    // Spawn animated pulse packets
    setInterval(() => {
      const randomNode = Math.floor(Math.random() * this.nodes.length);
      this.pulses.push({
        nodeIndex: randomNode,
        progress: 0,
        speed: 0.015 + Math.random() * 0.01,
        color: this.nodes[randomNode].color
      });
    }, 450);
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.scale(dpr, dpr);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.time += 0.02;
    this.ctx.clearRect(0, 0, this.width, this.height);

    const targetX = this.width + 10;
    const targetY = this.height / 2;

    // Draw connecting cables
    this.nodes.forEach((node, idx) => {
      const el = document.getElementById(`node-${node.id}`);
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const parentRect = this.canvas.getBoundingClientRect();

      const startX = rect.right - parentRect.left;
      const startY = rect.top - parentRect.top + rect.height / 2;

      // Draw glowing cyber cable
      this.ctx.save();
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      this.ctx.lineWidth = 1.5;

      const cp1X = startX + (targetX - startX) * 0.45;
      const cp1Y = startY;
      const cp2X = startX + (targetX - startX) * 0.65;
      const cp2Y = targetY;

      this.ctx.beginPath();
      this.ctx.moveTo(startX, startY);
      this.ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, targetX, targetY);
      this.ctx.stroke();

      // Ambient neon tint
      this.ctx.strokeStyle = node.color.replace(')', ', 0.25)').replace('rgb', 'rgba');
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
      this.ctx.restore();
    });

    // Update & draw pulses
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.progress += p.speed;

      if (p.progress >= 1) {
        this.pulses.splice(i, 1);
        continue;
      }

      const node = this.nodes[p.nodeIndex];
      const el = document.getElementById(`node-${node.id}`);
      if (!el) continue;

      const rect = el.getBoundingClientRect();
      const parentRect = this.canvas.getBoundingClientRect();

      const startX = rect.right - parentRect.left;
      const startY = rect.top - parentRect.top + rect.height / 2;

      const cp1X = startX + (targetX - startX) * 0.45;
      const cp1Y = startY;
      const cp2X = startX + (targetX - startX) * 0.65;
      const cp2Y = targetY;

      const t = p.progress;
      // Cubic bezier formula: B(t) = (1-t)^3*P0 + 3(1-t)^2*t*P1 + 3(1-t)*t^2*P2 + t^3*P3
      const u = 1 - t;
      const tt = t * t;
      const uu = u * u;
      const uuu = uu * u;
      const ttt = tt * t;

      const px = uuu * startX + 3 * uu * t * cp1X + 3 * u * tt * cp2X + ttt * targetX;
      const py = uuu * startY + 3 * uu * t * cp1Y + 3 * u * tt * cp2Y + ttt * targetY;

      // Draw glowing particle pulse
      this.ctx.save();
      this.ctx.fillStyle = p.color;
      this.ctx.shadowColor = p.color;
      this.ctx.shadowBlur = 8;
      this.ctx.beginPath();
      this.ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }
  }

  openDrawer(type) {
    const drawer = document.getElementById('node-drawer');
    const title = document.getElementById('drawer-title');
    const body = document.getElementById('drawer-content');
    if (!drawer || !title || !body) return;

    drawer.classList.add('open');

    if (type === 'memory') {
      title.textContent = 'MEMORY & CONTEXT';
      title.style.color = '#00e5ff';
      body.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:12px;">
          <p>Oma remembers persistent facts about you, your workflows, and habits.</p>
          <div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:6px; border:1px solid rgba(255,255,255,0.08);">
            <b style="color:#00e5ff;">User Profile:</b>
            <div style="margin-top:4px; font-family:monospace; font-size:11.5px; color:#cbd5e1;">Name: Usman<br>Apps: Chrome, VS Code, Terminal<br>Preferred Language: Urdu / English / Bengali</div>
          </div>
          <div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:6px; border:1px solid rgba(255,255,255,0.08);">
            <b style="color:#00e5ff;">Active Directives:</b>
            <ul style="margin-left:16px; margin-top:6px; font-size:12px;">
              <li>Always execute multi-step research through Alice.</li>
              <li>Arrange windows across active displays automatically.</li>
              <li>Summarize web articles in concise bullet points.</li>
            </ul>
          </div>
        </div>
      `;
    } else if (type === 'skills') {
      title.textContent = 'INSTALLED SKILLS & TOOLS';
      title.style.color = '#b388ff';
      body.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:10px;">
          <div class="module-pill bash" style="width:fit-content;">✓ Window Control (winctl)</div>
          <p style="font-size:12px;">Move, resize, split, and focus any app across multiple monitors with zero latency.</p>

          <div class="module-pill research" style="width:fit-content;">✓ Deep Web Research</div>
          <p style="font-size:12px;">DuckDuckGo search, real-time page reading, live web synthesis.</p>

          <div class="module-pill" style="width:fit-content;">✓ Vision & OCR Screen Inspection</div>
          <p style="font-size:12px;">Analyze active window contents, UI automation buttons, and text fields.</p>

          <div class="module-pill bash" style="width:fit-content;">✓ Background Bash & PowerShell</div>
          <p style="font-size:12px;">Execute safe system commands, file navigation, and dev server launches.</p>
        </div>
      `;
    } else if (type === 'soul') {
      title.textContent = 'SOUL & PERSONALITY';
      title.style.color = '#00f59b';
      body.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:12px;">
          <p>Oma AI operates as a collaborative, proactive futuristic companion inspired by next-gen virtual operating systems.</p>
          <div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:6px; border:1px solid rgba(255,255,255,0.08);">
            <b style="color:#00f59b;">Core Persona:</b>
            <div style="margin-top:6px; font-size:12px;">Direct, confident, respectful, hyper-efficient. Speaks naturally in conversational Urdu / Hindi / English, with instant agent dispatching.</div>
          </div>
          <div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:6px; border:1px solid rgba(255,255,255,0.08);">
            <b style="color:#00f59b;">Audio Synthesis:</b>
            <div style="margin-top:6px; font-size:12px;">Active TTS voice pipeline: Natural conversational cadence, confirmation callbacks, and status reporting.</div>
          </div>
        </div>
      `;
    } else if (type === 'setting') {
      title.textContent = 'SYSTEM SETTINGS';
      title.style.color = '#ffb300';
      body.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:12px;">
          <div>
            <label style="display:block; font-size:11.5px; color:#94a3b8; margin-bottom:4px;">Global Voice Hotkey</label>
            <input type="text" value="Ctrl + Alt + Space" readonly style="width:100%; padding:6px 10px; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:#fff; font-family:monospace;">
          </div>
          <div>
            <label style="display:block; font-size:11.5px; color:#94a3b8; margin-bottom:4px;">AI Reasoning Model</label>
            <select style="width:100%; padding:6px 10px; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:#fff;">
              <option selected>Oma Neural Core (Claude 3.5 Haiku)</option>
              <option>Oma Pro (Claude 3.7 Sonnet)</option>
              <option>Gemini 2.0 Flash</option>
            </select>
          </div>
          <div>
            <label style="display:block; font-size:11.5px; color:#94a3b8; margin-bottom:4px;">Local Speech Model</label>
            <input type="text" value="Whisper Base (Local & Private)" readonly style="width:100%; padding:6px 10px; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:#fff;">
          </div>
        </div>
      `;
    }
  }

  closeDrawer() {
    const drawer = document.getElementById('node-drawer');
    if (drawer) drawer.classList.remove('open');
  }
}

window.OmaMindMap = OmaMindMap;
