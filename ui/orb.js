/**
 * Oma AI Agent - 3D Holographic Particle Sphere & Orbital Gyroscope
 * Recreates the exact futuristic neural sphere seen in the PC in 2070 video.
 */
class OmaHoloOrb {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.particleCount = 520;
    this.radius = 68;
    this.rotX = 0;
    this.rotY = 0;
    this.rotZ = 0;
    this.state = 'active'; // 'active', 'thinking', 'listening', 'executing', 'idle'
    this.audioLevel = 0;
    this.time = 0;

    // Rings
    this.rings = [
      { radius: 88, tiltX: 0.8, tiltZ: 0.3, speed: 0.015, angle: 0, color: 'rgba(0, 229, 255, 0.45)' },
      { radius: 96, tiltX: -0.6, tiltZ: 0.9, speed: -0.012, angle: 0, color: 'rgba(255, 179, 0, 0.45)' },
      { radius: 80, tiltX: 0.2, tiltZ: -0.7, speed: 0.02, angle: 0, color: 'rgba(0, 245, 155, 0.35)' }
    ];

    this.initParticles();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.animate();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.centerX = this.width / 2;
    this.centerY = this.height / 2;
    this.radius = Math.min(this.width, this.height) * 0.26;
    this.rings[0].radius = this.radius * 1.35;
    this.rings[1].radius = this.radius * 1.48;
    this.rings[2].radius = this.radius * 1.25;
  }

  initParticles() {
    this.particles = [];
    const phi = Math.PI * (3 - Math.sqrt(5)); // Golden ratio angle
    for (let i = 0; i < this.particleCount; i++) {
      const y = 1 - (i / (this.particleCount - 1)) * 2; // y goes from 1 to -1
      const radiusAtY = Math.sqrt(1 - y * y);
      const theta = phi * i;
      const x = Math.cos(theta) * radiusAtY;
      const z = Math.sin(theta) * radiusAtY;

      // Color palette from video: cyan, emerald green, warm gold
      const pType = Math.random();
      let color = 'rgba(0, 229, 255, ';
      if (pType > 0.7) color = 'rgba(255, 179, 0, ';
      else if (pType > 0.45) color = 'rgba(0, 245, 155, ';

      this.particles.push({
        baseX: x,
        baseY: y,
        baseZ: z,
        color: color,
        size: 1.2 + Math.random() * 1.6,
        pulseOffset: Math.random() * Math.PI * 2,
        noiseSpeed: 0.8 + Math.random() * 1.2
      });
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

    this.ctx.clearRect(0, 0, this.width, this.height);

    // Dynamic rotation speeds based on state
    let speedMult = 1.0;
    if (this.state === 'thinking') speedMult = 2.4;
    else if (this.state === 'executing') speedMult = 1.8;
    else if (this.state === 'listening') speedMult = 1.2;

    this.rotY += 0.008 * speedMult;
    this.rotX += 0.004 * speedMult;
    this.rotZ += 0.002 * speedMult;

    // Draw central glowing aura
    const gradient = this.ctx.createRadialGradient(
      this.centerX, this.centerY, 5,
      this.centerX, this.centerY, this.radius * 1.4
    );
    if (this.state === 'thinking') {
      gradient.addColorStop(0, 'rgba(255, 179, 0, 0.22)');
      gradient.addColorStop(0.5, 'rgba(255, 179, 0, 0.06)');
      gradient.addColorStop(1, 'transparent');
    } else {
      gradient.addColorStop(0, 'rgba(0, 229, 255, 0.2)');
      gradient.addColorStop(0.5, 'rgba(0, 229, 255, 0.05)');
      gradient.addColorStop(1, 'transparent');
    }
    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.arc(this.centerX, this.centerY, this.radius * 1.4, 0, Math.PI * 2);
    this.ctx.fill();

    // Render Orbital Gyroscope Rings
    this.renderRings();

    // Transform and project particles
    const cosY = Math.cos(this.rotY), sinY = Math.sin(this.rotY);
    const cosX = Math.cos(this.rotX), sinX = Math.sin(this.rotX);
    const cosZ = Math.cos(this.rotZ), sinZ = Math.sin(this.rotZ);

    const projectedParticles = [];

    const pulse = Math.sin(this.time * 2) * 0.05;
    const audioExpansion = this.audioLevel * 0.35;
    const currentRadius = this.radius * (1 + pulse + audioExpansion);

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];

      // Add dynamic noise vibration
      let nx = p.baseX;
      let ny = p.baseY;
      let nz = p.baseZ;

      if (this.state === 'thinking' || this.audioLevel > 0.05) {
        const vibration = Math.sin(this.time * p.noiseSpeed * 4 + p.pulseOffset) * (0.04 + this.audioLevel * 0.1);
        nx += nx * vibration;
        ny += ny * vibration;
        nz += nz * vibration;
      }

      // Rotate Y
      let x1 = nx * cosY + nz * sinY;
      let y1 = ny;
      let z1 = -nx * sinY + nz * cosY;

      // Rotate X
      let x2 = x1;
      let y2 = y1 * cosX - z1 * sinX;
      let z2 = y1 * sinX + z1 * cosX;

      // Rotate Z
      let x3 = x2 * cosZ - y2 * sinZ;
      let y3 = x2 * sinZ + y2 * cosZ;
      let z3 = z2;

      // Perspective projection
      const cameraDist = 280;
      const fov = cameraDist / (cameraDist + z3 * currentRadius);
      const projX = this.centerX + x3 * currentRadius * fov;
      const projY = this.centerY + y3 * currentRadius * fov;

      // Depth alpha
      const alpha = Math.max(0.12, Math.min(1, (z3 + 1.2) / 2.2));
      const size = Math.max(0.8, p.size * fov);

      projectedParticles.push({
        x: projX,
        y: projY,
        z: z3,
        size: size,
        alpha: alpha,
        color: p.color
      });
    }

    // Sort by depth (back to front)
    projectedParticles.sort((a, b) => a.z - b.z);

    // Draw connecting neural filament web between close particles
    if (this.state === 'thinking' || this.state === 'executing') {
      this.ctx.lineWidth = 0.5;
      for (let i = 0; i < projectedParticles.length; i += 3) {
        const p1 = projectedParticles[i];
        if (p1.z < 0) continue; // Only front particles
        for (let j = i + 1; j < Math.min(i + 8, projectedParticles.length); j++) {
          const p2 = projectedParticles[j];
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 28) {
            const filamentAlpha = (1 - dist / 28) * 0.25 * p1.alpha;
            this.ctx.strokeStyle = `rgba(0, 229, 255, ${filamentAlpha})`;
            this.ctx.beginPath();
            this.ctx.moveTo(p1.x, p1.y);
            this.ctx.lineTo(p2.x, p2.y);
            this.ctx.stroke();
          }
        }
      }
    }

    // Render particles
    for (let i = 0; i < projectedParticles.length; i++) {
      const p = projectedParticles[i];
      this.ctx.fillStyle = p.color + p.alpha + ')';
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      this.ctx.fill();

      // Shimmer halo on bright front particles
      if (p.z > 0.6 && Math.random() > 0.8) {
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
  }

  renderRings() {
    for (let r = 0; r < this.rings.length; r++) {
      const ring = this.rings[r];
      ring.angle += ring.speed;

      this.ctx.save();
      this.ctx.translate(this.centerX, this.centerY);

      // Rotate ring plane
      this.ctx.rotate(ring.tiltZ);
      this.ctx.scale(1, Math.cos(ring.tiltX));
      this.ctx.rotate(ring.angle);

      // Draw dashed futuristic orbit ring
      this.ctx.strokeStyle = ring.color;
      this.ctx.lineWidth = 1.2;
      this.ctx.setLineDash([4, 12, 16, 8]);
      this.ctx.lineDashOffset = -this.time * 20;

      this.ctx.beginPath();
      this.ctx.arc(0, 0, ring.radius, 0, Math.PI * 2);
      this.ctx.stroke();

      // Draw orbiting satellites/beacons along the ring
      const beaconAngle = ring.angle * 2;
      const bx = Math.cos(beaconAngle) * ring.radius;
      const by = Math.sin(beaconAngle) * ring.radius;

      this.ctx.fillStyle = '#ffffff';
      this.ctx.beginPath();
      this.ctx.arc(bx, by, 2.2, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.restore();
    }
  }
}

window.OmaHoloOrb = OmaHoloOrb;
