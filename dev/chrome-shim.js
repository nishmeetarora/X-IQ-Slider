// Dev-only stand-in for the chrome.* APIs the content script uses, with a fake background that scores by keywords.
// Lets dev/mock-x.html run the real content scripts in a normal browser tab.
(function () {
  'use strict';
  const store = {};
  // ?mood=nonsense presets the mood; ?seed adds a demo key and usage numbers (for store screenshots).
  const params = new URLSearchParams(location.search);
  if (params.get('mood')) store['xiq:settings'] = { v: 2, mood: params.get('mood') };
  if (params.has('seed')) {
    store['xiq:llm'] = { provider: 'openrouter', keys: { openrouter: 'sk-or-v1-demo-key-for-screenshots' }, models: { openrouter: 'deepseek/deepseek-v4.1-flash' }, aboutMe: 'Software engineer into AI, startups and philosophy. Crypto shilling and hustle posts are noise to me.' };
    store['xiq:stats'] = { day: new Date().toLocaleDateString('en-CA'), calls: 41, tweets: 812, tokensIn: 172000, tokensOut: 41000, tokensCached: 61000, cost: 0.0312 };
  }
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
    if (/rct|diabetes|resistance training/.test(text)) return { t: 'health', s: 8, b: 0, f: 0, w: 'concrete trial result with numbers' };
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
          // Screenshot mode shows a realistic status line; otherwise make it obvious the scores are fake.
          const status = params.has('seed')
            ? { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash', error: null, tokensToday: 213000, costToday: 0.0312, at: Date.now() }
            : { provider: 'opencode-go', model: 'deepseek-v4.1-flash (fake)', error: null, tokensToday: 4200, at: Date.now() };
          storage.local.set({ 'xiq:status': status });
        }, 700);
      }
      if (msg.type === 'test') {
        // Canned connection-test result for the settings preview (same four samples the real worker sends).
        res = {
          ok: true,
          ms: 1840,
          model: 'deepseek/deepseek-v4.1-flash',
          usage: { total: 1630, cost: 0.00041 },
          samples: [
            { text: 'Postgres tip: a partial index on (user_id) WHERE deleted_at IS NULL cut our p95 from 180ms to 9ms, because the planner no longer touches soft-deleted rows at all.', score: { t: 'tech', s: 8, b: 0, f: 0, w: 'specific measured database result' } },
            { text: "Women today can't even cook a basic meal. Men, would you still date a woman who can't make a sandwich? Be honest 👇", score: { t: 'culture_war', s: 1, b: 9, f: 0, w: 'gender war engagement bait' } },
            { text: 'my cat knocked my coffee off the desk, made direct eye contact, and then did the exact same thing with the spoon', score: { t: 'humor', s: 1, b: 0, f: 8, w: 'relatable absurd cat moment' } },
            { text: "You don't choose what you notice first, but you do choose what you keep looking at. Over a lifetime, that second glance is most of who you become.", score: { t: 'philosophy', s: 8, b: 0, f: 1, w: 'original reframe of attention' } },
          ],
        };
      }
      const delay = msg.type === 'test' ? 300 : 0;
      setTimeout(() => cb && cb(res), delay);
      if (!cb) return new Promise((r) => setTimeout(() => r(res), delay));
    },
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
  };

  window.chrome = { storage, runtime };
})();
