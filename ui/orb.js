/**
 * Oma AI Agent - Holographic Human-Shaped AI Face & Neural Particle System
 * Recreates the exact holographic android face with upper body silhouette and
 * 3D orbital gyroscopic rings from the PC in 2070 reference video.
 */

class OmaHoloFace {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.filaments = [];
    this.time = 0;
    this.state = 'active'; // 'active', 'listening', 'thinking', 'planning', 'executing', 'speaking', 'completed', 'error'
    this.audioLevel = 0;
    this.blinkProgress = 0;
    this.blinkTimer = 120;
    this.speechPhase = 0;
    this.scanY = -1.5;

    // Head orientation angles (radians)
    this.rotY = 0;
    this.rotX = 0;
    this.targetRotY = 0;
    this.targetRotX = 0;

    // 3D Orbital Gyroscopic Rings (from reference video)
    this.rings = [
      { radius: 1.45, tiltX: 0.85, tiltZ: 0.35, speed: 0.012, angle: 0, color: 'rgba(0, 229, 255, 0.45)' },
      { radius: 1.62, tiltX: -0.65, tiltZ: 0.95, speed: -0.010, angle: 0.8, color: 'rgba(255, 179, 0, 0.45)' },
      { radius: 1.35, tiltX: 0.25, tiltZ: -0.75, speed: 0.016, angle: 1.6, color: 'rgba(0, 245, 155, 0.35)' }
    ];

    this.initFaceParticles();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.animate();
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement ? this.canvas.parentElement.getBoundingClientRect() : this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width || 360;
    this.height = rect.height || 260;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.centerX = this.width / 2;
    this.centerY = this.height / 2 + 10;
    this.scale = Math.min(this.width, this.height) * 0.36;
  }

  /**
   * Generates a 3D point cloud of a stylized human head, facial features, neck, and shoulders.
   */
  initFaceParticles() {
    this.particles = [];

    const addP = (x, y, z, colorType, size = 1.3, feature = 'face') => {
      this.particles.push({
        bx: x,
        by: y,
        bz: z,
        x: x,
        y: y,
        z: z,
        colorType: colorType, // 'gold', 'cyan', 'emerald', 'white'
        size: size,
        feature: feature,
        pulseOffset: Math.random() * Math.PI * 2,
        jitterSpeed: 0.6 + Math.random() * 0.8
      });
    };

    // 1. Cranium & Top Head (Shimmering Golden/Amber Particles - from reference video)
    for (let i = 0; i < 160; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2 * Math.PI;
      const phi = Math.acos(2 * v - 1);
      // Upper hemisphere
      if (Math.cos(phi) > 0.05) {
        const rad = 0.85 + Math.random() * 0.05;
        const x = rad * Math.sin(phi) * Math.cos(theta) * 0.82;
        const y = -(rad * Math.cos(phi) * 0.95 + 0.15); // Top is negative Y
        const z = rad * Math.sin(phi) * Math.sin(theta) * 0.88;
        addP(x, y, z, 'gold', 1.2 + Math.random() * 1.2, 'cranium');
      }
    }

    // 2. Forehead & Temples
    for (let row = 0; row < 5; row++) {
      const y = -0.15 - row * 0.07;
      const count = 18 - row * 2;
      for (let c = 0; c < count; c++) {
        const u = (c / (count - 1) - 0.5) * 2;
        const x = u * 0.68 * (1 - row * 0.05);
        const z = Math.sqrt(Math.max(0, 0.49 - x * x * 0.8)) + 0.12;
        addP(x, y, z, Math.random() > 0.4 ? 'gold' : 'cyan', 1.3, 'forehead');
      }
    }

    // 3. Eyebrows (Arched Cyan Ridges)
    for (let side of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        const x = side * (0.12 + t * 0.28);
        const arch = Math.sin(t * Math.PI) * 0.06;
        const y = -0.12 - arch;
        const z = 0.72 - t * 0.08;
        addP(x, y, z, 'cyan', 1.6, 'brow');
      }
    }

    // 4. Eyes & Pupils (Bright Cyan/White Clusters)
    for (let side of [-1, 1]) {
      const cx = side * 0.25;
      const cy = -0.04;
      const cz = 0.70;
      // Pupil Center
      addP(cx, cy, cz + 0.04, 'white', 2.4, side === -1 ? 'left_pupil' : 'right_pupil');
      addP(cx, cy, cz + 0.02, 'cyan', 1.8, side === -1 ? 'left_pupil' : 'right_pupil');

      // Eye contour (Almond shape)
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const ex = cx + Math.cos(ang) * 0.11;
        const ey = cy + Math.sin(ang) * 0.045;
        addP(ex, ey, cz, 'cyan', 1.3, side === -1 ? 'left_eye' : 'right_eye');
      }
    }

    // 5. Nose Bridge and Tip
    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      const y = -0.04 + t * 0.24;
      const z = 0.72 + Math.sin(t * Math.PI * 0.8) * 0.14;
      addP(0, y, z, 'cyan', 1.4, 'nose');
      if (i > 3) {
        // Nose bridge width
        addP(-0.04, y, z - 0.02, 'cyan', 1.1, 'nose');
        addP(0.04, y, z - 0.02, 'cyan', 1.1, 'nose');
      }
    }
    // Nostrils & Base
    addP(-0.08, 0.21, 0.80, 'cyan', 1.3, 'nose');
    addP(0.08, 0.21, 0.80, 'cyan', 1.3, 'nose');

    // 6. Mouth & Lips (Responsive to Speech and Smiles)
    for (let i = 0; i < 15; i++) {
      const t = (i / 14 - 0.5) * 2; // -1 to 1
      const x = t * 0.22;
      const y = 0.35 + Math.abs(t) * 0.03; // Upper lip cupid's bow
      const z = 0.74 * (1 - Math.abs(t) * 0.3);
      addP(x, y, z, 'cyan', 1.4, 'upper_lip');
    }
    for (let i = 0; i < 13; i++) {
      const t = (i / 12 - 0.5) * 2;
      const x = t * 0.19;
      const y = 0.41 - Math.abs(t) * 0.02; // Lower lip
      const z = 0.73 * (1 - Math.abs(t) * 0.3);
      addP(x, y, z, 'cyan', 1.5, 'lower_lip');
    }

    // 7. Cheeks & Jawline
    for (let side of [-1, 1]) {
      for (let j = 0; j < 14; j++) {
        const t = j / 13;
        const x = side * (0.58 * (1 - t * 0.75));
        const y = 0.05 + t * 0.52;
        const z = 0.35 + t * 0.34;
        addP(x, y, z, 'cyan', 1.4, 'jaw');
      }
      // Cheek mass
      for (let c = 0; c < 12; c++) {
        const u = Math.random();
        const v = Math.random();
        const cx = side * (0.28 + u * 0.24);
        const cy = 0.05 + v * 0.22;
        const cz = 0.62 - u * 0.15;
        addP(cx, cy, cz, 'cyan', 1.1, 'cheek');
      }
    }

    // 8. Chin
    for (let i = 0; i < 7; i++) {
      const t = (i / 6 - 0.5) * 2;
      const x = t * 0.11;
      const y = 0.58 + Math.abs(t) * 0.02;
      const z = 0.70;
      addP(x, y, z, 'cyan', 1.5, 'chin');
    }

    // 9. Neck & Throat
    for (let row = 0; row < 5; row++) {
      const y = 0.65 + row * 0.07;
      const count = 12;
      for (let c = 0; c < count; c++) {
        const ang = (c / count) * Math.PI * 2;
        const rad = 0.28 + row * 0.03;
        const x = Math.cos(ang) * rad;
        const z = Math.sin(ang) * rad * 0.75 + 0.15;
        if (z > -0.1) {
          addP(x, y, z, 'cyan', 1.2, 'neck');
        }
      }
    }

    // 10. Shoulders & Upper Chest Silhouette (Holographic Torso)
    for (let side of [-1, 1]) {
      for (let s = 0; s < 22; s++) {
        const t = s / 21;
        const x = side * (0.35 + t * 0.82);
        const y = 0.95 + t * 0.28 + Math.sin(t * Math.PI) * 0.08;
        const z = 0.25 - t * 0.35;
        addP(x, y, z, 'cyan', 1.5, 'shoulder');
        // Collarbone row
        addP(side * (0.15 + t * 0.5), 0.90 + t * 0.08, 0.42 - t * 0.12, 'cyan', 1.2, 'collar');
      }
    }

    // 11. Ambient Floating Holographic Dust Swarm
    for (let i = 0; i < 70; i++) {
      const rad = 1.1 + Math.random() * 0.7;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const x = rad * Math.sin(phi) * Math.cos(theta);
      const y = rad * Math.cos(phi) * 0.9;
      const z = rad * Math.sin(phi) * Math.sin(theta);
      addP(x, y, z, Math.random() > 0.6 ? 'gold' : 'cyan', 0.9 + Math.random() * 0.8, 'halo');
    }
  }

  setState(newState) {
    this.state = newState;
    const badge = document.getElementById('sphere-status-badge');
    const badgeText = document.getElementById('sphere-status-text');
    if (!badge || !badgeText) return;

    badge.className = 'status-badge ' + newState;
    if (newState === 'thinking') {
      badgeText.textContent = 'THINKING ...';
    } else if (newState === 'listening') {
      badgeText.textContent = 'LISTENING ...';
    } else if (newState === 'executing') {
      badgeText.textContent = 'EXECUTING ...';
    } else if (newState === 'speaking') {
      badgeText.textContent = 'SPEAKING ...';
    } else if (newState === 'completed') {
      badgeText.textContent = 'TASK COMPLETED';
    } else if (newState === 'error') {
      badgeText.textContent = 'ERROR OCCURRED';
    } else {
      badgeText.textContent = 'SYSTEM ACTIVE';
    }
  }

  setAudioLevel(level) {
    this.audioLevel = Math.min(Math.max(level, 0), 1);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.time += 0.02;

    if (!this.ctx || !this.width) return;
    this.ctx.clearRect(0, 0, this.width, this.height);

    // Natural head drift & gaze tracking
    this.blinkTimer--;
    if (this.blinkTimer <= 0) {
      this.blinkProgress += 0.2;
      if (this.blinkProgress >= 1) {
        this.blinkProgress = 0;
        this.blinkTimer = 140 + Math.random() * 120;
      }
    }

    // Multi-state animation logic
    let rotSpeed = 0.005;
    let targetX = 0;
    let targetY = 0;

    if (this.state === 'listening') {
      targetX = 0.08; // Slight attentive nod forward
      targetY = Math.sin(this.time * 1.5) * 0.06;
      rotSpeed = 0.008;
    } else if (this.state === 'thinking' || this.state === 'planning') {
      targetX = -0.05; // Slight tilt up while thinking
      targetY = Math.sin(this.time * 2.5) * 0.15;
      rotSpeed = 0.025;
    } else if (this.state === 'executing') {
      targetX = Math.sin(this.time * 2) * 0.04;
      targetY = Math.cos(this.time * 2) * 0.08;
      this.scanY += 0.035;
      if (this.scanY > 1.5) this.scanY = -1.5;
    } else if (this.state === 'speaking') {
      this.speechPhase += 0.25;
      targetX = Math.sin(this.speechPhase * 0.5) * 0.05;
      targetY = Math.sin(this.speechPhase * 0.3) * 0.07;
    } else if (this.state === 'completed') {
      targetX = 0.04;
      targetY = 0;
    } else {
      // Idle / System Active
      targetY = Math.sin(this.time * 0.8) * 0.08;
      targetX = Math.cos(this.time * 0.5) * 0.03;
    }

    this.rotX += (targetX - this.rotX) * 0.06;
    this.rotY += (targetY - this.rotY) * 0.06;

    // Draw holographic central back-glow aura
    const glowRadius = this.scale * 1.35;
    const grad = this.ctx.createRadialGradient(
      this.centerX, this.centerY, 10,
      this.centerX, this.centerY, glowRadius
    );

    if (this.state === 'thinking' || this.state === 'planning') {
      grad.addColorStop(0, 'rgba(255, 179, 0, 0.20)');
      grad.addColorStop(0.5, 'rgba(255, 179, 0, 0.05)');
      grad.addColorStop(1, 'transparent');
    } else if (this.state === 'completed') {
      grad.addColorStop(0, 'rgba(0, 245, 155, 0.22)');
      grad.addColorStop(0.5, 'rgba(0, 245, 155, 0.06)');
      grad.addColorStop(1, 'transparent');
    } else if (this.state === 'error') {
      grad.addColorStop(0, 'rgba(255, 42, 95, 0.25)');
      grad.addColorStop(0.5, 'rgba(255, 42, 95, 0.08)');
      grad.addColorStop(1, 'transparent');
    } else {
      grad.addColorStop(0, 'rgba(0, 229, 255, 0.18)');
      grad.addColorStop(0.5, 'rgba(0, 229, 255, 0.04)');
      grad.addColorStop(1, 'transparent');
    }

    this.ctx.fillStyle = grad;
    this.ctx.beginPath();
    this.ctx.arc(this.centerX, this.centerY, glowRadius, 0, Math.PI * 2);
    this.ctx.fill();

    // Render 3D Orbital Gyroscopic Rings
    this.renderOrbitalRings();

    // 3D Transform Particles
    const cosY = Math.cos(this.rotY), sinY = Math.sin(this.rotY);
    const cosX = Math.cos(this.rotX), sinX = Math.sin(this.rotX);

    const projected = [];
    const blinkScale = this.blinkProgress > 0 ? (1 - Math.sin(this.blinkProgress * Math.PI) * 0.85) : 1;
    const mouthSpeechOpen = this.state === 'speaking' ? (Math.sin(this.speechPhase) * 0.08 + this.audioLevel * 0.12) : 0;
    const smileSmileOffset = this.state === 'completed' ? 0.04 : 0;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];

      let px = p.bx;
      let py = p.by;
      let pz = p.bz;

      // Facial feature dynamic motions
      if (p.feature.includes('pupil') || p.feature.includes('eye')) {
        py = (py - (-0.04)) * blinkScale + (-0.04);
      } else if (p.feature === 'lower_lip') {
        py += mouthSpeechOpen - smileSmileOffset;
      } else if (p.feature === 'upper_lip') {
        py -= mouthSpeechOpen * 0.5 - smileSmileOffset;
      } else if (p.feature === 'jaw' || p.feature === 'chin') {
        py += mouthSpeechOpen * 0.6;
      }

      // Breathing / Audio reactivity
      const breath = Math.sin(this.time * 2 + p.pulseOffset) * 0.02;
      const audioPulse = this.audioLevel * 0.15;
      px *= (1 + breath + audioPulse);
      py *= (1 + breath + audioPulse);
      pz *= (1 + breath + audioPulse);

      // Jitter on thinking / error
      if (this.state === 'thinking') {
        px += (Math.random() - 0.5) * 0.02;
        py += (Math.random() - 0.5) * 0.02;
      } else if (this.state === 'error') {
        px += (Math.random() - 0.5) * 0.05;
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
      const cameraDist = 4.2;
      const fov = cameraDist / (cameraDist + z2);
      const projX = this.centerX + x2 * this.scale * fov;
      const projY = this.centerY + y2 * this.scale * fov;

      // Depth Alpha
      const alpha = Math.max(0.15, Math.min(1.0, (z2 + 1.2) / 2.0));
      const size = Math.max(0.7, p.size * fov);

      projected.push({
        x: projX,
        y: projY,
        z: z2,
        origY: py,
        size: size,
        alpha: alpha,
        colorType: p.colorType,
        feature: p.feature
      });
    }

    // Depth Sorting
    projected.sort((a, b) => a.z - b.z);

    // Neural Filament connections between close face points
    if (this.state === 'thinking' || this.state === 'planning') {
      this.ctx.lineWidth = 0.5;
      for (let i = 0; i < projected.length; i += 4) {
        const p1 = projected[i];
        if (p1.z < 0) continue;
        for (let j = i + 1; j < Math.min(i + 7, projected.length); j++) {
          const p2 = projected[j];
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 26) {
            const fAlpha = (1 - dist / 26) * 0.35 * p1.alpha;
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

      let fillColor = 'rgba(0, 229, 255, ';
      if (p.colorType === 'gold') {
        fillColor = 'rgba(255, 179, 0, ';
      } else if (p.colorType === 'emerald' || this.state === 'completed') {
        fillColor = 'rgba(0, 245, 155, ';
      } else if (p.colorType === 'white') {
        fillColor = 'rgba(255, 255, 255, ';
      }

      if (this.state === 'error') {
        fillColor = 'rgba(255, 42, 95, ';
      }

      this.ctx.fillStyle = fillColor + p.alpha + ')';
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      this.ctx.fill();

      // Shimmer on pupils and bright feature points
      if (p.feature.includes('pupil') && p.z > 0.3) {
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.size * 1.5, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }

    // Holographic Scanline in 'executing' mode
    if (this.state === 'executing') {
      const scanPixelY = this.centerY + this.scanY * this.scale;
      const scanGrad = this.ctx.createLinearGradient(0, scanPixelY - 12, 0, scanPixelY + 12);
      scanGrad.addColorStop(0, 'rgba(0, 229, 255, 0)');
      scanGrad.addColorStop(0.5, 'rgba(0, 229, 255, 0.45)');
      scanGrad.addColorStop(1, 'rgba(0, 229, 255, 0)');

      this.ctx.fillStyle = scanGrad;
      this.ctx.fillRect(this.centerX - this.scale * 1.2, scanPixelY - 8, this.scale * 2.4, 16);
    }
  }

  renderOrbitalRings() {
    let speedMult = 1.0;
    if (this.state === 'thinking' || this.state === 'planning') speedMult = 2.4;
    else if (this.state === 'executing') speedMult = 1.8;

    for (let r = 0; r < this.rings.length; r++) {
      const ring = this.rings[r];
      ring.angle += ring.speed * speedMult;

      this.ctx.save();
      this.ctx.translate(this.centerX, this.centerY);

      this.ctx.rotate(ring.tiltZ);
      this.ctx.scale(1, Math.cos(ring.tiltX));
      this.ctx.rotate(ring.angle);

      // Dashed holographic cyber ring
      this.ctx.strokeStyle = ring.color;
      this.ctx.lineWidth = 1.3;
      this.ctx.setLineDash([4, 12, 18, 8]);
      this.ctx.lineDashOffset = -this.time * 24;

      const ringPixelRadius = ring.radius * this.scale;
      this.ctx.beginPath();
      this.ctx.arc(0, 0, ringPixelRadius, 0, Math.PI * 2);
      this.ctx.stroke();

      // Orbiting satellite beacons along the ring
      const beaconAngle = ring.angle * 2.2;
      const bx = Math.cos(beaconAngle) * ringPixelRadius;
      const by = Math.sin(beaconAngle) * ringPixelRadius;

      this.ctx.fillStyle = '#ffffff';
      this.ctx.beginPath();
      this.ctx.arc(bx, by, 2.2, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.restore();
    }
  }
}

// Export for compatibility
window.OmaHoloFace = OmaHoloFace;
window.OmaHoloOrb = OmaHoloFace;
