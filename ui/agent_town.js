/**
 * Oma AI - Agent Town panel.
 * The pixel office itself is OfficeTown (office_town.js, the approved preview): workers walk, sit and type only on real
 * task events. This wrapper keeps the panel around it: worker chips, busy count, and the agents / visual hub / gesture
 * tabs (the other two tabs are DOM panes over the canvas: visual_hub.js and gesture.js fill them).
 */
class AgentTown {
  constructor(canvasId) {
    this.office = window.OfficeTown ? new window.OfficeTown(canvasId) : null;
    this.agents = {
      alice: { id: 'alice', name: 'Alice', role: 'Research', icon: '🔍', color: '#00e5ff', state: 'IDLE' },
      bob: { id: 'bob', name: 'Bob', role: 'Browser', icon: '🌐', color: '#ffb300', state: 'IDLE' },
      carol: { id: 'carol', name: 'Carol', role: 'Desktop', icon: '🖥️', color: '#b388ff', state: 'IDLE' },
      dave: { id: 'dave', name: 'Dave', role: 'Verification', icon: '✅', color: '#00f59b', state: 'IDLE' },
      eve: { id: 'eve', name: 'Eve', role: 'YouTube', icon: '▶️', color: '#ff4d6d', state: 'IDLE' },
    };
    this.activeTab = 'agents';
    this.updateChipsBar();
    this.wireTownTabs();
  }

  resize() { this.office?.resize(); }

  wireTownTabs() {
    document.querySelectorAll('.town-tab').forEach(btn => {
      btn.onclick = () => this.showTab((btn.dataset.tab || 'agents').toLowerCase().trim());
    });
  }

  showTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('.town-tab').forEach(b => b.classList.toggle('active', (b.dataset.tab || '').toLowerCase().trim() === tab));
    document.querySelectorAll('.town-pane').forEach(p => { p.style.display = p.dataset.pane === tab ? 'flex' : 'none'; });
    if (tab !== 'gesture') window.omaGesture?.stop();
    if (tab === 'agents') this.office?.resize();
  }

  updateChipsBar() {
    const box = document.getElementById('agent-chips-container');
    if (!box) return;
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    box.innerHTML = Object.values(this.agents).map(a => {
      const busy = ['WORKING', 'ASSIGNED', 'VERIFYING', 'WAITING'].includes(a.state);
      return `<div class="agent-chip ${busy ? 'working' : ''}" data-agent="${a.id}" style="--chip-color:${a.color}" title="${esc(a.step || a.role)}">
        <div class="chip-status-square" style="background:${a.color}"></div>
        <div><div class="chip-name">${a.icon} ${a.name}</div>
        <div class="chip-role" style="color:${busy ? 'var(--neon-green)' : 'var(--text-muted)'}">${a.state === 'IDLE' ? 'Idle' : '● ' + esc(a.state)}</div></div></div>`;
    }).join('');
    box.querySelectorAll('.agent-chip').forEach(ch => ch.onclick = () => {   // the same detail panel as clicking the worker
      const o = this.office; if (!o) return;
      this.showTab('agents'); o.selected = o.chars[ch.dataset.agent] || null; o._renderPanel();
    });
    const busy = Object.values(this.agents).filter(a => ['WORKING', 'VERIFYING', 'WAITING'].includes(a.state)).length;
    const el = document.getElementById('town-busy-stat');
    if (el) el.innerHTML = `<b>${busy}/${Object.keys(this.agents).length} busy</b>`;
    const act = document.getElementById('agentTownActivity');
    if (act) act.innerHTML = busy ? `Status: <b style="color:var(--neon-green)">Working (${busy} active)</b>` : 'Status: <b>Idle</b>';
  }

  applyTask(ev) {
    if (!ev) return;
    this.office?.applyTask(ev);
    if (ev.workers) for (const [id, w] of Object.entries(ev.workers)) if (this.agents[id]) Object.assign(this.agents[id], { state: w.state || 'IDLE', step: w.step || '' });
    if (ev.kind === 'result') {   // chips settle a little after the office shows the result
      clearTimeout(this._settle);
      this._settle = setTimeout(() => { for (const a of Object.values(this.agents)) if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(a.state)) a.state = 'IDLE'; this.updateChipsBar(); }, 6000);
    }
    this.updateChipsBar();
  }
  applyReply(rep) { this.office?.applyReply(rep); }
  updateFromBackendStatus(data) {
    this.office?.updateFromBackendStatus(data);
    for (const a of Object.values(this.agents)) a.state = 'IDLE';
    this.updateChipsBar();
  }
  onTaskEvent() {}
  setAgentWorking() {}
}

window.AgentTown = AgentTown;
