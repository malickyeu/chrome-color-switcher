/**
 * Settings model shared by the popup, content script and service worker.
 *
 * Storage layout (chrome.storage.local):
 *   defaults: Settings          – used for sites without their own entry
 *   sites:    { [scope]: Settings }   scope = "host" or "host/path/prefix" (longest match wins)
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

  /**
   * The key in `sites` that applies to a location key ("host/path"): the host itself or the
   * longest path prefix matching whole segments ("/chat" matches "/chat/x", not "/chatroom").
   */
  function matchSite(sites, where) {
    if (!sites || !where) return null;
    const { host, path } = splitKey(where);
    let best = null;
    let bestLen = -1;
    for (const key of Object.keys(sites)) {
      const k = splitKey(key);
      if (k.host !== host) continue;
      const prefix = trimPath(k.path);
      const hit = !prefix || path === prefix || path.startsWith(prefix + '/');
      if (hit && prefix.length > bestLen) {
        best = key;
        bestLen = prefix.length;
      }
    }
    return best;
  }

  /** Settings that apply to a host or location key: the best matching site entry, otherwise the defaults. */
  function effectiveSettings(store, where) {
    const st = store || {};
    const key = matchSite(st.sites, where);
    return normalizeSettings(key ? st.sites[key] : st.defaults);
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

  const api = { MODES, DEFAULTS, normalizeSettings, effectiveSettings, matchSite, scopesFor, splitKey, locationKey, topHost, hostFromUrl };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCS = Object.assign(root.CCS || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
