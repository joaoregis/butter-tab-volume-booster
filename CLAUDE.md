# Butter: Tab Volume Booster (Firefox extension)

Per-tab volume boost (0–600%) and a 10-band EQ for Firefox. The popup UI is in PT/EN/ES with light/dark/auto themes.
It's a plain MV3 WebExtension with no build step, no dependencies and no framework. Firefox-only (≥140): the CSS uses
`::-moz-range-*` and `light-dark()`, and the background is an event page (`background.scripts`).

## Map

- `manifest.json`: MV3; the content script runs in all frames at `document_start`.
- `common.js`: shared by background, content and popup (FREQS, PRESETS, defaultState, isActive, createEqFilters, updateBadge). Always load it first.
- `background.js`: answers the content script's `{type:'get'}` with the tab's state, restores the badge (Firefox clears tab badges on navigation) and cleans up when a tab closes.
- `content.js`: the Web Audio graph per frame: media → 10 biquads → gain → limiter → destination.
- `popup.html/css/js`: the UI. Per-tab settings live in `storage.session` under `tab:<id>` as `{ volume, eq? }`. `eq` is present only when the tab has its own EQ. The global EQ (persistent) lives in `storage.local.eq`, and prefs (theme, lang, view) in `storage.local.prefs`.
- `_locales/{en,pt,es}/messages.json`: every UI string. To override the browser language, the popup fetches these files directly.
- `scripts/check.mjs`: syntax check plus i18n key parity. `scripts/test-audio.mjs`: runs content.js on a silent `<audio>` in headless Firefox (WebDriver BiDi) and asserts routing and gain. `scripts/screenshots.mjs`: renders the popup in headless Firefox with a mocked `browser` API → `docs/*.png`.

## Flow

- Volume or tab-EQ change → `storage.session` + `tabs.sendMessage({type:'apply', settings})` (all frames) + badge.
- Global EQ change → `storage.local.eq` (throttled while dragging, saved on release). Every content script watches it via `storage.onChanged`. The effective EQ is the tab's own, falling back to the global one.
- Page load → content script `{type:'get'}` → background replies with the stored state.
- Popup opened on a tab with no content script (opened before install) → `scripting.executeScript`. If that fails, the page is unsupported and the controls are disabled.

## Rules

- Keep the routing guards in `content.js`: route media only once the tab has non-default settings, and never route DRM (`mediaKeys`) or cross-origin non-CORS media. Firefox would output silence and the routing can't be undone.
- Never route while the AudioContext is suspended (autoplay policy): doing so mutes the media.
- New UI string → add it to all three locales (`data-i18n` / `data-i18n-label` in HTML, `t('key')` in JS), then run `node scripts/check.mjs`.
- Colors come only from the tokens in `popup.css` `:root` (`light-dark()`). Every change must work in both themes.
- After a UI change, run `node scripts/screenshots.mjs` and look at `docs/*.png` (they're the README images).

## Run / verify

- Load: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `manifest.json` (or `npx web-ext run`).
- Lint: `npx web-ext lint`. Build the AMO package: `npx web-ext build` → `web-ext-artifacts/butter-tab-volume-booster-<version>.xpi`. Both read `web-ext-config.mjs`, which keeps dev files out of the package.
- Bump `version` in `manifest.json` before every AMO upload, because AMO rejects a version it already has.
- `node scripts/check.mjs` must pass before committing. Also run `node scripts/test-audio.mjs` after touching `content.js` or `common.js`.
