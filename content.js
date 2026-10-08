(() => {
  // The popup may inject us into tabs that were open before install.
  if (window.__butterVolume) return;
  window.__butterVolume = true;

  let settings = defaultTab(); // this tab's { volume, eq? }
  let globalEq = defaultEq();
  let ctx, input, gain;
  let filters = [];
  const routed = new WeakSet();

  // Routing an element through Web Audio is permanent, and Firefox outputs silence for
  // DRM media and for cross-origin media without CORS, so those are left untouched.
  function canRoute(el) {
    if (el.mediaKeys) return false;
    const src = el.currentSrc;
    if (!src || /^(blob|data):/.test(src)) return true;
    return el.crossOrigin !== null || new URL(src).origin === location.origin;
  }

  function buildGraph() {
    if (ctx) return;
    ctx = new AudioContext();
    input = ctx.createGain();
    filters = createEqFilters(ctx);
    gain = ctx.createGain();
    // Limiter: big boosts get louder instead of clipping.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.2;
    [input, ...filters, gain, limiter, ctx.destination].reduce((a, b) => a.connect(b));
  }

  async function route(el) {
    if (routed.has(el) || !canRoute(el)) return;
    buildGraph();
    await ctx.resume().catch(() => {});
    // Still suspended (autoplay policy): routing now would mute the element. Retry on next play.
    if (ctx.state !== 'running' || routed.has(el)) return;
    routed.add(el);
    try {
      ctx.createMediaElementSource(el).connect(input);
    } catch {
      // Element already belongs to the page's own Web Audio graph.
    }
  }

  // A tab's own EQ wins over the global one.
  const currentEq = () => settings.eq ?? globalEq;
  // Media is only touched once the user changed something that affects this tab.
  const wanted = () => settings.volume !== 100 || eqActive(currentEq());

  function apply() {
    if (!ctx && !wanted()) return;
    buildGraph();
    const t = ctx.currentTime;
    const eq = currentEq();
    gain.gain.setTargetAtTime(settings.volume / 100, t, 0.03);
    filters.forEach((f, i) => f.gain.setTargetAtTime(eq.enabled ? eq.bands[i] : 0, t, 0.03));
    for (const el of document.querySelectorAll('audio, video')) if (!el.paused) route(el);
  }

  document.addEventListener('play', (e) => wanted() && route(e.target), true);

  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'apply') {
      settings = msg.settings;
      apply();
    }
    if (msg?.type === 'ping') return Promise.resolve(true);
  });

  // Every tab follows edits to the global EQ made in the popup.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.eq) return;
    globalEq = changes.eq.newValue ?? defaultEq();
    apply();
  });

  Promise.all([browser.runtime.sendMessage({ type: 'get' }), browser.storage.local.get('eq')]).then(([s, stored]) => {
    settings = s ?? defaultTab();
    globalEq = stored.eq ?? defaultEq();
    apply();
  }, () => {});
})();
