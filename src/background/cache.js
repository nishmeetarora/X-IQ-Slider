// Score cache in chrome.storage.local, one key per tweet ("sc:<id>").
// Each entry is tagged with a signature of the prompt/model/about-me it was scored with; other signatures count as misses.
(function (root) {
  'use strict';

  const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

  function key(id) {
    return root.XIQ.STORAGE.scorePrefix + id;
  }

  async function getMany(ids, sig) {
    if (!ids.length) return {};
    const got = await chrome.storage.local.get(ids.map(key));
    const out = {};
    for (const id of ids) {
      const e = got[key(id)];
      if (e && e.g === sig) out[id] = { t: e.t, s: e.s, b: e.b, f: e.f, w: e.w };
    }
    return out;
  }

  async function setMany(scores, sig) {
    const now = Date.now();
    const items = {};
    for (const id in scores) items[key(id)] = Object.assign({}, scores[id], { g: sig, at: now });
    if (Object.keys(items).length) await chrome.storage.local.set(items);
  }

  async function prune() {
    const all = await chrome.storage.local.get(null);
    const cutoff = Date.now() - MAX_AGE_MS;
    const old = Object.keys(all).filter((k) => k.startsWith(root.XIQ.STORAGE.scorePrefix) && !(all[k].at > cutoff));
    if (old.length) await chrome.storage.local.remove(old);
    return old.length;
  }

  async function clear() {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(root.XIQ.STORAGE.scorePrefix));
    if (keys.length) await chrome.storage.local.remove(keys);
    return keys.length;
  }

  async function count() {
    const all = await chrome.storage.local.get(null);
    return Object.keys(all).filter((k) => k.startsWith(root.XIQ.STORAGE.scorePrefix)).length;
  }

  root.XIQ = Object.assign(root.XIQ || {}, { cache: { getMany, setMany, prune, clear, count } });
})(typeof globalThis !== 'undefined' ? globalThis : this);
