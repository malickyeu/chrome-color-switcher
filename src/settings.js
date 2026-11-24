/**
 * Settings model shared by the popup, content script and service worker.
 *
 * Storage layout (chrome.storage.local):
 *   defaults: Settings          – used for sites without their own entry
 *   sites:    { [host]: Settings }
 *   detected: { [host]: 'light'|'dark' } – last detected page base (for the "flip" mode)
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

  /** Settings that apply to `host`: its own entry, otherwise the global defaults. */
  function effectiveSettings(store, host) {
    const st = store || {};
    const site = st.sites && host ? st.sites[host] : undefined;
    return normalizeSettings(site || st.defaults);
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

  const api = { MODES, DEFAULTS, normalizeSettings, effectiveSettings, topHost, hostFromUrl };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCS = Object.assign(root.CCS || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
