# 2 · Custom recovery — ROMinit source research

Snapshot: **2026-10-16** (Europe/Dublin; collection began 2026-10-15 UTC). Research only: no catalog changes, commits, deployments, USB access or phone operations. This directory is not served by ROMinit.

## Coverage and interpretation

`devices.json` and `devices.csv` enumerate the complete captured official rosters for TWRP, OrangeFox and LineageOS, plus PBRP, SHRP and SHRP Reborn inventories described in `projects.md`. They are a source inventory, **not a list of flashable or maintained recoveries**. A source page, official device-tree repository and downloadable build are three different kinds of evidence. Historic and unsupported entries stay visible.

TWRP is pinned to website source commit `3fb09c958d84d6ee86908a2b7ca069171969c64b`; LineageOS to wiki commit `55880f7966ae7e7108c1a3dadfeb4c051426b139`. Mutable API responses are dated observations. The JSON retains source URLs and unknowns as `null`; CSV uses empty cells for nulls and JSON inside list-valued cells. `official_status` describes source membership, not a human endorsement. No entry is `curated`.

TWRP source has two distinct vendor devices named `odin`, and two BQ pages declaring `bardock`. `device_key` preserves the website page identity; do not deduplicate solely by codename. Some `downloadfolder` values encode several regional/model variants separated by `|`; these are preserved verbatim, not silently flattened into universal compatibility. Device counts are source entries, not normalized physical SKU counts. [Pinned source](https://github.com/TeamWin/twrpme/tree/3fb09c958d84d6ee86908a2b7ca069171969c64b)

### Date and release limits

Full device rosters do **not** imply exhaustive per-device release histories. TWRP download indexes were collected in detail for all five test codenames, including historical filenames, approximate displayed sizes and timestamps. No bulk download sitemap was found (`/sitemap.xml` returned 404); other TWRP build dates remain unknown to avoid a site-wide per-device crawl. A website `Current` flag can coexist with an old last build. [Example index](https://dl.twrp.me/hero2lte/)

OrangeFox release evidence includes a bounded latest-100 response and the historical Mi A3 response. `has_more=true` means this is **not a complete release inventory**; `page=2` returned identical data and is not usable pagination. A `limit=10000` request timed out and was not repeated. Its observed dates are lower bounds on latest availability, not authoritative per-device latest dates. The roster API includes unsupported devices. [Roster](https://api.orangefox.download/v3/devices), [bounded releases](https://api.orangefox.download/v3/releases?limit=100), [Mi A3 releases](https://api.orangefox.download/v3/releases?device_id=5e59825a77c93477b29eaea4)

LineageOS wiki coverage includes discontinued devices; live build-catalog membership and build dates are recorded separately. A ROM ZIP release is not a recovery image: the initial `lineage/releases.json` records those ZIPs only as update evidence; recovery artifacts must be taken from the build's image metadata. See `lineage/README.md` and the two recovery boot-image records. [Official API](https://download.lineageos.org/api/v2/oems)

## Authoritative sources

- TWRP: [official device index](https://twrp.me/Devices/), [search JSON](https://twrp.me/search.json), [website source](https://github.com/TeamWin/twrpme), [official download indexes](https://dl.twrp.me/).
- OrangeFox: [download API roster](https://api.orangefox.download/v3/devices), [project downloads](https://orangefox.download/), release records linked from the API.
- PBRP and SHRP: official website/data/tree repositories and release infrastructure, individually linked in `projects.md`, `feeds.md` and row-level `sources`.
- LineageOS: [wiki source](https://github.com/LineageOS/lineage_wiki), [device guides](https://wiki.lineageos.org/devices/), [Downloads API](https://download.lineageos.org/api/v2/oems).

## Files and reproduction

- `projects.md`: project activity, rosters, maintainers, releases and alternatives; `feeds.md`: polling and update signals; `pitfalls.md`: sourced safety/compatibility findings.
- `devices.csv` / `devices.json`: combined project × source-device roster; `releases.json`: sampled artifact/history metadata, not a complete global release database.
- `verified-samples.json`: binary download/hash attempts; a failure is not a verified image. Publisher SHA-256, locally measured SHA-256 and signature verification are separate facts.
- `evidence/requests.jsonl`: cached HTTP evidence manifest with URL, retrieval timestamp, size and SHA-256; hashed `.bin` files contain publisher metadata/source snapshots. Sample firmware binaries are deleted, never mirrored.
- `collect.py`, `build_inventory.py`, `verify_samples.py`, `verify_lineage.py`, `validate_snapshot.py`: Python stdlib only. Run from any directory with `python /path/to/build_inventory.py`; cached metadata avoids repeat requests. Missing cache entries cause a robots-checked live fetch. The verification scripts preserve prior attempts/attestations, skip already attempted samples and delete newly downloaded image bytes. Do not delete their result files to force a repeat. Source-specific auxiliary data is under `lineage/`. The combined builder uses the saved Lineage and PBRP/SHRP normalized inputs; the original all-device extraction script and Lineage raw archive/API responses were not recovered. Full independent re-extraction of those inputs is therefore not reproducible from this folder alone.

`collect.py` sends `ROMinit-research/1.0`, checks each origin's robots.txt, waits at least one second between uncached requests, and stops further requests to that origin on 401/403/429 and rejects disallowed paths. A 404 robots file is treated as no published restriction; other HTTP failures do not grant permission. Do not evade challenges or introduce concurrency to accelerate a refresh. External lookup used the ketch skill; source APIs were fetched directly with the named research agent.

## Fit for ROMinit

**Proposed shape, not an implemented schema:** keep recoveries as reusable, versioned catalog artifacts, rather than treating them as Android ROMs with irrelevant phone-feature ratings. For example, a future `catalog/recoveries/<codename>/<project>.json` could carry `id`, `project`, exact `models`, `origin`, `vetting: "scraped"`, `maintainer`, `released`, `support`, `slots`, firmware/Android/encryption compatibility, `requirements`, and installation `stages`. Each stage retains the current pinned `{name,size,sha256,source,url?}` files, recipe verbs, warning and human-typed destructive confirmation. ROM stages could reference an exact recovery artifact/version rather than duplicate its pin. This is a design proposal requiring validator/UI work; the current schema does not accept it unchanged. Local evidence: repository `README.md`, `catalog/devices/*/*.json`, `catalog/roms/*/*.json`, and `src/recipes/`.

TWRP terms permit links to HTML pages but prohibit direct file links and mirroring. Keep its HTML download page in `source`, omit `url`, and retain the existing user-download-and-select flow. A technically stable path is not permission to publish a direct link. [Publisher terms on a file page](https://dl.twrp.me/hero2lte/twrp-3.7.0_9-1-hero2lte.img.html)

| Install method | Recipe candidate | Missing / constraint |
|---|---|---|
| Raw image → physical `recovery`, `boot`, or `vendor_boot` | `fastboot` | Exact partition/slot must come from device guide; no temporary boot or AVB-disable flags |
| Temporary `fastboot boot recovery.img` | None | `boot` verb absent; do not substitute a permanent flash |
| Samsung raw recovery image → `RECOVERY` | `odin` | `.tar`/`.tar.md5` unpacking absent; model detection limited to PIT; manual immediate recovery entry |
| Recovery installer ZIP via existing recovery | `twrp-sideload` | User must select sideload; installer determines compatibility, slot writes and patching |
| Raw image via existing TWRP ADB shell | `twrp-dd` | TWRP property required; explicit by-name paths; cannot infer safe ramdisk patching |
| A/B boot-ramdisk patch / installer; vendor_boot fragments | Device-specific ZIP or new work | Never model a ramdisk patch as raw whole-boot overwrite without explicit upstream instructions |

More detailed source-to-recipe comparison and the five device guides are in [fit-notes.md](fit-notes.md). `twrp-sideload` uses the ADB sideload transport, but protocol compatibility with every Lineage/Fox recovery has not been exercised. Hash-correct bytes do not establish decryption, bootability or transport support.

## Open questions before any catalog import

Obtain missing exact byte sizes and SHA-256 values (MD5 alone is insufficient for ROMinit); resolve TWRP source collisions and regional variants; validate recovery-image vs ROM-ZIP assets; establish current per-device maintainers and compatible firmware/Android/FBE combinations; verify TWRP/Fox/PBRP/SHRP APIs' complete release pagination; and review the exact partition/slot transition in each upstream guide. Signature availability does not mean a trusted-key verification was performed.

No hardware acceptance is claimed. No repository-wide tests/build are required for research-only outputs; script diagnostics and inventory consistency checks are recorded below.

## Resume outcome and coverage totals

The crash-interrupted output was resumed on 2026-10-16. Valid saved rosters, HTTP bodies and documentation were retained. The combined builder previously omitted the saved PBRP/SHRP records because their JSON envelope differed; it now reads that envelope. Source identity keys preserve SHRP's conflicting `crownlte` rows. SHRP Reborn was added separately, and Lineage recovery images were merged separately from ROM-ZIP update evidence.

| Project | Source-device entries | Entries with observed build date | Interpretation |
|---|---:|---:|---|
| TWRP | 898 | 5 | Complete captured website roster; detailed indexes for five targets |
| OrangeFox | 162 | 26 | Complete captured device API; dates from bounded releases only |
| LineageOS | 631 | 344 | Wiki roster; 345 in current build catalog, one without dated build |
| PBRP | 143 | 0 | 135 current-site pages + 8 unmatched source trees |
| SHRP | 131 | 0 | 106 device-feed rows + 25 tree-only; includes codename conflict |
| SHRP Reborn | 8 | 0 | 6 device-feed rows + 2 tree-only |
| Total | 1,973 | 375 | Source entries, not unique physical models or flash-ready builds |

`releases.json` has **318 evidence records**: 179 TWRP historical artifacts, 101 OrangeFox records, 27 SHRP named artifacts, four Reborn named artifacts, five Lineage target-status/ROM-ZIP records, and two Lineage recovery boot images. Three of the Lineage target-status records have no current release. This deliberately heterogeneous research file is not a catalog schema. SHRP/Reborn folder-only URLs remain device metadata, not invented release filenames. PBRP live binary names/sizes/digests were not captured.

Two modest-sized recovery images have publisher size/SHA-256 matches: Mi A3 `boot.img` (67,108,864 bytes) and Pixel `boot.img` (30,924,800 bytes). The Mi A3 verification is recovered from the pre-crash collector's recorded byte count/hash; its bytes were already deleted, so it was **not downloaded again**. Pixel was downloaded once during resume, hashed, matched and deleted. Neither signature was verified; neither image was booted. See [verification records](lineage/verified-samples.json) and the per-device API URLs in [recovery metadata](lineage/recovery-releases.json).

All three earlier TWRP sample attempts failed the Android-image check because the responses were HTML pages. They remain failures, even though published SHA-256 sidecars are preserved. The resumed run did not retry those images, mirrors, sidecars, saved device pages or saved release APIs.

## Request accounting and deviations

This section preserves limitations of the interrupted run instead of claiming compliance that its evidence cannot demonstrate.

- **Repeated requests:** the initial manifest had 57 successful-response records, including five fetches of OrangeFox `robots.txt` (four redundant). The resumed collector reuses saved robots bodies across processes. Earlier TWRP sampling requested the same three image names on two origins (main and EU) and received HTML each time; those six failed sample bodies were deleted. This was unnecessary request volume and did not verify a binary. No further mirror was tried during resume.
- **Broad/unsuccessful probes:** the saved notes report OrangeFox `limit=10000` timing out and an ineffective `page=2` returning the same 100 records. The Lineage normalized snapshot describes checking 345 current targets for build dates, substantially more requests than a minimal metadata sample. Its extraction code, raw archive and most raw API responses were not recovered. Exact total HTTP requests, failed probes, earlier lookup-backend traffic, request ordering and spacing therefore cannot be reconstructed. The 57 records are a lower bound, not the earlier run's total.
- **Policy provenance gaps:** several earlier origins have no saved robots response (a 404 was not recorded by the old collector). Downloads-app `robots.txt` returned HTML rather than directives. Earlier source lookup/backend user agents and robots handling cannot be audited from this folder. Initial code stopped on HTTP 401/403/429 but did not detect an HTTP-200 HTML response as a binary block. HTML-returning TWRP image paths were not probed again. No challenge or access-control bypass was used in the resumed work.
- **Resume requests:** nine new successful-response records were appended: one Pixel image, Reborn organization/tree/profile metadata and two tiny pinned data files, a PhilZ README, and a maintainer page plus its robots file. A guessed ClockworkMod repository returned 404; it was not retried. Three small ketch discovery searches were also used; their backend request counts/User-Agent are not exposed in this manifest. Missing robots files can cause a robots 404 outside the successful-body manifest. Source fetches used the named ROMinit collector sequentially with delay and robots checks. A source 404 was treated as missing evidence, never as proof a project is dead.
- **Scope and reproducibility:** only this target folder was written; no phone, catalog, Vault, commit or push was touched. `build_inventory.py` reconstructs final CSV/JSON from retained caches and normalized inputs; `validate_snapshot.py` is offline. The resumed work did not re-fetch saved resources. No claim is made that every historical fork or unofficial maintainer was enumerated, every latest date was resolved, or missing raw Lineage evidence was reconstructed.

The final successful-body manifest has **66 records**, 62 unique URLs; 58 records have retained bodies whose sizes/SHA-256 match (54 unique bodies). Eight image-attempt bodies were intentionally deleted: six invalid TWRP HTML responses and the two correctly hashed Lineage images. This manifest logs successful bodies only; it is not a complete traffic log. Hash attestations for deleted bytes are historical measurements, not reproducible present-byte checks.

## Validation and remaining gaps

`python build_inventory.py` regenerates 1,973 device rows and 318 release-evidence records without network traffic when using this snapshot. `python validate_snapshot.py` passes source identity, CSV/JSON parity, date/hash syntax, sample-to-release pin joins, and retained-cache size/hash checks. `pyright *.py` reports zero errors/warnings. Run these commands from this directory, or pass absolute script paths from elsewhere. All scripts use only Python's standard library.

Still unverified: exhaustive per-device latest releases for TWRP/OrangeFox/PBRP/SHRP/Reborn; exact sizes and SHA-256 for most artifacts; signatures and trusted keys; undocumented feed pagination; unofficial-port completeness; current maintainers/firmware/FBE compatibility; vendor_boot/AVB procedures for specific future targets; and all hardware/USB/boot behavior. Nulls retain these gaps. No repository-wide application tests/build were run because only research files changed.
