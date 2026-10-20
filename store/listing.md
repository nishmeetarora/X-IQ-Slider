# Chrome Web Store submission: copy-paste text

Everything the Developer Dashboard asks for, in the order its tabs ask for it. Images are in `store/`.

---

## Store listing tab

**Name** (comes from the manifest): IQ Slider for X

**Summary** (comes from the manifest, 132 characters max):
Filter your X For you feed by topic, substance and bait with a cheap LLM. Hides ads and swaps sidebar clutter for one control panel.

**Category:** Lifestyle → Social Networking (alternative: Make Chrome Yours → Functionality & UI)

**Language:** English

**Description** (plain text, paste as is):

```
Your For you feed, with an IQ slider.

IQ Slider for X scores every post in your X For you feed with a cheap AI model you choose, then hides what you don't want: rage bait, engagement farming, culture-war fights, celebrity drama, or simply posts with nothing in them. Move a slider and the feed re-filters instantly.

WHAT YOU GET
• IQ range: a two-handle slider. Raise the floor to hide shallow posts. Lower the ceiling when you just want to unwind.
• Bait tolerance: rage bait, outrage, "thoughts?" farming and hustle-bro posts get scored and capped separately from substance.
• Moods: Teach me, Balanced, Nonsense, or your own saved Custom mix.
• 20 topics: tap to see more (science, health, AI, history…) or less (politics, celebrity, culture war…).
• Score chips: every post you keep shows its IQ and topic. Hover for the breakdown and the model's one-line reason.
• Hidden posts collapse to a thin bar that says why. Click to show one anyway.
• Hides promoted posts everywhere on X, plus "Who to follow" blocks in the feed.
• Replaces the right-sidebar widgets (Live on X, Today's News, What's happening, Who to follow, Premium) with one compact control panel. Search stays.
• Live histograms show how your feed is distributed, so you can see what a slider move will cut.

BRING YOUR OWN MODEL
Works with OpenCode Go or OpenRouter (DeepSeek V4.1 Flash by default; any chat model ID works). Posts are scored in batches and cached, so a heavy day of scrolling typically costs a few cents. The settings page shows posts scored, tokens and cost per 1,000 posts.

PRIVATE BY DESIGN
No servers, no accounts, no analytics. Post content goes only to the AI provider you pick, with your own key. Your key, settings and scores stay in your browser.

Not affiliated with or endorsed by X Corp.
```

**Store icon:** `icons/128.png`
**Screenshots:** `store/screenshot-1-feed.png`, `store/screenshot-2-card.png`, `store/screenshot-3-settings.png` (1280×800)
**Small promo tile:** `store/promo-small-440x280.png`
**Marquee promo tile:** optional, only needed to be featured
**Official URL / Homepage URL:** leave empty while the repo is private. Once it's public, use https://github.com/nishmeetarora/X-IQ-Slider
**Support URL:** optional (the GitHub repo's Issues page, once public)
**Mature content:** No

---

## Privacy tab

**Single purpose description:**
```
Filters the X (Twitter) home feed: it scores posts with an AI model the user chooses and hides posts by topic, substance and bait, along with ads and sidebar clutter, controlled from one panel on x.com.
```

**Permission justifications:**

- **storage:**
  ```
  Stores the user's settings, their AI provider API key, cached post scores (so posts aren't scored twice) and daily usage counters, all locally on the device.
  ```
- **unlimitedStorage:**
  ```
  The score cache keeps up to 14 days of post scores so the same posts are never sent to the AI provider twice. Heavy users can exceed the default local storage quota.
  ```
- **Host permissions** (x.com, twitter.com, opencode.ai, openrouter.ai):
  ```
  x.com and twitter.com: content scripts read the posts in the user's home timeline, hide filtered posts and ads, and show the filter's control panel in the sidebar. opencode.ai and openrouter.ai: the background worker sends post text to the AI provider the user selected, with the user's own API key, to get the scores. No other sites are accessed.
  ```

**Are you using remote code?** No, I am not using remote code.

**Data usage: what the extension collects** (tick these):
- [x] **Website content**: post text, author handles, image descriptions and link titles from the x.com home feed, sent to the user's chosen AI provider for scoring.
- [x] **Authentication information**: the user's API key for their AI provider, stored locally and sent only to that provider.
- Leave everything else unticked: personally identifiable information, health, financial, personal communications, location, web history, user activity.

**Certifications** (tick all three):
- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://nishmeet.com/extensions/iq-slider/privacy

---

## Distribution tab

- **Payments:** Free
- **Visibility:** Public (anyone can find it), Unlisted (only people with the link), or Private (only testers you list)
- **Regions:** All regions

---

## Test instructions tab

Reviewers need a working key to see scoring. Create a dedicated OpenRouter key with a small credit limit (for example $1), paste it below, and revoke it once the review is done.

```
1. Open the extension's settings (click the toolbar icon). Choose OpenRouter and paste this test key: <KEY>. Model: deepseek/deepseek-v4.1-flash. Click "Test connection" to see four sample posts scored.
2. Go to https://x.com/home while logged in to any X account, on the "For you" tab.
3. Posts are scored as they load. Kept posts show a score chip next to the author name (hover it for details). Filtered posts collapse to a thin bar saying why; click one to show it.
4. The right sidebar shows the IQ Slider panel. Switch moods (Teach me / Balanced / Nonsense) or drag the sliders and the feed re-filters instantly.
Without a key, the extension still hides ads and sidebar widgets, and the panel shows "Add an API key".
```
