# GrapheneOS device, release and installation inventory

Research snapshot: 2026-10-16 (Europe/Dublin). Individual HTTP observations include their UTC timestamps/headers. Research only; no phone was accessed, no adb/fastboot command was executed, and no factory or OTA image was downloaded. All artifacts from this job live in this directory; catalog, application code and Vault notes were outside the authorized write scope.

## Coverage and interpretation

The [official FAQ](https://grapheneos.org/faq#supported-devices) lists 21 production-supported Pixel devices. Its [former-support section](https://grapheneos.org/faq#legacy-devices) lists 19 end-of-life consumer devices and two former source-only development boards (HiKey and HiKey 960) without official published builds: **42 unique research rows** in total. Source-only boards are not install targets.

The [current release table](https://grapheneos.org/releases#devices) lists build **2026100600** for all 21 current devices in Stable, Beta and Alpha: 63 device/channel observations. A release announcement/build date is not the date a channel was promoted. Channel manifests and file `Last-Modified` timestamps are retained separately. Historical release tags are evidence of releases listed in the archive, not proof of current download availability or an exact support termination date.

[OEM minimum-support end months](https://grapheneos.org/faq#device-lifetime) are promises about minimum support, not exact GrapheneOS EOL dates. Pixel 6/6 Pro are still on the production list at collection time despite reaching their guaranteed end month in October 2026. The snapshot preserves that distinction. Extended support is a temporary harm-reduction policy which [cannot provide full security patches](https://grapheneos.org/faq#device-lifetime); it must not be inferred merely from the age of a device. No current device is relabelled extended solely on that basis. “Legacy” is the proposed ROMinit status for former targets; `end-of-life` describes their upstream support state.

Model numbers come from the official GrapheneOS device configuration and/or specifically linked official vendor evidence. A model number is not proof of bootloader unlockability: [carrier restrictions depend on the device's carrier provisioning](https://grapheneos.org/install/cli#prerequisites). Unknown model lists, dates and versions are null, never guessed. The historical roster includes pre-GrapheneOS project names; [project history](https://grapheneos.org/history/) explains the branding continuity.

## Release integrity and file metadata

`releases.json` records every current channel, exact factory-install ZIP filename, version-pinned direct URL, source page, byte size from HTTP HEAD, complete detached OpenSSH signature, signature URL, response headers and small channel manifest. These are metadata requests only. OTA files are not substituted for initial-install images: [upstream explicitly distinguishes them](https://grapheneos.org/releases).

No published archive SHA-256 was established in this research: `sha256` is null. A detached signature, ETag, verified-boot key fingerprint and ZIP SHA-256 are different things. The captured signatures were **not cryptographically verified against image bytes**, since downloading images was prohibited. Byte sizes are server declarations, not local file measurements. Upstream [signature verification instructions](https://grapheneos.org/install/cli#obtaining-factory-images) remain authoritative.

## Ratings and kernel interpretation

`rating.features` contains every current ROMinit feature key. Only explicitly sourced results are assigned; unknown hardware functionality remains `untested`. `fde` maps ROMinit's disk-encryption label to [GrapheneOS filesystem-based encryption](https://grapheneos.org/faq#encryption), not a claim that GrapheneOS uses legacy Android block FDE. An official supported-device listing is not a per-component hardware test.

Research `rating.includes` preserves null for unresolved or poorly fitting values. ROMinit currently accepts only `yes`/`no`/`optional`; therefore these research rows deliberately are **not directly importable catalog entries**. In particular, a single banking-app boolean cannot express [per-app compatibility and Play Integrity restrictions](https://grapheneos.org/usage#banking-apps). Sandboxed Google Play is an [optional normal-app installation](https://grapheneos.org/usage#sandboxed-google-play), not privileged preinstalled Google Play or a guarantee of banking compatibility. Tablet/board phone UI and modem results must not be copied from phones.

The current [release-tagged manifest](https://raw.githubusercontent.com/GrapheneOS/platform_manifest/2026100600/default.xml) identifies Android 17 and downstream device kernel repositories. `kernel-research.json` preserves the per-device mapping, branch/version evidence and limits; `rating.kernel.version` is only filled where the join can use that evidence. A kernel branch is not an observed `uname -r`. Historical targets retain unknown base/kernel data where not verified. `rating.support` follows ROMinit's recency classification and is separate from security-support guarantees.

## Authoritative sources

- [FAQ: supported devices, former devices and support lifetime](https://grapheneos.org/faq)
- [Current releases and historical announcements](https://grapheneos.org/releases), [release server](https://releases.grapheneos.org/), and per-device/channel manifests linked in `releases.json`
- [Official web installer](https://grapheneos.org/install/web), [CLI guide](https://grapheneos.org/install/cli), [web installer source](https://github.com/GrapheneOS/grapheneos.org)
- [Features](https://grapheneos.org/features) and [usage/app compatibility](https://grapheneos.org/usage)
- [Release-tagged device/SKU configuration](https://github.com/GrapheneOS/adevtool/tree/2026100600/config/device) and [build manifest](https://github.com/GrapheneOS/platform_manifest/blob/2026100600/default.xml)

Per-claim URLs are carried in row `sources`, `rating_sources`, release metadata, kernel evidence and the installation/pitfall documents. Official Google vendor evidence is distinguished from GrapheneOS claims. Any forum evidence in the detailed documents is secondary, never a replacement for the official install sequence.

## Files and reproduction

- `devices.json` / `devices.csv`: one row per target, including current releases, support/models, rating fields, kernel evidence, install links, fingerprints, requirements and pitfalls. CSV nested objects/arrays are JSON cells; empty scalar cells represent null.
- `releases.json`: 63 current channel observations; `historical-release-tags.json`: parsed archive tag/device groups with announcement links.
- `install-paths.md` / `pitfalls.md`: exact upstream paths, verified boot fingerprints, compatibility and safety constraints; `draft-notes/<codename>/grapheneos.md`: 42 unpublished-format notes, all marked never agent-flashed.
- `device-research.*`, `kernel-research.*`, `sources/`, `*-page.html`, `feature-release-sources.md`, `manifest-source.xml`: retained evidence and interpretation. Raw Ketch captures may include its URL/title wrapper before the original body.

Python scripts use only the standard library. `python collect_releases.py` resumes metadata collection for rows in the captured `releases-page.html` (HEAD for images, GET only for small signatures/manifests); it reuses saved headers/signatures/manifests, deduplicates missing requests, and does **not** refresh that HTML or already saved metadata. Archive old captures explicitly before a deliberate future refresh. Capture a fresh page first with `ketch scrape https://grapheneos.org/releases --raw > releases-page.html`, then inspect changes before refreshing. `python build_inventory.py` regenerates the joined inventory, historical tag extraction and notes offline from captured evidence. It checks unique rows, current-device/release coverage, manifests, signatures, sizes and exact rating keys. To refresh device/kernel evidence, follow the URLs in their research files and retain source revisions; those captures are not silently refreshed by the join.

## Fit for ROMinit

For **each of the 21 current devices**, the proposed eventual path is a dedicated GrapheneOS factory-ZIP recipe over fastboot; the per-device `proposed_recipe` field records this. Until implemented and independently validated, link to the official web installer. For **all 21 former targets**, propose no active flash recipe. This is an engineering recommendation based on the local recipe inspection, not upstream endorsement of ROMinit.

Local code inspected through CodeGraph: `src/recipes/fastboot.js:4` only allows flash/erase/set_active/reboot, refuses logical partitions and requires an already unlocked bootloader. `src/recipes/fastboot-tgz.js` parses gzip/tar vendor archives and reuses those verbs; README describes its stock-restore use and no locking. GrapheneOS publishes ZIPs, uses a complete factory flow, and requires unlock/relock and verified-boot key handling. Relabelling a ZIP as `fastboot-tgz`, omitting AVB key provisioning, or translating only a few flash commands would not be a complete supported install path. See the source-backed details in `install-paths.md`.

Catalog/recipe gaps: ZIP and nested image handling; release/partition/firmware requirements; upstream flashing order, reboots/reconnections and dynamic partition behavior; trusted archive SHA-256 pinning or an explicitly designed signature-verification policy; AVB key provisioning and per-device verification; separate destructive unlock/relock stages with human-supplied typed confirmations. Existing catalog `requirements`/warnings can carry prerequisites, but unknown ratings and mixed banking compatibility need an owner decision before import. No implementation or catalog promotion was performed.

Open questions for the owner: link-only GrapheneOS listings first, or fund a dedicated recipe? How should signed upstream artifacts without a published SHA-256 enter the current SHA-256-pinned catalog without downloading full images in this job? Should former consumer devices and source-only boards remain research-only? How should null includes, partial app compatibility and source-derived feature evidence be represented without overstating tested hardware?

## Crash recovery and request accounting

Resumed on 2026-10-16 after the desktop crash. Existing HTML, source captures, kernel evidence, release records and installation documents were retained. The missing device join and draft notes were reconstructed from these saved sources. No saved source was re-fetched, and no image was downloaded during this resume.

The earlier collector loops over 63 channel rows and performs one image HEAD, one signature GET and one channel-manifest GET per row: **189 request attempts per complete invocation**. All three channels share the same build for each device in this snapshot, so 42 image HEADs and 42 signature GETs were redundant: **84 avoidable attempts**, compared with 105 distinct metadata requests. Eight worker threads were configured. This is a documented efficiency deviation, not evidence of a numeric request-limit violation (none was specified in the supplied job). The exact total across the interrupted session, including Ketch/source research and any retries, cannot be recovered from the saved artifacts; 189 is the script's per-invocation accounting, not a verified session-wide count. The resumed collector now reuses saved metadata and performs only missing, deduplicated requests sequentially.

The README's initial completion claims preceded the actual device outputs in the interrupted run. The resume checks the generated artifacts rather than treating those claims as proof. Snapshot observations remain those captured on 2026-10-15 UTC / 2026-10-16 Europe/Dublin; this resume does not assert a later live refresh.

## Completion and remaining unknowns

All requested outputs are present: 42 unique device rows in both formats, 63 current channel records covering 21 factory ZIPs, both install/pitfall documents, and 42 draft notes. The resume added only three previously missing upstream captures: `sources/install-web.md`, `sources/install-cli.md`, and the revision-pinned `sources/web-install.js.txt`. All 21 boot-key hashes match both captured official install guides. These three Ketch scrape invocations are separate from the earlier collector accounting; underlying Ketch cache/network request totals are not exposed here. The first cached collector check regenerated its JSON from saved values; the original observation timestamp was retained, and the final check confirms a cached run performs no requests or rewrite.

Unknowns remain explicit: exact GrapheneOS support start/end and extended-support transition dates, some model-number lists, historical device base/kernel details, current exact Linux point releases, archive SHA-256 values, channel promotion dates, current availability of historical downloads, and untested hardware/app compatibility. OEM minimum support months are not substituted for GrapheneOS termination dates. Detached image signatures are recorded but not verified against prohibited full-image downloads. Source-only boards have no official published build to list.

Validation: `python build_inventory.py`, `python validate_snapshot.py`, and `pyright *.py` pass from this directory. The offline checks cover row/channel uniqueness, CSV counts, note structure and links, manifest/build agreement, metadata sizes, all 21 boot-key values against captured guides, and cache-only collection with network access explicitly blocked. No application build, catalog import, phone test, commit or push was needed for this research-only output.
