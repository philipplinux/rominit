---
name: rominit-debug-android
description: 'Read-only diagnosis of an Android phone (stock, LineageOS, /e/OS, GrapheneOS, TWRP) after a ROMinit flash or recovery went wrong: where the phone is (bootloader, fastbootd, recovery, booted, nothing), bootloader facts, boot loops, crash logs. Opt-in only: use after a logged failed/workaround step or when a recipe step points here, and only once the human agrees.'
---

# Debug an Android phone (read-only)

Builds on the `rominit` skill (safety rules, MCP lookup, run reports). This skill only **reads**. Any write (flash, erase, wipe, set_active, unlock) goes back to the ROM's recipe and its confirm phrase.

## 0. Gate (every time)
- Use it only when one of these holds: a `rominit_log_step` came back `failed`/`workaround`, a stage failed in `rominit run`, or the recipe/notes point here. Otherwise don't start.
- Say what you will read and ask the human first. Each command below is read-only; still list it before running.
- First read the device's pitfalls: `rominit_get_device` + `rominit_get_rom` notes. A known pitfall beats any log dig.

## 1. Where is the phone?

| Host sees | State | Next |
|---|---|---|
| `fastboot devices` lists it, `getvar is-userspace` = no | bootloader | §2 |
| `fastboot devices`, `is-userspace` = yes | fastbootd (dynamic partitions) | §2 |
| `adb devices` → `recovery` / `sideload` | recovery | §3 |
| `adb devices` → `device` | booted Android | §4 |
| `adb devices` → `unauthorized` | booted, USB debugging not accepted | human taps "Allow" on the phone |
| `lsusb` only, ID `05c6:9008` | Qualcomm EDL (emergency download) | stop: out of ROMinit's scope, report it |
| nothing at all | off, dead battery, or host problem | host table in the `rominit` skill; charge 30 min, retry the boot-mode keys |

## 2. Bootloader facts
`fastboot getvar <name>` one at a time: `product`, `current-slot`, `unlocked`, `version-bootloader`, `version-baseband`, `is-userspace`, `slot-successful:a|b`, `slot-unbootable:a|b`.
- Avoid `getvar all` in anything you paste or report: it includes the serial number.
- Compare `product` with the catalog codename and `version-*` with the ROM's `requirements`. A mismatch is the finding; stop there.

## 3. Boot loop: logs from recovery
With recovery over adb (`adb shell` works in TWRP and most custom recoveries):
- Kernel log of the failed boot: `adb shell cat /sys/fs/pstore/console-ramoops*` (newer) or `/proc/last_kmsg` (older). Empty → the bootloader rebooted straight into recovery and wiped it; ask the human to retry the normal boot once, then read again.
- Recovery's own log: `adb shell cat /tmp/recovery.log` (TWRP) or `/cache/recovery/last_log`.
- Read the last ~50 lines. Look for: `Kernel panic`, `dm-verity`, `avb`, `failed to mount`, `init: ... reboot`.

## 4. Booted, but something is broken
- Boot finished? `adb shell getprop sys.boot_completed` (1 = yes). Build/slot: `getprop ro.build.fingerprint`, `ro.boot.slot_suffix`, `ro.boot.verifiedbootstate`.
- Loops after the logo: `adb wait-for-device` then `adb logcat -b all -d | tail -300` before it restarts.
- Crashes: `adb logcat -b crash -d`; errors: `adb logcat '*:E' -d | tail -200`.
- `dmesg`, tombstones (`/data/tombstones`) and ANR traces need root on most builds; skip them unless the ROM is rooted.
- Never `getprop ro.serialno`, account or settings dumps: personal data.

## 5. Report
- `rominit_log_step` with the stage, `outcome`, and in `detail` only the deciding error lines plus the versions from §2. Never raw logs: they hold accounts, IPs and serials.
- Unclear cause after §1–4 → say so, log what you saw, ask the human. Don't guess a fix that writes to the phone.

## How this skill grows
Each finding that holds up (symptom → cause → fix, with source or run id) goes to the device/ROM page in ROMvault first. When the same pattern shows up on several devices, distill it into the tables here. Credit: log commands adapted from hyperb1iss/hyperdroid-skill (MIT).
