/**
 * Left column of the Oma window (Stonic layout): Media Link, Sat-Link globe, Today Headlines.
 *  - Globe: Natural Earth land mask (world_mask.js) as dots, orthographic 3D or flat 2D; hotspots are today's real
 *    headlines placed by the country they name (multi_ai/world.py). Drag to turn; the â¤¢ button opens the full
 *    World Monitor (worldmonitor.app) in its own Oma window.
 *  - Media Link: camera or screen, shown live; while it is on, a frame is attached to the next question you send.
 */
(() => {
  const $ = id => document.getElementById(id);
  const post = m => window.webkit?.messageHandlers?.st?.postMessage(m);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let land = [], spots = [], mode = '3d', rot = -90 * Math.PI / 180, tilt = 0.35, drag = null, raf = 0, hover = null;

  function decode() {
    const m = window.OMA_LAND; if (!m) return;
    const bin = atob(m.b64);
    for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
      const k = j * m.w + i;
      if (bin.charCodeAt(k >> 3) & (1 << (k & 7))) land.push([90 - (j + 0.5) * 180 / m.h, -180 + (i + 0.5) * 360 / m.w]);
    }
  }
  const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim() || '0,229,255';

  function proj(lat, lon, R, cx, cy) {
    if (mode === '2d') return [cx + lon / 180 * R * 1.9, cy - lat / 90 * R * 0.95, 1];
    const la = lat * Math.PI / 180, lo = lon * Math.PI / 180 + rot;
    const x = Math.cos(la) * Math.sin(lo), y = Math.sin(la), z = Math.cos(la) * Math.cos(lo);
    const y2 = y * Math.cos(tilt) - z * Math.sin(tilt), z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
    return [cx + x * R, cy - y2 * R, z2];
  }

  let lastDraw = 0;
  function draw(t) {
    raf = 0;
    const c = $('globeCanvas'); if (!c || document.hidden) return;
    if (!drag && t - lastDraw < 66) { raf = requestAnimationFrame(draw); return; }   // 15 fps is plenty for a slow globe (CPU)
    lastDraw = t;
    const w = c.clientWidth, h = c.clientHeight, d = Math.min(devicePixelRatio || 1, 2);
    if (c.width !== Math.round(w * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
    const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
    const A = accent(), cx = w / 2, cy = h / 2, R = mode === '2d' ? Math.min(w / 3.9, h / 2.1) : Math.min(w, h) * 0.42;
    if (mode === '3d') {
      const gr = g.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
      gr.addColorStop(0, `rgba(${A},.10)`); gr.addColorStop(1, 'rgba(10,14,20,.9)');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R, 0, 6.283); g.fill();
      g.strokeStyle = `rgba(${A},.25)`; g.lineWidth = 1; g.stroke();
    } else { g.strokeStyle = `rgba(${A},.12)`; g.strokeRect(cx - R * 1.9, cy - R * 0.95, R * 3.8, R * 1.9); }
    for (const [la, lo] of land) {
      const [x, y, z] = proj(la, lo, R, cx, cy); if (z <= 0) continue;
      g.fillStyle = `rgba(${A},${mode === '2d' ? 0.45 : 0.15 + z * 0.55})`; g.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
    }
    hover = null;
    for (const s of spots) {
      const [x, y, z] = proj(s.lat, s.lon, R, cx, cy); if (z <= 0.05) continue;
      const pulse = 2.5 + Math.sin(t / 300 + s.lat) * 1.2, col = s.alert ? '255,90,60' : '255,190,70';
      g.fillStyle = `rgba(${col},.25)`; g.beginPath(); g.arc(x, y, pulse + 3, 0, 6.283); g.fill();
      g.fillStyle = `rgb(${col})`; g.beginPath(); g.arc(x, y, 2.2, 0, 6.283); g.fill();
      s._x = x; s._y = y;
    }
    if (!drag && mode === '3d') rot += 0.01;
    raf = requestAnimationFrame(draw);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(draw); };

  function headlines(d) {
    const items = (d && d.items) || [];
    spots = items.filter(i => i.lat != null);
    const box = $('headlineList'); if (!box) return;
    box.innerHTML = items.slice(0, 12).map((i, n) => `<a class="hl ${i.alert ? 'alert' : ''}" href="${esc(i.link)}" target="_blank" title="${esc(i.source)}${i.place ? ' Â· ' + esc(i.place) : ''}">
      <span class="n">${String(n + 1).padStart(2, '0')}</span><span>${esc(i.title)}</span></a>`).join('') || '<div class="hl">No headlines (offline?)</div>';
    const s = $('headlineStamp'); if (s) s.textContent = d && d.at ? new Date(d.at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + (d.stale ? ' Â· offline' : '') : '';
    kick();
  }

  /* ---------------- Media Link */
  let stream = null;
  async function media(kind) {
    stopMedia();
    try {
      stream = kind === 'screen' ? await navigator.mediaDevices.getDisplayMedia({ video: true }) : await navigator.mediaDevices.getUserMedia({ video: true });
    } catch (e) {
      $('mediaNote').textContent = kind === 'camera' && e.name === 'NotFoundError' ? 'No camera found on this PC.' : `${kind === 'screen' ? 'Screen' : 'Camera'} not available: ${e.message || e.name}`;
      $('mediaNote').style.display = 'block';
      return;
    }
    const v = $('mediaVideo'); v.srcObject = stream; v.style.display = 'block'; $('mediaNote').style.display = 'none'; await v.play();
    stream.getVideoTracks()[0].onended = stopMedia;
    $('mediaLive').style.display = 'inline-block';
  }
  function stopMedia() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    const v = $('mediaVideo'); if (v) { v.srcObject = null; v.style.display = 'none'; }
    if ($('mediaLive')) $('mediaLive').style.display = 'none';
    if ($('mediaNote')) { $('mediaNote').textContent = 'SYSTEM OFFLINE'; $('mediaNote').style.display = 'block'; }
  }
  function frame() {   // a JPEG of what Media Link shows now, for the next question
    const v = $('mediaVideo'); if (!stream || !v || !v.videoWidth) return '';
    const k = Math.min(1, 1280 / v.videoWidth), c = document.createElement('canvas');
    c.width = v.videoWidth * k; c.height = v.videoHeight * k; c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  }

  document.addEventListener('DOMContentLoaded', () => {
    decode();
    const c = $('globeCanvas');
    if (c) {
      c.addEventListener('pointerdown', e => { drag = { x: e.clientX, r: rot }; });
      window.addEventListener('pointermove', e => { if (drag) rot = drag.r + (e.clientX - drag.x) * 0.01; });
      window.addEventListener('pointerup', () => { drag = null; });
      c.addEventListener('mousemove', e => {
        const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        const s = spots.find(s => s._x != null && Math.hypot(s._x - x, s._y - y) < 6);
        c.title = s ? `${s.place}: ${s.title}` : 'Drag to turn Â· â¤¢ opens World Monitor';
      });
    }
    $('globeMode')?.addEventListener('click', e => { mode = mode === '3d' ? '2d' : '3d'; e.target.textContent = mode === '3d' ? '2D' : '3D'; });
    $('globeOpen')?.addEventListener('click', () => post({ do: 'openMonitor', url: 'https://www.worldmonitor.app/dashboard' }));
    $('headlineRefresh')?.addEventListener('click', () => post({ do: 'headlines', refresh: true }));
    $('mediaCam')?.addEventListener('click', () => media('camera'));
    $('mediaScreen')?.addEventListener('click', () => media('screen'));
    $('mediaStop')?.addEventListener('click', stopMedia);
    document.addEventListener('visibilitychange', kick);
    kick();
    post({ do: 'headlines' });
  });
  window.omaWorld = { headlines, frame, live: () => !!stream, stopMedia };
})();
