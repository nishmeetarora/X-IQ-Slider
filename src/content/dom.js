// Everything that depends on X's page structure lives here, so fixes after an X redesign stay in one file.
(function (root) {
  'use strict';

  const SEL = {
    primaryColumn: '[data-testid="primaryColumn"]',
    sidebar: '[data-testid="sidebarColumn"]',
    cell: '[data-testid="cellInnerDiv"]',
    article: 'article[data-testid="tweet"]',
    tweetText: '[data-testid="tweetText"]',
    userName: '[data-testid="User-Name"]',
    userCell: '[data-testid="UserCell"]',
    media: '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"]',
    card: '[data-testid="card.wrapper"]',
    search: 'form[role="search"]',
    tab: '[role="tablist"] [role="tab"]',
  };

  const AD_LABELS = new Set(['Ad', 'Ads', 'Promoted', 'Sponsored']);

  function tweetIdOf(article) {
    // The timestamp link always points at the tweet itself (quoted tweets come later in the DOM).
    const time = article.querySelector('a[href*="/status/"] time');
    const link = time ? time.closest('a') : null;
    const m = link && link.getAttribute('href').match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }

  function cellOf(article) {
    return article.closest(SEL.cell);
  }

  function isPromotedArticle(article) {
    // X wraps promoted posts in a placementTracking element. (Videos inside normal posts use it too,
    // but those sit inside the article, so only an ancestor counts.)
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
    const nameText = article.querySelector(SEL.userName)?.innerText || '';
    const handle = (nameText.match(/@(\w{1,15})/) || [])[1] || '';
    const name = nameText.split('\n')[0] || '';
    const alts = [...article.querySelectorAll('[data-testid="tweetPhoto"] img')]
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
    const col = document.querySelector(SEL.primaryColumn);
    const tabs = col ? col.querySelectorAll(SEL.tab) : [];
    if (!tabs.length) return 'foryou';
    const idx = [...tabs].findIndex((t) => t.getAttribute('aria-selected') === 'true');
    return idx <= 0 ? 'foryou' : 'other';
  }

  // Timeline cells that aren't posts: module headings ("Who to follow"), the users under them, "Show more",
  // upsell prompts, and non-post ad units.
  function cellKind(cell) {
    if (cell.querySelector(SEL.article)) return 'post';
    if (cell.querySelector('[data-testid="placementTracking"]')) return 'ad';
    if (cell.querySelector('h2')) return 'heading';
    if (cell.querySelector(`${SEL.userCell}, [data-testid="inlinePrompt"], a[href^="/i/connect_people"], a[href^="/i/premium"], a[href^="/i/verified"]`)) return 'suggestion';
    return 'other';
  }

  function readTheme() {
    const bg = getComputedStyle(document.body || document.documentElement).backgroundColor || 'rgb(0, 0, 0)';
    const nums = (bg.match(/\d+(\.\d+)?/g) || ['0', '0', '0']).map(Number);
    const [r, g, b] = nums;
    const transparent = nums.length === 4 && nums[3] === 0;
    const lum = transparent ? 0 : (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const dark = lum < 0.5;
    return {
      dark,
      bg: transparent ? 'rgb(0, 0, 0)' : bg,
      fg: dark ? 'rgb(231, 233, 234)' : 'rgb(15, 20, 25)',
      muted: dark ? 'rgb(113, 118, 123)' : 'rgb(83, 100, 113)',
      border: dark ? (r > 10 ? 'rgb(56, 68, 77)' : 'rgb(47, 51, 54)') : 'rgb(239, 243, 244)',
      raised: dark ? (r > 10 ? 'rgb(30, 39, 50)' : 'rgb(22, 24, 28)') : 'rgb(247, 249, 249)',
      // Empty slider tracks, meter cells and out-of-range histogram bars; dividers are too faint for that in light mode.
      track: dark ? (r > 10 ? 'rgb(56, 68, 77)' : 'rgb(51, 54, 57)') : 'rgb(207, 217, 222)',
      // X's own popover shadow for each theme.
      shadow: dark
        ? 'rgba(255, 255, 255, 0.2) 0px 0px 15px, rgba(255, 255, 255, 0.15) 0px 0px 3px 1px'
        : 'rgba(101, 119, 134, 0.2) 0px 0px 15px, rgba(101, 119, 134, 0.15) 0px 0px 3px 1px',
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

  const api = { SEL, tweetIdOf, cellOf, isPromotedArticle, extractTweet, isHome, selectedHomeTab, cellKind, sidebarContents, readTheme };
  root.XIQ = Object.assign(root.XIQ || {}, { dom: api });
})(typeof globalThis !== 'undefined' ? globalThis : this);
