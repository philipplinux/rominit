# crDroid official support matrix

Per-device table of which devices crDroid officially builds, per Android-base branch, with maintainer, recovery/firmware links and install-step tags. Purpose: predict install path and success for downstream XDA ROMs (with the LineageOS matrix in `../lineageos/`, not duplicated here).

## Sources
| Source | Version | Fetched |
|---|---|---|
| `github.com/crdroidandroid/android_vendor_crDroidOTA` (`<codename>.json` per Android branch, 13 branches) | branch SHAs in `meta.json`; e.g. `16.0` `dfd0006003…`, `17.0` `2d8e17287b…` | 2026-10-16 |
| same repo, full history of every branch (git log walk; deleted device files recovered from the parent commit; 7.1-9.0 use `devices.xml`/`update.xml`, every revision parsed) | all 13 branches `7.1`..`17.0`; no `6.0` or older branch exists | 2026-10-16 |
| `https://crdroid.net/downloads` (device cards: OEM, name, offered versions, last build) | live | 2026-10-16 |
| `https://crdroid.net/<codename>/<major>/install` (newest version only; reduced to step tags) | live | 2026-10-16 |

Nothing failed. The downloads page has no API; it is parsed as HTML. EoL versions have no install page (the site falls back to the home page), so `install_page_found=False` for those.

License: the OTA repo has no license file; only facts are extracted (codenames, versions, dates, URLs of public links), no guide text and no hashes beyond what `devices.json` keeps per build. Scripts and derived tables are MIT like the repo.

## Rerun
`python3 -I collect.py [--refresh]`. Stdlib + `git`. Bare-clones the OTA repo (full history, 35 MB) into `raw/ota.git` (gitignored), caches HTML in `raw/`. About 1 min. Rewrites `devices.csv`, `devices.json`, `branches.csv`, `catalog_map.csv`, `meta.json`.

## Files
- `devices.json` / `devices.csv`: one row per codename ever in any branch (405; `X2` and `x2` are distinct). The website lists 304 of them; 101 exist only in repo history/old branches; 12 are no longer in any branch tip.
- `branches.csv`: branch (= Android base), crDroid versions seen, device count, devices with a build in the last 183 days, branch SHA.
- `catalog_map.csv`: ROMinit catalog devices mapped to this matrix.

## Fields (devices.csv)
- **Branch -> Android:** branch name is the Android version (`16.0` = Android 16 = crDroid 12.x; `17.0` = Android 17 = crDroid 13.0; `15.0` = crDroid 11.x; `14.0` = 10.x; `13.0` = 9.x; `12.0`/`12.1` = 8.x; `11.0` = 7.x; `10.0` = 6.x). Each file holds only the *latest* build of a device on that branch; `branch_builds` gives the latest build date per branch for every branch the device ever had (`(removed)` = the device file was later deleted from that branch; `removed_branches`). 7.1-9.0 come from XML (no sha256/size/recovery fields; dates and versions from file names, so treat as approximate). `maintained` = `active_6mo`, `legacy` = not.
- `branches` (newest first), `crdroid_versions`, `site_versions` (website `crDroid N|Android M`), `latest_build_date`, `active_6mo` (build within 183 days), `latest_branch`, `latest_version`, `buildtype` (as published: Monthly/Weekly/Beta/EoL/Final...; spelling is not normalised), `maintainer` (newest build; empty for 207 rows, 38 of the active ones), `branch_builds` (`branch=version@date`).
- **Recovery/firmware:** `recovery_link` + `recovery_urls` (recovery image the maintainer links), `firmware_link` + `firmware_urls`, `bootloader_link`. Links only: crDroid does not state "required" vs "recommended" in the JSON; a recovery link means the guide expects a flashed recovery.
- **Install tags** (`install_tags`, from the newest version's install page; keywords found, not parsed steps): `fastboot_flash_boot|vendor_boot|dtbo|init_boot|recovery|other`, `fastboot_boot`, `odin`, `heimdall`, `download_mode`, `twrp`, `adb_sideload`, `format_data`, `latest_stock_required`.
- `device_tree`, `forum` (XDA thread), `install_page_version`.

## Findings (2026-10-16)
- 405 codenames ever; 127 maintained (build within 183 days), 278 legacy. Of the legacy ones 61 end on `EoL`/`Final` builds.
- Devices per branch (ever, incl. removed): 17.0 41, 16.0 123, 15.0 121, 14.0 128, 13.0 103, 12.1 86, 12.0 48, 11.0 130, 10.0 94, 9.0 123, 8.1 89, 8.0 78, 7.1 86. Active per branch: 17.0 41, 16.0 115, 15.0 15, all older 0.
- Vendors (ever): Samsung 67, Xiaomi 56, Redmi 47, Google 41, Motorola 40, OnePlus 39, Realme 23, LG 16. Active: Google 27, Samsung 25, OnePlus 25, Xiaomi 14, Poco 12, Redmi 12.
- Install tags are from the install page of the newest version; EoL versions have none (empty tags). Among active devices with a page, 85 use fastboot images + sideload, 18 Odin/Heimdall (Samsung), rest sideload only. Recovery link present for most active devices (see `recovery_link`).
- Android 17 (branch 17.0, crDroid 13.0) is live for 41 devices, 21 of them OnePlus plus 6 Google (`stallion tegu tokay caiman comet komodo`).

## Catalog mapping
`catalog_map.csv`: 25 catalog devices, 23 listed (includes `bluejay`, last build 14.0 on 2024-05-19, legacy); not listed: `fairphone-fp4`, `felix`. Active: all Pixel 9/10 (`caiman comet komodo tegu tokay stallion`) on 16.0/17.0, `akita husky lynx panther shiba` on 16.0; `hero2lte` last built 2022-01 (11.0), `starlte`/`star2lte` last 2024-07 (branches 13.0, 11.0, 10.0, 9.0, 8.1; Odin + TWRP flow), `laurel_sprout` last 2025-01 (15.0).

## Surprises
- 127 codenames ever built by crDroid are not in LineageOS' wiki at all; 32 of the active ones (mostly Samsung A/M, Realme, Xiaomi/Redmi/Poco, 2 OnePlus), and 34 active devices are not LineageOS-built now (adds `lavender`, `onyx`).
- Branch 12.0 is nearly empty (1 device); 12.1 holds the Android 12L builds.
- The `17.0` branch's README still mentions the old JSON layout; only `version`/`timestamp` define the crDroid version.
