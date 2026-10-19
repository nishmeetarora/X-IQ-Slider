// The score chip next to a post's author name, and the card it opens on hover or click.
// Both live in shadow roots so X's CSS can't reach them; colors come from the --xiq-* theme variables on <html>.
(function (root) {
  'use strict';

  const FONT = 'TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  const CHIP_CSS = `
    :host { all: initial; display: inline-flex; flex: none; align-self: center; margin-left: 6px; vertical-align: middle; }
    .chip { display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 8px 0 3px; box-sizing: border-box;
      border: 1px solid var(--xiq-border); border-radius: 999px; color: var(--xiq-muted);
      font: 500 12px/18px ${FONT}; white-space: nowrap; cursor: pointer; user-select: none;
      transition: background-color .15s, color .15s; }
    .chip:hover, :host(.open) .chip { background: var(--xiq-raised); color: var(--xiq-fg); }
    .chip:focus-visible { outline: 2px solid #1d9bf0; outline-offset: 1px; }
    :host(.peek) .chip { border-style: dashed; }
    svg { width: 14px; height: 14px; flex: none; transform: rotate(-90deg); }
    .track { stroke: var(--xiq-track); }
    .arc { stroke: #1d9bf0; }
    .low .arc { stroke: var(--xiq-muted); }
    .iq { color: var(--xiq-fg); font-weight: 700; font-variant-numeric: tabular-nums; }
    .iq small { font-size: 10px; font-weight: 600; color: var(--xiq-muted); margin-right: 2px; letter-spacing: .02em; }
    .sep { width: 3px; height: 3px; border-radius: 50%; background: var(--xiq-muted); opacity: .5; }
    .flag { font-variant-numeric: tabular-nums; }
    .ic { margin-right: 4px; font-size: 11px; }
  `;

  const CARD_CSS = `
    :host { all: initial; position: fixed; z-index: 2147483000; top: 0; left: 0; }
    .card { width: 272px; box-sizing: border-box; padding: 14px 16px 12px; border-radius: 16px;
      background: var(--xiq-bg); color: var(--xiq-fg); box-shadow: var(--xiq-shadow);
      font: 400 14px/19px ${FONT}; animation: in .12s ease-out; }
    @keyframes in { from { opacity: 0; transform: translateY(-3px); } }
    .top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
    .topic { font-weight: 700; font-size: 15px; }
    .topic .ic { margin-right: 6px; }
    .big { font-weight: 800; font-size: 22px; line-height: 24px; font-variant-numeric: tabular-nums; }
    .big small { font-size: 12px; font-weight: 600; color: var(--xiq-muted); margin-right: 3px; }
    .m { display: grid; grid-template-columns: 70px 1fr 20px; align-items: center; gap: 8px; margin: 5px 0; font-size: 13px; }
    .m .lbl { color: var(--xiq-muted); }
    .m b { text-align: right; font-variant-numeric: tabular-nums; }
    .bar { display: grid; grid-template-columns: repeat(10, 1fr); gap: 2px; }
    .bar i { height: 6px; border-radius: 2px; background: var(--xiq-track); }
    .bar.s i.on { background: #1d9bf0; }
    .bar.b i.on { background: #f4212e; }
    .bar.f i.on { background: #7856ff; }
    .why { margin: 10px 0 0; color: var(--xiq-fg); font-size: 14px; }
    .why::before { content: "“"; } .why::after { content: "”"; }
    .verdict { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--xiq-border); font-size: 13px; color: var(--xiq-muted); }
    .verdict b { color: var(--xiq-fg); font-weight: 700; }
    .ok::before { content: "✓ "; color: #00ba7c; font-weight: 700; }
    .no::before { content: "● "; color: #f4212e; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    button { all: unset; box-sizing: border-box; padding: 5px 11px; border-radius: 999px; border: 1px solid var(--xiq-border);
      font: 700 13px/16px ${FONT}; color: var(--xiq-fg); cursor: pointer; }
    button:hover { background: var(--xiq-raised); }
    button:focus-visible { outline: 2px solid #1d9bf0; }
    button[aria-pressed="true"][data-pref="more"] { border-color: rgba(29,155,240,.6); background: rgba(29,155,240,.14); color: #1d9bf0; }
    button[aria-pressed="true"][data-pref="less"] { border-color: rgba(244,33,46,.5); background: rgba(244,33,46,.1); color: #f4212e; }
  `;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function ring(s) {
    const r = 7;
    const c = 2 * Math.PI * r;
    const filled = (Math.max(0, Math.min(10, s)) / 10) * c;
    return `<svg viewBox="0 0 18 18" class="${s <= 3 ? 'low' : ''}" aria-hidden="true">
      <circle class="track" cx="9" cy="9" r="${r}" fill="none" stroke-width="2.5"/>
      <circle class="arc" cx="9" cy="9" r="${r}" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${filled.toFixed(2)} ${c.toFixed(2)}"/>
    </svg>`;
  }

  function meter(kind, label, v) {
    const cells = Array.from({ length: 10 }, (_, i) => `<i class="${i < v ? 'on' : ''}"></i>`).join('');
    return `<div class="m"><span class="lbl">${label}</span><span class="bar ${kind}" role="img" aria-label="${label} ${v} of 10">${cells}</span><b>${v}</b></div>`;
  }

  function createChips(ctx) {
    const XIQ = root.XIQ;
    let cardHost = null;
    let cardRoot = null;
    let current = null; // the chip host whose card is open
    let pinned = false;
    let showTimer = null;
    let hideTimer = null;

    function chipInner(d) {
      const sc = d.sc;
      const topic = XIQ.topicOf(sc.t);
      let html = `${ring(sc.s)}<span class="iq"><small>IQ</small>${XIQ.substanceToIq(sc.s)}</span><span class="sep"></span><span><span class="ic">${topic.icon}</span>${esc(topic.label)}</span>`;
      if (sc.b >= 3) html += `<span class="sep"></span><span class="flag" title="Bait ${sc.b}/10">🎣 ${sc.b}</span>`;
      if (sc.f >= XIQ.FUNNY) html += `<span class="sep"></span><span class="flag" title="Fun ${sc.f}/10">😄</span>`;
      return html;
    }

    function verdictHtml(d) {
      const s = ctx.getSettings();
      const f = XIQ.effectiveFilter(s);
      const mood = esc(XIQ.moodInfo(s.mood).label);
      const sc = d.sc;
      const dec = XIQ.decide(sc, s);
      if (!dec.hide) {
        const why = s.topics[sc.t] === 'more' ? ' (a topic you want more of)' : f.funPass && sc.f >= XIQ.FUNNY ? ' (funny posts always pass)' : '';
        return `<div class="verdict ok">Passes <b>${mood}</b>${why}</div>`;
      }
      const iq = XIQ.substanceToIq;
      const reasons = {
        topic: `you hide ${esc(XIQ.topicLabel(sc.t))} posts`,
        bait: `bait ${sc.b} is over your ${f.maxBait}`,
        shallow: `IQ ${iq(sc.s)} is under your ${iq(f.minSubstance)}`,
        heavy: `IQ ${iq(sc.s)} is over your ${iq(f.maxSubstance)} cap`,
      };
      return `<div class="verdict no">Hidden by <b>${mood}</b>: ${reasons[dec.reason] || 'filtered'}. You opened it.</div>`;
    }

    function renderCard() {
      if (!current || !cardRoot) return;
      const d = current.__xiqData;
      const sc = d.sc;
      const s = ctx.getSettings();
      const topic = XIQ.topicOf(sc.t);
      const pref = s.topics[sc.t] || 'neutral';
      const hidden = XIQ.decide(sc, s).hide;
      cardRoot.querySelector('.card').innerHTML = `
        <div class="top"><span class="topic"><span class="ic">${topic.icon}</span>${esc(topic.label)}</span><span class="big"><small>IQ</small>${XIQ.substanceToIq(sc.s)}</span></div>
        ${meter('s', 'Substance', sc.s)}${meter('b', 'Bait', sc.b)}${meter('f', 'Fun', sc.f)}
        ${sc.w ? `<p class="why">${esc(sc.w)}</p>` : ''}
        ${verdictHtml(d)}
        <div class="actions">
          <button data-pref="more" aria-pressed="${pref === 'more'}">＋ More ${esc(topic.label)}</button>
          <button data-pref="less" aria-pressed="${pref === 'less'}">− Less ${esc(topic.label)}</button>
          ${d.revealed && hidden ? '<button data-act="hide">Hide again</button>' : ''}
        </div>`;
      place();
    }

    function ensureCard() {
      if (cardHost && cardHost.isConnected) return;
      cardHost = document.createElement('div');
      cardHost.className = 'xiq-card-host';
      cardRoot = cardHost.attachShadow({ mode: 'open' });
      cardRoot.innerHTML = `<style>${CARD_CSS}</style><div class="card" role="dialog" aria-label="Post score"></div>`;
      cardHost.addEventListener('mouseenter', () => clearTimeout(hideTimer));
      cardHost.addEventListener('mouseleave', () => scheduleHide());
      cardRoot.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn || !current) return;
        const d = current.__xiqData;
        if (btn.dataset.pref) {
          const pref = (ctx.getSettings().topics[d.sc.t] || 'neutral') === btn.dataset.pref ? 'neutral' : btn.dataset.pref;
          ctx.setTopic(d.sc.t, pref);
        } else if (btn.dataset.act === 'hide') {
          ctx.hideAgain(d.id);
          closeCard();
        }
      });
      document.documentElement.appendChild(cardHost);
    }

    function place() {
      if (!current || !cardHost) return;
      if (!current.isConnected) return closeCard();
      const r = current.getBoundingClientRect();
      const card = cardRoot.querySelector('.card');
      const w = card.offsetWidth;
      const h = card.offsetHeight;
      const left = Math.max(8, Math.min(r.left - 4, window.innerWidth - w - 8));
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
      cardHost.style.left = `${Math.round(left)}px`;
      cardHost.style.top = `${Math.round(top)}px`;
    }

    function openCard(host, pin) {
      clearTimeout(hideTimer);
      clearTimeout(showTimer);
      if (current && current !== host) current.classList.remove('open');
      current = host;
      pinned = !!pin;
      host.classList.add('open');
      ensureCard();
      cardHost.style.display = '';
      renderCard();
    }

    function closeCard() {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      if (current) current.classList.remove('open');
      current = null;
      pinned = false;
      if (cardHost) cardHost.style.display = 'none';
    }

    function scheduleHide() {
      clearTimeout(showTimer);
      if (pinned) return;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(closeCard, 220);
    }

    function createHost() {
      const host = document.createElement('span');
      host.className = 'xiq-chip';
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `<style>${CHIP_CSS}</style><span class="chip" role="button" tabindex="0" aria-label="Post score details"></span>`;
      // Keep clicks on the chip from opening the post.
      for (const type of ['click', 'mousedown', 'pointerdown', 'mouseup', 'pointerup']) {
        host.addEventListener(type, (e) => {
          e.stopPropagation();
          if (type === 'click') {
            e.preventDefault();
            if (current === host && pinned) closeCard();
            else openCard(host, true);
          }
        });
      }
      host.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        if (current === host && pinned) closeCard();
        else openCard(host, true);
      });
      host.addEventListener('mouseenter', () => {
        clearTimeout(hideTimer);
        if (current === host) return;
        clearTimeout(showTimer);
        showTimer = setTimeout(() => openCard(host, false), 250);
      });
      host.addEventListener('mouseleave', () => scheduleHide());
      return host;
    }

    // d: { id, sc, revealed }
    function attach(article, d) {
      const name = article.querySelector(XIQ.dom.SEL.userName);
      if (!name) return;
      let host = name.querySelector(':scope > .xiq-chip');
      if (!host) {
        host = createHost();
        name.appendChild(host);
      }
      const key = JSON.stringify([d.id, d.sc, d.revealed]);
      if (host.__xiqKey !== key) {
        host.__xiqKey = key;
        host.shadowRoot.querySelector('.chip').innerHTML = chipInner(d);
        host.classList.toggle('peek', !!d.revealed);
      }
      host.__xiqData = d;
      if (current === host) renderCard();
    }

    function detach(article) {
      for (const host of article.querySelectorAll('.xiq-chip')) {
        if (current === host) closeCard();
        host.remove();
      }
    }

    function refresh() {
      if (current) renderCard();
    }

    window.addEventListener('scroll', () => current && closeCard(), { passive: true, capture: true });
    window.addEventListener('keydown', (e) => e.key === 'Escape' && current && closeCard());
    document.addEventListener(
      'click',
      (e) => {
        if (!current) return;
        const path = e.composedPath();
        if (!path.includes(current) && !path.includes(cardHost)) closeCard();
      },
      true
    );

    return { attach, detach, refresh, close: closeCard };
  }

  root.XIQ = Object.assign(root.XIQ || {}, { createChips });
})(typeof globalThis !== 'undefined' ? globalThis : this);
