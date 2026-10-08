// Shared by background.js, content.js and popup.js (plain scripts, no modules).

const FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

const PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
  bassCut: [-7, -6, -4, -2, -1, 0, 0, 0, 0, 0],
  vocal: [-3, -3, -2, 1, 4, 5, 4, 2, 0, -1],
  treble: [0, 0, 0, 0, 0, 1, 3, 5, 6, 7],
  rock: [5, 4, 2, 0, -1, -1, 1, 3, 4, 5],
  pop: [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2],
  electronic: [6, 5, 2, 0, -2, 1, 0, 2, 4, 5],
  jazz: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
  classical: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
};

// Per-tab settings, kept in storage.session under stateKey(tabId).
const defaultState = () => ({ volume: 100, eq: false, preset: 'flat', bands: [...PRESETS.flat] });
const stateKey = (tabId) => `tab:${tabId}`;
const isActive = (s) => !!s && (s.volume !== 100 || (s.eq && s.bands.some(Boolean)));

// One filter bank definition for both the real audio graph and the popup's response curve.
function createEqFilters(ctx) {
  return FREQS.map((freq, i) => {
    const filter = ctx.createBiquadFilter();
    filter.type = i === 0 ? 'lowshelf' : i === FREQS.length - 1 ? 'highshelf' : 'peaking';
    filter.frequency.value = freq;
    filter.Q.value = 1.4;
    return filter;
  });
}

function updateBadge(tabId, s) {
  const text = !isActive(s) ? '' : s.volume !== 100 ? String(s.volume) : 'EQ';
  return browser.action.setBadgeText({ tabId, text });
}
