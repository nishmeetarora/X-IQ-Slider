# IQ Slider for X

A personal Chrome extension that filters your X **For you** feed with a cheap LLM:

- **IQ range**: a two-handle slider. The low handle hides posts without real information or argument; the high handle hides heavy posts when you just want to unwind.
- **Bait tolerance**: hide rage bait, engagement farming and culture-war takes.
- **Funny posts always pass**: lets genuinely funny posts skip the IQ range (bait is still capped).
- **Moods**:

  | Mood | IQ range | Bait | Funny posts |
  |---|---|---|---|
  | Teach me | 118+ | ≤ 2 | no pass |
  | Balanced | 102+ | ≤ 4 | pass |
  | Nonsense | up to 110 | ≤ 4 | pass |
  | Custom | whatever you last dialed in, saved | | |

  Moving any slider switches to Custom and saves it; picking a preset and then Custom brings your mix back.
- **Topics** (20, with health, history, arts, self-help and gaming): tap a chip to cycle *more* (2 points easier bar), *less* (always hidden) and neutral. Politics, culture war and celebrity start hidden.
- **Score chips**: each kept post gets a chip with a ring meter, its IQ, topic and a bait flag. Hover or click for the substance / bait / fun meters, the model's reason, why it passed, and one-click More/Less for that topic.
- **Histograms** above the sliders show how this session's posts are distributed, so you can see what a slider move will cut.
- **Hides ads** everywhere on X, and "Who to follow" blocks inside the feed.
- **Replaces the right sidebar** (Live on X, Today's News, What's happening, Who to follow, Premium) with one control panel. Search stays.

Each post is scored once on topic, substance, bait and fun. The sliders then filter those scores locally, so moving them is instant and costs nothing. Scores are cached for 14 days.

## Install

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick this folder (the one with `manifest.json`).
3. The settings page opens. Pick a provider, paste your API key, and click **Test connection**.
4. Reload x.com. The panel appears under the search box.

Clicking the extension's toolbar icon, or **Settings** in the panel, reopens the settings page.

## Providers

| Provider | Endpoint | Default model | Key |
|---|---|---|---|
| OpenCode Go | `https://opencode.ai/inference/go/openai/v1` | `deepseek-v4.1-flash` | [opencode.ai/console](https://opencode.ai/console) |
| OpenRouter | `https://openrouter.ai/api/v1` | `deepseek/deepseek-v4.1-flash` | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) |

Both use OpenAI-style chat completions with JSON mode and thinking turned off. If a model rejects one of those options, the extension drops it and retries. Any model ID can be typed into the Model field; on OpenCode Go only the chat-completions models work (DeepSeek, MiMo, GLM, Hunyuan, LongCat, MiniMax free), not the ones served over Anthropic Messages or OpenAI Responses.

**Cost:** roughly 250–300 tokens per post with DeepSeek V4.1 Flash, about **$0.05 per 1,000 posts** at $0.15/$0.60 pricing. A heavy day of 1,500 posts is under 10 cents. Posts arrive a page at a time (20–35) and are scored in even batches of up to 24, so the fixed instructions are paid for once per batch. The settings page shows posts, calls, tokens in/out, prompt-cache hits, cost today and cost per 1,000 posts. To cut cost further, pick a cheaper model or provider, for example OpenRouter's cheapest DeepSeek V4.1 Flash host or MiMo V2.6 Flash.

**OpenCode Go caveat:** OpenCode's docs say Go is designed for OpenCode and other coding agents, and that traffic is monitored for abuse. Feed classification isn't coding-agent traffic, so heavy use could get flagged. OpenRouter has no such restriction.

## Privacy

Post text, author handles, image alt text and link titles from your For you feed go to the provider you pick. Nothing else does. Your API key stays in `chrome.storage.local` on this machine. Don't publish the extension with a key in it.

## When X changes its site

All selectors for X's page are in [src/content/dom.js](src/content/dom.js), and feed parsing is in [src/content/timeline.js](src/content/timeline.js). If posts stop being scored, check that the page hook still sees `HomeTimeline` responses (see [src/page/hook.js](src/page/hook.js)). The content script also falls back to reading text from the page.

## Layout

```
manifest.json
src/page/hook.js            copies X's timeline API responses (page world, read-only)
src/content/                content script: timeline parser, DOM helpers, feed filter, score chips, sidebar, panel
src/background/             service worker: batching queue, prompt, providers, score cache
src/shared/core.js          topics, moods, defaults, filter rule, provider config
options/                    settings page
dev/                        tests, mock X page, fixture
```

## Development

```bash
node dev/test.js && node dev/test-background.js
```

[dev/mock-x.html](dev/mock-x.html) runs the real content scripts on a rough copy of X's home page, with a fake background that scores by keyword. Serve the project root (`python3 -m http.server 8765`) and open `http://localhost:8765/dev/mock-x.html`. After editing the extension, click reload on `chrome://extensions` and refresh x.com.

## License

MIT. See [LICENSE](LICENSE).
