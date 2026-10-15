---
name: rom-scraper
description: Find ("fish") custom ROMs for phones and turn them into ROMinit catalog entries. Use when asked to scrape, research or add ROMs/devices to the ROMinit catalog, or to check a ROM source for newer builds.
---

# ROM scraper

You collect facts about phones and ROMs and write them as catalog JSON in `catalog/`. You never flash, never host files, and never mark your own finds as `curated`.

## 1. Pick targets

1. Phones people searched for and we lack, most people first:
   `npx wrangler d1 execute rominit --remote --command "SELECT q, COUNT(DISTINCT voter) n FROM searches WHERE hits = 0 GROUP BY q ORDER BY n DESC LIMIT 30"`
2. Otherwise the task's list. Skip any device or ROM already in `catalog/` (grep codename and ROM id first); for an existing ROM, only check for a newer build.

## 2. Where to look (best first)

| Source | Good for |
|---|---|
| OS project's own device page (LineageOS wiki, GrapheneOS, postmarketOS / Nura wiki, /e/OS, Ubuntu Touch devices) | official builds, install method, feature table |
| GitHub / GitLab releases of the builder | unofficial builds, checksums, dates, source repo |
| XDA thread of the build | what works / broken, bootloader prerequisites |
| SourceForge / AndroidFileHost mirrors | files only; trust the hash, not the page |
| Vendor support pages | stock firmware: link only, never hosted |

Record the URL of every claim. No URL, no claim: leave it `untested` or out.

## 3. What to collect

**Device** (`catalog/devices/<vendor>/<codename>.json`, only if missing): codename, vendor, name, series, family, variant (All › vendor › series › family › variant), models (every SM-/M- number it covers), `unsupported` variants with `why` (e.g. Snapdragon US models, locked bootloader), `detect` (adb device / fastboot product), button combos for each mode used, unlock steps and known pivots.

**ROM** (`catalog/roms/<codename>/<source>.json`), every field `problems()` in `src/catalog.js` requires:

- `id`, `os`, `name` (builder in brackets for unofficial: "LineageOS (ivanmeler build)"), `version` with build date
- `origin`, `status`, `vetting`, `rating` (see section 4)
- `homepage` (builder's page), `source` (kernel/device tree repo, if published), `maintainer {name, source}` (the builder's profile; leave `avatar` out unless we store one). The name is display text only: never match it to a ROMinit account with the same username; ownership comes only from a role an admin grants after checking. Everything scraped shows a PLACEHOLDER marker on the site
- `slots` (ab / single), `requirements` (bootloader / firmware version, wipes, which slot)
- `notes`: one short paragraph: who built it, patch level, prerequisites, gapps advice
- `stages`: files pinned by `name`, `size`, `sha256`, https `source` page and optional direct `url`; steps from the recipe's verbs

## 4. Classification

| Field | Rule |
|---|---|
| `vetting` | always `scraped`. `curated` is set by a person only (endorsed builds: GrapheneOS, mainline postmarketOS / Nura, our own) |
| `origin` | `official`: on the OS project's own site/infra. `unofficial`: anyone else. `stock`: vendor firmware |
| `status` | `stable` official release channel · `beta` builder says mostly works · `nightly` automatic build · `experimental` early port · `legacy` superseded, no updates · `broken` reported not booting |
| `rating.support` | last build ≤ 6 months: `active` · ≤ 18 months: `maintenance` · older: `abandoned` |
| `rating.kernel.type` | `mainline` if upstream Linux (pmOS mainline, Nura), else `downstream`; version from the kernel repo or uname in screenshots |
| `rating.features.*` | `works` / `partial` / `broken` only when a source says so; hardware the phone lacks: `n/a`; otherwise `untested` |
| `rating.includes.*` | `yes` / `no` / `optional` (installable add-on, e.g. gapps on LineageOS) |
| `rating.checked` | today's date |

When in doubt pick the more cautious value (lower status, `untested`).

## 5. Pin files

- Get `size` and `sha256` by downloading into your scratch dir, `sha256sum`, then delete. A published checksum is fine if it matches your download.
- `source` = the page a person would open; `url` = direct file link, only if stable (no expiring tokens).
- Never copy files into the repo; ROMinit links, it does not host (stock firmware especially).
- Recipe by install method: TWRP flashable zip → `twrp-sideload`; Samsung .tar/.img via Download Mode → `odin`; fastboot images → `fastboot`; vendor fastboot .tgz → `fastboot-tgz`; raw images via TWRP shell → `twrp-dd`. Copy the shape of an existing ROM using the same recipe.

## 6. Hand off

1. `npm test && npm run build` (the build fails on any catalog problem); fix until green.
2. One commit per device: `catalog: <codename> <os> <version> (scraped)`.
3. Report: a table of what was added (device, ROM, status, support), plus open questions (missing source repo, unclear prerequisites, conflicting reports). Deploying is the owner's call; scraped entries go live labelled "scraped · unverified".
