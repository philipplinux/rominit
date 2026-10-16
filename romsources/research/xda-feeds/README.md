# XDA release feeds: feasibility snapshot

Snapshot: **2026-10-16**. Scope: research and a minimal access probe only. No catalog changes, deployed polling, login, ROM downloads, commits, or pushes.

## Verdict: partly — useful idea, XDA polling not established

ROMinit can use release feeds as discovery hints, but **this run could not verify any working XDA forum feed**. The first direct request, `https://xdaforums.com/robots.txt`, returned HTTP 403 and a Bunny Shield JavaScript/browser challenge. We stopped all direct XDA requests immediately, including other XDA hostnames; no challenge solving, proxy, browser fallback, or retry. See [response body](samples/robots.txt) and [status, headers, URL and UTC timestamp](samples/robots.meta.json). The `.txt` body is HTML, not robots directives. This establishes blocking from this environment, not that XDA has no RSS.

**Best candidate XDA pattern:** `https://xdaforums.com/f/<forum-slug>.<node-id>/index.rss`. This is a hypothesis derived from XenForo's documented forum-feed shape and indexed XDA forum URLs, not a verified XDA endpoint. Best production direction: monitor builder release sources for known ROMs, use XDA only for discovery/context after permitted access is established.

## Evidence and request accounting

- **One direct request to XDA is captured**: anonymous GET of forum-host robots.txt, User-Agent `ROMinit/0.1 (ROM release feed feasibility research)`, no credentials or cookies; HTTP 403. Headers identify the response and the body explicitly names Bunny Shield. No evidence that Cloudflare caused this failure. [Capture](samples/robots.meta.json), [body](samples/robots.txt).
- Remaining XDA URL discovery used search-engine indexes through Ketch, without fetching those result pages. Index text is secondary, potentially stale evidence, not a current feed capture. `samples/search*.json`, `samples/more*.json`, and `samples/pixel.json` retain results/errors; `more3.json` and `more4.json` retain XenForo vendor-forum discussions. Some searches timed out or were rate-limited by the search provider; those are not XDA rate-limit observations.
- No XDA XML feed was received, so `samples/` contains the blocking response and indexed evidence, **not fabricated XDA feed samples**. The live access probe is the small proof of concept. A generic offline-tested poller is supplied for permitted sources; it does not establish XDA feed compatibility.

## Resume audit and deviations

Resumed on **2026-10-16 (Europe/Dublin)** after the desktop crash. All 23 pre-existing files were retained; no saved resource was downloaded or searched again. This continuation made **zero network requests**, reused the captured block, corrected the importer/exporter source confusion, and completed offline poller tests. Original HTTP captures are dated 2026-10-15 UTC, which is 2026-10-16 locally.

The earlier run left **17 Ketch search-result/error files**, including several empty, timed-out or provider-rate-limited results. This was more discovery work than the “few requests” intent warranted; no numeric budget was specified. One result file is not necessarily one upstream request, so total provider requests cannot be reconstructed. Preserve these files as the audit trail rather than repeating searches. Only one direct XDA request is evidenced by the surviving captures; an exhaustive earlier request log is unavailable, so the earlier “exactly one” accounting cannot be independently proved.

The earlier README also reports a direct XenForo 403 and an independent Ketch GitHub Atom fetch, but their raw responses were not saved. The Atom fetch happened without prior robots verification by that researcher; the later saved GitHub robots policy disallows it. Treat that as a deviation, not a permitted technique. Its claimed release contents and the SimpleRSS observation are uncorroborated run notes and are not used to establish feed compatibility. No attempts to repair these evidence gaps with new requests were made. No new XDA feed samples can be supplied while honoring the stop-on-block instruction.

## Feed capability matrix

| Scope | Candidate / source | Finding |
|---|---|---|
| Per forum | `<forum URL>index.rss` | Generic XenForo pattern; XDA untested after stop |
| Global forum feed | XenForo `/forums/-/index.rss` | Vendor example; XDA route alias unknown |
| Sort by thread creation | `index.rss?order=post_date` | Vendor discussion supports it, with reader-order caveats; XDA untested |
| Per thread | No confirmed XDA route | Do not invent `/t/.../index.rss`; saved discussion concerns RSS importing, not thread export; inconclusive |
| Prefix | `index.rss?prefix_id=<id>` | Historical vendor support, later “not a bug” report of filtering failure; unsafe assumption |
| Tag / Atom | No confirmed XDA route | No evidence obtained for native tag RSS or Atom; unknown, not proven absent |

Sources: XenForo [forum/global URL and ordering examples](https://xenforo.com/community/threads/rss-for-new-threads-only.173766/), [threads with new posts / search-forum workaround](https://xenforo.com/community/threads/only-latest-threads-in-rss-feed.210451/), [historical prefix example](https://xenforo.com/community/threads/prefixes-specified-in-rss-feeds.20261/), [later prefix report](https://xenforo.com/community/threads/prefixes-specified-in-rss-feeds-broken.205674/). `single-thread.json` discusses importing RSS into a thread, so it provides no evidence about exporting thread feeds. These are version-specific vendor-community discussions, not a current XDA compatibility guarantee; captured index text is in `more3.json`, `more4.json`, `single-thread.json`. A direct vendor-page fetch also returned 403; no further vendor-page probing followed.

### What an item contains, and what triggers it

**For current XDA feeds all are unknown:** title field, date field and its meaning, author, thread/post link, body/excerpt or truncation, GUID stability, item count, retention window, MIME type, login requirements, conditional-request support, and whether OP edits change feed content. No XML was obtained to inspect these. Do not claim a default count such as 20 or 30.

Generic XenForo discussions describe feeds listing **threads with new posts**, rather than an append-only list of newly created threads. A reply bump therefore need not be a ROM release. They also describe creation-order sorting; sorting is not a reliable new-build filter. Whether the item date/body represents the first or last post on XDA needs an actual capture and before/after observation. Sources: [XF 2.2 discussion](https://xenforo.com/community/threads/only-latest-threads-in-rss-feed.210451/), [XF 2.1 ordering](https://xenforo.com/community/threads/rss-for-new-threads-only.173766/).

## Requested device targets

All forum pages below were located in search indexes; **none was fetched live or feed-tested**, because robots.txt was already blocked. Appending `index.rss` gives the exact proposed test URL. S9 and S9+ are separate forums; their cross-device forum also matters. Evidence: `search0.json`, `search1.json`, `more0.json`, `more2.json`, `pixel.json`.

| Device | Indexed forum URL | Feed test outcome |
|---|---|---|
| hero2lte, S7 edge Exynos | https://xdaforums.com/f/samsung-galaxy-s7-edge-exynos-roms-kernels-rec.5186/ | Not attempted: access stop |
| starlte, S9 | https://xdaforums.com/f/samsung-galaxy-s9-roms-kernels-recoveries-ot.7412/ | Not attempted: access stop |
| star2lte, S9+ | https://xdaforums.com/f/samsung-galaxy-s9-roms-kernels-recoveries-ot.7534/ | Not attempted: access stop |
| starlte/star2lte, cross-device | https://xdaforums.com/f/samsung-galaxy-s9-s9-cross-device-development.7560/ | Not attempted: access stop |
| laurel_sprout, Mi A3 | https://xdaforums.com/f/xiaomi-mi-a3-roms-kernels-recoveries-other-de.9053/ | Not attempted: access stop |
| sailfish, Google Pixel | https://xdaforums.com/f/google-pixel-roms-kernels-recoveries-other-de.5913/ | Not attempted: access stop |

For example, the first proposed feed is `https://xdaforums.com/f/samsung-galaxy-s7-edge-exynos-roms-kernels-rec.5186/index.rss`. These are research candidates, not an enabled polling list. Do not substitute the S9 Snapdragon forum for starlte/star2lte; its indexed description explicitly identifies Qualcomm devices ([indexed forum](https://xdaforums.com/f/samsung-galaxy-s9-s9-snapdragon-roms-kernels.7866/), `more2.json`).

## Access rules and operational limits

- **Forum robots policy unavailable:** 403 prevents interpreting forum-host robots directives; fail closed. Login requirements remain unknown; this was a shield challenge, not a demonstrated login requirement. [Capture](samples/robots.meta.json).
- **Terms require clarification before automation:** indexed [Valnet Terms of Use](https://www.valnetinc.com/en/terms-of-use) prohibit crawling, scraping and automated content collection. Indexed [editorial-host robots.txt](https://www.xda-developers.com/robots.txt) says automated retrieval needs written permission. See `more5.json`. The editorial host and forum host are distinct: neither this robots file nor general Valnet terms prove the precise current contractual policy of the forum. We could not fetch the forum's terms or verify its current terms link. These findings do not authorize feed polling; obtain forum-specific clarification/permission, including whether RSS syndication is an exception. No legal conclusion is asserted here.
- **Rate limits unknown:** no requests-per-minute experiment, no numeric quota inferred from one 403. If later permitted, propose once daily per selected forum, serial requests with spacing, conditional GET where supported, and immediate suspension on 401/403/429 or HTML challenge. This cadence is a design proposal, not an approved XDA allowance. Honor Retry-After; no automatic retries on a block.
- **Bounded feeds can miss releases:** finite retention plus downtime can lose entries. Same-GUID changes may be updates; OP-only edits may never appear. These are design risks to test, not measured XDA behavior. Retain IDs and content fingerprints rather than relying on a last-date cursor alone.

## Alternatives

| Source | Exact interface | Assessment |
|---|---|---|
| XenForo REST | `<forum-base>/api/`, `XF-Api-Key` header | Administrator cooperation required; not anonymous |
| Thread watching | Logged-in watch UI, email/on-site notices | Human-assisted signal; no confirmed XDA feed endpoint |
| GitHub releases | `https://api.github.com/repos/ivanmeler/ota_provider/releases` | Best concrete next candidate for existing hero2lte builds; API response not fetched here |
| GitHub Atom | `https://github.com/ivanmeler/ota_provider/releases.atom` | Technically returned entries through Ketch, but robots disallows `.atom`; do not enable |
| SourceForge files | `https://sourceforge.net/projects/<project>/rss?path=<encoded-folder>` | Useful artifact signal when mapped to the actual builder/device path |

**XenForo API:** the [official manual](https://docs.xenforo.com/manual/reference/rest-api) says all requests require a key generated by a super administrator. [Thread endpoints](https://docs.xenforo.com/api/threads) and [current-user alerts](https://docs.xenforo.com/api/alerts) are documented. Generic XenForo support does not prove XDA enables or grants its API. A user-scoped key plus alert polling is a possible arrangement, not a verified XDA integration. No watch/unwatch endpoint was established in this research.

The [XenForo discussion feature page](https://xenforo.com/features/discussion/) documents watched thread/forum notifications by email or on-site alerts. This is a possible human-assisted fallback, not evidence that an XDA account can export an RSS watch feed. Quiet threads, email delivery rules and edits still need testing; do not automatically ingest private account mail without separate authorization.

**GitHub:** the independent research fetch of the Atom URL used Ketch's extracted-Markdown mode; it reported hero2lte entries dated 2025-06-28. No raw XML was retained, so item count and XML fields are not verified. Before the parent fetched any feed, it captured [GitHub robots.txt](samples/github-robots.txt) ([metadata](samples/github-robots.txt.meta.json)): the wildcard-agent group includes `Disallow: /*.atom$`. We did not issue a direct Atom request after that. The extracted result establishes technical availability only, not permission. Prefer the documented [Releases API](https://docs.github.com/en/rest/releases/releases), which supports unauthenticated public-resource reads and structured release/assets data; it is distinct from tags without releases. Check API access policies and rate-limit headers before enabling it. It needs a JSON adapter rather than the XML poller in this folder.

**SourceForge:** [official RSS guidance](https://sourceforge.net/p/forge/documentation/RSS/) describes project RSS and feature-dependent availability. It asks for serial requests, at least 30 minutes between updates, and no more than 50 monitored feeds. Those are SourceForge rules, not XDA limits. A file feed detects uploads, including possible reuploads or non-ROM assets, rather than proving a usable release; filter to the builder/device path and confirm checksums/version before queueing catalog work. No builder's SourceForge feed was fetched here.

The independent check observed the platform pattern at [SimpleRSS's file feed](https://sourceforge.net/projects/simplerss/rss?path=/). This is a platform example, not a ROM builder recommendation. Prefer the project's advertised/autodiscovered feed; do not assume `/files/rss` is equivalent. Confirm an actual XDA-linked builder's project/path later after permitted source mapping.

**Third-party feed services:** examples to evaluate are [RSS.app](https://rss.app/pricing) and [FetchRSS](https://fetchrss.com/prices); their plan pages document feed-count, refresh and item-window limits. A hosted converter could move parsing and scheduling elsewhere, but adds another operator, price/availability dependency, and another interpretation of the page. It cannot grant XDA access rights or make bypassing a shield acceptable. No such service was tested or configured; do not use one as a workaround for this block. A service already consuming an explicitly authorized publisher feed could be evaluated later.

## Recommended ROMinit flow (proposal, not implemented)

1. Maintain a small human-reviewed source mapping: device codename, builder identity/profile, ROM family/branch/channel, catalog path and ROM ID, canonical thread ID if known, upstream release source. For each source establish access permission before enabling polling.
2. Poll permitted feeds/APIs → normalize URL, stable item/release ID, published/updated time, title and bounded plain-text excerpt → deduplicate with persistent state → queue **candidate events**, not confirmed builds. Treat feed content and outbound URLs as untrusted; no commands/instructions from posts are executed.
3. For an existing ROM, verify an actual new upstream artifact/version/build date/checksum. Ignore ordinary replies, support questions, kernels/recoveries outside scope, duplicate mirrors, and a changed title without a new artifact. Missing or conflicting identity goes to human triage. A feed discovery timestamp never becomes the ROM build date.
4. Queue the rom-scraper agent with source URLs, candidate evidence, target codename, matching catalog file/ID, and the existing `romvault/roms/<codename>/<rom-id>.md`. The agent applies the scraper guidance: prerequisites, supported models, hardware claims only with evidence, file SHA-256/size/source, recipe steps, `vetting: scraped`, no self-curation. A changed build does not inherit old hardware verification automatically.
5. Human reviews the proposed catalog/ROMvault diff and validation before approval/publication. The watcher never flashes a phone, supplies a typed destructive confirmation, or publishes changes. The later catalog change would run `npm test && npm run build`; neither command is appropriate for this research-only folder change.

Local implementation anchors: [`scripts/load-catalog.mjs`](../../../scripts/load-catalog.mjs) loads `catalog/roms/<codename>/*.json` and checks ROM IDs are unique per device; [scraper guidance](../../../romvault/skills/rom-scraper/SKILL.md) defines evidence and catalog handling.

### Existing build versus new ROM

Use an explicit source mapping, not a fuzzy match on title or author display name. A known thread/release repository + codename + builder + branch/channel maps to an existing catalog entry. A new release ID/artifact hash within that mapping is an **update candidate**. A new thread is only a **discovery candidate**: it may duplicate an existing ROM, introduce another builder, or represent another major version. An unknown builder/branch/codename requires review before deciding whether to add a ROM ID.

Concrete existing example: `catalog/roms/hero2lte/lineage.json` has `lineage-20.0` and `lineage-21.0`, both attributed to ivanmeler, with file source URLs under `https://github.com/ivanmeler/ota_provider/releases/tag/...`. The 20.0 file is pinned to `lineage-20.0-20250628-UNOFFICIAL-hero2lte.zip`. A later hero2lte 20.0 build would be an update candidate; a different builder or major branch needs review. `catalog/roms/starlte/pmos-server.json` instead has a date-bearing ID `pmos-server-v2026.10.15-s9`; therefore there is no universal stable-family-ID convention to infer automatically. These are current local catalog observations, not fresh external release checks. No claim was made that these are the newest upstream builds.

### Where it could run

A **scheduled agent/local timer** is the smallest fit for a future Python-stdlib poller and scraper review queue. Keep state and evidence durably, prevent overlapping runs, bootstrap by recording the current window silently, then print only unseen IDs or changed fingerprints on subsequent runs. Persist state atomically only after successful parsing/queueing; errors must not advance it. No scheduler was installed.

A **Cloudflare Worker Cron Trigger** could poll and enqueue events, with persistent state in D1/KV and a review consumer; it would be a separate implementation rather than deploying a local Python script unchanged. Do not keep deduplication state only in process memory. Scheduling does not solve access restrictions. See [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

## Open questions / next permitted experiment

- Can forum administrators confirm approved automated RSS use and provide the forum robots/terms policy or an API key? Does a feed exemption exist?
- After access is permitted, fetch one target feed anonymously first; stop again on blocking. Then capture the remaining device feeds serially. Record status, MIME, final URL, validators, item count and all item fields. Do not create test posts; observe natural new threads/replies/OP edits over time.
- Verify whether sorting/prefix parameters actually affect XML; distinguish thread GUID, post URL and timestamps. Check native thread/tag feeds only from advertised links or administrator guidance, not endpoint enumeration.
- Verify the builder's current release/OTA source for each existing catalog ROM, and whether a busy multi-device release feed retains enough history for the proposed cadence. Use SourceForge path filtering or GitHub release pagination/backfill when available and permitted.

## Small poller proof of concept

`poll_feeds.py` uses Python's standard library only and consumes a UTF-8 text file containing one feed URL per line (blank lines and `#` comments allowed). It prints JSONL fields `id`, `title`, `date`, `author`, `link`, `excerpt`. It prints the current window on first run; subsequent runs print unseen item identities. It does not detect edited content under an unchanged identity. This deliberately smaller proof of concept is not the full fingerprint/queue design above.

After selecting a **permitted** source, create `feeds.txt` in this folder, then from the repository root run:

```sh
python romsources/research/xda-feeds/poll_feeds.py \
  romsources/research/xda-feeds/feeds.txt \
  --state romsources/research/xda-feeds/state.json
```

No enabled source list is supplied. The script explicitly refuses XDA hosts for this snapshot, checks robots before fetching, stops on errors/challenges, and keeps its state inside this research folder. It fails closed on robots wildcard/end-anchor rules because `urllib.robotparser` does not implement their matching semantics. This means many real sites will be refused; replace that limitation only after a separately reviewed, compliant implementation is needed. Two-second request spacing is courtesy, not a substitute for source-specific polling/crawl-delay requirements. Do not schedule this proof of concept as a production monitor.

Offline verification (synthetic test inputs are not live feed captures):

```sh
PYTHONDONTWRITEBYTECODE=1 python -m unittest discover \
  -s romsources/research/xda-feeds -p 'test_poll_feeds.py'
```

The poller stores state before its caller prints items; it is a standalone demonstration, not a reliable queue transaction. For production, persist candidate events with deduplication before acknowledging progress and arrange replay/recovery. It does not follow a release link, fetch an artifact, edit the catalog or trigger an agent.

## Source inventory

Repository facts were read from `catalog/roms/hero2lte/lineage.json`, `catalog/roms/starlte/pmos-server.json`, `scripts/load-catalog.mjs`, `AGENTS.md`, and `.agents/skills/rom-scraper/SKILL.md`; none was modified. External claims have inline source URLs or captured evidence. No Vault note was written because the user restricted every write to this research folder. No Codex memory fact is used as evidence for this snapshot.

## Completion checks

- Five offline unittest cases passed on resume: RSS fields, Atom fields, deduplication over two polls, failure/state preservation, and XDA/path refusal before network access.
- `pyright poll_feeds.py test_poll_feeds.py`: checked on resume (see `verification.txt`).
- All pre-existing captures were retained. No continuation network requests, catalog edits, Vault writes, scheduler installation, commits or pushes.
- XDA device-feed tests and raw feed samples remain blocked by the captured 403; they are explicitly unverified, not completed live tests. The generic poller is retained as an offline demonstration even though the request only required it if feeds worked.
