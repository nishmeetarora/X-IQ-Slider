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

  // Old payloads keep media under legacy; the rewrite's payloads use media_entities2 at the top.
  function mediaList(tweet) {
    const legacy = L(tweet);
    if (Array.isArray(tweet.media_entities2) && tweet.media_entities2.length) return tweet.media_entities2;
    return legacy.extended_entities?.media || legacy.entities?.media || [];
  }

  function textOf(tweet) {
    const legacy = L(tweet);
    const note = tweet.note_tweet?.note_tweet_results?.result;
    let text = note?.text || tweet.details?.full_text || legacy.full_text || '';
    // The rewrite's display_text_range (in code points) cuts the trailing media link and leading reply mentions.
    const range = !note && tweet.details?.display_text_range;
    if (Array.isArray(range) && range.length === 2) text = Array.from(text).slice(range[0], range[1]).join('');
    const urls = note?.entity_set?.urls || (note ? [] : tweet.url_entities) || legacy.entities?.urls || [];
    for (const u of urls) {
      if (u.url) text = text.split(u.url).join(u.display_url || u.expanded_url || '');
    }
    // Media links (pic.x.com/...) are noise; media is described separately.
    for (const m of mediaList(tweet)) {
      if (m.url) text = text.split(m.url).join('');
    }
    text = decodeEntities(text).trim();
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + '… (truncated)';
    return text;
  }

  function mediaOf(tweet) {
    return mediaList(tweet).map((m) => ({ type: m.type === 'photo' ? 'image' : m.type || 'media', alt: (m.ext_alt_text || '').slice(0, 200) }));
  }

  function cardOf(tweet) {
    const values = tweet.card?.legacy?.binding_values;
    if (!Array.isArray(values)) return null;
    const get = (k) => values.find((v) => v.key === k)?.value?.string_value || '';
    let title = get('title');
    let domain = get('vanity_url') || get('domain');
    // Website cards (mostly on ads) pack their fields into a JSON string.
    const unified = get('unified_card');
    if (unified && !title) {
      try {
        const u = JSON.parse(unified);
        for (const c of Object.values(u.component_objects || {})) {
          const t = c?.data?.title;
          if (t) {
            title = typeof t === 'string' ? t : t.content || '';
            break;
          }
        }
        for (const d of Object.values(u.destination_objects || {})) {
          const v = d?.data?.url_data?.vanity;
          if (v) {
            domain = v;
            break;
          }
        }
      } catch (_) {}
    }
    if (!title && !domain) return null;
    return { title: title.slice(0, 160), domain };
  }

  function toTweet(result) {
    const tweet = unwrap(result);
    if (!tweet) return null;
    const rt = L(tweet).retweeted_status_result || L(tweet).retweeted_status_results || tweet.retweeted_status_results;
    const retweeted = unwrap(rt?.result);
    if (retweeted) {
      // The DOM shows (and links to) the original tweet, so key on the original.
      const inner = toTweet(retweeted);
      if (inner) inner.retweetedBy = userOf(tweet).handle;
      return inner;
    }
    const id = tweet.rest_id || L(tweet).id_str;
    if (!id) return null;
    const quotedRaw = unwrap((tweet.quoted_status_result || tweet.quoted_tweet_results)?.result);
    const out = {
      id: String(id),
      user: userOf(tweet),
      text: textOf(tweet),
      media: mediaOf(tweet),
      card: cardOf(tweet),
      reply: !!(L(tweet).in_reply_to_status_id_str || tweet.reply_to_results?.rest_id),
    };
    if (quotedRaw) {
      out.quote = { user: userOf(quotedRaw), text: textOf(quotedRaw).slice(0, 400), media: mediaOf(quotedRaw).length > 0 };
    }
    return out;
  }

  function isPromotedEntry(itemContent, entryId) {
    return !!(itemContent.promotedMetadata || itemContent.promoted_metadata) || /^promoted/i.test(entryId || '');
  }

  // Returns { tweets: Tweet[], promotedIds: string[] }
  function parseTimeline(json) {
    const tweets = [];
    const promotedIds = [];
    const seen = new Set();

    function handleItem(itemContent, entryId) {
      const type = itemContent.itemType || itemContent.__typename;
      if (type && type !== 'TimelineTweet') return;
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
      // Old payloads: entryId + itemContent. The rewrite: entry_id + content (an item's content nests another content).
      if (typeof node.entryId === 'string') entryId = node.entryId;
      else if (typeof node.entry_id === 'string') entryId = node.entry_id;
      const item = node.itemContent?.tweet_results ? node.itemContent : node.content?.tweet_results ? node.content : null;
      if (item) {
        handleItem(item, entryId);
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

  // Removes posts, ads and suggestion modules from a timeline payload before X's app sees it, so its virtualized
  // list never lays out (and later collapses) a post we hide. Works on both payload formats; edits json in place.
  // opts: { dropIds: Set of post ids (as parseTimeline keys them, so reposts by the original id),
  //         dropAds: bool, dropSuggestions: bool }
  // Returns { changed, posts, ads, modules } (how many of each were removed), and removed: [{ id, own }] for each
  // removed post, where own is the id X itself knows the entry by (a repost's own id, not the original's).
  function stripTimeline(json, opts) {
    const dropIds = opts.dropIds || new Set();
    const out = { changed: false, posts: 0, ads: 0, modules: 0, removed: [] };

    function noteRemoved(payload) {
      let r = payload && payload.tweet_results && payload.tweet_results.result;
      if (r && r.__typename === 'TweetWithVisibilityResults') r = r.tweet;
      const t = toTweet(payload.tweet_results.result);
      if (t) out.removed.push({ id: t.id, own: String((r && (r.rest_id || r.legacy?.id_str)) || t.id) });
    }

    const idOf = (e) => (typeof e.entryId === 'string' ? e.entryId : typeof e.entry_id === 'string' ? e.entry_id : '');
    // An item's payload: old format nests it in itemContent, the rewrite in content.
    const payloadOf = (holder) => holder && (holder.itemContent || holder.content);

    // 'keep' | 'post' | 'ad' for one timeline item.
    function itemVerdict(payload, entryId) {
      if (!payload) return 'keep';
      const type = payload.itemType || payload.__typename || '';
      if (payload.tweet_results) {
        const promoted = isPromotedEntry(payload, entryId);
        if (promoted) return opts.dropAds ? 'ad' : 'keep';
        const t = toTweet(payload.tweet_results.result);
        return t && dropIds.has(t.id) ? 'post' : 'keep';
      }
      if (/Ad$/.test(type)) return opts.dropAds ? 'ad' : 'keep';
      return 'keep';
    }

    function isSuggestionModule(entryId, items) {
      if (/^(who-to-follow|who-to-subscribe|connect-|follow-)/i.test(entryId)) return true;
      if (!items.length) return false;
      return items.every((it) => {
        const p = payloadOf(it.item);
        const type = (p && (p.itemType || p.__typename)) || '';
        return type === 'TimelineUser' || /Prompt$/.test(type);
      });
    }

    function keepEntry(entry) {
      const entryId = idOf(entry);
      const content = entry.content || {};
      if (Array.isArray(content.items)) {
        if (opts.dropSuggestions && isSuggestionModule(entryId, content.items)) {
          out.modules++;
          return false;
        }
        // Conversations stay whole: X draws them as one thread, so dropping a member would leave a broken thread.
        // Only a conversation whose posts are all hidden goes; mixed ones are handled on the page.
        const verdicts = content.items.map((it) => itemVerdict(payloadOf(it.item), idOf(it) || entryId));
        const posts = content.items.filter((it) => payloadOf(it.item)?.tweet_results).length;
        const dropped = verdicts.filter((v) => v !== 'keep').length;
        if (!posts || dropped < posts) return true;
        content.items.forEach((it, i) => verdicts[i] === 'post' && noteRemoved(payloadOf(it.item)));
        out.posts += verdicts.filter((v) => v === 'post').length;
        out.ads += verdicts.filter((v) => v === 'ad').length;
        return false;
      }
      // Cursors have no item payload, so they always stay.
      const v = itemVerdict(payloadOf(content), entryId);
      if (v === 'post') {
        out.posts++;
        noteRemoved(payloadOf(content));
      }
      if (v === 'ad') out.ads++;
      return v === 'keep';
    }

    function walk(node, depth) {
      if (!node || typeof node !== 'object' || depth > 8) return;
      if (Array.isArray(node.instructions)) {
        for (const ins of node.instructions) {
          if (!ins || !Array.isArray(ins.entries)) continue;
          const before = ins.entries.length;
          ins.entries = ins.entries.filter(keepEntry);
          if (ins.entries.length !== before) out.changed = true;
        }
        return;
      }
      for (const key in node) {
        const v = node[key];
        if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, depth + 1);
      }
    }

    walk(json, 0);
    return out;
  }

  // Cursor values in a payload, so a later request can be told apart: one that sends a top cursor asks for newer posts.
  function cursorsOf(json) {
    const top = [];
    const bottom = [];
    (function walk(node, depth) {
      if (!node || typeof node !== 'object' || depth > 12) return;
      if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
      const id = typeof node.entryId === 'string' ? node.entryId : typeof node.entry_id === 'string' ? node.entry_id : '';
      const value = node.content && typeof node.content.value === 'string' ? node.content.value : null;
      if (value && /^cursor-top/.test(id)) top.push(value);
      else if (value && /^cursor-bottom/.test(id)) bottom.push(value);
      else for (const k in node) if (k !== 'tweet_results') walk(node[k], depth + 1);
    })(json, 0);
    return { top, bottom };
  }

  // The cursor a timeline request was made with, from its URL's variables (null for a fresh load).
  function requestCursor(url) {
    try {
      const vars = new URL(url, 'https://x.com').searchParams.get('variables');
      const c = vars && JSON.parse(vars).cursor;
      return typeof c === 'string' ? c : null;
    } catch (_) {
      return null;
    }
  }

  const api = { parseTimeline, toTweet, stripTimeline, cursorsOf, requestCursor };
  root.XIQ = Object.assign(root.XIQ || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
