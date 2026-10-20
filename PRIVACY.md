# IQ Slider for X: Privacy Policy

Effective October 20, 2026 · Published at https://nishmeet.com/extensions/iq-slider/privacy

IQ Slider for X ("the extension") filters the For you feed on x.com. It scores each post with an AI model that you choose, then hides or shows posts based on your settings. This policy explains what data the extension handles and where it goes.

## The short version

- The extension has no servers. The developer receives none of your data.
- To score posts, it sends post content from your For you feed to the AI provider **you** pick, using **your** API key.
- Your API key, settings and scores are stored only in your browser.
- No analytics, no tracking, no ads, and no selling or sharing of data.

## What the extension reads

On x.com and twitter.com, the extension reads the posts in your home timeline: their text, author handles and display names, image descriptions (alt text), link titles, and whether a post is promoted. It reads these from the page and from the timeline data X's own website loads in your browser. It does not read your messages, notifications, account details or anything outside x.com and twitter.com.

## What is sent, and to whom

To score posts, the extension sends batches of post content (the items listed above) to the AI provider you select in its settings:

- **OpenCode** (opencode.ai), if you choose OpenCode Go: [privacy policy](https://opencode.ai/legal/privacy-policy)
- **OpenRouter** (openrouter.ai), if you choose OpenRouter: [privacy policy](https://openrouter.ai/privacy)

These requests go directly from your browser to that provider over HTTPS, authenticated with your API key. They are used only to score posts for your own feed. How the provider stores or processes the requests is governed by its own privacy policy and your account settings with it.

The extension sends nothing else: no browsing history, no data from other websites, and nothing to the developer.

## What is stored on your device

The extension uses Chrome's local extension storage (`chrome.storage.local`) on your computer for:

- your settings (filter levels, topics, display options);
- your API key and chosen model;
- scores for posts it has already seen, so they aren't sent again (deleted automatically after 14 days);
- daily usage counters (number of posts scored, tokens, and cost), shown on the settings page.

None of this is synced or uploaded anywhere.

## Your choices

- **Clear cached scores** on the settings page deletes all stored scores.
- Removing the extension deletes everything it stored.
- You can turn the filter off at any time from the panel on x.com.
- You choose the provider and can revoke your API key with that provider at any time.

## Children

The extension is not directed at children under 13.

## Changes

If this policy changes, the updated version will be posted at this same address with a new effective date.

## Contact

Questions about this policy? Reach out at [iambic_savvy0o@icloud.com](mailto:iambic_savvy0o@icloud.com).

IQ Slider for X is an independent project and is not affiliated with or endorsed by X Corp.
