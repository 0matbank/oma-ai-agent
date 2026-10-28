/**
 * Visual Hub: diagrams Oma makes, drawn in the Agent Town panel's "visual hub" tab.
 * The engine returns a Mermaid block with its reply ({diagram}); Mermaid (ui/vendor, served from https://oma.ui/) renders it
 * with securityLevel 'strict' (no scripts, no clicks, no external links). Nothing is fetched from the internet.
 */
(() => {
  let ready = null, last = null;
  const load = () => ready ??= new Promise((ok, bad) => {
    if (window.mermaid) return ok(window.mermaid);
    const s = document.createElement('script');
    s.src = 'https://oma.ui/vendor/mermaid.min.js';
    s.onload = () => { window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark', fontFamily: 'Segoe UI, sans-serif' }); ok(window.mermaid); };
    s.onerror = () => { ready = null; bad(new Error('Mermaid could not load')); };
    document.head.appendChild(s);
  });

  async function show(code, title) {
    const body = document.getElementById('vhBody');
    if (!body || !code) return false;
    window.agentTown?.showTab('visual hub');
    document.getElementById('vhTitle').textContent = 'VISUAL HUB · ' + (title || 'diagram').slice(0, 80);
    body.textContent = 'Drawing…';
    try {
      const m = await load();
      const { svg } = await m.render('vh' + Date.now(), code);
      body.innerHTML = svg;
      const el = body.querySelector('svg');
      if (el) { el.style.maxWidth = '100%'; el.style.height = 'auto'; }
      last = { svg, title };
      document.getElementById('vhSave').disabled = false;
      return true;
    } catch (e) {
      body.textContent = 'This diagram could not be drawn: ' + (e.message || e);
      return false;
    }
  }

  function savePng() {   // SVG -> PNG in the page, then a normal download (WebView2 saves it to Downloads)
    const el = document.querySelector('#vhBody svg');
    if (!el) return;
    const r = el.getBoundingClientRect(), k = 2;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = r.width * k; c.height = r.height * k;
      const g = c.getContext('2d'); g.fillStyle = '#070b10'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = (last?.title || 'oma-diagram').replace(/[^\w\- ]+/g, '').slice(0, 40) + '.png'; a.click();
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(el));
  }

  document.addEventListener('DOMContentLoaded', () => { const b = document.getElementById('vhSave'); if (b) b.onclick = savePng; });
  window.omaVisualHub = { show };
})();
