# /e/OS official support matrix

Per-device table of which devices /e/OS builds, on which channel and Android-base branch, and how the docs install them. Purpose: predict install path and success for downstream XDA ROMs (with the LineageOS matrix in `../lineageos/`, not duplicated here).

## Sources
| Source | Version | Fetched |
|---|---|---|
| `gitlab.e.foundation/e/documentation/user` (project 464), `data/devices/*.yaml` (288 files) | commit `3ab67cdb304784e59a6727ca5e74df221b12c8db` (main, 2026-10-08) | 2026-10-16 |
| docs repo git history (treeless bare clone in `raw/docs.git`): YAMLs deleted from `data/devices`, `_data/devices`, `htdocs/_data/devices` (160 dropped devices, last version before deletion) | same repo | 2026-10-16 |
| `https://images.ecloud.global/api/v2/devices` and `/api/v2/devices/<codename>/downloads` (298 devices; the API is what the builds page uses) | live, no version | 2026-10-16 |

Not used: `https://doc.e.foundation/devices` (rendered from the same YAML; the YAML is complete, the page is not). Nothing failed. The old `htdocs/_data/devices` path does not exist; the repo moved to Hugo (`data/devices`).

License: the docs repo is GPL-3.0; only facts (codenames, versions, flags, dates) are extracted, no doc text. Scripts and derived tables are MIT like the repo. Build file names, hashes and sizes are not stored.

## Rerun
`python3 -I collect.py [--refresh]`. Stdlib only. Caches responses in `raw/` (gitignored); `--refresh` refetches (about 90 s, one request per device). Rewrites `devices.csv`, `devices.json`, `branches.csv`, `catalog_map.csv`, `meta.json`.

## Files
- `devices.json` / `devices.csv`: one row per codename ever listed (458 = 288 current YAML + 10 API-only + 160 dropped from the docs; dropped rows have docs fields only, no builds). In the CSV, lists are joined by `;` and `branches` are `channel/android` pairs.
- `branches.csv`: per (channel, Android branch): Android version, newest /e/OS version, device count, devices with a build in the last 183 days (`active_6mo`).
- `catalog_map.csv`: ROMinit catalog devices mapped to this matrix.
- `meta.json`: fetch date, cutoff, commit.

## Fields (devices.csv)
- **Identity:** `codename`, `vendor`, `name`, `type` (phone/tablet/foldable/emulator), `models`. Vendor/name/type are empty for the 10 `in_docs=False` rows.
- **Channels/branches (API):** `branches` = latest build per channel x Android branch (`official`, `community`, plus historic `stable`/`partner`/`test`; Android `a16`/`a15`/`a14`/`u`=14 old naming/`t`=13/`s`=12/`r`=11/`q`=10); `eos_versions` = `channel/branch=version@date`; `channels`; `latest_build_date`; `active_6mo`; `active_branches` (in JSON). Each branch entry in JSON also has `os_patch_level`, `file_types`, `builds_in_api`.
- **Docs flags:** `release_type_doc` (`compatibility.release_type`), `bootloader_lockable`, `build_variant` (user/userdebug), `play_integrity`, `maturity` (green/orange/red), `can_rollback`, `doc_build_version_stable/dev` (branch the docs name, e.g. A15/A16), `doc_lineage_branch` (the LineageOS base version the docs record, e.g. 22), `doc_versions`, `is_lineageos_official`.
- **Install:** `is_ab` (`is_ab_device`), `install_method` (vendor flow for the bootloader/recovery step: `fastboot_nexus|xiaomi|motorola|sony|lg|...`, `odin`, `heimdall`, `dd`; empty = the docs name none, typical for official Fairphone/Pixel IMG installs), `recovery_install_method`, `install_e_script` (`install_e_with_erecovery` = flash /e/ recovery then sideload the OTA zip; `erecovery_install` similar; `install_e_official_lock_bootloader` = official fastboot IMG flow, relock supported), `eos_installer_web` (the browser /e/OS Installer is listed), `install_doc_modes`, `recovery_partition`, API `file_types` (`OTA`+`recovery`/`recovery-IMG` = recovery sideload; `IMG` = fastboot image zip).
- **Prerequisites:** `prereq_before_install` (e.g. `before_install_needs_specific_android_fw`), `prereq_stock_android_min` (the `version` argument: stock Android to be on, e.g. `12` or `13/14`), `prereq_firmware_update`.
- **Maintained/legacy:** the project has no flag; derived: `maintained` = `active_6mo` (a build within 183 days of fetch, cutoff in `meta.json`), `legacy` = not maintained, `status` = `maintained` | `stale` (still in docs/API, no recent build) | `dropped` (YAML removed from the docs; `dropped_from_docs`, `dropped_date`). `stable`/`partner` channels are historic (all stale). Dropped rows can carry variant spellings (e.g. `a3xelte` and `a3xeltexx`) and unexpanded template values (`{current_branch}`).

## Findings (2026-10-16)
- Scope: 458 codenames ever listed: 289 maintained, 9 stale, 160 dropped (149 removed 2025-07, mostly Samsung 53, Motorola 21, LG 18, Xiaomi 16, Sony 8). Numbers below cover the 298 with builds unless stated.
- 298 codenames; 289 with a build in the last 6 months, 9 stale (`B2N`, `deadpool`, `DRG`, `monet`, `PL2`, `sdk_phone_x86`, `taimen`, `wade`, `walleye`).
- Channels: community 272 devices only; 25 have an `official` build (4 Fairphone FP3-FP6, Murena/Gigaset/Teracube-type phones `GS290 GS6_Venus emerald sapphire zirconia mimir one two tetris avicii`, Pixels `panther shiba redfin tangorpro otter`, Samsung `starlte star2lte herolte hero2lte dreamlte dream2lte`). 1 emulator `test`.
- Newest Android branch per active community device: a16 158, a15 85, t(13) 32, a14 8. Branch device counts (community): a16 158, a15 222, a14 172, t 179, s 11. Latest versions: 4.3.1 (a16), 4.3 (a15/a14/t), official s still builds 4.3 for the Samsung S7/S8/S9/Note8 family.
- Vendors (docs rows): Xiaomi 61, Motorola 41, Samsung 37, OnePlus 34, Google 28, LG 22, Sony 19, Nubia 8, Fairphone 4, Razer 3, Teracube 3, unknown 10.
- Install: 182 A/B devices; `install_method`: fastboot_nexus 73, fastboot_xiaomi 45, fastboot_motorola 37, odin 15, heimdall 14, fastboot_sony 14, fastboot_lg 9, dd 6, none given 66. 234 devices use the `install_e_with_erecovery` flow; only 15 are bootloader-lockable (`compatibility.bootloader`), 272 are not (community keys, userdebug, no relock). The browser installer lists 26 devices.
- Practical read: /e/ does not publish one predictable path. Community builds are LineageOS device trees with /e/ patches, so a device `is_lineageos_official` (235 True, 21 False) almost always has an /e/ community build too. The 21 non-LineageOS ones (`avicii dream2lte dreamlte emerald FP3-FP6 GS290 GS6_Venus mimir nabu one r8s sapphire tetris two x1s y2s z3s zirconia`) are mostly official-channel or Samsung/Nubia/Fairphone.

## Catalog mapping
`catalog_map.csv`: 25 catalog devices, 20 listed (all `maintained`), 5 not listed (`blazer frankel mustang rango stallion`, the Pixel 10/Pro-era codenames). Matched by `codename`, else by a `product` value in the catalog JSON (`fairphone-fp4` -> `FP4`). Examples: `starlte`/`star2lte` have `official/a15` (4.3) plus community t/s and historic stable r/q; `hero2lte` only official/community s (Android 12, no A15); `panther` has official a15; `akita` and most Pixels community a16/a15/a14.

## Surprises
- Devices built recently by /e/ and not built now by LineageOS (34): e.g. `starlte star2lte herolte hero2lte dreamlte dream2lte` (official), `nabu`, `tissot`, `avicii`, `bardock`, `crownlte`, `liber`, `nx609j`; 13 are not in the LineageOS wiki at all (`GS290 GS6_Venus dream2lte dreamlte emerald mimir nabu one sapphire tetris two zirconia` and the emulator).
- Android branch letters in the API are inconsistent: `u` is 14 (old), `a14` is 14 (new naming); both appear.
- `official` and `community` exist per Android branch for the same device, so one device can be official on a15 and only community on t.
