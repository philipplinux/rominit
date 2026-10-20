---
name: rominit
description: 'Flash or recover a phone with ROMinit from an agent: look up devices, ROMs and recipes over the ROMinit MCP (rominit_* tools), run fastboot stages with the `rominit` CLI, and report every attempt back. Use when asked to flash, unbrick, install a custom ROM or postmarketOS, benchmark a phone, or check what ROMinit supports for a device.'
---

# ROMinit: MCP for knowledge, CLI for the flash

The MCP tells you **what** to do (catalog, recipes, run reports). The CLI **does** it on a USB-connected phone. Both read the same catalog; the MCP never touches a device.

## 0. Safety (always)
- A stage with `destructive: true` (MCP) or a `confirm:` phrase (CLI `plan`) erases data. Show the human its `warning` and let **them** type the confirm phrase. Never supply it, never pipe it: `rominit run` refuses a non-TTY stdin by design.
- Read the ROM's `notes`, `risk` and `requirements` before stage 1. Unmet requirement (bootloader unlocked, firmware version, battery) → stop and tell the human.
- Files are pinned by SHA-256; the CLI checks them. Never flash a file whose hash doesn't match.
- Nothing personal in reports: no serials, IMEI, emails, IPs, MAC, phone numbers, account names, home paths (write `~`).

## 1. Look up (MCP)
Needs the human's free API token (made at `https://rominit.pages.dev/?view=agents`, sent as `Authorization: Bearer <token>`; 100 calls/hour). No token → ask the human for one; don't guess around it.

1. `rominit_find_devices` `{query}`: name, model number or codename → `codename`, ROM summaries.
2. `rominit_get_device` `{codename}`: unlock steps, boot modes (how to enter fastboot/recovery), ROM list.
3. `rominit_get_rom` `{codename, rom_id}`: stages, files, steps, notes, risk, requirements.

Step verbs: `flash`, `erase`, `set_active`, `reboot`, `sideload`, `write`, `mkfs_ext4`; `fastboot-tgz` stages run the archive's own flash list.

## 2. Flash (CLI)
From a ROMinit checkout (`npm install` once) or via `rominit` on PATH. Add `--json` for one event per line (`step|progress|error|done`); `--local` reads the checkout's `catalog/` instead of the site.

```bash
rominit devices                                  # phones in fastboot right now
rominit plan <codename> [rom-id]                 # ROM list, or stages + warning + confirm
rominit fetch <codename> <rom-id> [--dir DIR]    # download + SHA-256 check, no USB
rominit run <codename> <rom-id> --stage N [--dir DIR] [--no-bench]
rominit bench <codename> <rom-id> [--host ADDR]  # read-only benchmark over SSH, no flash
```

- Run stages in order, one `run` per stage. Between stages, put the phone in the mode the next stage names (`plan` shows `[recipe, mode]`; boot-mode keys come from `rominit_get_device`).
- CLI runs only `fastboot` recipe stages and no `.img.xz` files yet. Anything else (adb sideload, odin, fastboot-tgz, …) → send the human to the device page (`page` from the MCP) and keep reporting.
- postmarketOS: after a final reboot `run` waits for SSH over USB and runs the read-only benchmark; needs `ssh`, or pass `--no-bench`.
- On a failure the CLI asks the human at the terminal (retry/abort). Without a TTY it exits with the error: relay it to the human, have them fix it (replug, right mode), then re-run that stage.

## 3. When it doesn't connect or a stage fails
Bootloader, fastboot and download-mode problems look the same for every ROM. Diagnose from what the CLI printed; don't improvise flash commands outside the recipe.

| Host | `rominit devices` finds nothing | Fix |
|---|---|---|
| Linux | phone visible in `lsusb`, but no access | udev rules (`android-udev-rules` package), replug |
| Windows | no driver in fastboot mode | Google USB Driver, or WinUSB via Zadig |
| macOS | usually works | – |

Every host: phone really in the mode the stage names (`rominit_get_device` boot modes), data cable (not charge-only), direct port instead of a hub.

| Symptom | Likely cause | Do |
|---|---|---|
| `not allowed` / `locked` on flash | bootloader locked | unlock steps from `rominit_get_device`; it wipes, so the human decides |
| unknown partition / size mismatch | wrong device or variant | stop; recheck the model number with `rominit_find_devices` |
| signature / anti-rollback error | firmware too old or too new for this ROM | stop; check the ROM's `requirements`, never force |
| boots back to bootloader or loops | wrong slot or missing firmware stage | check that every stage ran in order; report it, ask the human |

Unclear cause → log the exact error line with `rominit_log_step` and ask the human. Deeper read-only diagnosis, opt-in only (after such a logged failure or a recipe pointer, and the human agrees): `rominit-debug-android`, `rominit-debug-linux`, `rominit-debug-ios` (recovery only).

## 4. Report (MCP, every attempt)
The data is free; the price is a report, success or not.

1. `rominit_start_run` before stage 1 (codename, rom_id, host OS, tool versions) → `run_id`.
2. `rominit_log_step` after each stage, and for each step that failed, was skipped or needed a workaround (`outcome`: ok|failed|skipped|workaround, `detail`: error line, versions, what you changed).
3. `rominit_finish_run` at the end: `outcome` (success|partial|failed|abandoned) and `resolution` = what the next person should do differently.

Report device and procedure facts only. Reports go to maintainers for review; they don't change pages directly.
