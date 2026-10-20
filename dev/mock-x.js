// Dev-only: renders a rough copy of X's home page DOM from the fixture timeline, the way X's React app would,
// and fetches the fixture through XHR at a HomeTimeline-looking URL so the page hook sees it.
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  history.replaceState(null, '', '/home');

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function unwrap(r) {
    return r && r.__typename === 'TweetWithVisibilityResults' ? r.tweet : r;
  }
  function user(t) {
    const u = t.core.user_results.result;
    return { handle: u.core ? u.core.screen_name : u.legacy.screen_name, name: u.core ? u.core.name : u.legacy.name };
  }

  function tweetHtml(raw, promoted) {
    let t = unwrap(raw);
    let social = '';
    const rt = t.legacy.retweeted_status_result && unwrap(t.legacy.retweeted_status_result.result);
    if (rt) {
      social = `<div class="social">🔁 ${esc(user(t).name)} reposted</div>`;
      t = rt;
    }
    const u = user(t);
    const text = (t.note_tweet ? t.note_tweet.note_tweet_results.result.text : t.legacy.full_text).replace(/https:\/\/t\.co\/\w+/g, '');
    const q = t.quoted_status_result && unwrap(t.quoted_status_result.result);
    const quote = q
      ? `<div role="link" class="quote"><div data-testid="User-Name" class="uname"><div><span>${esc(user(q).name)}</span></div><div><span>@${esc(user(q).handle)}</span></div></div><div data-testid="tweetText" lang="en">${esc(q.legacy.full_text)}</div></div>`
      : '';
    const media = (t.legacy.extended_entities && t.legacy.extended_entities.media) || [];
    const photos = media.length
      ? `<div data-testid="tweetPhoto" class="photo"><img alt="${esc(media[0].ext_alt_text || 'Image')}" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div>`
      : '';
    const ad = promoted ? '<div class="ad"><span>Ad</span></div>' : '';
    const open = promoted ? '<div data-testid="placementTracking">' : '';
    const close = promoted ? '</div>' : '';
    return `<div data-testid="cellInnerDiv"><div><div class="cell-border">${open}
      <article data-testid="tweet" role="article" tabindex="0">
        <div class="tw">
          ${social}
          <div class="row">
            <div class="avatar"></div>
            <div class="content">
              <div class="head">
                <div data-testid="User-Name" class="uname">
                  <div><span class="name">${esc(u.name)}</span></div>
                  <div><span class="muted">@${esc(u.handle)}</span>${promoted ? '' : ` · <a href="/${esc(u.handle)}/status/${t.rest_id}"><time datetime="2026-10-19T10:00:00.000Z">5h</time></a>`}</div>
                </div>
                ${ad}<div class="icons">⋯</div>
              </div>
              <div data-testid="tweetText" lang="en">${esc(text)}</div>
              ${photos}${quote}
              <div role="group" class="actions"><span>💬 12</span><span>🔁 4</span><span>♡ 88</span><span>📊 9K</span></div>
            </div>
          </div>
        </div>
      </article>${close}
    </div></div></div>`;
  }

  // Newer ad units (rtb-image-ad-…) aren't posts at all.
  function imageAdHtml() {
    return `<div data-testid="cellInnerDiv"><div class="cell-border"><div data-testid="placementTracking"><div class="photo">Sponsored image ad</div></div></div></div>`;
  }

  function whoToFollowHtml() {
    return `<div data-testid="cellInnerDiv"><div><h2 class="mod-h">Who to follow</h2></div></div>
      <div data-testid="cellInnerDiv"><div data-testid="UserCell" class="usercell">Popular Account (demo) @demo_popular <button>Follow</button></div></div>
      <div data-testid="cellInnerDiv"><a href="/i/connect_people" class="showmore">Show more</a></div>`;
  }

  function render(json) {
    const out = [];
    const ins = json.data.home.home_timeline_urt.instructions.find((i) => i.type === 'TimelineAddEntries');
    for (const e of ins.entries) {
      const c = e.content;
      if (c.entryType === 'TimelineTimelineItem' && c.itemContent && c.itemContent.tweet_results) {
        out.push(tweetHtml(c.itemContent.tweet_results.result, !!c.itemContent.promotedMetadata));
      } else if (e.entryId.startsWith('rtb-image-ad')) {
        out.push(imageAdHtml());
      } else if (c.entryType === 'TimelineTimelineModule' && e.entryId.startsWith('who-to-follow')) {
        out.push(whoToFollowHtml());
      } else if (c.entryType === 'TimelineTimelineModule') {
        for (const it of c.items) out.push(tweetHtml(it.item.itemContent.tweet_results.result, false));
      }
    }
    document.getElementById('timeline').innerHTML = out.join('');
  }

  function load() {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/dev/fixtures/i/api/graphql/MOCKQUERYID/HomeTimeline?variables=%7B%7D');
    xhr.onload = () => {
      // X renders shortly after the response arrives.
      setTimeout(() => render(JSON.parse(xhr.responseText)), 120);
    };
    xhr.send();
  }

  // Sidebar widgets render a little later than the page, like on X.
  setTimeout(() => {
    document.getElementById('sidebarContents').insertAdjacentHTML('beforeend', `
      <div><aside aria-label="Subscribe to Premium" class="w"><h2>Subscribe to Premium</h2><p>Unlock new features.</p><a href="/i/premium_sign_up">Subscribe</a></aside></div>
      <div><section aria-labelledby="live-h" class="w"><h2 id="live-h">Live on X</h2><p>Someone is hosting a live audio room</p></section></div>
      <div><section aria-labelledby="news-h" class="w"><h2 id="news-h">Today's News</h2><p>Example headline for the mock page</p></section></div>
      <div><section aria-labelledby="trend-h" class="w"><h2 id="trend-h">What's happening</h2><div data-testid="trend">Trending · Example topic</div></section></div>
      <div><aside aria-label="Who to follow" class="w"><h2>Who to follow</h2><div data-testid="UserCell">Demo Account @demo_someone</div></aside></div>
      <nav aria-label="Footer" class="footer"><a href="/tos">Terms of Service</a> <a href="/privacy">Privacy Policy</a></nav>`);
  }, 300);

  window.addEventListener('DOMContentLoaded', load);

  // ?shots hides the left nav so the feed and panel fill a store screenshot.
  if (params.has('shots')) window.addEventListener('DOMContentLoaded', () => (document.querySelector('header.nav').style.display = 'none'));

  // ?card opens the first score chip's card once posts are scored (for store screenshots).
  if (params.has('card')) {
    setTimeout(() => {
      const chip = document.querySelector('.xiq-chip');
      if (!chip) return;
      chip.click();
      // Skip the fade-in so a headless screenshot never catches it half-transparent.
      const card = document.querySelector('.xiq-card-host');
      if (card) card.shadowRoot.querySelector('.card').style.animation = 'none';
    }, 1800);
  }

  // Dev helpers for the console / automation.
  window.__xiqMock = {
    selectTab(i) {
      document.querySelectorAll('[role="tab"]').forEach((t, j) => t.setAttribute('aria-selected', String(i === j)));
      const tl = document.getElementById('timeline');
      tl.appendChild(tl.firstElementChild); // nudge a DOM mutation like X does when switching tabs
    },
  };
})();
