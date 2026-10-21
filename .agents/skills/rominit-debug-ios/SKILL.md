---
name: rominit-debug-ios
description: 'Read-only diagnosis of an iPhone or iPad that won''t boot, loops on the Apple logo or is stuck in recovery/DFU, and the path to Apple''s own restore. iOS takes no custom ROMs, so this is recovery only. Opt-in only: use after a device lookup or a logged failure shows an Apple device, and only once the human agrees.'
---

# Debug an iPhone / iPad (read-only, recovery only)

Builds on the `rominit` skill (safety rules, run reports). iOS only accepts Apple-signed firmware: ROMinit can't flash it, and there is no catalog recipe. This skill finds out what state the device is in and hands the human Apple's restore path.

## 0. Gate (every time)
- Use it only when a lookup or a logged run shows an Apple device, and the human agrees. Say what you will read first.
- Never help bypass Activation Lock / iCloud lock, MDM or a passcode. Without the owner's Apple ID, stop: that is Apple's (or the seller's) job.
- Tools: libimobiledevice (`idevice_id`, `ideviceinfo`, `idevicesyslog`, `idevicecrashreport`) and libirecovery (`irecovery`), packaged on Linux and Homebrew. On macOS, Finder and Console.app do the same.

## 1. Where is the device?

| Host sees | State | Next |
|---|---|---|
| `idevice_id -l` lists it | booted, paired | §2 |
| listed in `lsusb` (Apple `05ac`), not in `idevice_id` | booted, not trusted | human unlocks the phone and taps **Trust** (that writes a pairing record; ask first) |
| `irecovery -q` → `MODE: Recovery` (USB `05ac:1281`) | recovery mode | §3 |
| `irecovery -q` → `MODE: DFU` (USB `05ac:1227`), black screen | DFU | §3 |
| nothing | off, dead battery, cable, host | charge 30 min, Apple cable, direct port; host table in the `rominit` skill |

`irecovery -q` and `ideviceinfo` without `-k` print ECID, serial, UDID and IMEI: read them on screen if needed, never paste or report them.

## 2. Booted: read facts and logs
- Model and version only: `ideviceinfo -k ProductType`, `-k ProductVersion`, `-k BuildVersion`.
- Live log while the problem happens: `idevicesyslog | tail -300`.
- Crash and panic reports: `idevicecrashreport -e <dir>` (pulls them off the phone), then look for `panic-full-*` and the app crashes around the problem time.
- On the device itself: Settings › Privacy & Security › Analytics & Improvements › Analytics Data.

## 3. Logo loop, recovery or DFU: Apple's restore
Entering recovery (from Apple's guide): iPhone 8 and later, press-release Volume Up, press-release Volume Down, then hold the side button until the computer/cable screen. iPhone 7: hold side + Volume Down. iPhone 6s and earlier: hold Home + side/top. iPads differ by Home button; follow Apple's page.

| Option | Data | Tool |
|---|---|---|
| **Update** (try first) | kept | Finder (macOS), Apple Devices app (Windows), `idevicerestore` (Linux, no erase flag) |
| **Restore** | **erased** | same tools; `idevicerestore -e` |

- Restore is destructive: show the human what gets erased and let them choose it and start it themselves; check that they know their Apple ID first (Activation Lock after restore).
- Firmware comes only from Apple (the tools fetch signed IPSW files). Unsigned or modified IPSWs won't install; don't offer them.

## 4. Report
- `rominit_log_step` / `rominit_finish_run` with model (`ProductType`), iOS build, mode, and the deciding error (e.g. restore error number). Never ECID, UDID, serial, IMEI or Apple ID.
- Hardware fault signs (restore fails repeatedly with the same error, panics naming a sensor or the NAND) → say so and point to Apple support or a repair shop.

## How this skill grows
Each finding that holds up (symptom → cause → fix, with source or run id) goes to the device page in ROMvault first (an Apple vendor folder once the first device page exists). Repeated patterns move into the tables here.
