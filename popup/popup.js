'use strict';

const CCS = globalThis.CCS;
const $ = (id) => document.getElementById(id);

let tab = null;
let host = null;
let where = null; // location key of the tab: "host/path"
let scope = null; // storage key being edited: the host or "host/path/prefix"
let state = CCS.normalizeSettings(null);
let report = null;
let saveTimer = null;

async function load() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  where = tab ? CCS.locationKey(tab.url || '') : null;
  host = where && CCS.splitKey(where).host;
  if (!host) {
    $('host').textContent = '–';
    $('unsupported').hidden = false;
    $('main').hidden = true;
    $('enabled').disabled = true;
    document.querySelector('footer').hidden = true;
    return;
  }
  $('host').textContent = host;
  $('scopeRow').hidden = false;
  $('scopeOpts').hidden = false;
  const store = await chrome.storage.local.get(['defaults', 'sites']);
  scope = CCS.matchSite(store.sites, where) || host;
  refresh(store);
  // Tabs opened before the extension was (re)loaded get the content script now, no reload needed.
  await ensureContent();
  diagnose();
}

/** Re-reads everything that depends on the stored settings for the current scope. */
function refresh(store) {
  const sites = store.sites || {};
  fillScopes(sites);
  state = CCS.effectiveSettings(store, scope);
  const source = CCS.schemeSource(sites, scope);
  $('ownScheme').checked = source === scope;
  $('scopeName').textContent = label(scope);
  $('ownScheme').parentElement.title = source && source !== scope
    ? `Schéma se dědí z ${label(source)}`
    : 'Bez zaškrtnutí používají všechny weby jedno společné schéma';
  render();
}

const label = (key) => {
  const path = CCS.splitKey(key).path.replace(/\/+$/, '');
  return path ? `${path}/…` : 'celý web';
};

/** Shows what the content script in the tab sees, so a scope that does not apply is easy to spot. */
async function diagnose() {
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'ping' }, { frameId: 0 });
    const page = CCS.splitKey(r.where || host).path || '/';
    const applies = r.scope === host ? 'celý web' : CCS.splitKey(r.scope).path;
    $('diag').textContent = `Stránka ${page} → platí ${applies} · ${r.applied ? `přebarveno (${r.mode})` : 'nepřebarveno'}`;
  } catch (e) {
    $('diag').textContent = 'Na stránce neběží skript rozšíření.';
  }
}

function ensureContent() {
  return chrome.runtime.sendMessage({ type: 'ensureContent', tabId: tab.id }).catch((e) => ({ ok: false, error: e.message }));
}

/** Scope buttons: "Celý web" plus the leading path segments of the tab URL; • marks own settings. */
function fillScopes(sites) {
  const keys = CCS.scopesFor(where);
  if (!keys.includes(scope)) keys.push(scope);
  $('scope').replaceChildren(
    ...keys.map((k) => {
      const path = CCS.splitKey(k).path.replace(/\/+$/, '');
      const b = document.createElement('button');
      b.dataset.value = k;
      b.textContent = path || 'Celý web';
      b.title = `${path ? `Jen ${host}${path} a vše pod tím` : `Celý web ${host}`}${sites[k] ? ' (má vlastní nastavení)' : ''}`;
      b.classList.toggle('active', k === scope);
      b.classList.toggle('own', !!sites[k]);
      return b;
    }),
  );
}

async function changeScope(key) {
  scope = key;
  refresh(await chrome.storage.local.get(['defaults', 'sites']));
}

function render() {
  $('enabled').checked = state.enabled;
  CCSControls.render(state);
}

/** Persists the current state for this site; `immediate` skips the debounce used for sliders. */
function update(patch, immediate = true) {
  state = CCS.normalizeSettings(CCSControls.merge(state, patch));
  render();
  clearTimeout(saveTimer);
  if (immediate) save();
  else saveTimer = setTimeout(save, 120);
}

async function save() {
  await CCSControls.save(scope, state);
  const { sites = {} } = await chrome.storage.local.get('sites');
  fillScopes(sites);
  setTimeout(diagnose, 300);
}

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 1600);
}

// ---------- analysis ----------

function swatches(container, colors) {
  container.replaceChildren();
  if (!colors.length) {
    container.textContent = '–';
    return;
  }
  for (const c of colors) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = c.hex;
    b.title = `${c.hex} · ${c.share} %`;
    b.addEventListener('click', () => pickColor(c.hex));
    container.append(b);
  }
}

function pickColor(hex) {
  if (state.mode === 'mono') {
    update({ monoColor: hex, enabled: true });
    toast(`Odstín ${hex}`);
  } else if (state.mode === 'custom') {
    update({ custom: { accent: hex }, enabled: true });
    toast(`Akcent ${hex}`);
  } else {
    navigator.clipboard.writeText(hex).then(() => toast(`Zkopírováno ${hex}`), () => toast(hex));
  }
}

function renderReport(r) {
  const s = r.stats;
  const base = r.base === 'dark' ? 'tmavý' : 'světlý';
  const cross = s.crossOrigin ? `, z toho ${s.crossOrigin} z cizí domény (${s.crossOriginRead} načteno)` : '';
  $('summary').textContent =
    `Web je ${base}. ${s.sheets} stylesheetů${cross}, ${s.rules} pravidel, ` +
    `${s.colorDecls} deklarací s barvou, ${s.customProps} CSS proměnných, ${s.inlineStyled} inline stylů.`;
  swatches($('palBg'), r.background);
  swatches($('palText'), r.text);
  swatches($('palAccent'), r.accents);
  swatches($('palCss'), r.sheetColors);
  $('monoFromAccent').disabled = !r.accents.length;
  $('report').hidden = false;
}

async function analyze() {
  $('analyzeError').hidden = true;
  $('analyze').disabled = true;
  try {
    const inj = await ensureContent();
    if (!inj || !inj.ok) throw new Error(inj ? inj.error : 'skript nelze vložit');
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'analyze' }, { frameId: 0 });
    if (!resp || !resp.ok) throw new Error(resp ? resp.error : 'bez odpovědi');
    report = resp.report;
    renderReport(report);
  } catch (e) {
    $('analyzeError').textContent = `Analýza selhala: ${e.message}. Zkuste stránku obnovit.`;
    $('analyzeError').hidden = false;
  } finally {
    $('analyze').disabled = false;
  }
}

/** Builds a custom scheme from the page palette: its colors, moved to the opposite brightness. */
function customFromPage() {
  if (!report) return;
  const target = report.base === 'dark' ? 'light' : 'dark';
  const scheme = CCS.buildScheme({ ...CCS.normalizeSettings(null), mode: target });
  const move = (hex, role) => CCS.toHex(CCS.transformColor(CCS.parseColor(hex), role, scheme));
  const bg = report.background[0] ? move(report.background[0].hex, 'bg') : scheme.bg;
  const text = report.text[0] ? move(report.text[0].hex, 'text') : scheme.text;
  const accent = report.accents[0] ? report.accents[0].hex : state.custom.accent;
  update({ mode: 'custom', enabled: true, custom: { bg, text, accent } });
  toast('Vlastní schéma z palety webu');
}

// ---------- events ----------

$('enabled').addEventListener('change', (e) => update({ enabled: e.target.checked }));
$('scope').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-value]');
  if (b && b.dataset.value !== scope) changeScope(b.dataset.value);
});

CCSControls.mount($('controls'));
// Picking a mode also switches the extension on for the site.
CCSControls.bind((patch, immediate) => update(patch.mode ? { ...patch, enabled: true } : patch, immediate));

$('openPreview').addEventListener('click', () => {
  const q = new URLSearchParams({ tab: String(tab.id), host: scope });
  chrome.tabs.create({ url: chrome.runtime.getURL(`preview/preview.html?${q}`) });
  window.close();
});

$('analyze').addEventListener('click', analyze);
$('monoFromAccent').addEventListener('click', () => {
  if (!report || !report.accents.length) return;
  update({ mode: 'mono', monoColor: report.accents[0].hex, enabled: true });
  toast(`Mono ${report.accents[0].hex}`);
});
$('customFromPage').addEventListener('click', customFromPage);

$('ownScheme').addEventListener('change', async (e) => {
  const store = await chrome.storage.local.get(['defaults', 'sites']);
  const next = CCS.setOwnScheme(store, scope, e.target.checked);
  await chrome.storage.local.set(next);
  refresh(next);
  toast(e.target.checked ? `Vlastní schéma pro ${label(scope)}` : 'Společné schéma');
});

$('resetSite').addEventListener('click', async () => {
  const { sites = {}, defaults } = await chrome.storage.local.get(['sites', 'defaults']);
  delete sites[scope];
  await chrome.storage.local.set({ sites });
  refresh({ sites, defaults });
  toast(`Nastavení ${label(scope)} smazáno`);
});

load();
