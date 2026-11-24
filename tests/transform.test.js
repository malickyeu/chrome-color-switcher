const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/color.js');
const { buildScheme } = require('../src/scheme.js');
const { normalizeSettings } = require('../src/settings.js');
const T = require('../src/transform.js');

const scheme = buildScheme(normalizeSettings({ mode: 'dark' }));
const L = (css) => C.rgbToOklch(C.parseColor(css)).l;

/** Minimal CSSStyleDeclaration mock: [[prop, value, priority?], ...] plus optional shorthands. */
function style(decls, shorthands = {}) {
  const s = { length: decls.length };
  decls.forEach(([p], i) => { s[i] = p; });
  s.getPropertyValue = (p) => {
    const d = decls.find(([q]) => q === p);
    return d ? d[1] : shorthands[p] || '';
  };
  s.getPropertyPriority = (p) => {
    const d = decls.find(([q]) => q === p);
    return d && d[2] ? d[2] : '';
  };
  return s;
}
const rule = (selectorText, decls, extra = {}) => ({ selectorText, style: style(decls, extra.shorthands), ...extra });
const ctx = (rules = [], over = {}) => ({ scheme, varRole: T.createVarRoleResolver([rules]), baseUrl: 'https://cdn.example.com/css/site.css', ...over });

test('roleForProperty classifies color-bearing properties', () => {
  assert.equal(T.roleForProperty('color'), 'text');
  assert.equal(T.roleForProperty('background-color'), 'bg');
  assert.equal(T.roleForProperty('background-image'), 'bg');
  assert.equal(T.roleForProperty('border-top-color'), 'border');
  assert.equal(T.roleForProperty('box-shadow'), 'shadow');
  assert.equal(T.roleForProperty('--main-bg'), 'var');
  assert.equal(T.roleForProperty('width'), null);
});

test('transformValue rewrites colors inside gradients and keeps other tokens', () => {
  const out = T.transformValue('linear-gradient(to right, #fff 0%, rgba(255, 255, 255, 0.5) 100%)', 'bg', scheme);
  assert.match(out, /^linear-gradient\(to right, #[0-9a-f]{6} 0%, rgba\(\d+, \d+, \d+, 0\.5\) 100%\)$/);
  assert.ok(L(out.match(/#[0-9a-f]{6}/)[0]) < 0.3);
});

test('transformValue leaves urls, strings, variables and keywords alone', () => {
  const v = 'url("img/white.png") no-repeat, var(--white-bg, white) solid transparent currentColor "red"';
  const out = T.transformValue(v, 'bg', scheme);
  assert.ok(out.startsWith('url("img/white.png") no-repeat, var(--white-bg, #'));
  assert.ok(out.endsWith(') solid transparent currentColor "red"'));
});

test('custom property RGB triplets are transformed in place', () => {
  const out = T.transformCustomProperty(' 255, 255, 255', 'bg', scheme);
  const [r, g, b] = out.split(',').map(Number);
  assert.ok(L(`rgb(${r},${g},${b})`) < 0.3);
  assert.match(out, /^ \d+, \d+, \d+$/);
});

test('findColors lists literals and absolutizeUrls resolves relative urls', () => {
  assert.equal(T.findColors('1px solid #000, 0 0 2px rgba(0,0,0,.2) white transparent').length, 3);
  assert.equal(
    T.absolutizeUrls('url(../img/a.png) #fff, url("data:image/png;base64,xx")', 'https://cdn.example.com/css/site.css'),
    'url("https://cdn.example.com/img/a.png") #fff, url("data:image/png;base64,xx")',
  );
});

test('transformRules emits only color declarations with same selector and priority', () => {
  const rules = [
    rule('body', [['margin', '0'], ['background-color', '#ffffff'], ['color', '#111', 'important']]),
    rule('.plain', [['width', '10px']]),
  ];
  const css = T.transformRules(rules, ctx(rules));
  assert.match(css, /^body\{background-color:#[0-9a-f]{6};color:#[0-9a-f]{6} !important;\}$/);
  assert.ok(!css.includes('.plain'));
  assert.ok(!css.includes('margin'));
});

test('transformRules keeps @media wrappers and rewrites @keyframes in full', () => {
  const media = { cssText: '@media (min-width: 600px) { .a { color: black; } }', cssRules: [rule('.a', [['color', 'black']])] };
  const keyframes = {
    cssText: '@keyframes pulse { 0% { opacity: 0; background: #fff; } }',
    cssRules: [{ keyText: '0%', style: style([['opacity', '0'], ['background-color', '#fff']]) }],
  };
  const css = T.transformRules([media, keyframes], ctx());
  assert.match(css, /^@media \(min-width: 600px\)\{\.a\{color:#[0-9a-f]{6};\}\}/);
  assert.match(css, /@keyframes pulse\{0%\{opacity:0;background-color:#[0-9a-f]{6};\}\}$/);
});

test('transformRules resolves relative urls against the source stylesheet', () => {
  const rules = [rule('.hero', [['background-image', 'url(bg.png), linear-gradient(#fff, #eee)']])];
  const css = T.transformRules(rules, ctx(rules));
  assert.ok(css.includes('url("https://cdn.example.com/css/bg.png")'));
});

test('shorthands containing var() are rewritten as a whole', () => {
  const rules = [rule('.card', [], { shorthands: { background: 'var(--x) #fff' } })];
  const css = T.transformRules(rules, ctx(rules));
  assert.match(css, /^\.card\{background:var\(--x\) #[0-9a-f]{6};\}$/);
});

test('custom properties get the role of their usage', () => {
  const rules = [
    rule(':root', [['--brand', '#ffffff'], ['--ink', '#ffffff'], ['--alias', 'var(--deep)'], ['--deep', '#000000']]),
    rule('.btn', [['background-color', 'var(--brand)'], ['color', 'var(--ink)']]),
    rule('.x', [['color', 'var(--alias)']]),
  ];
  const resolve = T.createVarRoleResolver([rules]);
  assert.equal(resolve('--brand'), 'bg');
  assert.equal(resolve('--ink'), 'text');
  assert.equal(resolve('--deep'), 'text', 'role propagates through var aliases');
  assert.equal(resolve('--sidebar-bg'), 'bg', 'name hint');
  assert.equal(resolve('--mystery'), 'auto');

  const css = T.transformRules(rules, ctx(rules));
  const brand = css.match(/--brand:(#[0-9a-f]{6})/)[1];
  assert.ok(L(brand) < 0.3, 'white used as background becomes dark');
  assert.ok(!css.includes('--ink'), 'white used as text already fits and is not overridden');
});

test('broken rules do not abort the whole sheet', () => {
  const bad = { get selectorText() { throw new Error('boom'); } };
  const css = T.transformRules([bad, rule('p', [['color', '#000']])], ctx());
  assert.match(css, /^p\{color:#[0-9a-f]{6};\}$/);
});
