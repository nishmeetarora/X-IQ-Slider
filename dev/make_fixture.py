"""Builds dev/fixtures/.../HomeTimeline: a small HomeTimeline GraphQL response with the shapes X uses."""
import json, pathlib

def user(handle, name, new_format=True):
    if new_format:  # 2025+: screen_name/name moved under core
        return {"result": {"__typename": "User", "rest_id": "u" + handle, "core": {"screen_name": handle, "name": name}, "legacy": {}}}
    return {"result": {"__typename": "User", "rest_id": "u" + handle, "legacy": {"screen_name": handle, "name": name}}}

def tweet(tid, handle, name, text, new_format=True, **extra):
    t = {
        "__typename": "Tweet",
        "rest_id": tid,
        "core": {"user_results": user(handle, name, new_format)},
        "legacy": {"id_str": tid, "full_text": text, "lang": "en", "entities": {"urls": [], "media": []}},
    }
    for k, v in extra.items():
        if k == "legacy":
            t["legacy"].update(v)
        else:
            t[k] = v
    return t

def item(entry_id, result, promoted=False):
    ic = {"itemType": "TimelineTweet", "__typename": "TimelineTweet", "tweet_results": {"result": result}, "tweetDisplayType": "Tweet"}
    if promoted:
        ic["promotedMetadata"] = {"advertiser_results": {"result": {}}, "disclosureType": "NoDisclosure"}
    return {"entryId": entry_id, "sortIndex": "1", "content": {"entryType": "TimelineTimelineItem", "__typename": "TimelineTimelineItem", "itemContent": ic}}

# Every account and post here is made up (handles use a demo_ prefix) so no real person is tagged as bait.
quoted = tweet("1001", "demo_benchmarks", "Benchmarks (demo)",
               "A benchmark score without the exact prompt template is close to meaningless. Publish the template or the number.")
hustle = "Nobody is coming to save you. Wake up at 4am, grind while they sleep, and stop making excuses. Let's go 🔥"
entries = [
    item("tweet-2001", tweet("2001", "demo_evals", "Eval Notes (demo)",
         "Ran the same eval suite on three LLMs. The smallest model beat the largest on tool-call accuracy (91% vs 84%) once we fixed the prompt format.",
         quoted_status_result={"result": quoted})),
    item("tweet-2002", tweet("2002", "demo_hottakes", "Hot Takes (demo)",
         "Women today expect men to pay for everything but bring nothing to the table. Men, are you still dating? Be honest 👇", new_format=False)),
    item("promoted-tweet-2003-abc", tweet("2003", "demo_adco", "AdCo (demo)", "Upgrade your workflow with AdCo Cloud. Try it free today! https://t.co/ad1",
         legacy={"entities": {"urls": [{"url": "https://t.co/ad1", "expanded_url": "https://adco.example/try", "display_url": "adco.example/try"}]}}), promoted=True),
    item("tweet-2004", {"__typename": "TweetWithVisibilityResults", "tweet": tweet("2004", "demo_cat", "Cat Person (demo)",
         "my cat knocked my coffee off the desk, made direct eye contact, and then did the exact same thing with the spoon lol https://t.co/pic1",
         legacy={"extended_entities": {"media": [{"type": "photo", "url": "https://t.co/pic1", "ext_alt_text": "A smug orange cat next to a spilled mug"}]}})}),
    item("tweet-2005", tweet("2005", "demo_reposter", "Reposter (demo)", "RT @demo_dbtips: Postgres tip...",
         legacy={"retweeted_status_result": {"result": tweet("2006", "demo_dbtips", "DB Tips (demo)",
             "Postgres tip: a partial index on (user_id) WHERE deleted_at IS NULL cut our p95 latency from 180ms to 9ms.")}})),
    item("tweet-2007", tweet("2007", "demo_hustle", "Hustle Coach (demo)", hustle,
         legacy={"full_text": hustle[:70] + "…"},
         note_tweet={"is_expandable": True, "note_tweet_results": {"result": {"text": hustle, "entity_set": {"urls": []}}}})),
    {"entryId": "who-to-follow-2008", "sortIndex": "1", "content": {"entryType": "TimelineTimelineModule", "__typename": "TimelineTimelineModule", "displayType": "Vertical",
        "items": [{"entryId": "who-to-follow-2008-user-1", "item": {"itemContent": {"itemType": "TimelineUser", "__typename": "TimelineUser", "user_results": user("demo_popular", "Popular Account (demo)")}}}]}},
    {"entryId": "home-conversation-2009", "sortIndex": "1", "content": {"entryType": "TimelineTimelineModule", "__typename": "TimelineTimelineModule", "displayType": "VerticalConversation",
        "items": [
            {"entryId": "home-conversation-2009-tweet-2010", "item": {"itemContent": {"itemType": "TimelineTweet", "__typename": "TimelineTweet", "tweet_results": {"result": tweet("2010", "demo_stoic", "Stoic Notes (demo)", "Marcus Aurelius on attention: you lose only the present moment, so guard it. Plato said something similar about the soul.")}}}},
            {"entryId": "home-conversation-2009-tweet-2011", "item": {"itemContent": {"itemType": "TimelineTweet", "__typename": "TimelineTweet", "tweet_results": {"result": tweet("2011", "demo_celeb", "Celeb Watch (demo)", "The celebrity feud everyone is talking about just got messier. Full drama thread below!", legacy={"in_reply_to_status_id_str": "2010"})}}}},
        ]}},
    item("tweet-2012", tweet("2012", "demo_health", "Health Studies (demo)",
         "New RCT: 12 weeks of resistance training cut HbA1c by 0.6 points in adults with type 2 diabetes, about the same as adding a second drug.")),
    item("tweet-2013", tweet("2013", "demo_capitol", "Capitol Notes (demo)",
         "The Senate vote on the budget bill is tonight. Here is what is actually in it, section by section.")),
    item("tweet-2014", tweet("2014", "demo_physics", "Physics Notes (demo)",
         "Thread: why the arrow of time falls out of the low-entropy boundary condition of the early universe, and why that is not circular. 1/12")),
    item("tweet-2015", tweet("2015", "demo_gamer", "Gamer (demo)",
         "me: I'll play one ranked match before bed. also me at 4am, defending my honor in a match that does not matter lol")),
    {"entryId": "rtb-image-ad-9f3a", "sortIndex": "1", "content": {"entryType": "TimelineTimelineItem", "__typename": "TimelineTimelineItem", "itemContent": {"itemType": "TimelineRtbImageAd", "__typename": "TimelineRtbImageAd"}}},
    {"entryId": "cursor-top-123", "sortIndex": "2", "content": {"entryType": "TimelineTimelineCursor", "__typename": "TimelineTimelineCursor", "value": "abc", "cursorType": "Top"}},
]
payload = {"data": {"home": {"home_timeline_urt": {"instructions": [{"type": "TimelineAddEntries", "entries": entries}], "metadata": {}}}}}
out = pathlib.Path(__file__).parent / "fixtures/i/api/graphql/MOCKQUERYID/HomeTimeline"
out.write_text(json.dumps(payload, ensure_ascii=False, indent=1))
print("wrote", out, len(entries), "entries")
