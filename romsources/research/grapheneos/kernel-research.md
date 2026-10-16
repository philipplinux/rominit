# GrapheneOS kernel research

Snapshot: 2026-10-16, release tag `2026100600`.

The official [build guide](https://grapheneos.org/build) lists 21 fully supported smartphone/tablet production targets and gives a per-device kernel build codename. The [tagged platform manifest](https://github.com/GrapheneOS/platform_manifest/blob/2026100600/default.xml) pins 13 corresponding kernel prebuilt projects. Their path suffixes establish Linux 6.1 or 6.6; GrapheneOS describes these as LTS branches in its [source index](https://grapheneos.org/source). The release tag pages for each prebuilt project are linked in [`kernel-research.json`](kernel-research.json), along with the exact pinned commit SHA.

| Device codename | Kernel build codename | Prebuilt project in tag `2026100600` | Kernel branch | Exact point release |
| --- | --- | --- | --- | --- |
| stallion | stallion | `device_google_stallion-kernels_6.1` | 6.1 LTS | Unknown |
| rango | rango | `device_google_laguna-kernels_6.6` | 6.6 LTS | Unknown |
| mustang | muzel | `device_google_laguna-kernels_6.6` | 6.6 LTS | Unknown |
| blazer | muzel | `device_google_laguna-kernels_6.6` | 6.6 LTS | Unknown |
| frankel | muzel | `device_google_laguna-kernels_6.6` | 6.6 LTS | Unknown |
| tegu | tegu | `device_google_tegu-kernels_6.1` | 6.1 LTS | Unknown |
| comet | comet | `device_google_comet-kernels_6.1` | 6.1 LTS | Unknown |
| komodo | caimito | `device_google_caimito-kernels_6.1` | 6.1 LTS | Unknown |
| caiman | caimito | `device_google_caimito-kernels_6.1` | 6.1 LTS | Unknown |
| tokay | caimito | `device_google_caimito-kernels_6.1` | 6.1 LTS | Unknown |
| akita | akita | `device_google_akita-kernels_6.1` | 6.1 LTS | Unknown |
| husky | shusky | `device_google_shusky-kernels_6.1` | 6.1 LTS | Unknown |
| shiba | shusky | `device_google_shusky-kernels_6.1` | 6.1 LTS | Unknown |
| felix | felix | `device_google_felix-kernels_6.1` | 6.1 LTS | Unknown |
| tangorpro | tangorpro | `device_google_tangorpro-kernels_6.1` | 6.1 LTS | Unknown |
| lynx | lynx | `device_google_lynx-kernels_6.1` | 6.1 LTS | Unknown |
| cheetah | pantah | `device_google_pantah-kernels_6.1` | 6.1 LTS | Unknown |
| panther | pantah | `device_google_pantah-kernels_6.1` | 6.1 LTS | Unknown |
| bluejay | bluejay | `device_google_bluejay-kernels_6.1` | 6.1 LTS | Unknown |
| raven | raviole | `device_google_raviole-kernels_6.1` | 6.1 LTS | Unknown |
| oriole | raviole | `device_google_raviole-kernels_6.1` | 6.1 LTS | Unknown |

The prebuilt repository commit pinned by the tag is recorded for each row in `kernel-research.json`. The exact Linux point release is left `null`: the tagged platform manifest does not expose a kernel release string, and the official build/source pages identify the LTS branch and build target but not the point release for this tag. No kernel or factory images were downloaded.

The Pixel 10 group uses the `laguna` 6.6 prebuilt project with kernel build codename `rango` for `rango` and `muzel` for `mustang`, `blazer`, and `frankel`. The Pixel 10a (`stallion`) uses its own 6.1 project. The source-index page describes the `laguna` project for the four Pixel 10 models but omits Pixel 10a; the build guide and pinned manifest cover `stallion` directly.

The build guide's `17` and `17-stallion` strings are source/build workflow branches, not Linux kernel versions. This research uses the release tag's pinned prebuilt commits and the manifest's `6.1`/`6.6` paths to classify the shipped kernel branches.

## Captures

- [`sources/kernel-build-excerpt.md`](sources/kernel-build-excerpt.md): supported target list and official device-to-kernel build-codename mappings.
- [`sources/kernel-source-excerpt.md`](sources/kernel-source-excerpt.md): official prebuilt project descriptions and Linux LTS branch descriptions.
- [`sources/kernel-tag-projects.json`](sources/kernel-tag-projects.json): kernel prebuilt project paths and commit pins selected from the tag manifest.
