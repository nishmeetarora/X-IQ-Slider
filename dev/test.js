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
