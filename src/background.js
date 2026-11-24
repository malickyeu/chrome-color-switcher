/* Service worker: cross-origin CSS fetching, content script injection, URL change notices, shortcut, badge. */
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

const CONTENT_FILES = chrome.runtime.getManifest().content_scripts[0].js;

/**
 * Makes sure the content script runs in a tab. Tabs opened before the extension was installed or
 * reloaded have none (or an orphaned one), so switching and analysis would need a page reload.
 */
async function ensureContent(tabId) {
  try {
    const resp = await chrome.tabs.sendMessage(tabId, { type: 'ping' }, { frameId: 0 });
    if (resp && resp.ok) return { ok: true, injected: false };
  } catch (e) {
    /* no live content script */
  }
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: CONTENT_FILES });
  return { ok: true, injected: true };
}

const STORE_SCHEMA = 2;

chrome.runtime.onInstalled.addListener(async () => {
  // 0.3 stored a full copy of the scheme per site; since 0.4 the scheme is shared.
  const { schema = 1, sites } = await chrome.storage.local.get(['schema', 'sites']);
  if (schema < STORE_SCHEMA) await chrome.storage.local.set({ schema: STORE_SCHEMA, sites: CCS.migrateSites(sites) });
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] });
  for (const tab of tabs) {
    if (!tab.discarded) chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: CONTENT_FILES }).catch(() => {});
  }
});

// Settings can be scoped to a path, and single-page apps change it without a reload.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url) chrome.tabs.sendMessage(tabId, { type: 'url', url: info.url }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || sender.id !== chrome.runtime.id) return undefined;
  if (msg.type === 'tabUrl') {
    sendResponse({ url: sender.tab ? sender.tab.url : null });
    return undefined;
  }
  if (msg.type === 'ensureContent') {
    ensureContent(msg.tabId).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));
    return true;
  }
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

/** Toggles the scope that currently applies to the tab (a path scope if one matches, else the host). */
async function toggleSite(tab) {
  const where = tab && CCS.locationKey(tab.url || '');
  if (!where) return;
  const store = await chrome.storage.local.get(['defaults', 'sites']);
  const key = CCS.matchSite(store.sites, where) || CCS.splitKey(where).host;
  const current = CCS.effectiveSettings(store, where);
  const sites = { ...(store.sites || {}), [key]: { ...((store.sites || {})[key] || {}), enabled: !current.enabled } };
  await chrome.storage.local.set({ sites });
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-site') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await toggleSite(tab);
});
