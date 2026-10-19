// Shared by the content script, background worker, settings page and tests.
// Plain script (no modules) so it can load everywhere: <script>, importScripts, manifest content_scripts, and Node.
(function (root) {
  'use strict';

  const TOPICS = [
    { key: 'science', label: 'Science', icon: '🔬' },
    { key: 'health', label: 'Health', icon: '🩺' },
    { key: 'ai', label: 'AI', icon: '🤖' },
    { key: 'tech', label: 'Tech', icon: '💻' },
    { key: 'business', label: 'Business', icon: '📈' },
    { key: 'philosophy', label: 'Ideas', icon: '💡' },
    { key: 'history', label: 'History', icon: '📜' },
    { key: 'arts', label: 'Arts & books', icon: '🎨' },
    { key: 'selfhelp', label: 'Self-help', icon: '🧭' },
    { key: 'news', label: 'News', icon: '📰' },
    { key: 'politics', label: 'Politics', icon: '🏛️' },
    { key: 'culture_war', label: 'Culture war', icon: '🔥' },
    { key: 'celebrity', label: 'Celebrity', icon: '⭐' },
    { key: 'humor', label: 'Humor', icon: '😂' },
    { key: 'sports', label: 'Sports', icon: '⚽' },
    { key: 'gaming', label: 'Gaming', icon: '🎮' },
    { key: 'crypto', label: 'Crypto', icon: '🪙' },
    { key: 'lifestyle', label: 'Lifestyle', icon: '🌿' },
    { key: 'personal', label: 'Personal', icon: '👋' },
    { key: 'other', label: 'Other', icon: '💬' },
  ];
  const TOPIC_KEYS = TOPICS.map((t) => t.key);

  // A filter is a substance band [minSubstance, maxSubstance], a bait cap, and whether funny posts skip the band.
  // Moods are fixed filters; "custom" is the user's own, kept in settings.custom so it survives switching moods.
  const FILTER_KEYS = ['minSubstance', 'maxSubstance', 'maxBait', 'funPass'];
  const MOODS = {
    teach: { label: 'Teach me', blurb: 'Only posts that teach you something', minSubstance: 6, maxSubstance: 10, maxBait: 2, funPass: false },
    balanced: { label: 'Balanced', blurb: 'Smart or funny, never bait', minSubstance: 4, maxSubstance: 10, maxBait: 4, funPass: true },
    nonsense: { label: 'Nonsense', blurb: 'Light and fun. Nothing heavy, no bait', minSubstance: 0, maxSubstance: 5, maxBait: 4, funPass: true },
  };
  const CUSTOM_LABEL = { label: 'Custom', blurb: 'Your own mix, saved' };

  const SETTINGS_VERSION = 2;
  const DEFAULT_SETTINGS = {
    v: SETTINGS_VERSION,
    enabled: true,
    mood: 'teach', // a MOODS key, or 'custom'
    custom: null, // { minSubstance, maxSubstance, maxBait, funPass } once the user makes a custom mix
    topics: {
      science: 'more',
      health: 'more',
      ai: 'more',
      tech: 'more',
      philosophy: 'more',
      history: 'more',
      politics: 'less',
      culture_war: 'less',
      celebrity: 'less',
    },
    scope: 'foryou', // 'foryou' | 'home' (all home tabs, incl. Following and pinned lists)
    hiddenStyle: 'collapse', // 'collapse' (thin bar, click to show) | 'remove'
    pendingStyle: 'blur', // 'blur' | 'show' while a post is being scored
    showBadges: true,
    hideAds: true,
    hideSidebar: true,
    hideSuggestions: true, // "Who to follow" modules inside the feed
    widgetCollapsed: false,
  };

  // Both providers speak OpenAI-style /chat/completions. `reasoning` lists ways to turn thinking down,
  // tried in order; the last entry sends nothing. Classification doesn't need thinking, and it costs latency.
  const PROVIDERS = {
    'opencode-go': {
      label: 'OpenCode Go',
      baseUrl: 'https://opencode.ai/inference/go/openai/v1',
      defaultModel: 'deepseek-v4.1-flash',
      models: [
        { id: 'deepseek-v4.1-flash', note: 'DeepSeek V4.1 Flash · $0.15/$0.60 off-peak' },
        { id: 'mimo-v2.6-flash', note: 'MiMo V2.6 Flash · $0.14/$0.28' },
        { id: 'glm-5.3-flash', note: 'GLM 5.3 Flash · $0.15/$0.50' },
        { id: 'hy3', note: 'Hunyuan 3 · $0.14/$0.58' },
        { id: 'minimax-m3.1-flash-free', note: 'MiniMax M3.1 Flash · free for now' },
      ],
      keyUrl: 'https://opencode.ai/console',
      help: 'Uses your Go subscription’s per-model dollar limits. Only chat-completions models work here (DeepSeek, MiMo, GLM, Hunyuan, LongCat, MiniMax free).',
      headers: {},
      sessionHeader: 'x-opencode-session',
      reasoning: [{ reasoning_effort: 'none' }, { reasoning_effort: 'low' }, {}],
    },
    openrouter: {
      label: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      defaultModel: 'deepseek/deepseek-v4.1-flash',
      models: [
        { id: 'deepseek/deepseek-v4.1-flash', note: 'DeepSeek V4.1 Flash · from $0.03/$0.08' },
        { id: 'xiaomi/mimo-v2.6-flash', note: 'MiMo V2.6 Flash · $0.14/$0.28' },
        { id: 'anthropic/claude-haiku-5.5', note: 'Claude Haiku 5.5 · $0.10/$0.50' },
        { id: 'openai/gpt-6-luna', note: 'GPT-6 Luna · $0.10/$0.50' },
        { id: 'google/gemini-3.1-flash-lite', note: 'Gemini 3.1 Flash Lite · $0.25/$1.50' },
        { id: 'mistralai/ministral-8b-2512', note: 'Ministral 8B · $0.15/$0.15' },
      ],
      keyUrl: 'https://openrouter.ai/settings/keys',
      help: 'Pay-as-you-go credits. The usage panel below shows the real cost OpenRouter reports.',
      headers: { 'HTTP-Referer': 'https://github.com/nishmeetarora/X-IQ-Slider', 'X-OpenRouter-Title': 'IQ Slider', 'X-Title': 'IQ Slider' },
      reasoning: [{ reasoning: { effort: 'none' } }, { reasoning: { effort: 'low' } }, {}],
    },
  };

  const DEFAULT_LLM = {
    provider: 'opencode-go',
    keys: { 'opencode-go': '', openrouter: '' },
    models: { 'opencode-go': PROVIDERS['opencode-go'].defaultModel, openrouter: PROVIDERS.openrouter.defaultModel },
    aboutMe: '',
  };

  // Bump when the scoring prompt or score format changes so cached scores get redone.
  const PROMPT_VERSION = 2;

  const STORAGE = {
    settings: 'xiq:settings',
    llm: 'xiq:llm',
    stats: 'xiq:stats',
    status: 'xiq:status',
    scorePrefix: 'sc:',
  };

  function clampInt(v, lo, hi) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return lo;
    return Math.min(hi, Math.max(lo, n));
  }

  // Small stable string hash (djb2) — used to tag cached scores with the prompt/model they came from.
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function scoreSignature(llm) {
    const provider = llm.provider;
    return hash([PROMPT_VERSION, provider, llm.models?.[provider] || '', llm.aboutMe || ''].join('|'));
  }

  function pickFilter(src) {
    const f = {};
    for (const k of FILTER_KEYS) f[k] = src[k];
    return f;
  }

  function normalizeFilter(f) {
    const min = clampInt(f?.minSubstance ?? MOODS.teach.minSubstance, 0, 10);
    return {
      minSubstance: min,
      maxSubstance: Math.max(min, clampInt(f?.maxSubstance ?? 10, 0, 10)),
      maxBait: clampInt(f?.maxBait ?? MOODS.teach.maxBait, 0, 10),
      funPass: !!f?.funPass,
    };
  }

  function mergeSettings(stored) {
    stored = stored || {};
    const s = Object.assign({}, DEFAULT_SETTINGS, stored);
    // Stored choices (including explicit "neutral") win; topics added in later versions get their defaults.
    s.topics = Object.assign({}, DEFAULT_SETTINGS.topics, stored.topics || {});
    if (!stored.v || stored.v < 2) {
      // v1 kept the active knobs at the top level. A v1 custom mix becomes the saved Custom preset.
      if (stored.mood === 'custom' && stored.minSubstance != null) s.custom = normalizeFilter(Object.assign({ maxSubstance: 10 }, stored));
    }
    for (const k of FILTER_KEYS) delete s[k];
    s.custom = s.custom ? normalizeFilter(s.custom) : null;
    if (!(s.mood in MOODS) && !(s.mood === 'custom' && s.custom)) s.mood = 'teach';
    s.v = SETTINGS_VERSION;
    return s;
  }

  // The filter currently in force: the mood's preset, or the saved custom mix.
  function effectiveFilter(settings) {
    if (settings.mood === 'custom' && settings.custom) return settings.custom;
    return pickFilter(MOODS[settings.mood] || MOODS.teach);
  }

  function moodInfo(mood) {
    return mood === 'custom' ? CUSTOM_LABEL : MOODS[mood] || MOODS.teach;
  }

  function mergeLlm(stored) {
    const l = Object.assign({}, DEFAULT_LLM, stored || {});
    l.keys = Object.assign({}, DEFAULT_LLM.keys, stored?.keys || {});
    l.models = Object.assign({}, DEFAULT_LLM.models, stored?.models || {});
    return l;
  }

  // The playful "IQ" on the sliders and chips is a relabel of substance: 0 -> 70, 10 -> 150.
  function substanceToIq(s) {
    return 70 + s * 8;
  }

  const FUNNY = 6;

  // score: { t: topic, s: substance 0-10, b: bait 0-10, f: fun 0-10, w: why }
  // returns { hide, reason: 'topic' | 'bait' | 'shallow' | 'heavy' | null }
  function decide(score, settings) {
    const f = effectiveFilter(settings);
    const pref = settings.topics?.[score.t] || 'neutral';
    if (pref === 'less') return { hide: true, reason: 'topic' };
    if (score.b > f.maxBait) return { hide: true, reason: 'bait' };
    if (f.funPass && score.f >= FUNNY) return { hide: false, reason: null };
    // Topics marked "more" get a 2-point easier bar.
    if (score.s < f.minSubstance - (pref === 'more' ? 2 : 0)) return { hide: true, reason: 'shallow' };
    if (score.s > f.maxSubstance) return { hide: true, reason: 'heavy' };
    return { hide: false, reason: null };
  }

  function topicOf(key) {
    return TOPICS.find((t) => t.key === key) || { key, label: key, icon: '💬' };
  }

  function topicLabel(key) {
    return topicOf(key).label;
  }

  const api = {
    TOPICS,
    TOPIC_KEYS,
    MOODS,
    FILTER_KEYS,
    FUNNY,
    DEFAULT_SETTINGS,
    PROVIDERS,
    DEFAULT_LLM,
    PROMPT_VERSION,
    STORAGE,
    clampInt,
    hash,
    scoreSignature,
    mergeSettings,
    normalizeFilter,
    effectiveFilter,
    moodInfo,
    mergeLlm,
    substanceToIq,
    decide,
    topicOf,
    topicLabel,
  };

  root.XIQ = Object.assign(root.XIQ || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
