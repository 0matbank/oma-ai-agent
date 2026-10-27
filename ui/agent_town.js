/**
 * Oma AI Agent - Agent Town (2D Pixel Art Virtual Office Simulator)
 * Recreates the exact multi-agent pixel office environment shown in the PC in 2070 video.
 */
class AgentTown {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.time = 0;
    this.scale = 2; // Pixel art scaling

    // Office dimensions in tile units (tile size = 16px)
    this.tileSize = 16;
    this.mapWidth = 38;
    this.mapHeight = 24;

    // Desks layout: { x, y, agentId, chairDir }
    this.desks = [
      { id: 'desk_alice', x: 8, y: 7, agentId: 'alice', active: false, label: 'Research 01' },
      { id: 'desk_bob', x: 14, y: 7, agentId: 'bob', active: false, label: 'Dev 02' },
      { id: 'desk_carol', x: 20, y: 7, agentId: 'carol', active: false, label: 'Automation 03' },
      { id: 'desk_dave', x: 26, y: 7, agentId: 'dave', active: false, label: 'Content 04' },
      { id: 'desk_extra1', x: 8, y: 13, agentId: null, active: false, label: 'Open 05' },
      { id: 'desk_extra2', x: 14, y: 13, agentId: null, active: false, label: 'Open 06' }
    ];

    // Agents
    this.agents = {
      alice: {
        id: 'alice',
        name: 'Alice',
        role: 'Senior Researcher',
        color: '#ff5722',
        hairColor: '#ff6e40',
        shirtColor: '#00e5ff',
        pantsColor: '#263238',
        x: 8 * 16,
        y: 8 * 16,
        targetX: 8 * 16,
        targetY: 8 * 16,
        deskId: 'desk_alice',
        state: 'working', // 'idle', 'walking', 'working'
        direction: 'up', // 'up', 'down', 'left', 'right'
        walkFrame: 0,
        task: 'Researching latest AI advancements & Stonic/Oma tech...',
        taskBubble: 'Provide a detailed research report on the latest advancements and current public perception of...',
        bubbleProgress: 65,
        bubbleTimer: 9999,
        actionBubble: '💡',
        actionBubbleTimer: 180
      },
      bob: {
        id: 'bob',
        name: 'Bob',
        role: 'System Architect',
        color: '#ffb300',
        hairColor: '#37474f',
        shirtColor: '#90a4ae',
        pantsColor: '#1a237e',
        x: 14 * 16,
        y: 8 * 16,
        targetX: 14 * 16,
        targetY: 8 * 16,
        deskId: 'desk_bob',
        state: 'idle',
        direction: 'up',
        walkFrame: 0,
        task: '',
        taskBubble: null,
        bubbleProgress: 0,
        bubbleTimer: 0,
        actionBubble: null,
        actionBubbleTimer: 0
      },
      carol: {
        id: 'carol',
        name: 'Carol',
        role: 'Automation & Tools',
        color: '#b388ff',
        hairColor: '#795548',
        shirtColor: '#b388ff',
        pantsColor: '#37474f',
        x: 20 * 16,
        y: 8 * 16,
        targetX: 20 * 16,
        targetY: 8 * 16,
        deskId: 'desk_carol',
        state: 'idle',
        direction: 'up',
        walkFrame: 0,
        task: '',
        taskBubble: null,
        bubbleProgress: 0,
        bubbleTimer: 0,
        actionBubble: null,
        actionBubbleTimer: 0
      },
      dave: {
        id: 'dave',
        name: 'Dave',
        role: 'Creative & Comm',
        color: '#00f59b',
        hairColor: '#4e342e',
        shirtColor: '#00f59b',
        pantsColor: '#212121',
        x: 26 * 16,
        y: 8 * 16,
        targetX: 26 * 16,
        targetY: 8 * 16,
        deskId: 'desk_dave',
        state: 'idle',
        direction: 'up',
        walkFrame: 0,
        task: '',
        taskBubble: null,
        bubbleProgress: 0,
        bubbleTimer: 0,
        actionBubble: null,
        actionBubbleTimer: 0
      }
    };

    // Supervisor Drone / Oma Orb
    this.omaDrone = {
      x: 17 * 16,
      y: 11 * 16,
      targetX: 17 * 16,
      targetY: 11 * 16,
      bobOffset: 0
    };

    this.initDOM();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.animate();

    // Occasional idle wanderer movement
    setInterval(() => this.idleWander(), 8000);
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.scale(dpr, dpr);

    // Calculate ideal pixel scale to fit map
    const scaleX = this.width / (this.mapWidth * this.tileSize);
    const scaleY = this.height / (this.mapHeight * this.tileSize);
    this.scale = Math.max(1.2, Math.min(scaleX, scaleY));
    this.offsetX = Math.max(0, (this.width - this.mapWidth * this.tileSize * this.scale) / 2);
    this.offsetY = Math.max(0, (this.height - this.mapHeight * this.tileSize * this.scale) / 2);
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
        <div class="chip-status-square"></div>
        <div>
          <div class="chip-name">${agent.name}</div>
          <div class="chip-role">${agent.state === 'working' ? 'Working' : 'Idle'}</div>
        </div>
      `;

      chip.addEventListener('click', () => {
        this.focusAgent(agent.id);
      });

      container.appendChild(chip);
    });

    this.updateMetrics();
  }

  updateMetrics() {
    const busyCount = Object.values(this.agents).filter(a => a.state === 'working').length;
    const totalCount = Object.keys(this.agents).length;
    const el = document.getElementById('town-busy-stat');
    if (el) el.textContent = `${busyCount}/${totalCount} busy`;
  }

  focusAgent(agentId) {
    const agent = this.agents[agentId];
    if (!agent) return;
    agent.actionBubble = '👋';
    agent.actionBubbleTimer = 90;
  }

  idleWander() {
    // Random idle movement for agents that are not working
    const idles = Object.values(this.agents).filter(a => a.state === 'idle');
    if (idles.length === 0) return;
    const lucky = idles[Math.floor(Math.random() * idles.length)];

    if (Math.random() > 0.5) {
      // Go get coffee / break room
      lucky.targetX = (31 + Math.random() * 4) * 16;
      lucky.targetY = (16 + Math.random() * 4) * 16;
      lucky.state = 'walking';
      lucky.actionBubble = '☕';
      lucky.actionBubbleTimer = 120;
    } else {
      // Return to desk
      const desk = this.desks.find(d => d.id === lucky.deskId);
      if (desk) {
        lucky.targetX = desk.x * 16;
        lucky.targetY = (desk.y + 1) * 16;
        lucky.state = 'walking';
      }
    }
  }

  /**
   * Dispatches a real task to an agent (exact replica of video workflow)
   */
  assignTask(agentId, taskText, onComplete) {
    const agent = this.agents[agentId] || this.agents.alice;
    const desk = this.desks.find(d => d.id === agent.deskId);

    // 1. Initial reaction: Thought bubble with '!'
    agent.actionBubble = '❗';
    agent.actionBubbleTimer = 140;

    // 2. Set task text
    agent.task = taskText;
    agent.taskBubble = 'Returning to desk...';
    agent.bubbleProgress = 0;
    agent.bubbleTimer = 9999;
    agent.state = 'walking';

    // 3. Walk to desk
    if (desk) {
      agent.targetX = desk.x * 16;
      agent.targetY = (desk.y + 1) * 16;
    }

    this.updateChipsBar();

    // Fly Oma drone to agent to supervise
    this.omaDrone.targetX = agent.targetX + 24;
    this.omaDrone.targetY = agent.targetY - 16;

    // When reached desk, start working
    const checkArrival = setInterval(() => {
      const dist = Math.hypot(agent.x - agent.targetX, agent.y - agent.targetY);
      if (dist < 4) {
        clearInterval(checkArrival);
        agent.state = 'working';
        agent.direction = 'up';
        agent.actionBubble = '💻';
        agent.actionBubbleTimer = 120;
        agent.taskBubble = taskText;

        // Progressively fill task progress
        let progress = 0;
        const progressInterval = setInterval(() => {
          progress += 5;
          agent.bubbleProgress = progress;
          if (progress >= 100) {
            clearInterval(progressInterval);
            agent.actionBubble = '✅';
            agent.actionBubbleTimer = 160;
            agent.taskBubble = '✓ Task Completed!';
            setTimeout(() => {
              agent.state = 'idle';
              agent.taskBubble = null;
              this.updateChipsBar();
              if (onComplete) onComplete();
            }, 3000);
          }
        }, 180);
      }
    }, 200);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.time += 0.03;

    this.ctx.clearRect(0, 0, this.width, this.height);

    this.ctx.save();
    this.ctx.translate(this.offsetX, this.offsetY);
    this.ctx.scale(this.scale, this.scale);

    // 1. Draw Office Floors & Walls
    this.drawOfficeLayout();

    // 2. Draw Furniture (Desks, Chairs, Monitors, Plants, Servers)
    this.drawFurniture();

    // 3. Update & Draw Agents
    this.updateAndDrawAgents();

    // 4. Draw Supervisor Drone
    this.drawDrone();

    this.ctx.restore();
  }

  drawOfficeLayout() {
    const W = this.mapWidth * this.tileSize;
    const H = this.mapHeight * this.tileSize;

    // Floor Base (Sleek slate dark office tiles)
    this.ctx.fillStyle = '#111722';
    this.ctx.fillRect(0, 0, W, H);

    // Grid Floor lines
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    this.ctx.lineWidth = 1;
    for (let x = 0; x <= this.mapWidth; x++) {
      this.ctx.beginPath();
      this.ctx.moveTo(x * this.tileSize, 0);
      this.ctx.lineTo(x * this.tileSize, H);
      this.ctx.stroke();
    }
    for (let y = 0; y <= this.mapHeight; y++) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y * this.tileSize);
      this.ctx.lineTo(W, y * this.tileSize);
      this.ctx.stroke();
    }

    // Modern Wood Carpet for Main Dev Bay
    this.ctx.fillStyle = '#161f2e';
    this.ctx.fillRect(5 * 16, 5 * 16, 26 * 16, 12 * 16);
    this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.15)';
    this.ctx.strokeRect(5 * 16, 5 * 16, 26 * 16, 12 * 16);

    // Break Room Area (Bottom Right)
    this.ctx.fillStyle = '#1c2432';
    this.ctx.fillRect(29 * 16, 15 * 16, 8 * 16, 8 * 16);
    this.ctx.strokeStyle = 'rgba(255, 179, 0, 0.2)';
    this.ctx.strokeRect(29 * 16, 15 * 16, 8 * 16, 8 * 16);

    // Meeting Room (Top Left)
    this.ctx.fillStyle = '#131b26';
    this.ctx.fillRect(1 * 16, 1 * 16, 12 * 16, 4 * 16);
    this.ctx.strokeStyle = 'rgba(0, 245, 155, 0.2)';
    this.ctx.strokeRect(1 * 16, 1 * 16, 12 * 16, 4 * 16);

    // Server Room (Top Right)
    this.ctx.fillStyle = '#0d131d';
    this.ctx.fillRect(29 * 16, 1 * 16, 8 * 16, 4 * 16);
    this.ctx.strokeStyle = 'rgba(179, 136, 255, 0.2)';
    this.ctx.strokeRect(29 * 16, 1 * 16, 8 * 16, 4 * 16);

    // Outer Walls
    this.ctx.fillStyle = '#080c12';
    this.ctx.fillRect(0, 0, W, 8); // Top wall
    this.ctx.fillRect(0, H - 8, W, 8); // Bottom wall
    this.ctx.fillRect(0, 0, 8, H); // Left wall
    this.ctx.fillRect(W - 8, 0, 8, H); // Right wall

    // Room Labels in pixel font
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    this.ctx.font = '8px monospace';
    this.ctx.fillText('CONFERENCE ROOM', 2 * 16, 2 * 16);
    this.ctx.fillText('SERVER RACKS', 30 * 16, 2 * 16);
    this.ctx.fillText('BREAK LOUNGE', 30 * 16, 16 * 16);
    this.ctx.fillText('MAIN WORKSTATION BAY', 6 * 16, 6 * 16);
  }

  drawFurniture() {
    // 1. Draw Desks with dual monitors
    this.desks.forEach(desk => {
      const dx = desk.x * 16;
      const dy = desk.y * 16;

      // Desk Surface
      this.ctx.fillStyle = '#222d3d';
      this.ctx.fillRect(dx - 12, dy - 8, 40, 20);
      this.ctx.fillStyle = '#2c3b4e';
      this.ctx.fillRect(dx - 12, dy - 8, 40, 4);

      // Keyboard & mousepad
      this.ctx.fillStyle = '#0e141c';
      this.ctx.fillRect(dx - 4, dy + 2, 18, 7);
      this.ctx.fillStyle = '#4a5d78';
      this.ctx.fillRect(dx - 2, dy + 4, 14, 3);

      // Dual Monitors
      const isWorking = desk.active || (this.agents[desk.agentId] && this.agents[desk.agentId].state === 'working');

      // Left Monitor
      this.ctx.fillStyle = '#1a222e';
      this.ctx.fillRect(dx - 10, dy - 12, 14, 10);
      this.ctx.fillStyle = isWorking ? '#00e5ff' : '#223247';
      this.ctx.fillRect(dx - 9, dy - 11, 12, 8);
      if (isWorking) {
        // Animated scrolling code lines
        this.ctx.fillStyle = '#ffffff';
        const lineOffset = Math.floor(this.time * 8) % 6;
        this.ctx.fillRect(dx - 8, dy - 10 + (lineOffset % 5), 8, 1);
        this.ctx.fillRect(dx - 8, dy - 8 + (lineOffset % 4), 6, 1);
      }

      // Right Monitor
      this.ctx.fillStyle = '#1a222e';
      this.ctx.fillRect(dx + 6, dy - 12, 14, 10);
      this.ctx.fillStyle = isWorking ? '#00f59b' : '#223247';
      this.ctx.fillRect(dx + 7, dy - 11, 12, 8);
      if (isWorking) {
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(dx + 8, dy - 9, 8, 1);
        this.ctx.fillRect(dx + 8, dy - 6, 6, 1);
      }

      // Coffee Cup
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillRect(dx + 22, dy + 2, 4, 5);

      // Ergonomic Chair behind desk
      this.ctx.fillStyle = '#1a222e';
      this.ctx.fillRect(dx + 1, dy + 14, 12, 10);
      this.ctx.fillStyle = '#2d3b4e';
      this.ctx.fillRect(dx + 2, dy + 15, 10, 8);
    });

    // 2. Server Racks (Top Right)
    for (let i = 0; i < 4; i++) {
      const sx = (30 + i * 1.8) * 16;
      const sy = 2.4 * 16;
      this.ctx.fillStyle = '#111722';
      this.ctx.fillRect(sx, sy, 22, 28);
      this.ctx.strokeStyle = '#233145';
      this.ctx.strokeRect(sx, sy, 22, 28);

      // Blinking status LEDs
      for (let r = 0; r < 5; r++) {
        const ledOn = Math.sin(this.time * 6 + i * 2 + r) > 0;
        this.ctx.fillStyle = ledOn ? (r % 2 === 0 ? '#00f59b' : '#00e5ff') : '#1e293b';
        this.ctx.fillRect(sx + 3, sy + 3 + r * 5, 3, 2);
        this.ctx.fillRect(sx + 8, sy + 3 + r * 5, 8, 2);
      }
    }

    // 3. Coffee Machine & Water Cooler (Break Room)
    const bx = 30 * 16;
    const by = 17 * 16;
    // Counter
    this.ctx.fillStyle = '#263445';
    this.ctx.fillRect(bx, by, 64, 16);
    // Coffee Maker
    this.ctx.fillStyle = '#ff2a5f';
    this.ctx.fillRect(bx + 6, by - 10, 12, 10);
    // Steam animation
    const steamY = Math.sin(this.time * 4) * 3;
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    this.ctx.fillRect(bx + 10, by - 14 + steamY, 2, 3);

    // Water Cooler
    this.ctx.fillStyle = '#00e5ff';
    this.ctx.fillRect(bx + 44, by - 12, 10, 12);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(bx + 42, by, 14, 16);

    // Potted Office Plant
    this.drawPlant(15 * 16, 2 * 16);
    this.drawPlant(27 * 16, 2 * 16);
    this.drawPlant(6 * 16, 18 * 16);
  }

  drawPlant(x, y) {
    // Pot
    this.ctx.fillStyle = '#795548';
    this.ctx.fillRect(x - 5, y + 2, 10, 8);
    // Green leaves
    this.ctx.fillStyle = '#00c853';
    this.ctx.fillRect(x - 8, y - 4, 16, 6);
    this.ctx.fillStyle = '#69f0ae';
    this.ctx.fillRect(x - 5, y - 7, 10, 5);
  }

  updateAndDrawAgents() {
    Object.values(this.agents).forEach(agent => {
      // Pathfinding / movement towards target
      const dx = agent.targetX - agent.x;
      const dy = agent.targetY - agent.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 1.5) {
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
          agent.state = agent.task ? 'working' : 'idle';
        }
      }

      // Render Pixel Character
      this.drawPixelCharacter(agent);

      // Render Action/Thought bubble if active
      if (agent.actionBubble && agent.actionBubbleTimer > 0) {
        agent.actionBubbleTimer--;
        this.drawThoughtBubble(agent.x, agent.y - 18, agent.actionBubble);
      }

      // Render Task Dialogue Bubble (Matching video)
      if (agent.taskBubble) {
        this.drawTaskSpeechCard(agent);
      }
    });
  }

  drawPixelCharacter(agent) {
    const x = Math.round(agent.x);
    const y = Math.round(agent.y);

    const isWalking = agent.state === 'walking';
    const legOffset = isWalking ? Math.sin(agent.walkFrame * 4) * 2 : 0;
    const isTyping = agent.state === 'working';
    const armOffset = isTyping ? (Math.floor(this.time * 8) % 2) * 2 : 0;

    // Shadow
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    this.ctx.beginPath();
    this.ctx.ellipse(x + 6, y + 14, 7, 3, 0, 0, Math.PI * 2);
    this.ctx.fill();

    // Legs / Pants
    this.ctx.fillStyle = agent.pantsColor;
    this.ctx.fillRect(x + 2, y + 8, 3, 6 + legOffset);
    this.ctx.fillRect(x + 7, y + 8, 3, 6 - legOffset);

    // Torso / Shirt
    this.ctx.fillStyle = agent.shirtColor;
    this.ctx.fillRect(x + 1, y + 2, 10, 7);

    // Arms (animated if typing)
    this.ctx.fillStyle = agent.shirtColor;
    if (isTyping) {
      this.ctx.fillRect(x - 2, y + 3 - armOffset, 3, 5);
      this.ctx.fillRect(x + 11, y + 3 + armOffset, 3, 5);
    } else {
      this.ctx.fillRect(x - 1, y + 3, 2, 5);
      this.ctx.fillRect(x + 11, y + 3, 2, 5);
    }

    // Head / Face
    this.ctx.fillStyle = '#ffd1a4'; // Skin tone
    this.ctx.fillRect(x + 2, y - 5, 8, 7);

    // Eyes
    this.ctx.fillStyle = '#1a222e';
    if (agent.direction === 'up') {
      // Facing up / away
    } else if (agent.direction === 'left') {
      this.ctx.fillRect(x + 3, y - 3, 2, 2);
    } else if (agent.direction === 'right') {
      this.ctx.fillRect(x + 7, y - 3, 2, 2);
    } else {
      this.ctx.fillRect(x + 3, y - 3, 2, 2);
      this.ctx.fillRect(x + 7, y - 3, 2, 2);
    }

    // Hair
    this.ctx.fillStyle = agent.hairColor;
    this.ctx.fillRect(x + 1, y - 8, 10, 4);
    if (agent.id === 'alice') {
      // Red hair sides
      this.ctx.fillRect(x, y - 6, 2, 7);
      this.ctx.fillRect(x + 10, y - 6, 2, 7);
    }

    // Name label
    this.ctx.fillStyle = '#cbd5e1';
    this.ctx.font = '7px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(agent.name, x + 6, y + 21);
    this.ctx.textAlign = 'start';
  }

  drawThoughtBubble(x, y, icon) {
    this.ctx.save();
    this.ctx.fillStyle = '#ffffff';
    this.ctx.beginPath();
    this.ctx.arc(x + 6, y, 7, 0, Math.PI * 2);
    this.ctx.fill();

    // Little dots
    this.ctx.beginPath();
    this.ctx.arc(x + 4, y + 9, 2, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.font = '8px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(icon, x + 6, y + 3);
    this.ctx.restore();
  }

  drawTaskSpeechCard(agent) {
    const x = Math.round(agent.x);
    const y = Math.round(agent.y);

    const bubbleW = 140;
    const bubbleH = 38;
    const bubbleX = Math.min(this.mapWidth * 16 - bubbleW - 10, Math.max(10, x - 20));
    const bubbleY = y - 48;

    this.ctx.save();
    // Card Background
    this.ctx.fillStyle = 'rgba(14, 20, 32, 0.95)';
    this.ctx.fillRect(bubbleX, bubbleY, bubbleW, bubbleH);
    this.ctx.strokeStyle = '#00e5ff';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(bubbleX, bubbleY, bubbleW, bubbleH);

    // Little pointer triangle
    this.ctx.fillStyle = '#00e5ff';
    this.ctx.beginPath();
    this.ctx.moveTo(x + 6, bubbleY + bubbleH);
    this.ctx.lineTo(x + 10, bubbleY + bubbleH + 4);
    this.ctx.lineTo(x + 14, bubbleY + bubbleH);
    this.ctx.fill();

    // Document icon
    this.ctx.font = '8px monospace';
    this.ctx.fillStyle = '#ffb300';
    this.ctx.fillText('📄', bubbleX + 6, bubbleY + 12);

    // Task text (clipped to two lines)
    this.ctx.fillStyle = '#f8fafc';
    this.ctx.font = '7.5px sans-serif';
    const text = agent.taskBubble;
    const line1 = text.substring(0, 26);
    const line2 = text.length > 26 ? text.substring(26, 52) + (text.length > 52 ? '...' : '') : '';
    this.ctx.fillText(line1, bubbleX + 20, bubbleY + 12);
    if (line2) this.ctx.fillText(line2, bubbleX + 20, bubbleY + 22);

    // Progress bar at bottom of bubble
    if (agent.bubbleProgress > 0) {
      const p = Math.min(100, agent.bubbleProgress);
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      this.ctx.fillRect(bubbleX + 6, bubbleY + 28, bubbleW - 12, 4);
      this.ctx.fillStyle = p === 100 ? '#00f59b' : '#00e5ff';
      this.ctx.fillRect(bubbleX + 6, bubbleY + 28, (bubbleW - 12) * (p / 100), 4);
    }

    this.ctx.restore();
  }

  drawDrone() {
    // Smooth follow
    this.omaDrone.x += (this.omaDrone.targetX - this.omaDrone.x) * 0.05;
    this.omaDrone.y += (this.omaDrone.targetY - this.omaDrone.y) * 0.05;

    const bob = Math.sin(this.time * 5) * 3;
    const x = Math.round(this.omaDrone.x);
    const y = Math.round(this.omaDrone.y + bob);

    this.ctx.save();
    // Drone shadow
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    this.ctx.beginPath();
    this.ctx.ellipse(x + 5, y + 14 - bob, 5, 2, 0, 0, Math.PI * 2);
    this.ctx.fill();

    // Drone Body
    this.ctx.fillStyle = '#1e293b';
    this.ctx.beginPath();
    this.ctx.arc(x + 5, y + 4, 6, 0, Math.PI * 2);
    this.ctx.fill();

    // Glowing Eye
    this.ctx.fillStyle = '#00e5ff';
    this.ctx.beginPath();
    this.ctx.arc(x + 5, y + 4, 2.5, 0, Math.PI * 2);
    this.ctx.fill();

    // Rotor rings
    this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.5)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.ellipse(x + 5, y - 2, 8, 2, 0, 0, Math.PI * 2);
    this.ctx.stroke();

    this.ctx.restore();
  }
}

window.AgentTown = AgentTown;
