const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/settings.js');

test('normalizeSettings fills defaults and rejects invalid values', () => {
  const s = S.normalizeSettings({ mode: 'nope', contrast: 9, monoColor: 'red', custom: { bg: '#ABCDEF' } });
  assert.equal(s.mode, 'flip');
  assert.equal(s.contrast, 1.5);
  assert.equal(s.monoColor, S.DEFAULTS.monoColor);
  assert.equal(s.custom.bg, '#abcdef');
  assert.equal(s.custom.text, S.DEFAULTS.custom.text);
  assert.equal(s.enabled, false);
});

test('effectiveSettings prefers the site entry over defaults', () => {
  const store = { defaults: { enabled: true, mode: 'dark' }, sites: { 'a.cz': { enabled: false, mode: 'mono' } } };
  assert.equal(S.effectiveSettings(store, 'a.cz').mode, 'mono');
  assert.equal(S.effectiveSettings(store, 'b.cz').mode, 'dark');
  assert.equal(S.effectiveSettings({}, 'b.cz').enabled, false);
});

test('hostFromUrl only accepts pages the extension can run on', () => {
  assert.equal(S.hostFromUrl('https://www.example.com/a?b'), 'www.example.com');
  assert.equal(S.hostFromUrl('file:///home/x.html'), 'file://');
  assert.equal(S.hostFromUrl('chrome://extensions'), null);
  assert.equal(S.hostFromUrl('garbage'), null);
});

test('topHost uses the top-level origin inside iframes', () => {
  const frame = { href: 'https://ads.example.net/x', ancestorOrigins: ['https://mid.cz', 'https://top.cz'] };
  assert.equal(S.topHost(frame), 'top.cz');
  assert.equal(S.topHost({ href: 'https://solo.cz/', ancestorOrigins: [] }), 'solo.cz');
});
