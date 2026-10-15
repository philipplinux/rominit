# Nura / postmarketOS device and kernel inventory

Research snapshot: 2026-10-15. Nura is the new name of postmarketOS, announced 2026-09-27; these are one project, not two catalogs.

## Coverage and interpretation

The official Devices page reports 424 active listed ports: 133 Community, 254 Testing, 37 Downstream, and zero Main. Its 1,661 documented-device count includes archived, unavailable and non-booting devices. Namespace-zero Category:Devices API enumeration currently returns 1,660 pages; the discrepancy is retained rather than inventing a missing row.

The broader inventory includes niche old devices and vendor kernels. A wiki page, an archived recipe, or a kernel package still present in a repository is not a guarantee of a maintained, bootable device port. Community also does not mean all hardware works. Use each device page's feature matrix and installation instructions.

## Kernel version fields

- **Stable** means the published v26.06 repository; **edge** means the published master repository at collection time.
- **Kernel package version** is the APK package version, including packaging revision. Some forks use their own numbering, so this is not necessarily the Linux version returned by `uname -r`.
- **Wiki kernel version** is a manually maintained device-page declaration. It can be old or disagree with the package source; it is preserved separately.
- Blank or unresolved fields are unknown, not evidence that a device has no kernel. Archived recipe/wiki versions are historical evidence, not current support.
- Where device packages have alternative kernel subpackages, alternatives must be preserved rather than picking the numerically largest version.

## Authoritative sources

- [Rebrand announcement](https://nura.eco/blog/2026/09/27/nura-rename/)
- [Active device catalog](https://wiki.nura.eco/wiki/Devices)
- [Detailed device matrices](https://wiki.nura.eco/wiki/All_devices)
- [Support category definitions](https://docs.nura.eco/pmaports/main/device-categorization.html)
- [Stable release](https://nura.eco/install/)
- [Wiki category API](https://wiki.nura.eco/api.php?action=query&list=categorymembers&cmtitle=Category%3ADevices&cmnamespace=0&cmlimit=max&format=json), following pagination
- Published APK indexes: `https://mirror.nura.eco/postmarketos/{v26.06,master}/{architecture}/APKINDEX.tar.gz`
- [Packaging recipes](https://gitlab.postmarketos.org/postmarketOS/pmaports)

No phone was flashed or modified for this research. This is an upstream documentation/package snapshot, not a hardware acceptance test.

## Files

- `active-devices-with-kernels.csv`: all 424 active source rows, enriched with published-package, current-recipe and wiki evidence in separate columns.
- `all-devices-with-kernels.csv`: all 1,660 unique namespace-zero device wiki pages, including archived/non-packaged/non-booting entries; the same evidence fields.
- `archived-recipes.csv`: all 456 archived device recipes from the current pmaports snapshot, including records without a wiki mapping; 422 devices have a statically resolved kernel recipe.
- `recipe-sources-all-devices.csv`: all 669 device recipes across active and archived source categories; 594 explicit device-to-kernel links.
- Original `nura-*.csv` files preserve the package/wiki extraction before recipe enrichment; JSON, HTML and APK index snapshots record sources. Scripts regenerate the extraction and joins; no APKBUILD is executed.

## Older and niche examples

These are source recipe package versions, with packaging revisions shown separately from the base version. They establish recipe availability, not a successful current build or boot.

| Device | Codename / recipe | Kernel package version | Evidence status |
|---|---|---|---|
| HTC HD2 | htc-leo | 3.0.4-r5 | Archived recipe |
| Nokia N9 | nokia-n9 | 4.17_rc4-r2 | Archived recipe; wiki infobox uses the different codename nokia-lankku |
| Galaxy Tab 3 10.1 Wi-Fi | samsung-santos10wifi | 3.4.34-r2 | Archived x86 recipe |
| Galaxy S9 Exynos | samsung-starlte | 4.9.299-r0 | Archived recipe; distinct from Snapdragon S9 |

Recipe snapshot: [pmaports 0e458a2417d6f5ed61c7b70621d5632e30136091](https://gitlab.postmarketos.org/postmarketOS/pmaports/-/commit/0e458a2417d6f5ed61c7b70621d5632e30136091). Per-device and per-kernel recipe links are in each CSV.

## Counting and reproducibility

The official active catalog's 424 rows are not 424 unique linked wiki pages: four duplicate rows and one unlinked entry leave 419 linked pages. The active CSV preserves the source rows and codenames; the all-pages CSV remains unique by page. Inactive wiki categories and current recipe categories can disagree, so both are retained.

`build_inventory.py --from-cache` rebuilds the package/wiki CSVs from captured metadata and indexes; `enrich_inventory.py` adds recipe evidence. `archived-recipes.py /path/to/pmaports` regenerates recipe CSVs from a checkout and records its Git commit. The live refresh does not prove every device has a currently supported kernel. Unknown versions remain unresolved.

## Final coverage

Checked source counts and join assertions pass. All three collection/join scripts pass Pyright with zero diagnostics.

| Inventory | Rows | Kernel evidence |
|---|---:|---:|
| Active official source rows | 424 | 413 with published, recipe or wiki evidence |
| Active published edge kernels | 424 | 382 |
| Active published stable kernels | 424 | 355 |
| All documented wiki pages | 1,660 | 1,058 with published, recipe or wiki evidence |
| Archived device recipes | 456 | 422 with explicit kernel recipe mapping |

`active-unresolved.csv` isolates the remaining 11 active source rows. These are unknowns, not version zero or proof of no Linux support. PineNote's device package, for example, depends on linux-pine64-pinenote, but that kernel is missing from the checked pmOS indexes. Neither a wiki version nor a source recipe is proof of a latest working kernel. Hardware operation and every possible external fork were not tested.
