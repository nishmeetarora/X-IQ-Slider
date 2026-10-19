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

  function update(patch) {
    settings = Object.assign({}, settings, patch);
    lastLocalUpdate = Date.now();
    feed.onSettingsChanged();
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

  // Timeline API responses copied by the page-world hook.
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__xiq !== 'timeline') return;
    if (typeof e.data.text !== 'string' || typeof e.data.op !== 'string') return;
    if (!ready) early.push(e.data);
    else feed.onTimeline(e.data.op, e.data.text);
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

  let lastTheme = '';
  let lastThemeCheck = 0;
  function applyTheme(force) {
    const now = Date.now();
    if (!force && now - lastThemeCheck < 1500) return;
    lastThemeCheck = now;
    if (!document.body) return;
    const theme = XIQ.dom.readTheme();
    const sig = theme.bg;
    if (sig === lastTheme) return;
    lastTheme = sig;
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--xiq-bg', theme.bg);
    rootStyle.setProperty('--xiq-fg', theme.fg);
    rootStyle.setProperty('--xiq-muted', theme.muted);
    rootStyle.setProperty('--xiq-border', theme.border);
    rootStyle.setProperty('--xiq-raised', theme.raised);
    rootStyle.setProperty('--xiq-shadow', theme.shadow);
    rootStyle.setProperty('--xiq-track', theme.track);
    widget.setTheme(theme);
  }

  let observer = null;
  function onMutations() {
    if (!contextAlive()) {
      observer && observer.disconnect();
      return;
    }
    feed.processAll();
    sidebar.ensure();
    applyTheme(false);
    widget.renderStats();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[STORAGE.settings] && Date.now() - lastLocalUpdate > 1500) {
      settings = XIQ.mergeSettings(changes[STORAGE.settings].newValue);
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
    for (const m of early.splice(0)) feed.onTimeline(m.op, m.text);
    widget.render();
    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const start = () => {
      applyTheme(true);
      onMutations();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  });
})();
