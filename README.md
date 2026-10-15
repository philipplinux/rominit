# ROMinit

Find your phone, pick a ROM, flash it from the browser over USB. Nothing is uploaded; everything runs locally via WebUSB (desktop Chrome or Edge).

Status: experimental. 3 devices (Xiaomi Mi A3, Samsung Galaxy S9 / S9+) with postmarketOS server images. No browser flash has been tested on real hardware yet.

## How it works

- **Catalog** (`catalog/`): JSON in git, contributed through pull requests. One file per device, one file per ROM source.
- **Recipes** (`src/recipes/`): engines that run a stage's step list. `fastboot`, `odin` (Samsung Download Mode), `twrp-dd` (writes from TWRP over ADB, reads every write back with SHA-256), `fastboot-tgz` (a vendor stock package: checks the archive SHA-256 and the anti-rollback level, unpacks the named images into browser storage (OPFS), then runs fastboot steps; used for `origin: "stock"` restores, never locks).
- **Protocols** (`src/protocols/usb.js`): WebUSB connections for fastboot, Odin and ADB.
- **Site** (`site/`): static page, generated from the catalog. `npm run build` writes `dist/`.

Files: ROMinit never hosts, mirrors or downloads ROMs. Each file links to its publisher (self-hosted or login-protected hosts work too); you download it, then pick it, and ROMinit checks and flashes it.

Safety: every file is pinned by size and SHA-256, every step verb is whitelisted per recipe, device identity is checked before the first write, and any mismatch stops the run (fail closed). Catalog data is shown as text only.

## Add a device

1. `catalog/devices/<vendor>/<codename>.json`: name, models, `detect`, `modes` (how to reach fastboot / download / recovery), `unlock` (`text`, vendor `hints`, numbered `steps`, optional `pivots` [{problem, fix, url}] for soft-locks), `recovery`.
2. `catalog/roms/<codename>/<source>.json`: ROMs with stages; each stage names a recipe, a mode, pinned files (`name`, `size`, `sha256`, https `source` page, optional direct `url`) and `steps` like `["flash", "boot_b", "boot.img"]`. Every ROM has an `origin` (official / unofficial / stock) and a `status` (stable / beta / nightly / experimental / legacy / broken; `broken` stays listed but cannot be flashed), see `ORIGINS` and `STATUSES` in `src/catalog.js`, plus `vetting` (`curated`: endorsed by its community or ROMinit, set by a person only; `scraped`: found by a scraper, subject to verification; see `VETTING`). Every ROM also needs a `rating`: a `checked` date and each feature of the postmarketOS wiki feature table (`FEATURE_GROUPS` in `src/catalog.js`: basics, multimedia, connectivity, modem, misc, sensors) as works / partial / broken / untested / n/a (n/a = no such hardware, left out of completeness). Plus `includes`: google_play, microg, android_apps, phone_ui, root, updates, encryption, relock, banking_apps, ssh, docker as yes / no / optional. Plus `kernel` (`version`, `type`: mainline / downstream), `base` (e.g. "postmarketOS edge"), `released` date and `support` (active / maintenance / abandoned). The site shows completeness twice, "as computer" and "as phone" (`USES` in `src/catalog.js`): the share of those features that work, partial counting half, with the untested count. Plus `slots` (`ab` or `single`) and `requirements`: a list spelling out everything the install assumes (bootloader version, wipes, which slot it writes).
3. `npm ci && npm test && npm run build`. The validator lists every problem.

Copy an existing device as a template.

## Develop

```
npm ci
npm run check   # types
npm test        # recipes, catalog validator, downloads
npm run bench   # website end to end: real Chromium against wrangler pages dev + fresh local D1 (build first; CHROMIUM, BENCH_PORT)
npm run build   # dist/
```

## Roadmap

1. postmarketOS importer (+ `.img.xz` decompression in the browser)
2. LineageOS importer + ADB sideload recipe
3. Search, USB auto-detect, device pages
4. Nightly import CI and link checks
5. More protocols: MediaTek BROM, Qualcomm EDL, Rockchip, Allwinner FEL, Unisoc

## Support

Free and MIT licensed. If it saved your phone: [buy me a coffee](https://www.buymeacoffee.com/philipplinux).

## Hosting

Cloudflare Pages serves `dist/` (static, no bandwidth cost). The only server code is `functions/api/ratings.js`: user star ratings in D1, one vote per address per ROM, stored as a salted hash. Firmware never passes through it.

```sh
npx wrangler login
npx wrangler d1 create rominit          # put the id into wrangler.toml
npx wrangler d1 execute rominit --remote --file schema.sql
npm run build && npx wrangler pages deploy
npx wrangler pages secret put SALT      # any long random string
```

Reports from "Something wrong on this page?": `npx wrangler d1 execute rominit --remote --command "SELECT id, page, text, at FROM reports ORDER BY id DESC LIMIT 50"`.
Comment screenshots stay hidden until approved. Pending: `npx wrangler d1 execute rominit --remote --command "SELECT comment_id FROM comment_images WHERE approved = 0"`. Approve: `... --command "UPDATE comment_images SET approved = 1 WHERE comment_id = <id>"`. Delete a comment: `... --command "DELETE FROM comment_images WHERE comment_id = <id>; DELETE FROM comments WHERE id = <id>"`.

Local: `echo SALT=dev > .dev.vars`, `npx wrangler d1 execute rominit --local --file schema.sql`, `npx wrangler pages dev dist`.
