// Background worker: batches tweets from open X tabs, scores them with the chosen model, caches and returns the scores.
importScripts('../shared/core.js', 'prompt.js', 'cache.js', 'providers.js');

const { STORAGE } = XIQ;

// Bigger batches mean fewer calls, so the fixed system prompt is paid for less often.
// A feed page (~20-35 posts) arrives at once and gets split into even batches of at most MAX_BATCH.
const MAX_BATCH = 24;
const BATCH_DELAY_MS = 500;
const MAX_IN_FLIGHT = 3;
const MAX_ATTEMPTS = 2;

const queue = []; // tweets waiting for a batch
const waiting = new Map(); // tweet id -> Set of tab ids that want its score
const attempts = new Map(); // tweet id -> how many batches it has been in
let inFlight = 0;
let timer = null;

async function getLlm() {
  const got = await chrome.storage.local.get(STORAGE.llm);
  return XIQ.mergeLlm(got[STORAGE.llm]);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'score') {
    handleScore(msg.tweets || [], sender.tab && sender.tab.id).then(sendResponse, (e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'openOptions') {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (msg.type === 'test') {
    testConnection(XIQ.mergeLlm(msg.llm)).then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === 'clearCache') {
    XIQ.cache.clear().then((cleared) => sendResponse({ cleared }));
    return true;
  }
  if (msg.type === 'cacheCount') {
    XIQ.cache.count().then((count) => sendResponse({ count }));
    return true;
  }
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onInstalled.addListener((details) => {
  XIQ.cache.prune();
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(() => XIQ.cache.prune());

async function handleScore(tweets, tabId) {
  tweets = tweets.filter((t) => t && typeof t.id === 'string');
  const llm = await getLlm();
  const sig = XIQ.scoreSignature(llm);
  const hits = await XIQ.cache.getMany(
    tweets.map((t) => t.id),
    sig
  );
  if (!llm.keys[llm.provider]) return { hits, error: 'no_key' };
  for (const t of tweets) {
    if (hits[t.id]) continue;
    let tabs = waiting.get(t.id);
    if (!tabs) {
      tabs = new Set();
      waiting.set(t.id, tabs);
      queue.push(t);
    }
    if (tabId != null) tabs.add(tabId);
  }
  pump();
  return { hits };
}

// Splits the queue into even batches: 30 waiting -> 15 + 15, not 24 + 6.
function nextBatch() {
  const chunks = Math.ceil(queue.length / MAX_BATCH);
  return queue.splice(0, Math.ceil(queue.length / chunks));
}

function flush() {
  while (queue.length && inFlight < MAX_IN_FLIGHT) runBatch(nextBatch());
}

function pump() {
  if (queue.length >= MAX_BATCH) flush();
  if (queue.length && inFlight < MAX_IN_FLIGHT && !timer) {
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, BATCH_DELAY_MS);
  }
}

function groupByTab(ids) {
  const byTab = new Map();
  for (const id of ids) {
    for (const tab of waiting.get(id) || []) {
      if (!byTab.has(tab)) byTab.set(tab, []);
      byTab.get(tab).push(id);
    }
  }
  return byTab;
}

function deliver(scores) {
  const ids = Object.keys(scores);
  for (const [tab, tabIds] of groupByTab(ids)) {
    const subset = {};
    for (const id of tabIds) subset[id] = scores[id];
    chrome.tabs.sendMessage(tab, { type: 'scores', scores: subset }).catch(() => {});
  }
  for (const id of ids) {
    waiting.delete(id);
    attempts.delete(id);
  }
}

function fail(ids, error) {
  for (const [tab, tabIds] of groupByTab(ids)) {
    chrome.tabs.sendMessage(tab, { type: 'scoreError', ids: tabIds, error }).catch(() => {});
  }
  for (const id of ids) {
    waiting.delete(id);
    attempts.delete(id);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runBatch(tweets) {
  inFlight++;
  let llm = null;
  try {
    llm = await getLlm();
    const sig = XIQ.scoreSignature(llm);
    for (const t of tweets) attempts.set(t.id, (attempts.get(t.id) || 0) + 1);
    let result;
    try {
      result = await XIQ.providers.scoreBatch(llm, tweets);
    } catch (e) {
      if (!e.retryable) throw e;
      await sleep(e.status === 429 ? 4000 : 1500);
      result = await XIQ.providers.scoreBatch(llm, tweets);
    }
    await XIQ.cache.setMany(result.scores, sig);
    deliver(result.scores);
    // The model occasionally skips an entry; give those one more try in a later batch.
    const missing = tweets.filter((t) => !result.scores[t.id]);
    const retry = missing.filter((t) => (attempts.get(t.id) || 0) < MAX_ATTEMPTS);
    const giveUp = missing.filter((t) => (attempts.get(t.id) || 0) >= MAX_ATTEMPTS);
    queue.push(...retry);
    if (giveUp.length) fail(giveUp.map((t) => t.id), null);
    await recordUsage(llm, result, tweets.length - missing.length, null);
  } catch (e) {
    fail(
      tweets.map((t) => t.id),
      e.message
    );
    await recordUsage(llm, null, 0, e.message);
  } finally {
    inFlight--;
    pump();
  }
}

let statsLock = Promise.resolve();
function recordUsage(llm, result, scored, error) {
  statsLock = statsLock.then(async () => {
    const today = new Date().toLocaleDateString('en-CA');
    const got = await chrome.storage.local.get([STORAGE.stats, STORAGE.status]);
    let stats = got[STORAGE.stats];
    if (!stats || stats.day !== today) stats = { day: today, calls: 0, tweets: 0, tokensIn: 0, tokensOut: 0, tokensCached: 0, cost: 0 };
    if (result) {
      stats.calls++;
      stats.tweets += scored;
      stats.tokensIn += result.usage?.input || 0;
      stats.tokensOut += result.usage?.output || 0;
      stats.tokensCached = (stats.tokensCached || 0) + (result.usage?.cached || 0);
      stats.cost += result.usage?.cost || 0;
    }
    const prev = got[STORAGE.status] || {};
    const status = {
      provider: llm ? llm.provider : prev.provider,
      model: result ? result.model : prev.model || (llm ? llm.models[llm.provider] : ''),
      error: error || null,
      tokensToday: stats.tokensIn + stats.tokensOut,
      costToday: stats.cost,
      at: Date.now(),
    };
    await chrome.storage.local.set({ [STORAGE.stats]: stats, [STORAGE.status]: status });
  });
  return statsLock.catch(() => {});
}

const SAMPLES = [
  {
    id: 'sample-1',
    user: { handle: 'demo_dbtips', name: 'DB Tips (demo)' },
    text: 'Postgres tip: a partial index on (user_id) WHERE deleted_at IS NULL cut our p95 from 180ms to 9ms, because the planner no longer touches soft-deleted rows at all.',
    media: [],
  },
  {
    id: 'sample-2',
    user: { handle: 'demo_hottakes', name: 'Hot Takes (demo)' },
    text: "Women today can't even cook a basic meal. Men, would you still date a woman who can't make a sandwich? Be honest 👇",
    media: [],
  },
  {
    id: 'sample-3',
    user: { handle: 'demo_cat', name: 'Cat Person (demo)' },
    text: 'my cat knocked my coffee off the desk, made direct eye contact, and then did the exact same thing with the spoon',
    media: [],
  },
];

async function testConnection(llm) {
  if (!llm.keys[llm.provider]) return { ok: false, error: 'Paste an API key first.' };
  const started = Date.now();
  const result = await XIQ.providers.scoreBatch(llm, SAMPLES);
  const ms = Date.now() - started;
  await recordUsage(llm, result, Object.keys(result.scores).length, null);
  return {
    ok: true,
    ms,
    model: result.model,
    usage: result.usage ? { total: (result.usage.input || 0) + (result.usage.output || 0), cost: result.usage.cost || 0 } : null,
    samples: SAMPLES.map((s) => ({ text: s.text, score: result.scores[s.id] || null })),
  };
}
