// Decides, for every rendered tweet, whether it is pending, shown, collapsed or removed.
// All visual changes are data-* attributes styled by content.css, so X's React tree is never restructured.
//
// Two rules keep X's virtualized feed steady (it measures every post and positions the rest from those sizes):
// 1. Decide before X renders. Timeline responses are held at the page hook until their posts are scored
//    (onGate), and posts hidden in "remove" mode, ads and suggestion modules are taken out of the response.
// 2. Never resize a post the reader has already seen. A score that arrives after a post was on screen only
//    updates its chip; the post keeps its height until the user changes a setting or clicks Show.
(function (root) {
  'use strict';

  const PENDING_TIMEOUT = 12000;
  const REQUEST_CHUNK = 40;
  // How long a timeline page may wait for its scores; it releases as soon as every post is scored (cache hits
  // are instant). The first page lets unscored posts through (shown while scoring) so the feed isn't empty.
  // Later pages in remove mode hold them back instead: X re-sends posts it hasn't seen, so they come back on a
  // later page with their scores cached.
  const GATE_FIRST_MS = 6000;
  const GATE_NEXT_MS = 4500;

  function createFeed(ctx) {
    const XIQ = root.XIQ;
    const dom = XIQ.dom;

    const tweetData = new Map(); // id -> tweet payload (from the API hook, or the DOM as a fallback)
    const scores = new Map(); // id -> { t, s, b, f, w }
    const promoted = new Set();
    const revealed = new Set();
    const requested = new Map(); // id -> time the score was requested
    const failed = new Set(); // ids we stopped waiting for; shown unscored
    const seen = new Set(); // scored ids rendered while the filter was active
    const stripped = new Set(); // ids removed from timeline responses before X saw them
    const adsHidden = new Set();
    const onScreen = new Set(); // ids that have been visible at their natural height (see rule 2)
    const latched = new Set(); // ids that scored as hidden after being seen, so they stay up (rule 2)
    const topCursors = new Set(); // cursors that ask for newer posts; those responses pass through untouched
    const delivered = new Set(); // ids X has been given (it ignores a post it already has)
    const scoreWaiters = new Set(); // { ids:Set, resolve } for held timeline pages
    let gatedPages = 0;
    let llmError = null;
    let version = 0;
    let scheduled = false;
    let timeoutArmed = false;

    const settings = () => ctx.getSettings();

    function filterActive() {
      const s = settings();
      if (!s.enabled || !dom.isHome()) return false;
      return s.scope === 'home' || dom.selectedHomeTab() === 'foryou';
    }

    function ingest(json) {
      const parsed = XIQ.parseTimeline(json);
      for (const id of parsed.promotedIds) promoted.add(id);
      for (const t of parsed.tweets) {
        const prev = tweetData.get(t.id);
        if (!prev || prev.fromDom) tweetData.set(t.id, t);
      }
      for (const c of XIQ.cursorsOf(json).top) topCursors.add(c);
      return parsed;
    }

    function onTimeline(op, text) {
      let json;
      try {
        json = JSON.parse(text);
      } catch (_) {
        return;
      }
      const { tweets, promotedIds } = ingest(json);
      for (const t of tweets) delivered.add(t.id);
      const s = settings();
      if (s.enabled && (op === 'HomeTimeline' || s.scope === 'home')) request(tweets);
      if (promotedIds.length) schedule();
    }

    function request(tweets) {
      const now = Date.now();
      const todo = tweets.filter((t) => !scores.has(t.id) && !requested.has(t.id) && !failed.has(t.id));
      if (!todo.length) return;
      for (const t of todo) requested.set(t.id, now);
      for (let i = 0; i < todo.length; i += REQUEST_CHUNK) {
        const chunk = todo.slice(i, i + REQUEST_CHUNK);
        ctx
          .send({ type: 'score', tweets: chunk })
          .then((res) => {
            if (!res) return;
            if (res.hits) applyScores(res.hits);
            if (res.error) {
              setError(res.error);
              markFailed(chunk.map((t) => t.id).filter((id) => !scores.has(id)));
            }
          })
          .catch(() => markFailed(chunk.map((t) => t.id)));
      }
    }

    function applyScores(map) {
      let changed = false;
      for (const id in map) {
        if (!map[id]) continue;
        scores.set(id, map[id]);
        failed.delete(id);
        changed = true;
      }
      if (changed) {
        if (llmError && llmError !== 'no_key') llmError = null;
        schedule();
        ctx.onStats();
      }
      settleWaiters();
    }

    function settled(id) {
      return scores.has(id) || failed.has(id);
    }

    function settleWaiters() {
      for (const w of scoreWaiters) {
        for (const id of w.ids) if (settled(id)) w.ids.delete(id);
        if (!w.ids.size) w.resolve();
      }
    }

    function waitForScores(ids, ms) {
      const pending = new Set(ids.filter((id) => !settled(id)));
      if (!pending.size) return Promise.resolve();
      return new Promise((resolve) => {
        const w = { ids: pending, resolve: () => finish() };
        const timer = setTimeout(() => finish(), ms);
        function finish() {
          clearTimeout(timer);
          scoreWaiters.delete(w);
          resolve();
        }
        scoreWaiters.add(w);
      });
    }

    // A timeline page held by the page hook. Returns { text, seen } with the rewritten JSON and the ids (as X knows
    // them) of posts removed as hidden, which the hook reports to X as seen so it stops recommending them again.
    // Returns null to pass the page through unchanged.
    async function onGate(op, url, text, cursorHint) {
      let json;
      try {
        json = JSON.parse(text);
      } catch (_) {
        return null;
      }
      const cursor = typeof cursorHint === 'string' ? cursorHint : XIQ.requestCursor(url);
      const cursors = XIQ.cursorsOf(json);
      // Newer posts for the top of the feed ("Show N posts"): X ties a count and a scroll position to those,
      // so they pass through whole and get handled on the page like before.
      if (cursor && topCursors.has(cursor)) {
        for (const c of cursors.top) topCursors.add(c);
        onTimeline(op, text);
        return null;
      }
      for (const c of cursors.top) topCursors.add(c);
      const { tweets, promotedIds } = ingest(json);
      const s = settings();
      const filtering = s.enabled && (op === 'HomeTimeline' || s.scope === 'home');
      if (filtering) request(tweets);
      const ids = tweets.map((t) => t.id);
      const first = gatedPages === 0;
      if (filtering && ids.length) await waitForScores(ids, first ? GATE_FIRST_MS : GATE_NEXT_MS);
      gatedPages++;

      const now = settings(); // may have changed while waiting
      const dropIds = new Set();
      const hiddenIds = new Set();
      if (filtering && now.enabled && now.hiddenStyle === 'remove') {
        for (const id of ids) {
          const sc = scores.get(id);
          if (sc) {
            if (!revealed.has(id) && XIQ.decide(sc, now).hide) {
              dropIds.add(id);
              hiddenIds.add(id);
            }
          } else if (!first && !failed.has(id)) {
            dropIds.add(id); // not scored in time: held back, not reported as seen, so X sends it again
          }
        }
        // X's infinite scroll stops when a page adds nothing to its list, and it ignores posts it already has.
        // So if no new post survives, one removed post X has never been given stays in as a sentinel; it is
        // hidden on the page as it mounts (one 1 px row instead of a stuck feed). A post scored as hidden is
        // preferred, the higher its substance the better; an unscored one only if there is no other.
        if (!ids.some((id) => !dropIds.has(id) && !delivered.has(id))) {
          let keep = null;
          let rank = -1;
          for (const id of ids) {
            if (!dropIds.has(id) || delivered.has(id)) continue;
            const sc = scores.get(id);
            const r = sc ? 100 + sc.s : 0;
            if (r > rank) {
              keep = id;
              rank = r;
            }
          }
          if (keep) {
            dropIds.delete(keep);
            hiddenIds.delete(keep);
          }
        }
      }
      const r = XIQ.stripTimeline(json, { dropIds, dropAds: now.hideAds, dropSuggestions: now.hideSuggestions });
      const removed = new Set(r.removed.map((x) => x.id));
      for (const id of ids) if (!removed.has(id)) delivered.add(id);
      if (!r.changed) return null;
      const seen = [];
      for (const x of r.removed) {
        if (!hiddenIds.has(x.id)) continue;
        stripped.add(x.id);
        seen.push(x.own);
      }
      for (const id of promotedIds) if (now.hideAds) adsHidden.add(id);
      ctx.onStats();
      return { text: JSON.stringify(json), seen };
    }

    function markFailed(ids, error) {
      for (const id of ids) {
        if (!scores.has(id)) failed.add(id);
      }
      if (error) setError(error);
      schedule();
      settleWaiters();
    }

    function setError(error) {
      llmError = error;
      ctx.onStats();
    }

    function hiddenLabel(sc, d, s) {
      const f = XIQ.effectiveFilter(s);
      const iq = XIQ.substanceToIq;
      const topic = XIQ.topicOf(sc.t);
      let why;
      if (d.reason === 'topic') why = `${topic.icon} ${topic.label} · a topic you hide`;
      else if (d.reason === 'bait') why = `🎣 Bait ${sc.b}/10 · over your ${f.maxBait}`;
      else if (d.reason === 'heavy') why = `IQ ${iq(sc.s)} · too heavy for ${XIQ.moodInfo(s.mood).label}`;
      else why = `IQ ${iq(sc.s)} · under your ${iq(f.minSubstance)}`;
      const quote = sc.w ? ` · “${sc.w}”` : '';
      return `${why}${quote}   ·   Show`;
    }

    function setCell(cell, reason) {
      if (!cell) return;
      if (reason) {
        if (cell.dataset.xiqRemove !== reason) cell.dataset.xiqRemove = reason;
      } else if (cell.dataset.xiqRemove) {
        delete cell.dataset.xiqRemove;
      }
    }

    function render(article, state, opts) {
      opts = opts || {};
      if (state === 'off') delete article.dataset.xiqState;
      else article.dataset.xiqState = state;
      if (opts.label) article.dataset.xiqLabel = opts.label;
      else delete article.dataset.xiqLabel;
      if (opts.chip) ctx.chips.attach(article, opts.chip);
      else ctx.chips.detach(article);
    }

    function armTimeout() {
      if (timeoutArmed) return;
      timeoutArmed = true;
      setTimeout(() => {
        timeoutArmed = false;
        version++;
        schedule();
      }, PENDING_TIMEOUT + 200);
    }

    // Rule 2 bookkeeping: a post shown at its natural height that enters the viewport counts as seen.
    const NATURAL = new Set(['shown', 'unscored', 'pending', 'revealed', undefined]);
    const watched = new WeakSet();
    let io = null;
    function watch(article) {
      if (watched.has(article) || typeof IntersectionObserver !== 'function') return;
      if (!io) {
        io = new IntersectionObserver((entries) => {
          for (const e of entries) {
            if (!e.isIntersecting || !NATURAL.has(e.target.dataset.xiqState)) continue;
            const id = dom.tweetIdOf(e.target);
            if (id) onScreen.add(id);
          }
        });
      }
      watched.add(article);
      io.observe(article);
    }

    function inViewport(article) {
      const r = article.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight;
    }

    // Whether hiding this post now would move something the reader has seen: it was on screen, or it sits
    // above the viewport at its natural height (shrinking it would shift everything under the reader).
    // A fresh mount is never latched: hiding it happens before X measures it, so nothing moves.
    function isLatched(id, article) {
      if (onScreen.has(id)) return true;
      const prev = article.dataset.xiqState;
      if (!prev || !NATURAL.has(prev)) return false;
      return article.getBoundingClientRect().bottom <= 0;
    }

    // A cell (list item) can hold several posts: X draws a conversation as one item. The cell itself is only
    // removed when every post in it is; otherwise the removed post hides on its own.
    function syncCell(cell) {
      if (!cell) return;
      const arts = dom.articlesIn(cell);
      if (!arts.length) return;
      if (arts.every((a) => a.dataset.xiqAd === '1')) setCell(cell, 'ad');
      else if (arts.every((a) => a.dataset.xiqState === 'removed' || a.dataset.xiqAd === '1')) setCell(cell, 'filtered');
      else setCell(cell, null);
    }

    function processArticle(article, active, s) {
      const id = dom.tweetIdOf(article);
      const cell = dom.cellOf(article);
      watch(article);
      if (!id) {
        // Promoted posts often show "Ad" where the timestamp would be, so they have no status link.
        const isAd = s.hideAds && dom.isPromotedArticle(article);
        if (isAd && article.dataset.xiqAd !== '1') adsHidden.add('dom:' + adsHidden.size);
        if (isAd) article.dataset.xiqAd = '1';
        else delete article.dataset.xiqAd;
        if (!isAd) render(article, 'off');
        syncCell(cell);
        return;
      }
      const sc = scores.get(id);
      const key = [id, version, active ? 1 : 0, sc ? 1 : 0, revealed.has(id) ? 1 : 0, failed.has(id) ? 1 : 0].join(':');
      // X sometimes re-renders the author row, which drops the chip; put it back.
      const chipMissing = article.dataset.xiqWantsChip === '1' && !article.querySelector('.xiq-chip');
      if (article.dataset.xiqKey === key && !chipMissing) return;
      article.dataset.xiqKey = key;
      delete article.dataset.xiqWantsChip;

      if (promoted.has(id) || dom.isPromotedArticle(article)) {
        promoted.add(id);
        if (s.hideAds) {
          adsHidden.add(id);
          article.dataset.xiqAd = '1';
          render(article, 'off');
          syncCell(cell);
          return;
        }
      }
      delete article.dataset.xiqAd;

      if (!active) {
        render(article, 'off');
        syncCell(cell);
        return;
      }

      if (!sc) {
        if (!requested.has(id) && !failed.has(id)) {
          let t = tweetData.get(id);
          if (!t) {
            t = dom.extractTweet(article, id);
            tweetData.set(id, t);
          }
          request([t]);
        }
        const startedAt = requested.get(id);
        if (!failed.has(id) && startedAt && Date.now() - startedAt > PENDING_TIMEOUT) failed.add(id);
        if (failed.has(id) || s.pendingStyle !== 'blur') {
          render(article, 'unscored');
        } else {
          render(article, 'pending');
          armTimeout();
        }
        // Painted at natural height on screen: from here on a late score must not resize it.
        if (inViewport(article)) onScreen.add(id);
        syncCell(cell);
        return;
      }

      seen.add(id);
      const d = XIQ.decide(sc, s);
      let hide = d.hide && !revealed.has(id);
      if (hide && isLatched(id, article)) {
        latched.add(id);
        hide = false;
      } else {
        latched.delete(id);
      }
      if (hide) {
        if (s.hiddenStyle === 'remove') render(article, 'removed');
        else render(article, 'collapsed', { label: hiddenLabel(sc, d, s) });
      } else {
        // A latched post shows like a revealed one: full post, dashed chip that says it would be hidden.
        const chip = s.showBadges ? { id, sc, revealed: d.hide } : null;
        if (chip) article.dataset.xiqWantsChip = '1';
        render(article, d.hide ? 'revealed' : 'shown', { chip });
      }
      syncCell(cell);
    }

    // Non-post cells. A heading ("Who to follow", "Subscribe to Premium"…) starts a module, and every
    // non-post cell after it belongs to that module until the next post, like Control Panel for Twitter does.
    function processCells(s) {
      const hideModules = s.hideSuggestions && dom.isHome();
      let inModule = false;
      for (const cell of dom.cells()) {
        const kind = dom.cellKind(cell);
        if (kind === 'post') {
          inModule = false;
          continue;
        }
        if (kind === 'heading') inModule = true;
        let reason = null;
        if (kind === 'ad' && s.hideAds) reason = 'ad';
        else if (hideModules && (kind === 'heading' || kind === 'suggestion' || inModule)) reason = 'suggestion';
        if (reason === 'ad' && cell.dataset.xiqRemove !== 'ad') adsHidden.add('cell:' + adsHidden.size);
        if (reason) setCell(cell, reason);
        else if (cell.dataset.xiqRemove === 'suggestion' || cell.dataset.xiqRemove === 'ad') setCell(cell, null);
      }
    }

    function processAll() {
      const s = settings();
      const active = filterActive();
      processCells(s);
      for (const article of dom.articles()) processArticle(article, active, s);
    }

    function schedule() {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        processAll();
        ctx.onStats();
      });
    }

    function reveal(id) {
      revealed.add(id);
      schedule();
    }

    // User actions may resize posts on screen; that's expected when you asked for it.
    function hideAgain(id) {
      revealed.delete(id);
      onScreen.delete(id);
      latched.delete(id);
      version++;
      schedule();
    }

    let refreshOffered = false;
    // filterChanged: false for UI-only changes (collapsing the panel), which must not resize posts.
    function onSettingsChanged(filterChanged = true) {
      if (filterChanged) {
        onScreen.clear();
        latched.clear();
        if (stripped.size) refreshOffered = true;
      }
      version++;
      schedule();
      queueMicrotask(() => ctx.chips.refresh());
    }

    function onLlmChanged() {
      failed.clear();
      requested.clear();
      llmError = null;
      version++;
      schedule();
    }

    function stats() {
      const s = settings();
      let hidden = 0;
      let scored = 0;
      // Score distributions of the posts seen this session (rendered, or removed before X showed them).
      const dist = { s: new Array(11).fill(0), b: new Array(11).fill(0) };
      for (const set of [seen, stripped]) {
        for (const id of set) {
          const sc = scores.get(id);
          if (!sc || (set === stripped && seen.has(id))) continue;
          scored++;
          dist.s[sc.s]++;
          dist.b[sc.b]++;
          if (!revealed.has(id) && !latched.has(id) && XIQ.decide(sc, s).hide) hidden++;
        }
      }
      let pending = 0;
      for (const id of requested.keys()) if (!scores.has(id) && !failed.has(id)) pending++;
      return { scored, hidden, ads: adsHidden.size, pending, error: llmError, active: filterActive(), dist, stripped: stripped.size, refresh: refreshOffered };
    }

    return { onTimeline, onGate, applyScores, markFailed, processAll, schedule, reveal, hideAgain, onSettingsChanged, onLlmChanged, stats, setError };
  }

  root.XIQ = Object.assign(root.XIQ || {}, { createFeed });
})(typeof globalThis !== 'undefined' ? globalThis : this);
