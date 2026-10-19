// Decides, for every rendered tweet, whether it is pending, shown, collapsed or removed.
// All visual changes are data-* attributes styled by content.css, so X's React tree is never restructured.
(function (root) {
  'use strict';

  const PENDING_TIMEOUT = 12000;
  const REQUEST_CHUNK = 40;

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
    const adsHidden = new Set();
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

    function onTimeline(op, text) {
      let json;
      try {
        json = JSON.parse(text);
      } catch (_) {
        return;
      }
      const { tweets, promotedIds } = XIQ.parseTimeline(json);
      for (const id of promotedIds) promoted.add(id);
      for (const t of tweets) {
        const prev = tweetData.get(t.id);
        if (!prev || prev.fromDom) tweetData.set(t.id, t);
      }
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
    }

    function markFailed(ids, error) {
      for (const id of ids) {
        if (!scores.has(id)) failed.add(id);
      }
      if (error) setError(error);
      schedule();
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

    function processArticle(article, active, s) {
      const id = dom.tweetIdOf(article);
      const cell = dom.cellOf(article);
      if (!id) {
        // Promoted posts often show "Ad" where the timestamp would be, so they have no status link.
        if (s.hideAds && dom.isPromotedArticle(article)) {
          if (cell && cell.dataset.xiqRemove !== 'ad') adsHidden.add('dom:' + adsHidden.size);
          setCell(cell, 'ad');
        } else if (cell && cell.dataset.xiqRemove === 'ad') {
          setCell(cell, null);
        }
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
          setCell(cell, 'ad');
          render(article, 'off');
          return;
        }
      }

      if (!active) {
        setCell(cell, null);
        render(article, 'off');
        return;
      }

      if (!sc) {
        setCell(cell, null);
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
        return;
      }

      seen.add(id);
      const d = XIQ.decide(sc, s);
      if (d.hide && !revealed.has(id)) {
        if (s.hiddenStyle === 'remove') {
          setCell(cell, 'filtered');
          render(article, 'removed');
        } else {
          setCell(cell, null);
          render(article, 'collapsed', { label: hiddenLabel(sc, d, s) });
        }
      } else {
        setCell(cell, null);
        const chip = s.showBadges ? { id, sc, revealed: d.hide } : null;
        if (chip) article.dataset.xiqWantsChip = '1';
        render(article, d.hide ? 'revealed' : 'shown', { chip });
      }
    }

    // Non-post cells. A heading ("Who to follow", "Subscribe to Premium"…) starts a module, and every
    // non-post cell after it belongs to that module until the next post, like Control Panel for Twitter does.
    function processCells(s) {
      const col = document.querySelector(dom.SEL.primaryColumn);
      if (!col) return;
      const hideModules = s.hideSuggestions && dom.isHome();
      let inModule = false;
      for (const cell of col.querySelectorAll(dom.SEL.cell)) {
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
      for (const article of document.querySelectorAll(dom.SEL.article)) processArticle(article, active, s);
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

    function hideAgain(id) {
      revealed.delete(id);
      schedule();
    }

    function onSettingsChanged() {
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
      // Score distributions of the posts seen this session, for the panel's histograms.
      const dist = { s: new Array(11).fill(0), b: new Array(11).fill(0) };
      for (const id of seen) {
        const sc = scores.get(id);
        if (!sc) continue;
        dist.s[sc.s]++;
        dist.b[sc.b]++;
        if (!revealed.has(id) && XIQ.decide(sc, s).hide) hidden++;
      }
      let pending = 0;
      for (const id of requested.keys()) if (!scores.has(id) && !failed.has(id)) pending++;
      return { scored: seen.size, hidden, ads: adsHidden.size, pending, error: llmError, active: filterActive(), dist };
    }

    return { onTimeline, applyScores, markFailed, processAll, schedule, reveal, hideAgain, onSettingsChanged, onLlmChanged, stats, setError };
  }

  root.XIQ = Object.assign(root.XIQ || {}, { createFeed });
})(typeof globalThis !== 'undefined' ? globalThis : this);
