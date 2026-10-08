browser.action.setBadgeBackgroundColor({ color: '#F2B233' });
browser.action.setBadgeTextColor({ color: '#2A1F00' });

// Every frame's content script asks for its tab's settings when it loads.
browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'get' || !sender.tab) return;
  const key = stateKey(sender.tab.id);
  return browser.storage.session.get(key).then((stored) => {
    // Tab badges are cleared on navigation, so the top frame restores it.
    if (sender.frameId === 0) updateBadge(sender.tab.id, stored[key]);
    return stored[key];
  });
});

browser.tabs.onRemoved.addListener((tabId) => browser.storage.session.remove(stateKey(tabId)));
