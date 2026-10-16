# LineageOS (ivanmeler build) 21.0 · hero2lte

## Status
- Agent-flashed: never

## Best path
1. Samsung Android 8 firmware on the phone, OEM unlocking on, USB debugging on.
2. Stage "Install TWRP" (odin, Download Mode), then boot straight into TWRP (Volume Down + Home + Power until black, then Volume Up + Home + Power). A normal boot restores stock recovery.
3. TWRP: Wipe › Format Data, type yes.
4. TWRP: Advanced › ADB Sideload, swipe, wait for "waiting for sideload". Only then Connect sideload on the site and run.

## Pitfalls
- "Socket open failed" on Sideloading = the site connected before ADB Sideload was started (TWRP's normal ADB has no sideload service). Start sideload on the phone first, then connect. Owner, 2026-10-16.
- A browser tab that is connected holds the USB interface; desktop `adb` then gets "Device or resource busy". Close the tab to use adb.

## Agent diary
- 2026-10-16 · Claude Code · owner flashed twice from the site, both stopped at "Socket open failed"; cause: connect before starting ADB Sideload. Site now names the mode (twrp-sideload checks banner state) and the mode text says the order. Zip SHA-256 matches catalog.
