# LineageOS official support matrix

Machine-readable table of which devices LineageOS (officially) supports or supported, on which branch, and how LineageOS installs them. Purpose: predict install path and success for downstream (XDA) ROMs, which are mostly LineageOS-based.

## Sources
| Source | Commit | Fetched |
|---|---|---|
| `LineageOS/lineage_wiki` (`_data/devices/*.yml`, `_includes/templates/`) | `55880f7966ae7e7108c1a3dadfeb4c051426b139` | 2026-10-16 |
| `LineageOS/hudson` (`lineage-build-targets`, `updater/devices.json`) | `29cc89d93384b453bb74fa58b03a2ecce7948f57` | 2026-10-16 |

SHAs and date are also in `meta.json` / `devices.json`. Wiki content is CC BY-SA 4.0 (LineageOS Project, https://wiki.lineageos.org); only facts are extracted and the flow descriptions are paraphrases. Attribute LineageOS when reusing. The scripts and derived tables here are MIT like the repo.

## Rerun
`python3 -I collect.py` (stdlib + `git`). Shallow-clones both repos into `raw/` (gitignored), rewrites all outputs. Raw clones stay local.

## Files
- `devices.csv` / `devices.json`: one row per wiki device page (764 pages, 631 unique codenames: several pages share one codename, e.g. `miatoll` has 6 variant pages; built-now applies to all pages with that codename).
- `branches.csv`: LineageOS version, Android version, unique codenames ever supported, unique codenames built now (24.0 to Android 17 is inferred from the wiki's Pixel entries shipping Android 17 firmware for 24.0).
- `install-methods.md`: each `install_method`, device count, flow, template path.
- `meta.json`: fetch date, SHAs, target counts.

## Fields (devices.csv)
`wiki_id` (yml file stem), `codename` (what hudson/builds use), `vendor`, `name`, `models` (`;`), `versions` (all LineageOS versions ever listed, `;`), `current_branch` (wiki), `built_now`/`built_branch`/`build_period` (hudson `lineage-build-targets`; N/W/M), `in_updater_devices_json`, `maintained` (wiki maintainers non-empty; empty = unmaintained/archived), `maintainers`, `install_method`, `is_ab_device`, `recovery_partition_name` (what gets flashed, e.g. `boot`, `vendor_boot`, `recovery`), `recovery_partition` (raw block path for dd methods), `uses_twrp`, `needs_fastboot_boot`, `is_unlockable`, `recovery_boot`/`download_boot` (key combos), `prerequisites` (wiki before_install, before_recovery_install, before_lineage_install, firmware_update, required_bootloader, format_on_upgrade, short), `soc`, `release`, `kernel_version`, `variant`, `carrier`.
Prerequisite hints: `needs_specific_android_fw` (version=N: flash stock Android N firmware first), `boot_stack` (partitions to flash alongside recovery), `ab_copy_partitions`.

## Findings (as of fetch)
- 764 pages / 631 codenames; 341 built now (hudson), all present in the wiki, none missing; 440 pages have maintainers; only 1 built-now device lacks maintainers. 324 pages have empty maintainers (mostly legacy).
- Built now by branch (codenames): 24.0 = 176, 22.2 = 115, 23.2 = 50. All other branches have 0 built. `built_branch` always equals wiki `current_branch`.
- Ever supported (codenames): 24.0 177, 23.2 210, 23.0 156, 22.2 272, 22.1 197, 21 217, 20 202, 19.1 131, 18.1 187, 17.1 163, 16.0 121, 15.1 97, 14.1 210, 13.0 29.
- Wiki `current_branch` spread (pages): 24.0 225, 22.2 141, 14.1 114, 23.2 92, 18.1 78, rest <=25 each.
- Vendors (pages): Xiaomi 142, Samsung 118, Motorola 96, LG 62, Google 58, OnePlus 55, Sony 44, ASUS 17, NVIDIA 17, Nubia 14, Lenovo 13, BQ 11. Built now: Xiaomi 103, Motorola 60, OnePlus 49, Samsung 41, Google 40, LG 30, Sony 21, NVIDIA 13.
- A/B devices: 301 pages.
- Install methods (pages / built now): see `install-methods.md`. Top: fastboot_nexus 177/111, samloader_rs 116/41, fastboot_xiaomi 115/78, fastboot_motorola 98/62, fastboot_sony 44/21, dd 39/12.
- There is no `heimdall` method any more: Samsung uses `samloader_rs` (Download mode), and the dd/oor methods need root first.
- Branches 13.0 to 21 are fully legacy: no device is built on them, but 114 pages still point there as `current_branch` (14.1) and are unmaintained history.

## ROMinit catalog mapping
Catalog codenames matched on wiki `codename` (FP4 via fastboot product `FP4`).
| Catalog codename | LineageOS versions | install_method | built now |
|---|---|---|---|
| fairphone-fp4 (wiki `FP4`) | 20;21;22.1;22.2;23.0;23.2;24.0 | fastboot_fairphone | yes, 24.0 |
| laurel_sprout (Mi A3) | 22.2;23.0;23.2;24.0 | fastboot_nexus | yes, 24.0 |
| hero2lte | 14.1 | samloader_rs | no (unmaintained) |
| starlte, star2lte | 15.1;17.1;20 | samloader_rs | no |
| akita, bluejay, cheetah, felix, husky, lynx, oriole, panther, raven, shiba, | 20/21/22.1 to 24.0 (see devices.csv) | fastboot_nexus | yes, 24.0 |
| blazer, frankel, mustang, rango, stallion | 24.0 only | fastboot_nexus | yes, 24.0 |
| caiman, comet, komodo, tokay | 22.1 to 24.0 | fastboot_nexus | yes, 24.0 |
| tegu | 23.0;23.2;24.0 | fastboot_nexus | yes, 24.0 |
Every catalog Pixel is an A/B device with `needs_specific_android_fw` before install. Full per-device values: query `devices.csv`.
