/**
 * End-to-end test: loads the unpacked extension into Chromium, drives it over CDP and checks
 * the computed colors of a fixture page. No dependencies (Node >= 22 for the global WebSocket).
 *
 *   CHROME_PATH=/path/to/chromium node e2e/run.js [--screenshots <dir>]
 *
 * Without CHROME_PATH the Playwright Chromium from ~/.cache/ms-playwright is used.
 * Branded Google Chrome ignores --load-extension, so it has to be Chromium / Chrome for Testing.
 */
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const C = require('../src/color.js');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');
const shotsArg = process.argv.indexOf('--screenshots');
const SHOTS = shotsArg > 0 ? path.resolve(process.argv[shotsArg + 1]) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = path.join(os.homedir(), '.cache', 'ms-playwright');
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) {
    const bin = path.join(base, d, 'chrome-linux64', 'chrome');
    if (fs.existsSync(bin)) return bin;
  }
  throw new Error('Chromium not found, set CHROME_PATH');
}

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${msg.error.message} (${p.method})`));
      else p.resolve(msg.result);
    };
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }
  async eval(sessionId, expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
}

async function main() {
  const crossServer = await serve((req, res) => {
    res.writeHead(200, { 'content-type': 'text/css' });
    res.end(fs.readFileSync(path.join(FIXTURES, 'cross.css')));
  });
  const crossPort = crossServer.address().port;
  const siteServer = await serve((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(FIXTURES, 'site.html'), 'utf8').replace('PORT2', crossPort));
  });
  const siteUrl = `http://127.0.0.1:${siteServer.address().port}/`;

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-e2e-'));
  const chrome = spawn(findChromium(), [
    '--headless=new',
    // Test-only: Playwright's Chromium has no usable sandbox on Ubuntu 23.10+ (AppArmor userns); only local fixtures load.
    '--no-sandbox',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${ROOT}`,
    `--load-extension=${ROOT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=900,700',
    'about:blank',
  ], { stdio: 'ignore' });

  const cleanup = () => {
    chrome.kill();
    siteServer.close();
    crossServer.close();
    fs.rmSync(profile, { recursive: true, force: true });
  };

  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
    const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
    const cdp = new Cdp(`ws://127.0.0.1:${port}${wsPath}`);
    await cdp.open();

    let sw = null;
    for (let i = 0; i < 50 && !sw; i++) {
      const { targetInfos } = await cdp.send('Target.getTargets');
      sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://') && t.url.endsWith('/src/background.js'));
      if (!sw) await sleep(100);
    }
    assert.ok(sw, 'extension service worker is running');
    const swSession = (await cdp.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true })).sessionId;
    const setSite = (settings) =>
      cdp.eval(swSession, `chrome.storage.local.set({ sites: { '127.0.0.1': ${JSON.stringify(settings)} } })`);

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const page = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
    await cdp.send('Page.enable', {}, page);
    const load = async () => {
      await cdp.send('Page.navigate', { url: siteUrl }, page);
      await sleep(1500);
    };
    const css = (sel, prop) => cdp.eval(page, `getComputedStyle(document.querySelector(${JSON.stringify(sel)})).${prop}`);
    const L = async (sel, prop) => C.rgbToOklch(C.parseColor(await css(sel, prop))).l;
    const shot = async (name, session = page) => {
      if (!SHOTS) return;
      fs.mkdirSync(SHOTS, { recursive: true });
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, session);
      fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
    };
    const results = [];
    const check = async (name, fn) => {
      try {
        await fn();
        results.push(['ok', name]);
      } catch (e) {
        results.push(['FAIL', `${name}: ${e.message}`]);
      }
    };

    await load();
    await shot('0-original');
    await check('disabled by default: page untouched', async () => {
      assert.ok((await L('body', 'backgroundColor')) > 0.95);
      assert.equal(await cdp.eval(page, 'document.querySelectorAll("style[data-ccs]").length'), 0);
    });

    await setSite({ enabled: true, mode: 'flip' });
    await load();
    await shot('1-flip-dark');
    await check('flip: light page turns dark', async () => {
      assert.ok((await L('body', 'backgroundColor')) < 0.3, 'body background');
      assert.ok((await L('#title', 'color')) > 0.8, 'heading text');
      assert.ok((await L('header', 'backgroundColor')) < 0.4, 'header background');
    });
    await check('flip: CSS variables, rgb triplets and media queries', async () => {
      assert.ok((await L('#mq', 'color')) > 0.7, 'media query text');
      assert.ok((await L('#card', 'backgroundColor')) < 0.3, 'card');
      const tint = C.parseColor(await css('#tint', 'backgroundColor'));
      assert.ok(tint && tint.a > 0 && tint.a < 0.2, 'tint keeps its alpha');
    });
    await check('flip: cross-origin stylesheet is rewritten', async () => {
      assert.ok((await L('#cross', 'color')) > 0.7, 'cross text');
      assert.ok((await L('#cross', 'backgroundColor')) < 0.4, 'cross background');
    });
    await check('flip: inline styles, bgcolor and default links', async () => {
      assert.ok((await L('#inline', 'color')) > 0.7, 'inline text');
      assert.ok((await L('#inline', 'backgroundColor')) < 0.3, 'inline background');
      assert.ok((await L('#legacy', 'backgroundColor')) < 0.4, 'bgcolor');
      assert.ok((await L('#link', 'color')) > 0.6, 'unstyled link');
    });

    await check('analysis reports a light page and its palette', async () => {
      const resp = await cdp.eval(swSession, `chrome.tabs.query({}).then((tabs) => {
        const t = tabs.find((x) => x.url && x.url.startsWith(${JSON.stringify(siteUrl)}));
        return chrome.tabs.sendMessage(t.id, { type: 'analyze' }, { frameId: 0 });
      })`);
      assert.ok(resp && resp.ok, JSON.stringify(resp));
      assert.equal(resp.report.base, 'light');
      assert.ok(resp.report.background.length > 0 && resp.report.accents.length > 0);
      assert.equal(resp.report.stats.crossOrigin, 1);
      assert.equal(resp.report.stats.crossOriginRead, 1);
    });

    await setSite({ enabled: true, mode: 'mono', monoColor: '#00aa44', monoTarget: 'dark' });
    await sleep(600);
    await shot('2-mono');
    await check('mono applies live without reload', async () => {
      const btn = C.rgbToOklch(C.parseColor(await css('#btn', 'backgroundColor')));
      const hue = C.rgbToOklch(C.parseColor('#00aa44')).h;
      assert.ok(Math.abs(btn.h - hue) < 5, `button hue ${btn.h} vs ${hue}`);
    });

    await setSite({ enabled: true, mode: 'filter' });
    await sleep(600);
    await shot('3-filter');
    await check('filter mode inverts the page', async () => {
      assert.match(await css('html', 'filter'), /invert\(1\)/);
      assert.equal(await cdp.eval(page, 'document.querySelectorAll("style[data-ccs]").length'), 1);
      assert.equal(await cdp.eval(page, 'document.getElementById("inline").getAttribute("style")'), 'color: #000; background-color: #fafafa');
    });

    await check('preview page renders the scheme next to the original', async () => {
      const extId = new URL(sw.url).host;
      const tabs = await cdp.eval(swSession, `chrome.tabs.query({}).then((t) => t.map((x) => ({ id: x.id, url: x.url })))`);
      const siteTab = tabs.find((t) => t.url && t.url.startsWith(siteUrl));
      const prevTarget = await cdp.send('Target.createTarget', {
        url: `chrome-extension://${extId}/preview/preview.html?tab=${siteTab.id}&host=127.0.0.1`,
      });
      const pv = (await cdp.send('Target.attachToTarget', { targetId: prevTarget.targetId, flatten: true })).sessionId;
      await sleep(1500);
      const frameBg = (id) => cdp.eval(pv, `getComputedStyle(document.getElementById('${id}').contentDocument.body).backgroundColor`);
      const lum = async (id) => C.rgbToOklch(C.parseColor(await frameBg(id))).l;
      // site is in filter mode now; the preview of "filter" inverts with a CSS filter, so switch to dark
      await cdp.eval(pv, `document.querySelector('#modes [data-mode="dark"]').click()`);
      await sleep(500);
      assert.ok((await lum('orig')) > 0.95, 'original stays light');
      assert.ok((await lum('prev')) < 0.3, 'preview is dark');
      assert.equal(await cdp.eval(pv, `document.querySelectorAll('#siteBg .pair').length > 0`), true, 'site palette loaded');
      const saved = await cdp.eval(swSession, `chrome.storage.local.get('sites').then((s) => s.sites['127.0.0.1'].mode)`);
      assert.equal(saved, 'dark', 'preview saves the site settings');
      await cdp.eval(pv, `document.querySelector('#theme [data-value="dark"]').click(); document.querySelector('#modes [data-mode="flip"]').click()`);
      await sleep(500);
      assert.ok((await lum('orig')) < 0.2, 'dark sample original');
      assert.ok((await lum('prev')) > 0.85, 'flip turns the dark sample light');
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false }, pv);
      await sleep(300);
      await shot('4-preview', pv);
      await cdp.send('Target.closeTarget', { targetId: prevTarget.targetId });
    });

    const siteTabId = () => cdp.eval(swSession, `chrome.tabs.query({}).then((tabs) => tabs.find((x) => x.url && x.url.startsWith(${JSON.stringify(siteUrl)})).id)`);
    const styleCount = () => cdp.eval(page, 'document.querySelectorAll("style[data-ccs]").length');

    await cdp.eval(swSession, `chrome.storage.local.set({ sites: { '127.0.0.1/chat': { enabled: true, mode: 'dark' } } })`);
    await cdp.send('Page.navigate', { url: `${siteUrl}chat/` }, page);
    await sleep(1500);
    await check('path scope applies only under its prefix, also on SPA navigation', async () => {
      assert.ok((await L('body', 'backgroundColor')) < 0.3, '/chat/ is dark');
      await cdp.eval(page, `history.pushState(null, '', '/')`);
      await sleep(700);
      assert.ok((await L('body', 'backgroundColor')) > 0.95, '/ stays light after pushState');
      assert.equal(await styleCount(), 0);
      await cdp.eval(page, `history.pushState(null, '', '/chatroom')`);
      await sleep(700);
      assert.ok((await L('body', 'backgroundColor')) > 0.95, '/chatroom is not under /chat');
      await cdp.eval(page, `history.pushState(null, '', '/chat/room/1')`);
      await sleep(700);
      assert.ok((await L('body', 'backgroundColor')) < 0.3, '/chat/room/1 is dark again');
    });

    await cdp.eval(swSession, `chrome.storage.local.set({ sites: { '127.0.0.1': { enabled: false, mode: 'gray' }, '127.0.0.1/chat': { enabled: true, mode: 'flip' } } })`);
    await cdp.send('Page.navigate', { url: `${siteUrl}chat/conversations/42545` }, page);
    await sleep(1500);
    await check('path scope applies on direct load of a deep URL in flip mode', async () => {
      assert.ok((await L('body', 'backgroundColor')) < 0.3, 'deep /chat URL is dark');
      const detected = await cdp.eval(swSession, `chrome.storage.local.get('detected').then((s) => s.detected)`);
      assert.equal(detected['127.0.0.1/chat'], 'light', 'base stored under the scope');
    });
    await cdp.eval(swSession, `chrome.storage.local.set({ sites: { '127.0.0.1/chat': { enabled: true, mode: 'dark' } } })`);
    await sleep(600);

    await check('content script can be injected again and takes over', async () => {
      const id = await siteTabId();
      const resp = await cdp.eval(swSession, `ensureContent(${id})`);
      assert.deepEqual(resp, { ok: true, injected: false }, 'live script answers ping');
      await cdp.eval(swSession, `chrome.scripting.executeScript({ target: { tabId: ${id}, allFrames: true }, files: CONTENT_FILES }).then(() => true)`);
      await sleep(800);
      assert.equal(await styleCount(), 1, 'one override style');
      assert.ok((await L('body', 'backgroundColor')) < 0.3, 'still dark');
      assert.ok((await L('#inline', 'color')) > 0.7, 'inline text still remapped');
      await cdp.eval(swSession, `chrome.storage.local.set({ sites: { '127.0.0.1/chat': { enabled: true, mode: 'light' } } })`);
      await sleep(700);
      assert.ok((await L('body', 'backgroundColor')) > 0.9, 'new instance switches live');
      assert.equal(await styleCount(), 1, 'still one override style');
    });

    await check('several tabs follow their settings at the same time', async () => {
      const port = new URL(siteUrl).port;
      const open = async (url) => {
        const { targetId: t } = await cdp.send('Target.createTarget', { url: 'about:blank' });
        const sid = (await cdp.send('Target.attachToTarget', { targetId: t, flatten: true })).sessionId;
        await cdp.send('Page.enable', {}, sid);
        await cdp.send('Page.navigate', { url }, sid);
        return { t, sid };
      };
      const a = await open(`http://localhost:${port}/`);
      const b = await open(`http://localhost:${port}/other`);
      await sleep(1500);
      const bodyL = async (sid) => C.rgbToOklch(C.parseColor(await cdp.eval(sid, 'getComputedStyle(document.body).backgroundColor'))).l;
      const set = (sites) => cdp.eval(swSession, `chrome.storage.local.get('sites').then((s) => chrome.storage.local.set({ sites: { ...s.sites, ...${JSON.stringify(sites)} } }))`);
      await set({ localhost: { enabled: true, mode: 'dark' }, '127.0.0.1/chat': { enabled: true, mode: 'dark' } });
      await sleep(700);
      const all = async () => [await L('body', 'backgroundColor'), await bodyL(a.sid), await bodyL(b.sid)];
      let [main, la, lb] = await all();
      assert.ok(main < 0.3 && la < 0.3 && lb < 0.3, `all dark after enabling localhost: ${[main, la, lb]}`);
      await set({ localhost: { enabled: true, mode: 'light' } });
      await sleep(700);
      [main, la, lb] = await all();
      assert.ok(main < 0.3, `127.0.0.1 tab unchanged: ${main}`);
      assert.ok(la > 0.9 && lb > 0.9, `both localhost tabs switched live: ${[la, lb]}`);
      await cdp.send('Target.closeTarget', { targetId: a.t });
      await cdp.send('Target.closeTarget', { targetId: b.t });
    });

    await check('popup scope buttons edit a path scope', async () => {
      const extId = new URL(sw.url).host;
      const id = await siteTabId();
      const { targetId: popTarget } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const pop = (await cdp.send('Target.attachToTarget', { targetId: popTarget, flatten: true })).sessionId;
      await cdp.send('Page.enable', {}, pop);
      // Opened as a tab the popup would see itself as the active tab, so point it at the site tab.
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `chrome.tabs.query = async () => [{ id: ${id}, url: ${JSON.stringify(`${siteUrl}chat/room/1`)} }];`,
      }, pop);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 352, height: 560, deviceScaleFactor: 2, mobile: false }, pop);
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, pop);
      await cdp.send('Page.navigate', { url: `chrome-extension://${extId}/popup/popup.html` }, pop);
      await sleep(800);
      const buttons = () => cdp.eval(pop, `[...document.querySelectorAll('#scope button')].map((b) => [b.textContent, b.className])`);
      assert.deepEqual(await buttons(), [['Celý web', ''], ['/chat', 'active own'], ['/chat/room', '']]);
      await shot('5-popup-light', pop);
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, pop);
      await sleep(200);
      await shot('6-popup-dark', pop);
      const fg = await cdp.eval(pop, `getComputedStyle(document.querySelector('#scope button:not(.active)')).color`);
      const bg = await cdp.eval(pop, `getComputedStyle(document.querySelector('#scope button:not(.active)')).backgroundColor`);
      assert.ok(C.contrastRatio(C.parseColor(fg), C.parseColor(bg)) > 7, `scope button contrast ${fg} on ${bg}`);
      await cdp.eval(pop, `document.querySelector('#scope [data-value="127.0.0.1/chat/room"]').click()`);
      await sleep(200);
      await cdp.eval(pop, `document.querySelector('#modes [data-mode="sepia"]').click()`);
      await sleep(400);
      let store = await cdp.eval(swSession, `chrome.storage.local.get(['sites', 'defaults'])`);
      assert.deepEqual(store.sites['127.0.0.1/chat/room'], { enabled: true }, 'scope stores only enabled');
      assert.equal(store.sites['127.0.0.1/chat'].mode, 'sepia', 'mode goes to the inherited own scheme of /chat');
      assert.equal((store.defaults || {}).mode, undefined, 'shared scheme untouched');
      assert.deepEqual((await buttons()).map((b) => b[1]), ['', 'own', 'active own']);
      await sleep(400);
      assert.match(await cdp.eval(pop, `document.getElementById('diag').textContent`), /^Stránka \/chat\/conversations\/42545 → platí \/chat · přebarveno \(sepia\)$/,
        `diagnostics: ${await cdp.eval(pop, "document.getElementById('diag').textContent")}`);

      await cdp.eval(pop, `document.getElementById('ownScheme').click()`);
      await sleep(300);
      await cdp.eval(pop, `document.querySelector('#modes [data-mode="mono"]').click()`);
      await sleep(400);
      store = await cdp.eval(swSession, `chrome.storage.local.get(['sites', 'defaults'])`);
      assert.equal(store.sites['127.0.0.1/chat/room'].mode, 'mono', 'own scheme stored on the scope');
      assert.equal(store.sites['127.0.0.1/chat'].mode, 'sepia', 'parent scheme untouched');
      assert.equal(await cdp.eval(pop, `document.getElementById('ownScheme').checked`), true);
      await cdp.send('Target.closeTarget', { targetId: popTarget });
    });

    await setSite({ enabled: true, mode: 'dark' });
    await sleep(600);
    await setSite({ enabled: false, mode: 'dark' });
    await sleep(600);
    await check('disabling restores the original page', async () => {
      assert.ok((await L('body', 'backgroundColor')) > 0.95);
      assert.equal(await cdp.eval(page, 'document.querySelectorAll("style[data-ccs]").length'), 0);
      assert.equal(await cdp.eval(page, 'document.getElementById("inline").getAttribute("style")'), 'color: #000; background-color: #fafafa');
    });

    for (const [status, name] of results) console.log(`${status === 'ok' ? '✔' : '✖'} ${name}`);
    const failed = results.filter(([s]) => s !== 'ok').length;
    console.log(`\n${results.length - failed}/${results.length} passed${SHOTS ? `, screenshots in ${SHOTS}` : ''}`);
    process.exitCode = failed ? 1 : 0;
  } finally {
    cleanup();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
