/**
 * Color schemes: turns user settings into a scheme object and remaps single colors
 * according to their role (bg / text / border / shadow / auto).
 */
(function (root) {
  'use strict';

  const isNode = typeof module === 'object' && module.exports;
  const C = isNode ? require('./color.js') : root.CCS;
  const { clamp } = C;

  const PRESETS = {
    dark: { bg: '#181a1b', text: '#e8e6e3' },
    light: { bg: '#fbfbfa', text: '#1d1d1f' },
    sepia: { bg: '#f4ecd8', text: '#433422', hue: '#8a5a2b' },
  };

  /** Below this OKLCH chroma a color counts as neutral (white/gray/black). */
  const NEUTRAL_CHROMA = 0.03;

  const oklchOf = (hex) => C.rgbToOklch(C.parseColor(hex) || C.parseColor('#808080'));

  /**
   * @param {object} settings normalized settings (see settings.js)
   * @param {'light'|'dark'} [pageBase] detected base of the page; used by the "flip" mode
   */
  function buildScheme(settings, pageBase = 'light') {
    const mode = settings.mode;
    let target;
    let bg;
    let text;
    let accent = null;
    let mono = null;

    switch (mode) {
      case 'light':
        target = 'light';
        break;
      case 'dark':
        target = 'dark';
        break;
      case 'mono':
      case 'gray':
        target = settings.monoTarget === 'light' ? 'light' : 'dark';
        break;
      case 'sepia':
        target = 'light';
        break;
      case 'custom':
        target = oklchOf(settings.custom.bg).l < 0.5 ? 'dark' : 'light';
        break;
      default: // flip
        target = pageBase === 'dark' ? 'light' : 'dark';
    }

    if (mode === 'custom') {
      bg = oklchOf(settings.custom.bg);
      text = oklchOf(settings.custom.text);
      accent = oklchOf(settings.custom.accent);
    } else if (mode === 'sepia') {
      bg = oklchOf(PRESETS.sepia.bg);
      text = oklchOf(PRESETS.sepia.text);
      mono = { hue: oklchOf(PRESETS.sepia.hue).h, chroma: 0.06, neutralChroma: 0.025 };
    } else {
      bg = oklchOf(PRESETS[target].bg);
      text = oklchOf(PRESETS[target].text);
      if (mode === 'mono') {
        const hue = oklchOf(settings.monoColor).h;
        mono = { hue, chroma: 0.1, neutralChroma: 0.022 };
        bg = { ...bg, c: 0.02, h: hue };
        text = { ...text, c: 0.025, h: hue };
      } else if (mode === 'gray') {
        mono = { hue: 0, chroma: 0, neutralChroma: 0 };
        bg = { ...bg, c: 0 };
        text = { ...text, c: 0 };
      }
    }

    return {
      mode,
      target,
      bgL: bg.l,
      textL: text.l,
      bgTint: { h: bg.h, c: bg.c },
      textTint: { h: text.h, c: text.c },
      accent: accent && accent.c >= NEUTRAL_CHROMA ? { h: accent.h, c: accent.c } : null,
      mono,
      contrast: settings.contrast,
      brightness: settings.brightness,
      bg: C.toHex(C.oklchToRgb(bg)),
      text: C.toHex(C.oklchToRgb(text)),
    };
  }

  /**
   * Lightness mapping for a dark target. `L` is the source lightness, bgL/textL target lightness
   * of the page background/text. Light backgrounds become dark, dark text becomes light; colors that
   * already fit the target are kept (only clamped into a sane range).
   */
  function mapDarkLightness(L, role, bgL, textL) {
    switch (role) {
      case 'text':
        return L <= 0.5 ? textL - L * 0.3 : Math.max(L, textL - 0.15);
      case 'border':
        return clamp(mapDarkLightness(L, 'bg', bgL, textL) + 0.12, 0, textL - 0.2);
      case 'shadow':
        return Math.min(L, bgL * 0.5);
      case 'bg':
      default:
        return L >= 0.5 ? bgL + (1 - L) * 0.4 : clamp(L, Math.max(0, bgL - 0.1), bgL + 0.2);
    }
  }

  /** For a light target we mirror the lightness axis and reuse the dark mapping. */
  function mapLightness(L, role, scheme) {
    if (scheme.target === 'dark') return mapDarkLightness(L, role, scheme.bgL, scheme.textL);
    return 1 - mapDarkLightness(1 - L, role, 1 - scheme.bgL, 1 - scheme.textL);
  }

  /** Decides the role of a color whose usage is unknown (e.g. an unused CSS variable). */
  function resolveAutoRole(L, scheme) {
    const srcLight = scheme.target === 'dark' ? L > 0.5 : L < 0.5;
    return srcLight ? 'bg' : 'text';
  }

  /**
   * Remaps one color.
   * @param {{r,g,b,a}} color
   * @param {'bg'|'text'|'border'|'shadow'|'auto'} role
   */
  function transformColor(color, role, scheme) {
    if (color.a === 0) return color;
    const o = C.rgbToOklch(color);
    const r = role === 'auto' ? resolveAutoRole(o.l, scheme) : role;
    let L = mapLightness(o.l, r, scheme);
    let c = o.c;
    let h = o.h;
    const neutral = o.c < NEUTRAL_CHROMA;

    if (scheme.mono) {
      h = scheme.mono.hue;
      c = neutral ? scheme.mono.neutralChroma : scheme.mono.chroma;
    } else if (neutral) {
      const tint = r === 'text' ? scheme.textTint : scheme.bgTint;
      h = tint.h;
      c = tint.c;
    } else {
      if (scheme.accent) h = scheme.accent.h;
      // Saturated light backgrounds would turn into murky neon when darkened.
      if (r === 'bg' && scheme.target === 'dark') c *= 0.75;
    }

    L = clamp((L - 0.5) * scheme.contrast + 0.5 + scheme.brightness, 0, 1);
    return C.oklchToRgb({ l: L, c, h, a: color.a });
  }

  const api = { PRESETS, NEUTRAL_CHROMA, buildScheme, transformColor, mapLightness };

  if (isNode) module.exports = api;
  else root.CCS = Object.assign(root.CCS || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
