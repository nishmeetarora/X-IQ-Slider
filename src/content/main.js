// Content-script entry point: loads settings, wires the API hook, feed filter, sidebar and widget together.
(function () {
  'use strict';
  const XIQ = globalThis.XIQ;
  const { STORAGE } = XIQ;

  let settings = XIQ.mergeSettings(null);
  let status = {};
  let lastLocalUpdate = 0;
  let saveTimer = null;
  let ready = false;
  const early = []; // timeline payloads that arrive before settings load

  function contextAlive() {
    try {
      return !!chrome.runtime?.id;
    } catch (_) {
      return false;
    }
  }

  function send(msg) {
    return new Promise((resolve, reject) => {
      if (!contextAlive()) return reject(new Error('Extension was reloaded; refresh the page'));
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(res);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  // Messages to the page hook (src/page/hook.js), which runs in the page's own JS world.
  function toPage(msg) {
    window.postMessage(Object.assign({ __xiq: msg.type }, msg), window.location.origin);
  }

  // Tells the hook it can hold timeline responses for us, and whether there is anything to filter out of them.
  function announce() {
    toPage({ type: 'ready', gate: !!(settings.enabled || settings.hideAds || settings.hideSuggestions) });
  }

  function update(patch) {
    settings = Object.assign({}, settings, patch);
    lastLocalUpdate = Date.now();
    announce();
    feed.onSettingsChanged(Object.keys(patch).some((k) => k !== 'widgetCollapsed'));
    widget.render();
    sidebar.ensure();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (contextAlive()) chrome.storage.local.set({ [STORAGE.settings]: settings });
    }, 300);
  }

  const chips = XIQ.createChips({
    getSettings: () => settings,
    setTopic: (key, pref) => update({ topics: Object.assign({}, settings.topics, { [key]: pref }) }),
    hideAgain: (id) => feed.hideAgain(id),
  });

  const feed = XIQ.createFeed({
    getSettings: () => settings,
    send,
    chips,
    onStats: () => widget && widget.renderStats(),
  });

  const widget = XIQ.createWidget({
    getSettings: () => settings,
    update,
    getStats: () => feed.stats(),
    getStatus: () => status,
    openSettings: () => send({ type: 'openOptions' }).catch(() => {}),
  });

  const sidebar = XIQ.createSidebar({ widget, getSettings: () => settings });

  // Timeline API responses from the page-world hook: copies ('timeline') and held responses ('gate').
  // The page can post these too, so every field is checked; a bad one just gets the response passed through.
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d || typeof d.__xiq !== 'string') return;
    if (typeof d.text !== 'string' || typeof d.op !== 'string') return;
    if (d.__xiq === 'timeline') {
      if (!ready) {
        if (early.length < 20) early.push(d);
      } else feed.onTimeline(d.op, d.text);
    } else if (d.__xiq === 'gate' && typeof d.rid === 'string') {
      const reply = (r) =>
        toPage({ type: 'gateReply', rid: d.rid, text: r && typeof r.text === 'string' ? r.text : null, seen: (r && r.seen) || [] });
      // After an extension reload this script is orphaned: answer at once so X never waits on it.
      if (!ready || !contextAlive()) return reply(null);
      const cursor = typeof d.cursor === 'string' ? d.cursor : null;
      feed.onGate(d.op, typeof d.url === 'string' ? d.url : '', d.text, cursor).then(reply, () => reply(null));
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'scores') feed.applyScores(msg.scores || {});
    else if (msg.type === 'scoreError') feed.markFailed(msg.ids || [], msg.error);
  });

  // Click a collapsed post to show it. Capture phase on window runs before X's own handlers.
  window.addEventListener(
    'click',
    (e) => {
      const article = e.target && e.target.closest ? e.target.closest('article[data-xiq-state="collapsed"]') : null;
      if (!article) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const id = XIQ.dom.tweetIdOf(article);
      if (id) feed.reveal(id);
    },
    true
  );

  // Theme variables live in a <style> we own. (X's 2026 app rewrites <html style>, which wiped them when they
  // were set there, so chips fell back to dark colors on a light page.) Re-added if X ever removes it.
  const THEME_KEYS = ['bg', 'fg', 'muted', 'border', 'raised', 'hover', 'track', 'danger', 'shadow'];
  const themeStyle = document.createElement('style');
  themeStyle.id = 'xiq-theme';
  let lastTheme = '';
  let lastThemeCheck = 0;
  function applyTheme(force) {
    const now = Date.now();
    if (!force && now - lastThemeCheck < 1500) return;
    lastThemeCheck = now;
    if (!document.body) return;
    const theme = XIQ.dom.readTheme();
    if (!themeStyle.isConnected) (document.head || document.documentElement).appendChild(themeStyle);
    if (theme.bg === lastTheme) return;
    lastTheme = theme.bg;
    themeStyle.textContent = `html:root { ${THEME_KEYS.map((k) => `--xiq-${k}: ${theme[k]};`).join(' ')} }`;
    widget.setTheme(theme);
  }

  // Feed work runs right away, before the browser paints newly mounted posts. Sidebar, theme and stats
  // upkeep can wait, so it runs at most every 150 ms instead of on every DOM change while scrolling.
  let observer = null;
  let sideTimer = null;
  function sideWork() {
    sideTimer = null;
    sidebar.ensure();
    applyTheme(false);
    widget.renderStats();
  }
  function onMutations() {
    if (!contextAlive()) {
      observer && observer.disconnect();
      return;
    }
    feed.processAll();
    if (!sideTimer) sideTimer = setTimeout(sideWork, 150);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[STORAGE.settings] && Date.now() - lastLocalUpdate > 1500) {
      settings = XIQ.mergeSettings(changes[STORAGE.settings].newValue);
      announce();
      feed.onSettingsChanged();
      widget.render();
      sidebar.ensure();
    }
    if (changes[STORAGE.status]) {
      status = changes[STORAGE.status].newValue || {};
      widget.renderStats();
    }
    if (changes[STORAGE.llm]) {
      feed.onLlmChanged();
      widget.renderStats();
    }
  });

  chrome.storage.local.get([STORAGE.settings, STORAGE.status]).then((got) => {
    settings = XIQ.mergeSettings(got[STORAGE.settings]);
    status = got[STORAGE.status] || {};
    ready = true;
    announce();
    for (const m of early.splice(0)) feed.onTimeline(m.op, m.text);
    widget.render();
    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const start = () => {
      applyTheme(true);
      onMutations();
      sideWork();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  });
})();
