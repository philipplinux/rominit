---
name: os-catalog
description: Add or recheck ROMinit OS catalog entries (catalog/os/pc/<id>.json, site OS pages) from ROMvault pages or fresh publisher research: editions, pinned image URLs and checksums, logo, screenshot. Use when asked to add an OS to the catalog, list more OSes, recheck or refresh an OS entry, or fill edition gaps.
---

# OS catalog

Adding an OS and rechecking one are the same checklist: an add starts from an empty file, a recheck from the existing one. Be accurate, not pedantic: entries age, and the next recheck catches drift.

## Read first

- `src/os/index.js`: the `Os` / `OsImage` typedefs and the validators (`osImagePinProblems`, `osPhotoProblems`, `osRecordProblems`, `OS_PHOTO_LICENCE`). They are the rules; this skill does not restate them.
- `test/os-catalog.test.js`, `test/media.test.js`.
- A model entry: `catalog/os/pc/alpine.json` (full), `catalog/os/pc/cachyos.json` (several editions). Keep the compact style: one line per image. Edit JSON as text, never re-dump the whole file.
- The ROMvault page `romvault/os/pc/<os>.md` and its children when they exist.

## Checklist per OS

1. **Version**: current stable release and date from the publisher's release page. JS-only download pages (Zorin, Manjaro, Nobara, CachyOS, Pop!_OS, antiX): use the mirror or `/releases/`, `/iso/` directory listings instead.
2. **Editions**: every main edition the publisher ships, per architecture: desktops, spins, flavours, handheld, server or minimal. Compare against the publisher's download page, not just ROMvault. Image ids: `<id>-<edition>-<arch>`.
   - **One record per family.** ROMvault release or edition pages (`ubuntu-26-10`, `opensuse-leap`, `pfsense-ce-plus`) become editions of the family record, never records of their own. A fold gets its own commit: `OS catalog: <family> as one record (<folded ids>)`.
   - Publisher "current" directories drift per edition: compare dates per edition and leave out a stale one rather than mixing snapshots in one record.
3. **Pins** for each image, in order of preference:
   - publisher digest: `sha256` + `sha256Url` (or `sha512` + `sha512Url`) copied from the publisher's checksum file;
   - no publisher digest: download it from the publisher URL, hash it, set `sha256` + `sha256Computed: "<YYYY-MM-DD>"`.
   Checksum files come as `<hash>  <file>`, `SHA256 (file) = <hash>` or `# SHA256 HASH` blocks; multi-file sidecars and multi-algorithm pages (`CHECKSUMS.TXT`, `verify.txt`) must be matched by filename. No checksum file but the sum printed in the download page body (FydeOS): that page is a valid `sha256Url`. Checksum files can sit outside the ISO directory (per-file `.sha256sum`, a mirror path). MD5-only publishers: mirror `*.allsums.txt` (archive.org, SourceForge) often carry a SHA-256. Never a hash from an unrelated third party. Prefer versioned URLs over "latest" names. `size` from HEAD Content-Length. Formats: see the `format` check in `osRecordProblems`; only `USB_FORMATS` write to USB, the rest (zip, ova, iso.zst, ...) are download-only with `usb: false`. `usb: true` only when the publisher documents writing that image to USB.
4. **Facts**: requirements, kernel, officialSupport (status, `until`), each with source URL and `checked` date.
5. **Page**: description, eyebrow, intro, pros, cons, status, links, footer, checked, credits. Plain language.
6. **Logo** (required): `site/logos/<id>.svg` from Simple Icons (CC0) or Wikimedia Commons with its licence; credit it and add a notice line in `scripts/build.mjs`.
7. **Screenshot** (optional): Wikimedia Commons (CC0, CC BY, CC BY-SA, GPL-family), else a publisher screenshot (`license: "Publisher screenshot"`), saved under `site/shots/<id>/`, WebP preferred. None found: ship logo-only.
8. Gated downloads (RHEL, SLES, ...) or installer-app-only downloads (pfSense, Unraid): `infoOnly: true`, no editions, links required, the blocker named on the page. Recheck info-only records every sweep: a blocker can lift (new accepted format, a published checksum).
9. New entry: import it in `src/os/index.js` and add it to `OSES`.

## Gates

Per commit: `node --test test/os-catalog.test.js test/media.test.js` and `npm run check`, and confirm every `page.logo.src` file exists (tsc and the unit tests miss a missing logo; `npm run build` catches it). All four gates (`npm run build`, `npm test` too) every 5 commits and before stopping. Wikimedia rate-limits bursts (429): send a User-Agent and pause. One commit per OS: `OS catalog: <name> <version> (<editions>)`; a recheck: `OS catalog: <name> recheck (<what changed>)`.

## Never

Invent a checksum, size or date; add a flash recipe or claim an install was tested; push or merge (the owner does); pin any value from `research/**/s9-*` (free-model S9 scraping) without re-checking it at the publisher.

## Report

Per OS: version, editions and arches pinned, digest source per image (publisher URL or computed date), logo and screenshot source; OSes skipped and why; facts that disagree with ROMvault (report them, do not edit ROMvault from this skill).

## Improve this skill

This skill grows with the work. End every report with a **Skill notes** list: what in this file was wrong, missing or slowed you down (a better source pattern, a recurring blocker, a rule the tests enforce that is not mentioned). The owner's agent folds them in here; keep the file short by replacing, not appending.
