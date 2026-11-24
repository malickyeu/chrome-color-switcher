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

test('matchSite picks the longest whole-segment path prefix', () => {
  const sites = { 'tw.cz': {}, 'tw.cz/chat': {}, 'tw.cz/chat/admin/': {}, 'other.cz/chat': {} };
  assert.equal(S.matchSite(sites, 'tw.cz/'), 'tw.cz');
  assert.equal(S.matchSite(sites, 'tw.cz/projects/1'), 'tw.cz');
  assert.equal(S.matchSite(sites, 'tw.cz/chat'), 'tw.cz/chat');
  assert.equal(S.matchSite(sites, 'tw.cz/chat/'), 'tw.cz/chat');
  assert.equal(S.matchSite(sites, 'tw.cz/chat/room/5'), 'tw.cz/chat');
  assert.equal(S.matchSite(sites, 'tw.cz/chatroom'), 'tw.cz');
  assert.equal(S.matchSite(sites, 'tw.cz/chat/admin/users'), 'tw.cz/chat/admin/');
  assert.equal(S.matchSite(sites, 'x.cz/chat'), null);
  assert.equal(S.matchSite({ 'other.cz/chat': {} }, 'other.cz/'), null);
});

test('effectiveSettings applies a path scope only under its prefix', () => {
  const store = { defaults: { mode: 'dark' }, sites: { 'tw.cz/chat': { enabled: true, mode: 'flip' } } };
  assert.equal(S.effectiveSettings(store, 'tw.cz/chat/').enabled, true);
  assert.equal(S.effectiveSettings(store, 'tw.cz/chat/').mode, 'flip');
  assert.equal(S.effectiveSettings(store, 'tw.cz/').enabled, false);
  assert.equal(S.effectiveSettings(store, 'tw.cz/').mode, 'dark');
  assert.equal(S.effectiveSettings(store, 'tw.cz').mode, 'dark');
});

test('scopesFor offers the host and leading path segments', () => {
  assert.deepEqual(S.scopesFor('tw.cz/chat/'), ['tw.cz', 'tw.cz/chat']);
  assert.deepEqual(S.scopesFor('tw.cz/a/b/c'), ['tw.cz', 'tw.cz/a', 'tw.cz/a/b']);
  assert.deepEqual(S.scopesFor('tw.cz/'), ['tw.cz']);
  assert.deepEqual(S.scopesFor('file://'), ['file://']);
});

test('locationKey keeps host and path of supported pages', () => {
  assert.equal(S.locationKey('https://tw.cz/chat/?x=1#y'), 'tw.cz/chat/');
  assert.equal(S.locationKey('file:///home/a.html'), 'file://');
  assert.equal(S.locationKey('chrome://extensions'), null);
  assert.equal(S.locationKey('nonsense'), null);
});

test('sites share the scheme from defaults and only store enabled', () => {
  let store = { defaults: { mode: 'dark' }, sites: {} };
  store = S.writeSettings(store, 'a.cz', { ...S.effectiveSettings(store, 'a.cz'), enabled: true });
  store = S.writeSettings(store, 'b.cz', { ...S.effectiveSettings(store, 'b.cz'), enabled: true, mode: 'sepia' });
  assert.deepEqual(store.sites, { 'a.cz': { enabled: true }, 'b.cz': { enabled: true } });
  assert.equal(store.defaults.mode, 'sepia');
  assert.equal(S.effectiveSettings(store, 'a.cz/x').mode, 'sepia', 'scheme change on b.cz reaches a.cz');
  assert.equal(S.effectiveSettings(store, 'a.cz/x').enabled, true);
  assert.equal(S.effectiveSettings(store, 'c.cz/').enabled, false);
});

test('own scheme stays on its scope and edits go to it', () => {
  let store = { defaults: { mode: 'dark' }, sites: { 'tw.cz': { enabled: true } } };
  store = S.setOwnScheme(store, 'tw.cz', true);
  assert.equal(S.schemeSource(store.sites, 'tw.cz/chat/1'), 'tw.cz');
  store = S.writeSettings(store, 'tw.cz/chat', { ...S.effectiveSettings(store, 'tw.cz/chat'), mode: 'mono' });
  assert.equal(store.sites['tw.cz'].mode, 'mono', 'edit lands in the scheme the scope inherits');
  assert.deepEqual(store.sites['tw.cz/chat'], { enabled: true });
  assert.equal(store.defaults.mode, 'dark', 'shared scheme untouched');
  store = S.setOwnScheme(store, 'tw.cz', false);
  assert.deepEqual(store.sites['tw.cz'], { enabled: true });
  assert.equal(S.effectiveSettings(store, 'tw.cz').mode, 'dark');
});

test('path entries layer over the host entry', () => {
  const store = { defaults: { mode: 'dark' }, sites: { 'tw.cz': { enabled: false, mode: 'gray' }, 'tw.cz/chat': { enabled: true } } };
  const chat = S.effectiveSettings(store, 'tw.cz/chat/conversations/42545');
  assert.equal(chat.enabled, true);
  assert.equal(chat.mode, 'gray', 'inherits the host scheme');
  assert.equal(S.effectiveSettings(store, 'tw.cz/projects').enabled, false);
});

test('migrateSites keeps only enabled from 0.3 full copies', () => {
  const old = { 'a.cz': { enabled: true, mode: 'gray', contrast: 1.2, custom: { bg: '#000000' } }, 'b.cz': { mode: 'dark' } };
  assert.deepEqual(S.migrateSites(old), { 'a.cz': { enabled: true }, 'b.cz': {} });
});
