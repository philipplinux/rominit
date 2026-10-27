# ROMinit

Find your phone, pick a ROM, flash it from the browser over USB. Nothing is uploaded; everything runs locally via WebUSB (desktop Chrome or Edge).

Status: experimental. 3 devices (Xiaomi Mi A3, Samsung Galaxy S9 / S9+) with postmarketOS server images. No browser flash has been tested on real hardware yet.

## How it works

- **Catalog** (`catalog/`): JSON in git, contributed through pull requests. One file per device, one file per ROM source.
- **Recipes** (`src/recipes/`): engines that run a stage's step list. `fastboot`, `odin` (Samsung Download Mode), `twrp-dd` (writes from TWRP over ADB, reads every write back with SHA-256), `fastboot-tgz` (a vendor stock package: checks the archive SHA-256 and the anti-rollback level, unpacks the named images into browser storage (OPFS), then runs fastboot steps; used for `origin: "stock"` restores; locks only when the user ticks an opt-in `lock` option), `amlogic` (USB burn mode for Amlogic TV boxes via libamlburn: one `["burn", file, keep|keep_keys|all]` step; ready, no catalog entries yet).
- **Bootloader lock/unlock**: a device with `unlock.fastboot` (`flashing` or `oem`) gets a one-click unlock stage built in `src/catalog.js` (`unlockStage`), still behind the typed confirm `UNLOCK AND WIPE`. `["lock", family]` is only allowed inside a stage option with `default: false` on a ROM whose `includes.relock` is yes; never a default step.
- **Protocols** (`src/protocols/usb.js`): WebUSB connections for fastboot, Odin, ADB and Amlogic burn mode; `rebootFromAndroid` sends `reboot:bootloader` / `reboot:download` over ADB (the site's "Phone in Android? Reboot to …" button).
- **Site** (`site/`): static page, generated from the catalog. `npm run build` writes `dist/`.

Files: ROMinit hosts only selected files: its own builds on Hugging Face (huggingface.co/PhilippLinux), which the page can download and attach in one click. Everything else, vendor firmware above all, links to its publisher (login-protected hosts work too); you download it, then pick it, and ROMinit checks and flashes it.

Safety: every file is pinned by size and SHA-256, every step verb is whitelisted per recipe, device identity is checked before the first write, and any mismatch stops the run (fail closed). Catalog data is shown as text only.

## Add a device

1. `catalog/devices/<category>/<vendor>/<codename>.json` (category folder: `phones`, `tablets`; it sets the device's category): name, models, `detect`, `modes` (how to reach fastboot / download / recovery), `unlock` (`text`, vendor `hints`, numbered `steps`, optional `pivots` [{problem, fix, url}] for soft-locks), `recovery`.
2. `catalog/roms/<codename>/<source>.json`: ROMs with stages. A ROM `id` is `<publisher>-<line>` (`philipplinux-pmos-server`, `official-pmos-mainline`, `xiaomi-stock`) and never contains the version, so ratings and tests survive updates; a major jump (Android 14 → 15) is a new entry with `supersedes` naming the old one in the same file; each stage names a recipe, a mode, pinned files (`name`, `size`, `sha256`, https `source` page, optional direct `url`, optional `revisions` [{size, sha256}] for re-uploads of the same file that are also accepted) and `steps` like `["flash", "boot_b", "boot.img"]`. Every ROM has an `origin` (official / maintainer / unofficial / stock) and a `status` (stable / beta / nightly / experimental / legacy / broken; `broken` stays listed but cannot be flashed), see `ORIGINS` and `STATUSES` in `src/catalog.js`, plus `vetting` (`curated`: endorsed by its community or ROMinit, set by a person only; `scraped`: found by a scraper, subject to verification; see `VETTING`), `risk` ({level: low / mid / high, why}, from reputation and contributors, see `RISKS`; no source code and not stock firmware means `high`), optionally `recommended: true` (set by a person only, official or stock ROMs with low risk), and optionally `pick` ({text, https url}, set by a person only) for long-running community favourites like an XDA top pick. Every ROM also needs a `rating`: a `checked` date and each feature of the postmarketOS wiki feature table (`FEATURE_GROUPS` in `src/catalog.js`: basics, multimedia, connectivity, modem, misc, sensors) as works / partial / broken / untested / n/a (n/a = no such hardware, left out of completeness). Plus `includes`: google_play, microg, android_apps, phone_ui, root, updates, encryption, relock, banking_apps, ssh, docker as yes / no / optional. Plus `kernel` (`version`, `type`: mainline / downstream), `base` (e.g. "postmarketOS edge"), `released` date and `support` (active / maintenance / abandoned). The site shows completeness twice, "as computer" and "as phone" (`USES` in `src/catalog.js`): the share of those features that work, partial counting half, with the untested count. Plus `slots` (`ab` or `single`) and `requirements`: a list spelling out everything the install assumes (bootloader version, wipes, which slot it writes).
3. `npm ci && npm test && npm run build`. The validator lists every problem.

Copy an existing device as a template.

## ROMinit CLI

The CLI and browser helper are one installation: `rominit`. Run commands in a terminal, or keep `rominit serve` running to connect that same CLI to the website. Setup, sign-in and connection status share the website’s CLI page.

Choose either authentication method once:

- `rominit auth`: open the printed link, sign in on the website and approve the CLI.
- `rominit auth --api-key`: [create an API key on the website](https://rominit.pages.dev/?view=agents), then paste it into the hidden terminal prompt.

Both save the credential in the OS credential store (macOS Keychain, Windows Credential Manager, or Linux Secret Service). Linux needs an available, unlocked Secret Service; there is no plaintext fallback. Browser login creates a revocable **ROMinit CLI** API key valid for one year. A manually created key uses the expiry you selected. Later, run `rominit serve` to reuse the saved login. Run `rominit logout` to remove it locally; revoke it on the website to invalidate it remotely. Close existing helpers after logout.

The helper listens only on `127.0.0.1:18787`. While signed into the same website account, a CLI action checks the running CLI and connects automatically using its saved login; an unavailable CLI produces a connection error. The browser may ask for local-network access. Automatic connection uses a 60-second, one-use verifier-bound grant that can only be redeemed with the existing CLI API key; it never creates another key or sends that key to the page. The browser remembers its loopback bearer in local storage, and the CLI keeps its matching session in the OS credential store across restarts, for up to 30 days or the API key expiry. Disconnect removes this browser connection while preserving the saved CLI login. Close the CLI with Ctrl+C to stop it. The printed link remains available for initial account setup.

For an SSH phone test, click **Run with CLI** on the website after pairing. The helper runs the bundled quiet benchmark over SSH and returns its output to the same report card for review. It needs an SSH client on the computer and sshpass to use the phone password without a terminal prompt. The phone needs SSH service enabled; its own SSH client is not required for this path. The CLI does not run supplied shell commands. Terminal and CLI entry scripts detect Android versus Linux on the phone before choosing bundled probes. A detected OS mismatch is shown as a failed test, so results cannot be attached to the wrong selected ROM. Linux graphics checks use bounded GL/EGL renderer queries when available; a GPU node or Vulkan device listing alone does not prove working 3D acceleration. Display/touch/audio probes read standard framebuffer/DRM, backlight, input-capability and ALSA interfaces, and include permission limits; picture quality, touch response and audibility still require human confirmation. Root detection distinguishes UID 0 or noninteractive sudo/doas access from installed privilege tools that need authentication. No input events or microphone recordings are collected. The website autosubmits a report on arrival and saves corrections until review starts. Retest keeps connection fields only in tab memory; the website never stores entered SSH usernames, passwords or addresses or includes them in report payloads. Public ROM defaults prefill the login fields. Standard SSH host-key checking remains enabled in the local CLI. When paired, USB-network targets come from local interface/route/neighbor metadata, with no network scan or trial login; manual address entry remains available. USB preparation is a separate opt-in capability described below.

### USB preparation (Linux)

By default the CLI supports authenticated connection status, disconnect and SSH phone benchmarks. **Linux USB preparation** adds removable USB-drive discovery, a five-minute plan and typed confirmation, with Ventoy and direct-image methods. It can download a selected ISO from the bundled edition/architecture catalog (Alpine Linux and Omarchy today), verify its pinned size and SHA-256, and copy it after installation; a locally configured pinned ISO remains available. It does not verify that a computer boots the stick. Choose edition, architecture, then USB install type. Direct writing erases the entire selected USB and verifies the image-sized region afterward; it is never an automatic destructive retry. ISO writing does not establish that the selected computer can boot it. Direct mode does not require a Ventoy installation: keep `rominit serve` running on Linux with Python 3, lsblk, udisksctl and noninteractive sudo available. The raw writer flushes data, clears the block-device cache and hashes exactly the written image region before completion. The website shows measured writing and readback progress; flushing and stages without byte counts use an indeterminate bar. Images are capped at 16 GiB and the download timeout scales with image size, so full desktop ISOs (Omarchy is 6.0 GiB) are supported.

Download the official [Ventoy Linux release](https://github.com/ventoy/Ventoy/releases), check its published SHA-256, and extract it yourself. Start the helper with `ROMINIT_VENTOY_DIR=/absolute/path/to/ventoy-version rominit serve`, then open the **Prepare USB** panel while signed in. Installation needs noninteractive `sudo` access, `lsblk`, and `udisksctl`. Install the reviewed Ventoy tree under a root-owned directory (for example `/var/lib/rominit/ventoy/1.1.18/ventoy-1.1.18`); all ancestors and contents must be root-owned, not writable by group/others, and contain no symlinks. A user-writable download directory is rejected before unmounting. The Alpine Linux and Omarchy pages select official ISO downloads by a bundled image ID, never an arbitrary browser URL or local path. ISO images can be written directly regardless of architecture; Ventoy retains its supported firmware restrictions. Other archives remain download-only. To include your own local ISO instead, also set `ROMINIT_ISO_PATH=/absolute/path/to/image.iso` and `ROMINIT_ISO_SHA256=<publisher-sha256>` before starting the helper. The plan shows the filename, size and pin; copying never overwrites an existing file. Only a whole, removable, writable USB disk with a stable USB identity is eligible. Review its model, capacity, path and mounted partitions; the exact phrase is deliberately never filled in for you. A selected catalog ISO on a recognized Ventoy stick uses a copy-only plan after layout and version verification; it preserves partitions and refuses to overwrite existing files. A fresh installation erases the selected USB. The helper uses Ventoy's ordinary install mode and does not force-reinstall an existing Ventoy drive. A failed installation may leave the USB partially prepared; retry only after reviewing it again.

A completed ISO with a size or SHA-256 mismatch is shown with expected and actual values. The user can retry, cancel, or explicitly use that exact file anyway, then still type COPY or ERASE. This exception applies only to that plan; the source is rehashed before writing and the USB file is hashed after flushing. Missing files, incomplete transfers, unsafe drives and changed sources do not use this override. Completion is reported after the readback checks pass.

For local development, set `ROMINIT_URL` to the site's HTTP loopback origin before starting the CLI, for example `ROMINIT_URL=http://127.0.0.1:8788 node bin/rominit.mjs serve`. Otherwise the helper trusts only `https://rominit.pages.dev`. Apply `migrations/2026-10-17-helper-grants.sql` to an existing database before deploying this authentication flow; a fresh database uses `schema.sql`. No browser extension or extra service is needed beyond keeping rominit serve running. The downloaded CLI source archive includes site/bench, which the benchmark runner reads locally.

## OS pages

PC operating systems get their own page, built from one shared template. Each OS is one file in `catalog/os/<id>.json`: the official release metadata, the editions, the SHA-256-pinned images with their size and URL, and the page copy. `src/os/index.js` lists them; the build renders each to `dist/<id>.html` from `site/os.html` and `site/os.js`, and the OS list on the device page links to them.

To add an OS: write the JSON, list it in `src/os/index.js`, and add its logo and screenshot under `site/logos/` and `site/shots/`. The build fails if a referenced asset is missing. Nothing in the template names a specific distribution, so a new OS needs no code change.

Alpine Linux (`/alpine`) and Omarchy (`/omarchy`) are catalogued today. Omarchy ships one installer ISO for x86_64; its image is 6.0 GiB, so the USB stick needs 8 GB or more, and the CLI's 16 GiB image cap covers it.

## Recovery catalog

Standalone recovery installers live in `catalog/recoveries/<codename>/<id>.json`. Each file has `device` and one `recovery` object with `id`, `name`, `version`, `project`, `source`, `vetting`, `requirements`, `imported` (date), `imported_from` (seed provenance) and `stages`. Recovery stages use the same validated recipe verbs and pinned files as ROM stages and have `section: "tools"`.

The phone page lists these as an opt-in **Other recovery installers** list inside **R · Recover / revert**. A matching installer already required by the selected ROM stays in **2 · Custom recovery**. Installing a recovery is separate from restoring stock firmware. Import metadata records catalog coverage, not a successful flash. TWRP seeds currently cover Samsung Galaxy S7 edge (`hero2lte`), Galaxy S9 (`starlte`) and Galaxy S9+ (`star2lte`); they are marked `scraped`.

## Develop

```
npm ci
npm run check   # types
npm test        # recipes, catalog validator, downloads
npm run bench   # website end to end: real Chromium against wrangler pages dev + fresh local D1 (build first; CHROMIUM, BENCH_PORT)
npm run build   # dist/
```

## Layout

- `site/`: the web page; `functions/`: Cloudflare Pages Functions (API, sign-in); `src/`: catalog validator, recipes, USB protocols
- `catalog/`: devices and ROMs (JSON); `schema.sql` + `migrations/`: D1 database
- `test/`, `bench/`: unit tests and the end-to-end site bench; `scripts/`: build and catalog loading
- `romvault/`: ROMvault, the knowledge base (private repository, git-ignored here): vendors, OS projects, device series, devices, per-ROM pages, scraping notes (markdown, rules in `romvault/AGENTS.md`)
- `romsources/research/`: link to `~/projects/rominit-research/shared/romsources` (raw research, local only, not served); kept because ROMvault pages link through it
- `romvault/skills/`: ROMinit agent skills (rom-scraper, romvault-maintenance); in a private ROMvault checkout, link them into `.agents/skills/` and `.claude/skills/` (git-ignored)

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

Existing database: apply new files in `migrations/` in date order, e.g. `npx wrangler d1 execute rominit --remote --file migrations/2026-10-17-agent-api.sql` (`schema.sql` already includes them).

AI agents: the MCP endpoint is `/mcp`; everything but `initialize` needs a personal API token made on `/?view=agents` (100 tool calls an hour). Agent reports land in the admin inbox under "04 Agent reports", by outcome; `node scripts/inbox.mjs` lists them as `agents`.

Reports from "Something wrong on this page?": `npx wrangler d1 execute rominit --remote --command "SELECT id, page, text, at FROM reports ORDER BY id DESC LIMIT 50"`.
Comment screenshots stay hidden until approved. Pending: `npx wrangler d1 execute rominit --remote --command "SELECT comment_id FROM comment_images WHERE approved = 0"`. Approve: `... --command "UPDATE comment_images SET approved = 1 WHERE comment_id = <id>"`. Delete a comment: `... --command "DELETE FROM comment_images WHERE comment_id = <id>; DELETE FROM comments WHERE id = <id>"`.

Local: `echo SALT=dev > .dev.vars`, `npx wrangler d1 execute rominit --local --file schema.sql`, `npx wrangler pages dev dist`.
