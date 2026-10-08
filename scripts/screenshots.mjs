// Renders the real popup (2x) in headless Firefox with a mocked `browser` API and saves docs/*.png.
// Usage: node scripts/screenshots.mjs   (set FIREFOX if the binary isn't at the default Windows path)
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const HEIGHT = 550; // popup content height in CSS px (both panels share a min-height)
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const firefox = process.env.FIREFOX ?? 'C:/Program Files/Mozilla Firefox/firefox.exe';
const locales = Object.fromEntries(
  readdirSync(new URL('_locales/', root)).map((l) => [l, JSON.parse(read(`_locales/${l}/messages.json`))]),
);

const favicon = (color, glyph) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="${color}"/><text x="8" y="12" font-size="10" font-family="Segoe UI,sans-serif" font-weight="700" text-anchor="middle" fill="#fff">${glyph}</text></svg>`,
  )}`;

const TABS = [
  { id: 1, windowId: 1, active: true, audible: true, title: 'Lo-fi beats to study and relax — live radio', url: 'https://video.example.com/watch?v=lofi', favIconUrl: favicon('#e5484d', '▶') },
  { id: 2, windowId: 1, audible: true, title: 'Weekly Tech Podcast · Episode 142', url: 'https://podcasts.example.org/ep/142', favIconUrl: favicon('#7c5cff', 'P') },
  { id: 3, windowId: 1, mutedInfo: { muted: true }, title: 'Quarter-final highlights (live)', url: 'https://sports.example.net/live', favIconUrl: favicon('#16a34a', 'S') },
  { id: 4, windowId: 1, title: 'Classical Focus — playlist', url: 'https://music.example.com/focus', favIconUrl: favicon('#0ea5e9', '♪') },
];
const ROCK = { enabled: true, preset: 'rock', bands: [5, 4, 2, 0, -1, -1, 1, 3, 4, 5] };
const OTHER_TABS = {
  'tab:2': { volume: 100, eq: { enabled: true, preset: 'vocal', bands: [-3, -3, -2, 1, 4, 5, 4, 2, 0, -1] } },
  'tab:4': { volume: 150 },
};

// `tab` = settings of the controlled tab (tab 1), `eq` = the global EQ.
const SHOTS = [
  { name: 'volume-light', theme: 'light', lang: 'pt', view: 'volume', tab: { volume: 250 }, eq: ROCK },
  { name: 'volume-dark', theme: 'dark', lang: 'en', view: 'volume', tab: { volume: 450 }, eq: { ...ROCK, enabled: false } },
  { name: 'eq-light', theme: 'light', lang: 'es', view: 'eq', tab: { volume: 180, eq: { enabled: true, preset: 'custom', bands: [6, 5, 3, 1, 0, -2, 0, 2, 4, 3] } }, eq: ROCK },
  { name: 'eq-dark', theme: 'dark', lang: 'pt', view: 'eq', tab: { volume: 250 }, eq: ROCK },
  { name: 'tabs-dark', theme: 'dark', lang: 'pt', view: 'volume', list: true, tab: { volume: 250 }, eq: ROCK },
];

const mock = (shot) => `
const LOCALES = ${JSON.stringify(locales)};
const TABS = ${JSON.stringify(TABS)};
const STATES = ${JSON.stringify({ ...OTHER_TABS, 'tab:1': shot.tab })};
const clone = (x) => JSON.parse(JSON.stringify(x));
window.browser = {
  i18n: { getMessage: (k) => LOCALES.en[k]?.message ?? '', getUILanguage: () => 'en' },
  storage: {
    local: { get: async () => (${JSON.stringify({ prefs: { theme: shot.theme, lang: shot.lang, view: shot.view }, eq: shot.eq })}), set: async () => {} },
    session: { get: async (k) => clone(k ? { [k]: STATES[k] } : STATES), set: async () => {}, remove: async () => {} },
  },
  tabs: {
    query: async (q) => clone(q.active ? TABS.filter((x) => x.active) : TABS),
    sendMessage: async () => true,
    update: async () => {},
    onUpdated: { addListener() {} },
  },
  scripting: { executeScript: async () => {} },
  permissions: { contains: async () => true },
  action: { setBadgeText: async () => {} },
  windows: { update: async () => {} },
};
window.fetch = async (url) => ({ json: async () => LOCALES[url.split('/')[1]] });
${shot.list ? "addEventListener('load', () => document.querySelector('#target').click());" : ''}`;

// 1280×800 compositions for the addons.mozilla.org listing, built from the popup shots above.
const STORE = [
  { name: 'store-1-volume', title: 'Boost any tab up to 600%', text: 'Turn up just the tab that is too quiet. A built-in limiter keeps big boosts clean, and the toolbar badge shows each tab’s level.', shots: ['volume-light', 'volume-dark'] },
  { name: 'store-2-equalizer', title: '10-band equalizer, global or per tab', text: 'A saved EQ for every tab, or a tab of its own. 10 presets and a live frequency-response curve.', shots: ['eq-dark', 'eq-light'] },
  { name: 'store-3-tabs', title: 'Every tab with audio, in one place', text: 'See what is playing, boosted or muted, control any tab from the same popup, or jump straight to it.', shots: ['tabs-dark'] },
];

const storePage = (s) => `<!doctype html><meta charset="utf-8"><base href="${root.href}"><style>
html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; }
body {
  box-sizing: border-box; display: grid; grid-template-columns: 400px 1fr; align-items: center; gap: 40px; padding: 0 72px;
  font-family: "Segoe UI", system-ui, sans-serif; color: #2a2216;
  background: radial-gradient(900px 600px at 10% -10%, #ffe7a0, transparent 70%), radial-gradient(700px 520px at 105% 110%, #f9cf5e, transparent 65%), #fbf7ee;
}
.brand { display: flex; align-items: center; gap: 14px; font-size: 24px; font-weight: 750; }
.brand img { width: 56px; height: 56px; filter: drop-shadow(0 6px 12px rgb(235 167 12 / 0.4)); }
h1 { margin: 30px 0 18px; font-size: 48px; font-weight: 800; line-height: 1.08; letter-spacing: -0.03em; }
p { margin: 0; font-size: 21px; line-height: 1.5; color: #6b604c; }
.shots { display: flex; justify-content: center; align-items: center; gap: 28px; }
.shots img { width: 330px; border-radius: 18px; box-shadow: 0 40px 70px -24px rgb(90 60 0 / 0.4), 0 0 0 1px rgb(90 60 0 / 0.08); }
.shots img:nth-child(2) { translate: 0 36px; }
.shots img:only-child { width: 400px; }
</style>
<div><div class="brand"><img src="icons/icon.svg" alt="">Butter</div><h1>${s.title}</h1><p>${s.text}</p></div>
<div class="shots">${s.shots.map((n) => `<img src="docs/${n}.png" alt="">`).join('')}</div>`;

const work = mkdtempSync(join(tmpdir(), 'butter-shots-'));
mkdirSync(new URL('docs/store/', root), { recursive: true });
const screenshot = (page, out, width, height) =>
  execFileSync(firefox, ['--headless', '--no-remote', '--profile', work, `--window-size=${width},${height}`, '--screenshot', fileURLToPath(new URL(out, root)), pathToFileURL(page).href], { stdio: 'ignore' });

try {
  for (const shot of SHOTS) {
    const page = join(work, `${shot.name}.html`);
    const head = `<head>\n<base href="${root.href}">\n<style>html{zoom:2}*,*::before,*::after{transition:none!important;animation:none!important}</style>\n<script>${mock(shot)}</script>`;
    writeFileSync(page, read('popup.html').replace('<head>', head));
    screenshot(page, `docs/${shot.name}.png`, 360 * 2, HEIGHT * 2);
    console.log(`docs/${shot.name}.png`);
  }
  for (const s of STORE) {
    const page = join(work, `${s.name}.html`);
    writeFileSync(page, storePage(s));
    screenshot(page, `docs/store/${s.name}.png`, 1280, 800);
    console.log(`docs/store/${s.name}.png`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
