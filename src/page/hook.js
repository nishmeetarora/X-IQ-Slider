// Runs in the page's own JS world at document_start, before X's scripts.
// Copies timeline API responses to the content script. For fetch (X's current app), it can also hold a response
// until the content script has decided which posts to hide, and hand X a copy with those posts, ads and
// suggestion modules removed. Then X's virtualized feed never lays out a post that later disappears.
// It fails open: no content script, a timeout, an abort or any error gives X its original response.
//
// The one change to a request: posts removed that way are added to the next For you request's seenTweetIds,
// the list X's app uses to report what the reader has already seen. Without it X keeps recommending the same
// removed posts (measured: 15-30 of every ~31 were repeats), and a strict filter runs the feed dry.
(function () {
  'use strict';
  if (window.__xiqHooked) return;
  window.__xiqHooked = true;

  // Old app: x.com/i/api/graphql/<id>/<op>. Rewrite (Nov 2026): api.x.com/graphql/<id>/<op>.
  const OPS = /\/graphql\/[^/?]+\/(HomeTimeline|HomeLatestTimeline|ListLatestTweetsTimeline)\b/;
  // The content script decides within its own budget (4-6 s); this is only a backstop if it never answers.
  const GATE_BACKSTOP_MS = 9000;
  const READY_WAIT_MS = 600;
  const MAX_TEXT = 8 * 1024 * 1024;
  // Most recent removed posts to report. A GET request carries them in its URL, so it gets fewer.
  const SEEN_MAX = 300;
  const SEEN_MAX_GET = 100;
  const seenQueue = [];

  function opOf(url) {
    if (typeof url !== 'string') url = url && url.url ? url.url : String(url || '');
    const m = url.match(OPS);
    return m ? m[1] : null;
  }

  function post(msg) {
    window.postMessage(Object.assign({ __xiq: msg.type }, msg), window.location.origin);
  }

  function forward(op, text) {
    if (!text || typeof text !== 'string') return;
    post({ type: 'timeline', op, text });
  }

  // State announced by the content script: whether gating is wanted at all (filter, ad or suggestion hiding on).
  const bridge = { ready: false, gate: false };
  const readyWaiters = [];
  const replies = new Map(); // request id -> resolve
  let seq = 0;

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d || typeof d.__xiq !== 'string') return;
    if (d.__xiq === 'ready') {
      bridge.ready = true;
      bridge.gate = d.gate === true;
      for (const w of readyWaiters.splice(0)) w();
    } else if (d.__xiq === 'gateReply' && typeof d.rid === 'string') {
      const resolve = replies.get(d.rid);
      if (resolve) {
        replies.delete(d.rid);
        if (Array.isArray(d.seen)) noteSeen(d.seen);
        resolve(typeof d.text === 'string' ? d.text : null);
      }
    }
  });

  function noteSeen(ids) {
    for (const id of ids) {
      if (typeof id !== 'string' || !/^\d{1,25}$/.test(id) || seenQueue.includes(id)) continue;
      seenQueue.push(id);
    }
    if (seenQueue.length > SEEN_MAX) seenQueue.splice(0, seenQueue.length - SEEN_MAX);
  }

  function withSeen(list, max) {
    const out = Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
    for (const id of seenQueue.slice(-max)) if (!out.includes(id)) out.push(id);
    return out;
  }

  // Reads the request's cursor and, for For you, adds removed posts to seenTweetIds. Variables travel in the
  // JSON body of a POST or in the URL of a GET. Returns the (possibly new) fetch arguments and the cursor.
  function prepare(op, input, init) {
    let cursor = null;
    const report = op === 'HomeTimeline' && bridge.gate && seenQueue.length > 0;
    try {
      if (init && typeof init.body === 'string') {
        const body = JSON.parse(init.body);
        const vars = body && body.variables;
        if (vars && typeof vars === 'object') {
          if (typeof vars.cursor === 'string') cursor = vars.cursor;
          if (report) {
            vars.seenTweetIds = withSeen(vars.seenTweetIds, SEEN_MAX);
            init = Object.assign({}, init, { body: JSON.stringify(body) });
          }
        }
      } else {
        const isRequest = typeof Request === 'function' && input instanceof Request;
        if (typeof input === 'string' || (isRequest && input.method === 'GET')) {
          const u = new URL(isRequest ? input.url : input, window.location.href);
          const vars = JSON.parse(u.searchParams.get('variables') || 'null');
          if (vars && typeof vars === 'object') {
            if (typeof vars.cursor === 'string') cursor = vars.cursor;
            if (report) {
              vars.seenTweetIds = withSeen(vars.seenTweetIds, SEEN_MAX_GET);
              u.searchParams.set('variables', JSON.stringify(vars));
              input = isRequest ? new Request(u.toString(), input) : u.toString();
            }
          }
        }
      }
    } catch (_) {}
    return { input, init, cursor };
  }

  function whenReady() {
    if (bridge.ready) return Promise.resolve();
    return new Promise((resolve) => {
      readyWaiters.push(resolve);
      setTimeout(resolve, READY_WAIT_MS);
    });
  }

  function aborted(signal) {
    return signal && signal.aborted ? signal.reason || new DOMException('The operation was aborted.', 'AbortError') : null;
  }

  async function gate(op, url, res, signal, cursor) {
    if (!res.ok) return res;
    let text;
    try {
      text = await res.clone().text();
    } catch (_) {
      return res;
    }
    await whenReady();
    if (!bridge.gate || text.length > MAX_TEXT) {
      forward(op, text);
      return res;
    }
    const rid = `${Date.now().toString(36)}.${++seq}.${Math.random().toString(36).slice(2, 8)}`;
    const rewritten = await new Promise((resolve) => {
      const done = (value) => {
        if (!replies.has(rid)) return;
        replies.delete(rid);
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => done(null), GATE_BACKSTOP_MS);
      replies.set(rid, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      if (signal) signal.addEventListener('abort', () => done(null), { once: true });
      post({ type: 'gate', rid, op, url, text, cursor });
    });
    const abortReason = aborted(signal);
    if (abortReason) throw abortReason;
    if (rewritten == null) return res;
    // Same status and headers; drop the ones that described the original body.
    const headers = new Headers(res.headers);
    for (const h of ['content-length', 'content-encoding', 'etag', 'last-modified']) headers.delete(h);
    return new Response(rewritten, { status: res.status, statusText: res.statusText, headers });
  }

  const proto = XMLHttpRequest.prototype;
  const open = proto.open;
  const send = proto.send;
  proto.open = function (method, url) {
    try {
      this.__xiqOp = opOf(url);
    } catch (_) {
      this.__xiqOp = null;
    }
    return open.apply(this, arguments);
  };
  // The old app's XHR responses are only copied; filtering them happens on the page.
  proto.send = function () {
    const op = this.__xiqOp;
    if (op) {
      this.addEventListener('load', function () {
        try {
          if (this.responseType === '' || this.responseType === 'text') forward(op, this.responseText);
          else if (this.responseType === 'json' && this.response) forward(op, JSON.stringify(this.response));
        } catch (_) {}
      });
    }
    return send.apply(this, arguments);
  };

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      let op = null;
      try {
        op = opOf(input);
      } catch (_) {}
      if (!op) return origFetch.apply(this, arguments);
      const req = prepare(op, input, init);
      const args = req.init === undefined ? [req.input] : [req.input, req.init];
      const promise = origFetch.apply(this, args);
      let url = '';
      let signal = null;
      try {
        url = typeof req.input === 'string' ? req.input : (req.input && req.input.url) || String(req.input || '');
        signal = (req.init && req.init.signal) || (req.input && typeof req.input === 'object' && req.input.signal) || null;
      } catch (_) {}
      return promise.then((res) =>
        gate(op, url, res, signal, req.cursor).catch((err) => {
          if (signal && signal.aborted) throw err;
          return res;
        })
      );
    };
  }
})();
