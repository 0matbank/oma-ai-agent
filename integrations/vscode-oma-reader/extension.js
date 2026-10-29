// Oma Reader for VS Code: lets Oma read this VS Code window while it stays behind other windows (the user, Oct 29, 2026:
// "Chrome samne rekhe VS Code-er unsaved code, terminal output, problems porte parbe"). Windows UI Automation shows only
// the editor lines on screen and nothing of the terminal, so VS Code's own API is asked instead.
// Read-only: it never edits, runs or focuses anything. It answers only on 127.0.0.1, only to a request carrying the
// random token it wrote to %APPDATA%\Atticus\vscode_reader_<pid>.json (a file only this Windows user can read).
// Terminal output: what commands print after this extension started (VS Code shell integration); older scrollback is
// not exposed by VS Code's API.
const vscode = require('vscode');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_TERM = 40000;
const out = new Map();   // terminal -> printed text (newest MAX_TERM characters)
let last = null;   // the last text editor used: with a chat or webview panel in front VS Code reports none as active

function strip(s) {
    return s.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\r(?!\n)/g, '');
}

function add(t, s) {
    out.set(t, ((out.get(t) || '') + s).slice(-MAX_TERM));
}

function where(doc) {
    return doc.uri.scheme === 'file' ? doc.uri.fsPath : `${doc.uri.scheme}:${doc.uri.path}`;
}

function state() {
    const ed = vscode.window.activeTextEditor || (last && vscode.workspace.textDocuments.includes(last.document) ? last : null) || vscode.window.visibleTextEditors[0];
    const sev = ['Error', 'Warning', 'Information', 'Hint'];
    const diagnostics = [];
    for (const [uri, list] of vscode.languages.getDiagnostics())
        for (const d of list)
            if (diagnostics.length < 300)
                diagnostics.push({ file: uri.fsPath, line: d.range.start.line + 1, severity: sev[d.severity], message: d.message, source: d.source || '' });
    const docs = vscode.workspace.textDocuments.filter(d => d.uri.scheme === 'file' || d.uri.scheme === 'untitled');
    return {
        workspace: vscode.workspace.name || '',
        folders: (vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath),
        active: ed ? {
            file: where(ed.document), language: ed.document.languageId, unsaved: ed.document.isDirty, lines: ed.document.lineCount,
            cursorLine: ed.selection.active.line + 1, selection: ed.document.getText(ed.selection).slice(0, 20000),
            text: ed.document.getText().slice(0, 200000)
        } : null,
        unsaved: docs.filter(d => d.isDirty && (!ed || d !== ed.document)).slice(0, 10).map(d => ({ file: where(d), text: d.getText().slice(0, 50000) })),
        open: vscode.window.tabGroups.all.flatMap(g => g.tabs).slice(0, 60).map(t => ({ label: t.label, unsaved: t.isDirty, active: t.isActive })),
        diagnostics,
        terminals: vscode.window.terminals.map(t => ({ name: t.name, active: t === vscode.window.activeTerminal, output: out.get(t) || '' }))
    };
}

function activate(ctx) {
    last = vscode.window.activeTextEditor || null;
    ctx.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(e => { if (e) last = e; }));
    if (vscode.window.onDidStartTerminalShellExecution)
        ctx.subscriptions.push(vscode.window.onDidStartTerminalShellExecution(async e => {
            add(e.terminal, `\n$ ${(e.execution.commandLine && e.execution.commandLine.value) || ''}\n`);
            try { for await (const d of e.execution.read()) add(e.terminal, strip(d)); } catch (_) { }
        }));
    ctx.subscriptions.push(vscode.window.onDidCloseTerminal(t => out.delete(t)));
    const token = crypto.randomBytes(16).toString('hex');
    const server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (req.method !== 'GET' || u.pathname !== '/state' || u.searchParams.get('token') !== token) { res.writeHead(403); return res.end(); }
        let body;
        try { body = JSON.stringify(state()); } catch (e) { res.writeHead(500); return res.end(String(e)); }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(body);
    });
    server.listen(0, '127.0.0.1', () => {
        const dir = process.env.ATTICUS_DIR || path.join(process.env.APPDATA || '', 'Atticus');
        const file = path.join(dir, `vscode_reader_${process.pid}.json`);
        try {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(file, JSON.stringify({ port: server.address().port, token, pid: process.pid, workspace: vscode.workspace.name || '' }));
        } catch (_) { }
        ctx.subscriptions.push({ dispose() { try { fs.unlinkSync(file); } catch (_) { } server.close(); } });
    });
}

exports.activate = activate;
exports.deactivate = () => { };
