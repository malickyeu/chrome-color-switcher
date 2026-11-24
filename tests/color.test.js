const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/color.js');

test('parses hex in all lengths', () => {
  assert.deepEqual(C.parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(C.parseColor('#00ff0080'), { r: 0, g: 255, b: 0, a: 128 / 255 });
  assert.deepEqual(C.parseColor('#1234'), { r: 0x11, g: 0x22, b: 0x33, a: 0x44 / 255 });
  assert.equal(C.parseColor('#12345'), null);
  assert.equal(C.parseColor('#ggg'), null);
});

test('parses rgb()/rgba() in legacy and modern syntax', () => {
  assert.deepEqual(C.parseColor('rgb(10, 20, 30)'), { r: 10, g: 20, b: 30, a: 1 });
  assert.deepEqual(C.parseColor('rgba(10,20,30,.5)'), { r: 10, g: 20, b: 30, a: 0.5 });
  assert.deepEqual(C.parseColor('rgb(10 20 30 / 25%)'), { r: 10, g: 20, b: 30, a: 0.25 });
  assert.deepEqual(C.parseColor('rgb(100%, 0%, 0%)'), { r: 255, g: 0, b: 0, a: 1 });
  assert.equal(C.parseColor('rgb(var(--x))'), null);
  assert.equal(C.parseColor('rgb(1, 2)'), null);
});

test('parses hsl() and named colors', () => {
  const red = C.parseColor('hsl(0, 100%, 50%)');
  assert.equal(C.toHex(red), '#ff0000');
  assert.equal(C.toHex(C.parseColor('hsl(0.5turn 100% 50%)')), '#00ffff');
  assert.equal(C.toHex(C.parseColor('RebeccaPurple')), '#663399');
  assert.deepEqual(C.parseColor('transparent'), { r: 0, g: 0, b: 0, a: 0 });
  assert.equal(C.parseColor('notacolor'), null);
});

test('formats opaque as hex and translucent as rgba', () => {
  assert.equal(C.formatColor({ r: 255, g: 128.4, b: 0, a: 1 }), '#ff8000');
  assert.equal(C.formatColor({ r: 0, g: 0, b: 0, a: 0.12345 }), 'rgba(0, 0, 0, 0.123)');
});

test('OKLCH round-trips sRGB colors', () => {
  for (const hex of ['#000000', '#ffffff', '#ff0000', '#3366cc', '#7f7f7f', '#f4ecd8']) {
    const back = C.toHex(C.oklchToRgb(C.rgbToOklch(C.parseColor(hex))));
    assert.equal(back, hex);
  }
  const white = C.rgbToOklch(C.parseColor('#fff'));
  assert.ok(Math.abs(white.l - 1) < 1e-3 && white.c < 1e-3);
});

test('out-of-gamut OKLCH is mapped into sRGB by reducing chroma', () => {
  const rgb = C.oklchToRgb({ l: 0.9, c: 0.4, h: 260, a: 1 });
  for (const ch of [rgb.r, rgb.g, rgb.b]) assert.ok(ch >= 0 && ch <= 255);
  assert.ok(Math.abs(C.rgbToOklch(rgb).l - 0.9) < 0.01);
});

test('contrast ratio matches WCAG reference values', () => {
  const ratio = C.contrastRatio(C.parseColor('#000'), C.parseColor('#fff'));
  assert.ok(Math.abs(ratio - 21) < 0.01);
});
