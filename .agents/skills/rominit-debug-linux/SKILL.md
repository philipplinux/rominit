---
name: rominit-debug-linux
description: 'Read-only diagnosis of a phone running mobile Linux (postmarketOS, and distros built on it) after a ROMinit flash went wrong: no boot, stuck in initramfs, USB network or SSH missing, services failing. Opt-in only: use after a logged failed/workaround step or when a recipe step points here, and only once the human agrees.'
---

# Debug a mobile-Linux phone (read-only)

Builds on the `rominit` skill (safety rules, MCP lookup, run reports). This skill only **reads**. Reflashing, a new boot image or kernel cmdline changes go back to the recipe (or a later kernel-builder skill) and its confirm phrase.

## 0. Gate (every time)
- Use it only when one of these holds: a `rominit_log_step` came back `failed`/`workaround`, a stage failed in `rominit run` (incl. the post-flash benchmark not reaching SSH), or the recipe/notes point here.
- Say what you will read and ask the human first. Read the device's pitfalls (`rominit_get_device`, `rominit_get_rom` notes) before any log.

## 1. How far did it boot?
postmarketOS brings up USB networking early; the phone is `172.16.42.1` on that link.

| Host sees (`lsusb`, `ip link`, `dmesg` on the host) | Stage reached | Next |
|---|---|---|
| nothing new on USB after the reboot | kernel didn't start, or crashed early | §2 |
| USB network appears, no ping/SSH | initramfs (couldn't find or mount root, or USB net quirk) | §3 |
| `ssh user@172.16.42.1` works | booted userspace | §4 |
| the phone shows the vendor logo or a black screen | says little: the display may be the only broken part | check USB anyway |

## 2. Kernel didn't come up
- Check that every stage ran, in order: `rominit plan` against the run log. A skipped stage is the most common cause.
- If TWRP or another recovery boots: read the failed boot's kernel log over adb, `cat /sys/fs/pstore/console-ramoops*` or `/proc/last_kmsg`. Last ~50 lines: panic, missing dtb, `Unable to mount root`.
- Empty or garbled ramoops: ask the human to let the phone cool a few minutes, boot once more, then read again.
- Still nothing → report it; kernel/dtb problems are a kernel-builder job, not something to patch here.

## 3. Stuck in initramfs
- The initramfs debug shell starts by itself when boot fails, or when the human holds **Volume-Down** (Left Ctrl on keyboard devices) at boot. It is reachable with `telnet 172.16.42.1` on the USB link.
- In it, read: `cat /pmOS_init.log`, `dmesg | tail -100`, `blkid` (are `pmOS_boot` / `pmOS_root` there?), `cat /proc/cmdline`.
- Missing partitions → usually a wrong or partial flash stage; compare with the recipe, report, ask the human.
- Only the kernel cmdline `pmos.debug-shell` forces the shell; that needs a rebuilt boot image, so it's a write: not from this skill.

## 4. Booted, something is broken
- Errors this boot: `journalctl -b -p err --no-pager | tail -100` (systemd) or `/var/log/messages` and `rc-status` (OpenRC; `rc_logger=YES` in `/etc/rc.conf` adds `/var/log/rc.log`, ask before changing it).
- Kernel: `dmesg --level=err,warn | tail -100` (may need `sudo`).
- Release and device package: `cat /etc/os-release`, `apk info -e device-<codename>` or `apk policy device-<codename>`.
- Hardware facts read-only: `rominit bench <codename> <rom-id>` (sends the benchmark to ROMinit).

## 5. Report
- `rominit_log_step` with the stage, `outcome`, and in `detail` only the deciding lines plus release/kernel version. Never raw journals: they hold hostnames, IPs, MACs and user names.
- Unclear cause → say so, log what you saw, ask the human.

## How this skill grows
Each finding that holds up (symptom → cause → fix, with source or run id) goes to the device/ROM page in ROMvault first. When a pattern repeats across devices, distill it into the tables here. Sources: postmarketOS wiki pages Initramfs and Troubleshooting on-device issues/Booting problems (checked 2026-10-17).
