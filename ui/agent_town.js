/**
 * Oma AI Agent - Agent Town (2D Pixel Art Virtual Office Simulator)
 * Recreates the exact multi-room animated miniature office with workstations,
 * walking characters, and real-time task speech callout bubbles from the PC in 2070 reference video.
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

    // Desks in the main cubicle bay (3 double-cubicles = 6 desks)
    this.desks = [
      { id: 'desk_alice', col: 0, row: 0, x: 7, y: 7, agentId: 'alice', label: 'Research 01' },
      { id: 'desk_bob', col: 1, row: 0, x: 13, y: 7, agentId: 'bob', label: 'Dev 02' },
      { id: 'desk_extra1', col: 2, row: 0, x: 19, y: 7, agentId: null, label: 'Analysis 03' },
      { id: 'desk_carol', col: 0, row: 1, x: 7, y: 11, agentId: 'carol', label: 'Strategy 04' },
      { id: 'desk_dave', col: 1, row: 1, x: 13, y: 11, agentId: 'dave', label: 'System 05' },
      { id: 'desk_extra2', col: 2, row: 1, x: 19, y: 11, agentId: null, label: 'Open 06' }
    ];

    // Agents
    this.agents = {
      alice: {
        id: 'alice',
        name: 'Alice',
        role: 'Research Lead',
        color: '#ff5722',
        hairColor: '#ff7043',
        shirtColor: '#00e5ff',
        skirtColor: '#1a237e',
        x: 7 * 16,
        y: 8 * 16,
        targetX: 7 * 16,
        targetY: 8 * 16,
        deskId: 'desk_alice',
        state: 'idle', // 'idle', 'walking', 'working'
        direction: 'up', // 'up', 'down', 'left', 'right'
        walkFrame: 0,
        task: '',
        speechBubble: null,
        bubbleTimer: 0,
        thoughtIcon: null,
        thoughtTimer: 0
      },
      bob: {
        id: 'bob',
        name: 'Bob',
        role: 'Windows Automation',
        color: '#ffb300',
        hairColor: '#b0bec5',
        shirtColor: '#78909c',
        skirtColor: '#263238',
        x: 13 * 16,
        y: 8 * 16,
        targetX: 13 * 16,
        targetY: 8 * 16,
        deskId: 'desk_bob',
        state: 'idle',
        direction: 'up',
        walkFrame: 0,
        task: '',
        speechBubble: null,
        bubbleTimer: 0,
        thoughtIcon: null,
        thoughtTimer: 0
      },
      carol: {
        id: 'carol',
        name: 'Carol',
        role: 'AI Reasoning',
        color: '#b388ff',
        hairColor: '#5d4037',
        shirtColor: '#ab47bc',
        skirtColor: '#212121',
        x: 7 * 16,
        y: 12 * 16,
        targetX: 7 * 16,
        targetY: 12 * 16,
        deskId: 'desk_carol',
        state: 'idle',
        direction: 'up',
        walkFrame: 0,
        task: '',
        speechBubble: null,
        bubbleTimer: 0,
        thoughtIcon: null,
        thoughtTimer: 0
      },
      dave: {
        id: 'dave',
        name: 'Dave',
        role: 'System Diagnostics',
        color: '#00f59b',
        hairColor: '#37474f',
        shirtColor: '#00e676',
        skirtColor: '#263238',
        x: 13 * 16,
        y: 12 * 16,
        targetX: 13 * 16,
        targetY: 12 * 16,
        deskId: 'desk_dave',
        state: 'idle',
        direction: 'up',
        walkFrame: 0,
        task: '',
        speechBubble: null,
        bubbleTimer: 0,
        thoughtIcon: null,
        thoughtTimer: 0
      }
    };

    // Supervisory Floating Drone
    this.drone = {
      x: 10 * 16,
      y: 9 * 16,
      targetX: 10 * 16,
      targetY: 9 * 16
    };

    this.initDOM();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.animate();

    // Occasional gentle ambient shift for idle agents
    setInterval(() => this.ambientIdle(), 12000);
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement ? this.canvas.parentElement.getBoundingClientRect() : this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
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
  }

  updateChipsBar() {
    const container = document.getElementById('agent-chips-container');
    if (!container) return;
    container.innerHTML = '';

    Object.values(this.agents).forEach(agent => {
      const chip = document.createElement('div');
      chip.className = `agent-chip ${agent.state === 'working' ? 'working' : ''}`;
      chip.id = `chip-${agent.id}`;
      chip.style.setProperty('--chip-color', agent.color);

      chip.innerHTML = `
        <div class="chip-status-square" style="background:${agent.color};"></div>
        <div>
          <div class="chip-name">${agent.name}</div>
          <div class="chip-role" style="color:${agent.state === 'working' ? 'var(--neon-green)' : 'var(--text-muted)'};">
            ${agent.state === 'working' ? '● Working' : 'Idle'}
          </div>
        </div>
      `;

      chip.addEventListener('click', () => {
        agent.thoughtIcon = '👋';
        agent.thoughtTimer = 90;
      });

      container.appendChild(chip);
    });

    this.updateMetrics();
  }

  updateMetrics() {
    const busy = Object.values(this.agents).filter(a => a.state === 'working').length;
    const el = document.getElementById('town-busy-stat');
    if (el) el.textContent = `${busy}/4 busy`;
  }

  /**
   * Called by the authoritative OmaController when a real directive is executing.
   */
  onTaskEvent(state, detail) {
    if (state === 'thinking' || state === 'planning') {
      // Alice plans
      const alice = this.agents.alice;
      alice.thoughtIcon = '💡';
      alice.thoughtTimer = 160;
      alice.speechBubble = 'Analyzing task directives...';
      alice.bubbleTimer = 180;
    } else if (state === 'executing' || state === 'working') {
      // Pick agent based on task
      let targetAgent = this.agents.alice;
      if (detail && (detail.toLowerCase().includes('notepad') || detail.toLowerCase().includes('নোটপ্যাড') || detail.toLowerCase().includes('open') || detail.toLowerCase().includes('tool'))) {
        targetAgent = this.agents.bob;
      }

      targetAgent.state = 'working';
      targetAgent.thoughtIcon = '⚙️';
      targetAgent.thoughtTimer = 240;
      targetAgent.speechBubble = detail ? (detail.length > 50 ? detail.slice(0, 48) + '...' : detail) : 'Executing Windows action...';
      targetAgent.bubbleTimer = 300;

      // Bob walks to server room or workstation
      if (targetAgent.id === 'bob') {
        targetAgent.targetX = 26 * 16;
        targetAgent.targetY = 16 * 16;
        targetAgent.state = 'walking';
      }

      this.drone.targetX = targetAgent.x + 20;
      this.drone.targetY = targetAgent.y - 18;
      this.updateChipsBar();
    } else if (state === 'completed') {
      Object.values(this.agents).forEach(a => {
        if (a.state === 'working' || a.state === 'walking') {
          a.thoughtIcon = '✓';
          a.thoughtTimer = 140;
          a.speechBubble = 'Task complete!';
          a.bubbleTimer = 140;
          // Return to desk
          const desk = this.desks.find(d => d.id === a.deskId);
          if (desk) {
            a.targetX = desk.x * 16;
            a.targetY = (desk.y + 1) * 16;
            a.state = 'walking';
          }
          setTimeout(() => {
            a.state = 'idle';
            a.speechBubble = null;
            this.updateChipsBar();
          }, 2400);
        }
      });
      this.updateChipsBar();
    } else if (state === 'error') {
      Object.values(this.agents).forEach(a => {
        if (a.state === 'working') {
          a.thoughtIcon = '⚠️';
          a.thoughtTimer = 140;
          a.state = 'idle';
        }
      });
      this.updateChipsBar();
    }
  }

  setAgentWorking(agentId, task, status, pct) {
    const a = this.agents[agentId] || this.agents.bob;
    if (!a) return;
    a.state = 'working';
    a.task = task || '';
    a.thoughtIcon = '⚙️';
    a.thoughtTimer = 240;
    a.speechBubble = status || task || 'Working...';
    a.bubbleTimer = 260;
    this.drone.targetX = a.x + 16;
    this.drone.targetY = a.y - 18;
    this.updateChipsBar();
  }

  setAgentIdle(agentId) {
    const a = this.agents[agentId];
    if (!a) return;
    a.state = 'idle';
    a.task = '';
    a.speechBubble = null;
    const desk = this.desks.find(d => d.id === a.deskId);
    if (desk) {
      a.targetX = desk.x * 16;
      a.targetY = (desk.y + 1) * 16;
      a.state = 'walking';
      setTimeout(() => { a.state = 'idle'; this.updateChipsBar(); }, 1500);
    }
    this.updateChipsBar();
  }

  ambientIdle() {
    const idles = Object.values(this.agents).filter(a => a.state === 'idle');
    if (idles.length === 0) return;
    const lucky = idles[Math.floor(Math.random() * idles.length)];

    if (Math.random() > 0.6) {
      // Walk to water cooler / break room
      lucky.targetX = (6 + Math.random() * 4) * 16;
      lucky.targetY = (16 + Math.random() * 3) * 16;
      lucky.state = 'walking';
      lucky.thoughtIcon = '☕';
      lucky.thoughtTimer = 100;
      setTimeout(() => {
        const desk = this.desks.find(d => d.id === lucky.deskId);
        if (desk) {
          lucky.targetX = desk.x * 16;
          lucky.targetY = (desk.y + 1) * 16;
          lucky.state = 'walking';
        }
      }, 5000);
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.time += 0.03;

    if (!this.ctx || !this.width) return;
    this.ctx.clearRect(0, 0, this.width, this.height);

    this.ctx.save();
    this.ctx.translate(this.offsetX, this.offsetY);
    this.ctx.scale(this.scale, this.scale);

    // 1. Draw 4 Office Rooms & Floor Tiles
    this.drawOfficeRooms();

    // 2. Draw Office Furniture & Equipment
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

    // Base dark boundary
    this.ctx.fillStyle = '#0a0d14';
    this.ctx.fillRect(0, 0, W, H);

    // ================= Room 1: Main Cubicle Workroom (Top-Left) =================
    // 0 to 24 tiles wide, 0 to 14 tiles high
    this.ctx.fillStyle = '#141a24';
    this.ctx.fillRect(16, 16, 23 * 16, 13 * 16);

    // Grid Floor tiles
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
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

    // ================= Room 2: Executive Conference & Library (Top-Right) =================
    // 24 to 35 tiles wide, 0 to 14 tiles high
    this.ctx.fillStyle = '#161c28';
    this.ctx.fillRect(24 * 16, 16, 11 * 16, 13 * 16);
    this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.12)';
    this.ctx.strokeRect(24 * 16, 16, 11 * 16, 13 * 16);

    // ================= Room 3: Break Lounge & Kitchenette (Bottom-Left) =================
    // 16 to 18 tiles wide, 14 to 21 tiles high
    this.ctx.fillStyle = '#1c2230'; // Warm dark wood flooring tone
    this.ctx.fillRect(16, 14 * 16, 17 * 16, 7 * 16);
    // Wood plank horizontal lines
    this.ctx.strokeStyle = 'rgba(255, 179, 0, 0.04)';
    for (let py = 14; py <= 21; py++) {
      this.ctx.beginPath();
      this.ctx.moveTo(16, py * 16);
      this.ctx.lineTo(18 * 16, py * 16);
      this.ctx.stroke();
    }

    // ================= Room 4: Server & Tech Hub (Bottom-Right) =================
    // 18 to 35 tiles wide, 14 to 21 tiles high
    this.ctx.fillStyle = '#0f141d';
    this.ctx.fillRect(18 * 16, 14 * 16, 17 * 16, 7 * 16);

    // Walls (Solid dark border walls between rooms with doorways)
    this.ctx.fillStyle = '#0d1117';
    // North outer wall
    this.ctx.fillRect(0, 0, W, 16);
    // South outer wall
    this.ctx.fillRect(0, H - 16, W, 16);
    // West outer wall
    this.ctx.fillRect(0, 0, 16, H);
    // East outer wall
    this.ctx.fillRect(W - 16, 0, 16, H);

    // Vertical dividing wall between Main Bay and Conference
    this.ctx.fillRect(24 * 16 - 4, 16, 8, 13 * 16);
    // Horizontal dividing wall between Main Bay and Break / Server
    this.ctx.fillRect(16, 14 * 16 - 4, 23 * 16, 8);
    // Doorway cutouts
    // Door 1: Main Bay into Break Room (at x=10)
    this.ctx.fillStyle = '#e65100'; // Orange door frame matching video
    this.ctx.fillRect(9 * 16, 14 * 16 - 4, 2 * 16, 8);
    // Door 2: Main Bay into Conference Room (at y=7)
    this.ctx.fillStyle = '#00838f';
    this.ctx.fillRect(24 * 16 - 4, 6 * 16, 8, 2 * 16);

    // Room Label Overlays in futuristic pixel font
    this.ctx.font = '8px monospace';
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    this.ctx.fillText('CUBICLE BAY', 24, 28);
    this.ctx.fillText('RESEARCH LIBRARY', 25 * 16, 28);
    this.ctx.fillText('BREAK LOUNGE', 24, 15 * 16);
    this.ctx.fillText('SERVER RACKS', 19 * 16, 15 * 16);
  }

  drawOfficeFurniture() {
    // 1. Draw North Wall Items in Main Cubicle Bay: Whiteboards, Bookshelves, Air Con, Water Cooler
    // Air Conditioner
    this.ctx.fillStyle = '#37474f';
    this.ctx.fillRect(2 * 16, 12, 36, 10);
    this.ctx.fillStyle = '#cfd8dc';
    this.ctx.fillRect(2 * 16 + 2, 14, 32, 6);

    // Whiteboard with charts
    this.ctx.fillStyle = '#455a64';
    this.ctx.fillRect(6 * 16, 8, 48, 20);
    this.ctx.fillStyle = '#eceff1';
    this.ctx.fillRect(6 * 16 + 2, 10, 44, 16);
    // Draw chart lines on whiteboard
    this.ctx.fillStyle = '#00e5ff';
    this.ctx.fillRect(6 * 16 + 6, 18, 6, 6);
    this.ctx.fillStyle = '#ff5722';
    this.ctx.fillRect(6 * 16 + 14, 14, 6, 10);
    this.ctx.fillStyle = '#00e676';
    this.ctx.fillRect(6 * 16 + 22, 12, 6, 12);

    // Bookshelf with colored books
    this.ctx.fillStyle = '#3e2723';
    this.ctx.fillRect(11 * 16, 8, 44, 22);
    const bookColors = ['#00e5ff', '#ffb300', '#00f59b', '#ff5722', '#b388ff', '#ffffff'];
    for (let b = 0; b < 10; b++) {
      this.ctx.fillStyle = bookColors[b % bookColors.length];
      this.ctx.fillRect(11 * 16 + 4 + b * 4, 11, 3, 16);
    }

    // Water Cooler with Blue Bottle (at x=22, y=2)
    this.ctx.fillStyle = '#eceff1';
    this.ctx.fillRect(22 * 16, 16, 16, 22);
    // Blue water jug
    this.ctx.fillStyle = '#00b0ff';
    this.ctx.fillRect(22 * 16 + 2, 8, 12, 12);
    this.ctx.fillStyle = '#e0f7fa';
    this.ctx.fillRect(22 * 16 + 4, 10, 8, 4);

    // 2. Draw 6 Workstation Desks with Dual Monitors and Chairs
    this.desks.forEach(d => {
      const dx = d.x * 16;
      const dy = d.y * 16;

      // Desk base surface
      this.ctx.fillStyle = '#263238';
      this.ctx.fillRect(dx - 12, dy - 8, 44, 22);
      this.ctx.fillStyle = '#37474f';
      this.ctx.fillRect(dx - 12, dy - 8, 44, 4);

      // Cubicle partition panel behind desk
      this.ctx.fillStyle = '#455a64';
      this.ctx.fillRect(dx - 12, dy - 18, 44, 10);

      // Keyboard & mouse
      this.ctx.fillStyle = '#10141a';
      this.ctx.fillRect(dx - 4, dy + 2, 20, 8);
      this.ctx.fillStyle = '#546e7a';
      this.ctx.fillRect(dx - 2, dy + 4, 16, 4);

      // Dual Monitors
      const isWorking = this.agents[d.agentId] && this.agents[d.agentId].state === 'working';

      // Left Monitor
      this.ctx.fillStyle = '#1a222d';
      this.ctx.fillRect(dx - 10, dy - 14, 16, 12);
      this.ctx.fillStyle = isWorking ? '#00e5ff' : '#263238';
      this.ctx.fillRect(dx - 9, dy - 13, 14, 10);
      if (isWorking) {
        // Glowing animated code lines
        this.ctx.fillStyle = '#ffffff';
        const lineY = Math.floor(this.time * 6) % 6;
        this.ctx.fillRect(dx - 8, dy - 12 + lineY, 10, 1.5);
      }

      // Right Monitor
      this.ctx.fillStyle = '#1a222d';
      this.ctx.fillRect(dx + 8, dy - 14, 16, 12);
      this.ctx.fillStyle = isWorking ? '#00f59b' : '#263238';
      this.ctx.fillRect(dx + 9, dy - 13, 14, 10);

      // Blue Ergonomic Office Chair
      this.ctx.fillStyle = '#1565c0';
      this.ctx.beginPath();
      this.ctx.arc(dx + 8, dy + 18, 7, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.fillStyle = '#0d47a1';
      this.ctx.fillRect(dx + 5, dy + 15, 6, 6);
    });

    // 3. Conference Room Furniture (Top Right)
    // Long Conference Table
    this.ctx.fillStyle = '#3e2723';
    this.ctx.fillRect(26 * 16, 4 * 16, 7 * 16, 4 * 16);
    this.ctx.fillStyle = '#4e342e';
    this.ctx.fillRect(26 * 16 + 2, 4 * 16 + 2, 7 * 16 - 4, 4 * 16 - 4);
    // Chairs around table
    for (let c = 0; c < 4; c++) {
      this.ctx.fillStyle = '#263238';
      this.ctx.fillRect(27 * 16 + c * 24, 3 * 16 + 6, 10, 8);
      this.ctx.fillRect(27 * 16 + c * 24, 8 * 16 + 2, 10, 8);
    }
    // Globe & Potted Plants
    this.ctx.fillStyle = '#2e7d32';
    this.ctx.beginPath();
    this.ctx.arc(33 * 16, 2 * 16 + 4, 8, 0, Math.PI * 2);
    this.ctx.fill();

    // 4. Break Lounge Furniture (Bottom Left)
    // Blue Comfortable Sofa
    this.ctx.fillStyle = '#1e88e5';
    this.ctx.fillRect(3 * 16, 16 * 16, 4 * 16, 18);
    this.ctx.fillStyle = '#1565c0';
    this.ctx.fillRect(3 * 16, 16 * 16 + 18, 4 * 16, 10);
    // Coffee Table
    this.ctx.fillStyle = '#4e342e';
    this.ctx.fillRect(4 * 16, 18 * 16, 2 * 16 + 8, 14);

    // 5. Server Racks (Bottom Right)
    for (let s = 0; s < 4; s++) {
      const sx = (20 + s * 3) * 16;
      const sy = 16 * 16;
      this.ctx.fillStyle = '#10141b';
      this.ctx.fillRect(sx, sy, 32, 54);
      this.ctx.strokeStyle = '#263238';
      this.ctx.strokeRect(sx, sy, 32, 54);

      // Blinking status LEDs on servers
      for (let row = 0; row < 5; row++) {
        this.ctx.fillStyle = '#1e2632';
        this.ctx.fillRect(sx + 3, sy + 4 + row * 10, 26, 7);
        // Blinking LEDs
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
      // Move towards target
      const dx = agent.targetX - agent.x;
      const dy = agent.targetY - agent.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 2) {
        agent.state = 'walking';
        const speed = 1.6;
        agent.x += (dx / dist) * speed;
        agent.y += (dy / dist) * speed;
        agent.walkFrame += 0.2;

        if (Math.abs(dx) > Math.abs(dy)) {
          agent.direction = dx > 0 ? 'right' : 'left';
        } else {
          agent.direction = dy > 0 ? 'down' : 'up';
        }
      } else {
        if (agent.state === 'walking') {
          agent.state = 'idle';
        }
      }

      this.drawPixelCharacter(agent);
    });
  }

  drawPixelCharacter(a) {
    const cx = a.x;
    const cy = a.y;
    const isWalk = a.state === 'walking';
    const step = isWalk ? Math.sin(a.walkFrame) * 2.5 : 0;

    // Shadow
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    this.ctx.beginPath();
    this.ctx.ellipse(cx + 8, cy + 18, 7, 3, 0, 0, Math.PI * 2);
    this.ctx.fill();

    // 1. Legs / Shoes
    this.ctx.fillStyle = a.skirtColor;
    this.ctx.fillRect(cx + 4, cy + 13 + step, 3, 5);
    this.ctx.fillRect(cx + 9, cy + 13 - step, 3, 5);
    this.ctx.fillStyle = '#212121';
    this.ctx.fillRect(cx + 3, cy + 17 + step, 4, 2);
    this.ctx.fillRect(cx + 9, cy + 17 - step, 4, 2);

    // 2. Torso / Shirt
    this.ctx.fillStyle = a.shirtColor;
    this.ctx.fillRect(cx + 4, cy + 7, 8, 7);

    // Arms / Typing
    this.ctx.fillStyle = a.shirtColor;
    if (a.state === 'working') {
      const typeHand = Math.sin(this.time * 12) * 1.5;
      this.ctx.fillRect(cx + 1, cy + 6 + typeHand, 3, 5);
      this.ctx.fillRect(cx + 12, cy + 6 - typeHand, 3, 5);
    } else {
      this.ctx.fillRect(cx + 2, cy + 7 - step, 2, 6);
      this.ctx.fillRect(cx + 12, cy + 7 + step, 2, 6);
    }

    // 3. Head & Face
    this.ctx.fillStyle = '#ffcc80'; // Skin tone
    this.ctx.fillRect(cx + 4, cy + 2, 8, 6);

    // Eyes
    this.ctx.fillStyle = '#212121';
    if (a.direction === 'down' || a.state === 'working') {
      this.ctx.fillRect(cx + 5, cy + 4, 1.5, 2);
      this.ctx.fillRect(cx + 9, cy + 4, 1.5, 2);
    } else if (a.direction === 'left') {
      this.ctx.fillRect(cx + 4, cy + 4, 1.5, 2);
    } else if (a.direction === 'right') {
      this.ctx.fillRect(cx + 10, cy + 4, 1.5, 2);
    }

    // Hair
    this.ctx.fillStyle = a.hairColor;
    this.ctx.fillRect(cx + 3, cy, 10, 3);
    this.ctx.fillRect(cx + 3, cy + 2, 2, 4);
    if (a.id === 'alice') {
      // Long orange ponytail
      this.ctx.fillRect(cx + 11, cy + 2, 3, 7);
    }

    // 4. Floating Speech / Thought Bubble
    if (a.thoughtTimer > 0 && a.thoughtIcon) {
      a.thoughtTimer--;
      this.drawThoughtIcon(cx + 8, cy - 6, a.thoughtIcon);
    }

    if (a.speechBubble && a.bubbleTimer > 0) {
      a.bubbleTimer--;
      this.drawSpeechBubble(cx + 8, cy - 14, a.speechBubble);
    }

    // 5. Agent Name Tag below feet
    this.ctx.font = '8px sans-serif';
    this.ctx.fillStyle = '#ffffff';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(a.name, cx + 8, cy + 26);
    this.ctx.textAlign = 'left';
  }

  drawThoughtIcon(x, y, icon) {
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    this.ctx.beginPath();
    this.ctx.arc(x, y, 7, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.font = '9px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(icon, x, y);
    this.ctx.restore();
  }

  drawSpeechBubble(x, y, text) {
    this.ctx.save();
    this.ctx.font = '9px sans-serif';
    const textWidth = Math.min(this.ctx.measureText(text).width + 12, 140);
    const bubbleH = 18;
    const bx = Math.max(10, x - textWidth / 2);
    const by = y - bubbleH;

    // Bubble box
    this.ctx.fillStyle = '#ffffff';
    this.ctx.strokeStyle = '#ffb300';
    this.ctx.lineWidth = 1.2;
    this.ctx.beginPath();
    this.ctx.roundRect(bx, by, textWidth, bubbleH, 4);
    this.ctx.fill();
    this.ctx.stroke();

    // Bubble pointer down
    this.ctx.beginPath();
    this.ctx.moveTo(x - 3, by + bubbleH);
    this.ctx.lineTo(x, by + bubbleH + 4);
    this.ctx.lineTo(x + 3, by + bubbleH);
    this.ctx.fill();

    // Text inside
    this.ctx.fillStyle = '#10141b';
    this.ctx.textBaseline = 'middle';
    let renderText = text;
    if (this.ctx.measureText(text).width > textWidth - 10) {
      renderText = text.slice(0, 22) + '...';
    }
    this.ctx.fillText(renderText, bx + 6, by + bubbleH / 2);
    this.ctx.restore();
  }

  drawDrone() {
    const d = this.drone;
    d.x += (d.targetX - d.x) * 0.05;
    d.y += (d.targetY - d.y) * 0.05;

    const bob = Math.sin(this.time * 3) * 2;
    this.ctx.save();
    this.ctx.fillStyle = '#00e5ff';
    this.ctx.shadowColor = '#00e5ff';
    this.ctx.shadowBlur = 8;
    this.ctx.beginPath();
    this.ctx.arc(d.x, d.y + bob, 4, 0, Math.PI * 2);
    this.ctx.fill();

    // Ring around drone
    this.ctx.strokeStyle = 'rgba(255, 179, 0, 0.6)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.ellipse(d.x, d.y + bob, 7, 2.5, this.time, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.restore();
  }
}

window.AgentTown = AgentTown;
