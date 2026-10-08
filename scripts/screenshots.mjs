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

const work = mkdtempSync(join(tmpdir(), 'butter-shots-'));
mkdirSync(new URL('docs/', root), { recursive: true });

try {
  for (const shot of SHOTS) {
    const page = join(work, `${shot.name}.html`);
    const head = `<head>\n<base href="${root.href}">\n<style>html{zoom:2}*,*::before,*::after{transition:none!important;animation:none!important}</style>\n<script>${mock(shot)}</script>`;
    writeFileSync(page, read('popup.html').replace('<head>', head));
    const out = fileURLToPath(new URL(`docs/${shot.name}.png`, root));
    execFileSync(firefox, ['--headless', '--no-remote', '--profile', work, `--window-size=${360 * 2},${HEIGHT * 2}`, '--screenshot', out, pathToFileURL(page).href], { stdio: 'ignore' });
    console.log(`docs/${shot.name}.png`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
