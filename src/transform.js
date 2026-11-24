/**
 * CSS rewriting: finds colors in declaration values and stylesheet rules and produces
 * override CSS with remapped colors. Works on CSSOM objects (duck-typed, so tests can use mocks).
 */
(function (root) {
  'use strict';

  const isNode = typeof module === 'object' && module.exports;
  const CCS = isNode ? { ...require('./color.js'), ...require('./scheme.js') } : root.CCS;

  const TEXT_PROPS = new Set([
    'color', 'caret-color', 'text-decoration-color', 'text-emphasis-color',
    '-webkit-text-fill-color', '-webkit-text-stroke-color', 'fill', 'stroke',
  ]);

  /** Shorthands whose longhands are empty when the shorthand contains var(). */
  const VAR_SHORTHANDS = [
    'background', 'border', 'border-color', 'border-top', 'border-right', 'border-bottom', 'border-left',
    'border-block', 'border-inline', 'border-block-start', 'border-block-end', 'border-inline-start',
    'border-inline-end', 'outline', 'text-decoration', 'column-rule',
  ];

  /** Role of the colors used in a property, 'var' for custom properties, null if not color-bearing. */
  function roleForProperty(prop) {
    if (prop.startsWith('--')) return 'var';
    if (TEXT_PROPS.has(prop) || prop === 'text-decoration') return 'text';
    if (prop.startsWith('background')) return 'bg';
    if (prop.startsWith('border') || prop.startsWith('outline') || prop.startsWith('column-rule')) return 'border';
    if (prop === 'box-shadow' || prop === 'text-shadow') return 'shadow';
    return null;
  }

  // 1: protected segment (url(), strings), 2: color candidate
  const TOKEN_RE = /(url\((?:[^()]|\([^()]*\))*\)|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(#[0-9a-fA-F]{3,8}(?![\w-])|(?<![\w-])(?:rgba?|hsla?)\([^()]*\)|(?<![\w-])[a-zA-Z]+(?![\w(-]))/g;
  const TRIPLET_RE = /^(\s*)(\d{1,3})(\s*,\s*|\s+)(\d{1,3})(\s*,\s*|\s+)(\d{1,3})(\s*)$/;

  /** Replaces every color literal in a declaration value. Unknown tokens are left untouched. */
  function transformValue(value, role, scheme) {
    return value.replace(TOKEN_RE, (match, protectedSeg, candidate) => {
      if (protectedSeg) return match;
      const lower = candidate.toLowerCase();
      if (lower === 'transparent' || lower === 'currentcolor') return match;
      if (/^[a-z]+$/.test(lower) && !CCS.NAMED_COLORS[lower]) return match;
      const color = CCS.parseColor(candidate);
      if (!color) return match;
      return CCS.formatColor(CCS.transformColor(color, role, scheme));
    });
  }

  /** All color literals found in a declaration value. */
  function findColors(value) {
    const out = [];
    value.replace(TOKEN_RE, (match, protectedSeg, candidate) => {
      if (!protectedSeg && candidate) {
        const lower = candidate.toLowerCase();
        if (lower !== 'currentcolor' && lower !== 'transparent' && (!/^[a-z]+$/.test(lower) || CCS.NAMED_COLORS[lower])) {
          const c = CCS.parseColor(candidate);
          if (c && c.a > 0) out.push(c);
        }
      }
      return match;
    });
    return out;
  }

  /**
   * Override rules live in our own <style>, so relative url()s must be resolved against the
   * stylesheet they came from.
   */
  function absolutizeUrls(value, baseUrl) {
    if (!baseUrl || !value.includes('url(')) return value;
    return value.replace(/url\(\s*(['"]?)([^'")]*?)\1\s*\)/g, (m, q, u) => {
      if (!u || /^(?:[a-z][\w+.-]*:|#|\/\/)/i.test(u)) return m;
      try {
        return `url("${new URL(u, baseUrl).href}")`;
      } catch (e) {
        return m;
      }
    });
  }

  /**
   * Value of a custom property. Besides normal colors it supports bare RGB triplets
   * ("255, 255, 255" / "255 255 255") used by frameworks as rgba(var(--x-rgb), .5).
   */
  function transformCustomProperty(value, role, scheme) {
    const t = TRIPLET_RE.exec(value);
    if (t) {
      const ch = [t[2], t[4], t[6]].map(Number);
      if (ch.every((v) => v <= 255)) {
        const out = CCS.transformColor({ r: ch[0], g: ch[1], b: ch[2], a: 1 }, role, scheme);
        const [r, g, b] = [out.r, out.g, out.b].map(Math.round);
        return `${t[1]}${r}${t[3]}${g}${t[5]}${b}${t[7]}`;
      }
    }
    return transformValue(value, role, scheme);
  }

  const VAR_REF_RE = /var\(\s*(--[\w-]+)/g;

  const NAME_HINTS = [
    ['shadow', /shadow/i],
    ['border', /(^|[-_])(border|outline|divider|separator|stroke|line|rule)s?([-_]|$)/i],
    ['bg', /(^|[-_])(bg|background|backdrop|surface|canvas|base|layer|panel|card|paper|page|body|fill|highlight)s?([-_]|$)/i],
    ['text', /(^|[-_])(text|fg|foreground|font|ink|color|heading|title|link|on)s?([-_]|$)/i],
  ];

  function walkDeclarations(rules, visit) {
    for (const rule of rules) {
      try {
        if (rule.style) {
          for (let i = 0; i < rule.style.length; i++) {
            const prop = rule.style[i];
            visit(prop, rule.style.getPropertyValue(prop));
          }
          for (const sh of VAR_SHORTHANDS) {
            const v = rule.style.getPropertyValue(sh);
            if (v && v.includes('var(')) visit(sh, v);
          }
        }
        if (rule.cssRules) walkDeclarations(rule.cssRules, visit);
        else if (rule.styleSheet && rule.styleSheet.cssRules) walkDeclarations(rule.styleSheet.cssRules, visit);
      } catch (e) {
        /* cross-origin @import etc. */
      }
    }
  }

  /**
   * Learns how custom properties are used (as background, text, ...) so their definitions can be
   * remapped with the right role.
   * @param {Array<ArrayLike<CSSRule>>} ruleLists
   * @param {Array<[string,string]>} [extraDecls] e.g. inline styles
   * @returns {(name:string)=>string} resolver name -> role
   */
  function createVarRoleResolver(ruleLists, extraDecls = []) {
    const counts = new Map(); // name -> {role: n}
    const aliases = new Map(); // --a -> Set(--b) where --a: var(--b)
    const visit = (prop, value) => {
      if (!value || !value.includes('var(')) return;
      const role = roleForProperty(prop);
      if (!role) return;
      for (const m of value.matchAll(VAR_REF_RE)) {
        const name = m[1];
        if (role === 'var') {
          if (!aliases.has(prop)) aliases.set(prop, new Set());
          aliases.get(prop).add(name);
        } else {
          const c = counts.get(name) || {};
          c[role] = (c[role] || 0) + 1;
          counts.set(name, c);
        }
      }
    };
    for (const rules of ruleLists) walkDeclarations(rules, visit);
    for (const [prop, value] of extraDecls) visit(prop, value);

    // Propagate usage through aliases (--a: var(--b) → --b is used like --a); two rounds are plenty.
    for (let round = 0; round < 2; round++) {
      for (const [from, targets] of aliases) {
        const src = counts.get(from);
        if (!src) continue;
        for (const to of targets) {
          const dst = counts.get(to) || {};
          for (const [role, n] of Object.entries(src)) dst[role] = Math.max(dst[role] || 0, n);
          counts.set(to, dst);
        }
      }
    }

    const cache = new Map();
    return (name) => {
      if (cache.has(name)) return cache.get(name);
      let role = null;
      const c = counts.get(name);
      if (c) {
        const sorted = Object.entries(c).sort((a, b) => b[1] - a[1]);
        if (sorted.length === 1 || sorted[0][1] > sorted[1][1]) role = sorted[0][0];
      }
      if (!role) {
        const hint = NAME_HINTS.find(([, re]) => re.test(name));
        role = hint ? hint[0] : c ? Object.keys(c)[0] : 'auto';
      }
      cache.set(name, role);
      return role;
    };
  }

  /**
   * Remapped declarations of a CSSStyleDeclaration.
   * @param {boolean} full include unchanged declarations too (needed for @keyframes)
   * @returns {{entries: Array<{prop,value,priority}>, changed: boolean}}
   */
  function transformDeclarations(style, ctx, full = false) {
    const entries = [];
    let changed = false;
    const handle = (prop, value) => {
      const role = roleForProperty(prop);
      let out = value;
      if (role === 'var') out = transformCustomProperty(value, ctx.varRole(prop), ctx.scheme);
      else if (role) out = transformValue(value, role, ctx.scheme);
      const priority = style.getPropertyPriority(prop);
      if (out !== value) {
        out = absolutizeUrls(out, ctx.baseUrl);
        changed = true;
        entries.push({ prop, value: out, priority });
      } else if (full) {
        entries.push({ prop, value, priority });
      }
    };
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      const value = style.getPropertyValue(prop);
      if (value) handle(prop, value);
    }
    for (const sh of VAR_SHORTHANDS) {
      const value = style.getPropertyValue(sh);
      if (value && value.includes('var(')) handle(sh, value);
    }
    return { entries, changed };
  }

  const serialize = (entries) =>
    entries.map((e) => `${e.prop}:${e.value}${e.priority ? ' !' + e.priority : ''};`).join('');

  function preludeOf(rule) {
    const text = rule.cssText || '';
    const i = text.indexOf('{');
    return i > 0 ? text.slice(0, i).trim() : '';
  }

  /**
   * Builds override CSS for a list of rules. Every rule that sets a color gets a copy with the
   * same selector (thus same specificity) containing just the remapped colors. Appended after the
   * page styles in the same order, the cascade stays intact.
   * @param ctx {{scheme, varRole, onImport?: (href, media) => string}}
   */
  function transformRules(rules, ctx, insideStyleRule = false) {
    let out = '';
    for (const rule of Array.from(rules)) {
      try {
        const css = transformRule(rule, ctx, insideStyleRule);
        out += typeof css === 'string' ? css : css.css;
      } catch (e) {
        /* skip a rule we cannot read */
      }
    }
    return out;
  }

  function transformRule(rule, ctx, insideStyleRule) {
    // @import
    if (rule.styleSheet !== undefined && rule.href !== undefined) {
      const media = rule.media && rule.media.mediaText;
      let inner = '';
      try {
        inner = rule.styleSheet ? transformRules(rule.styleSheet.cssRules, { ...ctx, baseUrl: rule.styleSheet.href || ctx.baseUrl }) : '';
      } catch (e) {
        inner = ctx.onImport ? ctx.onImport(rule.href) : '';
      }
      return inner && media && media !== 'all' ? `@media ${media}{${inner}}` : inner;
    }
    // style rule (possibly with nested rules)
    if (typeof rule.selectorText === 'string' && rule.style) {
      if (!rule.selectorText) return '';
      const { entries } = transformDeclarations(rule.style, ctx);
      const nested = rule.cssRules && rule.cssRules.length ? transformRules(rule.cssRules, ctx, true) : '';
      return entries.length || nested ? `${rule.selectorText}{${serialize(entries)}${nested}}` : '';
    }
    // keyframe inside @keyframes: emitted in full, a later @keyframes replaces the original
    if (typeof rule.keyText === 'string' && rule.style) {
      const { entries, changed } = transformDeclarations(rule.style, ctx, true);
      return { css: `${rule.keyText}{${serialize(entries)}}`, changed };
    }
    // nested declarations (CSSNestedDeclarations) inside a style rule
    if (insideStyleRule && rule.style && !rule.cssRules) {
      return serialize(transformDeclarations(rule.style, ctx).entries);
    }
    // @keyframes
    if (rule.cssRules && /^@(-webkit-)?keyframes\b/i.test(preludeOf(rule))) {
      let changed = false;
      let inner = '';
      for (const kf of rule.cssRules) {
        const r = transformRule(kf, ctx, false);
        if (r && typeof r === 'object') {
          inner += r.css;
          changed = changed || r.changed;
        }
      }
      return changed ? `${preludeOf(rule)}{${inner}}` : '';
    }
    // grouping rules: @media, @supports, @layer, @container, @scope, @document...
    if (rule.cssRules) {
      const inner = transformRules(rule.cssRules, ctx, insideStyleRule);
      const prelude = preludeOf(rule);
      return inner && prelude ? `${prelude}{${inner}}` : '';
    }
    return '';
  }

  const api = {
    roleForProperty,
    transformValue,
    transformCustomProperty,
    findColors,
    absolutizeUrls,
    createVarRoleResolver,
    transformDeclarations,
    transformRules,
  };

  if (isNode) module.exports = api;
  else root.CCS = Object.assign(root.CCS || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
