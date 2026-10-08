// Dependency-free sanity check: node scripts/check.mjs
// JS syntax, manifest JSON, and every i18n key used exists in every locale.
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const problems = [];

for (const file of ['common.js', 'background.js', 'content.js', 'popup.js']) {
  try {
    new vm.Script(read(file), { filename: file });
  } catch (e) {
    problems.push(`${file}: ${e.message}`);
  }
}
JSON.parse(read('manifest.json'));

const { PRESETS } = vm.runInNewContext(`${read('common.js')};({ PRESETS })`);
const used = new Set([
  ...[...read('popup.html').matchAll(/data-i18n(?:-label)?="(\w+)"/g)].map((m) => m[1]),
  ...[...read('popup.js').matchAll(/\bt\('(\w+)'\)/g)].map((m) => m[1]),
  ...[...read('manifest.json').matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]),
  ...[...Object.keys(PRESETS), 'custom'].map((id) => `preset_${id}`),
]);

const locales = readdirSync(new URL('../_locales/', import.meta.url));
const keysOf = (l) => new Set(Object.keys(JSON.parse(read(`_locales/${l}/messages.json`))));
const en = keysOf('en');
for (const key of used) if (!en.has(key)) problems.push(`en: missing "${key}"`);
for (const l of locales) {
  const keys = keysOf(l);
  for (const key of en) if (!keys.has(key)) problems.push(`${l}: missing "${key}"`);
  for (const key of keys) if (!en.has(key)) problems.push(`${l}: extra "${key}"`);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`OK: ${locales.length} locales × ${en.size} keys, ${used.size} keys used`);
