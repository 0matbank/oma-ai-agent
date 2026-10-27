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
      title.textContent = 'MULTI-AI PROVIDERS & SYSTEM CONFIG';
      title.style.color = '#ffb300';
      body.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:14px;">
          <!-- Smart Routing Mode -->
          <div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:8px; border:1px solid rgba(255,179,0,0.3);">
            <b style="color:#ffb300; font-size:12px;">⚡ SMART ROUTING MODE:</b>
            <div style="margin-top:8px; display:flex; gap:6px;">
              <button id="btn-mode-auto" style="flex:1; padding:6px; border-radius:4px; font-size:11px; background:#ffb300; color:#000; font-weight:bold; border:none; cursor:pointer;">Auto Fallback</button>
              <button id="btn-mode-local" style="flex:1; padding:6px; border-radius:4px; font-size:11px; background:rgba(255,255,255,0.06); color:#fff; border:1px solid rgba(255,255,255,0.1); cursor:pointer;">Local Only</button>
            </div>
            <p style="margin-top:6px; font-size:10.5px; color:#94a3b8;">
              Auto Mode: Claude Code ➔ Local Ollama (Qwen) ➔ Cloud. Auto-switches on rate limits.
            </p>
          </div>

          <!-- Connected Providers -->
          <div style="display:flex; flex-direction:column; gap:8px;">
            <b style="font-size:12px; color:#fff;">CONNECTED AI PROVIDERS:</b>
            
            <!-- Ollama -->
            <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,245,155,0.08); padding:8px 10px; border-radius:6px; border:1px solid rgba(0,245,155,0.3);">
              <div>
                <b style="color:#00f59b; font-size:12px;">● Local Ollama (11434)</b>
                <div style="font-size:10.5px; color:#94a3b8;">Detected: qwen3-vl:8b, qwen3:8b (RTX 5060 Ti)</div>
              </div>
              <span style="font-size:10px; background:#00f59b; color:#000; padding:2px 6px; border-radius:4px; font-weight:bold;">READY</span>
            </div>

            <!-- Claude Code -->
            <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,179,0,0.08); padding:8px 10px; border-radius:6px; border:1px solid rgba(255,179,0,0.3);">
              <div>
                <b style="color:#ffb300; font-size:12px;">▲ Claude Code CLI</b>
                <div style="font-size:10.5px; color:#94a3b8;">Subscription: Claude Team (Weekly Limit resets 2am)</div>
              </div>
              <span style="font-size:10px; background:rgba(255,179,0,0.2); color:#ffb300; padding:2px 6px; border-radius:4px; font-weight:bold;">AUTO-FALLBACK</span>
            </div>

            <!-- LM Studio -->
            <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:8px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.08);">
              <div>
                <b style="color:#cbd5e1; font-size:12px;">○ LM Studio (1234)</b>
                <div style="font-size:10.5px; color:#64748b;">Localhost endpoint (Connect when server running)</div>
              </div>
              <span style="font-size:10px; background:rgba(255,255,255,0.1); color:#94a3b8; padding:2px 6px; border-radius:4px;">STANDBY</span>
            </div>
          </div>

          <!-- Shortcuts & Hardware -->
          <div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:6px; border:1px solid rgba(255,255,255,0.08);">
            <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:11.5px;">
              <span style="color:#94a3b8;">Global Voice:</span>
              <kbd style="background:#222; padding:2px 6px; border-radius:4px; color:#00e5ff; font-family:monospace;">Ctrl + Alt + Space</kbd>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:11.5px;">
              <span style="color:#94a3b8;">Inference Device:</span>
              <b style="color:#fff;">NVIDIA RTX 5060 Ti 16GB</b>
            </div>
          </div>
        </div>
      `;

      // Event listeners for routing buttons
      setTimeout(() => {
        const btnAuto = document.getElementById('btn-mode-auto');
        const btnLocal = document.getElementById('btn-mode-local');
        if (btnAuto && btnLocal) {
          btnAuto.addEventListener('click', () => {
            if (window.setMode) { window.setMode('auto'); }
            else if (window.webkit?.messageHandlers?.st) { window.webkit.messageHandlers.st.postMessage({ do: 'set', k: 'aiMode', v: 'auto' }); }
            else { try { fetch('/api/models/mode', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ mode: 'auto' }) }); } catch(e){} }
            btnAuto.style.background = '#ffb300'; btnAuto.style.color = '#000';
            btnLocal.style.background = 'rgba(255,255,255,0.06)'; btnLocal.style.color = '#fff';
          });
          btnLocal.addEventListener('click', () => {
            if (window.setMode) { window.setMode('local_only'); }
            else if (window.webkit?.messageHandlers?.st) { window.webkit.messageHandlers.st.postMessage({ do: 'set', k: 'aiMode', v: 'local_only' }); }
            else { try { fetch('/api/models/mode', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ mode: 'local_only' }) }); } catch(e){} }
            btnLocal.style.background = '#00f59b'; btnLocal.style.color = '#000';
            btnAuto.style.background = 'rgba(255,255,255,0.06)'; btnAuto.style.color = '#fff';
          });
        }
      }, 50);
    }
  }

  closeDrawer() {
    const drawer = document.getElementById('node-drawer');
    if (drawer) drawer.classList.remove('open');
  }
}

window.OmaMindMap = OmaMindMap;
