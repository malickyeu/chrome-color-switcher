/**
 * Settings model shared by the popup, content script and service worker.
 *
 * Storage layout (chrome.storage.local):
 *   defaults: Settings          – the shared scheme (and whether the extension is on by default)
 *   sites:    { [scope]: Partial<Settings> }   scope = "host" or "host/path/prefix"
 *             Usually just {enabled}; an entry with scheme fields has its own scheme.
 *             Entries are layered from the host to the longest matching path prefix.
 *   detected: { [scope]: 'light'|'dark' } – last detected page base (for the "flip" mode)
 */
(function (root) {
  'use strict';

  const MODES = ['flip', 'dark', 'light', 'filter', 'mono', 'sepia', 'gray', 'custom'];

  const DEFAULTS = Object.freeze({
    enabled: false,
    mode: 'flip',
    contrast: 1,
    brightness: 0,
    dimImages: false,
    monoColor: '#4f7cff',
    monoTarget: 'dark',
    custom: Object.freeze({ bg: '#1e1e2e', text: '#cdd6f4', accent: '#f5a97f' }),
  });

  /** Everything except `enabled`: the part that is shared unless a site has its own scheme. */
  const SCHEME_KEYS = ['mode', 'contrast', 'brightness', 'dimImages', 'monoColor', 'monoTarget', 'custom'];

  const HEX_RE = /^#[0-9a-f]{6}$/i;

  const num = (v, lo, hi, def) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
  const hex = (v, def) => (typeof v === 'string' && HEX_RE.test(v) ? v.toLowerCase() : def);

  /** Fills in defaults and drops invalid values. */
  function normalizeSettings(input) {
    const s = input && typeof input === 'object' ? input : {};
    const custom = s.custom && typeof s.custom === 'object' ? s.custom : {};
    return {
      enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULTS.enabled,
      mode: MODES.includes(s.mode) ? s.mode : DEFAULTS.mode,
      contrast: num(s.contrast, 0.5, 1.5, DEFAULTS.contrast),
      brightness: num(s.brightness, -0.3, 0.3, DEFAULTS.brightness),
      dimImages: typeof s.dimImages === 'boolean' ? s.dimImages : DEFAULTS.dimImages,
      monoColor: hex(s.monoColor, DEFAULTS.monoColor),
      monoTarget: s.monoTarget === 'light' ? 'light' : 'dark',
      custom: {
        bg: hex(custom.bg, DEFAULTS.custom.bg),
        text: hex(custom.text, DEFAULTS.custom.text),
        accent: hex(custom.accent, DEFAULTS.custom.accent),
      },
    };
  }

  /** Splits a scope or location key ("host/path") into host and path ("" for the whole host). */
  function splitKey(key) {
    if (key.startsWith('file://')) return { host: 'file://', path: '' };
    const i = key.indexOf('/');
    return i < 0 ? { host: key, path: '' } : { host: key.slice(0, i), path: key.slice(i) };
  }

  /** Path prefix without trailing slashes, so "/chat/" and "/chat" are the same scope. */
  const trimPath = (p) => p.replace(/\/+$/, '');

  /** Keys in `sites` that apply to a location key, from the host to the longest path prefix. */
  function matchingKeys(sites, where) {
    if (!sites || !where) return [];
    const { host, path } = splitKey(where);
    const hits = [];
    for (const key of Object.keys(sites)) {
      const k = splitKey(key);
      if (k.host !== host) continue;
      const prefix = trimPath(k.path);
      if (!prefix || path === prefix || path.startsWith(prefix + '/')) hits.push([prefix.length, key]);
    }
    return hits.sort((a, b) => a[0] - b[0]).map((h) => h[1]);
  }

  /**
   * The most specific key in `sites` that applies to a location key: the host itself or the
   * longest path prefix matching whole segments ("/chat" matches "/chat/x", not "/chatroom").
   */
  function matchSite(sites, where) {
    const keys = matchingKeys(sites, where);
    return keys.length ? keys[keys.length - 1] : null;
  }

  const hasOwnScheme = (entry) => !!entry && SCHEME_KEYS.some((k) => k in entry);

  /** The most specific matching key with its own scheme, or null when the shared scheme applies. */
  function schemeSource(sites, where) {
    const keys = matchingKeys(sites, where).filter((k) => hasOwnScheme(sites[k]));
    return keys.length ? keys[keys.length - 1] : null;
  }

  /** Settings for a host or location key: defaults, then matching entries from host to longest path. */
  function effectiveSettings(store, where) {
    const st = store || {};
    let out = { ...(st.defaults || {}) };
    for (const key of matchingKeys(st.sites, where)) out = { ...out, ...st.sites[key] };
    return normalizeSettings(out);
  }

  const pickScheme = (state) => Object.fromEntries(SCHEME_KEYS.map((k) => [k, state[k]]));
  const dropScheme = (entry) => Object.fromEntries(Object.entries(entry || {}).filter(([k]) => !SCHEME_KEYS.includes(k)));

  /**
   * Writes settings edited for `scope` (null = global defaults) and returns the new {defaults, sites}.
   * `enabled` is stored on the scope itself; the scheme goes where it comes from: the entry with its
   * own scheme that applies to the scope, otherwise the shared defaults.
   */
  function writeSettings(store, scope, state) {
    const defaults = { ...(store.defaults || {}) };
    const sites = { ...(store.sites || {}) };
    if (!scope) return { defaults: { ...defaults, ...pickScheme(state), enabled: state.enabled }, sites };
    sites[scope] = { ...(sites[scope] || {}), enabled: state.enabled };
    const source = schemeSource(sites, scope);
    if (source) sites[source] = { ...sites[source], ...pickScheme(state) };
    else Object.assign(defaults, pickScheme(state));
    return { defaults, sites };
  }

  /** Gives `scope` its own copy of the scheme it currently uses, or drops it back to the inherited one. */
  function setOwnScheme(store, scope, own) {
    const sites = { ...(store.sites || {}) };
    const current = effectiveSettings(store, scope);
    sites[scope] = own ? { ...(sites[scope] || {}), ...pickScheme(current) } : dropScheme(sites[scope]);
    if (!own && !Object.keys(sites[scope]).length) delete sites[scope];
    return { defaults: { ...(store.defaults || {}) }, sites };
  }

  /** One-time migration from 0.3: site entries were full copies of the scheme; keep only `enabled`. */
  function migrateSites(sites) {
    return Object.fromEntries(Object.entries(sites || {}).map(([k, v]) => [k, dropScheme(v)]));
  }

  /** Scopes offered for a location: the whole host plus up to `depth` leading path segments. */
  function scopesFor(where, depth = 2) {
    const { host, path } = splitKey(where);
    const segs = path.split('/').filter(Boolean).slice(0, depth);
    const out = [host];
    for (let i = 1; i <= segs.length; i++) out.push(`${host}/${segs.slice(0, i).join('/')}`);
    return out;
  }

  /** Location key ("host/path") of a URL, or null for pages the extension cannot run on. */
  function locationKey(url) {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.hostname + u.pathname;
      if (u.protocol === 'file:') return 'file://';
    } catch (e) {
      /* invalid */
    }
    return null;
  }

  /** Hostname of the top-level page, so that iframes follow the settings of the tab. */
  function topHost(loc) {
    const anc = loc.ancestorOrigins;
    const top = anc && anc.length ? anc[anc.length - 1] : loc.href;
    return hostFromUrl(top) || '';
  }

  /** Host key used for storage, or null for pages the extension cannot run on. */
  function hostFromUrl(url) {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.hostname;
      if (u.protocol === 'file:') return 'file://';
    } catch (e) {
      /* invalid */
    }
    return null;
  }

  const api = { MODES, DEFAULTS, SCHEME_KEYS, normalizeSettings, effectiveSettings, matchSite, matchingKeys, schemeSource, writeSettings, setOwnScheme, migrateSites, scopesFor, splitKey, locationKey, topHost, hostFromUrl };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCS = Object.assign(root.CCS || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
