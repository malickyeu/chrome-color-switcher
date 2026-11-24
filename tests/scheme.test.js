const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/color.js');
const S = require('../src/scheme.js');
const { normalizeSettings } = require('../src/settings.js');

const scheme = (patch, base) => S.buildScheme(normalizeSettings({ ...patch }), base);
const tx = (hex, role, sc) => S.transformColor(C.parseColor(hex), role, sc);
const L = (c) => C.rgbToOklch(c).l;

test('flip mode targets the opposite of the page base', () => {
  assert.equal(scheme({ mode: 'flip' }, 'light').target, 'dark');
  assert.equal(scheme({ mode: 'flip' }, 'dark').target, 'light');
  assert.equal(scheme({ mode: 'dark' }, 'dark').target, 'dark');
});

test('dark: white background turns dark, black text turns light, readable', () => {
  const sc = scheme({ mode: 'dark' });
  const bg = tx('#ffffff', 'bg', sc);
  const fg = tx('#000000', 'text', sc);
  assert.ok(L(bg) < 0.3);
  assert.ok(L(fg) > 0.8);
  assert.ok(C.contrastRatio(bg, fg) >= 7);
});

test('dark: slightly gray cards stay distinguishable from the page', () => {
  const sc = scheme({ mode: 'dark' });
  assert.ok(L(tx('#f0f0f0', 'bg', sc)) > L(tx('#ffffff', 'bg', sc)));
});

test('dark: colors that already fit stay dark / light', () => {
  const sc = scheme({ mode: 'dark' });
  assert.ok(L(tx('#222222', 'bg', sc)) < 0.35);
  assert.ok(L(tx('#ffffff', 'text', sc)) > 0.9);
});

test('light target mirrors the dark mapping', () => {
  const sc = scheme({ mode: 'light' });
  const bg = tx('#111111', 'bg', sc);
  const fg = tx('#eeeeee', 'text', sc);
  assert.ok(L(bg) > 0.85);
  assert.ok(L(fg) < 0.4);
  assert.ok(C.contrastRatio(bg, fg) >= 7);
});

test('alpha is preserved and fully transparent colors are untouched', () => {
  const sc = scheme({ mode: 'dark' });
  assert.equal(tx('rgba(255,255,255,.4)', 'bg', sc).a, 0.4);
  assert.deepEqual(tx('transparent', 'bg', sc), { r: 0, g: 0, b: 0, a: 0 });
});

test('mono maps every color to the chosen hue', () => {
  const sc = scheme({ mode: 'mono', monoColor: '#00aa00' });
  const hue = C.rgbToOklch(C.parseColor('#00aa00')).h;
  for (const hex of ['#ff0000', '#0000ff', '#ffffff']) {
    const o = C.rgbToOklch(tx(hex, 'bg', sc));
    assert.ok(Math.abs(o.h - hue) < 3, `${hex} hue ${o.h} vs ${hue}`);
  }
});

test('gray removes all chroma', () => {
  const sc = scheme({ mode: 'gray', monoTarget: 'light' });
  assert.ok(C.rgbToOklch(tx('#ff0000', 'text', sc)).c < 0.002);
  assert.equal(sc.target, 'light');
});

test('custom scheme uses the user colors', () => {
  const sc = scheme({ mode: 'custom', custom: { bg: '#102030', text: '#f0e0d0', accent: '#ff8800' } });
  assert.equal(sc.target, 'dark');
  assert.equal(C.toHex(tx('#ffffff', 'bg', sc)), '#102030');
  const accentHue = C.rgbToOklch(C.parseColor('#ff8800')).h;
  assert.ok(Math.abs(C.rgbToOklch(tx('#0000ff', 'text', sc)).h - accentHue) < 3);
});

test('contrast and brightness shift the result', () => {
  const base = L(tx('#ffffff', 'bg', scheme({ mode: 'dark' })));
  assert.ok(L(tx('#ffffff', 'bg', scheme({ mode: 'dark', brightness: 0.1 }))) > base);
  assert.ok(L(tx('#ffffff', 'bg', scheme({ mode: 'dark', contrast: 1.4 }))) < base);
});

test('auto role treats light colors as background when going dark', () => {
  const sc = scheme({ mode: 'dark' });
  assert.ok(L(tx('#fafafa', 'auto', sc)) < 0.3);
  assert.ok(L(tx('#202020', 'auto', sc)) > 0.7);
});

test('dark: typical dark-gray body text ends up close to the target text color', () => {
  const sc = scheme({ mode: 'dark' });
  for (const hex of ['#000000', '#222222', '#333333']) assert.ok(L(tx(hex, 'text', sc)) > 0.8, hex);
  assert.ok(L(tx('#222222', 'text', sc)) > L(tx('#777777', 'text', sc)), 'keeps the order of text emphasis');
});
