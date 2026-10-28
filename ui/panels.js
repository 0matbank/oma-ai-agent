/**
 * Core Memory and Skills dialogs, opened from the MEMORY and SKILLS nodes (Stonic style).
 *  Core Memory: what Oma knows about you (me.json), your saved rules (memory.md) and notes, searchable; ✕ forgets.
 *  Skills: your own instructions for a kind of request (name, description, instructions). The engine adds a skill to a
 *  request only when the request shares words with its name or description, so unused skills cost no tokens.
 */
(() => {
  const $ = id => document.getElementById(id);
  const post = m => window.webkit?.messageHandlers?.st?.postMessage(m);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let data = null, view = '';

  function modal(title, sub) {
    let m = $('omaModal');
    if (!m) {
      m = document.createElement('div'); m.id = 'omaModal';
      m.innerHTML = `<div class="om-box"><div class="om-head"><div><b id="omTitle"></b><div id="omSub"></div></div><button class="wbtn" id="omClose">✕</button></div><div id="omBody"></div></div>`;
      document.body.appendChild(m);
      m.addEventListener('click', e => { if (e.target === m) close(); });
      $('omClose').onclick = close;
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && m.style.display === 'grid') close(); });
    }
    $('omTitle').textContent = title; $('omSub').textContent = sub;
    m.style.display = 'grid';
    return $('omBody');
  }
  function close() { const m = $('omaModal'); if (m) m.style.display = 'none'; view = ''; }

  function memory() {
    view = 'memory';
    const body = modal('Core Memory', 'What Oma remembers about you · it learns from your requests');
    if (!data) { body.textContent = 'Loading…'; post({ do: 'memoryList' }); return; }
    const q = ($('omSearch')?.value || '').toLowerCase();
    const hit = t => !q || String(t).toLowerCase().includes(q);
    const m = data.me || {};
    const row = (text, kind, val) => `<div class="om-row"><span>${esc(text)}</span>${kind ? `<button class="wbtn" data-k="${kind}" data-v="${esc(val)}" title="Forget">✕</button>` : ''}</div>`;
    body.innerHTML = `<input class="field" id="omSearch" placeholder="Search memory…" value="${esc(q)}" style="width:100%;margin-bottom:10px">
      <h4>About you</h4>${[m.name && `Name: ${m.name}`, m.about].filter(Boolean).filter(hit).map(t => row(t)).join('')}
      ${(m.facts || []).filter(hit).map(f => row(f, 'fact', f)).join('') || '<div class="om-empty">Nothing yet. Tell Oma “remember that I …”.</div>'}
      <h4>Rules</h4>${(data.rules || []).filter(hit).map(r => row(r, 'rule', r)).join('') || '<div class="om-empty">No rules saved.</div>'}
      <h4>Notes</h4>${(data.notes || []).filter(n => hit(n.title + ' ' + n.content)).map(n => row(`${n.title}: ${n.content}${n.context ? ' · used as context' : ''}`)).join('') || '<div class="om-empty">No notes.</div>'}`;
    const s = $('omSearch'); s.oninput = () => { memory(); const t = $('omSearch'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); };
    body.querySelectorAll('button[data-k]').forEach(b => b.onclick = () => {
      if (b.dataset.k === 'rule') post({ do: 'forget', line: b.dataset.v });
      else post({ do: 'me', what: 'drop', text: b.dataset.v });
      b.closest('.om-row').remove();
      setTimeout(() => post({ do: 'memoryList' }), 600);
    });
  }

  function skills(editing) {
    view = 'skills';
    const body = modal('Skills', 'Teach Oma how you want a kind of request done');
    if (!data) { body.textContent = 'Loading…'; post({ do: 'memoryList' }); return; }
    if (editing) {
      const sk = editing === true ? {} : editing;
      body.innerHTML = `<label class="om-l">Skill name</label><input class="field" id="skName" value="${esc(sk.name || '')}" placeholder="e.g. Morning market report" style="width:100%">
        <label class="om-l">Description (when to use it)</label><input class="field" id="skDesc" value="${esc(sk.description || '')}" placeholder="e.g. dollar rate and gold rate every morning" style="width:100%">
        <label class="om-l">Instructions</label><textarea class="field" id="skInst" rows="8" style="width:100%;resize:vertical" placeholder="1. Search the USD to BDT rate…&#10;2. Answer in two lines in Bangla">${esc(sk.instructions || '')}</textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="btn" id="skCancel">Cancel</button><button class="btn blue" id="skSave">Save skill</button></div>
        <div id="skMsg" class="om-empty"></div>`;
      $('skCancel').onclick = () => skills();
      $('skSave').onclick = () => {
        const s = { name: $('skName').value.trim(), description: $('skDesc').value.trim(), instructions: $('skInst').value.trim() };
        if (!s.name || !s.instructions) { $('skMsg').textContent = 'A skill needs a name and instructions.'; return; }
        post({ do: 'skillSave', skill: s }); $('skMsg').textContent = 'Saving…';
      };
      return;
    }
    const list = data.skills || [];
    body.innerHTML = `<div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button class="btn blue" id="skNew">+ New Skill</button></div>
      ${list.map((s, i) => `<div class="om-row"><span><b>${esc(s.name)}</b><br><small>${esc(s.description || '')}</small></span><span><button class="wbtn" data-edit="${i}">Edit</button><button class="wbtn" data-del="${esc(s.name)}">✕</button></span></div>`).join('')
        || '<div class="om-empty" style="text-align:center;padding:30px">No skills yet<br>Skills are templates Oma follows for a kind of request.</div>'}`;
    $('skNew').onclick = () => skills(true);
    body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => skills(list[+b.dataset.edit]));
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { post({ do: 'skillDelete', name: b.dataset.del }); b.closest('.om-row').remove(); });
  }

  window.omaPanels = {
    memory: () => { data = null; memory(); },
    skills: () => { data = null; skills(); },
    data(d) { data = d; if (view === 'memory') memory(); else if (view === 'skills') skills(); },
    saved(r) { if (String(r).startsWith('Error')) { const m = $('skMsg'); if (m) m.textContent = r; } else post({ do: 'memoryList' }); },
  };
})();
