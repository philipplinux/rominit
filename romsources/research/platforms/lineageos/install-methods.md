# LineageOS install methods

Source: LineageOS/lineage_wiki @ 55880f7966ae, fetched 2026-10-16. Flow text is a paraphrase of the template, CC BY-SA.
Common tail of all fastboot_* methods: `_includes/templates/recovery_install_fastboot_generic.md`; overall page: `_includes/templates/device_install.md`.

| install_method | devices | flow | source template |
|---|---|---|---|
| `fastboot_nexus` | 177 | Generic Google/AOSP-style (also used by OnePlus, Pixels, many others): enable OEM unlock, 'fastboot oem unlock' per template, then boot to fastboot, flash recovery ('fastboot flash <recovery_partition_name>' or 'fastboot boot' if needs_fastboot_boot), reboot to recovery, adb sideload LineageOS zip | `_includes/templates/recovery_install_fastboot_nexus.md` |
| `samloader_rs` | 116 | Samsung Download mode + samloader-rs ('samloader flash --partition RECOVERY ... --no-reboot'), OEM unlock toggle first, then recovery + adb sideload | `_includes/templates/recovery_install_samloader_rs.md` |
| `fastboot_xiaomi` | 115 | Mi account + Mi Unlock app on Windows (wait period up to 30 days, 4 unlocks/yr), then generic fastboot recovery + sideload | `_includes/templates/recovery_install_fastboot_xiaomi.md` |
| `fastboot_motorola` | 98 | Request unlock code from Motorola, 'fastboot oem unlock <code>', then generic fastboot recovery + sideload | `_includes/templates/recovery_install_fastboot_motorola.md` |
| `fastboot_sony` | 44 | Unlock code from Sony developer site, 'fastboot oem unlock <code>' (pre-2017 devices lose DRM keys/TA), then generic fastboot recovery + sideload | `_includes/templates/recovery_install_fastboot_sony.md` |
| `dd` | 39 | Root stock first (kingroot/custom), then 'dd' recovery image from /sdcard to the recovery partition (_a/_b on A/B), reboot to recovery, sideload | `_includes/templates/recovery_install_dd.md` |
| `fastboot_xiaomi_hyperos` | 23 | As fastboot_xiaomi plus China-HyperOS unlock-permission exam notes (HyperOS device), then generic fastboot recovery + sideload | `_includes/templates/recovery_install_fastboot_xiaomi_hyperos.md` |
| `fastboot_zenfone` | 16 | Asus Zenfone: bootloader must already be unlockable (alert); generic fastboot recovery + sideload | `_includes/templates/recovery_install_fastboot_zenfone.md` |
| `fastboot_unlocked` | 13 | Bootloader already unlocked, no unlock step; then boot to fastboot, flash recovery ('fastboot flash <recovery_partition_name>' or 'fastboot boot' if needs_fastboot_boot), reboot to recovery, adb sideload LineageOS zip | `_includes/templates/recovery_install_fastboot_unlocked.md` |
| `fastboot_custom` | 13 | Vendor-specific unlock guide (device.unlock_bootloader_guide link), then generic fastboot recovery + sideload | `_includes/templates/recovery_install_fastboot_custom.md` |
| `fastboot_lg` | 12 | Bootloader must already be unlockable (alert); generic fastboot recovery + sideload | `_includes/templates/recovery_install_fastboot_lg.md` |
| `apx` | 10 | NVIDIA Tegra RCM/APX mode: Tegraflash flash package from download.lineageos.org (Linux, not in VM), then boot recovery and sideload | `_includes/templates/recovery_install_apx.md` |
| `fastboot_htc` | 10 | 'fastboot oem get_identifier_token' -> HTC dev unlock token -> flash unlock bin, then generic fastboot recovery + sideload | `_includes/templates/recovery_install_fastboot_htc.md` |
| `fastboot_huawei` | 9 | Bootloader must already be unlockable (Huawei no longer issues codes); latest official EMUI advised; generic fastboot recovery + sideload | `_includes/templates/recovery_install_fastboot_huawei.md` |
| `amlogic_update` | 8 | Amlogic Burn Mode via aml-flash-tool: flash aml_install_package.img to eMMC (SD-only not supported) | `_includes/templates/recovery_install_amlogic_update.md` |
| `nintendo` | 8 | Nintendo Switch: exploitable v1 via RCM jig + Hekate, or modded Switch; install to SD card or eMMC from Hekate boot menu (not Android recovery) | `_includes/templates/recovery_install_nintendo.md` |
| `fastboot_oneplus_tmo` | 7 | OnePlus T-Mobile variants: carrier-specific unlock steps (see template) then generic fastboot recovery + sideload | `_includes/templates/recovery_install_fastboot_oneplus_tmo.md` |
| `fastboot_realme` | 6 | Template shows a 'bootloader not unlockable' alert (no unlock steps), then generic fastboot recovery + sideload | `_includes/templates/recovery_install_fastboot_realme.md` |
| `fastboot_nubia` | 6 | Nubia: enable OEM unlock, 'fastboot oem unlock' each bootloader session, then generic fastboot recovery + sideload | `_includes/templates/recovery_install_fastboot_nubia.md` |
| `fastboot_nokia` | 5 | Bootloader must already be unlockable (alert); generic fastboot recovery + sideload | `_includes/templates/recovery_install_fastboot_nokia.md` |
| `fastboot_fairphone` | 5 | Unlock per Fairphone support page, then generic fastboot recovery + sideload | `_includes/templates/recovery_install_fastboot_fairphone.md` |
| `fastboot_lenovo` | 5 | Lenovo ZUI unlock site or 'fastboot oem unlock'/'flash unlock sn.img', then generic fastboot recovery + sideload | `_includes/templates/recovery_install_fastboot_lenovo.md` |
| `fastboot_oppo` | 4 | Oppo unlock via Project Spectrum / unlockable bootloader files, 'fastboot oem unlock', then generic fastboot recovery + sideload | `_includes/templates/recovery_install_fastboot_oppo.md` |
| `fastboot_oplus` | 4 | Chinese OnePlus/Oplus: permission thread then the fastboot_nexus unlock + generic recovery + sideload | `_includes/templates/recovery_install_fastboot_oplus.md` |
| `fastboot_generic` | 3 | Bootloader assumed already unlockable/unlocked (shared tail template); then boot to fastboot, flash recovery ('fastboot flash <recovery_partition_name>' or 'fastboot boot' if needs_fastboot_boot), reboot to recovery, adb sideload LineageOS zip | `_includes/templates/recovery_install_fastboot_generic.md` |
| `fastboot_realme_china` | 3 | Chinese Realme: 'Deep Testing' unlock permission (slots, 7-day validity), 'fastboot flashing unlock', then generic fastboot recovery + sideload | `_includes/templates/recovery_install_fastboot_realme_china.md` |
| `edl_custom` | 2 | Qualcomm EDL (Emergency Download) flashing of a custom recovery with 'edl' tool, then recovery + sideload | `_includes/templates/recovery_install_edl_custom.md` |
| `oor` | 2 | Root stock, dd the aboot/recovery images via su (Oppo/OnePlus 'oor' flow), reboot to recovery, sideload | `_includes/templates/recovery_install_oor.md` |
| `fastboot_zte` | 1 | ZTE: bootloader must already be unlockable (alert); generic fastboot recovery + sideload | `_includes/templates/recovery_install_fastboot_zte.md` |
