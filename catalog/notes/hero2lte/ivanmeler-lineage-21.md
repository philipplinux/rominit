# LineageOS (ivanmeler build) 21.0 · hero2lte

## Status
- Agent-flashed: never. Owner-flashed from the site 2026-10-16 (after the sideload-order fix): boots, probe run q3uydduw; wifi, bluetooth, GPU, sensors, NFC on, hall (SW_LID) work.

## Best path
1. Samsung Android 8 firmware on the phone, OEM unlocking on, USB debugging on.
2. Stage "Install TWRP" (odin, Download Mode), then boot straight into TWRP (Volume Down + Home + Power until black, then Volume Up + Home + Power). A normal boot restores stock recovery.
3. TWRP: Wipe › Format Data, type yes.
4. On the TWRP home screen press Connect sideload: the site sends `twrp sideload` and reconnects in sideload mode (untested on hardware yet). Fallback: Advanced › ADB Sideload, swipe, wait for "waiting for sideload", then reload and connect.

## Pitfalls
- "Socket open failed" on Sideloading = the site connected before ADB Sideload was started (TWRP's normal ADB has no sideload service). Start sideload on the phone first, then connect. Owner, 2026-10-16.
- A browser tab that is connected holds the USB interface; desktop `adb` then gets "Device or resource busy". Close the tab to use adb.

## Agent diary
- 2026-10-16 · Claude Code · owner flashed twice from the site, both stopped at "Socket open failed"; cause: connect before starting ADB Sideload. Site now names the mode (twrp-sideload checks banner state) and the mode text says the order. Zip SHA-256 matches catalog.
- 2026-10-16 · Claude Code · connect('sideload') now switches TWRP into sideload itself (`shell:twrp sideload`, waits up to 45 s for the phone to re-enumerate with the same serial, no second picker). Needs a hardware run.
- 2026-10-16 · Claude Code · owner flash succeeded; probe: screen/touch/audio/camera are human questions, GPS/fingerprint need user action, no SD card/SIM. Added NFC/GPS/hall auto-checks, verified on this phone over adb.
- 2026-10-16 · Claude Code · owner answers (S7 edge, LineageOS 21): screen, touch, audio work; GPS probably not (unconfirmed, no fix seen); modem untested (no SIM).
