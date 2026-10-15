# ROMinit

Find your phone, pick a ROM, flash it from the browser over USB. Nothing is uploaded; everything runs locally via WebUSB (desktop Chrome or Edge).

Status: experimental. 3 devices (Xiaomi Mi A3, Samsung Galaxy S9 / S9+) with postmarketOS server images. No browser flash has been tested on real hardware yet.

## How it works

- **Catalog** (`catalog/`): JSON in git, contributed through pull requests. One file per device, one file per ROM source.
- **Recipes** (`src/recipes/`): engines that run a stage's step list. `fastboot`, `odin` (Samsung Download Mode), `twrp-dd` (writes from TWRP over ADB, reads every write back with SHA-256).
- **Protocols** (`src/protocols/usb.js`): WebUSB connections for fastboot, Odin and ADB.
- **Site** (`site/`): static page, generated from the catalog. `npm run build` writes `dist/`.

Files: ROMinit never hosts, mirrors or downloads ROMs. Each file links to its publisher (self-hosted or login-protected hosts work too); you download it, then pick it, and ROMinit checks and flashes it.

Safety: every file is pinned by size and SHA-256, every step verb is whitelisted per recipe, device identity is checked before the first write, and any mismatch stops the run (fail closed). Catalog data is shown as text only.

## Add a device

1. `catalog/devices/<vendor>/<codename>.json`: name, models, `detect`, `modes` (how to reach fastboot / download / recovery), `unlock`, `recovery`.
2. `catalog/roms/<codename>/<source>.json`: ROMs with stages; each stage names a recipe, a mode, pinned files (`name`, `size`, `sha256`, https `source` page, optional direct `url`) and `steps` like `["flash", "boot_b", "boot.img"]`. Every ROM also needs a `rating`: a `checked` date and each feature (display, touch, wifi, bluetooth, usb_net, gpu, audio, camera, mobile, gps) as works / partial / broken / untested.
3. `npm ci && npm test && npm run build`. The validator lists every problem.

Copy an existing device as a template.

## Develop

```
npm ci
npm run check   # types
npm test        # recipes, catalog validator, downloads
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
