# Samsung

## Stock firmware
Samsung publishes firmware only through its update server (FUS). These tools download from FUS and decrypt the files on your computer. FUS publishes no SHA-256 checksums, so ROMinit cannot pin stock Samsung firmware yet.

| Tool | Platform | Notes |
|---|---|---|
| [Bifrost](https://github.com/zacharee/Bifrost) | Windows, macOS, Linux, Android | GUI, Kotlin port of samloader; active |
| [Frija](https://github.com/SlackingVeteran/frija) | Windows | GUI, checks CRC and MD5; use the GitHub repo, not frija.org (unofficial site) |
| [samloader](https://github.com/nlscc/samloader) | any (Python) | command line, the original FUS downloader |
| [SamFW](https://samfw.com/) | web | third-party firmware mirror; handy for old Android versions (e.g. the Android 8 bootloader the S7 ROMs need) |

## Flashing tools (Download Mode)
| Tool | Platform | Notes |
|---|---|---|
| ROMinit | browser (WebUSB) | `odin` recipe, built on [libmjolnir](https://github.com/lineageos-infra/libmjolnir) by LineageOS |
| [Heimdall (Grimler fork)](https://git.sr.ht/~grimler/Heimdall) | Linux, macOS, Windows | open source, maintained fork |
| [Heimdall (original)](https://github.com/Benjamin-Dobell/Heimdall) | Linux, macOS, Windows | original project |
| Odin | Windows | Samsung's internal tool, never officially published; copies online are unofficial, take care |

## Recovery and ROMs
- [TWRP for Samsung devices](https://twrp.me/Devices/Samsung/)
- [ivanmeler](https://ivanmeler.github.io/): TWRP and LineageOS for Galaxy S7 / S7 edge
- [postmarketOS: Galaxy S9](https://wiki.postmarketos.org/wiki/Samsung_Galaxy_S9_(samsung-starlte))

## Pitfalls
- **Knox fuse:** unlocking or flashing anything unsigned trips Knox (0x1) for good; Samsung Pay, Secure Folder and some banking apps stop working, even after going back to stock.
- **OEM unlock:** the toggle in Developer options must be on before Download Mode accepts custom images.
- **Recovery gets replaced:** after writing TWRP, boot straight into it (Volume Up + Home/Bixby + Power) before a normal boot, or stock Android restores its own recovery.
