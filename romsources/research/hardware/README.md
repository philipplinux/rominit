# Core hardware data for ROMvault phones

Facts only (SoC, RAM, storage, display size, battery, Android versions, model numbers). No prose or images copied
from GSMArena; raw HTML stays local in `raw/` (git-ignored by `raw/.gitignore`). Checked 2026-10-16.

## Files

- `collect.py` stdlib-only collector. Reads a target list, fetches GSMArena (cached, 9 s between requests), writes `devices.json` and `devices.csv`.
- `targets.csv` the ROMvault set (54 devices): `codename,vendor,name,models,gsmarena_url,variant`.
- `manual.json` per-codename overrides for phones GSMArena lacks (PinePhone, PinePhone Pro, Librem 5, SHIFT6mq, Core Prime VE LTE).
- `devices.json` / `devices.csv` the result, one row per codename. `raw/` the page cache.
- `targets-all.csv` is not produced by this folder's scripts (put there by the coordinator for the all-model run).

## Sources and precedence

1. Vendor official spec page (wins over GSMArena; none fetched in this run).
2. GSMArena phone page (base table, `data-spec` fields). URL reused from the ROMvault page when cited, else looked up in the brand listing pages (quick-search is behind a Turnstile check).
3. Nura (postmarketOS) wiki cross-check: the wiki sits behind Anubis and cannot be fetched by script, so `nura_soc` is read from what the ROMvault device page recorded from Nura. A disagreement is written to `conflicts`.
4. Manual entries (`manual.json`): values from Nura via ROMvault, plus vendor specs marked unverified in `soc_source`.

`soc` is a lowercase platform id (`sm7150`, `sdm845`, `msm8996`, `exynos9810`, `tensor-g3`, `allwinner-a64`, `rk3399s`, `imx8mq`, `omap3430`). Alias table `SOC_ALIAS` in `collect.py` folds GSMArena marketing ids that Nura/Qualcomm name differently: `sdm730`/`sdm732` become `sm7150`. Multi-chipset pages (Galaxy S9, S9+, S7 edge) use the `variant` regex in `targets.csv` to pick the line (`Exynos` or `Snapdragon`).

## Fields

codename, name, gsmarena_url, match (`url-cited` | `model-exact` | `name-exact` | `name-fuzzy` | `manual` | `none`), match_note, announced, released, status, launch_os (GSMArena OS text), launch_android / stock_max_android (numbers, empty for non-Android), stock_skin, soc, chipset (full text), cpu, gpu, ram, storage (incl. memory type), card_slot, display {size_in, resolution, type}, battery_mah, nfc (yes/no), usb, models (GSMArena list), soc_source, nura_soc, conflicts, checked.

Match confidence: `url-cited` = URL taken from the ROMvault page; `model-exact` = a model number from `targets.csv` `models` is in GSMArena's models list; `name-exact` = listing name equals target name (an alias suffix like "(Mi 5X)" is ignored); `name-fuzzy` = substring only, review it. Names collide, so prefer filling `models` or `gsmarena_url` in the target file.

## Rerun / resume

```
python3 collect.py                      # ROMvault set; cached pages are never refetched
python3 collect.py --targets other.csv  # any list with the same columns
python3 collect.py --offline            # parse the cache only
```

On HTTP 429/403 or a Turnstile page the run stops fetching and finishes from `raw/`, so `devices.*` always cover every target (unfetched rows say `page not cached`); rerun later and it continues where it stopped. Brand listing pages (about 1 request per 50 phones) are cached too, so a large run costs listing pages plus one request per phone. Delay is 20 s between requests.

State 2026-10-17 (`targets-all.csv`, 811 targets): 374 rows with SoC; 204 rows have a GSMArena URL but no cached page; 174 `none` (62 need uncached brand listings, ~40 need model numbers); GSMArena blocked this IP (429, then 403) for over a day. To pick up: `python3 -I collect.py --targets targets-all.csv` from another IP or after a long pause; `raw/` (25 MB, git-ignored) is the only copy of the fetched pages, backed up in `~/Backups/rominit-gsmarena-raw-2026-10-17.tar.gz`.

## Gaps and caveats

- Not on GSMArena or not found: PinePhone, PinePhone Pro, Librem 5, SHIFT6mq, Galaxy Core Prime VE LTE (manual rows; vendor-spec fields unverified).
- `launch_android` is the major.minor GSMArena lists (`6.0.1` becomes `6`; see `launch_os` for the full text). GSMArena's "upgradable to" can lag real update history (e.g. Redmi 4 Prime shows no upgrade).
- Variant devices (S9/S9+/S7 edge) share one GSMArena page; RAM and storage lists are for all variants of that page.
- GSMArena values are community-edited; check the vendor page before relying on a single row.
