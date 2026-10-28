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

1. **Version**: current stable release and date from the publisher's release page.
2. **Editions**: every main edition the publisher ships, per architecture: desktops, spins, flavours, handheld, server or minimal. Compare against the publisher's download page, not just ROMvault. Image ids: `<id>-<edition>-<arch>`.
3. **Pins** for each image, in order of preference:
   - publisher digest: `sha256` + `sha256Url` (or `sha512` + `sha512Url`) copied from the publisher's checksum file;
   - no publisher digest: download it from the publisher URL, hash it, set `sha256` + `sha256Computed: "<YYYY-MM-DD>"`.
   Never a hash from a third party. Prefer versioned URLs over "latest" names. `size` from HEAD Content-Length. `usb: true` only when the publisher documents writing that image to USB.
4. **Facts**: requirements, kernel, officialSupport (status, `until`), each with source URL and `checked` date.
5. **Page**: description, eyebrow, intro, pros, cons, status, links, footer, checked, credits. Plain language.
6. **Logo** (required): `site/logos/<id>.svg` from Simple Icons (CC0) or Wikimedia Commons with its licence; credit it and add a notice line in `scripts/build.mjs`.
7. **Screenshot** (optional): Wikimedia Commons (CC0, CC BY, CC BY-SA, GPL-family), else a publisher screenshot (`license: "Publisher screenshot"`), saved under `site/shots/<id>/`, WebP preferred. None found: ship logo-only.
8. Gated downloads (RHEL, SLES, ...): `infoOnly: true`, no editions, links required.
9. New entry: import it in `src/os/index.js` and add it to `OSES`.

## Gates

`node --test test/os-catalog.test.js`, `npm run check`, `npm run build`, `npm test`: all pass before the commit. One commit per OS: `OS catalog: <name> <version> (<editions>)`; a recheck: `OS catalog: <name> recheck (<what changed>)`.

## Never

Invent a checksum, size or date; add a flash recipe or claim an install was tested; push or merge (the owner does).

## Report

Per OS: version, editions and arches pinned, digest source per image (publisher URL or computed date), logo and screenshot source; OSes skipped and why; facts that disagree with ROMvault (report them, do not edit ROMvault from this skill).

## Improve this skill

This skill grows with the work. End every report with a **Skill notes** list: what in this file was wrong, missing or slowed you down (a better source pattern, a recurring blocker, a rule the tests enforce that is not mentioned). The owner's agent folds them in here; keep the file short by replacing, not appending.
