# Color Switcher

Rozšíření pro Chrome (Manifest V3), které umí ztmavit nebo zesvětlit libovolný web, invertovat barvy a vytvořit vlastní barevné schéma z CSS stránky. Nemá žádné závislosti ani build krok.

## Instalace

1. `chrome://extensions` → zapnout **Režim pro vývojáře**
2. **Načíst rozbalené** → vybrat tento adresář
3. Ikona v liště otevře nastavení, **Alt+Shift+D** přepíná rozšíření na aktuálním webu (změna v `chrome://extensions/shortcuts`)

## Režimy

| Režim | Co dělá |
|---|---|
| Překlopit | Pozná, jestli je web světlý nebo tmavý, a přepne ho na opačný |
| Tmavý / Světlý | Vynutí tmavý / světlý vzhled |
| Invert | Rychlé `filter: invert()` celé stránky, obrázky a videa se vrátí zpět; funguje všude, ale méně hezky |
| Mono | Všechny barvy převede na jeden odstín (tmavý nebo světlý základ) |
| Sepia / Šedá | Teplé „papírové“ schéma / bez barev |
| Vlastní | Vlastní barva pozadí, textu a akcentu |

Ke všem režimům patří posuvníky kontrastu a jasu a volba ztlumení obrázků. Nastavení se ukládá zvlášť pro každý web, tlačítkem **Nastavit jako výchozí** ho použijete pro všechny weby bez vlastního nastavení. Pokud výchozí nastavení uložíte zapnuté, bude rozšíření aktivní všude.

**Analýza stránky** ukáže, jestli je web světlý nebo tmavý, kolik má stylesheetů, pravidel a CSS proměnných, a dominantní barvy pozadí, textu a akcentů. Klik na barvu ji nastaví jako odstín (Mono) nebo akcent (Vlastní). **Vlastní z palety webu** vytvoří schéma z barev webu převedených do opačného jasu.

## Jak funguje chytrý režim

Content script projde všechny stylesheety stránky, včetně těch z cizích domén (ty stáhne service worker bez cookies), a ke každému pravidlu, které nastavuje barvu, vytvoří kopii se stejným selektorem a přemapovanými barvami. Kopie vloží do vlastního `<style>`, který drží jako poslední prvek dokumentu, takže kaskáda i specificita zůstanou zachované.

- Barvy se mapují v OKLCH podle role: pozadí, text, rámeček, stín. Světlá pozadí ztmavnou, tmavý text zesvětlí a barvy, které už do cílového schématu sedí, zůstanou.
- U CSS proměnných se role odvozuje z jejich použití (`background: var(--x)`), přes aliasy a podle názvu. Podporuje i RGB trojice typu `--x-rgb: 255, 255, 255`.
- Zpracovává inline styly, staré atributy `bgcolor` / `<font color>`, `@media`, `@supports`, `@layer`, `@keyframes`, vnořené CSS i adoptované stylesheety. Změny sleduje přes MutationObserver a polling (CSS-in-JS přes `insertRule`).
- Omezení: obsah Shadow DOM, barvy v obrázcích a moderní barevné funkce (`oklch()`, `color-mix()`) se nepřemapovávají.

## Vývoj

```
src/color.js       parsování barev, OKLCH, kontrast
src/scheme.js      schémata a mapování jedné barvy podle role
src/transform.js   přepis hodnot a CSS pravidel, role CSS proměnných
src/settings.js    model nastavení a úložiště
src/content.js     aplikace na stránce, sledování změn, analýza
src/background.js  stahování cross-origin CSS, zkratka, badge
popup/             UI
```

- `npm test` spustí unit testy (`node:test`, bez závislostí)
- `npm run test:e2e` načte rozšíření do Chromia (Playwright Chromium z `~/.cache/ms-playwright`, nebo `CHROME_PATH`) a ověří výsledek na testovací stránce. Parametr `-- --screenshots <adresář>` uloží screenshoty. Brandovaný Google Chrome volbu `--load-extension` ignoruje.
- `npm run icons` znovu vygeneruje ikony
