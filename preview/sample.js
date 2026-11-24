/**
 * Runs inside the preview iframe: receives settings from the preview page and applies them
 * to this sample page with the same code the content script uses.
 */
(() => {
  'use strict';
  const CCS = globalThis.CCS;
  const ORIG = 'data-ccs-orig';

  function restoreInline() {
    document.querySelectorAll(`[${ORIG}]`).forEach((el) => {
      el.setAttribute('style', el.getAttribute(ORIG));
      el.removeAttribute(ORIG);
    });
  }

  function apply(settings, theme) {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.querySelectorAll('style[data-ccs]').forEach((el) => el.remove());
    restoreInline();
    if (!settings) return;

    let css;
    if (settings.mode === 'filter') {
      css = CCS.filterCss(settings);
    } else {
      const scheme = CCS.buildScheme(settings, theme);
      const lists = Array.from(document.styleSheets).map((s) => ({ rules: s.cssRules, media: s.media.mediaText, href: s.href }));
      const { css: overrides, ctx } = CCS.buildOverrideCss(lists, scheme, { baseUrl: document.baseURI });
      css = CCS.pageBaseCss(scheme, settings) + overrides;
      document.querySelectorAll('[style]').forEach((el) => {
        const { entries } = CCS.transformDeclarations(el.style, ctx);
        if (!entries.length) return;
        el.setAttribute(ORIG, el.getAttribute('style'));
        entries.forEach((e) => el.style.setProperty(e.prop, e.value, e.priority));
      });
    }
    const style = document.createElement('style');
    style.setAttribute('data-ccs', '');
    style.textContent = css;
    document.documentElement.appendChild(style);
  }

  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'ccs-preview') return;
    apply(e.data.settings, e.data.theme);
  });
  document.addEventListener('click', (e) => e.target.closest('a, button') && e.preventDefault());
  parent.postMessage({ type: 'ccs-preview-ready' }, location.origin);
})();
