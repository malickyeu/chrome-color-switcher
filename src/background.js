/* Service worker: cross-origin CSS fetching, keyboard shortcut, toolbar badge. */
importScripts('settings.js');

const CCS = globalThis.CCS;
const MAX_CSS_BYTES = 5 * 1024 * 1024;

/**
 * Content scripts cannot read cssRules of cross-origin stylesheets, so they ask us for the text.
 * Requests go without cookies and only CSS-looking responses are returned.
 */
async function fetchCss(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('unsupported protocol');
  const resp = await fetch(u.href, { credentials: 'omit', cache: 'force-cache' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const type = resp.headers.get('content-type') || '';
  if (type && !/css|text\/plain/i.test(type)) throw new Error(`unexpected content-type ${type}`);
  const text = await resp.text();
  if (text.length > MAX_CSS_BYTES) throw new Error('stylesheet too large');
  return text;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || sender.id !== chrome.runtime.id) return undefined;
  if (msg.type === 'fetchCss') {
    fetchCss(msg.url).then(
      (text) => sendResponse({ ok: true, text }),
      (err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }),
    );
    return true;
  }
  if (msg.type === 'status' && sender.tab) {
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: msg.enabled ? 'ON' : '' });
    chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#4f7cff' });
  }
  return undefined;
});

async function toggleSite(tab) {
  const host = tab && CCS.hostFromUrl(tab.url || '');
  if (!host) return;
  const store = await chrome.storage.local.get(['defaults', 'sites']);
  const current = CCS.effectiveSettings(store, host);
  const sites = { ...(store.sites || {}), [host]: { ...current, enabled: !current.enabled } };
  await chrome.storage.local.set({ sites });
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-site') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await toggleSite(tab);
});
