// Runs content.js against a real (silent) <audio> in headless Firefox via WebDriver BiDi.
// Usage: node scripts/test-audio.mjs   (set FIREFOX if the binary isn't at the default Windows path)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const firefox = process.env.FIREFOX ?? 'C:/Program Files/Mozilla Firefox/firefox.exe';
const PORT = 9339;

// Page side: fake `browser`, spy on Web Audio, then load the real scripts.
const page = `<!doctype html><base href="${root.href}">
<script>
window.browser = { runtime: { onMessage: { addListener: (fn) => (window.deliver = fn) }, sendMessage: async () => undefined } };
const spy = { contexts: [], sources: 0, gains: [] };
const proto = AudioContext.prototype;
const { createMediaElementSource, createGain } = proto;
proto.createMediaElementSource = function (el) { spy.sources++; return createMediaElementSource.call(this, el); };
proto.createGain = function () { const g = createGain.call(this); spy.gains.push(g); return g; };
window.AudioContext = class extends AudioContext { constructor() { super(); spy.contexts.push(this); } };

function toneUrl() { // 1 s, 440 Hz, 16-bit mono WAV
  const rate = 8000, n = rate, v = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin((i / rate) * 2 * Math.PI * 440) * 8000, true);
  return URL.createObjectURL(new Blob([v], { type: 'audio/wav' }));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

window.runTest = async () => {
  const audio = new Audio(toneUrl());
  audio.loop = true;
  audio.muted = true;
  document.body.append(audio);
  await audio.play();
  await wait(200);
  const untouched = spy.contexts.length === 0 && spy.sources === 0;
  deliver({ type: 'apply', state: { volume: 300, eq: true, preset: 'rock', bands: PRESETS.rock } });
  await wait(600);
  return JSON.stringify({ untouched, contexts: spy.contexts.length, ctxState: spy.contexts[0]?.state, sources: spy.sources, boost: spy.gains[1]?.gain.value });
};
</script>
<script src="common.js"></script>
<script src="content.js"></script>
<body></body>`;

const work = mkdtempSync(join(tmpdir(), 'butter-test-'));
writeFileSync(join(work, 'user.js'), ['media.autoplay.default", 0', 'media.autoplay.blocking_policy", 0', 'media.volume_scale", "0.0"'].map((p) => `user_pref("${p});`).join('\n'));
writeFileSync(join(work, 'test.html'), page);

const ff = spawn(firefox, ['--headless', '--no-remote', '--profile', work, `--remote-debugging-port=${PORT}`, 'about:blank']);
try {
  await new Promise((resolve, reject) => {
    ff.stderr.on('data', (d) => String(d).includes('WebDriver BiDi listening') && resolve());
    ff.on('exit', () => reject(new Error('Firefox exited before BiDi was ready')));
  });

  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/session`);
  const pending = new Map();
  let nextId = 0;
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    pending.get(msg.id)?.(msg);
  };
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, (msg) => (msg.type === 'error' ? reject(new Error(`${method}: ${msg.message}`)) : resolve(msg.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
  await new Promise((resolve) => (ws.onopen = resolve));

  await call('session.new', { capabilities: {} });
  const { contexts } = await call('browsingContext.getTree', {});
  const context = contexts[0].context;
  await call('browsingContext.navigate', { context, url: pathToFileURL(join(work, 'test.html')).href, wait: 'complete' });
  const { result, exceptionDetails } = await call('script.evaluate', { expression: 'runTest()', target: { context }, awaitPromise: true });
  assert.ok(!exceptionDetails, exceptionDetails?.text);
  const r = JSON.parse(result.value);

  assert.ok(r.untouched, 'default state must not touch media');
  assert.equal(r.contexts, 1, 'one AudioContext per frame');
  assert.equal(r.ctxState, 'running');
  assert.equal(r.sources, 1, 'playing element routed once');
  assert.ok(Math.abs(r.boost - 3) < 0.05, `boost gain ≈ 3, got ${r.boost}`);
  console.log('OK:', r);
  ws.close();
} finally {
  ff.kill();
  await new Promise((r) => setTimeout(r, 500));
  rmSync(work, { recursive: true, force: true });
}
