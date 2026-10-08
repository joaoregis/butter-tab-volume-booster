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
const BOOSTED = { 'tab:4': { volume: 150, eq: false, preset: 'flat', bands: Array(10).fill(0) } };

const SHOTS = [
  { name: 'volume-light', theme: 'light', lang: 'pt', view: 'volume', state: { volume: 250, eq: true, preset: 'rock', bands: [5, 4, 2, 0, -1, -1, 1, 3, 4, 5] } },
  { name: 'volume-dark', theme: 'dark', lang: 'en', view: 'volume', state: { volume: 450, eq: false, preset: 'flat', bands: Array(10).fill(0) } },
  { name: 'eq-light', theme: 'light', lang: 'es', view: 'eq', state: { volume: 180, eq: true, preset: 'custom', bands: [6, 5, 3, 1, 0, -2, 0, 2, 4, 3] } },
  { name: 'eq-dark', theme: 'dark', lang: 'pt', view: 'eq', state: { volume: 250, eq: true, preset: 'rock', bands: [5, 4, 2, 0, -1, -1, 1, 3, 4, 5] } },
  { name: 'tabs-dark', theme: 'dark', lang: 'pt', view: 'volume', list: true, state: { volume: 250, eq: true, preset: 'rock', bands: [5, 4, 2, 0, -1, -1, 1, 3, 4, 5] } },
];

const mock = (shot) => `
const LOCALES = ${JSON.stringify(locales)};
const TABS = ${JSON.stringify(TABS)};
const STATES = ${JSON.stringify({ ...BOOSTED, 'tab:1': shot.state })};
const clone = (x) => JSON.parse(JSON.stringify(x));
window.browser = {
  i18n: { getMessage: (k) => LOCALES.en[k]?.message ?? '', getUILanguage: () => 'en' },
  storage: {
    local: { get: async () => ({ prefs: ${JSON.stringify({ theme: shot.theme, lang: shot.lang, view: shot.view })} }), set: async () => {} },
    session: { get: async (k) => clone(k ? { [k]: STATES[k] } : STATES), set: async () => {}, remove: async () => {} },
  },
  tabs: {
    query: async (q) => clone(q.active ? TABS.filter((x) => x.active) : TABS),
    sendMessage: async () => true,
    update: async () => {},
    onUpdated: { addListener() {} },
  },
  scripting: { executeScript: async () => {} },
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
