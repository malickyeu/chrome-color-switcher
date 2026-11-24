/**
 * Scheme controls (modes, colors, sliders) shared by the popup and the preview page.
 * mount() renders the markup, render() reflects a settings object, bind() wires the inputs.
 */
(function (root) {
  'use strict';

  const MARKUP = `
    <section>
      <h2>Režim</h2>
      <div class="modes" id="modes">
        <button data-mode="flip" title="Světlý web ztmaví, tmavý zesvětlí">Překlopit</button>
        <button data-mode="dark">Tmavý</button>
        <button data-mode="light">Světlý</button>
        <button data-mode="filter" title="Rychlé invertování celé stránky CSS filtrem">Invert</button>
        <button data-mode="mono">Mono</button>
        <button data-mode="sepia">Sepia</button>
        <button data-mode="gray">Šedá</button>
        <button data-mode="custom">Vlastní</button>
      </div>
    </section>
    <section id="mono-opts" class="opts" hidden>
      <div class="row"><label for="monoColor">Odstín</label><input type="color" id="monoColor"></div>
    </section>
    <section id="target-opts" class="opts" hidden>
      <div class="row">
        <span>Základ</span>
        <div class="seg" id="monoTarget">
          <button data-value="dark">Tmavý</button>
          <button data-value="light">Světlý</button>
        </div>
      </div>
    </section>
    <section id="custom-opts" class="opts" hidden>
      <div class="row"><label for="customBg">Pozadí</label><input type="color" id="customBg"></div>
      <div class="row"><label for="customText">Text</label><input type="color" id="customText"></div>
      <div class="row"><label for="customAccent">Akcent</label><input type="color" id="customAccent"></div>
    </section>
    <section class="opts">
      <div class="row">
        <label for="contrast">Kontrast</label>
        <input type="range" id="contrast" min="0.5" max="1.5" step="0.05">
        <output id="contrastOut"></output>
      </div>
      <div class="row">
        <label for="brightness">Jas</label>
        <input type="range" id="brightness" min="-0.3" max="0.3" step="0.02">
        <output id="brightnessOut"></output>
      </div>
      <div class="row"><label for="dimImages">Ztlumit obrázky</label><input type="checkbox" id="dimImages"></div>
    </section>`;

  const $ = (id) => document.getElementById(id);

  function mount(container) {
    container.insertAdjacentHTML('beforeend', MARKUP);
  }

  function render(state) {
    document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
    document.querySelectorAll('#monoTarget button').forEach((b) => b.classList.toggle('active', b.dataset.value === state.monoTarget));
    $('mono-opts').hidden = state.mode !== 'mono';
    $('target-opts').hidden = state.mode !== 'mono' && state.mode !== 'gray';
    $('custom-opts').hidden = state.mode !== 'custom';
    $('monoColor').value = state.monoColor;
    $('customBg').value = state.custom.bg;
    $('customText').value = state.custom.text;
    $('customAccent').value = state.custom.accent;
    $('contrast').value = state.contrast;
    $('brightness').value = state.brightness;
    $('contrastOut').textContent = `${Math.round(state.contrast * 100)} %`;
    $('brightnessOut').textContent = `${state.brightness > 0 ? '+' : ''}${Math.round(state.brightness * 100)}`;
    $('dimImages').checked = state.dimImages;
  }

  /**
   * @param {(patch: object, immediate: boolean) => void} update called with a partial settings
   *        object; `immediate` is false for continuous inputs (sliders, color pickers).
   */
  function bind(update) {
    $('modes').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-mode]');
      if (b) update({ mode: b.dataset.mode }, true);
    });
    $('monoTarget').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-value]');
      if (b) update({ monoTarget: b.dataset.value }, true);
    });
    $('monoColor').addEventListener('input', (e) => update({ monoColor: e.target.value }, false));
    $('customBg').addEventListener('input', (e) => update({ custom: { bg: e.target.value } }, false));
    $('customText').addEventListener('input', (e) => update({ custom: { text: e.target.value } }, false));
    $('customAccent').addEventListener('input', (e) => update({ custom: { accent: e.target.value } }, false));
    $('contrast').addEventListener('input', (e) => update({ contrast: Number(e.target.value) }, false));
    $('brightness').addEventListener('input', (e) => update({ brightness: Number(e.target.value) }, false));
    $('dimImages').addEventListener('change', (e) => update({ dimImages: e.target.checked }, true));
  }

  /** Merges a partial patch (including nested custom colors) into settings. */
  function merge(state, patch) {
    return { ...state, ...patch, custom: { ...state.custom, ...(patch.custom || {}) } };
  }

  /** Writes settings for a host, or the global defaults when host is null. */
  async function save(host, state) {
    if (!host) return chrome.storage.local.set({ defaults: state });
    const { sites = {} } = await chrome.storage.local.get('sites');
    return chrome.storage.local.set({ sites: { ...sites, [host]: state } });
  }

  root.CCSControls = { mount, render, bind, merge, save };
})(globalThis);
