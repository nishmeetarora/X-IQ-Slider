// The control panel that replaces X's right-sidebar widgets. Lives in a shadow root so X's CSS can't touch it.
(function (root) {
  'use strict';

  const FONT = 'TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  const CSS = `
    :host { all: initial; display: block; margin: 0 0 16px; font-family: ${FONT}; color: var(--xiq-fg); }
    * { box-sizing: border-box; }
    .card { border: 1px solid var(--xiq-border); border-radius: 16px; overflow: hidden; background: var(--xiq-bg); }
    header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px 10px; }
    .title { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 20px; line-height: 24px; cursor: pointer; user-select: none; }
    .logo { width: 22px; height: 22px; border-radius: 6px; background: #0f1419; position: relative; flex: none; box-shadow: inset 0 0 0 1px var(--xiq-border); }
    .logo::before { content: ""; position: absolute; left: 4px; right: 4px; top: 10px; height: 2px; border-radius: 2px; background: linear-gradient(90deg, #1d9bf0 62%, #536471 62%); }
    .logo::after { content: ""; position: absolute; left: 10px; top: 7px; width: 8px; height: 8px; border-radius: 50%; background: #1d9bf0; box-shadow: 0 0 0 1.5px #fff; }
    .chev { font-size: 13px; color: var(--xiq-muted); transition: transform .15s; }
    .collapsed .chev { transform: rotate(-90deg); }
    .collapsed .body, .collapsed .moods-wrap { display: none; }
    .switch { position: relative; width: 40px; height: 22px; flex: none; display: inline-block; }
    .switch.small { width: 34px; height: 20px; }
    .switch input { opacity: 0; width: 0; height: 0; position: absolute; }
    .switch span { position: absolute; inset: 0; border-radius: 999px; background: var(--xiq-track); cursor: pointer; transition: background .15s; }
    .switch span::after { content: ""; position: absolute; left: 3px; top: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .15s; }
    .switch.small span::after { width: 14px; height: 14px; }
    .switch input:checked + span { background: #1d9bf0; }
    .switch input:checked + span::after { transform: translateX(18px); }
    .switch.small input:checked + span::after { transform: translateX(14px); }
    .switch input:focus-visible + span { outline: 2px solid #1d9bf0; outline-offset: 2px; }

    .moods-wrap { padding: 0 16px 2px; }
    .moods { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; padding: 3px; border-radius: 999px; background: var(--xiq-raised); }
    .moods button { all: unset; text-align: center; padding: 7px 2px; border-radius: 999px; font-size: 13px; font-weight: 700; color: var(--xiq-muted); cursor: pointer; white-space: nowrap; }
    .moods button:hover { color: var(--xiq-fg); }
    .moods button[aria-pressed="true"] { background: var(--xiq-bg); color: var(--xiq-fg); box-shadow: 0 0 0 1px var(--xiq-border); }
    .moods button:focus-visible { outline: 2px solid #1d9bf0; }
    .blurb { font-size: 13px; color: var(--xiq-muted); text-align: center; margin: 7px 0 0; min-height: 16px; line-height: 16px; }

    .body { padding: 2px 16px 12px; }
    .off .body, .off .moods-wrap { opacity: .45; pointer-events: none; }
    .row { margin: 12px 0 14px; }
    .row-head { display: flex; justify-content: space-between; align-items: baseline; font-size: 15px; }
    .row-head b { font-size: 15px; font-variant-numeric: tabular-nums; }
    .hint { font-size: 13px; color: var(--xiq-muted); line-height: 16px; margin-top: 4px; }

    /* Histogram of this session's scores; bin centers line up with the slider's thumb positions. */
    .hist { position: relative; height: 30px; margin: 8px 9px 0; }
    .hist i { position: absolute; bottom: 0; left: calc(var(--i) * 10% - 4.25%); width: 8.5%; height: var(--h); border-radius: 3px 3px 0 0; background: var(--xiq-track); transition: height .25s, background-color .15s; }
    .hist i.in { background: #1d9bf0; }
    .hist i.zero { height: 2px; border-radius: 1px; opacity: .6; }

    .range { position: relative; height: 20px; margin-top: 2px; --a: 0; --b: 1; }
    .range .track, .range .fill { position: absolute; top: 8px; height: 4px; border-radius: 2px; pointer-events: none; }
    .range .track { left: 9px; right: 9px; background: var(--xiq-track); }
    .range .fill { background: #1d9bf0; left: calc(9px + var(--a) * (100% - 18px)); width: calc((var(--b) - var(--a)) * (100% - 18px)); }
    .range input { -webkit-appearance: none; appearance: none; position: absolute; inset: 0; width: 100%; height: 20px; margin: 0; background: transparent; outline: none; cursor: pointer; }
    .range.dual input { pointer-events: none; }
    .range input::-webkit-slider-runnable-track { height: 20px; background: transparent; border: 0; }
    .range input::-webkit-slider-thumb { -webkit-appearance: none; pointer-events: auto; width: 18px; height: 18px; margin-top: 1px; border-radius: 50%; background: #fff; border: 0;
      box-shadow: 0 0 0 1px rgba(15,20,25,.18), 0 1px 4px rgba(0,0,0,.35); cursor: grab; transition: transform .1s; }
    .range input:active::-webkit-slider-thumb { cursor: grabbing; transform: scale(1.12); }
    .range input:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px rgba(29,155,240,.55), 0 1px 4px rgba(0,0,0,.35); }

    .toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 15px; margin: 0 0 16px; cursor: pointer; }
    .toggle-row small { display: block; font-size: 13px; color: var(--xiq-muted); }

    .topics-head { display: flex; justify-content: space-between; align-items: baseline; font-size: 15px; margin-bottom: 8px; }
    .topics-head .hint { margin: 0; }
    .topics { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { all: unset; font-size: 13px; line-height: 16px; padding: 4px 10px 4px 8px; border-radius: 999px; border: 1px solid var(--xiq-border); color: var(--xiq-fg); cursor: pointer; user-select: none; white-space: nowrap; }
    .chip .ic { margin-right: 4px; }
    .chip:hover { background: var(--xiq-raised); }
    .chip:focus-visible { outline: 2px solid #1d9bf0; }
    .chip[data-pref="more"] { border-color: rgba(29,155,240,.6); background: rgba(29,155,240,.14); color: #1d9bf0; font-weight: 700; }
    .chip[data-pref="less"] { border-color: rgba(244,33,46,.45); background: rgba(244,33,46,.08); color: #f4212e; }
    .chip[data-pref="less"] .lbl { text-decoration: line-through; }
    .chip[data-pref="less"] .ic { filter: grayscale(1); opacity: .6; }

    footer { border-top: 1px solid var(--xiq-border); padding: 10px 16px 12px; font-size: 13px; color: var(--xiq-muted); line-height: 18px; }
    .stats b { color: var(--xiq-fg); font-variant-numeric: tabular-nums; }
    .status { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 6px; }
    .status span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .status .err { color: #f4212e; }
    .status .ok::before { content: "● "; color: #00ba7c; }
    .link { all: unset; color: #1d9bf0; cursor: pointer; flex: none; }
    .link:hover { text-decoration: underline; }
  `;

  const HTML = `
    <div class="card">
      <header>
        <div class="title" id="toggleBody" title="Collapse or expand">
          <span class="logo"></span><span>IQ Slider</span><span class="chev">▾</span>
        </div>
        <label class="switch" title="Filter on/off"><input type="checkbox" id="enabled" aria-label="Filter on or off"><span></span></label>
      </header>
      <div class="moods-wrap">
        <div class="moods" role="group" aria-label="Mood">
          <button data-mood="teach" aria-pressed="false">Teach me</button>
          <button data-mood="balanced" aria-pressed="false">Balanced</button>
          <button data-mood="nonsense" aria-pressed="false">Nonsense</button>
          <button data-mood="custom" aria-pressed="false">Custom</button>
        </div>
        <div class="blurb" id="blurb"></div>
      </div>
      <div class="body">
        <div class="row">
          <div class="row-head"><span>IQ range</span><b id="iqVal"></b></div>
          <div class="hist" id="histS" aria-hidden="true"></div>
          <div class="range dual" id="iqRange">
            <div class="track"></div><div class="fill"></div>
            <input type="range" id="minS" min="0" max="10" step="1" aria-label="Lowest IQ to keep">
            <input type="range" id="maxS" min="0" max="10" step="1" aria-label="Highest IQ to keep">
          </div>
          <div class="hint" id="iqHint"></div>
        </div>
        <div class="row">
          <div class="row-head"><span>Bait tolerance</span><b id="baitVal"></b></div>
          <div class="hist" id="histB" aria-hidden="true"></div>
          <div class="range" id="baitRange">
            <div class="track"></div><div class="fill"></div>
            <input type="range" id="maxB" min="0" max="10" step="1" aria-label="Highest bait to keep">
          </div>
          <div class="hint">Rage bait, engagement farming, culture-war takes</div>
        </div>
        <label class="toggle-row">
          <span>Funny posts always pass<small>Skips the IQ range when a post is genuinely funny</small></span>
          <span class="switch small"><input type="checkbox" id="funPass" aria-label="Funny posts always pass"><span></span></span>
        </label>
        <div class="topics-head"><span>Topics</span><span class="hint">tap: more → less → neutral</span></div>
        <div class="topics" id="topics"></div>
      </div>
      <footer>
        <div class="stats" id="stats"></div>
        <div class="status"><span id="status"></span><button class="link" id="openSettings">Settings</button></div>
      </footer>
    </div>
  `;

  const NEXT_PREF = { neutral: 'more', more: 'less', less: 'neutral' };

  function createWidget(ctx) {
    const XIQ = root.XIQ;
    const iq = XIQ.substanceToIq;
    const host = document.createElement('div');
    host.className = 'xiq-widget-host';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${CSS}</style>${HTML}`;
    const $ = (id) => shadow.getElementById(id);
    const card = shadow.querySelector('.card');

    const chips = {};
    for (const t of XIQ.TOPICS) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.dataset.topic = t.key;
      b.innerHTML = `<span class="ic">${t.icon}</span><span class="lbl"></span>`;
      b.querySelector('.lbl').textContent = t.label;
      b.addEventListener('click', () => {
        const s = ctx.getSettings();
        const cur = s.topics[t.key] || 'neutral';
        ctx.update({ topics: Object.assign({}, s.topics, { [t.key]: NEXT_PREF[cur] }) });
      });
      chips[t.key] = b;
      $('topics').appendChild(b);
    }

    // Any manual change edits the Custom mix (starting from whatever is in force now) and switches to it.
    function setFilter(patch) {
      const s = ctx.getSettings();
      const custom = XIQ.normalizeFilter(Object.assign({}, XIQ.effectiveFilter(s), patch));
      ctx.update({ mood: 'custom', custom });
    }

    $('enabled').addEventListener('change', (e) => ctx.update({ enabled: e.target.checked }));
    $('funPass').addEventListener('change', (e) => setFilter({ funPass: e.target.checked }));
    $('minS').addEventListener('input', (e) => {
      const f = XIQ.effectiveFilter(ctx.getSettings());
      const v = Math.min(Number(e.target.value), f.maxSubstance);
      e.target.value = v;
      setFilter({ minSubstance: v });
    });
    $('maxS').addEventListener('input', (e) => {
      const f = XIQ.effectiveFilter(ctx.getSettings());
      const v = Math.max(Number(e.target.value), f.minSubstance);
      e.target.value = v;
      setFilter({ maxSubstance: v });
    });
    $('maxB').addEventListener('input', (e) => setFilter({ maxBait: Number(e.target.value) }));
    for (const b of shadow.querySelectorAll('.moods button')) {
      b.addEventListener('click', () => {
        const s = ctx.getSettings();
        if (b.dataset.mood === 'custom') ctx.update({ mood: 'custom', custom: s.custom || XIQ.effectiveFilter(s) });
        else ctx.update({ mood: b.dataset.mood });
      });
    }
    $('toggleBody').addEventListener('click', () => ctx.update({ widgetCollapsed: !ctx.getSettings().widgetCollapsed }));
    $('openSettings').addEventListener('click', () => ctx.openSettings());

    function setTheme(theme) {
      for (const k of ['bg', 'fg', 'muted', 'border', 'raised', 'track']) host.style.setProperty(`--xiq-${k}`, theme[k]);
    }

    function iqLabel(f) {
      if (f.minSubstance === 0 && f.maxSubstance === 10) return 'Any';
      if (f.maxSubstance === 10) return `${iq(f.minSubstance)}+`;
      if (f.minSubstance === 0) return `up to ${iq(f.maxSubstance)}`;
      return `${iq(f.minSubstance)}–${iq(f.maxSubstance)}`;
    }

    function iqHint(f) {
      const parts = [];
      if (f.minSubstance > 0) {
        const eased = Math.max(0, f.minSubstance - 2);
        parts.push(`Hides posts below IQ ${iq(f.minSubstance)}` + (eased < f.minSubstance ? ` (${iq(eased)} for topics you want more of)` : ''));
      }
      if (f.maxSubstance < 10) parts.push(`${parts.length ? 'and' : 'Hides'} heavy posts above ${iq(f.maxSubstance)}`);
      return parts.length ? parts.join(' ') : 'No IQ filter';
    }

    function renderHist(el, counts, isIn, label) {
      const max = Math.max(1, ...counts);
      const total = counts.reduce((a, b) => a + b, 0);
      el.innerHTML = counts
        .map((c, i) => {
          const h = c ? Math.max(3, Math.round((c / max) * 30)) : 2;
          const cls = [isIn(i) ? 'in' : '', c ? '' : 'zero'].join(' ');
          return `<i class="${cls}" style="--i:${i};--h:${h}px" title="${label(i)}: ${c} post${c === 1 ? '' : 's'}"></i>`;
        })
        .join('');
      el.title = total ? '' : 'Fills in as you scroll';
    }

    function renderControls() {
      const s = ctx.getSettings();
      const f = XIQ.effectiveFilter(s);
      // Don't fight the user's thumb mid-drag.
      const active = shadow.activeElement;
      if (active !== $('minS')) $('minS').value = f.minSubstance;
      if (active !== $('maxS')) $('maxS').value = f.maxSubstance;
      if (active !== $('maxB')) $('maxB').value = f.maxBait;
      // When both thumbs meet, keep the one that can still move on top.
      $('minS').style.zIndex = f.minSubstance === f.maxSubstance && f.maxSubstance >= 9 ? 3 : 1;
      $('maxS').style.zIndex = 2;
      $('iqRange').style.setProperty('--a', f.minSubstance / 10);
      $('iqRange').style.setProperty('--b', f.maxSubstance / 10);
      $('baitRange').style.setProperty('--a', 0);
      $('baitRange').style.setProperty('--b', f.maxBait / 10);
      $('funPass').checked = f.funPass;
      $('iqVal').textContent = iqLabel(f);
      $('iqHint').textContent = iqHint(f);
      $('baitVal').textContent = `${f.maxBait}/10`;
    }

    function render() {
      const s = ctx.getSettings();
      card.classList.toggle('off', !s.enabled);
      card.classList.toggle('collapsed', !!s.widgetCollapsed);
      $('enabled').checked = s.enabled;
      for (const b of shadow.querySelectorAll('.moods button')) b.setAttribute('aria-pressed', String(s.mood === b.dataset.mood));
      $('blurb').textContent = XIQ.moodInfo(s.mood).blurb;
      for (const t of XIQ.TOPICS) {
        const pref = s.topics[t.key] || 'neutral';
        chips[t.key].dataset.pref = pref;
        chips[t.key].title = pref === 'more' ? 'More: easier IQ bar' : pref === 'less' ? 'Less: always hidden' : 'Neutral';
      }
      renderControls();
      renderStats();
    }

    function renderStats() {
      const st = ctx.getStats();
      const status = ctx.getStatus();
      const s = ctx.getSettings();
      const f = XIQ.effectiveFilter(s);
      renderHist($('histS'), st.dist.s, (i) => i >= f.minSubstance && i <= f.maxSubstance, (i) => `IQ ${iq(i)}`);
      renderHist($('histB'), st.dist.b, (i) => i <= f.maxBait, (i) => `Bait ${i}`);

      let statsHtml;
      if (!s.enabled) statsHtml = 'Filter is off.';
      else if (!st.active) statsHtml = 'Paused here. The filter runs on your For you tab.';
      else if (!st.scored && !st.pending) statsHtml = 'Waiting for your feed…';
      else {
        const pct = st.scored ? Math.round((st.hidden / st.scored) * 100) : 0;
        statsHtml = `<b>${st.scored}</b> scored · <b>${st.hidden}</b> hidden (${pct}%)`;
        if (st.pending) statsHtml += ` · ${st.pending} scoring…`;
      }
      if (st.ads) statsHtml += ` · <b>${st.ads}</b> ad${st.ads === 1 ? '' : 's'} blocked`;
      $('stats').innerHTML = statsHtml;

      const el = $('status');
      const err = st.error || status.error;
      if (err === 'no_key') {
        el.className = 'err';
        el.textContent = 'Add an API key to start scoring';
      } else if (err) {
        el.className = 'err';
        el.textContent = String(err);
      } else if (status.model) {
        el.className = 'ok';
        const cost = status.costToday ? ` · $${status.costToday.toFixed(3)} today` : status.tokensToday ? ` · ${formatTokens(status.tokensToday)} tokens today` : '';
        el.textContent = `${status.model}${cost}`;
      } else {
        el.className = '';
        el.textContent = '';
      }
      el.title = el.textContent;
    }

    function formatTokens(n) {
      if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
      if (n >= 1e3) return Math.round(n / 1e3) + 'k';
      return String(n);
    }

    let statsTimer = null;
    function scheduleStats() {
      if (statsTimer) return;
      statsTimer = setTimeout(() => {
        statsTimer = null;
        renderStats();
      }, 250);
    }

    return { el: host, render, renderStats: scheduleStats, setTheme };
  }

  root.XIQ = Object.assign(root.XIQ || {}, { createWidget });
})(typeof globalThis !== 'undefined' ? globalThis : this);
