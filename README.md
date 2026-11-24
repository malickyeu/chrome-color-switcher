# Color Switcher

A Chrome extension (Manifest V3) that turns any website dark or light, inverts colors, and builds custom color schemes from the page's own CSS. Made for sites that have no dark mode of their own. No dependencies, no build step.

> The user interface is in Czech for now.

## Install

**From a release (recommended):**

1. Download `color-switcher-<version>.zip` from [Releases](https://github.com/malickyeu/chrome-color-switcher/releases) and unzip it to a folder you will keep (Chrome loads the extension from there).
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the unzipped folder.

**From source:** clone the repository and pick its folder in step 3. After `git pull`, click ↻ on the extension in `chrome://extensions`.

Click the toolbar icon to open the settings. **Alt+Shift+D** toggles the extension on the current site (change it in `chrome://extensions/shortcuts`). Changes apply immediately without reloading the page. Tabs that were open before the extension was installed or updated get the script automatically.

## Modes

| Mode | What it does |
|---|---|
| Flip (*Překlopit*) | Detects whether the page is light or dark and switches it to the opposite |
| Dark / Light | Forces a dark / light look |
| Invert | Quick `filter: invert()` of the whole page, with images and videos inverted back. Works everywhere, looks worse |
| Mono | Maps every color to a single hue, on a dark or light base |
| Sepia / Gray | Warm "paper" scheme / no colors |
| Custom (*Vlastní*) | Your own background, text and accent color |

Every mode has contrast and brightness sliders and an option to dim images.

## Sites, paths and schemes

- **The scheme is shared.** Mode, colors and sliders are the same on every site where the extension is turned on. Change them on one site and every other site follows.
- **Sites only store on/off.** The switch in the popup turns the extension on or off for the selected scope.
- **Scope (*Platí pro*).** A scope is either the whole site or a part of it by path. For example, `teamwork.4net.tv/chat` applies to `/chat` and everything below it, but not to `/chatroom`. Entries are layered from the host to the longest matching path, so you can turn the extension on for the whole site and off for one section, or the other way round. This also works in single-page apps that change the URL without reloading. Scopes with their own settings are marked with •.
- **Own scheme (*Vlastní schéma*).** Ticking this gives the selected scope its own copy of the scheme. From then on it is edited separately from the shared one. Paths below that scope inherit it.
- **Diagnostics.** A line in the popup shows the path the page script sees, which scope applies to it, and whether the page is recolored.

**Page analysis** reports whether the page is light or dark, how many stylesheets, rules and CSS variables it has, and its dominant background, text and accent colors. Clicking a color uses it as the hue (Mono) or the accent (Custom). **Custom from page palette** (*Vlastní z palety webu*) builds a scheme from the page's colors moved to the opposite brightness.

## Preview

The **Preview** button (*Náhled*) in the popup, or the extension's *Options* in `chrome://extensions`, opens a page with a sample website shown twice: original and recolored. The sample can be switched between light and dark, so you can also try Flip and Light. Below the sample you see the scheme's palette. If you opened the preview from a site, you also see that site's real colors, original on the left and remapped on the right. Changes are saved immediately and show up in open tabs.

## How the smart modes work

The content script reads every stylesheet of the page, including cross-origin ones. Those are fetched by the service worker without cookies. For every rule that sets a color, it creates a copy with the same selector and remapped colors. The copies go into the extension's own `<style>`, which is kept as the last element of the document, so the cascade order and specificity are preserved.

- **Color mapping.** Colors are remapped in OKLCH according to their role: background, text, border or shadow. Light backgrounds get darker and dark text gets lighter. Colors that already fit the target scheme are kept.
- **CSS variables.** The role of a variable is inferred from how it is used (`background: var(--x)`), through aliases, and from its name. A variable used both as a background and as text gets one variant per role (`--ccs-bg--x`, `--ccs-text--x`), and each use is rewritten to the right variant. RGB triplets such as `--x-rgb: 255, 255, 255` are supported.
- **What is handled.** Inline styles, legacy `bgcolor` / `<font color>` attributes, `@media`, `@supports`, `@layer`, `@keyframes`, nested CSS and adopted stylesheets. Changes are tracked with a MutationObserver plus polling, to catch CSS-in-JS that uses `insertRule`.
- **Limitations.** Shadow DOM content, colors inside images, and modern color functions (`oklch()`, `color-mix()`) are not remapped.

## Development

```
src/color.js       color parsing, OKLCH, contrast
src/scheme.js      schemes and per-role mapping of a single color
src/transform.js   rewriting values and CSS rules, roles of CSS variables
src/settings.js    settings model, scopes, storage layout
src/content.js     applying to the page, watching changes, analysis
src/background.js  cross-origin CSS, script injection, URL changes, shortcut, badge
ui/controls.*      controls shared by the popup and the preview
popup/             popup
preview/           preview page and the sample website
```

- `npm test` runs the unit tests (`node:test`, no dependencies).
- `npm run test:e2e` loads the extension into Chromium and checks the result on fixture pages. It uses Playwright's Chromium from `~/.cache/ms-playwright`, or `CHROME_PATH`. Add `-- --screenshots <dir>` to save screenshots. Branded Google Chrome ignores `--load-extension`.
- `npm run icons` regenerates the icons.
- `npm run pack` builds `dist/color-switcher-<version>.zip`, without tests and dev files.

### Releases

The version lives in `manifest.json` and `package.json`. To release:

1. Bump both files and commit.
2. Push a tag: `git tag v0.4.0 && git push origin v0.4.0`.

The [release workflow](.github/workflows/release.yml) then runs the unit and e2e tests and checks that the tag matches the manifest version. It builds the zip and publishes a GitHub Release with the zip and its SHA-256 checksum. The release notes list the commit messages since the previous tag. The repository has immutable releases turned on, so a published release and its assets cannot be changed or replaced.

## License

[MIT](LICENSE)

Made with ❤️ by Filip Majerík & AI · © 2026
