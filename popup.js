const MAX = 600;
const $ = (sel) => document.querySelector(sel);

let prefs = { theme: 'auto', lang: 'auto', view: 'volume' };
let dict = null; // messages for an explicitly picked language; null follows the browser
let activeTabId;
let tab; // the tab being controlled (the active one unless picked from the list)
let state;

const t = (key) => (dict ? dict[key]?.message : browser.i18n.getMessage(key)) || key;
const savePrefs = () => browser.storage.local.set({ prefs });

function setLabel(el, text) {
  el.title = text;
  el.setAttribute('aria-label', text);
}

function setFavicon(img, of) {
  img.onerror = () => {
    img.onerror = null;
    img.src = 'icons/icon.svg';
  };
  img.src = of.favIconUrl || 'icons/icon.svg';
}

function hostOf(of) {
  try {
    return new URL(of.url).hostname || of.url;
  } catch {
    return of.url ?? '';
  }
}

function formatDb(volume) {
  if (volume === 0) return '−∞ dB';
  const db = 20 * Math.log10(volume / 100);
  return `${db > 0.05 ? '+' : db < -0.05 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`;
}

// ---------- static UI ----------

const bandInputs = FREQS.map((freq, i) => {
  const band = $('#band-tpl').content.firstElementChild.cloneNode(true);
  const input = band.querySelector('input');
  band.querySelector('.freq').textContent = freq >= 1000 ? `${freq / 1000}k` : freq;
  input.setAttribute('aria-label', `${freq} Hz`);
  input.addEventListener('input', () => setBand(i, +input.value));
  input.addEventListener('dblclick', () => setBand(i, 0));
  $('#bands').append(band);
  return input;
});

for (const id of [...Object.keys(PRESETS), 'custom']) {
  const option = new Option('', id);
  option.dataset.i18n = `preset_${id}`;
  option.hidden = id === 'custom';
  $('#preset').append(option);
}

// Response curve: the same filters as the content script, evaluated offline.
const CURVE_N = 120;
// Bands are octaves, so evenly spaced columns form a log axis: column i is centred on FREQS[i].
const curveFreqs = Float32Array.from({ length: CURVE_N }, (_, j) => 32 * 2 ** ((j / (CURVE_N - 1)) * 10 - 0.5));
const curveFilters = createEqFilters(new OfflineAudioContext(1, 1, 48000));

function drawCurve() {
  const db = new Float32Array(CURVE_N);
  const mag = new Float32Array(CURVE_N);
  const phase = new Float32Array(CURVE_N);
  curveFilters.forEach((filter, i) => {
    filter.gain.value = state.bands[i];
    filter.getFrequencyResponse(curveFreqs, mag, phase);
    mag.forEach((m, j) => (db[j] += 20 * Math.log10(m)));
  });
  const y = (d) => (50 - (Math.max(-12, Math.min(12, d)) * 50) / 12).toFixed(2);
  const points = Array.from(db, (d, j) => `${((j / (CURVE_N - 1)) * 100).toFixed(2)} ${y(d)}`).join('L');
  $('#curve-line').setAttribute('d', `M${points}`);
  $('#curve-fill').setAttribute('d', `M0 50L${points}L100 50Z`);
}

// ---------- rendering ----------

function render() {
  if (!state) return;
  const { volume, eq, bands, preset } = state;
  const muted = !!tab.mutedInfo?.muted;

  $('#tab-title').textContent = tab.title || tab.url;
  $('#tab-host').textContent = hostOf(tab);
  setFavicon($('#tab-icon'), tab);
  const mute = $('#mute');
  mute.setAttribute('aria-pressed', muted);
  mute.querySelector('use').setAttribute('href', muted ? '#i-muted' : '#i-speaker');
  setLabel(mute, muted ? t('unmute') : t('mute'));

  document.documentElement.style.setProperty('--heat', Math.max(0, volume - 100) / (MAX - 100));
  $('#panel-volume').classList.toggle('muted', muted);
  $('#vol-num').textContent = volume;
  $('#vol-sub').textContent = muted ? t('muted') : formatDb(volume);
  $('#arc').style.strokeDasharray = `${(volume / MAX) * 100} 100`;
  const slider = $('#volume');
  slider.value = volume;
  slider.style.setProperty('--p', `${(volume / MAX) * 100}%`);
  for (const chip of document.querySelectorAll('.chip')) chip.setAttribute('aria-pressed', +chip.dataset.v === volume);
  $('#warn').hidden = volume <= 300 || muted;
  $('#seg-volume').textContent = `${volume}%`;

  $('#eq-on').checked = eq;
  $('#panel-eq').classList.toggle('off', !eq);
  $('#seg-eq').hidden = !eq;
  $('#preset').value = preset;
  bandInputs.forEach((input, i) => {
    const gain = bands[i];
    const p = ((gain + 12) / 24) * 100;
    input.value = gain;
    input.style.setProperty('--lo', `${Math.min(p, 50)}%`);
    input.style.setProperty('--hi', `${Math.max(p, 50)}%`);
    const out = input.previousElementSibling;
    out.textContent = gain > 0 ? `+${gain}` : String(gain).replace('-', '−');
    out.classList.toggle('on', gain !== 0);
  });
  drawCurve();
}

async function renderTabList() {
  const [tabs, stored] = await Promise.all([browser.tabs.query({}), browser.storage.session.get()]);
  const relevant = tabs.filter(
    (x) => x.id === tab.id || x.id === activeTabId || x.audible || x.mutedInfo?.muted || isActive(stored[stateKey(x.id)]),
  );
  $('#target').disabled = relevant.length < 2;
  if (relevant.length < 2) toggleList(false);
  $('#tab-list').replaceChildren(...relevant.map((x) => tabRow(x, x.id === tab.id ? state : stored[stateKey(x.id)])));
}

function tabRow(x, s) {
  const row = $('#row-tpl').content.firstElementChild.cloneNode(true);
  row.setAttribute('aria-current', x.id === tab.id);
  setFavicon(row.querySelector('.favicon'), x);
  row.querySelector('.row-title').textContent = x.title || x.url;
  row.querySelector('.playing').hidden = !x.audible;
  row.querySelector('.row-muted').toggleAttribute('hidden', !x.mutedInfo?.muted); // SVG has no .hidden
  const badge = row.querySelector('.badge');
  badge.hidden = !isActive(s);
  if (isActive(s)) badge.textContent = s.volume !== 100 ? `${s.volume}%` : 'EQ';
  row.querySelector('.row-main').addEventListener('click', () => {
    toggleList(false);
    selectTab(x);
  });
  const go = row.querySelector('.row-go');
  setLabel(go, t('goToTab'));
  go.addEventListener('click', async () => {
    await browser.tabs.update(x.id, { active: true });
    await browser.windows.update(x.windowId, { focused: true });
    window.close();
  });
  return row;
}

function toggleList(open = $('#tab-list').hidden) {
  $('#tab-list').hidden = !open;
  $('#target').setAttribute('aria-expanded', open);
}

function showView(view) {
  prefs.view = view;
  for (const v of ['volume', 'eq']) {
    $(`#tab-${v}`).setAttribute('aria-selected', v === view);
    $(`#panel-${v}`).hidden = v !== view;
  }
}

function applyTheme() {
  document.documentElement.dataset.theme = prefs.theme;
  for (const b of $('#themes').children) b.setAttribute('aria-pressed', b.dataset.mode === prefs.theme);
}

async function applyLang() {
  dict = prefs.lang === 'auto' ? null : await (await fetch(`_locales/${prefs.lang}/messages.json`)).json();
  document.documentElement.lang = prefs.lang === 'auto' ? browser.i18n.getUILanguage() : prefs.lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-label]')) setLabel(el, t(el.dataset.i18nLabel));
  $('#lang').value = prefs.lang;
}

// ---------- state ----------

function commit() {
  render();
  browser.storage.session.set({ [stateKey(tab.id)]: state });
  browser.tabs.sendMessage(tab.id, { type: 'apply', state }).catch(() => {});
  updateBadge(tab.id, state);
  if (!$('#tab-list').hidden) renderTabList();
}

function setVolume(volume) {
  state.volume = Math.max(0, Math.min(MAX, Math.round(volume)));
  commit();
}

function setBand(i, gain) {
  state.bands[i] = gain;
  state.preset = Object.keys(PRESETS).find((id) => PRESETS[id].every((g, j) => g === state.bands[j])) ?? 'custom';
  state.eq = true;
  commit();
}

async function ensureContentScript(tabId) {
  try {
    if (await browser.tabs.sendMessage(tabId, { type: 'ping' })) return true;
  } catch {}
  try {
    // Tabs opened before the extension was installed have no content script yet.
    await browser.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['common.js', 'content.js'] });
    return true;
  } catch {
    return false; // about: pages, addons.mozilla.org, reader view… are off-limits to extensions
  }
}

async function selectTab(next) {
  tab = next;
  const key = stateKey(tab.id);
  state = (await browser.storage.session.get(key))[key] ?? defaultState();
  const ok = await ensureContentScript(tab.id);
  // MV3 lets users revoke site access in about:addons; offer to re-grant instead of "unsupported".
  const access = ok || (await browser.permissions.contains({ origins: ['<all_urls>'] }));
  $('#controls').disabled = !ok;
  $('#unsupported').hidden = ok || !access;
  $('#no-access').hidden = access;
  render();
  await renderTabList();
}

// ---------- events ----------

$('#target').addEventListener('click', () => toggleList());
document.addEventListener('click', (e) => e.target.closest('.target-wrap') || toggleList(false));
$('#grant').addEventListener('click', async () => {
  if (await browser.permissions.request({ origins: ['<all_urls>'] })) selectTab(tab);
});
$('#mute').addEventListener('click', () => browser.tabs.update(tab.id, { muted: !tab.mutedInfo?.muted }));
$('#reset').addEventListener('click', () => {
  state = defaultState();
  commit();
});

$('#tab-volume').addEventListener('click', () => (showView('volume'), savePrefs()));
$('#tab-eq').addEventListener('click', () => (showView('eq'), savePrefs()));

$('#volume').addEventListener('input', (e) => setVolume(+e.target.value));
$('#chips').addEventListener('click', (e) => e.target.dataset.v && setVolume(+e.target.dataset.v));
$('.gauge').addEventListener(
  'wheel',
  (e) => {
    if ($('#controls').disabled) return;
    e.preventDefault();
    setVolume(state.volume + (e.deltaY < 0 ? 10 : -10));
  },
  { passive: false },
);

$('#eq-on').addEventListener('change', (e) => {
  state.eq = e.target.checked;
  commit();
});
$('#preset').addEventListener('change', (e) => {
  state.preset = e.target.value;
  state.bands = [...PRESETS[state.preset]];
  state.eq = true;
  commit();
});

$('#lang').addEventListener('change', async (e) => {
  prefs.lang = e.target.value;
  savePrefs();
  await applyLang();
  render();
  renderTabList();
});
$('#themes').addEventListener('click', (e) => {
  const mode = e.target.closest('[data-mode]')?.dataset.mode;
  if (!mode) return;
  prefs.theme = mode;
  savePrefs();
  applyTheme();
});

browser.tabs.onUpdated.addListener(
  (id, _change, updated) => {
    if (!tab) return;
    if (id === tab.id) {
      tab = updated;
      render();
    }
    renderTabList();
  },
  { properties: ['audible', 'mutedInfo', 'title', 'favIconUrl'] },
);

(async () => {
  Object.assign(prefs, (await browser.storage.local.get('prefs')).prefs);
  applyTheme();
  showView(prefs.view);
  await applyLang();
  const [active] = await browser.tabs.query({ active: true, currentWindow: true });
  activeTabId = active.id;
  await selectTab(active);
})();
