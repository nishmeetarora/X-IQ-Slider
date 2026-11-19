// Run with: node dev/test.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const core = require(path.join(root, 'src/shared/core.js'));
const { parseTimeline } = require(path.join(root, 'src/content/timeline.js'));
const prompt = require(path.join(root, 'src/background/prompt.js'));

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('ok  -', name);
  } catch (e) {
    console.error('FAIL-', name);
    throw e;
  }
}

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/i/api/graphql/MOCKQUERYID/HomeTimeline'), 'utf8'));
const { tweets, promotedIds } = parseTimeline(fixture);
const byId = Object.fromEntries(tweets.map((t) => [t.id, t]));

test('parses every organic tweet once, including conversation modules', () => {
  assert.deepEqual(tweets.map((t) => t.id).sort(), ['2001', '2002', '2004', '2006', '2007', '2010', '2011', '2012', '2013', '2014', '2015']);
});
test('promoted entries are separated out, not scored', () => {
  assert.deepEqual(promotedIds, ['2003']);
  assert.equal(byId['2003'], undefined);
});
test('quote tweets carry the quoted text and author', () => {
  assert.equal(byId['2001'].quote.user.handle, 'demo_benchmarks');
  assert.match(byId['2001'].quote.text, /prompt template/);
});
test('old and new user formats both resolve', () => {
  assert.equal(byId['2001'].user.handle, 'demo_evals');
  assert.equal(byId['2002'].user.handle, 'demo_hottakes');
});
test('visibility wrapper is unwrapped; media link stripped and alt kept', () => {
  assert.doesNotMatch(byId['2004'].text, /t\.co/);
  assert.deepEqual(byId['2004'].media, [{ type: 'image', alt: 'A smug orange cat next to a spilled mug' }]);
});
test('retweets are keyed by the original tweet', () => {
  assert.equal(byId['2006'].user.handle, 'demo_dbtips');
  assert.equal(byId['2006'].retweetedBy, 'demo_reposter');
  assert.equal(byId['2005'], undefined);
});
test('long posts use the full note_tweet text', () => {
  assert.match(byId['2007'].text, /Let's go/);
});
test('tweets with legacy fields at the top level still parse', () => {
  const { toTweet } = require(path.join(root, 'src/content/timeline.js'));
  const t = toTweet({ __typename: 'Tweet', rest_id: '42', core: { user_results: { result: { core: { screen_name: 'flat', name: 'Flat' } } } }, full_text: 'no legacy here', entities: { urls: [] } });
  assert.equal(t.id, '42');
  assert.equal(t.text, 'no legacy here');
  assert.equal(t.user.handle, 'flat');
});
test('non-tweet ad entries are ignored', () => {
  assert.ok(!tweets.some((t) => t.id.startsWith('rtb')));
});
test('replies are flagged', () => {
  assert.equal(byId['2011'].reply, true);
});

// The rewritten X web app (Nov 2026) serves a reshaped payload from api.x.com/graphql/<id>/HomeTimeline.
{
  const user = (h, n) => ({ result: { __typename: 'User', core: { screen_name: h, name: n }, rest_id: 'u' + h } });
  const tw = (id, h, text, extra) =>
    Object.assign(
      {
        __typename: 'Tweet',
        rest_id: id,
        core: { user_results: user(h, h + ' (demo)') },
        details: { full_text: text, display_text_range: [0, Array.from(text).length] },
        legacy: { conversation_id_str: id, entities: {}, lang: 'en' },
        media_entities2: [],
        url_entities: [],
      },
      extra
    );
  const item = (entryId, result, promoted) => ({
    entry_id: entryId,
    sort_index: '1',
    content: {
      __typename: 'TimelineTimelineItem',
      content: Object.assign({ __typename: 'TimelineTweet', display_type: 'Tweet', tweet_results: { rest_id: result.rest_id, result } }, promoted ? { promoted_metadata: { impression_id: 'x' } } : {}),
    },
  });
  const withMedia = 'Look at this chart 📈 https://t.co/media1';
  const payload = {
    data: {
      home_timeline: {
        home_timeline_urt: {
          id: 'for_you',
          instructions: [
            {
              __typename: 'TimelineAddEntries',
              entries: [
                { entry_id: 'cursor-top-1', content: { __typename: 'TimelineTimelineCursor', cursor_type: 'Top', value: 'a' } },
                item('tweet-3001', tw('3001', 'demo_new', 'Read the paper https://t.co/abc', { url_entities: [{ url: 'https://t.co/abc', display_url: 'example.org/paper' }] })),
                item('promoted-tweet-3002-ff', tw('3002', 'demo_brand', 'Buy one get one free'), true),
                item(
                  'tweet-3003',
                  tw('3003', 'demo_charts', withMedia, {
                    details: { full_text: withMedia, display_text_range: [0, Array.from('Look at this chart 📈').length] },
                    media_entities2: [{ type: 'photo', ext_alt_text: 'A rising line chart', indices: [21, 44] }],
                  })
                ),
                item('tweet-3005', tw('3004', 'demo_reposter', 'RT', { legacy: { retweeted_status_results: { rest_id: '3005', result: tw('3005', 'demo_orig', 'The original post') } } })),
                item('tweet-3006', tw('3006', 'demo_quoter', 'Hard agree', { quoted_tweet_results: { rest_id: '3007', result: tw('3007', 'demo_quoted', 'Quoted thought') } })),
                item('tweet-3008', { __typename: 'TweetWithVisibilityResults', tweet: tw('3008', 'demo_limited', 'Limited reach post') }),
                {
                  entry_id: 'home-conversation-3009',
                  content: {
                    __typename: 'TimelineTimelineModule',
                    display_type: 'VerticalConversation',
                    items: [
                      { entry_id: 'tweet-3010', item: { __typename: 'TimelineTimelineItem', content: { __typename: 'TimelineTweet', tweet_results: { result: tw('3010', 'demo_op', 'Question?') } } } },
                      { entry_id: 'tweet-3011', item: { __typename: 'TimelineTimelineItem', content: { __typename: 'TimelineTweet', tweet_results: { result: tw('3011', 'demo_replier', 'Answer.', { reply_to_results: { __typename: 'TweetResults', rest_id: '3010' } }) } } } },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    },
  };
  const r = parseTimeline(payload);
  const by = Object.fromEntries(r.tweets.map((t) => [t.id, t]));
  test('rewrite payload: every organic tweet parses, ads split out', () => {
    assert.deepEqual(r.tweets.map((t) => t.id).sort(), ['3001', '3003', '3005', '3006', '3008', '3010', '3011']);
    assert.deepEqual(r.promotedIds, ['3002']);
  });
  test('rewrite payload: author, links, media and display range', () => {
    assert.equal(by['3001'].user.handle, 'demo_new');
    assert.equal(by['3001'].text, 'Read the paper example.org/paper');
    assert.equal(by['3003'].text, 'Look at this chart 📈');
    assert.deepEqual(by['3003'].media, [{ type: 'image', alt: 'A rising line chart' }]);
  });
  test('rewrite payload: retweets, quotes, visibility wrapper and replies', () => {
    assert.equal(by['3005'].user.handle, 'demo_orig');
    assert.equal(by['3005'].retweetedBy, 'demo_reposter');
    assert.equal(by['3004'], undefined);
    assert.equal(by['3006'].quote.user.handle, 'demo_quoted');
    assert.equal(by['3008'].text, 'Limited reach post');
    assert.equal(by['3011'].reply, true);
    assert.equal(by['3010'].reply, false);
  });
}
{
  const { stripTimeline } = require(path.join(root, 'src/content/timeline.js'));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const entryIds = (j) => {
    const urt = j.data.home ? j.data.home.home_timeline_urt : j.data.home_timeline.home_timeline_urt;
    return urt.instructions.flatMap((i) => i.entries || []).map((e) => e.entryId || e.entry_id);
  };
  test('strip (old format): hidden posts, ads, ad units and who-to-follow go; cursors stay', () => {
    const j = clone(fixture);
    const r = stripTimeline(j, { dropIds: new Set(['2002', '2006', '2011']), dropAds: true, dropSuggestions: true });
    const ids = entryIds(j);
    assert.ok(r.changed);
    assert.ok(!ids.includes('tweet-2002'));
    assert.ok(!ids.includes('tweet-2005'), 'a repost goes when its original post is hidden');
    assert.ok(!ids.includes('promoted-tweet-2003-abc') && !ids.includes('rtb-image-ad-9f3a'));
    assert.ok(!ids.includes('who-to-follow-2008'));
    assert.ok(ids.includes('cursor-top-123') && ids.includes('tweet-2001'));
    assert.ok(ids.includes('home-conversation-2009'), 'a mixed conversation stays whole');
    assert.equal(parseTimeline(j).tweets.map((t) => t.id).includes('2011'), true);
    assert.deepEqual([r.posts, r.ads, r.modules], [2, 2, 1]);
  });
  test('strip: a conversation whose posts are all hidden goes entirely; nothing to drop leaves it unchanged', () => {
    const j = clone(fixture);
    stripTimeline(j, { dropIds: new Set(['2010', '2011']) });
    assert.ok(!entryIds(j).includes('home-conversation-2009'));
    const k = clone(fixture);
    assert.equal(stripTimeline(k, { dropIds: new Set(), dropAds: false, dropSuggestions: false }).changed, false);
    assert.deepEqual(k, fixture);
  });
}
test('strip (rewrite format): posts, ads and conversation items by parsed id', () => {
  const { stripTimeline } = require(path.join(root, 'src/content/timeline.js'));
  const t = (id, extra) => Object.assign({ __typename: 'Tweet', rest_id: id, core: { user_results: { result: { core: { screen_name: 'demo_' + id, name: 'D' } } } }, details: { full_text: 'x' }, legacy: {} }, extra);
  const item = (eid, result, promo) => ({ entry_id: eid, content: { __typename: 'TimelineTimelineItem', content: Object.assign({ __typename: 'TimelineTweet', tweet_results: { result } }, promo ? { promoted_metadata: {} } : {}) } });
  const j = { data: { home_timeline: { home_timeline_urt: { instructions: [{ __typename: 'TimelineAddEntries', entries: [
    { entry_id: 'cursor-top-1', content: { __typename: 'TimelineTimelineCursor', value: 'a' } },
    item('tweet-1', t('1')),
    item('promoted-tweet-2-x', t('2'), true),
    item('tweet-3', t('3', { legacy: { retweeted_status_results: { result: t('4') } } })),
    { entry_id: 'home-conversation-5', content: { __typename: 'TimelineTimelineModule', items: [
      { entry_id: 'tweet-6', item: { content: { __typename: 'TimelineTweet', tweet_results: { result: t('6') } } } },
      { entry_id: 'tweet-7', item: { content: { __typename: 'TimelineTweet', tweet_results: { result: t('7') } } } },
    ] } },
    { entry_id: 'cursor-bottom-1', content: { __typename: 'TimelineTimelineCursor', value: 'b' } },
  ] }] } } } };
  const r = stripTimeline(j, { dropIds: new Set(['4', '6']), dropAds: true, dropSuggestions: true });
  const entries = j.data.home_timeline.home_timeline_urt.instructions[0].entries;
  assert.deepEqual(entries.map((e) => e.entry_id), ['cursor-top-1', 'tweet-1', 'home-conversation-5', 'cursor-bottom-1']);
  assert.deepEqual(entries[2].content.items.map((i) => i.entry_id), ['tweet-6', 'tweet-7'], 'mixed conversation untouched');
  assert.deepEqual([r.posts, r.ads], [1, 1]);
  const { cursorsOf, requestCursor } = require(path.join(root, 'src/content/timeline.js'));
  assert.deepEqual(cursorsOf(j), { top: ['a'], bottom: ['b'] });
  assert.equal(requestCursor('https://api.x.com/graphql/x/HomeTimeline?variables=' + encodeURIComponent(JSON.stringify({ count: 20, cursor: 'b' }))), 'b');
  assert.equal(requestCursor('https://api.x.com/graphql/x/HomeTimeline?variables=%7B%7D'), null);
});
test('hook matches both timeline API hosts', () => {
  const src = fs.readFileSync(path.join(root, 'src/page/hook.js'), 'utf8');
  const re = eval(src.match(/const OPS = (\/.*\/);/)[1]);
  assert.equal('https://x.com/i/api/graphql/abc/HomeTimeline?variables=1'.match(re)[1], 'HomeTimeline');
  assert.equal('https://api.x.com/graphql/DR6r_R_zsb/HomeTimeline?variables=1'.match(re)[1], 'HomeTimeline');
  assert.equal('https://api.x.com/graphql/x/newsSidebarQuery'.match(re), null);
});

test('decide: muted topic always hides', () => {
  const s = core.mergeSettings(null);
  assert.deepEqual(core.decide({ t: 'culture_war', s: 9, b: 0, f: 0 }, s), { hide: true, reason: 'topic' });
  assert.equal(core.decide({ t: 'politics', s: 9, b: 0, f: 0 }, s).reason, 'topic', 'politics is hidden by default');
});
test('decide: bait over tolerance hides even on favored topics', () => {
  const s = core.mergeSettings(null);
  assert.equal(core.decide({ t: 'ai', s: 9, b: 5, f: 0 }, s).reason, 'bait');
});
test('decide: favored topics get a 2-point easier bar', () => {
  const s = core.mergeSettings(null); // teach: IQ band 6-10
  assert.equal(core.decide({ t: 'health', s: 4, b: 0, f: 0 }, s).hide, false);
  assert.equal(core.decide({ t: 'other', s: 4, b: 0, f: 0 }, s).reason, 'shallow');
});
test('decide: fun pass lets jokes through only when the mood allows it', () => {
  const joke = { t: 'humor', s: 1, b: 0, f: 8 };
  assert.equal(core.decide(joke, core.mergeSettings(null)).hide, true);
  assert.equal(core.decide(joke, core.mergeSettings({ v: 2, mood: 'balanced' })).hide, false);
});
test('decide: Nonsense hides heavy posts unless they are funny', () => {
  const s = core.mergeSettings({ v: 2, mood: 'nonsense' });
  assert.equal(core.decide({ t: 'science', s: 8, b: 0, f: 1 }, s).reason, 'heavy');
  assert.equal(core.decide({ t: 'science', s: 8, b: 0, f: 7 }, s).hide, false);
  assert.equal(core.decide({ t: 'personal', s: 1, b: 0, f: 2 }, s).hide, false);
  assert.equal(core.decide({ t: 'humor', s: 1, b: 7, f: 9 }, s).reason, 'bait', 'bait is still capped');
});
test('Custom is used only when chosen, and survives switching moods', () => {
  const custom = { minSubstance: 3, maxSubstance: 8, maxBait: 6, funPass: true };
  const onCustom = core.mergeSettings({ v: 2, mood: 'custom', custom });
  assert.deepEqual(core.effectiveFilter(onCustom), custom);
  const onTeach = core.mergeSettings({ v: 2, mood: 'teach', custom });
  assert.equal(core.effectiveFilter(onTeach).minSubstance, 6);
  assert.deepEqual(onTeach.custom, custom);
});
test('custom filters are normalized (min never above max)', () => {
  assert.deepEqual(core.normalizeFilter({ minSubstance: 7, maxSubstance: 3, maxBait: 99, funPass: 1 }), { minSubstance: 7, maxSubstance: 7, maxBait: 10, funPass: true });
});
test('v1 settings migrate: custom mix kept, topic choices kept, new topics get defaults', () => {
  const s = core.mergeSettings({ mood: 'custom', minSubstance: 3, maxBait: 5, funPass: true, topics: { ai: 'neutral', culture_war: 'less' } });
  assert.equal(s.mood, 'custom');
  assert.deepEqual(s.custom, { minSubstance: 3, maxSubstance: 10, maxBait: 5, funPass: true });
  assert.equal(s.topics.ai, 'neutral');
  assert.equal(s.topics.politics, 'less');
  assert.equal(s.topics.health, 'more');
  assert.equal('minSubstance' in s, false);
});
test('v1 preset users pick up the new preset definitions', () => {
  const s = core.mergeSettings({ mood: 'nonsense', minSubstance: 0, maxBait: 5, funPass: true });
  assert.equal(core.effectiveFilter(s).maxSubstance, 5);
});
test('every topic has a label and an icon, and the prompt lists them all', () => {
  for (const t of core.TOPICS) assert.ok(t.label && t.icon, t.key);
  const sys = prompt.systemPrompt('');
  for (const k of core.TOPIC_KEYS) assert.ok(sys.includes(k), k);
});
test('score signature changes with model and about-me', () => {
  const a = core.mergeLlm(null);
  const b = core.mergeLlm({ aboutMe: 'engineer' });
  const c = core.mergeLlm({ models: { 'opencode-go': 'other-model' } });
  assert.notEqual(core.scoreSignature(a), core.scoreSignature(b));
  assert.notEqual(core.scoreSignature(a), core.scoreSignature(c));
});

test('prompt lists every post with quote, media and index', () => {
  const msgs = prompt.buildMessages(tweets, 'I like AI');
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /About the reader/);
  assert.match(msgs[1].content, /\[0\] @demo_evals \(Eval Notes \(demo\)\)/);
  assert.match(msgs[1].content, /↳ quoting @demo_benchmarks/);
  assert.match(msgs[1].content, /\[image: A smug orange cat/);
  assert.match(msgs[1].content, new RegExp(`Score these ${tweets.length} posts`));
});
test('prompt treats original ideas as substance and keeps platitudes low', () => {
  const sys = prompt.systemPrompt('');
  assert.match(sys, /Ideas count as much as facts/);
  assert.match(sys, /fake-deep/);
  assert.match(sys, /philosophy = philosophy, psychology, meaning, ethics/);
});
test('parseScores maps indices back to ids and normalizes values', () => {
  const reply = '```json\n{"r":[{"i":0,"t":"AI","s":7.4,"b":1,"f":0,"w":"concrete claim"},{"i":1,"t":"culture war","s":1,"b":12,"f":0,"w":"bait"},{"i":2,"t":"weird","s":"3","b":0,"f":9}]}\n```';
  const out = prompt.parseScores(reply, tweets);
  assert.deepEqual(out[tweets[0].id], { t: 'ai', s: 7, b: 1, f: 0, w: 'concrete claim' });
  assert.deepEqual(out[tweets[1].id], { t: 'culture_war', s: 1, b: 10, f: 0, w: 'bait' });
  assert.equal(out[tweets[2].id].t, 'other');
  assert.equal(out[tweets[3].id], undefined);
});
test('parseScores tolerates prose around the JSON and a bare array', () => {
  const out = prompt.parseScores('Sure! Here you go: [{"i":0,"t":"tech","s":8,"b":0,"f":0,"w":"x"}] Hope that helps', tweets);
  assert.equal(out[tweets[0].id].s, 8);
});

console.log(`\n${passed} passed`);
