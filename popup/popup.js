'use strict';

const CCS = globalThis.CCS;
const $ = (id) => document.getElementById(id);

let tab = null;
let host = null;
let state = CCS.normalizeSettings(null);
let report = null;
let saveTimer = null;

async function load() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  host = tab ? CCS.hostFromUrl(tab.url || '') : null;
  if (!host) {
    $('host').textContent = '–';
    $('unsupported').hidden = false;
    $('main').hidden = true;
    $('enabled').disabled = true;
    document.querySelector('footer').hidden = true;
    return;
  }
  $('host').textContent = host;
  const store = await chrome.storage.local.get(['defaults', 'sites']);
  state = CCS.effectiveSettings(store, host);
  render();
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
  if (immediate) CCSControls.save(host, state);
  else saveTimer = setTimeout(() => CCSControls.save(host, state), 120);
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

CCSControls.mount($('controls'));
// Picking a mode also switches the extension on for the site.
CCSControls.bind((patch, immediate) => update(patch.mode ? { ...patch, enabled: true } : patch, immediate));

$('openPreview').addEventListener('click', () => {
  const q = new URLSearchParams({ tab: String(tab.id), host });
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

$('saveDefault').addEventListener('click', async () => {
  await chrome.storage.local.set({ defaults: state });
  toast('Uloženo jako výchozí');
});

$('resetSite').addEventListener('click', async () => {
  const { sites = {}, defaults } = await chrome.storage.local.get(['sites', 'defaults']);
  delete sites[host];
  await chrome.storage.local.set({ sites });
  state = CCS.normalizeSettings(defaults);
  render();
  toast('Nastavení webu smazáno');
});

load();
