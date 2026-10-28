/**
 * Left column of the Oma window (Stonic layout): Media Link, Sat-Link globe, Today Headlines.
 *  - Globe: Natural Earth land mask (world_mask.js) as an earth texture, orthographic 3D or flat 2D; hotspots are today's
 *    real headlines placed by the country they name (multi_ai/world.py). Drag to turn. Bottom bar: Today (all), Map (2D),
 *    Search (filter + turn to the place), Alerts (alert headlines only), More (the full World Monitor in an Oma window).
 *  - Media Link: camera or screen, shown live; while it is on, a frame is attached to the next question you send.
 */
(() => {
  const $ = id => document.getElementById(id);
  const post = m => window.webkit?.messageHandlers?.st?.postMessage(m);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim() || '0,229,255';
  const TW = 720, TH = 360, tilt = 0.35;
  let spots = [], all = [], mode = '3d', view = 'today', query = '', rot = -90 * Math.PI / 180, goal = null, drag = null, raf = 0;
  let tex = null, flat = null, cache = null;

  // Earth texture (equirectangular, TW x TH): the land mask smoothed into coastlines, land in earth tones, dark ocean.
  // Places named in alert headlines get a red wash: an approximation of the country, not its border.
  function texture() {
    const m = window.OMA_LAND; if (!m) return;
    const bin = atob(m.b64), s = document.createElement('canvas'); s.width = m.w; s.height = m.h;
    const sg = s.getContext('2d'), sd = sg.createImageData(m.w, m.h);
    for (let k = 0; k < m.w * m.h; k++) { sd.data[k * 4] = bin.charCodeAt(k >> 3) & (1 << (k & 7)) ? 255 : 0; sd.data[k * 4 + 3] = 255; }
    sg.putImageData(sd, 0, 0);
    const b = document.createElement('canvas'); b.width = TW; b.height = TH;
    const bg = b.getContext('2d'); bg.imageSmoothingEnabled = true; bg.imageSmoothingQuality = 'high'; bg.drawImage(s, 0, 0, TW, TH);
    const L = bg.getImageData(0, 0, TW, TH).data, hot = all.filter(i => i.alert && i.lat != null);
    tex = new Uint8ClampedArray(TW * TH * 3);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let y = 0; y < TH; y++) {
      const lat = 90 - (y + 0.5) * 180 / TH, pol = Math.max(0, (Math.abs(lat) - 58) / 30), cl = Math.cos(lat * Math.PI / 180);
      for (let x = 0; x < TW; x++) {
        const i = y * TW + x, v = L[i * 4] / 255 + (rnd() - 0.5) * 0.18, o = i * 3;
        if (v > 0.5) {
          const n = 0.85 + rnd() * 0.3, lon = -180 + (x + 0.5) * 360 / TW;
          let r = (118 - 30 * pol) * n + 60 * pol, g = (84 - 6 * pol) * n + 70 * pol, bl = (52 + 20 * pol) * n + 80 * pol;
          if (v < 0.62) { r *= 1.25; g *= 1.2; bl *= 1.1; }   // coastline
          for (const h of hot) { const d = Math.hypot(lat - h.lat, (lon - h.lon) * cl); if (d < 7) { const k = 1 - d / 7; r += 150 * k; g -= 40 * k; bl -= 25 * k; } }
          tex[o] = r; tex[o + 1] = g; tex[o + 2] = bl;
        } else { const d = 0.9 + rnd() * 0.1; tex[o] = 10 * d; tex[o + 1] = 22 * d; tex[o + 2] = 48 * d; }
      }
    }
    const f = document.createElement('canvas'); f.width = TW; f.height = TH;
    const fg = f.getContext('2d'), fd = fg.createImageData(TW, TH);
    for (let i = 0; i < TW * TH; i++) { fd.data[i * 4] = tex[i * 3]; fd.data[i * 4 + 1] = tex[i * 3 + 1]; fd.data[i * 4 + 2] = tex[i * 3 + 2]; fd.data[i * 4 + 3] = 255; }
    fg.putImageData(fd, 0, 0); flat = f;
  }

  // texture row / column of every pixel of the disc, once per size (the tilt is fixed; turning only shifts longitude)
  function disc(S) {
    if (cache && cache.S === S) return cache;
    const row = new Int32Array(S * S).fill(-1), col = new Float32Array(S * S), shade = new Float32Array(S * S);
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const x = (px + 0.5) / S * 2 - 1, y2 = 1 - (py + 0.5) / S * 2, rr = x * x + y2 * y2; if (rr > 1) continue;
      const z2 = Math.sqrt(1 - rr), y = y2 * Math.cos(tilt) + z2 * Math.sin(tilt), z = -y2 * Math.sin(tilt) + z2 * Math.cos(tilt);
      const i = py * S + px, lat = Math.asin(Math.max(-1, Math.min(1, y))) * 180 / Math.PI;
      row[i] = Math.min(TH - 1, Math.floor((90 - lat) / 180 * TH)); col[i] = Math.atan2(x, z) / (2 * Math.PI) * TW;
      shade[i] = 0.35 + 0.75 * z2;
    }
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    return (cache = { S, row, col, shade, c, g, img: g.createImageData(S, S) });
  }

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
    if (!drag && !goal && t - lastDraw < 66) { raf = requestAnimationFrame(draw); return; }   // 15 fps is plenty for a slow globe (CPU)
    lastDraw = t;
    if (!tex) texture();
    const w = c.clientWidth, h = c.clientHeight, d = Math.min(devicePixelRatio || 1, 2);
    if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }   // width or height (a stale height squashed the globe)
    const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
    const A = accent(), cx = w / 2, cy = h / 2, R = mode === '2d' ? Math.min(w / 3.9, h / 2.1) : Math.min(w, h) * 0.44;
    if (mode === '3d' && tex) {
      const glow = g.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.14);
      glow.addColorStop(0, `rgba(${A},.28)`); glow.addColorStop(1, `rgba(${A},0)`);
      g.fillStyle = glow; g.fillRect(cx - R * 1.2, cy - R * 1.2, R * 2.4, R * 2.4);
      const S = Math.max(40, Math.min(320, Math.round(2 * R * Math.min(d, 1.25)))), D = disc(S), px = D.img.data, sh = TW * rot / (2 * Math.PI) + TW / 2;
      for (let i = 0; i < S * S; i++) {
        const ro = D.row[i], o4 = i * 4; if (ro < 0) continue;
        let x = Math.floor(D.col[i] + sh) % TW; if (x < 0) x += TW;
        const o = (ro * TW + x) * 3, k = D.shade[i];
        px[o4] = tex[o] * k; px[o4 + 1] = tex[o + 1] * k; px[o4 + 2] = tex[o + 2] * k; px[o4 + 3] = 255;
      }
      D.g.putImageData(D.img, 0, 0);
      g.imageSmoothingEnabled = true; g.drawImage(D.c, cx - R, cy - R, 2 * R, 2 * R);
    } else if (flat) {
      g.imageSmoothingEnabled = true; g.drawImage(flat, cx - R * 1.9, cy - R * 0.95, R * 3.8, R * 1.9);
      g.strokeStyle = `rgba(${A},.25)`; g.lineWidth = 1; g.strokeRect(cx - R * 1.9, cy - R * 0.95, R * 3.8, R * 1.9);
    }
    for (const s of spots) {
      const [x, y, z] = proj(s.lat, s.lon, R, cx, cy); if (z <= 0.05) { s._x = null; continue; }
      const pulse = 3 + Math.sin(t / 300 + s.lat) * 1.2, col = s.alert ? '255,70,50' : '255,160,40';
      g.fillStyle = `rgba(${col},.30)`; g.beginPath(); g.arc(x, y, pulse + 1.5, 0, 6.283); g.fill();
      g.strokeStyle = `rgba(${col},.95)`; g.lineWidth = 1.4; g.stroke();
      s._x = x; s._y = y;
    }
    g.font = '8px Consolas, monospace'; g.fillStyle = 'rgba(160,170,190,.5)'; g.textAlign = 'right'; g.fillText('© Natural Earth', w - 3, h - 3); g.textAlign = 'left';
    if (goal != null) { const dd = Math.atan2(Math.sin(goal - rot), Math.cos(goal - rot)); rot += dd * 0.18; if (Math.abs(dd) < 0.005) goal = null; }
    else if (!drag && mode === '3d') rot += 0.008;
    raf = requestAnimationFrame(draw);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(draw); };
  const turnTo = s => { if (s && s.lon != null && mode === '3d') { goal = -s.lon * Math.PI / 180; kick(); } };

  // Today = every headline, Alerts = alert headlines only, Search = headlines matching the words typed
  function show() {
    const q = query.toLowerCase().trim();
    const items = all.filter(i => view !== 'alerts' || i.alert)
      .filter(i => view !== 'search' || !q || `${i.title} ${i.place || ''} ${i.source}`.toLowerCase().includes(q));
    spots = items.filter(i => i.lat != null);
    const box = $('headlineList'); if (!box) return;
    box.innerHTML = items.slice(0, 12).map((i, n) => `<a class="hl ${i.alert ? 'alert' : ''}" href="${esc(i.link)}" target="_blank" data-n="${n}" title="${esc(i.source)}${i.place ? ' · ' + esc(i.place) : ''}">
      <span class="n">${String(n + 1).padStart(2, '0')}</span><span>${esc(i.title)}</span></a>`).join('')
      || `<div class="hl">${all.length ? (view === 'alerts' ? 'No alert headlines right now.' : 'Nothing matches.') : 'No headlines (offline?)'}</div>`;
    box.querySelectorAll('.hl[data-n]').forEach(a => { a.onmouseenter = () => turnTo(items[+a.dataset.n]); });
    if (view === 'search' && q && spots[0]) turnTo(spots[0]);
    kick();
  }
  function headlines(d) {
    all = (d && d.items) || [];
    const s = $('headlineStamp'); if (s) s.textContent = d && d.at ? new Date(d.at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + (d.stale ? ' · offline' : '') : '';
    tex = null;   // the red washes follow today's alert places
    show();
  }
  function setMode(m) {
    mode = m;
    document.querySelectorAll('#globeSeg button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
    kick();
  }
  function setView(v) {
    if (v === 'more') { post({ do: 'openMonitor', url: 'https://www.worldmonitor.app/dashboard' }); return; }
    view = v;
    document.querySelectorAll('#globeNav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    const sb = $('globeSearch'); if (sb) { sb.style.display = v === 'search' ? 'block' : 'none'; if (v === 'search') sb.focus(); }
    if (v === 'map') setMode('2d'); else if (v !== 'search') setMode('3d');
    show();
  }

  /* ---------------- Media Link */
  let stream = null, req = 0;   // req: the newest start/stop; an older pending request stops its own stream
  async function media(kind) {
    stopMedia();
    const my = req;
    let s;
    try {
      s = kind === 'screen' ? await navigator.mediaDevices.getDisplayMedia({ video: true }) : await navigator.mediaDevices.getUserMedia({ video: true });
    } catch (e) {
      if (my !== req) return;
      $('mediaNote').textContent = kind === 'camera' && e.name === 'NotFoundError' ? 'No camera found on this PC.' : `${kind === 'screen' ? 'Screen' : 'Camera'} not available: ${e.message || e.name}`;
      $('mediaNote').style.display = 'block';
      return;
    }
    if (my !== req) { s.getTracks().forEach(t => t.stop()); return; }
    stream = s;
    const v = $('mediaVideo'); v.srcObject = stream; v.style.display = 'block'; $('mediaNote').style.display = 'none'; await v.play();
    stream.getVideoTracks()[0].onended = stopMedia;
    $('mediaLive').style.display = 'inline-block';
  }
  function stopMedia() {
    req++;
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
    const c = $('globeCanvas');
    if (c) {
      const hit = e => { const r = c.getBoundingClientRect(); return spots.find(s => s._x != null && Math.hypot(s._x - (e.clientX - r.left), s._y - (e.clientY - r.top)) < 7); };
      c.addEventListener('pointerdown', e => { drag = { x: e.clientX, r: rot, moved: false }; goal = null; kick(); });
      window.addEventListener('pointermove', e => { if (drag) { rot = drag.r + (e.clientX - drag.x) * 0.01; drag.moved ||= Math.abs(e.clientX - drag.x) > 3; } });
      window.addEventListener('pointerup', e => { const d = drag; drag = null; if (d && !d.moved && e.target === c) { const s = hit(e); if (s?.link) window.open(s.link, '_blank'); } });
      c.addEventListener('mousemove', e => { const s = hit(e); c.title = s ? `${s.place}: ${s.title}` : 'Drag to turn · click a dot to read the story'; });
    }
    document.querySelectorAll('#globeSeg button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.m)));
    document.querySelectorAll('#globeNav button').forEach(b => b.addEventListener('click', () => setView(b.dataset.v)));
    $('globeSearch')?.addEventListener('input', e => { query = e.target.value; show(); });
    $('globeSearch')?.addEventListener('keydown', e => { if (e.key === 'Escape') { e.target.value = ''; query = ''; setView('today'); } });
    $('globeOpen')?.addEventListener('click', () => setView('more'));
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
