'use strict';

const CCS = globalThis.CCS;
const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const tabId = Number(params.get('tab')) || null;
const siteHost = params.get('host') || null;

const TYPICAL = ['#ffffff', '#f3f4f6', '#d1d5db', '#6b7280', '#1f2937', '#000000', '#2563eb', '#dc2626', '#16a34a', '#f59e0b'];

let target = siteHost; // host whose settings we edit, null = global defaults
let state = CCS.normalizeSettings(null);
let theme = 'light';
let report = null;
let saveTimer = null;

// ---------- settings ----------

async function loadState() {
  const store = await chrome.storage.local.get(['defaults', 'sites']);
  state = target ? CCS.effectiveSettings(store, target) : CCS.normalizeSettings(store.defaults);
  render();
}

function update(patch, immediate = true) {
  state = CCS.normalizeSettings(CCSControls.merge(state, patch));
  render();
  clearTimeout(saveTimer);
  if (immediate) CCSControls.save(target, state);
  else saveTimer = setTimeout(() => CCSControls.save(target, state), 150);
}

function render() {
  CCSControls.render(state);
  $('enabledRow').hidden = !target;
  $('enabled').checked = state.enabled;
  pushToFrames();
  renderPalettes();
}

// ---------- sample frames ----------

/** The preview always shows the scheme, even if it is switched off for the edited site. */
function messageFor(frame) {
  return { type: 'ccs-preview', theme, settings: frame === $('prev') ? { ...state, enabled: true } : null };
}

function pushToFrames() {
  for (const frame of [$('orig'), $('prev')]) {
    if (frame.dataset.ready) frame.contentWindow.postMessage(messageFor(frame), location.origin);
  }
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data || e.data.type !== 'ccs-preview-ready') return;
  const frame = [$('orig'), $('prev')].find((f) => f.contentWindow === e.source);
  if (!frame) return;
  frame.dataset.ready = '1';
  frame.contentWindow.postMessage(messageFor(frame), location.origin);
});

// ---------- palettes ----------

function pairs(container, list) {
  container.replaceChildren();
  if (!list.length) {
    container.textContent = '–';
    return;
  }
  for (const { from, to } of list) {
    const b = document.createElement('button');
    b.className = 'pair';
    b.title = `${from} → ${to} (klik zkopíruje novou barvu)`;
    const a = document.createElement('i');
    a.style.background = from;
    const z = document.createElement('i');
    z.style.background = to;
    b.append(a, z);
    b.addEventListener('click', () => navigator.clipboard.writeText(to).then(() => toast(`Zkopírováno ${to}`)));
    container.append(b);
  }
}

function renderPalettes() {
  if (state.mode === 'filter') {
    for (const id of ['schemeBase', 'typBg', 'typText', 'siteBg', 'siteText', 'siteAccent']) $(id).textContent = 'Invert pracuje filtrem, barvy nepřemapovává.';
    return;
  }
  const scheme = CCS.buildScheme(state, theme);
  pairs($('schemeBase'), [{ from: scheme.bg, to: scheme.bg }, { from: scheme.text, to: scheme.text }]);
  pairs($('typBg'), CCS.remapPalette(TYPICAL, 'bg', scheme));
  pairs($('typText'), CCS.remapPalette(TYPICAL, 'text', scheme));
  if (report) {
    const siteScheme = CCS.buildScheme(state, report.base);
    pairs($('siteBg'), CCS.remapPalette(report.background.map((c) => c.hex), 'bg', siteScheme));
    pairs($('siteText'), CCS.remapPalette(report.text.map((c) => c.hex), 'text', siteScheme));
    pairs($('siteAccent'), CCS.remapPalette(report.accents.map((c) => c.hex), 'auto', siteScheme));
  }
}

async function loadSiteReport() {
  if (!tabId) return;
  $('siteBox').hidden = false;
  $('siteTitle').textContent = `Barvy webu ${siteHost}`;
  try {
    const resp = await chrome.tabs.sendMessage(tabId, { type: 'analyze' }, { frameId: 0 });
    if (!resp || !resp.ok) throw new Error(resp ? resp.error : 'bez odpovědi');
    report = resp.report;
    $('siteNote').textContent = `Web je ${report.base === 'dark' ? 'tmavý' : 'světlý'}. Vlevo původní barva, vpravo po přemapování.`;
    renderPalettes();
  } catch (e) {
    $('siteNote').textContent = 'Paletu webu se nepodařilo načíst (tab byl zavřen nebo obnoven).';
  }
}

// ---------- misc ----------

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 1600);
}

function segmented(id, onPick) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b) return;
    $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    onPick(b.dataset.value);
  });
}

function initTargetSelect() {
  const sel = $('target');
  if (siteHost) sel.append(new Option(`Web ${siteHost}`, siteHost));
  sel.append(new Option('Výchozí nastavení (všechny weby)', ''));
  sel.value = siteHost || '';
  sel.addEventListener('change', () => {
    target = sel.value || null;
    loadState();
  });
}

CCSControls.mount($('controls'));
CCSControls.bind(update);
$('enabled').addEventListener('change', (e) => update({ enabled: e.target.checked }));
segmented('theme', (v) => {
  theme = v;
  pushToFrames();
  renderPalettes();
});
segmented('layout', (v) => $('panes').classList.toggle('single', v === 'single'));
initTargetSelect();
loadState();
loadSiteReport();
