# Console pages pilot report — 2026-10-28

## Scope and implementation

Completed pilot scope: PS5 genericized template plus Nintendo Switch, Anbernic RG35XX H700 family, and ASUS ROG Ally/Ally X pages, and four generated family hubs (PlayStation, Nintendo, Anbernic, ASUS ROG Ally). The handheld PC remains under `catalog/devices/consoles/asus/rog-ally/`: ROMinit currently serves all these research pages through `src/consoles/index.js` and has no separate PC-console page category; this is a site taxonomy decision, distinct from ROMvault's `devices/pc/` path.

Template wording and project-kind sections are data-driven; console pages link back to their family hub. Hubs contain only console names, year/status, and links to existing ROMinit console pages. Missing media is allowed; no assets were added. Console records remain research-only with no downloads, recipes, or pinned images. Existing `consoleCompatibility` behavior is unchanged.

## Pages and evidence

| Page | Drafter | Sources and gaps | Media |
|---|---|---|---|
| Nintendo Switch | local-worker (`ses_e7d074f74ffeagD27TI4KKayLx`) | ROMvault `devices/consoles/nintendo/switch/` plus cited Nintendo, Atmosphère, hekate, switchroot, and Switch homebrew guide sources. Gaps: firmware version is upstream-derived rather than Nintendo-quoted; no independently sourced dates for all model variants; project support is hardware/entrypoint-dependent, not an exact firmware matrix. | Omitted; no eligible licensed asset recorded in the catalog. |
| Anbernic RG35XX H700 family | beam-worker (`ses_e7d073be1ffe9Tx4jeYdIIIpWK`) | ROMvault `devices/consoles/anbernic/rg35xx*` plus Anbernic, KNULLI, ROCKNIX and spruceOS cited pages. Specs are detailed only for RG35XX H; muOS and a source-confirmed H700 placement for RG34XX SP are absent. | Omitted; no eligible image included. |
| ASUS ROG Ally / Ally X | local-worker (`ses_e7d072c9fffeI7sRRMGhjsyXxO`) | ROMvault `devices/pc/asus/rog-ally-rc71l/` and Ally X page plus cited ASUS, Valve, Bazzite and ChimeraOS sources. Exact BIOS/EC versions were not quoted; ChimeraOS has no explicit Ally X row; SteamOS remains experimental support. | Omitted; no asset provenance recorded in catalog. |

No ROMvault files were edited. The report records source gaps for follow-up; findings should be added to ROMvault only in a separately approved change.

## Verification

- `npm test`: 236 passed, 0 failed, 2 skipped (private ROMvault checkout tests).
- `npm run check`: passed.
- `npm run lint`: passed after creating the ignored local symlink `work/console-pages/romvault -> ../../romvault`; a fresh worktree needs that symlink or `ROMVAULT_DIR` set. No lint rules were changed.
- `npm run build`: passed; built 4 console families.
- `git diff --check`: passed.
- PS5 before/after: `/tmp/opencode/ps5-before.png` and `/tmp/opencode/ps5-after.png`, Playwright against baseline/current `dist/`, 1440×1000 viewport, full page. Dimensions match (1440×10229); pixel differences remain in the hero/content area, so visual equivalence is **not** established. Inspect before owner acceptance; these artifacts are in `/tmp/opencode/`.

## Open questions

- Owner review of hardware-dependent compatibility language and the omission of licensed media.
- Consider later whether to add eligible Switch/Ally imagery and whether to source muOS and remaining RG35XX family facts.
- No device images or firmware are pinned in this pilot; candidate SD-card OSes are KNULLI, ROCKNIX, spruceOS, and (if sourced) muOS. Pinning remains a later owner decision.
