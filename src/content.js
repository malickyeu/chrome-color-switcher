/**
 * Content script: applies the selected scheme to the page and answers analysis requests.
 *
 * Smart modes rewrite the page CSS: every rule that sets a color gets a copy with remapped colors
 * in our own <style>, which is kept as the last element so the cascade order is preserved.
 * The "filter" mode just inverts the whole page with a CSS filter.
 */
(() => {
  'use strict';
  if (window.__ccsContentLoaded) return;
  window.__ccsContentLoaded = true;

  const CCS = globalThis.CCS;
  const OWN_ATTR = 'data-ccs';
  const host = CCS.topHost(location);
  const isTop = window === window.top;
  const POLL_MS = 1500;

  let settings = CCS.normalizeSettings(null);
  let pageBase = 'light';
  let scheme = null;
  let schemeVersion = 0;
  let applied = null; // null | 'smart' | 'filter'
  let styleEl = null;
  let sheetsCss = '';
  let ctx = null;
  let observer = null;
  let pollTimer = null;
  let rebuildTimer = null;
  let rebuildSheets = false;
  let lastSignature = '';

  const fetched = new Map(); // href -> {state: 'pending'|'done'|'error', rules?}
  const inlineState = new WeakMap(); // element -> {original, written, version}
  const touched = new Set(); // elements whose inline style we rewrote

  // ---------- extension plumbing ----------

  const alive = () => {
    try {
      return !!chrome.runtime && !!chrome.runtime.id;
    } catch (e) {
      return false;
    }
  };

  function send(msg, cb) {
    if (!alive()) return;
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        void chrome.runtime.lastError;
        if (cb) cb(resp);
      });
    } catch (e) {
      /* extension reloaded */
    }
  }

  function loadSettings() {
    chrome.storage.local.get(['defaults', 'sites', 'detected'], (store) => {
      if (store.detected && store.detected[host]) pageBase = store.detected[host];
      settings = CCS.effectiveSettings(store, host);
      apply();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!isTop && changes.detected) {
      const next = (changes.detected.newValue || {})[host];
      if (next && next !== pageBase) {
        pageBase = next;
        if (applied === 'smart' && settings.mode === 'flip') refreshScheme();
      }
    }
    if (changes.defaults || changes.sites) loadSettings();
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!isTop || !msg) return undefined;
    if (msg.type === 'analyze') {
      try {
        sendResponse({ ok: true, report: analyze() });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    } else if (msg.type === 'ping') {
      sendResponse({ ok: true, host, applied, pageBase, scheme: scheme && { bg: scheme.bg, text: scheme.text, target: scheme.target } });
    }
    return undefined;
  });

  function reportStatus() {
    if (isTop) send({ type: 'status', enabled: !!applied });
  }

  // ---------- apply / teardown ----------

  function apply() {
    const want = !settings.enabled ? null : settings.mode === 'filter' ? 'filter' : 'smart';
    if (applied && applied !== want) teardown();
    if (want) {
      applied = want;
      ensureStyleEl();
      startWatching();
      if (want === 'filter') {
        setCss(CCS.filterCss(settings));
      } else {
        refreshScheme();
        if (settings.mode === 'flip' && isTop) scheduleDetection();
      }
    }
    reportStatus();
  }

  function refreshScheme() {
    scheme = CCS.buildScheme(settings, pageBase);
    schemeVersion++;
    rebuild(true);
  }

  function teardown() {
    stopWatching();
    restoreInlineStyles();
    if (styleEl) styleEl.remove();
    styleEl = null;
    sheetsCss = '';
    applied = null;
  }

  function ensureStyleEl() {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.setAttribute(OWN_ATTR, '');
      styleEl.media = 'all';
    }
    keepStyleLast();
  }

  /** Our <style> must stay the last child of <html> so overrides come after all page styles. */
  function keepStyleLast() {
    const root = document.documentElement;
    if (!styleEl || !root) return;
    if (root.lastElementChild !== styleEl) root.appendChild(styleEl);
  }

  function setCss(css) {
    if (styleEl && styleEl.textContent !== css) styleEl.textContent = css;
  }

  // ---------- smart mode ----------

  /** Legacy presentational attributes: bgcolor="", <font color="">, <body text="">. */
  function attributeCss() {
    const seen = new Set();
    let css = '';
    const q = (v) => `"${v.replace(/["\\]/g, '\\$&')}"`;
    const add = (sel, attr, prop, role) => {
      for (const el of document.querySelectorAll(sel)) {
        const v = el.getAttribute(attr);
        const key = `${sel}|${v}`;
        if (!v || seen.has(key)) continue;
        seen.add(key);
        const c = CCS.parseColor(v.startsWith('#') || !/^[0-9a-f]{6}$/i.test(v) ? v : `#${v}`);
        if (!c) continue;
        const tag = sel.replace(/\[.*$/, '');
        css += `:where(${tag}[${attr}=${q(v)}]){${prop}:${CCS.formatColor(CCS.transformColor(c, role, scheme))};}`;
      }
    };
    add('[bgcolor]', 'bgcolor', 'background-color', 'bg');
    add('font[color]', 'color', 'color', 'text');
    add('body[text]', 'text', 'color', 'text');
    return css;
  }

  function fetchedRules(href) {
    if (!href) return null;
    const entry = fetched.get(href);
    if (entry) return entry.state === 'done' ? entry.rules : null;
    fetched.set(href, { state: 'pending' });
    send({ type: 'fetchCss', url: href }, (resp) => {
      if (resp && resp.ok) {
        try {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(resp.text);
          fetched.set(href, { state: 'done', rules: sheet.cssRules });
          scheduleRebuild(true, 0);
          return;
        } catch (e) {
          /* unparsable */
        }
      }
      fetched.set(href, { state: 'error' });
    });
    return null;
  }

  const isOwn = (node) => !!(node && node.hasAttribute && node.hasAttribute(OWN_ATTR));

  function collectSheets() {
    const lists = [];
    for (const sheet of Array.from(document.styleSheets)) {
      if (isOwn(sheet.ownerNode) || sheet.disabled) continue;
      let rules = null;
      try {
        rules = sheet.cssRules;
      } catch (e) {
        rules = fetchedRules(sheet.href);
      }
      if (rules) lists.push({ rules, media: sheet.media && sheet.media.mediaText, href: sheet.href });
    }
    for (const sheet of document.adoptedStyleSheets || []) {
      try {
        lists.push({ rules: sheet.cssRules, media: sheet.media && sheet.media.mediaText, href: null });
      } catch (e) {
        /* ignore */
      }
    }
    return lists;
  }

  function signature() {
    let sig = `${document.styleSheets.length}:${fetched.size}`;
    for (const sheet of Array.from(document.styleSheets)) {
      if (isOwn(sheet.ownerNode)) continue;
      try {
        sig += `,${sheet.cssRules.length}`;
      } catch (e) {
        sig += ',x';
      }
    }
    for (const sheet of document.adoptedStyleSheets || []) sig += `,a${sheet.cssRules.length}`;
    return sig;
  }

  function rebuild(withSheets) {
    if (applied !== 'smart' || !scheme) return;
    if (withSheets || !ctx) {
      const built = CCS.buildOverrideCss(collectSheets(), scheme, {
        baseUrl: document.baseURI,
        onImport: (href, c) => {
          const rules = fetchedRules(href);
          return rules ? CCS.transformRules(rules, { ...c, baseUrl: href }) : '';
        },
      });
      ctx = built.ctx;
      sheetsCss = built.css;
      lastSignature = signature();
    }
    setCss(CCS.pageBaseCss(scheme, settings) + sheetsCss + attributeCss());
    keepStyleLast();
    document.querySelectorAll('[style]').forEach(processInline);
  }

  function scheduleRebuild(withSheets, delay = 80) {
    rebuildSheets = rebuildSheets || withSheets;
    if (rebuildTimer) return;
    rebuildTimer = setTimeout(() => {
      rebuildTimer = null;
      const s = rebuildSheets;
      rebuildSheets = false;
      rebuild(s);
    }, delay);
  }

  // ---------- inline styles ----------

  function processInline(el) {
    if (applied !== 'smart' || !ctx || isOwn(el)) return;
    const st = inlineState.get(el);
    const current = el.getAttribute('style') || '';
    if (st && current === st.written) {
      if (st.version === schemeVersion) return;
      el.setAttribute('style', st.original); // re-transform from the page's original value
    }
    const original = st && current === st.written ? st.original : current;
    const { entries } = CCS.transformDeclarations(el.style, { ...ctx, baseUrl: document.baseURI });
    if (!entries.length) {
      inlineState.delete(el);
      touched.delete(el);
      return;
    }
    for (const e of entries) el.style.setProperty(e.prop, e.value, e.priority);
    inlineState.set(el, { original, written: el.getAttribute('style') || '', version: schemeVersion });
    touched.add(el);
  }

  function restoreInlineStyles() {
    for (const el of touched) {
      const st = inlineState.get(el);
      if (st && el.getAttribute('style') === st.written) el.setAttribute('style', st.original);
      inlineState.delete(el);
    }
    touched.clear();
  }

  /** Runs fn with the page's original styles (our sheet off, inline styles restored). */
  function withOriginalStyles(fn) {
    const sheet = styleEl && styleEl.sheet;
    if (sheet) sheet.disabled = true;
    const swapped = [];
    for (const el of touched) {
      const st = inlineState.get(el);
      if (st && el.getAttribute('style') === st.written) {
        el.setAttribute('style', st.original);
        swapped.push([el, st.written]);
      }
    }
    try {
      return fn();
    } finally {
      for (const [el, written] of swapped) el.setAttribute('style', written);
      if (sheet) sheet.disabled = false;
    }
  }

  // ---------- watching the page ----------

  const STYLE_ATTRS = new Set(['media', 'disabled', 'href', 'rel']);
  const isStyleNode = (n) =>
    n.nodeType === 1 && !isOwn(n) && (n.nodeName === 'STYLE' || (n.nodeName === 'LINK' && /stylesheet/i.test(n.rel)));

  function onMutations(records) {
    if (!applied) return;
    let sheetsDirty = false;
    let attrsDirty = false;
    const inline = new Set();
    for (const r of records) {
      if (r.type === 'childList') {
        if (r.target === document.documentElement) keepStyleLast();
        for (const n of [...r.addedNodes, ...r.removedNodes]) {
          if (isStyleNode(n)) sheetsDirty = true;
        }
        if (applied === 'smart') {
          for (const n of r.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (n.hasAttribute('style')) inline.add(n);
            if (n.firstElementChild) n.querySelectorAll('[style]').forEach((el) => inline.add(el));
            if (n.matches('[bgcolor],font[color]') || (n.firstElementChild && n.querySelector('[bgcolor],font[color]'))) attrsDirty = true;
          }
        }
        if (r.target.nodeName === 'STYLE' && !isOwn(r.target)) sheetsDirty = true;
      } else if (r.type === 'characterData') {
        const p = r.target.parentNode;
        if (p && p.nodeName === 'STYLE' && !isOwn(p)) sheetsDirty = true;
      } else if (r.type === 'attributes') {
        const t = r.target;
        if (r.attributeName === 'style') inline.add(t);
        else if (STYLE_ATTRS.has(r.attributeName)) sheetsDirty = sheetsDirty || isStyleNode(t);
        else attrsDirty = true;
      }
    }
    if (applied !== 'smart') return;
    if (sheetsDirty || attrsDirty) scheduleRebuild(sheetsDirty);
    inline.forEach(processInline);
  }

  function onResourceLoad(e) {
    if (e.target && e.target.nodeName === 'LINK' && applied === 'smart') scheduleRebuild(true, 0);
  }

  function startWatching() {
    if (observer) return;
    observer = new MutationObserver(onMutations);
    observer.observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style', 'bgcolor', 'color', 'text', 'media', 'disabled', 'href', 'rel'],
    });
    document.addEventListener('load', onResourceLoad, true);
    // CSS-in-JS libraries use insertRule(), which no observer sees.
    pollTimer = setInterval(() => {
      if (applied === 'smart' && signature() !== lastSignature) scheduleRebuild(true, 0);
    }, POLL_MS);
    const onReady = () => applied === 'smart' && scheduleRebuild(true, 0);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once: true });
    window.addEventListener('load', onReady, { once: true });
  }

  function stopWatching() {
    if (observer) observer.disconnect();
    observer = null;
    clearInterval(pollTimer);
    clearTimeout(rebuildTimer);
    rebuildTimer = null;
    document.removeEventListener('load', onResourceLoad, true);
  }

  // ---------- page base detection (for "flip") ----------

  function opaqueBackground(el) {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const c = CCS.parseColor(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0.5) return c;
    }
    return null;
  }

  function detectBase() {
    const points = [[0.5, 0.5], [0.5, 0.2], [0.25, 0.75], [0.75, 0.75]];
    let dark = 0;
    let light = 0;
    for (const [x, y] of points) {
      const el = document.elementFromPoint(innerWidth * x, innerHeight * y);
      const c = (el && opaqueBackground(el)) || { r: 255, g: 255, b: 255, a: 1 };
      if (CCS.rgbToOklch(c).l < 0.5) dark++;
      else light++;
    }
    return dark > light ? 'dark' : 'light';
  }

  function scheduleDetection() {
    const run = () => {
      if (applied !== 'smart' || settings.mode !== 'flip' || !document.body) return;
      const base = withOriginalStyles(detectBase);
      if (base !== pageBase) {
        pageBase = base;
        refreshScheme();
      }
      chrome.storage.local.get('detected', ({ detected = {} }) => {
        if (detected[host] !== base) chrome.storage.local.set({ detected: { ...detected, [host]: base } });
      });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
    else run();
    if (document.readyState !== 'complete') window.addEventListener('load', () => setTimeout(run, 300), { once: true });
  }

  // ---------- analysis ----------

  function topColors(map, n) {
    const items = [...map.values()].sort((a, b) => b.weight - a.weight);
    const merged = [];
    for (const it of items) {
      const near = merged.find((m) => CCS.distance(m.color, it.color) < 0.03);
      if (near) near.weight += it.weight;
      else merged.push({ ...it });
    }
    const total = merged.reduce((s, m) => s + m.weight, 0) || 1;
    return merged.slice(0, n).map((m) => ({ hex: CCS.toHex(m.color), share: Math.round((m.weight / total) * 1000) / 10 }));
  }

  function addColor(map, color, weight) {
    if (!color || color.a <= 0.3 || weight <= 0) return;
    const key = CCS.toHex(color);
    const e = map.get(key);
    if (e) e.weight += weight;
    else map.set(key, { color: { ...color, a: 1 }, weight });
  }

  function analyze() {
    return withOriginalStyles(() => {
      const stats = { sheets: 0, crossOrigin: 0, crossOriginRead: 0, rules: 0, colorDecls: 0, customProps: 0, inlineStyled: 0 };
      const sheetColors = new Map();
      const bg = new Map();
      const text = new Map();
      const accents = new Map();

      const walk = (rules) => {
        for (const rule of Array.from(rules)) {
          stats.rules++;
          if (rule.style) {
            for (let i = 0; i < rule.style.length; i++) {
              const prop = rule.style[i];
              const role = CCS.roleForProperty(prop);
              if (!role) continue;
              if (role === 'var') stats.customProps++;
              const colors = CCS.findColors(rule.style.getPropertyValue(prop));
              if (colors.length) stats.colorDecls++;
              colors.forEach((c) => addColor(sheetColors, c, 1));
            }
          }
          try {
            if (rule.cssRules) walk(rule.cssRules);
          } catch (e) {
            /* ignore */
          }
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        if (isOwn(sheet.ownerNode)) continue;
        stats.sheets++;
        try {
          walk(sheet.cssRules);
        } catch (e) {
          stats.crossOrigin++;
          const rules = fetchedRules(sheet.href);
          if (rules) {
            stats.crossOriginRead++;
            walk(rules);
          }
        }
      }

      const els = document.body ? document.body.getElementsByTagName('*') : [];
      const limit = Math.min(els.length, 6000);
      for (let i = 0; i < limit; i++) {
        const el = els[i];
        if (el.hasAttribute('style')) stats.inlineStyled++;
        const rect = el.getBoundingClientRect();
        const area = rect.width * rect.height;
        if (!area) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden') continue;
        const b = CCS.parseColor(cs.backgroundColor);
        addColor(bg, b, Math.min(area, 400000));
        let chars = 0;
        for (const n of el.childNodes) if (n.nodeType === 3) chars += n.textContent.trim().length;
        const t = chars ? CCS.parseColor(cs.color) : null;
        addColor(text, t, chars);
        for (const [c, w] of [[b, Math.sqrt(area)], [t, chars * 4]]) {
          if (c && c.a > 0.3 && CCS.rgbToOklch(c).c > 0.07) addColor(accents, c, w);
        }
      }
      if (document.body) {
        const pageBg = opaqueBackground(document.body) || { r: 255, g: 255, b: 255, a: 1 };
        addColor(bg, pageBg, innerWidth * innerHeight);
      }
      sheetColors.forEach((v) => {
        if (CCS.rgbToOklch(v.color).c > 0.07) addColor(accents, v.color, v.weight * 20);
      });

      return {
        host,
        url: location.href,
        base: document.body ? detectBase() : pageBase,
        stats,
        background: topColors(bg, 6),
        text: topColors(text, 6),
        accents: topColors(accents, 8),
        sheetColors: topColors(sheetColors, 12),
      };
    });
  }

  loadSettings();
})();
