// Run with: node dev/test-gate.js
// The timeline gate: the page hook holds X's HomeTimeline response, the content script decides, X gets a copy
// without the hidden posts. Covers both halves with stand-ins for the page and the extension.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('ok  -', name);
  } catch (e) {
    console.error('FAIL-', name);
    console.error(e);
    throw e;
  }
}

// ---- A fake page for src/page/hook.js -------------------------------------------------------------------
function makePage() {
  const listeners = [];
  const posted = [];
  const win = {
    location: { origin: 'https://x.com', href: 'https://x.com/home' },
    addEventListener: (type, fn) => type === 'message' && listeners.push(fn),
    postMessage(data) {
      posted.push(data);
      setTimeout(() => listeners.forEach((fn) => fn({ source: win, data })), 0);
    },
  };
  win.window = win;
  let serve = () => new Response('{}');
  win.fetch = (input, init) => Promise.resolve(serve(input, init));
  class XHR {
    open() {}
    send() {}
    addEventListener() {}
  }
  const ctx = vm.createContext({ window: win, XMLHttpRequest: XHR, Response, Request, Headers, URL, DOMException, setTimeout, clearTimeout, Promise, JSON, Math, Date });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/page/hook.js'), 'utf8'), ctx);
  return {
    win,
    posted,
    setServe: (fn) => (serve = fn),
    // Plays the content script: announce, and answer gate requests with fn(msg).
    content(gate, answer) {
      listeners.push((e) => {
        if (e.data.__xiq === 'gate' && answer) answer(e.data, (text) => win.postMessage({ __xiq: 'gateReply', rid: e.data.rid, text }));
      });
      win.postMessage({ __xiq: 'ready', gate });
    },
  };
}
const TL = 'https://api.x.com/graphql/abc/HomeTimeline?variables=%7B%7D';
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await test('hook: other requests are untouched', async () => {
    const p = makePage();
    const original = new Response('x');
    p.setServe(() => original);
    p.content(true, (m, reply) => reply('nope'));
    await tick();
    assert.equal(await p.win.fetch('https://api.x.com/graphql/abc/newsSidebarQuery'), original);
  });

  await test('hook: held response is replaced by the content script copy, status and headers kept', async () => {
    const p = makePage();
    p.setServe(() => new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json', 'x-keep': '1', 'content-length': '7' } }));
    p.content(true, (m, reply) => {
      assert.equal(m.op, 'HomeTimeline');
      assert.equal(m.text, '{"a":1}');
      reply('{"a":2}');
    });
    await tick();
    const res = await p.win.fetch(TL);
    assert.equal(await res.text(), '{"a":2}');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-keep'), '1');
    assert.equal(res.headers.get('content-length'), null);
  });

  await test('hook: a null reply hands X its original response object', async () => {
    const p = makePage();
    const original = new Response('{"a":1}');
    p.setServe(() => original);
    p.content(true, (m, reply) => reply(null));
    await tick();
    assert.equal(await p.win.fetch(TL), original);
  });

  await test('hook: with gating off it only copies the response', async () => {
    const p = makePage();
    const original = new Response('{"a":1}');
    p.setServe(() => original);
    p.content(false, () => assert.fail('must not hold'));
    await tick();
    assert.equal(await p.win.fetch(TL), original);
    await tick();
    assert.ok(p.posted.some((m) => m.__xiq === 'timeline' && m.text === '{"a":1}'));
  });

  await test('hook: no content script yet passes through after a short wait', async () => {
    const p = makePage();
    const original = new Response('{"a":1}');
    p.setServe(() => original);
    const t0 = Date.now();
    assert.equal(await p.win.fetch(TL), original);
    assert.ok(Date.now() - t0 < 1500);
  });

  await test('hook: an abort while held rejects like a normal aborted fetch', async () => {
    const p = makePage();
    p.setServe(() => new Response('{"a":1}'));
    p.content(true, () => {}); // never answers
    await tick();
    const ac = new AbortController();
    const pending = p.win.fetch(TL, { signal: ac.signal });
    await tick(20);
    ac.abort();
    await assert.rejects(pending, (e) => e.name === 'AbortError');
  });

  await test('hook: removed posts are reported as seen on the next For you request (POST body)', async () => {
    const p = makePage();
    const sent = [];
    p.setServe((input, init) => {
      sent.push({ input, init });
      return new Response('{"a":1}');
    });
    p.content(true, (m, reply) => {
      p.win.postMessage({ __xiq: 'gateReply', rid: m.rid, text: null, seen: ['111', '222', 'not-an-id'] });
    });
    await tick();
    await p.win.fetch(TL);
    const body = { queryId: 'q', variables: { count: 20, cursor: 'C1', seenTweetIds: ['999'] } };
    await p.win.fetch('https://api.x.com/graphql/abc/HomeTimeline', { method: 'POST', body: JSON.stringify(body), headers: { a: 'b' } });
    const last = sent[sent.length - 1];
    const vars = JSON.parse(last.init.body).variables;
    assert.deepEqual(vars.seenTweetIds, ['999', '111', '222']);
    assert.equal(vars.count, 20, 'nothing else changes');
    assert.deepEqual(last.init.headers, { a: 'b' });
    assert.equal(p.posted.filter((m) => m.__xiq === 'gate').pop().cursor, 'C1', 'cursor read from the body');
  });

  await test('hook: GET requests carry them in the URL; other timelines are left alone', async () => {
    const p = makePage();
    const sent = [];
    p.setServe((input, init) => {
      sent.push(typeof input === 'string' ? input : input.url);
      return new Response('{"a":1}');
    });
    p.content(true, (m, reply) => p.win.postMessage({ __xiq: 'gateReply', rid: m.rid, text: null, seen: ['333'] }));
    await tick();
    await p.win.fetch(TL);
    const url = 'https://api.x.com/graphql/abc/HomeTimeline?variables=' + encodeURIComponent(JSON.stringify({ count: 20, cursor: 'C2' }));
    await p.win.fetch(url);
    const vars = JSON.parse(new URL(sent[1]).searchParams.get('variables'));
    assert.deepEqual(vars.seenTweetIds, ['333']);
    assert.equal(vars.cursor, 'C2');
    const latest = 'https://api.x.com/graphql/abc/HomeLatestTimeline?variables=' + encodeURIComponent(JSON.stringify({ count: 20 }));
    await p.win.fetch(latest);
    assert.equal(sent[2], latest, 'Following is not touched');
  });

  await test('hook: an error status is never held', async () => {
    const p = makePage();
    const original = new Response('rate limited', { status: 429 });
    p.setServe(() => original);
    p.content(true, () => assert.fail('must not hold'));
    await tick();
    assert.equal(await p.win.fetch(TL), original);
  });

  // ---- The content side: feed.onGate with the real parser and decide() --------------------------------
  globalThis.window = { innerHeight: 800 };
  globalThis.location = { pathname: '/home' };
  globalThis.document = { querySelector: () => null, querySelectorAll: () => [] }; // an empty page for the render pass
  require(path.join(root, 'src/shared/core.js'));
  require(path.join(root, 'src/content/timeline.js'));
  require(path.join(root, 'src/content/dom.js'));
  require(path.join(root, 'src/content/feed.js'));
  const XIQ = globalThis.XIQ;
  Object.assign(XIQ, require(path.join(root, 'src/content/timeline.js')));

  const t = (id) => ({ __typename: 'Tweet', rest_id: id, core: { user_results: { result: { core: { screen_name: 'demo_' + id, name: 'D' } } } }, details: { full_text: 'post ' + id }, legacy: {} });
  const item = (id, promo) => ({ entry_id: (promo ? 'promoted-tweet-' : 'tweet-') + id, content: { __typename: 'TimelineTimelineItem', content: Object.assign({ __typename: 'TimelineTweet', tweet_results: { result: t(id) } }, promo ? { promoted_metadata: {} } : {}) } });
  const page = (ids, opts = {}) =>
    JSON.stringify({ data: { home_timeline: { home_timeline_urt: { instructions: [{ __typename: 'TimelineAddEntries', entries: [
      { entry_id: 'cursor-top-' + (opts.top || 'T1'), content: { __typename: 'TimelineTimelineCursor', value: opts.top || 'T1' } },
      ...ids.map((id) => item(id)),
      ...(opts.ad ? [item(opts.ad, true)] : []),
      { entry_id: 'cursor-bottom-' + (opts.bottom || 'B1'), content: { __typename: 'TimelineTimelineCursor', value: opts.bottom || 'B1' } },
    ] }] } } } });
  const kept = (out) => JSON.parse(out.text).data.home_timeline.home_timeline_urt.instructions[0].entries.map((e) => e.entry_id);
  const good = { t: 'ai', s: 9, b: 0, f: 0 };
  const bad = { t: 'other', s: 1, b: 1, f: 0 };
  const makeFeed = (settings, cached, onSend) => {
    let s = XIQ.mergeSettings(Object.assign({ v: 2 }, settings));
    const feed = XIQ.createFeed({
      getSettings: () => s,
      chips: { attach() {}, detach() {}, refresh() {} },
      onStats() {},
      send: async (msg) => {
        if (onSend) onSend(msg);
        const hits = {};
        for (const tw of msg.tweets) if (cached[tw.id]) hits[tw.id] = cached[tw.id];
        return { hits };
      },
    });
    return { feed, set: (patch) => (s = XIQ.mergeSettings(Object.assign({ v: 2 }, s, patch))) };
  };

  await test('gate: remove mode strips hidden posts and ads using cached scores', async () => {
    const { feed } = makeFeed({ hiddenStyle: 'remove', hideAds: true }, { 1: good, 2: bad, 3: good });
    const out = await feed.onGate('HomeTimeline', TL, page(['1', '2', '3'], { ad: '9' }));
    assert.deepEqual(kept(out), ['cursor-top-T1', 'tweet-1', 'tweet-3', 'cursor-bottom-B1']);
    const st = feed.stats();
    assert.equal(st.stripped, 1);
    assert.equal(st.ads, 1);
    assert.equal(st.hidden, 1);
  });

  await test('gate: collapse mode keeps posts (collapsed on the page) but still drops ads', async () => {
    const { feed } = makeFeed({ hiddenStyle: 'collapse', hideAds: true }, { 1: good, 2: bad });
    const out = await feed.onGate('HomeTimeline', TL, page(['1', '2'], { ad: '9' }));
    assert.deepEqual(kept(out), ['cursor-top-T1', 'tweet-1', 'tweet-2', 'cursor-bottom-B1']);
  });

  await test('gate: a page that would be empty keeps one hidden post so X keeps paginating', async () => {
    const { feed } = makeFeed({ hiddenStyle: 'remove' }, { 1: bad, 2: { t: 'other', s: 3, b: 1, f: 0 } });
    const out = await feed.onGate('HomeTimeline', TL, page(['1', '2']));
    assert.deepEqual(kept(out), ['cursor-top-T1', 'tweet-2', 'cursor-bottom-B1']);
  });

  await test('gate: scores that arrive while held are used; the page releases as soon as all are in', async () => {
    const { feed } = makeFeed({ hiddenStyle: 'remove' }, {}, (msg) => {
      setTimeout(() => feed.applyScores({ 1: good, 2: bad }), 30);
    });
    const t0 = Date.now();
    const out = await feed.onGate('HomeTimeline', TL, page(['1', '2']));
    assert.ok(Date.now() - t0 < 1000, 'released early');
    assert.deepEqual(kept(out), ['cursor-top-T1', 'tweet-1', 'cursor-bottom-B1']);
  });

  await test('gate: a scoring failure releases the page with the unscored posts in it', async () => {
    const { feed } = makeFeed({ hiddenStyle: 'remove', hideAds: false }, {}, (msg) => {
      setTimeout(() => feed.markFailed(msg.tweets.map((x) => x.id), 'boom'), 20);
    });
    const out = await feed.onGate('HomeTimeline', TL, page(['1', '2']));
    assert.equal(out, null, 'nothing to change');
  });

  await test('gate: newer posts for the top of the feed pass through whole', async () => {
    const { feed } = makeFeed({ hiddenStyle: 'remove' }, { 1: bad, 2: good, 3: bad, 4: good });
    await feed.onGate('HomeTimeline', TL, page(['1', '2'], { top: 'TOP-A' }));
    const topUrl = 'https://api.x.com/graphql/abc/HomeTimeline?variables=' + encodeURIComponent(JSON.stringify({ cursor: 'TOP-A' }));
    assert.equal(await feed.onGate('HomeTimeline', topUrl, page(['3', '4'], { top: 'TOP-B' })), null);
  });

  await test('gate: filter off leaves posts; ads still go when ad hiding is on', async () => {
    const { feed } = makeFeed({ enabled: false, hiddenStyle: 'remove', hideAds: true }, { 1: bad });
    const out = await feed.onGate('HomeTimeline', TL, page(['1'], { ad: '9' }));
    assert.deepEqual(kept(out), ['cursor-top-T1', 'tweet-1', 'cursor-bottom-B1']);
  });

  await test('gate: removed hidden posts come back as ids to report to X as seen', async () => {
    const { feed } = makeFeed({ hiddenStyle: 'remove', hideAds: true }, { 1: good, 2: bad, 3: bad });
    const out = await feed.onGate('HomeTimeline', TL, page(['1', '2', '3'], { ad: '9' }));
    assert.deepEqual(out.seen.sort(), ['2', '3'], 'hidden posts only, not ads');
  });

  await test('gate: after the first page, posts not scored in time are held back and not reported', async () => {
    const { feed } = makeFeed({ hiddenStyle: 'remove' }, { 1: good, 2: bad, 3: good, 4: bad });
    await feed.onGate('HomeTimeline', TL, page(['1', '2']));
    const realTimeout = global.setTimeout;
    global.setTimeout = (fn, ms) => realTimeout(fn, Math.min(ms, 20)); // don't really wait 4.5 s
    try {
      const out = await feed.onGate('HomeTimeline', TL, page(['3', '4', '5'], { top: 'T2', bottom: 'B2' }));
      assert.deepEqual(kept(out), ['cursor-top-T2', 'tweet-3', 'cursor-bottom-B2'], 'unscored 5 held back');
      assert.deepEqual(out.seen, ['4'], 'held-back post is not reported, so X sends it again');
    } finally {
      global.setTimeout = realTimeout;
    }
  });

  await test('gate: the first page lets unscored posts through so the feed is not empty', async () => {
    const { feed } = makeFeed({ hiddenStyle: 'remove' }, { 2: bad });
    const realTimeout = global.setTimeout;
    global.setTimeout = (fn, ms) => realTimeout(fn, Math.min(ms, 20));
    try {
      const out = await feed.onGate('HomeTimeline', TL, page(['1', '2']));
      assert.deepEqual(kept(out), ['cursor-top-T1', 'tweet-1', 'cursor-bottom-B1']);
    } finally {
      global.setTimeout = realTimeout;
    }
  });

  await test('gate: the sentinel is never a post X already has, or X would ignore it and stall', async () => {
    const { feed } = makeFeed({ hiddenStyle: 'remove' }, { 1: good, 2: bad, 3: { t: 'other', s: 3, b: 1, f: 0 }, 4: bad });
    await feed.onGate('HomeTimeline', TL, page(['1', '2']));
    // X sends 1 again (it already has it) plus new hidden 3 and 4: nothing new survives, so the better of the
    // two (3) stays as the sentinel.
    const out = await feed.onGate('HomeTimeline', TL, page(['1', '3', '4'], { top: 'T3', bottom: 'B3' }));
    assert.deepEqual(kept(out), ['cursor-top-T3', 'tweet-1', 'tweet-3', 'cursor-bottom-B3'], '1 is a repeat, so 3 stays as a fresh sentinel');
    assert.deepEqual(out.seen, ['4']);
  });

  await test('gate: settings changes offer a refresh once posts were removed', async () => {
    const { feed } = makeFeed({ hiddenStyle: 'remove' }, { 1: good, 2: bad });
    await feed.onGate('HomeTimeline', TL, page(['1', '2']));
    assert.equal(feed.stats().refresh, false);
    feed.onSettingsChanged(false);
    assert.equal(feed.stats().refresh, false, 'collapsing the panel is not a filter change');
    feed.onSettingsChanged(true);
    assert.equal(feed.stats().refresh, true);
  });

  console.log(`\n${passed} passed`);
})().catch(() => process.exit(1));
