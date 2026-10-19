// Run with: node dev/test-background.js
// Loads the real service worker into a sandbox with fake chrome.* and fetch, then checks batching and requests.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bgDir = path.join(__dirname, '..', 'src', 'background');

function makeWorld(fetchImpl) {
  const store = {};
  const listeners = {};
  const tabMessages = [];
  const calls = [];
  const on = (name) => ({ addListener: (fn) => (listeners[name] = fn) });
  const chrome = {
    storage: {
      local: {
        async get(keys) {
          if (keys == null) return structuredClone(store);
          const out = {};
          for (const k of [].concat(keys)) if (k in store) out[k] = structuredClone(store[k]);
          return out;
        },
        async set(items) {
          Object.assign(store, structuredClone(items));
        },
        async remove(keys) {
          for (const k of [].concat(keys)) delete store[k];
        },
      },
    },
    runtime: { onMessage: on('message'), onInstalled: on('installed'), onStartup: on('startup'), openOptionsPage() {} },
    action: { onClicked: on('action') },
    tabs: {
      async sendMessage(tab, msg) {
        tabMessages.push({ tab, msg });
      },
    },
  };
  const ctx = {
    chrome,
    console,
    setTimeout,
    clearTimeout,
    crypto: globalThis.crypto,
    structuredClone,
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, headers: init.headers, body });
      return fetchImpl(url, init, body, calls.length);
    },
  };
  ctx.globalThis = ctx;
  ctx.self = ctx;
  ctx.importScripts = (...files) => {
    for (const f of files) vm.runInContext(fs.readFileSync(path.join(bgDir, f), 'utf8'), ctx, { filename: f });
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(bgDir, 'service-worker.js'), 'utf8'), ctx, { filename: 'service-worker.js' });

  function send(msg, tabId = 7) {
    return new Promise((resolve) => {
      const keep = listeners.message(msg, { tab: { id: tabId } }, resolve);
      if (keep !== true) resolve(undefined);
    });
  }
  return { store, send, tabMessages, calls };
}

function reply(json, status = 200) {
  const text = typeof json === 'string' ? json : JSON.stringify(json);
  return { ok: status < 300, status, json: async () => JSON.parse(text), text: async () => text };
}

// A fake model: scores every post in the prompt as tech 7/1/0.
function modelReply(body, extraUsage = {}) {
  const n = Number(body.messages[1].content.match(/Score these (\d+) posts/)[1]);
  const r = Array.from({ length: n }, (_, i) => ({ i, t: 'tech', s: 7, b: 1, f: 0, w: 'fake' }));
  return reply({ model: body.model, choices: [{ message: { content: JSON.stringify({ r }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 200, ...extraUsage } });
}

const tweets = (n, prefix = 't') => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, user: { handle: 'h', name: 'n' }, text: `post ${i}`, media: [] }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const llmKey = 'xiq:llm';
// Objects from the vm sandbox have a different prototype; compare plain JSON copies.
const eq = (a, b, ...msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, ...msg);

async function main() {
  let passed = 0;
  const ok = (name) => {
    passed++;
    console.log('ok  -', name);
  };

  {
    const w = makeWorld(() => assert.fail('should not call the API without a key'));
    const res = await w.send({ type: 'score', tweets: tweets(3) });
    assert.equal(res.error, 'no_key');
    ok('no API key: reports no_key and makes no request');
  }

  {
    const w = makeWorld((url, init, body) => modelReply(body));
    w.store[llmKey] = { provider: 'opencode-go', keys: { 'opencode-go': 'oc_sk_test' } };
    const res = await w.send({ type: 'score', tweets: tweets(20) });
    eq(res.hits, {});
    await sleep(600);
    assert.equal(w.calls.length, 1, 'a 20-post page is one call');
    const c = w.calls[0];
    assert.equal(c.url, 'https://opencode.ai/inference/go/openai/v1/chat/completions');
    assert.equal(c.headers.Authorization, 'Bearer oc_sk_test');
    assert.match(c.headers['x-opencode-session'], /^iq-slider-/);
    assert.equal(c.body.model, 'deepseek-v4.1-flash');
    assert.equal(c.body.reasoning_effort, 'none');
    eq(c.body.response_format, { type: 'json_object' });
    assert.equal(c.body.stream, false);
    const delivered = w.tabMessages.filter((m) => m.msg.type === 'scores').flatMap((m) => Object.keys(m.msg.scores));
    assert.equal(delivered.length, 20);
    assert.equal(w.tabMessages[0].tab, 7);
    ok('OpenCode Go: one call for a 20-post page, with the right URL, headers and body');

    const again = await w.send({ type: 'score', tweets: tweets(20) });
    assert.equal(Object.keys(again.hits).length, 20);
    assert.equal(w.calls.length, 1);
    ok('second request is served from the cache');

    assert.equal(w.store['xiq:stats'].tweets, 20);
    assert.equal(w.store['xiq:stats'].tokensIn, 1000);
    assert.equal(w.store['xiq:status'].error, null);
    ok('usage stats and status are recorded');

    w.store[llmKey] = { provider: 'opencode-go', keys: { 'opencode-go': 'oc_sk_test' }, aboutMe: 'changed' };
    const changed = await w.send({ type: 'score', tweets: tweets(2) });
    eq(changed.hits, {});
    ok('changing "about me" invalidates cached scores');
  }

  {
    const w = makeWorld((url, init, body, n) => {
      if (body.reasoning_effort === 'none') return reply({ error: { message: 'reasoning_effort "none" is not supported for this model' } }, 400);
      return modelReply(body);
    });
    w.store[llmKey] = { provider: 'opencode-go', keys: { 'opencode-go': 'k' } };
    await w.send({ type: 'score', tweets: tweets(16) });
    await sleep(700);
    assert.equal(w.calls.length, 2);
    assert.equal(w.calls[1].body.reasoning_effort, 'low');
    assert.equal(w.tabMessages.filter((m) => m.msg.type === 'scores').length, 1);
    await w.send({ type: 'score', tweets: tweets(16, 'u') });
    await sleep(700);
    assert.equal(w.calls.length, 3, 'remembers the working shape');
    assert.equal(w.calls[2].body.reasoning_effort, 'low');
    ok('falls back from reasoning "none" to "low" when rejected, and remembers it');
  }

  {
    const w = makeWorld(() => reply({ error: { message: 'Invalid API key' } }, 401));
    w.store[llmKey] = { provider: 'openrouter', keys: { openrouter: 'bad' } };
    await w.send({ type: 'score', tweets: tweets(3) });
    await sleep(700);
    const err = w.tabMessages.find((m) => m.msg.type === 'scoreError');
    assert.ok(err, 'tab gets a scoreError');
    eq(err.msg.ids, ['t0', 't1', 't2']);
    assert.match(err.msg.error, /API key rejected \(401\): Invalid API key/);
    assert.match(w.store['xiq:status'].error, /401/);
    ok('401 surfaces a readable error to the tab and the status');
  }

  {
    const w = makeWorld((url, init, body) => modelReply(body, { cost: 0.00042 }));
    w.store[llmKey] = { provider: 'openrouter', keys: { openrouter: 'sk-or-test' } };
    await w.send({ type: 'score', tweets: tweets(4) });
    await sleep(700);
    const c = w.calls[0];
    assert.equal(c.url, 'https://openrouter.ai/api/v1/chat/completions');
    eq(c.body.reasoning, { effort: 'none' });
    assert.equal(c.body.model, 'deepseek/deepseek-v4.1-flash');
    assert.equal(c.headers['X-OpenRouter-Title'], 'IQ Slider');
    assert.equal(c.headers['x-opencode-session'], undefined);
    assert.equal(w.store['xiq:stats'].cost, 0.00042);
    ok('OpenRouter: right URL, reasoning off, attribution headers, cost recorded');
  }

  {
    let n = 0;
    const w = makeWorld((url, init, body) => {
      n++;
      // First reply drops the last post; it should be retried in a later batch.
      if (n === 1) {
        const r = [0, 1].map((i) => ({ i, t: 'ai', s: 5, b: 0, f: 0, w: 'x' }));
        return reply({ choices: [{ message: { content: JSON.stringify({ r }) } }], usage: {} });
      }
      return modelReply(body);
    });
    w.store[llmKey] = { provider: 'opencode-go', keys: { 'opencode-go': 'k' } };
    await w.send({ type: 'score', tweets: tweets(3) });
    await sleep(1400);
    const delivered = w.tabMessages.filter((m) => m.msg.type === 'scores').flatMap((m) => Object.keys(m.msg.scores));
    eq(delivered.sort(), ['t0', 't1', 't2']);
    assert.equal(w.calls.length, 2);
    ok('posts the model skipped are retried once');
  }

  {
    const w = makeWorld((url, init, body) => modelReply(body, { prompt_tokens_details: { cached_tokens: 600 } }));
    w.store[llmKey] = { provider: 'opencode-go', keys: { 'opencode-go': 'k' } };
    await w.send({ type: 'score', tweets: tweets(30) });
    await sleep(100);
    const sizes = w.calls.map((c) => Number(c.body.messages[1].content.match(/Score these (\d+) posts/)[1]));
    eq(sizes, [15, 15]);
    assert.equal(w.store['xiq:stats'].tokensCached, 1200);
    ok('30 posts split evenly into 15 + 15 right away; cached tokens are counted');
  }

  {
    const w = makeWorld((url, init, body) => modelReply(body));
    w.store[llmKey] = { provider: 'opencode-go', keys: { 'opencode-go': 'k' } };
    const res = await w.send({ type: 'test', llm: w.store[llmKey] });
    assert.equal(res.ok, true);
    assert.equal(res.samples.length, 3);
    assert.ok(res.samples.every((s) => s.score && s.score.t === 'tech'));
    ok('settings-page connection test scores the three samples');
  }

  console.log(`\n${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
