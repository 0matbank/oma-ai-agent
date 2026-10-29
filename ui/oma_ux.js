/* Oma UX layer, loaded after the main script (uses its globals: P, post, set, sendDirective, OmaTask, window.st).
   Bangla status labels, Simple / Advanced and search in Settings, layouts (Focus / Center / Mini), a timeline card per
   request, the Ctrl+K palette, History, and Oma's Browser sign-ins (the user signs in by themselves; Oma never sees a
   password or reads cookies). */
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const drawer = () => $('settings-drawer');
  const openTab = t => { drawer()?.classList.add('open'); document.querySelector(`.nav-btn[data-s="${t}"]`)?.click(); };

  /* ---------- Bangla status labels under the orb */
  const BN_STATE = { STANDBY: 'প্রস্তুত', LISTENING: 'শুনছি…', CALIBRATING: 'ভাবছি…', ACTIVE: 'সক্রিয়', SPEAKING: 'বলছি…',
    PLANNING: 'পরিকল্পনা করছি…', EXECUTING: 'কাজ করছি…', VERIFYING: 'যাচাই করছি…', 'WAITING FOR YOU': 'আপনার অনুমতি দরকার',
    PARTIAL: 'আংশিক হয়েছে', DONE: 'শেষ ✓', FAILED: 'হয়নি' };
  let lastLabel = 'STANDBY';
  function relabel(label) {
    if (label) lastLabel = label;
    const l = $('orb-state-label'); if (!l) return;
    const bn = !P.uiEnglishLabels;
    l.textContent = (bn ? (BN_STATE[lastLabel] || lastLabel) : lastLabel) + (P.muted ? (bn ? ' · মিউট' : ' · MUTED') : '');
  }
  const paintMute0 = window.paintMute;
  if (typeof paintMute0 === 'function') window.paintMute = () => { paintMute0(); relabel(); };

  /* ---------- Settings: Simple / Advanced */
  const ADV_ROWS = ['Custom fallback order', 'Fallback Notification', 'Check interval (seconds)', 'Offer Sonnet when stuck', 'Without asking',
    'Multi-AI Failover to Local Models', "Act while I'm talking", 'Learn commands', "Start while I'm talking", 'Pause before starting',
    'Speech Recognition (Whisper.net)', 'Speech engine', 'Count me as a user', 'Help improve Atticus', 'Update Protection'];
  const ADV_BLOCKS = ['Installed Local AI Models', 'Add Custom Provider', 'Saved commands and procedures', 'Source Code & Documentation',
    'Compact answer box (classic Atticus overlay)'];
  function markAdvanced() {
    document.querySelectorAll('#settings-drawer .row .t > b').forEach(b => { if (ADV_ROWS.includes(b.textContent.trim().replace('’', "'"))) b.closest('.row').classList.add('adv'); });
    document.querySelectorAll('#settings-drawer h3').forEach(h => { if (ADV_BLOCKS.includes(h.textContent.trim())) (h.closest('.sblock') || h).classList.add('adv'); });
    document.querySelector('.nav-btn[data-s="lab"]')?.classList.add('adv');
  }
  function settingsMode(m) {
    document.body.classList.toggle('set-simple', m !== 'advanced');
    document.querySelectorAll('#setMode button').forEach(b => b.classList.toggle('on', b.dataset.m === (m === 'advanced' ? 'advanced' : 'simple')));
    const cur = document.querySelector('.nav-btn.on');
    if (m !== 'advanced' && cur && cur.classList.contains('adv')) openTab('providers');
  }

  /* ---------- Settings search */
  function searchSettings(q) {
    const d = drawer(); if (!d) return;
    q = q.trim().toLowerCase();
    d.classList.toggle('searching', !!q);
    d.querySelectorAll('.s-miss').forEach(e => e.classList.remove('s-miss'));
    d.querySelectorAll('section.tab-section').forEach(s => s.classList.remove('hit'));
    if (!q) { d.classList.remove('no-hit'); return; }
    let hits = 0;
    d.querySelectorAll('section.tab-section').forEach(sec => {
      if (sec.id === 'history') return;   // past requests have their own search
      const title = (sec.querySelector('h1')?.textContent || '').toLowerCase();
      let any = title.includes(q);
      if (!any) {
        sec.querySelectorAll('.row, .provider-card, details.ph').forEach(r => {
          if (r.closest('.int-form')) return;
          const hit = r.textContent.toLowerCase().includes(q);
          r.classList.toggle('s-miss', !hit);
          if (hit) any = true;
        });
        sec.querySelectorAll('.sblock').forEach(b => {
          const vis = b.querySelector('.row:not(.s-miss), .provider-card:not(.s-miss), details.ph:not(.s-miss)');
          b.classList.toggle('s-miss', !vis);
        });
        const lede = sec.querySelector('p.lede'); if (lede) lede.classList.add('s-miss');
      }
      if (any) { sec.classList.add('hit'); hits++; }
    });
    d.classList.toggle('no-hit', !hits);
  }

  /* ---------- Layouts: Focus (big chat), Center (everything), Mini (the small floating orb) */
  function layout(l, save) {
    if (l === 'mini') { post({ do: 'minimize' }); return; }
    l = l === 'focus' ? 'focus' : 'center';
    document.body.classList.toggle('lay-focus', l === 'focus');
    document.querySelectorAll('#layoutSeg button').forEach(b => b.classList.toggle('on', b.dataset.l === l));
    if (save) set('layout', l);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);   // canvases measure themselves again
  }

  /* ---------- One timeline card per request: understand -> work -> check -> done */
  const STEPS = ['বুঝছি', 'কাজ করছি', 'যাচাই', 'শেষ'];
  const END = { COMPLETED: ['শেষ ✓', ''], PARTIAL: ['আংশিক', 'part'], FAILED: ['হয়নি ✕', 'fail'], CANCELLED: ['থামানো হয়েছে', 'fail'] };
  const tl = {};
  const stageOf = ev => ev.kind === 'result' ? 3
    : ({ analyzing: 0, planning: 0, fallback: 0, retry: 1, executing: 1, permission: 1, verifying: 2 })[ev.stage]
      ?? (ev.kind === 'step' ? 1 : (ev.kind === 'evidence' || ev.kind === 'worker') ? 2 : 0);
  function timeline(ev) {
    if (!ev || !ev.task_id) return;
    let t = tl[ev.task_id];
    if (!t) {
      const stream = $('homeFeedStream'); if (!stream) return;
      const el = document.createElement('div');
      el.className = 'feed-card event tl-card';
      stream.appendChild(el); stream.scrollTop = stream.scrollHeight;
      t = tl[ev.task_id] = { el, max: -1, end: null };
    }
    t.max = Math.max(t.max, stageOf(ev));
    if (ev.kind === 'result' || ['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(ev.status)) { t.end = ev.status; t.max = 3; }
    const parts = STEPS.map((name, i) => {
      let cls = i <= t.max ? 'on' : '';
      if (i === t.max && !t.end) cls += ' cur';
      if (i === 3 && t.end) { name = (END[t.end] || END.COMPLETED)[0]; cls += ' ' + (END[t.end] || END.COMPLETED)[1]; }
      return `<span class="st ${cls}"><i></i>${name}</span>`;
    });
    t.el.innerHTML = `<div class="tl-steps">${parts.map((p, i) => i ? `<span class="bar ${i <= t.max ? 'on' : ''}"></span>` + p : p).join('')}</div>`;
  }
  function wrapTask() {
    const T = window.OmaTask; if (!T || T._ux) return;
    T._ux = true;
    const ev0 = T.event, rep0 = T.reply;
    T.event = ev => { ev0(ev); try { timeline(ev); } catch (e) { console.warn('timeline', e); } };
    T.reply = rep => {
      rep0(rep);
      try {
        if (rep && rep.task_id && tl[rep.task_id] && !tl[rep.task_id].end) timeline({ task_id: rep.task_id, kind: 'result', status: rep.status || (rep.success ? 'COMPLETED' : 'FAILED') });
        signInHelp(rep);
      } catch (e) { console.warn('reply ux', e); }
    };
    T.answerPrompt = () => {   // Agent Town: OMA's "?" at her door shows the question that waits for you
      const c = [...document.querySelectorAll('#homeFeedStream .ask-card')].reverse().find(x => x.querySelector('button:not(:disabled)'));
      if (!c) return false;
      c.classList.remove('old'); c.classList.add('open');
      c.scrollIntoView({ behavior: 'smooth', block: 'center' });
      c.classList.remove('pulse'); void c.offsetWidth; c.classList.add('pulse');
      return true;
    };
  }

  /* ---------- A site needs a sign-in: offer it right in the chat */
  function signInHelp(rep) {
    const text = (rep && rep.reply) || '';
    const m = /^(\w+) needs you to sign in in Oma's browser/i.exec(text);
    if (!m) return;
    const site = m[1].toLowerCase(), robot = /google\.com\/sorry/i.test(text);
    const cards = document.querySelectorAll('#homeFeedStream .feed-card.oma');
    const card = cards[cards.length - 1]; if (!card) return;
    const name = site.charAt(0).toUpperCase() + site.slice(1);
    card.querySelector('.feed-text')?.insertAdjacentHTML('beforeend',
      `${robot ? '<div style="margin-top:6px;color:#ffb300;font-size:12px;">Google is asking for a "not a robot" check. Finish it yourself in Oma\'s browser, then ask again.</div>' : ''}` +
      `<div class="signin-row"><button class="btn blue" data-signin="${esc(site)}">${robot ? 'Open it in Oma\'s browser' : `Sign in to ${esc(name)} now`}</button>` +
      `<button class="btn" data-manage="1">Manage sign-ins</button></div>`);
    card.querySelector('[data-signin]').onclick = e => { e.stopPropagation(); post({ do: 'browserLogin', site }); };
    card.querySelector('[data-manage]').onclick = e => { e.stopPropagation(); openTab('browser'); };
  }

  /* ---------- History */
  let HIST = [];
  const when = at => { const d = typeof at === 'number' ? new Date(at * 1000) : new Date(String(at).replace(' ', 'T')); return isNaN(d) ? String(at || '') : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  function renderHistory() {
    const box = $('histList'); if (!box) return;
    const q = ($('histSearch')?.value || '').trim().toLowerCase();
    const rows = HIST.filter(h => !q || `${h.task} ${h.reply}`.toLowerCase().includes(q)).slice(0, 200);
    $('histCount').textContent = HIST.length ? `${rows.length} of ${HIST.length}` : '';
    box.innerHTML = rows.map((h, i) => `<div class="row hist-item"><div class="q">${esc(h.task)}</div><div class="a">${esc(h.reply)}</div>
      <div class="meta"><span>${esc(when(h.at))}</span>${h.secs ? `<span>${Number(h.secs).toFixed(1)} s</span>` : ''}${h.ok === false ? '<span style="color:#ff6b6b">not done</span>' : ''}
      <span style="flex:1"></span><button class="btn" data-copy="${i}">Copy answer</button><button class="btn blue" data-again="${i}">Ask again</button></div></div>`).join('')
      || `<div class="empty">${HIST.length ? 'Nothing matches.' : 'No past requests yet.'}</div>`;
    box.querySelectorAll('[data-again]').forEach(b => b.onclick = () => { drawer()?.classList.remove('open'); sendDirective(rows[+b.dataset.again].task); });
    box.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => { navigator.clipboard?.writeText(rows[+b.dataset.copy].reply || ''); b.textContent = 'Copied ✓'; });
  }

  /* ---------- Oma's Browser: sign-ins */
  let SITES = [], STATUS = {};
  const STATE_PILL = { signed_in: ['ok', 'Signed in ✓'], signed_out: ['no', 'Sign in needed'], blocked: ['bad', 'Robot check: finish it in the browser'],
    unknown: ['mute', 'Could not tell'] };
  function renderBrowser() {
    const box = $('brSites'); if (!box) return;
    box.innerHTML = SITES.map(s => {
      const st = STATUS[s.id] || (s.state ? { state: s.state, detail: s.detail } : null);
      const [cls, label] = st ? (STATE_PILL[st.state] || STATE_PILL.unknown) : ['mute', 'Not checked'];
      const acct = ['gemini', 'gmail'].includes(s.id);
      return `<div class="row br-site" data-id="${esc(s.id)}"><div class="t"><b>${esc(s.name)}</b><small>${esc(s.url)}</small>
          ${st && st.detail && st.state !== 'signed_in' ? `<span>${esc(String(st.detail).slice(0, 140))}</span>` : ''}
          ${acct ? `<div class="acct"><input class="field" data-acct type="email" placeholder="Google account for ${esc(s.name)} (e.g. you@gmail.com)" value="${esc(s.account || '')}" spellcheck="false"><button class="btn" data-acct-save>Save</button></div>` : ''}</div>
        <span class="pill ${cls}">${label}</span>
        <button class="btn ${st && st.state === 'signed_in' ? '' : 'blue'}" data-login>${st && st.state === 'signed_in' ? 'Open' : 'Sign in'}</button>
        ${s.custom ? '<button class="btn red" data-remove>Remove</button>' : ''}</div>`;
    }).join('') || '<div class="empty">Loading sites…</div>';
    box.querySelectorAll('.br-site').forEach(r => {
      const id = r.dataset.id;
      r.querySelector('[data-login]').onclick = () => { brNote(`Opening ${id} in Oma's browser. Sign in there yourself, then press Check again.`); post({ do: 'browserLogin', site: id }); };
      r.querySelector('[data-remove]')?.addEventListener('click', () => { if (confirm('Remove this site from the list?')) post({ do: 'browserRemoveSite', site: id }); });
      r.querySelector('[data-acct-save]')?.addEventListener('click', () => { brNote('Saving the account…'); post({ do: 'browserAccount', site: id, email: r.querySelector('[data-acct]').value.trim() }); });
    });
  }
  function brNote(t, color) { const n = $('brResult'); if (n) { n.textContent = t; n.style.color = color || 'var(--fg2)'; } }

  /* ---------- Ctrl+K palette */
  function actions() {
    const a = [];
    document.querySelectorAll('.nav-btn[data-s]').forEach(b => { if (!(document.body.classList.contains('set-simple') && b.classList.contains('adv')))
      a.push({ t: 'Settings: ' + b.textContent.trim(), k: 'settings সেটিংস', run: () => openTab(b.dataset.s) }); });
    a.push({ t: 'Layout: Focus (big chat)', k: 'layout লেআউট', run: () => layout('focus', true) },
           { t: 'Layout: Center (everything)', k: 'layout লেআউট', run: () => layout('center', true) },
           { t: 'Layout: Mini (small floating orb)', k: 'layout minimize লেআউট', run: () => layout('mini') });
    document.querySelectorAll('#themeMenu button').forEach(b => a.push({ t: 'Theme: ' + b.textContent.trim(), k: 'theme থিম রং', run: () => b.click() }));
    a.push({ t: P.muted ? 'Unmute voice assistant' : 'Mute voice assistant', k: 'mute voice মিউট', run: () => $('btn-mute')?.click() },
           { t: "Oma's Browser: sign in to sites", k: 'browser login sign in ব্রাউজার লগইন', run: () => openTab('browser') },
           { t: 'History: past requests', k: 'history ইতিহাস', run: () => openTab('history') },
           { t: 'Check AI health now', k: 'health provider', run: () => { openTab('providers'); $('btnHealth')?.click(); } });
    document.querySelectorAll('.quick-chip').forEach(c => a.push({ t: 'Ask: ' + c.dataset.prompt, k: c.textContent, run: () => sendDirective(c.dataset.prompt) }));
    return a;
  }
  let palSel = 0, palList = [];
  function palRender() {
    const q = $('palInput').value.trim(), ql = q.toLowerCase();
    palList = actions().filter(x => !ql || (x.t + ' ' + x.k).toLowerCase().includes(ql)).slice(0, 12);
    if (q) palList.push({ t: `Ask Oma: “${q}”`, k: '', run: () => sendDirective(q) });
    palSel = Math.min(palSel, palList.length - 1);
    $('palList').innerHTML = palList.map((x, i) => `<li class="${i === palSel ? 'on' : ''}" data-i="${i}"><span>${esc(x.t)}</span><small>${i === palSel ? 'Enter' : ''}</small></li>`).join('');
    $('palList').querySelectorAll('li').forEach(li => li.onclick = () => palRun(+li.dataset.i));
  }
  function palOpen() { $('palette').classList.add('open'); $('palInput').value = ''; palSel = 0; palRender(); setTimeout(() => $('palInput').focus(), 0); }
  function palClose() { $('palette').classList.remove('open'); }
  function palRun(i) { const x = palList[i]; palClose(); if (x) x.run(); }

  /* ---------- Wiring */
  Object.assign(window.st, {
    history(list) { HIST = Array.isArray(list) ? list : []; renderHistory(); },
    browserSites(list) {
      if (!Array.isArray(list)) { brNote((list && (list.message || list.error)) || 'Could not read the site list.', '#ff453a'); return; }
      SITES = list; list.forEach(s => { if (s.state && !STATUS[s.id]) STATUS[s.id] = { state: s.state, detail: s.detail }; }); renderBrowser();
    },
    browserStatus(list) {
      if (!Array.isArray(list)) { brNote((list && (list.message || list.error)) || 'The check did not finish.', '#ff453a'); $('brCheck').disabled = false; return; }
      list.forEach(s => STATUS[s.id] = s); renderBrowser();
      const ok = list.filter(s => s.state === 'signed_in').length;
      brNote(`Checked ${list.length} sites: ${ok} signed in.`, 'var(--neon-green)'); $('brCheck').disabled = false;
    },
    browserResult(r) { r = r || {}; brNote(String(r.message || (r.ok ? 'Done.' : 'Not done.')).slice(0, 300), r.ok === false ? '#ff453a' : 'var(--neon-green)'); },
  });

  const rp0 = window.renderProviders;
  if (typeof rp0 === 'function') window.renderProviders = data => {   // sign-in CLIs get a Sign in button: no terminal for the user
    rp0(data);
    ['codex_cli', 'antigravity_cli', 'deepseek_cli'].forEach(id => {
      const card = document.querySelector(`.provider-card[data-pid="${id}"]`), row = card?.querySelector('.test-btn')?.parentElement;
      if (!row || row.querySelector('.cli-login')) return;
      row.insertAdjacentHTML('afterbegin', '<button class="btn blue cli-login">Sign in</button>');
      row.querySelector('.cli-login').onclick = () => { post({ do: 'cliLogin', id }); const l = card.querySelector('.test-result-label'); if (l) l.textContent = 'A sign-in window is opening. Follow it; your browser may open to confirm.'; };
      const desc = card.querySelector('.provider-desc');
      if (desc) desc.innerHTML = desc.innerHTML.replace(/Sign in once: [^.•]*\.?(\s*Account\.)?/, 'Sign in once with the Sign in button. ');
    });
  };
  if (typeof rp0 === 'function') window.st.providers = window.renderProviders;   // st kept its own reference to the original

  window.addEventListener('DOMContentLoaded', () => {
    document.body.insertAdjacentHTML('beforeend', `<div id="palette"><div class="box">
      <input id="palInput" placeholder="Type a command, a setting or a question… (যেমন: theme, browser, ইতিহাস)" spellcheck="false" autocomplete="off">
      <ul id="palList"></ul><div class="hint">↑ ↓ to choose · Enter to run · Esc to close</div></div></div>`);
    wrapTask();
    const o = window.holoOrb;
    if (o && o.onLabel) { const f = o.onLabel; o.onLabel = (label, s) => { f(label, s); relabel(label); }; }
    relabel();
    markAdvanced();
    settingsMode(P.settingsMode);
    layout(P.layout || 'center');
    document.querySelectorAll('#setMode button').forEach(b => b.onclick = () => { set('settingsMode', b.dataset.m); settingsMode(b.dataset.m); });
    document.querySelectorAll('#layoutSeg button').forEach(b => b.onclick = () => layout(b.dataset.l, true));
    $('setSearch')?.addEventListener('input', e => searchSettings(e.target.value));
    $('setSearch')?.addEventListener('keydown', e => { if (e.key === 'Escape') { e.target.value = ''; searchSettings(''); } });
    // History and Oma's Browser load when their page opens
    document.querySelector('.nav-btn[data-s="history"]')?.addEventListener('click', () => post({ do: 'history' }));
    document.querySelector('.nav-btn[data-s="browser"]')?.addEventListener('click', () => post({ do: 'browserSites' }));
    $('histSearch')?.addEventListener('input', renderHistory);
    $('histReload')?.addEventListener('click', () => post({ do: 'history' }));
    $('brCheck')?.addEventListener('click', e => { e.target.disabled = true; brNote("Checking… Oma's browser opens each site in a background tab for a few seconds."); post({ do: 'browserStatus' }); });
    $('brOpen')?.addEventListener('click', () => post({ do: 'omaBrowser' }));
    $('brClose')?.addEventListener('click', () => post({ do: 'browserClose' }));
    $('brSignOut')?.addEventListener('click', () => { if (confirm("Sign out of every site in Oma's browser? Its saved sign-ins are deleted. Your normal Chrome is not touched.")) post({ do: 'browserSignOutAll' }); });
    $('brAdd')?.addEventListener('click', () => {
      const name = $('brAddName').value.trim(), url = $('brAddUrl').value.trim();
      if (!name || !/^https:\/\//i.test(url)) return brNote('Type a name and an address that starts with https://', '#ffb300');
      post({ do: 'browserAddSite', name, url }); $('brAddName').value = $('brAddUrl').value = '';
    });
    $('omaBrowserManage')?.addEventListener('click', () => openTab('browser'));
    // Text size: the window zooms (Oma applies it), the value shows here
    const sc = document.querySelector('input[data-k="uiScale"]');
    if (sc) { const show = () => { $('scalev').textContent = sc.value + '%'; }; if (!P.uiScale) sc.value = 100; show(); sc.addEventListener('input', show); }
    // Palette
    $('btn-palette')?.addEventListener('click', palOpen);
    $('palette')?.addEventListener('click', e => { if (e.target.id === 'palette') palClose(); });
    $('palInput')?.addEventListener('input', () => { palSel = 0; palRender(); });
    $('palInput')?.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { palSel = Math.min(palSel + 1, palList.length - 1); palRender(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { palSel = Math.max(palSel - 1, 0); palRender(); e.preventDefault(); }
      else if (e.key === 'Enter') { palRun(palSel); e.preventDefault(); }
      else if (e.key === 'Escape') palClose();
    });
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); $('palette').classList.contains('open') ? palClose() : palOpen(); }
    });
  });
  // st.load runs again after every saved setting: keep labels, mode and layout in step
  const load0 = window.st.load;
  let laidOut = false;
  window.st.load = d => { load0(d); try { relabel(); settingsMode(P.settingsMode); if (!P.speechLanguage) document.querySelector('.seg[data-k="speechLanguage"] button[data-v="bn"]')?.classList.add('on'); if (!laidOut) { laidOut = true; layout(P.layout || 'center'); } const sc = document.querySelector('input[data-k="uiScale"]'); if (sc) { sc.value = P.uiScale || 100; if ($('scalev')) $('scalev').textContent = sc.value + '%'; } } catch (e) {} };
})();

/* Chat: attach files and pictures (button, paste, drag and drop), copy any message, the model in the input's hint. */
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MAX_FILES = 5, MAX_BYTES = 20 * 1024 * 1024;
  let ATT = [];   // [{name, type, data (data URL), size}]

  function tray() {
    const t = $('attachTray'); if (!t) return;
    t.classList.toggle('on', ATT.length > 0);
    t.innerHTML = ATT.map((a, i) => `<div class="att">${a.type.startsWith('image/') ? `<img src="${a.data}" alt="">` : `<div class="ic">${esc((a.name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase())}</div>`}
      <span title="${esc(a.name)}">${esc(a.name)}</span><button data-x="${i}" title="Remove">✕</button></div>`).join('');
    t.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { ATT.splice(+b.dataset.x, 1); tray(); });
  }
  function note(t) { if (typeof appendFeedEvent === 'function') appendFeedEvent('ATTACH', t); }
  function add(files) {
    [...files].forEach(f => {
      if (ATT.length >= MAX_FILES) return note(`At most ${MAX_FILES} files per message.`);
      if (f.size > MAX_BYTES) return note(`${f.name} is larger than 20 MB.`);
      const r = new FileReader();
      r.onload = () => { ATT.push({ name: f.name || 'pasted.png', type: f.type || 'application/octet-stream', data: r.result, size: f.size }); tray(); };
      r.readAsDataURL(f);
    });
  }
  function jpeg(dataUrl) {   // the vision path takes one JPEG; big screenshots are scaled down
    return new Promise(res => {
      const im = new Image();
      im.onload = () => { const k = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas');
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.85)); };
      im.onerror = () => res('');
      im.src = dataUrl;
    });
  }

  const send0 = window.sendDirective;
  window.sendDirective = async text => {
    if (!ATT.length) return send0(text);
    const files = ATT; ATT = []; tray();
    text = (text || '').trim() || (files.length > 1 ? 'Look at these files.' : 'Look at this file.');
    const img = files.find(f => f.type.startsWith('image/'));
    appendFeedMessage('user', 'You', text);
    const cards = document.querySelectorAll('#homeFeedStream .feed-card.user');
    cards[cards.length - 1]?.insertAdjacentHTML('beforeend', `<div class="msg-atts">${files.map(f => f.type.startsWith('image/')
      ? `<img src="${f.data}" alt="${esc(f.name)}" title="${esc(f.name)}: click to copy the picture">` : `<span class="file">📄 ${esc(f.name)}</span>`).join('')}</div>`);
    window.holoOrb?.setState('thinking');
    post({ do: 'ask', text, image: img ? await jpeg(img.data) : '', files: files.map(f => ({ name: f.name, data: f.data })) });
  };

  async function copyImage(img) {
    try {
      const blob = await (await fetch(img.src)).blob();
      const png = blob.type === 'image/png' ? blob : await new Promise(r => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); c.toBlob(r, 'image/png'); });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      img.style.outline = '2px solid var(--neon-green)'; setTimeout(() => img.style.outline = '', 900);
    } catch (e) { note('Could not copy the picture: ' + (e.message || e)); }
  }
  function copyButtons(root) {   // every chat message gets a small copy button (shows on hover)
    root.querySelectorAll('.feed-card.oma, .feed-card.user').forEach(c => {
      if (c.querySelector('.cp')) return;
      const meta = c.querySelector('.feed-meta > span') || c.querySelector('.feed-meta'); if (!meta) return;
      meta.insertAdjacentHTML('beforeend', '<button class="cp" title="Copy this message">⧉ copy</button>');
      c.querySelector('.cp').onclick = e => {
        e.stopPropagation();
        const t = c.querySelector('.feed-text')?.innerText || '';
        navigator.clipboard?.writeText(t).then(() => { e.target.textContent = '✓ copied'; setTimeout(() => e.target.textContent = '⧉ copy', 1200); });
      };
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    $('btnAttach')?.addEventListener('click', () => $('attachInput')?.click());
    $('attachInput')?.addEventListener('change', e => { add(e.target.files); e.target.value = ''; });
    $('homeChatInput')?.addEventListener('paste', e => {   // a copied picture or file goes in as an attachment; text pastes as usual
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) { e.preventDefault(); add(files); }
    });
    const col = $('feed-column');
    if (col) {
      col.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); col.classList.add('drop'); } });
      col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop'); });
      col.addEventListener('drop', e => { col.classList.remove('drop'); if (e.dataTransfer?.files?.length) { e.preventDefault(); add(e.dataTransfer.files); } });
    }
    const feed = $('homeFeedStream');
    if (feed) {
      copyButtons(feed);
      new MutationObserver(() => copyButtons(feed)).observe(feed, { childList: true });
      feed.addEventListener('click', e => { const im = e.target.closest('.msg-atts img'); if (im) { e.stopPropagation(); copyImage(im); } });
    }
    // the model that answers, in the input's hint (like "Type to Oma (claude-haiku-5-5)…")
    const m = $('telemActiveModel'), inp = $('homeChatInput');
    const hint = () => { const t = (m?.textContent || '').trim(); const name = t && !/none yet|no model/i.test(t) ? t.split('·').pop().trim() : '';
      if (inp) inp.placeholder = name ? `Type to Oma (${name})…  English / বাংলা` : 'Type to Oma (English / বাংলা)…'; };
    if (m) new MutationObserver(hint).observe(m, { childList: true, characterData: true, subtree: true });
    window.omaInputHint = hint;
    hint();
  });
})();
