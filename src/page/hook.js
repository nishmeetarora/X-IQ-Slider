// Runs in the page's own JS world at document_start, before X's scripts.
// Copies timeline API responses and forwards them to the content script. It never changes requests or responses.
(function () {
  'use strict';
  if (window.__xiqHooked) return;
  window.__xiqHooked = true;

  const OPS = /\/i\/api\/graphql\/[^/]+\/(HomeTimeline|HomeLatestTimeline|ListLatestTweetsTimeline)\b/;

  function opOf(url) {
    if (typeof url !== 'string') url = url && url.url ? url.url : String(url || '');
    const m = url.match(OPS);
    return m ? m[1] : null;
  }

  function forward(op, text) {
    if (!text || typeof text !== 'string') return;
    window.postMessage({ __xiq: 'timeline', op, text }, window.location.origin);
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
    window.fetch = function (input) {
      const promise = origFetch.apply(this, arguments);
      try {
        const op = opOf(input);
        if (op) {
          promise
            .then((res) => res.clone().text())
            .then((text) => forward(op, text))
            .catch(() => {});
        }
      } catch (_) {}
      return promise;
    };
  }
})();
