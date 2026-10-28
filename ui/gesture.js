/**
 * Gesture control ("Iron Man control"): the webcam and MediaPipe Hands move the real mouse.
 * Off until the user presses Activate in the gesture tab; leaving the tab, Esc, or Deactivate stops the camera at once.
 * Frames never leave the PC: MediaPipe runs here (its code and hand model are downloaded once from jsDelivr / Google).
 *   move: index + middle up       click: thumb to index tip     right click: thumb to middle tip
 *   scroll: three fingers up, move up/down                      drag: fist (released when the hand opens)
 * The app moves the cursor (do: 'gesture') only while gesture mode is on.
 */
(() => {
  const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  let stream = null, landmarker = null, raf = 0, sx = 0.5, sy = 0.5, last = '', lastAt = 0, scrollY = null, dragging = false;
  const post = m => window.webkit?.messageHandlers?.st?.postMessage(m);
  const $ = id => document.getElementById(id);
  const note = t => { const n = $('gestureNote'); if (n) n.textContent = t; };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const up = (l, tip, pip) => l[tip].y < l[pip].y;

  async function start() {
    if (stream) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    } catch (e) {
      stream = null;
      note(e.name === 'NotFoundError' ? 'No webcam found on this PC. Gesture control needs a camera.' : 'Camera not available: ' + (e.message || e.name));
      return;
    }
    const v = $('gestureVideo'); v.srcObject = stream; v.style.display = 'block'; await v.play();
    $('gestureBtn').textContent = '⏻ DEACTIVATE'; $('gesturePane')?.classList.add('live');
    note('Loading hand tracking…');
    try {
      if (!landmarker) {
        const { FilesetResolver, HandLandmarker } = await import(VISION + '/vision_bundle.mjs');
        const files = await FilesetResolver.forVisionTasks(VISION + '/wasm');
        landmarker = await HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 1 });
      }
    } catch (e) { note('Hand tracking could not load: ' + (e.message || e)); stop(); return; }
    post({ do: 'gesture', act: 'on' });
    note('');
    loop();
  }

  function stop() {
    cancelAnimationFrame(raf); raf = 0;
    if (dragging) post({ do: 'gesture', act: 'up' });
    dragging = false;
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; post({ do: 'gesture', act: 'off' }); }
    const v = $('gestureVideo'); if (v) { v.srcObject = null; v.style.display = 'none'; }
    const b = $('gestureBtn'); if (b) b.textContent = '⏻ ACTIVATE';
    $('gesturePane')?.classList.remove('live');
  }

  function act(a, extra) {   // one discrete action at most every 600 ms
    const now = performance.now();
    if (a === last && now - lastAt < 600) return;
    last = a; lastAt = now;
    post({ do: 'gesture', act: a, ...extra });
  }

  function loop() {
    const v = $('gestureVideo');
    if (!stream || !landmarker) return;
    const r = landmarker.detectForVideo(v, performance.now());
    const l = r.landmarks && r.landmarks[0];
    const c = $('gestureCanvas'), g = c.getContext('2d');
    c.width = c.clientWidth; c.height = c.clientHeight; g.clearRect(0, 0, c.width, c.height);
    if (l) {
      g.fillStyle = '#2de2e6';
      for (const p of l) g.fillRect((1 - p.x) * c.width - 2, p.y * c.height - 2, 4, 4);
      const index = up(l, 8, 6), middle = up(l, 12, 10), ring = up(l, 16, 14), pinky = up(l, 20, 18);
      const span = dist(l[0], l[9]) || 0.1;
      const x = Math.min(1, Math.max(0, (1 - l[8].x - 0.2) / 0.6)), y = Math.min(1, Math.max(0, (l[8].y - 0.15) / 0.6));
      sx += (x - sx) * 0.35; sy += (y - sy) * 0.35;   // smoothing
      if (!index && !middle && !ring && !pinky) { if (!dragging) { dragging = true; post({ do: 'gesture', act: 'down' }); } post({ do: 'gesture', act: 'move', x: sx, y: sy }); }
      else {
        if (dragging) { dragging = false; post({ do: 'gesture', act: 'up' }); }
        if (index && middle && ring && !pinky) { if (scrollY != null) post({ do: 'gesture', act: 'scroll', dy: Math.round((scrollY - l[9].y) * 2400) }); scrollY = l[9].y; }
        else scrollY = null;
        if (index && middle && !ring) post({ do: 'gesture', act: 'move', x: sx, y: sy });
        if (dist(l[4], l[8]) < span * 0.25) act('click');
        else if (dist(l[4], l[12]) < span * 0.25) act('right');
      }
    }
    raf = requestAnimationFrame(loop);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const b = $('gestureBtn'); if (b) b.onclick = () => stream ? stop() : start();
    const h = $('gestureHelp'); if (h) h.onclick = () => $('gestureGuide')?.classList.toggle('hide');
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') stop(); });
  window.omaGesture = { start, stop };
})();
