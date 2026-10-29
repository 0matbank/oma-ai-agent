// Oma Reader for Chrome / Edge: Oma asks (through its native host on this PC) for the list of tabs or for one tab's text,
// and this answers. A background tab is read where it is: no tab is switched to, focused, reloaded or changed.
// Chrome shows only the front tab of a window to Windows UI Automation, so the user's "Chrome-er pichoner tab-er lekha
// poro" (Oct 29, 2026) needs this. Password fields are never read: only the page's visible text (innerText).
let port = null;

function connect() {
    if (port) return;
    try {
        port = chrome.runtime.connectNative('com.oma.reader');   // an open native port also keeps this worker alive
    } catch (e) {
        port = null;
        return;
    }
    port.onMessage.addListener(onAsk);
    port.onDisconnect.addListener(() => { port = null; setTimeout(connect, 5000); });
}

function pageText() {
    const errors = [...document.querySelectorAll('[role=alert], [aria-invalid=true], .error, .errors, .error-message')]
        .map(e => (e.innerText || '').trim()).filter(Boolean).slice(0, 20);
    return { title: document.title, url: location.href, text: document.body ? document.body.innerText.slice(0, 300000) : '', errors };
}

async function onAsk(m) {
    try {
        if (m.op === 'tabs') {
            const tabs = await chrome.tabs.query({});
            port.postMessage({ id: m.id, tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active, window: t.windowId, discarded: t.discarded })) });
        } else if (m.op === 'read') {
            const tab = await chrome.tabs.get(m.tab);
            if (tab.discarded) {
                port.postMessage({ id: m.id, error: 'Chrome has put this tab to sleep (Memory Saver); its page is not loaded until it is opened.' });
                return;
            }
            const [r] = await chrome.scripting.executeScript({ target: { tabId: m.tab }, func: pageText });
            port.postMessage({ id: m.id, page: r.result, active: tab.active });
        }
    } catch (e) {
        port.postMessage({ id: m.id, error: String(e && e.message || e) });
    }
}

chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
