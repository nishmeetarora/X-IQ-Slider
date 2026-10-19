// Dev-only stand-in for the chrome.* APIs the content script uses, with a fake background that scores by keywords.
// Lets dev/mock-x.html run the real content scripts in a normal browser tab.
(function () {
  'use strict';
  const store = {};
  const changeListeners = [];
  const messageListeners = [];
  const log = (window.__xiqLog = []);

  function emitChange(changes) {
    for (const fn of changeListeners) fn(changes, 'local');
  }

  const storage = {
    local: {
      async get(keys) {
        if (keys == null) return JSON.parse(JSON.stringify(store));
        const list = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of list) if (k in store) out[k] = JSON.parse(JSON.stringify(store[k]));
        return out;
      },
      async set(items) {
        const changes = {};
        for (const k in items) {
          changes[k] = { oldValue: store[k], newValue: items[k] };
          store[k] = JSON.parse(JSON.stringify(items[k]));
        }
        emitChange(changes);
      },
      async remove(keys) {
        for (const k of [].concat(keys)) delete store[k];
      },
    },
    onChanged: { addListener: (fn) => changeListeners.push(fn) },
  };

  // Keyword "model" so the UI can be exercised without an API key.
  function fakeScore(t) {
    const text = (t.text + ' ' + (t.quote ? t.quote.text : '')).toLowerCase();
    if (/women|men |feminis|gender/.test(text)) return { t: 'culture_war', s: 1, b: 9, f: 0, w: 'gender war engagement bait' };
    if (/rct|diabetes|resistance training|sleep/.test(text)) return { t: 'health', s: 8, b: 0, f: 0, w: 'concrete trial result with numbers' };
    if (/senate|election|budget bill/.test(text)) return { t: 'politics', s: 5, b: 2, f: 0, w: 'budget bill explainer' };
    if (/entropy|universe|arrow of time/.test(text)) return { t: 'science', s: 9, b: 0, f: 1, w: 'dense physics explainer thread' };
    if (/ranked match|gaming/.test(text)) return { t: 'gaming', s: 1, b: 0, f: 7, w: 'relatable gamer joke' };
    if (/celebrity|drama|feud|kardashian/.test(text)) return { t: 'celebrity', s: 1, b: 6, f: 1, w: 'celebrity gossip' };
    if (/cat |lol|meme/.test(text)) return { t: 'humor', s: 1, b: 0, f: 8, w: 'cute absurd cat joke' };
    if (/llm|model|ai |gpt|claude/.test(text)) return { t: 'ai', s: 7, b: 1, f: 0, w: 'concrete claim about LLM training' };
    if (/postgres|index|latency|kernel|rust/.test(text)) return { t: 'tech', s: 8, b: 0, f: 0, w: 'specific measured engineering result' };
    if (/grind|let's go|excuses/.test(text)) return { t: 'selfhelp', s: 2, b: 6, f: 1, w: 'hustle motivation bait' };
    if (/stoic|plato|kant|philosoph/.test(text)) return { t: 'philosophy', s: 7, b: 0, f: 1, w: 'thoughtful idea' };
    return { t: 'other', s: 4, b: 2, f: 2, w: 'generic post' };
  }

  function dispatch(msg) {
    for (const fn of messageListeners) fn(msg, {}, () => {});
  }

  const runtime = {
    id: 'dev-shim',
    lastError: null,
    sendMessage(msg, cb) {
      log.push(msg);
      let res;
      if (msg.type === 'score') {
        res = { hits: {} };
        const tweets = msg.tweets;
        setTimeout(() => {
          const scores = {};
          for (const t of tweets) scores[t.id] = fakeScore(t);
          dispatch({ type: 'scores', scores });
          storage.local.set({ 'xiq:status': { provider: 'opencode-go', model: 'deepseek-v4.1-flash (fake)', error: null, tokensToday: 4200, at: Date.now() } });
        }, 700);
      }
      setTimeout(() => cb && cb(res), 0);
    },
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
  };

  window.chrome = { storage, runtime };
})();
