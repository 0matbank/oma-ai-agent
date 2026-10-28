/**
 * Oma AI Agent - Holographic Human-Shaped AI Face & Neural Particle System
 * Completely redesigned to match the PC in 2070 reference video:
 * - Friendly, calm, intelligent human face silhouette (NO skull, horror, or hollow aesthetics).
 * - Smooth volumetric cyan/azure illumination with warm golden crown particles.
 * - Natural facial proportions: curved smiling lips, calm eyes, sculpted nose, graceful neck & shoulders.
 * - Configurable animation system: Slow (default), Normal, Fast; Reduce Motion toggle; 30/60 FPS throttling; visibility pause.
 * - Seamless integration with neural connector bus and interactive 3D mouse/touch gestures.
 */

class OmaHoloFace {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.filaments = [];
    this.time = 0;
    this.lastFrameTime = performance.now();

    // AI States: 'active', 'listening', 'thinking', 'planning', 'executing', 'speaking', 'completed', 'error'
    this.state = 'active';
    this.stateLerp = 0; // Smooth 0..1 transition between states
    this.audioLevel = 0;
    this.targetAudioLevel = 0;

    // Expression & Speech dynamics
    this.blinkProgress = 0;
    this.blinkTimer = 180 + Math.random() * 120;
    this.speechPhase = 0;
    this.smileAmount = 0.05; // Resting friendly smile

    // Head orientation angles (radians) with gesture tracking
    this.rotY = 0;
    this.rotX = 0;
    this.targetRotY = 0;
    this.targetRotX = 0;
    this.zoomScale = 1.0;
    this.targetZoomScale = 1.0;

    // Animation Config (M2 Requirements)
    this.speedMode = 'slow'; // 'slow', 'normal', 'fast'
    this.reduceMotion = false;
    this.fpsLimit = 60;
    this.isPaused = false;

    // 3D Orbital Gyroscopic Rings (Slow, dignified motion)
    this.rings = [
      { radius: 1.48, tiltX: 0.85, tiltZ: 0.30, speed: 0.0035, angle: 0, color: 'rgba(0, 229, 255, 0.35)' },
      { radius: 1.65, tiltX: -0.65, tiltZ: 0.85, speed: -0.0028, angle: 0.8, color: 'rgba(255, 179, 0, 0.35)' },
      { radius: 1.38, tiltX: 0.25, tiltZ: -0.65, speed: 0.0042, angle: 1.6, color: 'rgba(0, 245, 155, 0.28)' }
    ];

    this.initFaceMesh();
    this.resize();
    this.wireGestures();
    this.wireVisibility();

    window.addEventListener('resize', () => this.resize());
    requestAnimationFrame((t) => this.renderLoop(t));
  }

  getSpeedMultiplier() {
    if (this.reduceMotion) return 0.0;
    switch (this.speedMode) {
      case 'fast': return 1.0;
      case 'normal': return 0.65;
      case 'slow':
      default: return 0.35; // Default slow and smooth as requested
    }
  }

  setSpeedMode(mode) {
    if (['slow', 'normal', 'fast'].includes(mode)) {
      this.speedMode = mode;
    }
  }

  setReduceMotion(enabled) {
    this.reduceMotion = !!enabled;
  }

  setFpsLimit(fps) {
    this.fpsLimit = fps <= 35 ? 30 : 60;
  }

  wireVisibility() {
    document.addEventListener('visibilitychange', () => {
      this.isPaused = document.hidden;
      if (!this.isPaused) {
        this.lastFrameTime = performance.now();
        requestAnimationFrame((t) => this.renderLoop(t));
      }
    });
  }

  wireGestures() {
    let isDragging = false;
    let startX = 0;
    let startY = 0;

    const onDown = (clientX, clientY) => {
      isDragging = true;
      startX = clientX;
      startY = clientY;
    };

    const onMove = (clientX, clientY) => {
      if (!isDragging) return;
      const dx = clientX - startX;
      const dy = clientY - startY;
      startX = clientX;
      startY = clientY;

      this.targetRotY += dx * 0.008;
      this.targetRotX += dy * 0.008;
      // Clamp rotation angles for natural movement
      this.targetRotY = Math.max(-0.65, Math.min(0.65, this.targetRotY));
      this.targetRotX = Math.max(-0.35, Math.min(0.35, this.targetRotX));
    };

    const onUp = () => {
      isDragging = false;
    };

    this.canvas.addEventListener('mousedown', (e) => onDown(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', onUp);

    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) onDown(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    window.addEventListener('touchend', onUp);

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      this.targetZoomScale = Math.max(0.8, Math.min(1.25, this.targetZoomScale + delta));
    }, { passive: false });
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement ? this.canvas.parentElement.getBoundingClientRect() : this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = rect.width || 360;
    this.height = rect.height || 260;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.centerX = this.width / 2;
    this.centerY = this.height / 2 + 6;
    this.scale = Math.min(this.width, this.height) * 0.38;
  }

  /**
   * Generates a dense, elegant, volumetric 3D human face silhouette.
   * Completely avoids hollow eyes, skull teeth gaps, or skeletal jawbones.
   */
  initFaceMesh() {
    this.particles = [];

    const addPoint = (x, y, z, colorType, size = 1.3, feature = 'face', glow = 1.0) => {
      this.particles.push({
        bx: x,
        by: y,
        bz: z,
        x: x,
        y: y,
        z: z,
        colorType: colorType, // 'cyan', 'azure', 'gold', 'white', 'emerald'
        size: size,
        feature: feature,
        glow: glow,
        pulseOffset: Math.random() * Math.PI * 2,
        phase: Math.random() * Math.PI
      });
    };

    // 1. Warm Golden Crown & Cranium Dome (Intelligent aura from reference video)
    for (let i = 0; i < 220; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2 * Math.PI;
      const phi = Math.acos(2 * v - 1);
      if (Math.cos(phi) > 0.08) {
        const rad = 0.86 + Math.random() * 0.08;
        const x = rad * Math.sin(phi) * Math.cos(theta) * 0.84;
        const y = -(rad * Math.cos(phi) * 0.96 + 0.14);
        const z = rad * Math.sin(phi) * Math.sin(theta) * 0.88;
        const isGold = Math.random() > 0.35;
        addPoint(x, y, z, isGold ? 'gold' : 'cyan', 1.1 + Math.random() * 1.1, 'crown', 1.2);
      }
    }

    // 2. Forehead & Temples (Smooth continuous curves)
    for (let row = 0; row < 6; row++) {
      const y = -0.16 - row * 0.06;
      const count = 22 - row * 2;
      for (let c = 0; c < count; c++) {
        const u = (c / (count - 1) - 0.5) * 2;
        const x = u * 0.70 * (1 - row * 0.04);
        const z = Math.sqrt(Math.max(0, 0.52 - x * x * 0.82)) + 0.14;
        addPoint(x, y, z, row < 2 && Math.random() > 0.5 ? 'gold' : 'cyan', 1.2, 'forehead');
      }
    }

    // 3. Gentle Curved Eyebrows (Graceful arches)
    for (let side of [-1, 1]) {
      for (let i = 0; i < 11; i++) {
        const t = i / 10;
        const x = side * (0.10 + t * 0.30);
        const arch = Math.sin(t * Math.PI) * 0.055;
        const y = -0.13 - arch;
        const z = 0.74 - t * 0.07;
        addPoint(x, y, z, 'cyan', 1.5, 'eyebrow', 1.3);
      }
    }

    // 4. Natural Human Eyes (Solid volumetric almond shape with pupils, NO hollow sockets)
    for (let side of [-1, 1]) {
      const cx = side * 0.24;
      const cy = -0.05;
      const cz = 0.72;

      // Solid pupil center with soft white specular glint
      addPoint(cx, cy, cz + 0.04, 'white', 2.2, side === -1 ? 'left_pupil' : 'right_pupil', 1.8);
      addPoint(cx + side * 0.02, cy - 0.01, cz + 0.05, 'white', 1.4, 'glint', 2.0);
      addPoint(cx, cy, cz + 0.02, 'cyan', 1.8, 'iris');

      // Dense almond eye contour (Filled volume, never hollow)
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const ex = cx + Math.cos(ang) * 0.095;
        const ey = cy + Math.sin(ang) * 0.040;
        addPoint(ex, ey, cz + 0.01, 'cyan', 1.2, side === -1 ? 'left_eye' : 'right_eye');
      }
      // Upper & lower eyelids
      for (let e = 0; e < 9; e++) {
        const u = (e / 8 - 0.5) * 2;
        const lx = cx + u * 0.09;
        const ly_top = cy - 0.042 - (1 - u * u) * 0.015;
        const ly_bot = cy + 0.038 + (1 - u * u) * 0.010;
        addPoint(lx, ly_top, cz, 'azure', 1.1, 'eyelid_top');
        addPoint(lx, ly_bot, cz, 'azure', 1.0, 'eyelid_bot');
      }
    }

    // 5. Natural Sculpted Nose (Bridge, tip, and nostrils)
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const y = -0.05 + t * 0.25;
      const z = 0.73 + Math.sin(t * Math.PI * 0.85) * 0.15;
      addPoint(0, y, z, 'cyan', 1.4, 'nose', 1.2);
      if (i > 2) {
        addPoint(-0.04, y, z - 0.02, 'cyan', 1.1, 'nose');
        addPoint(0.04, y, z - 0.02, 'cyan', 1.1, 'nose');
      }
    }
    // Rounded soft nose tip and wings
    addPoint(-0.07, 0.20, 0.82, 'cyan', 1.3, 'nose');
    addPoint(0.07, 0.20, 0.82, 'cyan', 1.3, 'nose');
    addPoint(0, 0.20, 0.86, 'white', 1.6, 'nose_tip', 1.5);

    // 6. Friendly, Full Curved Lips (NO skeletal teeth gap, smiling resting curvature)
    for (let i = 0; i < 17; i++) {
      const t = (i / 16 - 0.5) * 2;
      const x = t * 0.20;
      // Cupid's bow upper lip curving softly upward at corners
      const smile = (1 - Math.abs(t)) * 0.02 - (t * t) * 0.018;
      const y_upper = 0.34 - smile;
      const z_upper = 0.76 * (1 - Math.abs(t) * 0.25);
      addPoint(x, y_upper, z_upper, 'cyan', 1.4, 'upper_lip', 1.3);
    }
    for (let i = 0; i < 15; i++) {
      const t = (i / 14 - 0.5) * 2;
      const x = t * 0.18;
      const smile = (1 - Math.abs(t)) * 0.015 - (t * t) * 0.018;
      const y_lower = 0.38 - smile;
      const z_lower = 0.75 * (1 - Math.abs(t) * 0.25);
      addPoint(x, y_lower, z_lower, 'cyan', 1.5, 'lower_lip', 1.3);
    }
    // Lip fullness midpoint (Connects lips naturally)
    for (let i = 0; i < 9; i++) {
      const t = (i / 8 - 0.5) * 2;
      addPoint(t * 0.14, 0.36 - (t * t) * 0.015, 0.77, 'azure', 1.2, 'lip_fill');
    }

    // 7. Cheeks & Soft Oval Jawline (Smooth lattice, no skull shape)
    for (let side of [-1, 1]) {
      for (let j = 0; j < 16; j++) {
        const t = j / 15;
        const x = side * (0.54 * (1 - t * 0.68));
        const y = 0.04 + t * 0.48;
        const z = 0.38 + t * 0.32;
        addPoint(x, y, z, 'cyan', 1.3, 'jaw');
      }
      // Volumetric cheek contours (3D surface)
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 5; c++) {
          const u = c / 4;
          const v = r / 3;
          const cx = side * (0.16 + u * 0.32);
          const cy = 0.04 + v * 0.22;
          const cz = 0.68 - u * 0.18 - v * 0.08;
          addPoint(cx, cy, cz, 'azure', 1.0, 'cheek');
        }
      }
    }

    // 8. Soft Rounded Chin
    for (let i = 0; i < 9; i++) {
      const t = (i / 8 - 0.5) * 2;
      const x = t * 0.10;
      const y = 0.52 + Math.abs(t) * 0.02;
      const z = 0.72;
      addPoint(x, y, z, 'cyan', 1.4, 'chin', 1.2);
    }

    // 9. Graceful Neck & Throat Structure
    for (let row = 0; row < 6; row++) {
      const y = 0.60 + row * 0.065;
      const count = 14;
      for (let c = 0; c < count; c++) {
        const ang = (c / count) * Math.PI * 2;
        const rad = 0.26 + row * 0.035;
        const x = Math.cos(ang) * rad;
        const z = Math.sin(ang) * rad * 0.78 + 0.12;
        if (z > -0.08) {
          addPoint(x, y, z, 'azure', 1.2, 'neck');
        }
      }
    }

    // 10. Holographic Upper Torso & Shoulders Silhouette
    for (let side of [-1, 1]) {
      for (let s = 0; s < 26; s++) {
        const t = s / 25;
        const x = side * (0.32 + t * 0.88);
        const y = 0.94 + t * 0.26 + Math.sin(t * Math.PI) * 0.06;
        const z = 0.22 - t * 0.32;
        addPoint(x, y, z, 'cyan', 1.4, 'shoulder', 1.2);
        // Collarbone row
        addPoint(side * (0.14 + t * 0.52), 0.88 + t * 0.07, 0.40 - t * 0.14, 'azure', 1.1, 'collar');
      }
    }

    // 11. Subtle Ambient Halo Swarm (Gentle floating particles around cranium)
    for (let i = 0; i < 60; i++) {
      const rad = 1.15 + Math.random() * 0.65;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const x = rad * Math.sin(phi) * Math.cos(theta);
      const y = rad * Math.cos(phi) * 0.88;
      const z = rad * Math.sin(phi) * Math.sin(theta);
      addPoint(x, y, z, Math.random() > 0.5 ? 'gold' : 'cyan', 0.9 + Math.random() * 0.7, 'halo', 0.8);
    }
  }

  setState(newState) {
    if (this.state === newState) return;
    this.state = newState;
    this.stateLerp = 0;

    const badge = document.getElementById('sphere-status-badge');
    const badgeText = document.getElementById('sphere-status-text');
    if (!badge || !badgeText) return;

    badge.className = 'status-badge ' + newState;
    if (newState === 'thinking') badgeText.textContent = 'THINKING ...';
    else if (newState === 'listening') badgeText.textContent = 'LISTENING ...';
    else if (newState === 'planning') badgeText.textContent = 'PLANNING ...';
    else if (newState === 'executing' || newState === 'working') badgeText.textContent = 'EXECUTING ...';
    else if (newState === 'verifying') badgeText.textContent = 'VERIFYING ...';
    else if (newState === 'speaking') badgeText.textContent = 'SPEAKING ...';
    else if (newState === 'completed') badgeText.textContent = 'COMPLETED';
    else if (newState === 'error') badgeText.textContent = 'ERROR / INTERRUPT';
    else if (newState === 'waiting') badgeText.textContent = 'WAITING FOR YOU';
    else if (newState === 'partial') badgeText.textContent = 'PARTIAL RESULT';
    else badgeText.textContent = 'SYSTEM ACTIVE';
  }

  setAudioLevel(lvl) {
    this.targetAudioLevel = Math.max(0, Math.min(1, lvl));
  }

  renderLoop(timestamp) {
    if (this.isPaused) return;

    // Delta time & Frame rate throttling
    const delta = timestamp - this.lastFrameTime;
    const interval = 1000 / this.fpsLimit;

    if (delta >= interval) {
      this.lastFrameTime = timestamp - (delta % interval);
      this.updateAndRender();
    }

    requestAnimationFrame((t) => this.renderLoop(t));
  }

  updateAndRender() {
    if (!this.ctx || !this.width) return;
    const speedMult = this.getSpeedMultiplier();

    this.time += 0.016 * speedMult;
    if (this.stateLerp < 1) this.stateLerp = Math.min(1, this.stateLerp + 0.05);

    // Audio level smoothing
    this.audioLevel += (this.targetAudioLevel - this.audioLevel) * 0.2;

    // Speech phase
    if (this.state === 'speaking') {
      this.speechPhase += 0.14 * (speedMult || 1.0);
    }

    // Gentle blinking (every 6-8 seconds, graceful)
    if (!this.reduceMotion) {
      this.blinkTimer--;
      if (this.blinkTimer <= 0) {
        this.blinkProgress += 0.08;
        if (this.blinkProgress >= 1) {
          this.blinkProgress = 0;
          this.blinkTimer = 220 + Math.random() * 160;
        }
      }
    }

    // Natural gentle idle head drift
    if (!this.reduceMotion) {
      const idleY = Math.sin(this.time * 0.8) * 0.08;
      const idleX = Math.cos(this.time * 0.6) * 0.03;
      this.rotY += (this.targetRotY + idleY - this.rotY) * 0.06;
      this.rotX += (this.targetRotX + idleX - this.rotX) * 0.06;
    } else {
      this.rotY = 0;
      this.rotX = 0;
    }
    this.zoomScale += (this.targetZoomScale - this.zoomScale) * 0.1;

    this.ctx.clearRect(0, 0, this.width, this.height);

    // 1. Draw Incoming Neural Bus Line (Left border connecting into orbital ring)
    this.drawIncomingBusCable();

    // 2. Volumetric Core Glow (Warm inner light ensures face NEVER looks hollow or skull-like)
    this.drawVolumetricCoreGlow();

    // 3. Render 3D Orbital Gyroscopic Rings
    this.renderOrbitalRings(speedMult);

    // 4. Render 3D Face Particles Mesh
    this.renderFaceParticles();
  }

  /**
   * Draws a glowing horizontal bus line from the left canvas edge directly into the face volume.
   * Visually completes the neural connection from mindmap.js!
   */
  drawIncomingBusCable() {
    const leftX = 0;
    const centerY = this.centerY;
    const connectX = this.centerX - this.scale * 1.35 * this.zoomScale;

    this.ctx.save();
    // Ambient glow track
    this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.25)';
    this.ctx.lineWidth = 2.0;
    this.ctx.beginPath();
    this.ctx.moveTo(leftX, centerY);
    this.ctx.lineTo(connectX, centerY);
    this.ctx.stroke();

    // Bright core line
    this.ctx.strokeStyle = '#00e5ff';
    this.ctx.lineWidth = 1.6;
    this.ctx.shadowColor = '#00e5ff';
    this.ctx.shadowBlur = 10;
    this.ctx.beginPath();
    this.ctx.moveTo(leftX, centerY);
    this.ctx.lineTo(connectX, centerY);
    this.ctx.stroke();

    // Moving data pulses into the face
    const speed = this.reduceMotion ? 0 : (this.time * 30) % (connectX - leftX);
    const pulseX = leftX + speed;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.shadowColor = '#00e5ff';
    this.ctx.shadowBlur = 12;
    this.ctx.beginPath();
    this.ctx.arc(pulseX, centerY, 3, 0, Math.PI * 2);
    this.ctx.fill();

    // Connection socket node
    this.ctx.fillStyle = '#00e5ff';
    this.ctx.beginPath();
    this.ctx.arc(connectX, centerY, 4, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  drawVolumetricCoreGlow() {
    const rad = this.scale * 0.95 * this.zoomScale;
    const grad = this.ctx.createRadialGradient(this.centerX, this.centerY - 10, 8, this.centerX, this.centerY - 10, rad);

    if (this.state === 'thinking' || this.state === 'planning') {
      grad.addColorStop(0, 'rgba(255, 179, 0, 0.20)');
      grad.addColorStop(0.5, 'rgba(0, 229, 255, 0.12)');
      grad.addColorStop(1, 'rgba(0, 229, 255, 0)');
    } else if (this.state === 'completed') {
      grad.addColorStop(0, 'rgba(0, 245, 155, 0.22)');
      grad.addColorStop(0.5, 'rgba(0, 229, 255, 0.12)');
      grad.addColorStop(1, 'rgba(0, 229, 255, 0)');
    } else if (this.state === 'error') {
      grad.addColorStop(0, 'rgba(255, 42, 95, 0.22)');
      grad.addColorStop(0.6, 'rgba(255, 42, 95, 0.08)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    } else {
      // Warm welcoming cyan & azure holographic light
      grad.addColorStop(0, 'rgba(0, 229, 255, 0.18)');
      grad.addColorStop(0.45, 'rgba(0, 119, 255, 0.10)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    }

    this.ctx.save();
    this.ctx.fillStyle = grad;
    this.ctx.beginPath();
    this.ctx.arc(this.centerX, this.centerY - 10, rad, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  renderOrbitalRings(speedMult) {
    let speedBonus = 1.0;
    if (this.state === 'thinking' || this.state === 'planning') speedBonus = 1.4;
    else if (this.state === 'executing') speedBonus = 1.2;

    for (let r = 0; r < this.rings.length; r++) {
      const ring = this.rings[r];
      if (!this.reduceMotion) {
        ring.angle += ring.speed * speedMult * speedBonus;
      }

      this.ctx.save();
      this.ctx.translate(this.centerX, this.centerY);

      this.ctx.rotate(ring.tiltZ);
      this.ctx.scale(1, Math.cos(ring.tiltX));
      this.ctx.rotate(ring.angle);

      // Smooth cybernetic ring with restrained dashing
      this.ctx.strokeStyle = ring.color;
      this.ctx.lineWidth = 1.2;
      this.ctx.setLineDash([6, 14, 24, 10]);
      this.ctx.lineDashOffset = -this.time * 8;

      const ringPixelRadius = ring.radius * this.scale * this.zoomScale;
      this.ctx.beginPath();
      this.ctx.arc(0, 0, ringPixelRadius, 0, Math.PI * 2);
      this.ctx.stroke();

      // Satellite beacon
      const beaconAngle = ring.angle * 1.8;
      const bx = Math.cos(beaconAngle) * ringPixelRadius;
      const by = Math.sin(beaconAngle) * ringPixelRadius;

      this.ctx.fillStyle = '#ffffff';
      this.ctx.shadowColor = '#00e5ff';
      this.ctx.shadowBlur = 6;
      this.ctx.beginPath();
      this.ctx.arc(bx, by, 2.0, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.restore();
    }
  }

  renderFaceParticles() {
    const cosY = Math.cos(this.rotY), sinY = Math.sin(this.rotY);
    const cosX = Math.cos(this.rotX), sinX = Math.sin(this.rotX);

    const projected = [];
    const blinkScale = this.blinkProgress > 0 ? (1 - Math.sin(this.blinkProgress * Math.PI) * 0.90) : 1;
    const mouthOpen = this.state === 'speaking' ? (Math.sin(this.speechPhase) * 0.05 + this.audioLevel * 0.07) : 0;
    const effectiveScale = this.scale * this.zoomScale;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];

      let px = p.bx;
      let py = p.by;
      let pz = p.bz;

      // Natural eye blinking
      if (p.feature.includes('pupil') || p.feature.includes('eye') || p.feature === 'glint') {
        py = (py - (-0.05)) * blinkScale + (-0.05);
      } else if (p.feature === 'lower_lip') {
        py += mouthOpen;
      } else if (p.feature === 'upper_lip') {
        py -= mouthOpen * 0.35;
      }

      // Gentle organic breathing pulse
      if (!this.reduceMotion) {
        const breath = Math.sin(this.time * 1.5 + p.pulseOffset) * 0.012;
        const audioP = this.audioLevel * 0.08;
        px *= (1 + breath + audioP);
        py *= (1 + breath + audioP);
        pz *= (1 + breath + audioP);
      }

      // 3D Rotation Y
      const x1 = px * cosY + pz * sinY;
      const y1 = py;
      const z1 = -px * sinY + pz * cosY;

      // 3D Rotation X
      const x2 = x1;
      const y2 = y1 * cosX - z1 * sinX;
      const z2 = y1 * sinX + z1 * cosX;

      // Perspective Projection
      const cameraDist = 4.4;
      const fov = cameraDist / (cameraDist + z2);
      const projX = this.centerX + x2 * effectiveScale * fov;
      const projY = this.centerY + y2 * effectiveScale * fov;

      // Depth alpha and size
      const alpha = Math.max(0.18, Math.min(1.0, (z2 + 1.25) / 2.0));
      const size = Math.max(0.7, p.size * fov);

      projected.push({
        x: projX,
        y: projY,
        z: z2,
        size: size,
        alpha: alpha,
        colorType: p.colorType,
        feature: p.feature,
        glow: p.glow
      });
    }

    // Depth Sorting
    projected.sort((a, b) => a.z - b.z);

    // Subtle neural filament connections when thinking
    if ((this.state === 'thinking' || this.state === 'planning') && !this.reduceMotion) {
      this.ctx.lineWidth = 0.5;
      for (let i = 0; i < projected.length; i += 5) {
        const p1 = projected[i];
        if (p1.z < 0.1) continue;
        for (let j = i + 1; j < Math.min(i + 6, projected.length); j++) {
          const p2 = projected[j];
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 22) {
            const fAlpha = (1 - dist / 22) * 0.25 * p1.alpha;
            this.ctx.strokeStyle = `rgba(0, 229, 255, ${fAlpha})`;
            this.ctx.beginPath();
            this.ctx.moveTo(p1.x, p1.y);
            this.ctx.lineTo(p2.x, p2.y);
            this.ctx.stroke();
          }
        }
      }
    }

    // Draw particles
    for (let i = 0; i < projected.length; i++) {
      const p = projected[i];

      let r = 0, g = 229, b = 255; // Cyan
      if (p.colorType === 'gold') {
        r = 255; g = 185; b = 30; // Shimmering Gold
      } else if (p.colorType === 'azure') {
        r = 0; g = 135; b = 255; // Azure depth
      } else if (p.colorType === 'white') {
        r = 255; g = 255; b = 255; // Pupil highlight
      } else if (this.state === 'completed') {
        r = 0; g = 245; b = 155; // Emerald on completion
      }

      if (this.state === 'error') {
        r = 255; g = 42; b = 95;
      }

      this.ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${p.alpha})`;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      this.ctx.fill();

      // Specular glow on pupils and nose tip
      if (p.feature.includes('pupil') && p.z > 0.25) {
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.size * 1.3, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
  }
}

window.OmaHoloFace = OmaHoloFace;
window.OmaHoloOrb = OmaHoloFace;
