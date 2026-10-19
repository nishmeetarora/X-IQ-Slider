// Turns X's GraphQL timeline JSON into compact tweet objects for scoring.
// Walks the whole payload instead of hard-coding one path, because X moves things around.
(function (root) {
  'use strict';

  const MAX_TEXT = 800;

  function unwrap(result) {
    if (!result) return null;
    if (result.__typename === 'TweetWithVisibilityResults') return result.tweet || null;
    if (result.__typename === 'TweetTombstone' || result.__typename === 'TweetUnavailable') return null;
    return result.legacy || result.rest_id ? result : null;
  }

  // X sometimes sends tweets with the usual legacy fields at the top level instead.
  function L(tweet) {
    return tweet.legacy || tweet;
  }

  function userOf(tweet) {
    const u = tweet?.core?.user_results?.result;
    if (!u) return { handle: '', name: '' };
    return {
      handle: u.core?.screen_name || u.legacy?.screen_name || '',
      name: u.core?.name || u.legacy?.name || '',
    };
  }

  function decodeEntities(s) {
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }

  function textOf(tweet) {
    const legacy = L(tweet);
    const note = tweet.note_tweet?.note_tweet_results?.result;
    let text = note?.text || legacy.full_text || '';
    const entities = note?.entity_set || legacy.entities || {};
    for (const u of entities.urls || []) {
      if (u.url) text = text.split(u.url).join(u.display_url || u.expanded_url || '');
    }
    // Media links (pic.x.com/...) are noise; media is described separately.
    for (const m of legacy.extended_entities?.media || legacy.entities?.media || []) {
      if (m.url) text = text.split(m.url).join('');
    }
    text = decodeEntities(text).trim();
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + '… (truncated)';
    return text;
  }

  function mediaOf(tweet) {
    const media = L(tweet).extended_entities?.media || L(tweet).entities?.media || [];
    return media.map((m) => ({ type: m.type === 'photo' ? 'image' : m.type || 'media', alt: (m.ext_alt_text || '').slice(0, 200) }));
  }

  function cardOf(tweet) {
    const values = tweet.card?.legacy?.binding_values;
    if (!Array.isArray(values)) return null;
    const get = (k) => values.find((v) => v.key === k)?.value?.string_value || '';
    const title = get('title');
    const domain = get('vanity_url') || get('domain');
    if (!title && !domain) return null;
    return { title: title.slice(0, 160), domain };
  }

  function toTweet(result) {
    const tweet = unwrap(result);
    if (!tweet) return null;
    const retweeted = unwrap(L(tweet).retweeted_status_result?.result);
    if (retweeted) {
      // The DOM shows (and links to) the original tweet, so key on the original.
      const inner = toTweet(retweeted);
      if (inner) inner.retweetedBy = userOf(tweet).handle;
      return inner;
    }
    const id = tweet.rest_id || L(tweet).id_str;
    if (!id) return null;
    const quotedRaw = unwrap(tweet.quoted_status_result?.result);
    const out = {
      id: String(id),
      user: userOf(tweet),
      text: textOf(tweet),
      media: mediaOf(tweet),
      card: cardOf(tweet),
      reply: !!L(tweet).in_reply_to_status_id_str,
    };
    if (quotedRaw) {
      out.quote = { user: userOf(quotedRaw), text: textOf(quotedRaw).slice(0, 400), media: mediaOf(quotedRaw).length > 0 };
    }
    return out;
  }

  function isPromotedEntry(itemContent, entryId) {
    return !!itemContent.promotedMetadata || /^promoted/i.test(entryId || '');
  }

  // Returns { tweets: Tweet[], promotedIds: string[] }
  function parseTimeline(json) {
    const tweets = [];
    const promotedIds = [];
    const seen = new Set();

    function handleItem(itemContent, entryId) {
      if (itemContent.itemType && itemContent.itemType !== 'TimelineTweet') return;
      const t = toTweet(itemContent.tweet_results?.result);
      if (!t || seen.has(t.id)) return;
      seen.add(t.id);
      if (isPromotedEntry(itemContent, entryId)) promotedIds.push(t.id);
      else tweets.push(t);
    }

    function walk(node, entryId, depth) {
      if (!node || typeof node !== 'object' || depth > 14) return;
      if (Array.isArray(node)) {
        for (const child of node) walk(child, entryId, depth + 1);
        return;
      }
      if (typeof node.entryId === 'string') entryId = node.entryId;
      if (node.itemContent && node.itemContent.tweet_results) {
        handleItem(node.itemContent, entryId);
        return;
      }
      for (const key in node) {
        // Tweet bodies are handled in handleItem; don't descend into them.
        if (key === 'tweet_results' || key === 'legacy' || key === 'core') continue;
        const v = node[key];
        if (v && typeof v === 'object') walk(v, entryId, depth + 1);
      }
    }

    walk(json, '', 0);
    return { tweets, promotedIds };
  }

  const api = { parseTimeline, toTweet };
  root.XIQ = Object.assign(root.XIQ || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
