(async function () {
  'use strict';
  const XIQ = globalThis.XIQ;
  const { STORAGE, PROVIDERS } = XIQ;
  const $ = (id) => document.getElementById(id);

  const got = await chrome.storage.local.get([STORAGE.llm, STORAGE.settings]);
  let llm = XIQ.mergeLlm(got[STORAGE.llm]);
  let settings = XIQ.mergeSettings(got[STORAGE.settings]);

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  let savedTimer = null;
  function flashSaved() {
    $('savedNote').textContent = 'Saved';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => ($('savedNote').textContent = ''), 1500);
  }

  let llmTimer = null;
  function saveLlm(delay) {
    clearTimeout(llmTimer);
    llmTimer = setTimeout(async () => {
      await chrome.storage.local.set({ [STORAGE.llm]: llm });
      flashSaved();
    }, delay ?? 400);
  }

  async function saveSettings() {
    // Merge with the latest stored copy so slider changes made on x.com meanwhile aren't overwritten.
    const latest = XIQ.mergeSettings((await chrome.storage.local.get(STORAGE.settings))[STORAGE.settings]);
    for (const key of SETTING_KEYS) latest[key] = settings[key];
    settings = latest;
    await chrome.storage.local.set({ [STORAGE.settings]: settings });
    flashSaved();
  }

  // ---- Provider, key, model ----
  for (const [key, p] of Object.entries(PROVIDERS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.value = key;
    b.textContent = p.label;
    b.addEventListener('click', () => {
      llm.provider = key;
      saveLlm(0);
      renderProvider();
    });
    $('providerSeg').appendChild(b);
  }

  function renderProvider() {
    const p = PROVIDERS[llm.provider];
    for (const b of $('providerSeg').children) b.setAttribute('aria-pressed', String(b.dataset.value === llm.provider));
    $('apiKey').value = llm.keys[llm.provider] || '';
    $('model').value = llm.models[llm.provider] || p.defaultModel;
    $('keyLink').href = p.keyUrl;
    $('providerHelp').textContent = p.help || '';
    $('modelHint').textContent = `Default: ${p.defaultModel}`;
    const list = $('modelList');
    list.innerHTML = '';
    for (const m of p.models) {
      const opt = document.createElement('option');
      opt.value = typeof m === 'string' ? m : m.id;
      if (m.note) opt.label = m.note;
      list.appendChild(opt);
    }
    $('testResult').hidden = true;
  }

  $('apiKey').addEventListener('input', (e) => {
    llm.keys[llm.provider] = e.target.value.trim();
    saveLlm();
  });
  $('model').addEventListener('input', (e) => {
    llm.models[llm.provider] = e.target.value.trim() || PROVIDERS[llm.provider].defaultModel;
    saveLlm(700);
  });
  $('toggleKey').addEventListener('click', () => {
    const input = $('apiKey');
    input.type = input.type === 'password' ? 'text' : 'password';
    $('toggleKey').textContent = input.type === 'password' ? 'Show' : 'Hide';
  });

  $('aboutMe').value = llm.aboutMe || '';
  $('aboutMe').addEventListener('input', (e) => {
    llm.aboutMe = e.target.value;
    saveLlm(900);
  });

  $('test').addEventListener('click', async () => {
    const btn = $('test');
    const box = $('testResult');
    btn.disabled = true;
    btn.textContent = 'Testing…';
    box.hidden = false;
    box.className = 'test-result';
    box.textContent = 'Scoring three sample posts…';
    try {
      const res = await chrome.runtime.sendMessage({ type: 'test', llm });
      if (!res || !res.ok) throw new Error(res?.error || 'No response from the extension');
      const rows = res.samples
        .map((s) => {
          const sc = s.score;
          const nums = sc ? `${esc(XIQ.topicLabel(sc.t))} · 🧠${sc.s} 🎣${sc.b} 😂${sc.f}` : 'missing';
          return `<tr><td>${esc(s.text)}${sc?.w ? `<div class="help">“${esc(sc.w)}”</div>` : ''}</td><td class="num">${nums}</td></tr>`;
        })
        .join('');
      const tokens = res.usage ? ` · ${res.usage.total} tokens` : '';
      const cost = res.usage?.cost ? ` · $${res.usage.cost.toFixed(5)}` : '';
      box.innerHTML = `<div class="head"><span class="ok-mark">✓</span> ${esc(res.model)} answered in ${(res.ms / 1000).toFixed(1)}s${tokens}${cost}</div><table>${rows}</table>`;
    } catch (e) {
      box.className = 'test-result err';
      box.textContent = e.message || String(e);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Test connection';
    }
  });

  // ---- Feed settings ----
  const SETTING_KEYS = [];
  for (const seg of document.querySelectorAll('.seg[data-setting]')) {
    const key = seg.dataset.setting;
    SETTING_KEYS.push(key);
    for (const b of seg.querySelectorAll('button')) {
      b.addEventListener('click', () => {
        settings[key] = b.dataset.value;
        renderSettings();
        saveSettings();
      });
    }
  }
  for (const box of document.querySelectorAll('input[type="checkbox"][data-setting]')) {
    const key = box.dataset.setting;
    SETTING_KEYS.push(key);
    box.addEventListener('change', () => {
      settings[key] = box.checked;
      saveSettings();
    });
  }

  function renderSettings() {
    for (const seg of document.querySelectorAll('.seg[data-setting]')) {
      for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(settings[seg.dataset.setting] === b.dataset.value));
    }
    for (const box of document.querySelectorAll('input[type="checkbox"][data-setting]')) box.checked = !!settings[box.dataset.setting];
  }

  // ---- Usage ----
  async function renderUsage() {
    const { [STORAGE.stats]: stats } = await chrome.storage.local.get(STORAGE.stats);
    const today = new Date().toLocaleDateString('en-CA');
    const s = stats && stats.day === today ? stats : { calls: 0, tweets: 0, tokensIn: 0, tokensOut: 0, tokensCached: 0, cost: 0 };
    const tokens = (s.tokensIn || 0) + (s.tokensOut || 0);
    const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
    const perPost = s.tweets ? tokens / s.tweets : 0;
    const perThousand = s.tweets && s.cost ? (s.cost / s.tweets) * 1000 : 0;
    const cells = [
      [(s.tweets || 0).toLocaleString(), `posts scored in ${(s.calls || 0).toLocaleString()} calls`],
      [tokens.toLocaleString(), `tokens · ${k(s.tokensIn || 0)} in / ${k(s.tokensOut || 0)} out`],
      [s.cost ? `$${s.cost.toFixed(4)}` : '—', 'cost today'],
      [perThousand ? `$${perThousand.toFixed(3)}` : '—', 'per 1,000 posts'],
    ];
    $('usage').innerHTML = cells.map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
    const notes = [];
    if (perPost) notes.push(`${Math.round(perPost)} tokens per post`);
    if (s.tokensIn) notes.push(`${Math.round(((s.tokensCached || 0) / s.tokensIn) * 100)}% of input served from the provider's prompt cache`);
    $('usageNote').textContent = notes.join(' · ');
    try {
      const res = await chrome.runtime.sendMessage({ type: 'cacheCount' });
      $('cacheNote').textContent = `${(res?.count || 0).toLocaleString()} posts cached`;
    } catch (_) {}
  }

  $('clearCache').addEventListener('click', async () => {
    const res = await chrome.runtime.sendMessage({ type: 'clearCache' });
    $('cacheNote').textContent = `Cleared ${(res?.cleared || 0).toLocaleString()} cached scores`;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[STORAGE.stats]) renderUsage();
    if (changes[STORAGE.settings]) {
      settings = XIQ.mergeSettings(changes[STORAGE.settings].newValue);
      renderSettings();
    }
  });

  renderProvider();
  renderSettings();
  renderUsage();
})();
