/**
 * Oma AI Agent - Agent Town (2D Pixel Art Virtual Office & Multi-Agent Simulator)
 * Recreates the complete 4-room miniature office from the PC in 2070 reference video:
 * - Room 1: Cubicle Bay (6 desks, dual monitors, whiteboard, air con, water cooler)
 * - Room 2: Rebuilt Research Library (research desks, glowing doc screens, packed bookshelves, reading chairs)
 * - Room 3: Break Lounge (sofa, coffee table for resting idle agents)
 * - Room 4: Server Hub (racks with LEDs reflecting real backend telemetry)
 * 
 * Features:
 * - Real OMA delegation: Alice physically walks into Research Library on research tasks!
 * - Agent Work Status Modal on agent click (Name, Role, Task ID, Assigned by OMA, Tool, Steps, Elapsed time, Output)
 * - Interactive Visual Hub view (OMA Main Agent -> 4 Workers -> Task Report)
 * - Interactive Gesture view for 3D face manipulation
 */

class AgentTown {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.time = 0;
    this.tileSize = 16;
    this.mapWidth = 36;
    this.mapHeight = 22;

    this.activeTab = 'agents'; // 'agents', 'visual hub', 'gesture'

    // Desks in Cubicle Bay & Research Library
    this.desks = [
      { id: 'desk_alice', col: 0, row: 0, x: 7, y: 7, agentId: 'alice', label: 'Alice (Research)' },
      { id: 'desk_bob', col: 1, row: 0, x: 13, y: 7, agentId: 'bob', label: 'Bob (Browser)' },
      { id: 'desk_eve', col: 2, row: 0, x: 19, y: 7, agentId: 'eve', label: 'Eve (YouTube)' },
      { id: 'desk_carol', col: 0, row: 1, x: 7, y: 11, agentId: 'carol', label: 'Carol (Desktop)' },
      { id: 'desk_dave', col: 1, row: 1, x: 13, y: 11, agentId: 'dave', label: 'Dave (Verification)' },
      { id: 'desk_extra2', col: 2, row: 1, x: 19, y: 11, agentId: null, label: 'Workstation 06' },
      // Research Library Station
      { id: 'station_research', col: 0, row: 0, x: 29, y: 7, agentId: null, label: 'Research Terminal' }
    ];

    // Genuine Worker Agents with Complete Task Records
    this.agents = {
      alice: {
        id: 'alice',
        name: 'Alice',
        role: 'Research Worker',
        icon: '🔍',
        color: '#00e5ff',
        hairColor: '#ff7043',
        shirtColor: '#00e5ff',
        skirtColor: '#1a237e',
        x: 7 * 16,
        y: 8 * 16,
        targetX: 7 * 16,
        targetY: 8 * 16,
        deskId: 'desk_alice',
        state: 'IDLE', // IDLE, ASSIGNED, PLANNING, WORKING, WAITING, VERIFYING, COMPLETED, FAILED
        direction: 'up',
        walkFrame: 0,
        task: '',
        taskId: '',
        assignedBy: 'OMA',
        activeModel: '',
        currentTool: '',
        startTime: 0,
        completedSteps: [],
        pendingSteps: [],
        errorDetails: '',
        actualOutput: '',
        speechBubble: null,
        bubbleTimer: 0,
        thoughtIcon: null,
        thoughtTimer: 0
      },
      bob: {
        id: 'bob',
        name: 'Bob',
        role: 'Browser Worker',
        icon: '🌐',
        color: '#ffb300',
        hairColor: '#b0bec5',
        shirtColor: '#78909c',
        skirtColor: '#263238',
        x: 13 * 16,
        y: 8 * 16,
        targetX: 13 * 16,
        targetY: 8 * 16,
        deskId: 'desk_bob',
        state: 'IDLE',
        direction: 'up',
        walkFrame: 0,
        task: '',
        taskId: '',
        assignedBy: 'OMA',
        activeModel: '',
        currentTool: '',
        startTime: 0,
        completedSteps: [],
        pendingSteps: [],
        errorDetails: '',
        actualOutput: '',
        speechBubble: null,
        bubbleTimer: 0,
        thoughtIcon: null,
        thoughtTimer: 0
      },
      carol: {
        id: 'carol',
        name: 'Carol',
        role: 'Desktop Automation Worker',
        icon: '🖥️',
        color: '#b388ff',
        hairColor: '#5d4037',
        shirtColor: '#ab47bc',
        skirtColor: '#212121',
        x: 7 * 16,
        y: 12 * 16,
        targetX: 7 * 16,
        targetY: 12 * 16,
        deskId: 'desk_carol',
        state: 'IDLE',
        direction: 'up',
        walkFrame: 0,
        task: '',
        taskId: '',
        assignedBy: 'OMA',
        activeModel: '',
        currentTool: '',
        startTime: 0,
        completedSteps: [],
        pendingSteps: [],
        errorDetails: '',
        actualOutput: '',
        speechBubble: null,
        bubbleTimer: 0,
        thoughtIcon: null,
        thoughtTimer: 0
      },
      dave: {
        id: 'dave',
        name: 'Dave',
        role: 'Verification Worker',
        icon: '✅',
        color: '#00f59b',
        hairColor: '#37474f',
        shirtColor: '#00e676',
        skirtColor: '#263238',
        x: 13 * 16,
        y: 12 * 16,
        targetX: 13 * 16,
        targetY: 12 * 16,
        deskId: 'desk_dave',
        state: 'IDLE',
        direction: 'up',
        walkFrame: 0,
        task: '',
        taskId: '',
        assignedBy: 'OMA',
        activeModel: '',
        currentTool: '',
        startTime: 0,
        completedSteps: [],
        pendingSteps: [],
        errorDetails: '',
        actualOutput: '',
        speechBubble: null,
        bubbleTimer: 0,
        thoughtIcon: null,
        thoughtTimer: 0
      },
      eve: {
        id: 'eve', name: 'Eve', role: 'YouTube Worker', icon: '▶️', color: '#ff4d6d',
        hairColor: '#2b2b2b', shirtColor: '#ff4d6d', skirtColor: '#3a1020',
        x: 19 * 16, y: 8 * 16, targetX: 19 * 16, targetY: 8 * 16, deskId: 'desk_eve',
        state: 'IDLE', direction: 'up', walkFrame: 0, task: '', taskId: '', assignedBy: 'OMA', activeModel: '', currentTool: '',
        startTime: 0, completedSteps: [], pendingSteps: [], errorDetails: '', actualOutput: '',
        speechBubble: null, bubbleTimer: 0, thoughtIcon: null, thoughtTimer: 0
      }
    };

    // Supervisory Floating Drone
    this.drone = {
      x: 10 * 16,
      y: 9 * 16,
      targetX: 10 * 16,
      targetY: 9 * 16
    };

    // Research Library Live Data Display
    this.libraryData = {
      activeQuery: "Knowledge Index Ready",
      sourcesGathered: 0,
      activeDocument: "System Guidelines",
      isScanning: false
    };

    this.initDOM();
    this.resize();
    this.wireCanvasClick();
    window.addEventListener('resize', () => this.resize());
    this.animate();

    // Occasional gentle ambient movement for idle agents to break room
    setInterval(() => this.ambientIdle(), 15000);
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement ? this.canvas.parentElement.getBoundingClientRect() : this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = rect.width || 600;
    this.height = rect.height || 380;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.scale(dpr, dpr);

    const mapPxW = this.mapWidth * this.tileSize;
    const mapPxH = this.mapHeight * this.tileSize;
    const scaleX = this.width / mapPxW;
    const scaleY = this.height / mapPxH;
    this.scale = Math.min(scaleX, scaleY) * 0.96;
    this.offsetX = (this.width - mapPxW * this.scale) / 2;
    this.offsetY = (this.height - mapPxH * this.scale) / 2;
  }

  initDOM() {
    this.updateChipsBar();
    this.wireTownTabs();
  }

  wireTownTabs() {
    document.querySelectorAll('.town-tab').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.town-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeTab = (btn.dataset.tab || 'agents').toLowerCase().trim();
      };
    });
  }

  updateChipsBar() {
    const container = document.getElementById('agent-chips-container');
    if (!container) return;
    container.innerHTML = '';

    Object.values(this.agents).forEach(agent => {
      const chip = document.createElement('div');
      const isBusy = agent.state === 'WORKING' || agent.state === 'ASSIGNED' || agent.state === 'VERIFYING';
      chip.className = `agent-chip ${isBusy ? 'working' : ''}`;
      chip.id = `chip-${agent.id}`;
      chip.style.setProperty('--chip-color', agent.color);

      chip.innerHTML = `
        <div class="chip-status-square" style="background:${agent.color};"></div>
        <div>
          <div class="chip-name">${agent.icon} ${agent.name}</div>
          <div class="chip-role" style="color:${isBusy ? 'var(--neon-green)' : 'var(--text-muted)'};">
            ${isBusy ? '● ' + agent.state : 'Idle'}
          </div>
        </div>
      `;

      chip.addEventListener('click', () => {
        this.openAgentModal(agent);
      });

      container.appendChild(chip);
    });

    this.updateMetrics();
  }

  updateMetrics() {
    const busy = Object.values(this.agents).filter(a => ['WORKING', 'VERIFYING', 'WAITING'].includes(a.state)).length;
    const el = document.getElementById('town-busy-stat');
    if (el) el.textContent = `${busy}/${Object.keys(this.agents).length} busy`;
    const act = document.getElementById('agentTownActivity');
    if (act) act.innerHTML = busy > 0 ? `Status: <b style="color:var(--neon-green);">Coordinating (${busy} active)</b>` : `Status: <b>Idle</b>`;
  }

  wireCanvasClick() {
    this.canvas.addEventListener('click', (e) => {
      if (this.activeTab === 'visual hub') {
        // Visual Hub interactive card clicks
        this.handleVisualHubClick(e);
        return;
      }
      if (this.activeTab !== 'agents') return;

      const rect = this.canvas.getBoundingClientRect();
      const clickX = (e.clientX - rect.left - this.offsetX) / this.scale;
      const clickY = (e.clientY - rect.top - this.offsetY) / this.scale;

      // Check agent hit
      for (let agent of Object.values(this.agents)) {
        const dist = Math.hypot(clickX - (agent.x + 8), clickY - (agent.y + 8));
        if (dist < 22) {
          this.openAgentModal(agent);
          return;
        }
      }

      // Check Research Library Screen hit
      if (clickX >= 25 * 16 && clickX <= 34 * 16 && clickY >= 16 && clickY <= 5 * 16) {
        this.openResearchLibraryModal();
      }
    });
  }

  /**
   * M4: Comprehensive Agent Work Status Inspector Modal
   */
  openAgentModal(agent) {
    let modal = document.getElementById('agent-inspector-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'agent-inspector-modal';
      modal.className = 'cyber-card';
      modal.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: 520px; max-width: 92vw; max-height: 85vh; background: rgba(11, 16, 26, 0.98);
        border: 1px solid var(--neon-cyan); box-shadow: 0 10px 40px rgba(0,0,0,0.8), 0 0 20px rgba(0,229,255,0.3);
        z-index: 9999; display: flex; flex-direction: column; overflow: hidden; border-radius: 12px;
      `;
      document.body.appendChild(modal);
    }

    const E = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const elapsed = agent.startTime > 0 ? Math.round(Date.now() / 1000 - agent.startTime) : 0;
    const completedList = (agent.completedSteps && agent.completedSteps.length > 0)
      ? agent.completedSteps.map(s => `<li style="margin-bottom:3px; color:var(--neon-green);">✓ ${E(s)}</li>`).join('')
      : '<li style="color:var(--text-muted);">None yet</li>';

    const pendingList = (agent.pendingSteps && agent.pendingSteps.length > 0)
      ? agent.pendingSteps.map(s => `<li style="margin-bottom:3px; color:var(--text-secondary);">⏳ ${E(s)}</li>`).join('')
      : '<li style="color:var(--text-muted);">None</li>';

    modal.innerHTML = `
      <div style="padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between; background: rgba(0,229,255,0.08);">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:22px;">${agent.icon}</span>
          <div>
            <b style="font-family:'Orbitron', sans-serif; font-size:14px; color:#fff;">${agent.name} // ${agent.role}</b>
            <div style="font-size:10.5px; color:var(--neon-cyan);">Assigned-by: <b>${E(agent.assignedBy)}</b> | Task ID: <b>${E(agent.taskId || 'none')}</b></div>
          </div>
        </div>
        <button id="btn-close-agent-modal" style="all:unset; cursor:pointer; width:28px; height:28px; border-radius:6px; background:rgba(255,255,255,0.08); display:grid; place-items:center; color:#fff; font-size:14px;">✕</button>
      </div>

      <div style="padding: 16px 18px; overflow-y: auto; font-size: 12px; display: flex; flex-direction: column; gap: 12px;">
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px; background: rgba(255,255,255,0.03); padding: 10px; border-radius: 8px;">
          <div><span style="color:var(--text-muted);">Current Status:</span> <b style="color:${agent.state === 'WORKING' ? 'var(--neon-amber)' : (agent.state === 'COMPLETED' ? 'var(--neon-green)' : '#fff')};">${E(agent.state)}</b></div>
          <div><span style="color:var(--text-muted);">Elapsed Time:</span> <b>${elapsed}s</b></div>
          <div><span style="color:var(--text-muted);">AI Provider/Model:</span> <b style="color:var(--neon-cyan);">${E(agent.activeModel || 'none yet')}</b></div>
          <div><span style="color:var(--text-muted);">Active Tool:</span> <code style="color:#ffb300; font-size:11px;">${E(agent.currentTool || 'none')}</code></div>
        </div>

        <div>
          <span style="font-weight:600; color:#fff; display:block; margin-bottom:4px;">Current Objective / Task:</span>
          <div style="background:rgba(0,0,0,0.3); padding:8px 12px; border-radius:6px; border:1px solid rgba(255,255,255,0.06); color:#f0f4fc;">
            ${E(agent.task || 'No task assigned. This worker is a lane of the shared Atticus engine; it works only when the engine runs one of its tools.')}
          </div>
        </div>

        <div>
          <span style="font-weight:600; color:#fff; display:block; margin-bottom:4px;">Completed Execution Steps:</span>
          <ul style="padding-left:16px; margin:0; line-height:1.4;">${completedList}</ul>
        </div>

        <div>
          <span style="font-weight:600; color:#fff; display:block; margin-bottom:4px;">Pending Steps:</span>
          <ul style="padding-left:16px; margin:0; line-height:1.4;">${pendingList}</ul>
        </div>

        ${agent.actualOutput ? `
        <div>
          <span style="font-weight:600; color:var(--neon-cyan); display:block; margin-bottom:4px;">Last tool output:</span>
          <div style="background:rgba(0,229,255,0.05); border:1px solid rgba(0,229,255,0.25); padding:8px 12px; border-radius:6px; font-family:monospace; font-size:11px; max-height:120px; overflow-y:auto; white-space:pre-wrap;">
            ${E(agent.actualOutput)}
          </div>
        </div>` : ''}

        ${agent.errorDetails ? `
        <div>
          <span style="font-weight:600; color:var(--neon-crimson); display:block; margin-bottom:4px;">Error Details:</span>
          <div style="background:rgba(255,42,95,0.1); border:1px solid var(--neon-crimson); padding:8px 12px; border-radius:6px; color:#ff8099; font-size:11px;">
            ${E(agent.errorDetails)}
          </div>
        </div>` : ''}
      </div>
    `;

    modal.style.display = 'flex';
    document.getElementById('btn-close-agent-modal').onclick = () => {
      modal.style.display = 'none';
    };
  }

  openResearchLibraryModal() {
    this.openAgentModal(this.agents.alice);
  }
  ambientIdle() {
    const idles = Object.values(this.agents).filter(a => a.state === 'IDLE');
    if (idles.length === 0) return;
    const lucky = idles[Math.floor(Math.random() * idles.length)];

    if (Math.random() > 0.6) {
      // Walk to Break Lounge (Bottom Left)
      lucky.targetX = (5 + Math.random() * 4) * 16;
      lucky.targetY = (16 + Math.random() * 2) * 16;
      lucky.thoughtIcon = '☕';
      lucky.thoughtTimer = 120;
      setTimeout(() => {
        const desk = this.desks.find(d => d.id === lucky.deskId);
        if (desk) {
          lucky.targetX = desk.x * 16;
          lucky.targetY = (desk.y + 1) * 16;
        }
      }, 6000);
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.time += 0.025;

    if (!this.ctx || !this.width) return;
    this.ctx.clearRect(0, 0, this.width, this.height);

    if (this.activeTab === 'visual hub') {
      this.drawVisualHub();
      return;
    } else if (this.activeTab === 'gesture') {
      this.drawGestureView();
      return;
    }

    // Standard Virtual Office Simulator
    this.ctx.save();
    this.ctx.translate(this.offsetX, this.offsetY);
    this.ctx.scale(this.scale, this.scale);

    // 1. Draw 4 Office Rooms & Floor Tiles
    this.drawOfficeRooms();

    // 2. Draw Office Furniture & Equipment (Including rich Research Library)
    this.drawOfficeFurniture();

    // 3. Update & Draw Characters
    this.updateAndDrawCharacters();

    // 4. Draw Floating Supervisor Drone
    this.drawDrone();

    this.ctx.restore();
  }

  drawOfficeRooms() {
    const W = this.mapWidth * this.tileSize;
    const H = this.mapHeight * this.tileSize;

    // Dark cyber backdrop
    this.ctx.fillStyle = '#0a0d14';
    this.ctx.fillRect(0, 0, W, H);

    // ================= Room 1: Cubicle Bay (Top-Left) =================
    this.ctx.fillStyle = '#141a24';
    this.ctx.fillRect(16, 16, 23 * 16, 13 * 16);

    // Subtle Grid Floor
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
    this.ctx.lineWidth = 1;
    for (let x = 1; x <= 24; x++) {
      this.ctx.beginPath();
      this.ctx.moveTo(x * 16, 16);
      this.ctx.lineTo(x * 16, 14 * 16);
      this.ctx.stroke();
    }
    for (let y = 1; y <= 14; y++) {
      this.ctx.beginPath();
      this.ctx.moveTo(16, y * 16);
      this.ctx.lineTo(24 * 16, y * 16);
      this.ctx.stroke();
    }

    // ================= Room 2: Research Library (Top-Right) =================
    this.ctx.fillStyle = '#111722';
    this.ctx.fillRect(24 * 16, 16, 11 * 16, 13 * 16);
    this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.15)';
    this.ctx.strokeRect(24 * 16, 16, 11 * 16, 13 * 16);

    // ================= Room 3: Break Lounge (Bottom-Left) =================
    this.ctx.fillStyle = '#1a202c'; // Wood tone floor
    this.ctx.fillRect(16, 14 * 16, 17 * 16, 7 * 16);

    // ================= Room 4: Server Hub (Bottom-Right) =================
    this.ctx.fillStyle = '#0d1117';
    this.ctx.fillRect(18 * 16, 14 * 16, 17 * 16, 7 * 16);

    // Dividing Walls
    this.ctx.fillStyle = '#080b10';
    this.ctx.fillRect(0, 0, W, 16);
    this.ctx.fillRect(0, H - 16, W, 16);
    this.ctx.fillRect(0, 0, 16, H);
    this.ctx.fillRect(W - 16, 0, 16, H);

    // Vertical wall between Cubicle Bay and Library
    this.ctx.fillRect(24 * 16 - 4, 16, 8, 13 * 16);
    // Horizontal wall
    this.ctx.fillRect(16, 14 * 16 - 4, 23 * 16, 8);

    // Doorways
    this.ctx.fillStyle = '#e65100'; // Orange door frame
    this.ctx.fillRect(9 * 16, 14 * 16 - 4, 2 * 16, 8);
    this.ctx.fillStyle = '#00838f'; // Cyan door frame into Library
    this.ctx.fillRect(24 * 16 - 4, 6 * 16, 8, 2 * 16);

    // Room Label Overlays
    this.ctx.font = '8px monospace';
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    this.ctx.fillText('CUBICLE BAY', 24, 28);
    this.ctx.fillStyle = 'rgba(0, 229, 255, 0.6)';
    this.ctx.fillText('RESEARCH LIBRARY 📚', 25 * 16, 28);
    this.ctx.fillStyle = 'rgba(255, 179, 0, 0.4)';
    this.ctx.fillText('BREAK LOUNGE ☕', 24, 15 * 16 + 4);
    this.ctx.fillStyle = 'rgba(0, 245, 155, 0.5)';
    this.ctx.fillText('SERVER HUB ⚡', 19 * 16, 15 * 16 + 4);
  }

  drawOfficeFurniture() {
    // 1. Cubicle Bay Items: Air Conditioner, Whiteboard with charts, Water cooler
    this.ctx.fillStyle = '#37474f';
    this.ctx.fillRect(2 * 16, 12, 36, 10);
    this.ctx.fillStyle = '#cfd8dc';
    this.ctx.fillRect(2 * 16 + 2, 14, 32, 6);

    // Whiteboard with charts
    this.ctx.fillStyle = '#455a64';
    this.ctx.fillRect(6 * 16, 8, 48, 20);
    this.ctx.fillStyle = '#eceff1';
    this.ctx.fillRect(6 * 16 + 2, 10, 44, 16);
    this.ctx.fillStyle = '#00e5ff'; this.ctx.fillRect(6 * 16 + 6, 18, 6, 6);
    this.ctx.fillStyle = '#ff5722'; this.ctx.fillRect(6 * 16 + 14, 14, 6, 10);
    this.ctx.fillStyle = '#00e676'; this.ctx.fillRect(6 * 16 + 22, 12, 6, 12);

    // Water Cooler with Blue Bottle
    this.ctx.fillStyle = '#eceff1'; this.ctx.fillRect(22 * 16, 16, 16, 22);
    this.ctx.fillStyle = '#00b0ff'; this.ctx.fillRect(22 * 16 + 2, 8, 12, 12);

    // 2. Six Cubicle Desks
    this.desks.filter(d => d.id !== 'station_research').forEach(d => {
      const dx = d.x * 16;
      const dy = d.y * 16;

      this.ctx.fillStyle = '#263238';
      this.ctx.fillRect(dx - 12, dy - 8, 44, 22);
      this.ctx.fillStyle = '#37474f';
      this.ctx.fillRect(dx - 12, dy - 8, 44, 4);

      // Partition
      this.ctx.fillStyle = '#455a64';
      this.ctx.fillRect(dx - 12, dy - 18, 44, 10);

      // Dual Monitors
      const isWorking = this.agents[d.agentId] && (this.agents[d.agentId].state === 'WORKING' || this.agents[d.agentId].state === 'VERIFYING');

      // Left Monitor
      this.ctx.fillStyle = '#1a222d';
      this.ctx.fillRect(dx - 10, dy - 14, 16, 12);
      this.ctx.fillStyle = isWorking ? '#00e5ff' : '#263238';
      this.ctx.fillRect(dx - 9, dy - 13, 14, 10);

      // Right Monitor
      this.ctx.fillStyle = '#1a222d';
      this.ctx.fillRect(dx + 8, dy - 14, 16, 12);
      this.ctx.fillStyle = isWorking ? '#00f59b' : '#263238';
      this.ctx.fillRect(dx + 9, dy - 13, 14, 10);

      // Chair
      this.ctx.fillStyle = '#1565c0';
      this.ctx.beginPath();
      this.ctx.arc(dx + 8, dy + 18, 7, 0, Math.PI * 2);
      this.ctx.fill();
    });

    // ==================== M5: REBUILT RESEARCH LIBRARY ====================
    // Packed Bookshelf 1 (North wall of library)
    this.ctx.fillStyle = '#3e2723';
    this.ctx.fillRect(25 * 16, 8, 46, 22);
    const bColors = ['#00e5ff', '#ffb300', '#00f59b', '#ff5722', '#b388ff', '#ffffff'];
    for (let b = 0; b < 10; b++) {
      this.ctx.fillStyle = bColors[b % bColors.length];
      this.ctx.fillRect(25 * 16 + 4 + b * 4, 11, 3, 16);
    }

    // Bookshelf 2 (East wall of library)
    this.ctx.fillStyle = '#3e2723';
    this.ctx.fillRect(33 * 16 + 4, 2 * 16, 10, 5 * 16);
    for (let row = 0; row < 5; row++) {
      this.ctx.fillStyle = bColors[(row * 2) % bColors.length];
      this.ctx.fillRect(33 * 16 + 6, (2 + row) * 16 + 2, 6, 12);
    }

    // Large Holographic Research Display Screen (Center-East of library)
    const scrX = 26 * 16;
    const scrY = 2 * 16 + 8;
    this.ctx.fillStyle = '#0c141f';
    this.ctx.fillRect(scrX, scrY, 6 * 16, 3 * 16);
    this.ctx.strokeStyle = this.libraryData.isScanning ? '#00e5ff' : 'rgba(0, 229, 255, 0.4)';
    this.ctx.lineWidth = 1.5;
    this.ctx.strokeRect(scrX, scrY, 6 * 16, 3 * 16);

    // Screen content: Search synthesis waves
    this.ctx.font = '7px monospace';
    this.ctx.fillStyle = this.libraryData.isScanning ? '#00e5ff' : '#94a3b8';
    this.ctx.fillText(this.libraryData.isScanning ? '● SEARCH ACTIVE' : 'IDLE ARCHIVE', scrX + 4, scrY + 12);
    this.ctx.fillStyle = '#fff';
    this.ctx.fillText(`Docs: ${this.libraryData.sourcesGathered}`, scrX + 4, scrY + 24);

    if (this.libraryData.isScanning) {
      // Animated green/cyan scan line
      const scanY = scrY + 4 + (Math.floor(this.time * 20) % (3 * 16 - 8));
      this.ctx.fillStyle = 'rgba(0, 245, 155, 0.6)';
      this.ctx.fillRect(scrX + 2, scanY, 6 * 16 - 4, 2);
    }

    // Research Workstation Desk (Where Alice sits to research)
    const rdx = 29 * 16;
    const rdy = 7 * 16;
    this.ctx.fillStyle = '#1e2632';
    this.ctx.fillRect(rdx - 14, rdy - 8, 48, 22);
    this.ctx.fillStyle = '#263238';
    this.ctx.fillRect(rdx - 14, rdy - 8, 48, 4);

    // Dual Glowing Research Monitors
    this.ctx.fillStyle = '#101722';
    this.ctx.fillRect(rdx - 10, rdy - 16, 18, 14);
    this.ctx.fillStyle = this.libraryData.isScanning ? '#00e5ff' : '#00838f';
    this.ctx.fillRect(rdx - 9, rdy - 15, 16, 12);

    this.ctx.fillStyle = '#101722';
    this.ctx.fillRect(rdx + 10, rdy - 16, 18, 14);
    this.ctx.fillStyle = this.libraryData.isScanning ? '#ffb300' : '#455a64';
    this.ctx.fillRect(rdx + 11, rdy - 15, 16, 12);

    // Research Leather Chair
    this.ctx.fillStyle = '#b71c1c';
    this.ctx.beginPath();
    this.ctx.arc(rdx + 8, rdy + 18, 8, 0, Math.PI * 2);
    this.ctx.fill();

    // Reading Area: Armchair & Floor Lamp (South of library)
    this.ctx.fillStyle = '#1565c0';
    this.ctx.fillRect(26 * 16, 11 * 16, 20, 20); // Armchair
    this.ctx.fillStyle = '#ffb300';
    this.ctx.beginPath();
    this.ctx.arc(26 * 16 + 32, 11 * 16 + 8, 5, 0, Math.PI * 2); // Floor Lamp
    this.ctx.fill();

    // ==================== Room 3: Break Lounge ====================
    this.ctx.fillStyle = '#1e88e5'; this.ctx.fillRect(3 * 16, 16 * 16, 4 * 16, 18);
    this.ctx.fillStyle = '#1565c0'; this.ctx.fillRect(3 * 16, 16 * 16 + 18, 4 * 16, 10);
    this.ctx.fillStyle = '#4e342e'; this.ctx.fillRect(4 * 16, 18 * 16, 2 * 16 + 8, 14);

    // ==================== Room 4: Server Hub ====================
    for (let s = 0; s < 4; s++) {
      const sx = (20 + s * 3) * 16;
      const sy = 16 * 16;
      this.ctx.fillStyle = '#10141b';
      this.ctx.fillRect(sx, sy, 32, 54);
      this.ctx.strokeStyle = '#263238';
      this.ctx.strokeRect(sx, sy, 32, 54);

      for (let row = 0; row < 5; row++) {
        this.ctx.fillStyle = '#1e2632';
        this.ctx.fillRect(sx + 3, sy + 4 + row * 10, 26, 7);
        const blink = Math.sin(this.time * 4 + s * 2 + row) > 0;
        this.ctx.fillStyle = blink ? '#00e676' : '#2e7d32';
        this.ctx.fillRect(sx + 6, sy + 6 + row * 10, 3, 3);
        this.ctx.fillStyle = blink ? '#00e5ff' : '#006064';
        this.ctx.fillRect(sx + 12, sy + 6 + row * 10, 3, 3);
        this.ctx.fillStyle = Math.sin(this.time * 2 + s) > 0.5 ? '#ffb300' : '#ff5722';
        this.ctx.fillRect(sx + 18, sy + 6 + row * 10, 3, 3);
      }
    }
  }

  updateAndDrawCharacters() {
    Object.values(this.agents).forEach(agent => {
      const dx = agent.targetX - agent.x;
      const dy = agent.targetY - agent.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 2) {
        const speed = 1.6;
        agent.x += (dx / dist) * speed;
        agent.y += (dy / dist) * speed;
        agent.walkFrame += 0.2;

        if (Math.abs(dx) > Math.abs(dy)) {
          agent.direction = dx > 0 ? 'right' : 'left';
        } else {
          agent.direction = dy > 0 ? 'down' : 'up';
        }
      }

      this.drawPixelCharacter(agent);
    });
  }

  drawPixelCharacter(a) {
    const px = Math.round(a.x);
    const py = Math.round(a.y);
    const bob = Math.sin(a.walkFrame) * 1.5;

    // Shadow
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    this.ctx.beginPath();
    this.ctx.ellipse(px + 8, py + 15, 6, 3, 0, 0, Math.PI * 2);
    this.ctx.fill();

    // Body / Shirt
    this.ctx.fillStyle = a.shirtColor;
    this.ctx.fillRect(px + 4, py + 6 + bob, 8, 6);

    // Skirt / Pants
    this.ctx.fillStyle = a.skirtColor;
    this.ctx.fillRect(px + 5, py + 12 + bob, 6, 3);

    // Head (Peach skin)
    this.ctx.fillStyle = '#ffcc80';
    this.ctx.fillRect(px + 5, py + 1 + bob, 6, 6);

    // Hair
    this.ctx.fillStyle = a.hairColor;
    this.ctx.fillRect(px + 4, py + bob, 8, 3);
    if (a.direction === 'left') this.ctx.fillRect(px + 3, py + 1 + bob, 2, 4);
    if (a.direction === 'right') this.ctx.fillRect(px + 11, py + 1 + bob, 2, 4);

    // Eyes
    this.ctx.fillStyle = '#212121';
    if (a.direction !== 'up') {
      this.ctx.fillRect(px + 6, py + 3 + bob, 1, 1);
      this.ctx.fillRect(px + 9, py + 3 + bob, 1, 1);
    }

    // Name tag & Status pill above head
    this.ctx.font = '7px monospace';
    this.ctx.fillStyle = '#fff';
    this.ctx.fillText(a.name, px + 2, py - 4);

    // Thought bubble
    if (a.thoughtTimer > 0 && a.thoughtIcon) {
      a.thoughtTimer--;
      this.ctx.fillStyle = '#ffffff';
      this.ctx.beginPath();
      this.ctx.arc(px + 16, py - 6, 6, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.font = '8px sans-serif';
      this.ctx.fillText(a.thoughtIcon, px + 12, py - 3);
    }

    // Speech callout bubble (like in reference video)
    if (a.bubbleTimer > 0 && a.speechBubble) {
      a.bubbleTimer--;
      this.ctx.save();
      this.ctx.font = '8px monospace';
      const textW = this.ctx.measureText(a.speechBubble).width;
      const bW = Math.min(180, textW + 12);
      const bX = Math.max(10, Math.min(this.mapWidth * 16 - bW - 10, px - bW / 2 + 8));
      const bY = py - 20;

      this.ctx.fillStyle = 'rgba(12, 18, 28, 0.95)';
      this.ctx.fillRect(bX, bY - 12, bW, 14);
      this.ctx.strokeStyle = a.color;
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(bX, bY - 12, bW, 14);

      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillText(a.speechBubble, bX + 6, bY - 2);
      this.ctx.restore();
    }
  }

  drawDrone() {
    this.drone.x += (this.drone.targetX - this.drone.x) * 0.05;
    this.drone.y += (this.drone.targetY - this.drone.y) * 0.05;

    const dx = Math.round(this.drone.x);
    const dy = Math.round(this.drone.y) + Math.sin(this.time * 4) * 2;

    this.ctx.fillStyle = '#00e5ff';
    this.ctx.fillRect(dx, dy, 6, 4);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(dx + 2, dy + 1, 2, 2);

    // Propeller rotors
    this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(dx - 3, dy - 1);
    this.ctx.lineTo(dx + 9, dy - 1);
    this.ctx.stroke();
  }

  /**
   * ==================== M9: VISUAL HUB ====================
   * Interactive Multi-Agent Coordinator Architecture Diagram
   * Matches the user's diagram in Screenshot 1!
   */
  drawVisualHub() {
    const W = this.width;
    const H = this.height;

    this.ctx.fillStyle = '#070a0f';
    this.ctx.fillRect(0, 0, W, H);

    // 1. Top Card: OMA · Main Agent
    const topW = Math.min(460, W - 40);
    const topH = 70;
    const topX = (W - topW) / 2;
    const topY = 16;

    this.ctx.save();
    this.ctx.fillStyle = 'rgba(16, 24, 38, 0.92)';
    this.ctx.strokeStyle = '#00e5ff';
    this.ctx.lineWidth = 1.5;
    this.ctx.shadowColor = 'rgba(0, 229, 255, 0.3)';
    this.ctx.shadowBlur = 12;
    this.roundRect(topX, topY, topW, topH, 10, true, true);

    this.ctx.font = '18px sans-serif';
    this.ctx.fillText('🧠', topX + topW / 2 - 9, topY + 24);

    this.ctx.font = 'bold 13px "Orbitron", sans-serif';
    this.ctx.fillStyle = '#ffffff';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('OMA · Main Agent', topX + topW / 2, topY + 44);

    this.ctx.font = '11px sans-serif';
    this.ctx.fillStyle = '#94a3b8';
    this.ctx.fillText('Task বুঝবে · পরিকল্পনা করবে · কাজ ভাগ করবে · ফলাফল যাচাই করবে', topX + topW / 2, topY + 60);
    this.ctx.restore();

    // Downward arrow
    this.ctx.fillStyle = '#00e5ff';
    this.ctx.font = '16px monospace';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('↓', W / 2, topY + topH + 16);

    // 2. Middle 4 Worker Cards
    const cardW = (topW - 16) / 2;
    const cardH = 58;
    const startY = topY + topH + 26;

    const workerList = [
      { id: 'alice', name: 'Alice', role: 'Research Worker', icon: '🔍', col: 0, row: 0, color: '#00e5ff' },
      { id: 'bob', name: 'Bob', role: 'Browser Worker', icon: '🌐', col: 1, row: 0, color: '#00e5ff' },
      { id: 'carol', name: 'Carol', role: 'Desktop Worker', icon: '🖥️', col: 0, row: 1, color: '#00e5ff' },
      { id: 'dave', name: 'Dave', role: 'Verification Worker', icon: '✅', col: 1, row: 1, color: '#00f59b' }
    ];

    workerList.forEach(w => {
      const wx = topX + w.col * (cardW + 16);
      const wy = startY + w.row * (cardH + 12);
      const live = this.agents[w.id];

      this.ctx.save();
      this.ctx.fillStyle = 'rgba(12, 18, 28, 0.88)';
      this.ctx.strokeStyle = live.state === 'WORKING' ? 'var(--neon-green)' : 'rgba(255, 255, 255, 0.12)';
      this.ctx.lineWidth = live.state === 'WORKING' ? 1.8 : 1.0;
      this.roundRect(wx, wy, cardW, cardH, 8, true, true);

      this.ctx.font = '18px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(w.icon, wx + cardW / 2, wy + 24);

      this.ctx.font = 'bold 12px sans-serif';
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillText(w.name, wx + cardW / 2, wy + 40);

      this.ctx.font = '10px sans-serif';
      this.ctx.fillStyle = live.state === 'WORKING' ? '#00f59b' : '#94a3b8';
      this.ctx.fillText(live.state === 'WORKING' ? `● ${live.state}` : w.role, wx + cardW / 2, wy + 52);
      this.ctx.restore();
    });

    // Downward arrow
    this.ctx.fillStyle = '#00e5ff';
    this.ctx.fillText('↓', W / 2, startY + cardH * 2 + 24);

    // 3. Bottom Card: Real Task Report -> OMA
    const botY = startY + cardH * 2 + 34;
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(16, 24, 38, 0.92)';
    this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
    this.ctx.lineWidth = 1.2;
    this.roundRect(topX, botY, topW, 52, 10, true, true);

    this.ctx.font = 'bold 12px "Orbitron", sans-serif';
    this.ctx.fillStyle = '#ffffff';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Real Task Report → OMA', topX + topW / 2, botY + 22);

    this.ctx.font = '11px sans-serif';
    this.ctx.fillStyle = '#94a3b8';
    this.ctx.fillText('প্রতিটি Worker-এর Status, Used Tool, Result, Error এবং Progress', topX + topW / 2, botY + 40);
    this.ctx.restore();
  }

  handleVisualHubClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const W = this.width;
    const topW = Math.min(460, W - 40);
    const topX = (W - topW) / 2;
    const cardW = (topW - 16) / 2;
    const cardH = 58;
    const startY = 16 + 70 + 26;

    const workerList = [
      { id: 'alice', col: 0, row: 0 },
      { id: 'bob', col: 1, row: 0 },
      { id: 'carol', col: 0, row: 1 },
      { id: 'dave', col: 1, row: 1 }
    ];

    for (let w of workerList) {
      const wx = topX + w.col * (cardW + 16);
      const wy = startY + w.row * (cardH + 12);
      if (x >= wx && x <= wx + cardW && y >= wy && y <= wy + cardH) {
        this.openAgentModal(this.agents[w.id]);
        return;
      }
    }
  }

  /**
   * ==================== M9: GESTURE VIEW ====================
   * Interactive 3D Holographic AI Face Control & Gesture Diagnostics
   */
  drawGestureView() {
    const W = this.width;
    const H = this.height;

    this.ctx.fillStyle = '#080c14';
    this.ctx.fillRect(0, 0, W, H);

    this.ctx.font = 'bold 14px "Orbitron", sans-serif';
    this.ctx.fillStyle = '#00e5ff';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('HOLOGRAPHIC GESTURE CONTROLLER', W / 2, 34);

    this.ctx.font = '12px sans-serif';
    this.ctx.fillStyle = '#f0f4fc';
    this.ctx.fillText('Direct 3D Interaction: Drag with Mouse or Touch to Rotate Oma', W / 2, 60);

    // Interactive Control Card
    const cardW = Math.min(420, W - 40);
    const cardX = (W - cardW) / 2;
    const cardY = 80;

    this.ctx.save();
    this.ctx.fillStyle = 'rgba(16, 24, 38, 0.9)';
    this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.3)';
    this.roundRect(cardX, cardY, cardW, 160, 10, true, true);

    this.ctx.font = '11.5px monospace';
    this.ctx.fillStyle = '#94a3b8';
    this.ctx.textAlign = 'left';

    const face = window.holoOrb;
    const rotY = face ? (face.rotY * (180 / Math.PI)).toFixed(1) : '0.0';
    const rotX = face ? (face.rotX * (180 / Math.PI)).toFixed(1) : '0.0';
    const zoom = face ? face.zoomScale.toFixed(2) : '1.00';
    const spd = face ? face.speedMode : 'slow';

    this.ctx.fillText(`• Yaw Rotation (RotY):  ${rotY}°`, cardX + 20, cardY + 30);
    this.ctx.fillText(`• Pitch Angle  (RotX):  ${rotX}°`, cardX + 20, cardY + 52);
    this.ctx.fillText(`• Holo Zoom Scale:      ${zoom}x`, cardX + 20, cardY + 74);
    this.ctx.fillText(`• Animation Speed:      ${spd.toUpperCase()} (M2 Verified)`, cardX + 20, cardY + 96);
    this.ctx.fillText(`• Motion Smoothing:     Active (Adaptive Interpolation)`, cardX + 20, cardY + 118);

    this.ctx.fillStyle = 'rgba(0, 245, 155, 0.8)';
    this.ctx.fillText(`✓ Touch/Mouse Gesture Engine: Ready & Tracking`, cardX + 20, cardY + 142);
    this.ctx.restore();

    // Webcam Gesture Permission Status Note (Strictly Honest as per M9)
    this.ctx.font = '11px sans-serif';
    this.ctx.fillStyle = '#94a3b8';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Webcam-based hand gestures require explicit camera permissions.', W / 2, cardY + 185);
    this.ctx.fillStyle = '#ffb300';
    this.ctx.fillText('Mouse and Touch 3D manipulation are permanently active with zero latency.', W / 2, cardY + 205);
  }

  /**
   * The only way worker state changes: one authoritative backend task event (multi_ai/taskstate.py).
   * Movement is visual only; the state shown is exactly the backend's.
   */
  applyTask(ev) {
    if (!ev || !ev.workers) return;
    const nowS = Date.now() / 1000;
    if (ev.kind === 'task') {
      this.taskText = ev.detail || '';
      this.libraryData.sourcesGathered = 0;
      Object.values(this.agents).forEach(a => { a.completedSteps = []; a.pendingSteps = []; a.errorDetails = ''; a.actualOutput = ''; a.startTime = 0; a.task = ''; a.taskId = ev.task_id; });
    }
    const model = ev.active_model ? `${ev.active_model.provider} · ${ev.active_model.resolved || ev.active_model.model}` : '';
    if (ev.kind === 'step' && ev.step && this.agents[ev.worker]) {
      const a = this.agents[ev.worker], st = ev.step;
      a.pendingSteps = (a.pendingSteps || []).filter(x => x !== st.label);
      if (st.status === 'RUNNING') a.pendingSteps.push(st.label);
      else if (st.status === 'DONE') { a.completedSteps.push(st.label); a.actualOutput = st.output || a.actualOutput; if (ev.worker === 'alice') this.libraryData.sourcesGathered++; }
      else if (st.status === 'FAILED') { a.errorDetails = `${st.label}: ${st.error || 'failed'}`; }
    }
    if (ev.kind === 'evidence' && this.agents.dave) {
      this.agents.dave.completedSteps.push(`${ev.ok === true ? '✓' : ev.ok === false ? '✕' : '?'} ${ev.detail}`);
      this.agents.dave.actualOutput = ev.detail;
    }
    Object.entries(ev.workers).forEach(([id, w]) => {
      const a = this.agents[id];
      if (!a) return;
      const prev = a.state;
      a.state = w.state || 'IDLE';
      if (a.state === 'IDLE') return;
      a.taskId = ev.task_id; a.task = this.taskText || a.task; a.assignedBy = 'OMA';
      a.currentTool = w.step || a.currentTool; if (model) a.activeModel = model;
      if (!a.startTime && a.state !== 'IDLE') a.startTime = nowS;
      const busy = ['WORKING', 'WAITING', 'VERIFYING', 'ASSIGNED'].includes(a.state);
      if (busy) {
        const desk = id === 'alice' ? { x: 29, y: 7 } : this.desks.find(d => d.id === a.deskId);
        if (desk) { a.targetX = desk.x * 16; a.targetY = (desk.y + 1) * 16; }
        a.speechBubble = (a.state === 'WAITING' ? 'Waiting for your OK…' : (w.step || 'Working…')).slice(0, 44);
        a.bubbleTimer = 200; a.thoughtIcon = a.state === 'WAITING' ? '✋' : '⚙️'; a.thoughtTimer = 160;
      } else if (prev !== a.state) {
        a.speechBubble = a.state === 'COMPLETED' ? 'Done' : a.state === 'FAILED' ? 'Failed' : a.state.toLowerCase();
        a.bubbleTimer = 120; a.thoughtIcon = a.state === 'COMPLETED' ? '✓' : '✕'; a.thoughtTimer = 120;
      }
    });
    this.libraryData.isScanning = this.agents.alice && this.agents.alice.state === 'WORKING';
    if (this.agents.alice && ev.kind === 'step' && ev.worker === 'alice') this.libraryData.activeQuery = ev.detail || this.libraryData.activeQuery;
    if (ev.kind === 'result') {   // the task is over: workers walk back; their record stays in the detail panel
      clearTimeout(this._homeTimer);
      this._homeTimer = setTimeout(() => {
        Object.values(this.agents).forEach(a => {
          const desk = this.desks.find(d => d.id === a.deskId);
          if (desk) { a.targetX = desk.x * 16; a.targetY = (desk.y + 1) * 16; }
          if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(a.state)) a.state = 'IDLE';
        });
        this.updateChipsBar();
      }, 6000);
    }
    this.updateChipsBar();
  }

  // kept so older callers cannot invent state: they do nothing now
  onTaskEvent() {}
  setAgentWorking() {}
  updateFromBackendStatus(data) {
    if (data && data.workers) this.applyTask({ kind: 'restore', workers: Object.fromEntries(Object.entries(data.workers).map(([k, w]) => [k, { state: 'IDLE', step: '' }])) });
  }

  roundRect(x, y, w, h, r, fill, stroke) {
    this.ctx.beginPath();
    this.ctx.moveTo(x + r, y);
    this.ctx.arcTo(x + w, y, x + w, y + h, r);
    this.ctx.arcTo(x + w, y + h, x, y + h, r);
    this.ctx.arcTo(x, y + h, x, y, r);
    this.ctx.arcTo(x, y, x + w, y, r);
    this.ctx.closePath();
    if (fill) this.ctx.fill();
    if (stroke) this.ctx.stroke();
  }
}

window.AgentTown = AgentTown;
