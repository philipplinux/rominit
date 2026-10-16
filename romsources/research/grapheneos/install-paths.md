# GrapheneOS install paths

Install-path snapshot checked 2026-10-16. GrapheneOS documents two official methods: its WebUSB installer for most users and a command-line factory-image flow for technical users. Both end by relocking the bootloader; the official guides advise following their sequence without skipping or reordering steps. ([Install overview](https://grapheneos.org/install/), [web installer](https://grapheneos.org/install/web), [CLI guide](https://grapheneos.org/install/cli))

## WebUSB installer

The installer runs in a supported browser with WebUSB and connects directly to the Pixel in bootloader fastboot mode. It downloads the official factory ZIP from `releases.grapheneos.org`; the browser page and fastboot protocol implementation are published in the [official website repository](https://github.com/GrapheneOS/grapheneos.org/blob/81a53ee386cfa5c431e3e4c8088d7f9c581b5c69/static/js/web-install.js). The documented supported browser list includes Chromium (except Ubuntu's broken Snap build), Vanadium, Chrome, Edge and Brave with Shields disabled; incognito/private mode and virtual machines are discouraged. ([Web installer prerequisites](https://grapheneos.org/install/web#prerequisites))

The published WebUSB page source resolves the stable release and fetches the ZIP over HTTPS; it does not visibly fetch the detached `.sig` or `allowed_signers` used by the CLI guide. This is a source-code observation, not a statement that the WebUSB flow performs no other archive checks; GrapheneOS recommends comparing the installed verified-boot key hash to its published key list. ([Web installer source](https://github.com/GrapheneOS/grapheneos.org/blob/81a53ee386cfa5c431e3e4c8088d7f9c581b5c69/static/js/web-install.js), [CLI signature verification](https://grapheneos.org/install/cli#obtaining-factory-images), [key-hash check](https://grapheneos.org/install/web#verified-boot-key-hash))

1. On stock Android, enable Developer options by tapping **Build number** repeatedly in **Settings > About phone/tablet**, then enable **OEM unlocking** in **Settings > System > Developer options**. Carrier SKUs may need internet access for this toggle to check carrier unlock policy. ([OEM unlocking](https://grapheneos.org/install/web#enabling-oem-unlocking))
2. Boot to the bootloader by holding **Volume down** while rebooting; leave the device at the **Fastboot Mode** screen and connect it directly to the computer. ([Bootloader and USB steps](https://grapheneos.org/install/web#booting-into-the-bootloader-interface), [connecting](https://grapheneos.org/install/web#connecting-the-device))
3. Select **Unlock bootloader** in the installer and accept the on-device prompt. The published installer checks `unlocked` first and issues the fastboot `flashing unlock` command when needed; unlocking erases user data. ([Installer source](https://github.com/GrapheneOS/grapheneos.org/blob/81a53ee386cfa5c431e3e4c8088d7f9c581b5c69/static/js/web-install.js), [unlocking](https://grapheneos.org/install/web#unlocking-the-bootloader))
4. Select **Download release**. The published page reads the fastboot `product`, requests `https://releases.grapheneos.org/<codename>-stable`, and downloads the matching `<codename>-install-<version>.zip` into browser storage. This is the stable channel path. ([Installer source](https://github.com/GrapheneOS/grapheneos.org/blob/81a53ee386cfa5c431e3e4c8088d7f9c581b5c69/static/js/web-install.js), [release files](https://grapheneos.org/releases))
5. Select **Flash release** and leave the device connected and undisturbed. The page checks `snapshot-update-status` and, if a snapshot OTA is pending, calls `device.runCommand("snapshot-update:cancel")`; it then flashes the factory ZIP through `device.flashFactoryZip(blob, true, reconnectCallback, progressCallback)`. The documented flow flashes firmware, reboots to the bootloader as needed, and flashes the OS. Browser prompts may be needed to reconnect after reboots. ([Installer source](https://github.com/GrapheneOS/grapheneos.org/blob/81a53ee386cfa5c431e3e4c8088d7f9c581b5c69/static/js/web-install.js), [flashing factory images](https://grapheneos.org/install/web#flashing-factory-images))
6. Select **Lock bootloader**, accept the on-device prompt, then boot and complete setup. The installer issues `flashing lock`; locking enables verified boot and wipes data again. Disable OEM unlocking from the final setup screen, as the guide recommends. ([Installer source](https://github.com/GrapheneOS/grapheneos.org/blob/81a53ee386cfa5c431e3e4c8088d7f9c581b5c69/static/js/web-install.js), [locking](https://grapheneos.org/install/web#locking-the-bootloader), [post-installation](https://grapheneos.org/install/web#disabling-oem-unlocking))

The page also exposes an **Erase custom AVB key** operation for returning a device to stock; it is not part of a GrapheneOS install. ([Installer source](https://github.com/GrapheneOS/grapheneos.org/blob/81a53ee386cfa5c431e3e4c8088d7f9c581b5c69/static/js/web-install.js), [returning to stock](https://grapheneos.org/install/web#replacing-grapheneos-with-the-stock-os))

## Command-line factory-image install

The official CLI guide requires an updated `fastboot` version 35.0.1 or newer, OpenSSH for signature verification, and at least 32 GB free storage. On Linux, non-root USB access needs the documented udev package; the guide specifically warns that `fwupd` can claim fastboot USB devices. ([CLI prerequisites and fastboot](https://grapheneos.org/install/cli#prerequisites), [USB permissions](https://grapheneos.org/install/cli#flashing-as-non-root), [fwupd workaround](https://grapheneos.org/install/cli#working-around-fwupd-bugs-on-linux-distributions))

1. Enable OEM unlocking in stock Android, then boot to the bootloader with **Volume down** held during reboot. ([CLI OEM unlocking](https://grapheneos.org/install/cli#enabling-oem-unlocking), [bootloader](https://grapheneos.org/install/cli#booting-into-the-bootloader-interface))
2. Unlock with `fastboot flashing unlock`; accept the on-device prompt. This wipes data. ([CLI unlocking](https://grapheneos.org/install/cli#unlocking-the-bootloader))
3. Obtain the device's factory ZIP and matching `.sig` from the official release service, plus `allowed_signers`. Verify the detached signature with OpenSSH using identity `contact@grapheneos.org` and namespace `factory images` before extraction. ([CLI factory-image verification](https://grapheneos.org/install/cli#obtaining-factory-images), [official signer file](https://releases.grapheneos.org/allowed_signers))

The guide's documented commands (replace `DEVICE_NAME` and `VERSION` with the release filename values) are:

```sh
curl -O https://releases.grapheneos.org/allowed_signers
curl -O https://releases.grapheneos.org/DEVICE_NAME-install-VERSION.zip
curl -O https://releases.grapheneos.org/DEVICE_NAME-install-VERSION.zip.sig
ssh-keygen -Y verify -f allowed_signers -I contact@grapheneos.org -n "factory images" -s DEVICE_NAME-install-VERSION.zip.sig < DEVICE_NAME-install-VERSION.zip
```

On Windows, the guide uses this command so input redirection is handled by `cmd.exe`:

```powershell
cmd /c 'ssh-keygen -Y verify -f allowed_signers -I contact@grapheneos.org -n "factory images" -s DEVICE_NAME-install-VERSION.zip.sig < DEVICE_NAME-install-VERSION.zip'
```

([CLI factory-image verification](https://grapheneos.org/install/cli#obtaining-factory-images))

4. Extract the ZIP with `bsdtar xvf DEVICE_NAME-install-VERSION.zip` on Linux, or `tar xvf DEVICE_NAME-install-VERSION.zip` on macOS/Windows. Enter the extracted `DEVICE_NAME-install-VERSION` directory and run `bash flash-all.sh` on Linux/macOS or `./flash-all.bat` on Windows. The official script handles firmware flashing, rebooting into the bootloader and flashing the OS; wait for it to finish. ([CLI flashing](https://grapheneos.org/install/cli#flashing-factory-images))
5. Run `fastboot flashing lock` and accept the on-device prompt. Locking wipes data and enables verified boot; boot the OS and disable OEM unlocking during setup. ([CLI locking](https://grapheneos.org/install/cli#locking-the-bootloader), [post-installation](https://grapheneos.org/install/cli#disabling-oem-unlocking))

## Verified-boot key fingerprints

These are the device-specific SHA-256 fingerprints published by GrapheneOS for the current supported Pixels. The same values are also published in the [attestation key list](https://grapheneos.org/attestation.json), with its detached [OpenSSH signature](https://grapheneos.org/attestation.json.sig), and in the [install guide](https://grapheneos.org/install/web#verified-boot-key-hash). The codename mapping follows the official [supported-device list](https://grapheneos.org/faq#supported-devices). This pipe-delimited table is kept simple for importing into `devices.json`.

| Codename | Marketing name | Verified-boot SHA-256 | Source |
|---|---|---|---|
| `stallion` | Pixel 10a | `d8f879d10419eddc9fcda6280718be763f6bf12299e1f72df3ea8ad8a8eb7f80` | https://grapheneos.org/install/web#verified-boot-key-hash |
| `rango` | Pixel 10 Pro Fold | `55a2d44103e56d5ec65496399c417987ba77730e6488fc60ba058d09fc3caee3` | https://grapheneos.org/install/web#verified-boot-key-hash |
| `mustang` | Pixel 10 Pro XL | `141d7fc32af7958a416f2661b37cf6f27bfb376fb5ce616aeaa27a82c7a04f74` | https://grapheneos.org/install/web#verified-boot-key-hash |
| `blazer` | Pixel 10 Pro | `4e8ee8f717754052198ca6d2d3aaa232e2461b4293c0d6f297e519cc778de093` | https://grapheneos.org/install/web#verified-boot-key-hash |
| `frankel` | Pixel 10 | `3f7415ea26f5df5b14ea6d153256071a7a1af9ce7b0970b7311cc463c7ea02c7` | https://grapheneos.org/install/web#verified-boot-key-hash |
| `tegu` | Pixel 9a | `0508de44ee00bfb49ece32c418af1896391abde0f05b64f41bc9a2dfb589445b` | https://grapheneos.org/install/web#verified-boot-key-hash |
| `comet` | Pixel 9 Pro Fold | `af4d2c6e62be0fec54f0271b9776ff061dd8392d9f51cf6ab1551d346679e24c` | https://grapheneos.org/install/web#verified-boot-key-hash |
| `komodo` | Pixel 9 Pro XL | `55d3c2323db91bb91f20d38d015e85112d038f6b6b5738fe352c1a80dba57023` | https://grapheneos.org/install/web#verified-boot-key-hash |
| `caiman` | Pixel 9 Pro | `f729cab861da1b83fdfab402fc9480758f2ae78ee0b61c1f2137dd1ab7076e86` | https://grapheneos.org/install/web#verified-boot-key-hash |
| `tokay` | Pixel 9 | `9e6a8f3e0d761a780179f93acd5721ba1ab7c8c537c7761073c0a754b0e932de` | https://grapheneos.org/install/web#verified-boot-key-hash |
| `akita` | Pixel 8a | `096b8bd6d44527a24ac1564b308839f67e78202185cbff9cfdcb10e63250bc5e` | https://grapheneos.org/install/web#verified-boot-key-hash |
| `husky` | Pixel 8 Pro | `896db2d09d84e1d6bb747002b8a114950b946e5825772a9d48ba7eb01d118c1c` | https://grapheneos.org/install/web#verified-boot-key-hash |
| `shiba` | Pixel 8 | `cd7479653aa88208f9f03034810ef9b7b0af8a9d41e2000e458ac403a2acb233` | https://grapheneos.org/install/web#verified-boot-key-hash |
| `felix` | Pixel Fold | `ee0c9dfef6f55a878538b0dbf7e78e3bc3f1a13c8c44839b095fe26dd5fe2842` | https://grapheneos.org/install/web#verified-boot-key-hash |
| `tangorpro` | Pixel Tablet | `94df136e6c6aa08dc26580af46f36419b5f9baf46039db076f5295b91aaff230` | https://grapheneos.org/install/web#verified-boot-key-hash |
| `lynx` | Pixel 7a | `508d75dea10c5cbc3e7632260fc0b59f6055a8a49dd84e693b6d8899edbb01e4` | https://grapheneos.org/install/web#verified-boot-key-hash |
| `cheetah` | Pixel 7 Pro | `bc1c0dd95664604382bb888412026422742eb333071ea0b2d19036217d49182f` | https://grapheneos.org/install/web#verified-boot-key-hash |
| `panther` | Pixel 7 | `3efe5392be3ac38afb894d13de639e521675e62571a8a9b3ef9fc8c44fd17fa1` | https://grapheneos.org/install/web#verified-boot-key-hash |
| `bluejay` | Pixel 6a | `08c860350a9600692d10c8512f7b8e80707757468e8fbfeea2a870c0a83d6031` | https://grapheneos.org/install/web#verified-boot-key-hash |
| `raven` | Pixel 6 Pro | `439b76524d94c40652ce1bf0d8243773c634d2f99ba3160d8d02aa5e29ff925c` | https://grapheneos.org/install/web#verified-boot-key-hash |
| `oriole` | Pixel 6 | `f0a890375d1405e62ebfd87e8d3f475f948ef031bbf9ddd516d5f600a23677e8` | https://grapheneos.org/install/web#verified-boot-key-hash |

4th- and 5th-generation Pixels show only the first 32 bits of the alternate-OS key hash, according to GrapheneOS; they are end-of-life and are not included in the current supported list. ([Key-hash note](https://grapheneos.org/install/web#verified-boot-key-hash), [supported devices](https://grapheneos.org/faq#supported-devices))

After installation, compare the yellow boot warning's displayed key hash against the exact device row above; GrapheneOS says this manual comparison is useful, while verified boot enforcement itself does not depend on the user doing it. For an independent hardware-backed check, Auditor uses a second Android device for local QR verification, with an optional monitoring service also available. ([Fingerprint check](https://grapheneos.org/install/web#verified-boot-key-hash), [Auditor verification](https://grapheneos.org/install/web#hardware-based-attestation))

## Fit for ROMinit

ROMinit's current `fastboot` recipe has only `flash`, `erase`, `set_active` and `reboot` steps; it checks product, unlocked state, hashes, partition sizes and logical-partition status. `fastboot-tgz` adds anti-rollback checking for a vendor `.tgz` archive and then uses the same flash steps. These are useful protocol and safety primitives, but neither describes GrapheneOS's signed factory ZIP, firmware/update/reconnect sequence, custom AVB key handling, or bootloader unlock and relock. ([ROMinit `fastboot.js`](../../../src/recipes/fastboot.js), [ROMinit `fastboot-tgz.js`](../../../src/recipes/fastboot-tgz.js), [ROMinit catalog recipe map](../../../src/catalog.js))

Recommended fit for each currently supported codename: a dedicated factory-ZIP recipe using the existing fastboot/WebUSB protocol, with the device codename/product and release artifact pinned as catalog data. The recipe would need an explicit human-confirmed unlock and relock path, handle the official per-device firmware and factory image sequence including reconnects, and preserve fail-closed model/hash checks. A single recipe can serve all supported devices; only product, files and published key fingerprint vary by codename. ([GrapheneOS CLI flow](https://grapheneos.org/install/cli), [GrapheneOS web flow](https://grapheneos.org/install/web), [ROMinit recipe architecture](../../../README.md))

The ROMinit catalog has typed `confirm` support for destructive stages, but current fastboot verbs do not implement the two `fastboot flashing` operations or the factory-ZIP workflow. A person must provide the confirmation phrase for destructive stages; an agent must not supply it. ([ROMinit `README.md`](../../../README.md), [ROMinit `fastboot.js`](../../../src/recipes/fastboot.js))
