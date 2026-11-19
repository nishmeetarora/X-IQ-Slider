// Everything that depends on X's page structure lives here, so fixes after an X redesign stay in one file.
(function (root) {
  'use strict';

  // X runs two web apps: the older one tags everything with data-testid, and the rewrite (Nov 2026) has no
  // data-testid at all. Every selector here covers both.
  const SEL = {
    search: 'form[role="search"]',
    tab: '[role="tablist"] [role="tab"]',
    // A timeline cell: old app's cellInnerDiv, or the rewrite's virtualized list item.
    cell: '[data-testid="cellInnerDiv"], li[data-index]',
    // Old: tweetText. Rewrite: the post body is the only div carrying both dir and lang.
    tweetText: '[data-testid="tweetText"], div[dir][lang]',
    userName: '[data-testid="User-Name"]',
    userCell: '[data-testid="UserCell"]',
    media:
      '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"], video, img[src*="twimg.com/media/"], img[src*="video_thumb"]',
    mediaImg: '[data-testid="tweetPhoto"] img, img[src*="twimg.com/media/"]',
    card: '[data-testid="card.wrapper"]',
  };

  const AD_LABELS = new Set(['Ad', 'Ads', 'Promoted', 'Sponsored']);
  const STATUS_RE = /\/status\/(\d+)/;

  function primaryColumn() {
    return document.querySelector('[data-testid="primaryColumn"]') || document.querySelector('main');
  }

  function sidebarColumn() {
    const old = document.querySelector('[data-testid="sidebarColumn"]');
    if (old) return old;
    for (const aside of document.querySelectorAll('aside')) if (!aside.closest('main')) return aside;
    return null;
  }

  // The rewrite nests <article>s: a repost is an outer <article> ("X reposted") whose child <article> is the post,
  // and a quoted post is an <article> inside the post's <article>. Only the outermost one is a timeline item.
  function isTopArticle(article) {
    return !article.parentElement || !article.parentElement.closest('article');
  }

  function articles() {
    const col = primaryColumn();
    if (!col) return [];
    return [...col.querySelectorAll('article')].filter(isTopArticle);
  }

  function articlesIn(cell) {
    return [...cell.querySelectorAll('article')].filter(isTopArticle);
  }

  function cells() {
    const col = primaryColumn();
    return col ? col.querySelectorAll(SEL.cell) : [];
  }

  // The <article> holding the post itself: the reposted child for reposts, else the item's own.
  function bodyOf(article) {
    return article.querySelector(':scope > article') || article;
  }

  // Elements of this post only, skipping the repost line and anything inside a quoted post.
  function own(article, selector) {
    const body = bodyOf(article);
    return [...body.querySelectorAll(selector)].filter((el) => el.closest('article') === body);
  }

  function tweetIdOf(article) {
    // Rewrite: the post is wrapped in <div role="link" data-href="/user/status/123">.
    const wrap = article.parentElement && article.parentElement.closest('[data-href]');
    if (wrap && !wrap.closest('article')) {
      const m = (wrap.getAttribute('data-href') || '').match(STATUS_RE);
      if (m) return m[1];
    }
    // Old app: the timestamp link always points at the tweet itself (quoted tweets come later in the DOM).
    const time = article.querySelector('a[href*="/status/"] time');
    const link = time ? time.closest('a') : null;
    const m = link && link.getAttribute('href').match(STATUS_RE);
    if (m) return m[1];
    // Rewrite ads have no timestamp, but still link to their own status (analytics, media).
    if (!article.hasAttribute('data-testid')) {
      for (const a of own(article, 'a[href*="/status/"]')) {
        const mm = a.getAttribute('href').match(STATUS_RE);
        if (mm) return mm[1];
      }
    }
    return null;
  }

  function cellOf(article) {
    return article.closest(SEL.cell);
  }

  // Where the score chip goes: the row with the author's name, handle and time.
  function authorRow(article) {
    const old = article.querySelector(SEL.userName);
    if (old) return old;
    const handle = own(article, 'a[href^="/"] span').find((s) => /^@\w{1,15}$/.test(s.textContent.trim()));
    const nameBox = handle && handle.closest('div[id]');
    return nameBox && bodyOf(article).contains(nameBox.parentElement) ? nameBox.parentElement : null;
  }

  function authorOf(article) {
    const old = article.querySelector(SEL.userName);
    if (old) {
      const text = old.innerText || '';
      return { handle: (text.match(/@(\w{1,15})/) || [])[1] || '', name: text.split('\n')[0] || '' };
    }
    const handleEl = own(article, 'a[href^="/"] span').find((s) => /^@\w{1,15}$/.test(s.textContent.trim()));
    const handle = handleEl ? handleEl.textContent.trim().slice(1) : '';
    const nameEl = handle ? own(article, `a[href="/${handle}"] div[dir]`)[0] : null;
    return { handle, name: nameEl ? nameEl.textContent.trim() : '' };
  }

  function isPromotedArticle(article) {
    // Old app: X wraps promoted posts in a placementTracking element. (Videos inside normal posts use it too,
    // but those sit inside the article, so only an ancestor counts.) The rewrite has no DOM marker; there the
    // API's promoted_metadata is the only signal (see timeline.js).
    if (article.closest('[data-testid="placementTracking"]')) return true;
    // Fallback: the small "Ad" label in the post header.
    for (const span of article.querySelectorAll('span')) {
      if (span.childElementCount) continue;
      const text = span.textContent.trim();
      if (!AD_LABELS.has(text)) continue;
      if (span.closest(SEL.tweetText) || span.closest(SEL.userName)) continue;
      return true;
    }
    return false;
  }

  // Fallback when the API hook didn't see a tweet: read what's rendered.
  function extractTweet(article, id) {
    const texts = article.querySelectorAll(SEL.tweetText);
    const { handle, name } = authorOf(article);
    const alts = [...article.querySelectorAll(SEL.mediaImg)]
      .map((img) => img.getAttribute('alt') || '')
      .filter((alt) => alt && alt !== 'Image');
    const hasMedia = !!article.querySelector(SEL.media);
    const card = article.querySelector(SEL.card);
    const tweet = {
      id,
      user: { handle, name },
      text: (texts[0]?.innerText || '').slice(0, 800),
      media: hasMedia ? (alts.length ? alts.map((alt) => ({ type: 'image', alt })) : [{ type: 'media', alt: '' }]) : [],
      card: card ? { title: card.innerText.replace(/\s+/g, ' ').slice(0, 160), domain: '' } : null,
      reply: false,
      fromDom: true,
    };
    if (texts[1]) tweet.quote = { user: { handle: '', name: '' }, text: texts[1].innerText.slice(0, 400), media: false };
    return tweet;
  }

  function isHome() {
    return location.pathname === '/home';
  }

  // "For you" is always the first tab on /home; pinned lists and Following come after it.
  function selectedHomeTab() {
    const col = primaryColumn();
    const tabs = col ? col.querySelectorAll(SEL.tab) : [];
    if (!tabs.length) return 'foryou';
    const idx = [...tabs].findIndex((t) => t.getAttribute('aria-selected') === 'true');
    return idx <= 0 ? 'foryou' : 'other';
  }

  // Timeline cells that aren't posts: module headings ("Who to follow"), the users under them, "Show more",
  // upsell prompts, and non-post ad units.
  function cellKind(cell) {
    if (cell.querySelector('article')) return 'post';
    if (cell.querySelector('[data-testid="placementTracking"]')) return 'ad';
    if (cell.querySelector('h2')) return 'heading';
    if (cell.querySelector(`${SEL.userCell}, [data-testid="inlinePrompt"], a[href^="/i/connect_people"], a[href^="/i/premium"], a[href^="/i/verified"], [data-who-to-follow]`)) return 'suggestion';
    return 'other';
  }

  function readTheme() {
    const bg = getComputedStyle(document.body || document.documentElement).backgroundColor || 'rgb(0, 0, 0)';
    const nums = (bg.match(/\d+(\.\d+)?/g) || ['0', '0', '0']).map(Number);
    const [r, g, b] = nums;
    const transparent = nums.length === 4 && nums[3] === 0;
    const lum = transparent ? 0 : (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const dark = lum < 0.5;
    // Monochrome, like X's 2026 web app: ink and grays, hairline borders, tints of the ink for fills.
    // Tints are translucent so they sit right on light, dim and dark backgrounds alike.
    const ink = dark ? '255, 255, 255' : '0, 0, 0';
    return {
      dark,
      bg: transparent ? 'rgb(0, 0, 0)' : bg,
      fg: dark ? 'rgb(242, 242, 242)' : 'rgb(0, 0, 0)',
      muted: dark ? 'rgb(145, 145, 145)' : 'rgb(102, 102, 102)',
      border: `rgba(${ink}, ${dark ? 0.12 : 0.08})`,
      raised: `rgba(${ink}, ${dark ? 0.06 : 0.04})`,
      hover: `rgba(${ink}, ${dark ? 0.1 : 0.07})`,
      // Empty slider tracks, meter cells and out-of-range histogram bars.
      track: `rgba(${ink}, ${dark ? 0.16 : 0.1})`,
      // Kept for warnings only (bait, errors).
      danger: dark ? 'rgb(255, 99, 105)' : 'rgb(220, 50, 60)',
      shadow: dark
        ? '0 0 0 1px rgba(255, 255, 255, 0.1), 0 8px 28px rgba(0, 0, 0, 0.6)'
        : '0 0 0 1px rgba(0, 0, 0, 0.06), 0 8px 28px rgba(0, 0, 0, 0.1)',
    };
  }

  // The element whose children are the sidebar widgets; its first child holds the search box.
  // Same fixed depth Control Panel for Twitter uses. Returns null if the page doesn't match, so the caller can fall back.
  function sidebarContents(col) {
    const fixed = col.querySelector(':scope > div > div > div > div > div');
    if (!fixed) return null;
    const search = col.querySelector(SEL.search);
    if (search) return fixed.firstElementChild && fixed.firstElementChild.contains(search) ? fixed : null;
    return fixed.children.length > 1 ? fixed : null;
  }

  const api = {
    SEL,
    primaryColumn,
    sidebarColumn,
    articles,
    articlesIn,
    cells,
    tweetIdOf,
    cellOf,
    authorRow,
    isPromotedArticle,
    extractTweet,
    isHome,
    selectedHomeTab,
    cellKind,
    sidebarContents,
    readTheme,
  };
  root.XIQ = Object.assign(root.XIQ || {}, { dom: api });
})(typeof globalThis !== 'undefined' ? globalThis : this);
