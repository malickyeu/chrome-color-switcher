/**
 * Color parsing, formatting and OKLab/OKLCH conversions.
 * Works both as a classic script (exposes globalThis.CCS) and as a CommonJS module (tests).
 */
(function (root) {
  'use strict';

  const NAMED = {
    aliceblue: 'f0f8ff', antiquewhite: 'faebd7', aqua: '00ffff', aquamarine: '7fffd4', azure: 'f0ffff',
    beige: 'f5f5dc', bisque: 'ffe4c4', black: '000000', blanchedalmond: 'ffebcd', blue: '0000ff',
    blueviolet: '8a2be2', brown: 'a52a2a', burlywood: 'deb887', cadetblue: '5f9ea0', chartreuse: '7fff00',
    chocolate: 'd2691e', coral: 'ff7f50', cornflowerblue: '6495ed', cornsilk: 'fff8dc', crimson: 'dc143c',
    cyan: '00ffff', darkblue: '00008b', darkcyan: '008b8b', darkgoldenrod: 'b8860b', darkgray: 'a9a9a9',
    darkgreen: '006400', darkgrey: 'a9a9a9', darkkhaki: 'bdb76b', darkmagenta: '8b008b', darkolivegreen: '556b2f',
    darkorange: 'ff8c00', darkorchid: '9932cc', darkred: '8b0000', darksalmon: 'e9967a', darkseagreen: '8fbc8f',
    darkslateblue: '483d8b', darkslategray: '2f4f4f', darkslategrey: '2f4f4f', darkturquoise: '00ced1',
    darkviolet: '9400d3', deeppink: 'ff1493', deepskyblue: '00bfff', dimgray: '696969', dimgrey: '696969',
    dodgerblue: '1e90ff', firebrick: 'b22222', floralwhite: 'fffaf0', forestgreen: '228b22', fuchsia: 'ff00ff',
    gainsboro: 'dcdcdc', ghostwhite: 'f8f8ff', gold: 'ffd700', goldenrod: 'daa520', gray: '808080',
    green: '008000', greenyellow: 'adff2f', grey: '808080', honeydew: 'f0fff0', hotpink: 'ff69b4',
    indianred: 'cd5c5c', indigo: '4b0082', ivory: 'fffff0', khaki: 'f0e68c', lavender: 'e6e6fa',
    lavenderblush: 'fff0f5', lawngreen: '7cfc00', lemonchiffon: 'fffacd', lightblue: 'add8e6', lightcoral: 'f08080',
    lightcyan: 'e0ffff', lightgoldenrodyellow: 'fafad2', lightgray: 'd3d3d3', lightgreen: '90ee90', lightgrey: 'd3d3d3',
    lightpink: 'ffb6c1', lightsalmon: 'ffa07a', lightseagreen: '20b2aa', lightskyblue: '87cefa',
    lightslategray: '778899', lightslategrey: '778899', lightsteelblue: 'b0c4de', lightyellow: 'ffffe0',
    lime: '00ff00', limegreen: '32cd32', linen: 'faf0e6', magenta: 'ff00ff', maroon: '800000',
    mediumaquamarine: '66cdaa', mediumblue: '0000cd', mediumorchid: 'ba55d3', mediumpurple: '9370db',
    mediumseagreen: '3cb371', mediumslateblue: '7b68ee', mediumspringgreen: '00fa9a', mediumturquoise: '48d1cc',
    mediumvioletred: 'c71585', midnightblue: '191970', mintcream: 'f5fffa', mistyrose: 'ffe4e1', moccasin: 'ffe4b5',
    navajowhite: 'ffdead', navy: '000080', oldlace: 'fdf5e6', olive: '808000', olivedrab: '6b8e23',
    orange: 'ffa500', orangered: 'ff4500', orchid: 'da70d6', palegoldenrod: 'eee8aa', palegreen: '98fb98',
    paleturquoise: 'afeeee', palevioletred: 'db7093', papayawhip: 'ffefd5', peachpuff: 'ffdab9', peru: 'cd853f',
    pink: 'ffc0cb', plum: 'dda0dd', powderblue: 'b0e0e6', purple: '800080', rebeccapurple: '663399',
    red: 'ff0000', rosybrown: 'bc8f8f', royalblue: '4169e1', saddlebrown: '8b4513', salmon: 'fa8072',
    sandybrown: 'f4a460', seagreen: '2e8b57', seashell: 'fff5ee', sienna: 'a0522d', silver: 'c0c0c0',
    skyblue: '87ceeb', slateblue: '6a5acd', slategray: '708090', slategrey: '708090', snow: 'fffafa',
    springgreen: '00ff7f', steelblue: '4682b4', tan: 'd2b48c', teal: '008080', thistle: 'd8bfd8',
    tomato: 'ff6347', turquoise: '40e0d0', violet: 'ee82ee', wheat: 'f5deb3', white: 'ffffff',
    whitesmoke: 'f5f5f5', yellow: 'ffff00', yellowgreen: '9acd32',
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function parseHex(hex) {
    const h = hex.replace('#', '');
    if (!/^[0-9a-f]+$/i.test(h) || ![3, 4, 6, 8].includes(h.length)) return null;
    const full = h.length <= 4 ? h.split('').map((c) => c + c).join('') : h;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    };
  }

  const NUM_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|grad|rad|turn)?$/i;

  function parseNum(token) {
    if (token === 'none') return { v: 0, unit: '' };
    const m = NUM_RE.exec(token);
    return m ? { v: parseFloat(m[1]), unit: (m[2] || '').toLowerCase() } : null;
  }

  function parseAlpha(token) {
    if (token === undefined) return 1;
    const n = parseNum(token);
    if (!n) return null;
    return clamp(n.unit === '%' ? n.v / 100 : n.v, 0, 1);
  }

  function hueToDeg(n) {
    switch (n.unit) {
      case 'rad': return (n.v * 180) / Math.PI;
      case 'grad': return n.v * 0.9;
      case 'turn': return n.v * 360;
      default: return n.v;
    }
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const a = s * Math.min(l, 1 - l);
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 };
  }

  /** Parses a CSS color into {r,g,b (0-255), a (0-1)}; returns null for anything unsupported. */
  function parseColor(input) {
    if (typeof input !== 'string') return null;
    const s = input.trim().toLowerCase();
    if (!s) return null;
    if (s[0] === '#') return parseHex(s);
    if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    if (NAMED[s]) return parseHex(NAMED[s]);
    const m = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(s);
    if (!m) return null;
    const parts = m[2].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) return null;
    const alpha = parseAlpha(parts[3]);
    if (alpha === null) return null;
    if (m[1].startsWith('rgb')) {
      const ch = parts.slice(0, 3).map(parseNum);
      if (ch.some((n) => !n || (n.unit && n.unit !== '%'))) return null;
      const [r, g, b] = ch.map((n) => clamp(n.unit === '%' ? (n.v / 100) * 255 : n.v, 0, 255));
      return { r, g, b, a: alpha };
    }
    const h = parseNum(parts[0]);
    const sat = parseNum(parts[1]);
    const lig = parseNum(parts[2]);
    if (!h || !sat || !lig || h.unit === '%') return null;
    const rgb = hslToRgb(hueToDeg(h), clamp(sat.v / 100, 0, 1), clamp(lig.v / 100, 0, 1));
    return { ...rgb, a: alpha };
  }

  const hex2 = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');

  /** Formats {r,g,b,a} as #rrggbb (opaque) or rgba(...). */
  function formatColor(c) {
    if (c.a >= 1) return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
    const a = Math.round(clamp(c.a, 0, 1) * 1000) / 1000;
    return `rgba(${Math.round(clamp(c.r, 0, 255))}, ${Math.round(clamp(c.g, 0, 255))}, ${Math.round(clamp(c.b, 0, 255))}, ${a})`;
  }

  const toHex = (c) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;

  const srgbToLinear = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const linearToSrgb = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.sign(v) * Math.abs(v) ** (1 / 2.4) - 0.055);

  /** {r,g,b,a} -> {l (0-1), c, h (deg), a} */
  function rgbToOklch({ r, g, b, a = 1 }) {
    const lr = srgbToLinear(r);
    const lg = srgbToLinear(g);
    const lb = srgbToLinear(b);
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    const C = Math.hypot(A, B);
    let h = (Math.atan2(B, A) * 180) / Math.PI;
    if (h < 0) h += 360;
    return { l: L, c: C, h: C < 1e-4 ? 0 : h, a };
  }

  function oklchToLinear({ l, c, h }) {
    const hr = (h * Math.PI) / 180;
    const A = c * Math.cos(hr);
    const B = c * Math.sin(hr);
    const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
    return [
      4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
      -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
      -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
    ];
  }

  const inGamut = (lin) => lin.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

  /** OKLCH -> sRGB, reducing chroma until the color fits into the sRGB gamut. */
  function oklchToRgb({ l, c, h, a = 1 }) {
    const L = clamp(l, 0, 1);
    let lin = oklchToLinear({ l: L, c, h });
    if (!inGamut(lin)) {
      let lo = 0;
      let hi = c;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (inGamut(oklchToLinear({ l: L, c: mid, h }))) lo = mid;
        else hi = mid;
      }
      lin = oklchToLinear({ l: L, c: lo, h });
    }
    const [r, g, b] = lin.map((v) => clamp(linearToSrgb(clamp(v, 0, 1)), 0, 255));
    return { r, g, b, a };
  }

  /** WCAG relative luminance (0-1). */
  function luminance({ r, g, b }) {
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
  }

  function contrastRatio(c1, c2) {
    const [a, b] = [luminance(c1), luminance(c2)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  }

  /** Perceptual distance in OKLab. */
  function distance(c1, c2) {
    const p = rgbToOklch(c1);
    const q = rgbToOklch(c2);
    const toLab = (o) => [o.l, o.c * Math.cos((o.h * Math.PI) / 180), o.c * Math.sin((o.h * Math.PI) / 180)];
    const [a, b] = [toLab(p), toLab(q)];
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }

  const api = {
    NAMED_COLORS: NAMED,
    clamp,
    parseColor,
    formatColor,
    toHex,
    rgbToOklch,
    oklchToRgb,
    luminance,
    contrastRatio,
    distance,
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCS = Object.assign(root.CCS || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
