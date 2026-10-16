---
url: https://grapheneos.org/features
title: Features overview
words: 10954
---
# Features overview

GrapheneOS is a private and secure mobile operating system with great functionality and usability. It starts from the strong baseline of the [Android Open Source Project (AOSP)](https://source.android.com/) and takes great care to avoid increasing attack surface or hurting the strong security model. GrapheneOS makes substantial improvements to both privacy and security through many carefully designed features built to function against real adversaries. The project cares a lot about usability and app compatibility so those are taken into account for all of our features.

GrapheneOS is focused on substance rather than branding and marketing. It doesn't take the typical approach of piling on a bunch of insecure features depending on the adversaries not knowing about them and regressing actual privacy/security. It's a very technical project building privacy and security into the OS rather than including assorted unhelpful frills or bundling subjective third party apps choices.

GrapheneOS is also hard at work on filling in gaps from not bundling Google apps and services into the OS. We aren't against users using Google services but it doesn't belong integrated into the OS in an invasive way. GrapheneOS won't take the shortcut of simply bundling a very incomplete and poorly secured third party reimplementation of Google services into the OS. That wouldn't ever be something users could rely upon. It will also always be chasing a moving target while offering poorer security than the real thing if the focus is on simply getting things working without great care for doing it robustly and securely.

This page provides an overview of currently implemented features differentiating GrapheneOS from AOSP. It doesn't document our many historical features that are no longer included for one reason or another. Many of our features were implemented in AOSP, Linux, [LLVM](https://llvm.org/) and other projects GrapheneOS is based on and those aren't listed here. In many cases, we've been involved in getting those features implemented in core infrastructure projects.

## GrapheneOS

These are the features of GrapheneOS beyond what's provided by version 16 of the Android Open Source Project. It only covers our improvements to AOSP and not baseline features. This section doesn't list features like the standard app sandbox, verified boot, exploit mitigations (ASLR, SSP, Shadow Call Stack, Control Flow Integrity, etc.), permission system (foreground-only and one-time permission grants, scoped file access control, etc.) and so on but rather only our improvements to modern Android. We plan on providing a separate page listing the improvements we've contributed to Android since those features aren't listed here despite being a substantial portion of our overall historical work.

### Defending against exploitation of unknown vulnerabilities

GrapheneOS is heavily focused on protecting users against attackers exploiting unknown (0 day) vulnerabilities. Patching vulnerabilities doesn't protect users before the vulnerability is known to the vendor and has a patch developed and shipped.

Unknown (0 day) vulnerabilities are much more widely used than most realize to exploit users not just in targeted attacks but in broad deployments. Project Zero maintains [a spreadsheet](https://docs.google.com/spreadsheets/d/1lkNJ0uQwbeC1ZTRrxdtuPLCIl7mlUreoKfSIgajnSyY/view#gid=0) tracking zero day exploitation detected in the wild. This is only a peek into what's happening since it only documents cases where the attackers were caught exploiting users, often because the attacks are not targeted but rather deployed on public websites, etc.

The first line of defense is attack surface reduction. Removing unnecessary code or exposed attack surface eliminates many vulnerabilities completely. GrapheneOS avoids removing any useful functionality for end users, but we can still disable lots of functionality by default and require that users opt-in to using it to eliminate it for most of them. An example we landed upstream in Android is disallowing using the kernel's profiling support by default, since it was and still is a major source of Linux kernel vulnerabilities. Profiling is now only exposed to apps for developers who enable developer tools, enable the Android Debug Bridge (ADB) and then use profiling tools via ADB. It's also only enabled until the next boot. This isn't listed below since it's one of the features we got implemented in Android itself.

The next line of defense is preventing an attacker from exploiting a vulnerability, either by making it impossible, unreliable or at least meaningfully harder to develop. The vast majority of vulnerabilities are well understood classes of bugs and exploitation can be prevented by avoiding the bugs via languages/tooling or preventing exploitation with strong exploit mitigations. In many cases, vulnerability classes can be completely wiped out while in many others they can at least be made meaningfully harder to exploit. Android does a lot of work in this area, and GrapheneOS has helped to advance this in Android and the Linux kernel. It takes an enormous amount of resources to develop fundamental fixes for these problems and there's often a high performance, memory or compatibility cost to deploying them. Mainstream operating systems usually don't prioritize security over other areas. GrapheneOS is willing to go further, thus we offer toggles for users to choose the compromises they prefer instead of forcing it on them. In the meantime, weaker less complete exploit mitigations can still provide meaningful barriers against attacks as long as they're developed with a clear threat model. GrapheneOS is heavily invested in many areas of developing these protections: developing/deploying memory safe languages/libraries, static/dynamic analysis tooling and many kinds of mitigations.

The final line of defense is containment through sandboxing at various levels: fine-grained sandboxes around a specific context like per site browser renderers, sandboxes around a specific component like Android's media codec sandbox and app/workspace sandboxes like the Android app sandbox used to sandbox each app which is also the basis for user/work profiles. GrapheneOS improves all of these sandboxes through fortifying the kernel and other base OS components along with improving the sandboxing policies.

Preventing an attacker from persisting their control of a component or the OS/firmware through verified boot and avoiding trust in persistent state also helps to mitigate the damage after a compromise has occurred.

Remote code execution vulnerabilities are the most serious and allow an attacker to gain a foothold on the device or even substantial control over it remotely. Local code execution vulnerabilities allow breaking out of a sandbox including the app sandbox or browser renderer sandbox after either compromising an app/browser renderer remotely, compromising an app's supply chain or getting the user to install a malicious app. Many other kinds of vulnerabilities exist but most of what we're protecting against falls into these two broad categories.

The vast majority of local and remote code execution vulnerabilities are memory corruption bugs caused by memory unsafe languages or rare low-level unsafe code in an otherwise memory safe language. Most of the remaining issues are caused by dynamic code execution/loading features. Our main focus is on preventing or raising the difficulty of exploiting memory corruption bugs followed by restricting dynamic code execution both to make escalation from a memory corruption bug harder and to directly mitigate bugs caused by dynamic code loading/generation/execution such as a JIT compiler bug or a plugin loading vulnerability.

#### Attack surface reduction

- Greatly reduced remote, local and proximity-based attack surface by stripping out unnecessary code, making more features optional and disabling optional features by default (NFC, Bluetooth, UWB, etc.), when the screen is locked (USB, USB-C, pogo pins, camera access) and optionally after a timeout (Bluetooth, Wi-Fi).
- Native debugging (ptrace) access is blocked for all bundled apps to reduce local attack surface. ptrace access is allowed by default for user installed apps for compatibility, with an option to block it by default. In both cases, ptrace access can be blocked or allowed manually on a per-app basis. When an app that is blocked from accessing ptrace tries to use it, GrapheneOS shows a notification that links the per-app native debugging settings screen.

##### USB-C port and pogo pins control

Our **USB-C port and pogo pins** setting protects against attacks through USB-C or pogo pins while the OS is booted. For the majority of devices without pogo pins, the setting is labelled **USB-C port**.

The feature has five modes:

- Off
- Charging-only
- Charging-only when locked
- Charging-only when locked, except before first unlock
- On

The default is **Charging-only when locked**, which significantly reduces attack surface when the device is locked. After locking, it blocks any new USB connections immediately through either USB-C and pogo pins at both the hardware level via configuring the USB controller and also at the OS level in the kernel to provide a second layer of defense. It disables the data lines at a hardware level as soon as the existing connections end which happens right away if there were no USB connections. It also disables USB-C alternate modes including DisplayPort at both the OS and hardware level.

Our implementation is far more secure than Android's standard USB HAL toggle available to device admin apps. The standard feature only disables high level USB handling in the OS. It doesn't block new USB connections or disable the data lines at a hardware level. It also leaves the handling of the USB-C and pogo pins protocols enabled in the OS, and it doesn't disable the USB-C alternate modes. The standard feature is also either blocking or not blocking USB at a high level, without the ability to block new connections and disable USB only once the existing connections end. Other operating systems trying to implement a similar feature via the standard toggle end up continuing to allow new USB connections in the OS until all connections end instead of the two-phase approach we use for our two Charging-only when locked modes.

The highest security **Off** mode disables charging in addition to data to remove the remaining attack surface from the USB controller and OS supporting charging including the USB-PD protocol. There's no risk of the device not being able to be charged since the overall feature doesn't apply while the device is powered off, booted into the firmware-based fastboot mode or the charging, recovery and fastbootd modes.

#### Exploit mitigations

- Hardened app runtime
- [Secure application spawning system](https://grapheneos.org/usage#exec-spawning) avoiding sharing address space layout and other secrets across applications
- [Hardened libc](https://github.com/GrapheneOS/platform_bionic) providing defenses against the most common classes of vulnerabilities (memory corruption)
- Our own [hardened malloc (memory allocator)](https://github.com/GrapheneOS/hardened_malloc) leveraging modern hardware capabilities to provide substantial defenses against the most common classes of vulnerabilities (heap memory corruption) along with reducing the lifetime of sensitive data in memory. The [hardened\_malloc README](https://github.com/GrapheneOS/hardened_malloc/blob/main/README.md) has extensive documentation on it. The hardened\_malloc project is portable to other Linux-based operating systems and is being adopted by other security-focused operating systems like secureblue. Our allocator also heavily influenced the design of the [next-generation musl malloc implementation](https://www.openwall.com/lists/musl/2020/05/13/1) which offers substantially better security than musl's previous malloc while still having minimal memory usage and code size.

  - Fully out-of-line metadata with protection from corruption, ruling out traditional allocator exploitation
  - Separate memory regions for metadata, large allocations and each slab allocation size class with high entropy random bases and no address space reuse between the different regions
  - Deterministic detection of any invalid free
  - Zero-on-free with detection of write-after-free via checking that memory is still zeroed before handing it out again
  - Delayed reuse of address space and memory allocations through the combination of deterministic and randomized quarantines to mitigate use-after-free vulnerabilities
  - Fine-grained randomization
  - Aggressive consistency checks
  - Memory protected guard regions around allocations larger than 16k with randomization of guard region sizes for 128k and above
  - Allocations smaller than 16k have guard regions around each of the slabs containing allocations (for example, 16 byte allocations are in 4096 byte slabs with 4096 byte guard regions before and after)
  - Random canaries with a leading zero are added to these smaller allocations to block C string overflows, absorb small overflows and detect linear overflows or other heap corruption when the canary value is checked (primarily on free)
  - Hardware memory tagging for slab allocations (128k and below) providing probabilistic detection of all use-after-free and inter-object overflows along with deterministic detection of all small/linear overflows and use-after-free until it has been reused once and gone through the quarantines twice
- On ARMv9, Branch Target Identification (BTI) and Pointer Authentication Code (PAC) return address protection are enabled for userspace OS code we build instead of only specific apps
- Signed integer overflow is made well defined in C and C++ for code where automatic overflow checking is disabled
- Hardened kernel

  - 4-level page tables are enabled on arm64 to provide a much larger address space (48-bit instead of 39-bit) with significantly higher entropy Address Space Layout Randomization (33-bit instead of 24-bit).
  - Basic hardware memory tagging is used in the main kernel memory allocators (slab, page\_alloc, non-executable vmalloc) to provide probabilistic detection of all use-after-free and inter-object overflows along with deterministic detection of use-after-free until the memory is allocated again (we plan to add deterministic detection of small/linear overflows like hardened\_malloc)
  - Random canaries with a leading zero are added to the kernel heap (slub) to block C string overflows, absorb small overflows and detect linear overflows or other heap corruption when the canary value is checked (on free, copies to/from userspace, etc.).
  - Memory is wiped (zeroed) as soon as it's released in both the low-level kernel page allocator and higher level kernel heap allocator (slub). This substantially reduces the lifetime of sensitive data in memory, mitigates use-after-free vulnerabilities and makes most uninitialized data usage vulnerabilities harmless. Without our changes, memory that's released retains data indefinitely until the memory is handed out for other uses and gets partially or fully overwritten by new data.
  - In early boot, all the memory not being used by the OS is zeroed to get rid of any data leftover from a previous boot in case zero-on-free didn't have the opportunity to clear it as part of a clean reboot/shutdown. All the devices we support have a reset attack protection feature we proposed zeroing memory for firmware-based boot modes, but we need to finish it up by adding it for the OS boot modes ourselves. Fully encrypted RAM with a per-boot key cycled on reboots will eventually obsolete these features for newer devices.
  - Kernel stack allocations are zeroed to make most uninitialized data usage vulnerabilities harmless.
  - Assorted attack surface reduction through disabling features or setting up infrastructure to dynamically enable/disable them only as needed (perf, ptrace).
  - Assorted upstream hardening features are enabled, including many which we played a part in developing and landing upstream as part of our linux-hardened project (which we intend to revive as a more active project again).
  - Forced kernel module signing with per-build RSA 4096 and SHA256 keys, and lockdown mode set to forced confidentiality mode, help to enforce a low-level boundary between the kernel and userspace even if mistakes are made in SELinux policy or there's a deep userspace compromise.
  - Additional consistency/integrity checks are enabled for frequently targeted kernel data structures.
  - On ARMv9, Branch Target Identification (BTI) is enabled in addition to Clang type-based Control Flow Integrity (CFI) to cover functions excluded from type-based CFI
  - On ARMv9, ShadowCallStack (SCS) is enabled in addition to Pointer Authentication Code (PAC) return address protection instead of only enabling SCS when PAC is unavailable
- Android Runtime Just-In-Time (JIT) compilation/profiling is fully disabled and replaced with full ahead-of-time (AOT) compilation. The only JIT compilation in the base OS is the V8 JavaScript JIT which is disabled by default for the Vanadium browser with per-site exception support.
- Dynamic code loading for both native code or Java/Kotlin classes is blocked for nearly the entire base OS. This works alongside verified boot to prevent base OS processes from running attacker controlled native code or Java/Kotlin code. The only exceptions from the policy for the base OS are in-memory code loading for the media DRM sandbox and the Vanadium JIT compiler being permitted. Vanadium has JIT compilation disabled by default for every site and for apps using the WebView with the exception of our PDF Viewer app. Vanadium disables the JIT compiler by default with a per-site and per-app toggle for it and per-process enforcement of blocking dynamic code loading implemented with seccomp-bpf based on the per-site/per-app JIT compiler toggle.
- Dynamic code loading for both native code or Java/Kotlin classes can be disabled for user installed apps via 3 exploit protection toggles: Dynamic code loading from memory, Dynamic code loading from storage and WebView JIT. This can also be used to opt-out of the WebView JIT for our PDF Viewer and dynamic code loading from memory for the Vanadium browser to disable support for the per-site opt-in to JIT compilation. In order to make the dynamic code loading toggles more usable, we show a user facing notification when an app has dynamic code loading from memory or storage blocked, including a file path being shown when it's blocked from storage. This allows users to disable it for all their apps and then enable them for the ones requiring it.
- Filesystem access hardening

#### Improved sandboxing

GrapheneOS improves the app sandbox through hardening SELinux policy and seccomp-bpf policy along with all the hardening to components like kernel implementing the app sandbox and providing a path for the attacker to escape it if they can exploit those components. We primarily focus on the app sandbox, but we also improve the other sandboxes including making direct improvements to the web browser renderer sandbox used for both the default browser and WebView rendering engine provided by the OS and used by a huge number of other apps from dedicated browsers to messaging apps.

#### Anti-persistence and detection

- Enhanced [verified boot](https://source.android.com/docs/security/features/verifiedboot) with better security properties and reduced attack surface
- GrapheneOS finishes the incomplete implementation of verified boot for out-of-band updates to packages (APKs) in the OS. We enforce this by requiring fs-verity metadata signed with a trusted key for system app updates both at install time and boot time. This provides continuous verification where every read from an out-of-band APK update is verified similarly to every read from a firmware, OS image or APEX update being verified. The signing key and version are enforced to prevent downgrades or other attacks such as replacing a package with a variant of the same one from a different GrapheneOS supported device. We disable the persistent package parsing cache to prevent bypassing the metadata checks through this otherwise highly persistent state, which only has a very small negative impact on boot time from the data not being available from previous boots (typically less than 1 second).
- GrapheneOS closes a loophole where app-based system components built as part of the OS can be downgraded to an older version due to versionCode not being incremented when system components get updated as part of changes to the OS. We enforce this both at package install time and boot time.
- Enhanced hardware-based attestation with more precise version information
- Hardware-based security verification and monitoring via our [Auditor app and attestation service](https://grapheneos.org/features#auditor)
- Compressed APEX module support is disabled as it's not useful for GrapheneOS, uses extra unnecessary storage space and adds more verified boot attack surface.

### More complete patching

GrapheneOS includes fixes for a large number of vulnerabilities not yet fixed in Android.

We're able to quickly and safely ship the latest Linux kernel LTS point releases on devices with GKI (Generic Kernel Image) support including the 6th and 7th generation Pixel phones. At the time of writing on 2023-11-06, GrapheneOS is using the latest Linux 5.10 GKI LTS release (5.10.199) for 6th and 7th generation Pixel phones. The stock Pixel OS is on Linux 5.10.157 from 2022-12-02 with a small number of additional patches backported. This means GrapheneOS provides hundreds of relevant kernel patches including many security patches not yet included in the stock OS. It's possible for us to stay several months ahead due to their approach of moving to new LTS releases only in quarterly releases after a long freeze and testing process.

We often find new vulnerabilities ourselves and report them upstream. We've reported dozens of vulnerabilities for both the generic Android codebase and also for Pixels specifically. We also often find missed patches which were supposed to be included but were missed, especially when there are device specific components with partially shared but separate codebases for different devices.

Our overall approach is to focus on systemic privacy and security improvements but fixing individual vulnerabilities is still very important.

### Sandboxed Google Play

GrapheneOS has a compatibility layer providing the option to install and use the official releases of Google Play in the standard app sandbox. Google Play receives absolutely no special access or privileges on GrapheneOS as opposed to bypassing the app sandbox and receiving a massive amount of highly privileged access. Instead, the compatibility layer teaches it how to work within the full app sandbox. It also isn't used as a backend for the OS services as it would be elsewhere since GrapheneOS doesn't use Google Play even when it's installed.

Since the Google Play apps are simply regular apps on GrapheneOS, you install them within a specific user or work profile and they're only available within that profile. Only apps within the same profile can use it, and they need to explicitly choose to use it. It works the same way as any other app and has no special capabilities. As with any other app, it can't access data of other apps and requires explicit user consent to gain access to profile data or the standard permissions. Apps within the same profile can communicate with mutual consent and it's no different for sandboxed Google Play.

Sandboxed Google Play is close to being fully functional and provides near complete compatibility with the app ecosystem depending on Google Play. Only a small subset of privileged functionality which we haven't yet ported to different approaches with our compatibility layer is unavailable. Some functionality is inherently privileged and can't be provided as part of the compatibility layer.

The vast majority of Play services functionality works perfectly including dynamically downloaded/updated modules (dynamite modules) and functionality provided by modular app components such as Google Play Games. By default, location requests are rerouted to a reimplementation of the Play geolocation service provided by GrapheneOS. You can disable rerouting and use the standard Play services geolocation service instead if you want the Google network location service and related features.

Our compatibility layer includes full support for the Play Store. Play Store services are fully available including in-app purchases, Play Asset Delivery, Play Feature Delivery and app/content license checks. It can install, update and uninstall apps with the standard approach requiring that the user authorizes it as an app source and consents to each action. It will use the standard Android 12+ unattended update feature to do automatic updates for apps where it was the last installer.

See the [usage guide section on sandboxed Google Play](https://grapheneos.org/usage#sandboxed-google-play-installation) for instructions.

### Android Auto

GrapheneOS provides an option to install and use the official releases of Android Auto.

Android Auto requires privileged access in order to work. GrapheneOS uses an extension of the sandboxed Google Play compatibility layer to make Android Auto work with a reduced level of privileges.

For more details, see the [usage guide section on Android Auto](https://grapheneos.org/usage#android-auto).

### Network permission toggle

GrapheneOS adds a Network permission toggle for disallowing both direct and indirect access to any of the available networks. The device-local network (localhost) is also guarded by this permission, which is important for preventing apps from using it to communicate between profiles. Unlike a firewall-based implementation, the Network permission toggle prevents apps from using the network via APIs provided by the OS or other apps in the same profile as long as they're marked appropriately.

The standard INTERNET permission used as the basis for the Network permission toggle is enhanced with a second layer of enforcement and proper support for granting/revoking it on a per-profile basis.

To avoid breaking compatibility with Android apps, the added permission toggle is enabled by default. However, the OS app installation UI has been extended to show the toggle as part of the installation confirmation page so users can disable it when installing an app.

When the Network permission is disabled, GrapheneOS pretends the network is down. It shows the network as down in various APIs, returns errors showing a network connectivity issue rather than a revoked permission and avoids running scheduled jobs depending on the network. This results in apps handling it as if the network is down rather than crashing or showing errors from trying to use the network and being unable to do it.

### Sensors permission toggle

Sensors permission toggle: disallow access to all other sensors not covered by existing Android permissions (Camera, Microphone, Body Sensors, Activity Recognition) including an accelerometer, gyroscope, compass, barometer, thermometer and any other sensors present on a given device. When access is disabled, apps receive zeroed data when they check for sensor values and don't receive events. GrapheneOS creates an easy-to-disable notification when apps try to access sensors blocked by the permission being denied. This makes the feature more usable since users can tell if the app is trying to access this functionality.

To avoid breaking compatibility with Android apps, the added permission is enabled by default. When an app attempts to access sensors and receives zeroed data due to being denied, GrapheneOS creates a notification that can be easily disabled. The Sensors permission can be set to be disabled by default for user installed apps in **Settings &gt; Security & privacy &gt; More security & privacy**.

### Storage Scopes

GrapheneOS provides Storage Scopes as a fully compatible alternative to the standard Android storage permissions. Instead of granting storage permissions, users can enable Storage Scopes to make the app assume that it has all storage permissions that it asked for. On Android, an app that doesn't have any storage permissions is still allowed to create files and directories, and is allowed to access the files that it created. Users can optionally add files and directories as storage scopes to permit the app to access files created by other apps.

For more details, see the [usage guide section on storage access](https://grapheneos.org/usage#storage-access).

### Contact Scopes

GrapheneOS provides Contact Scopes as an alternative to granting the Contacts permission. By default, it acts as if the contacts list is empty and users can grant different kinds of access to specific contacts or groups of contacts.

For more details, see the [usage guide section on Contact Scopes](https://grapheneos.org/usage#contact-scopes).

### Secure Paste

GrapheneOS provides a more private system clipboard feature that can be used instead of the traditional approach. Users can control clipboard access for third party apps on a per-app basis with an added toggle. There is also a global toggle to set the default for all but system apps and the default setting can be overridden for specific apps. Secure Paste is integrated into the standard text selection toolbar, input methods, accessibility services and keyboard shortcuts.

Android only permits currently focused apps and the keyboard to read the clipboard. When an app reads clipboard content set by another app, Android shows a notice, but only after clipboard content has been accessed.

Secure Paste replaces the problematic standard approach used by both desktop and mobile operating systems. When enabled, apps will be unable to read clipboard content added by other apps, but they can read the clipboard if they set the content themselves.

Some apps, including apps written in Flutter, implement their own text selection toolbar. GrapheneOS works around this by adding a Paste button to the default keyboard.

### Broad carrier support without invasive carrier access

GrapheneOS has much broader carrier support than AOSP and mostly matches the stock OS on Pixels without making the same sacrifices. We convert their APN, carrier configuration, MMS and visual voicemail databases to the formats used by AOSP with our CarrierConfig2 project and scripts. We strip out anti-user configuration requiring provisioning for tethering, forbidding disabling 2G, etc. We don't include the invasive carrier-specific apps and support for Open Mobile Alliance Device Management (OMA DM) so we also strip out configuration depending on those.

See our [usage guide section on carrier functionality](https://grapheneos.org/usage#carrier-functionality) for more details.

### LTE-only mode

[LTE-only mode](https://grapheneos.org/usage#lte-only-mode) to reduce cellular radio attack surface by disabling enormous amounts of both legacy code (2G, 3G) and bleeding edge code (5G).

### Wi-Fi privacy

GrapheneOS supports per-connection MAC randomization and enables it by default. This is a more private approach than the standard persistent per-network random MAC used by modern Android.

When the per-connection MAC randomization added by GrapheneOS is being used, DHCP client state is flushed before reconnecting to a network to avoid revealing that it's likely the same device as before.

GrapheneOS also applies fixes for serious flaws with the Linux kernel IPv6 privacy address implementation which allow using it as an identifier not just for connections to the same network but also across different networks. We don't need to apply these changes for the Pixel 6 and later since this was fixed in the Linux kernel upstream, but hasn't been backported to earlier kernel LTS branches so we still need to take care of it there.

See our [usage guide section on Wi-Fi privacy for more general information](https://grapheneos.org/usage#wifi-privacy) rather than only our improvements to the standard Wi-Fi privacy approach.

### Network location

GrapheneOS provides network-based location as an opt-in feature with our own implementation. Similar to the services provided by Apple and Google, it offers location detection based on nearby networks rather than solely relying on using satellite-based location (GNSS) with technologies to accelerate it (A-GNSS). It makes getting a location indoors and in cities with tall buildings much faster or possible when it wouldn't have worked via GNSS. Certain apps also have the expectation of network-based location being available and don't account for the time needed to get a GNSS-based estimate or inability to get one everywhere so this feature provides improved compatibility with apps.

Unlike Google's service and similar to Apple's service, our feature provides local position estimation based on retrieving location data for nearby networks from a service. It caches the information from the service in-memory for up to 15 minutes from when it was last used so it can function offline after getting the initial data. It only needs to send a network identifier for each network it wants to use for position estimation. Google's service does server-side position estimation which requires repeatedly sending distance estimates for each network to the service for each position estimate update. The approach we use doesn't require providing any information to the service once the nearby networks are in the cache or sending distance estimates. The service also provides it with extra data covering a fairly large area from the initial position with a reasonable density of networks so it can keep functioning if internet access is lost.

Our network-based location feature is primarily based on Wi-Fi Access Points (APs). Cell towers are used as a fallback when Wi-Fi-based location can't obtain any position estimate. Apple and Google also use Bluetooth beacons but that's a very niche feature only relevant to certain malls, stores, etc. which are usually covered well enough by Wi-Fi support for decent position estimates so it isn't a priority for us to add support for it.

Users can currently choose between using our proxy to Apple's service or directly using Apple's service. We're in the process of building our own database and service based on data from multiple sources including Apple's service. Unlike the Apple and Google services, our service will provide support for fully offline usage based on database downloads rather than requiring sending network identifiers to the service to fetch data for them.

For details on how to use the network location feature, see the [usage section](https://grapheneos.org/usage#network-location).

### Private screenshots

GrapheneOS disables the inclusion of sensitive metadata in screenshots.

On Android, each screenshot includes an EXIF Software tag with detailed OS build/version information (`android.os.Build.DISPLAY`). It's the same value shown at **Settings &gt; About device &gt; Build number**. This leaks the OS, OS version and also usually the device family/model since builds are specific to a family of devices. GrapheneOS completely disables this tag.

On Android, each screenshot also includes EXIF tags with the local date, time and timezone offset. GrapheneOS disables this by default to avoid leaking the time and quasi-location information through metadata that isn't visible to the user. The date and time are already included in the file name of the screenshot which is fully visible to the user and can be easily modified by them without a third-party tool. GrapheneOS includes a toggle for turning this metadata back on in **Settings &gt; Security & privacy &gt; More security & privacy** since some users may find it to be useful.

### Closed device identifier leaks

GrapheneOS fixes several prominent device identifier leaks bypassing Android's intention of apps not being able to uniquely identify a device. See our FAQ sections on [hardware identifiers](https://grapheneos.org/faq#hardware-identifiers) and [non-hardware identifiers](https://grapheneos.org/faq#non-hardware-identifiers) for more general information.

Our [secure application spawning system](https://grapheneos.org/usage#exec-spawning) primarily exists to significantly improve protection against exploitation. However, it also improves privacy. On a device without our secure application spawning system, the secrets used for probabilistic exploit mitigations such as ASLR are usable as device identifiers persisting until reboot. This is an easy way to identify the device from apps in different profiles. It's a minor bonus of the feature and there are still plenty of side channels to identify devices across apps, but it fixes most of the known direct identifier leaks.

We also eliminate several holes in preventing apps from accessing hardware identifiers including tightening up the restrictions for apps targeting legacy Android platform versions.

### Privacy by default

GrapheneOS doesn't include or use Google apps and services by default and avoids including any other apps/services not aligned with our privacy and security focus. Google apps and services can be used on GrapheneOS as regular sandboxed apps without any special access or privileges through our [sandboxed Google Play](https://grapheneos.org/features#sandboxed-google-play) feature, but we don't include those apps by default to give users an explicit choice on whether they want to use those apps and which profiles they want to use it in.

We change the default settings to prefer privacy over small conveniences: personalized keyboard suggestions based on gathering input history are disabled by default, sensitive notifications are hidden on the lockscreen by default and passwords are hidden during entry by default.

Some of our changes for [attack surface reduction](https://grapheneos.org/features#attack-surface-reduction) can also improve privacy by default by not exposing unnecessary radios, etc. by default and avoiding the impact of potential privacy bugs with the hardware.

By default, we also use GrapheneOS servers for the following services instead of Google servers:

- Connectivity checks
- Attestation key provisioning
- GNSS almanac downloads (PSDS) for Broadcom and Qualcomm (XTRA)
- Secure User Plane Location (SUPL)
- Network time
- Vanadium (Chromium) component updates

We provide a toggle to switch back to Google's servers for connectivity checks, attestation key provisioning and GNSS almanac downloads along with adding proper support for disabling network time connections. This combines with other toggles to allow making a GrapheneOS device appear to be an AOSP device. This is only particularly important for connectivity checks since the other connections get routed through a VPN which is needed to blend in on a local network in practice.

In addition to our SUPL privacy improvements, we override the SUPL server to our proxy by default. We also add a toggle for users to switch to the standard SUPL server for their carrier (usually supl.google.com) or disable it entirely.

See our [default connections FAQ entry for much more detailed information](https://grapheneos.org/faq#default-connections).

### PIN scrambling

GrapheneOS adds a toggle for enabling PIN scrambling to raise the difficulty of figuring out the PIN being entered by a user either due to physical proximity or a side channel. PIN scrambling is applied to both the lock screen and SIM PIN/PUK.

### Two-factor fingerprint unlock

GrapheneOS adds the option to require entering a 2nd factor PIN after successfully authenticating with a fingerprint on the lockscreen in order to complete unlocking the device. Since Android/iOS use biometric unlock as a secondary unlock mechanism for convenience, this allows users to make use of a strong passphrase as their primary unlock method with the convenience of a fingerprint and short PIN for secondary unlock. Failure to enter the correct PIN counts towards the standard attempt limit.

### Supports longer passwords

GrapheneOS supports setting longer passwords by default: 128 characters instead of 16 characters. This avoids the need to use a device manager to enable this functionality.

This feature allows users to make use of diceware passwords if they don't want to depend on the security of the secure element which provides very aggressive throttling and offers a high level of security even for a random 6 digit PIN.

### Auto reboot

GrapheneOS provides an auto-reboot feature which reboots locked devices after a set period of time to put data at rest. A countdown timer is started each time the device is locked, and the device will reboot if a successful unlock doesn't occur before the timer reaches zero. Unlocking any profile cancels the timer, not just the Owner profile.

The timer is set to 18 hours by default, but can be set to values between 10 minutes and 72 hours, or turned off.

This feature doesn't apply when the device is in "Before First Unlock" state, meaning that it will not lead to the device continuously rebooting, as data is already at rest.

The feature is implemented in the init process, preventing it from being bypassed through system process crashes since an init crash causes a kernel panic which leads to a reboot.

### Clearing sensitive data from memory

As documented in our section on [our added exploit mitigations](https://grapheneos.org/features#exploit-mitigations), GrapheneOS adds zeroing of freed memory to both the standard userspace and kernel allocators. These features have the secondary benefit of clearing sensitive data from memory as soon as possible in addition to defending against exploits. Android implements regular compaction of frozen cached apps and apps currently running in the background based on triggering a full compacting garbage collection (GC) and then requesting that malloc frees as much memory as it can back to the OS. This pairs well with zeroing features and results in freed data getting cleared faster for Java/Kotlin and also the C, C++ and Rust libraries used by them where low-level allocators get held onto until the high level objects are freed.

When the device is locked, we trigger full compacting garbage collection (GC) for the SystemUI and system\_server processes to release all of the memory that's no longer used back to the OS. Due to GrapheneOS enabling kernel page allocator zeroing, this results in all the no longer referenced data in objects being cleared. We based our approach on Android's standard approach to running a full compacting GC for these two processes after the device is unlocked to clear remnants of the user's PIN/password and keys derived from it. This is a nice way to clear some data immediately after locking prior to our [auto-reboot](https://grapheneos.org/features#auto-reboot) feature kicking in to clear all of the OS memory.

GrapheneOS modifies some of the ways the device can be rebooted to proceed with the normal reboot process where memory gets freed and cleared by the kernel page and slab allocator zeroing features enabled by GrapheneOS.

### Duress PIN/Password

GrapheneOS provides users with the ability to set a duress PIN/Password that will irreversibly wipe the device (along with any installed eSIMs) once entered anywhere where the device credentials are requested (on the lockscreen, along with any such prompt in the OS).

The wipe does not require a reboot and cannot be interrupted. It can be set up at **Settings &gt; Security & privacy &gt; Device unlock &gt; Duress Password** in the owner profile. Duress PIN is solely used for PIN entry and duress password is solely used for password entry. Both a duress PIN and password are mandatory to enable the feature to account for different profiles that may have different unlock methods. Duress PIN will also wipe the device when entered as the [two-factor fingerprint unlock PIN](https://grapheneos.org/features#two-factor-fingerprint-unlock) but not currently when entered as the SIM PIN.

Note that if the duress PIN/Password is the same as the actual unlock method, the actual unlock method always takes precedence, and therefore no wipe will occur.

### More secure fingerprint unlock

GrapheneOS improves the security of the fingerprint unlock feature by only permitting 5 total attempts rather than implementing a 30 second delay between every 5 failed attempts with a total of 20 attempts. This doesn't just reduce the number of potential attempts but also makes it easy to disable fingerprint unlock by intentionally failing to unlock 5 times with a different finger.

GrapheneOS also adds support for using the fingerprint scanner only for authentication in apps and unlocking hardware keystore keys by toggling off support for unlocking. This feature already existed for the standard Android face unlock feature.

### Improved user profiles

Android's user profiles are isolated workspaces with their own instances of apps, app data and profile data (contacts, media store, home directory, etc.). Apps can't see the apps in other user profiles and can only communicate with apps within the same user profile (with mutual consent with the other app). Each user profile has their own encryption keys based on their lock method. They're a great fit for GrapheneOS with a lot of room for improvement.

GrapheneOS provides improvements to user profile functionality and is working on further improvements to make switching between them and monitoring other profiles much more convenient.

#### More user profiles

GrapheneOS raises the limit on the number of secondary user profiles to 32 (31 + guest) instead of only 4 (3 + guest) to make this feature much more flexible.

#### End session

GrapheneOS also enables support for logging out of user profiles without needing a device manager controlling the device to use this feature. Logging out makes profiles inactive so none of the apps installed in them can run. It also purges the disk encryption keys from memory and hardware registers, putting the user profile back at rest.

#### Disabling app installation

GrapheneOS adds a toggle to the user management settings for disabling secondary user app installation. You can install the apps you want to be usable in a secondary user and then disable the ability to install more apps as that user in the Owner profile. Android supports this as a standard device management feature but doesn't make it available to a user who owns their own device.

#### Improved install available apps

GrapheneOS enables the standard install available apps feature that's still not enabled in AOSP or the stock Pixel OS to allow the Owner user to install packages that are available in other users. This allows installing an app in a secondary user that's already installed in the Owner user without needing to download it again. This helps a lot with using the toggles added for disabling app installation by secondary users.

#### Notification forwarding

GrapheneOS supports forwarding notifications from users running in the background to the currently active user. Forwarding notifications to other users is disabled by default and can be enabled within each user profile where forwarding to the active profile is wanted. Notifications forwarded from other profiles are displayed by default in a standard local notification channel.

### GrapheneOS app repository

GrapheneOS includes our own security, minimalism and usability-focused app repository client for using our first-party app repository. Our app repository is currently used to distribute our own apps and a mirror of Google Play for the sandboxed Google Play feature. In the future, it will be used to distribute first-party GrapheneOS builds of externally developed open source apps with hardening applied.

### Vanadium: hardened WebView and default browser

GrapheneOS includes our Vanadium browser as WebView implementation provided by the OS and our default browser. Vanadium is a hardened variant of Chromium providing enhanced privacy and security, similar to how GrapheneOS compares to AOSP. The Vanadium browser currently doesn't add many features but there are a lot of enhancements planned in the long term.

Some of the features added compared to standard mobile Chromium:

- Hardware memory tagging (MTE) enabled for the main allocator
- Type-based Control Flow Integrity (CFI)
- Strong stack protector
- Automatic zero-initialized variables
- Well-defined signed overflow
- Strict site isolation and sandboxed iframes
- JavaScript JIT disabled by default with per-site toggle via drop-down permission menu
- Enable support for the DrumBrake WebAssembly interpreter previously exclusive to Microsoft Edge, to support WebAssembly when JIT compilation is disabled
- Dynamic code execution is blocked for processes without the JavaScript JIT enabled as an extension to the seccomp-bpf sandbox
- Native Android autofill implementation to avoid needing sandboxed Google Play for autofill support
- Native Android credential manager support for passkeys to avoid needing sandboxed Google Play for passkey support
- WebGPU disabled for attack surface reduction
- WebRTC IP handling policy toggle to control peer-to-peer WebRTC mode
- High performance content filtering engine with a per-site toggle using EasyList, EasyPrivacy and EasyList's Adblock Warning Removal List as the primary filters with EasyList's supplementary regional lists enabled based on enabled browser languages
- More complete state partitioning without origin trial opt-out
- Standard Android 16 user agent reduction is enabled early for the WebView to replace the major OS version, device model and browser minor/build/patch version with standard placeholder values
- High entropy client hints are replaced with the standard placeholder values used in Chromium's reduced user agent for both the browser and WebView to close a loophole where Chromium is still sharing the major OS version, device model and browser minor/build/patch version with any server requesting it via client hints
- Battery API always shows the battery as charging and at 100% capacity
- Trivial subdomain hiding disabled
- Consistent browser behavior across users without usage of feature flags and seed-based trials
- Nearly all remote services disabled by default or removed. Only connects to GrapheneOS servers by default. There are only 2 default services: component updates such as certificate authority and certificate revocation updates and DNS-over-HTTPS connectivity checks when enabled
- Web search and global search intents to replace the need for an OS search app
- Option to always open links from other apps, custom tabs, search intents and share intents in Incognito mode
- Option to reduce or disable sending cross-origin referrer information sharing where a link was opened
- Hybrid post-quantum cryptography enabled by default to match the behavior of Chromium on desktop since the devices we support are more than fast enough
- Bookmark export and import

Better default settings, including non-user-facing flags:

- Reduce Accept-Language header by default (only available via chrome://flags)
- Third party cookies disabled by default
- Payment support disabled by default
- Website background sync disabled by default
- Sensors access disabled by default
- Protected media (DRM) disabled by default
- Hyperlink auditing disabled by default
- Do Not Track enabled by default mainly to avoid users differentiating themselves from others by enabling it since it has no real value
- WebRTC IP handling policy set to the most private value by default instead of the least private value (turned into a user-facing option by Vanadium)

Features impacting compatibility where there needs to be a toggle available such as content filtering are mostly only available for the browser itself and not the WebView library. JavaScript JIT is enabled by default for the WebView in user installed apps with both a global toggle to change the default to disabled and a per-app toggle for overriding the default.

Extension support isn't planned due to being at odds with site isolation and anti-fingerprinting. We plan to implement more features as part of the browser with a focus on privacy and security improvements which can be active by default rather than opt-in niche features. Improvements will generally be opt-out on a per-site basis rather than opt-in to provide privacy and security by default and to avoid users making themselves more identifiable by opting into privacy and security features. Default-disabled JS JIT and default-enabled content filtering are early examples of this approach we plan to expand upon.

We plan to add more site settings toggles related to attack surface reduction such as site setting toggles for WebGL, WebGPU, WebRTC and other features which are normally always enabled. This will help with both security and improving the defenses against fingerprinting.

Anti-fingerprinting depends on having a large userbase with the same browser, extensions, content filters and other web-facing configuration. Once Vanadium has more features, it will be made available outside GrapheneOS to expand the userbase. Our approach to attack surface reduction eliminates fingerprinting methods in addition to attack surface for exploits and this will be a key part of how we approach preventing fingerprinting by not having features like WebGL, WebGPU and WebRTC exposed in the first place. Good defaults and avoiding having users changing web-facing configuration is an important part of this. Content filters will remain standard across users and updated together as part of the Vanadium configuration app. We'll address the need for language-focused filters by enabling them based on browser language configuration. Fingerprinting based on hardware differences will become more relevant once Vanadium is available outside of GrapheneOS which will always support a small set of highly secure devices.

State partitioning still needs to be fully completed. The main remaining hurdle is providing full cookie partitioning. Mainstream browsers with this feature rely on heuristics bypassing cookie partitioning which can be easily abused to bypass the feature. We tried deploying full cookie partitioning by default but had to roll it back and will need to consider how to approach this particularly with our goal of having most Vanadium users using nearly the same configuration.

We plan to move to a better content engine with support for more advanced filter rules and cosmetic filtering in the future. Expanding the standard filters will depend on having support for the extensions used by uBlock Origin, AdGuard and other filters.

Most browser data is currently excluded from OS backups, which will likely be changed once GrapheneOS has a better backup service included. Export/import for bookmarks and similar data export/import features are also planned. Sync beyond OS backup service support which will eventually provide per-app backup and restore including across devices and via sync services is not planned.

More information is available in the [web browsing section of our usage guide](https://grapheneos.org/usage#web-browsing).

### Auditor app and attestation service

Our [Auditor app](https://github.com/GrapheneOS/Auditor/releases) and [attestation service](https://attestation.app/) provide strong hardware-based verification of the authenticity and integrity of the firmware/software on the device. A strong pairing-based approach is used which also verifies the device's identity based on the hardware-backed key generated for each pairing. Software-based checks are layered on top with trust securely chained from the hardware. For more details, see the [About](https://attestation.app/about) and [Tutorial](https://attestation.app/tutorial) pages.

### GrapheneOS Camera

[GrapheneOS Camera](https://grapheneos.org/usage#grapheneos-camera-app) is a modern camera app with a great user interface and a focus on privacy and security. More details are available in the [camera section of our usage guide](https://grapheneos.org/usage#camera).

### GrapheneOS PDF Viewer

[GrapheneOS PDF Viewer](https://github.com/GrapheneOS/PdfViewer) is a sandboxed, hardened PDF viewer using HiDPI rendering with features like pinch to zoom, text selection, viewing encrypted PDFs, etc.

### Setup Wizard

We have our own Setup Wizard for the initial setup of the device and for user profiles. It's very similar to the Setup Wizard in the stock Pixel OS but has more emphasis on security. It detects an unlocked bootloader at the start and warns the user about it with a button for rebooting to fastboot mode in order to lock the device. Skipping the warning requires waiting for a timer to prevent quickly skipping through it and missing the important information. Our setup wizard also disables OEM unlocking by default at the end of the process with a toggle to opt-out of it being disabled, which is a small but useful reduction in attack surface. We plan to include our improvements to lock method options in our Setup Wizard including 2-factor fingerprint authentication along with generating random diceware passphrases and PINs automatically.

### Encrypted backups

Encrypted backups via integration of the [Seedvault app](https://github.com/GrapheneOS/platform_external_seedvault) with support for local backups and any cloud storage provider with a storage provider app.

Seedvault was created by a GrapheneOS community member for inclusion in our operating system. We plan on replacing it with a new implementation since the project has been taken over by another group of people not sharing our goals or approach. For now, this is the best available option, so we're including it to give people encrypted backup support. We've made several security fixes to work around upstream issues with the project.

### Location data access indicator

GrapheneOS enables the privacy indicator for location data access in addition to the standard Android camera and microphone indicators. This shows an indicator when an app the user has granted permission to access location requests location data. We also resolve various UX issues with this feature as it currently exists in AOSP to get it into a highly usable state.

Android 13 has the location privacy indicator as a developer option but it doesn't work the same way as it does in GrapheneOS. GrapheneOS shows it for all location data accesses through any APIs. Normally, the stock OS only shows it for GNSS location requests, also known as high power location requests, and doesn't normally show it for network location and other APIs gated by the Location permission and global block toggle.

The indicator works the same way as the Camera and Microphone ones, showing a bright green icon when location access occurs which then gets minimized to a small bright green dot when the quick settings tray isn't currently opened. Android 12 already includes Location with the other standard runtime permissions in the privacy dashboard for viewing the history.

### User installed apps can be disabled

GrapheneOS adds support for disabling user installed apps instead of only being able to disable system apps. This allows users to completely prevent one of the apps they've installed from being able to run without being forced to uninstall it and lose their app data. This is much stricter than the standard force stop feature which only prevents an app from starting itself and the app will start running again as soon as another app tries to open an activity or service it provides.

### Improved VPN leak blocking

GrapheneOS greatly improves Android's protection against VPN leaks for both the built-in VPN support and VPN apps with the standard "Block connections without VPN" toggle enabled.

Android allows DNS queries from the system resolver to leak to the network provided DNS servers when a VPN app goes down due to a race condition. It also similarly allows connections to the VPN DNS servers to happen outside of the VPN tunnel. Both of these are fully prevented by GrapheneOS through extending the leak blocking to this part of the system resolver, fully preventing unicast DNS leaks.

Android allows processes including apps to bypass the VPN entirely whether it's up or down by sending multicast packets either directly or by causing the kernel to send the packets on their behalf through the standard multicast group management system calls. GrapheneOS extends Android's standard eBPF filtering with full support for blocking all forms of multicast packet bypasses. We also disallow using the system Network Service Discovery Manager for connecting to mDNS-based services when VPN lockdown is enabled.

Android VPN configuration is split up for each profile which means work profiles, Private Spaces and secondary users have their own VPN configuration which is a fantastic privacy feature. Android has a standard restriction preventing processes from using a network which the current profile isn't allowed to access. However, this doesn't take multicast packets into account and it's possible to send multicast packets via VPN tunnels belonging to a different profile. GrapheneOS addresses this by extending the standard netfilter configuration with a multicast firewall preventing sending packets through a VPN tunnel which a process isn't supposed to be able to access.

GrapheneOS closes a hole in Android's eBPF-based firewall system which made it possible to bypass the VPN by specifying a specific interface with a special system call.

Finding and resolving all forms of VPN leaks is one of our top priorities at the moment and we don't currently consider this to be a complete feature due to less severe additional issues we've discovered.

### Log viewer and user-facing crash reporting

GrapheneOS adds a user-facing log viewer to the Settings app for Android's standard in-memory logging system. The feature acts as a substitute for automated crash reporting which is not implemented by GrapheneOS for privacy reasons. Instead, users are in control of what's captured and shared. Our log viewer supports filtering the output based on log level, log buffers and text search. Users can copy, share or save the currently shown logs to a file. A description can be added to document why the logs were captured.

Overall system logs can be accessed at **Settings &gt; System &gt; View logs**. Per-app logs can be accessed at **Settings &gt; Apps &gt; App name &gt; View logs**.

We implement user-facing crash reporting tied to our log viewer for OS and app crashes, greatly improving upon the very limited user-facing crash reporting available in Android. This helps users report crashes to the OS or app developers without requiring invasive automated crash reporting where users don't control the data that's sent to developers.

Our user-facing crash reporting has special support for memory corruption caught by hardened\_malloc and hardware memory tagging informing users that memory corruption was detected. Users choose how to proceed and whether it makes sense to enable our compatibility toggles for the app if they don't believe it was an exploit but rather an app bug they need to work around. It's a careful balance between not encouraging users to disable security features protecting user installed apps from exploits and making it easy to work around app bugs. We don't allow disabling these exploit protection features for the base OS including base OS apps, but too many user installed apps have latent memory corruption bugs and we need to provide the option to work around them.

Users can enable more system crash reporting via **Settings &gt; Security & privacy &gt; More security & privacy &gt; Notify about system process crashes**. We don't enable reporting all kernel or system process crashes by default since we can't manage triaging and investigating every single Android OS bug causing a crash. We're focused on the memory corruption crashes caught by hardware memory tagging so those are always reported. Fixing every Android bug ourselves is not something we can hope to accomplish so we focus our resources on the ones found by our improvements which also have a higher chance of being security bugs.

### Other features

This is an incomplete list of other GrapheneOS features.

- Per-profile encrypted file name padding increased from 16 bytes to 32 bytes to reduce the information leaked through file name lengths. See the FAQ section on [the filesystem-based full disk encryption](https://grapheneos.org/faq#encryption) used by modern Android and GrapheneOS for more information.
- Improved user visibility into persistent firmware security through version and configuration verification with reporting of inconsistencies and debug features being enabled.
- Authenticated encryption for network time updates via a first-party server to prevent attackers from changing the time and enabling attacks based on bypassing certificate and key expiry, etc.
- Proper support for disabling network time updates rather than just not using the results
- Hardened local build and signing infrastructure
- [Seamless automatic OS update system](https://grapheneos.org/usage#updates) that just works and stays out of the way in the background without disrupting device usage, with full support for the standard automatic rollback if the first boot of the updated OS fails
- Require unlocking to access sensitive functionality via quick tiles
- [Minimal bundled apps and services](https://grapheneos.org/faq#bundled-apps). Only essential apps are integrated into the OS. We don't make partnerships with apps and services to bundle them into the OS. An app may be the best choice today but a poor choice in the future, and vice-versa. Our approach will be recommending certain apps during the initial setup, not hard-wiring them into the OS.
- Wireless alerts are completely optional since GrapheneOS adds a toggle for the otherwise mandatory presidential alert type. This is particularly useful in Canada where the government abuses the system and sends every type of alert as a presidential alert to stop users from being able to opt out of weather and amber alerts.
- Removal of the Chunghwa Telecom and Netlock root certificate authorities as trusted system CAs.
- Secure-by-default Android 12 PendingIntent security check (FLAG\_IMMUTABLE) instead of crash-by-default improving older app compatibility and security.
- Fixed UART debugging enabled warning on official release builds.
- Engineering/Prototype ("EVT", "PVT" or "DVT") device warning as these devices typically have relaxed security controls for development, mainly the secure boot state property `ro.boot.secure_boot` not set to `PRODUCTION`.
- Enable bootloader, radio, and boot partition version and fingerprint checks.
- Remove code automatically granting the location permission to system browsers.
- Apps that don't have any storage permission aren't allowed to read the list of all user-created directories (this is allowed on Android). The list of files is hidden from such apps on both Android and GrapheneOS.
- Screenshot shutter sound is toggleable using the **Tap & click sounds** option in **Settings &gt; Sound & vibration** while still following the standard method of putting the device on vibration/silent mode to turn off the screenshot shutter sound.
- More precise system clock via lowering the system clock time update threshold from 2000ms to 50ms and lowering the system clock drift warning from 2000ms to 250ms. This can be helpful for time-based protocols such as TOTP.
- Call recording functionality within the Dialer app using modern Android storage with recordings stored in Recordings/Call Recordings and no restrictions based on region or special cases like playing a recording tone (users are still responsible for complying with their local laws).
- Change standard Android package installer behavior to preserving packages being disabled after updating them instead of them being re-enabled.
- Enable the "Always-on VPN" and "Block connections without VPN" toggles for VPNs by default.
- Permission prompts and the Android Debug Bridge USB authorization prompt have the allow action disabled by default with a 1 second delay before it becomes active. This protects against accidental presses, especially since an app can trick the user into doing it by having them push a button where the system dialog will be displayed.

## Services

Service infrastructure features:

- Strict privacy and security practices for our infrastructure
- Unnecessary logging is avoided, and logs are automatically purged after 4 days (network services used by the OS) to 10 days
- Services are hosted entirely via our own dedicated servers and virtual machines without involving any additional parties for CDNs, SaaS platforms, mirrors or other services. See our [GrapheneOS servers page](https://grapheneos.org/articles/grapheneos-servers) for more details
- Our services are built with open technology stacks to avoid being locked into any particular hosting provider or vendor
- Open documentation on our infrastructure including listing out all of our services, guides on making similar setups, published configurations for each of our web services, etc.
- No proprietary services
- Authenticated encryption for all of our services
- Strong cipher configurations for all of our services (SSH, TLS, etc.) with only modern AEAD ciphers providing forward secrecy
- Our web sites do not include any third party content and entirely forbid it via strict Content Security Policy rules
- Our web sites disable referrer headers to maximize privacy
- Our web sites fully enable cross origin isolation and disable embedding in other content
- [DNSSEC](https://internet.nl/faqs/dnssec/) implemented for all of our domains to provide a root of trust for encryption and authentication for domain/server configuration
- DNS Certification Authority Authorization (CAA) records for all of our domains permitting only Let's Encrypt to issue certificates with fully integrated support for the `accounturi` and `validationmethods` pinning our Let's Encrypt accounts as the only ones allowed to issue certificates
- DANE TLSA records for pinning keys for all our TLS services
- Our mail server enforces DNSSEC/DANE to provide authenticated encryption when sending mail including alert messages from the attestation service
- SSHFP across all domains for pinning SSH keys
- Static key pinning for our services in apps like Auditor
- No persistent cookies or similar client-side state for anything other than login sessions, which are set up securely using `SameSite=Strict`, `Secure`, `HttpOnly`, and `Path=/` flags, prefixed with `__Host` and have server-side session tracking with the ability to log out of other sessions
- scrypt-based password hashing (likely Argon2 when the available implementations are more mature)

## Project

Beyond the technical features of the OS:

- Collaborative, [open source project](https://grapheneos.org/source) with a [very active community](https://grapheneos.org/contact#community) and contributors
- You can make your own builds and make desired changes, so you aren't stuck with the decisions made by the upstream project
- Non-profit project avoiding conflicts of interest by keeping commercialization at a distance. Companies support the project [rather than the project serving the needs of any particular company](https://grapheneos.org/faq#company)
- [Strong privacy policies](https://grapheneos.org/faq#privacy-policy) across all our software and services
- [Proven track record](https://grapheneos.org/history/) of the team standing up against attempts to compromise the integrity of the project and placing it above personal gain

---
url: https://grapheneos.org/usage
title: Usage guide
words: 11181
---
# Usage guide

This is a guide covering some aspects of using GrapheneOS. See the [features page](https://grapheneos.org/features) for a list of GrapheneOS features.

## System navigation

By default, GrapheneOS uses gesture-based navigation. We recommend reading our guide on gesture navigation and giving it a chance even if you think you won't like it. Our experience is that when armed with the appropriate knowledge, the vast majority of users prefer the newer gesture navigation approach.

The system navigation mode can be configured in **Settings &gt; System &gt; Gestures &gt; Navigation mode**. The same menu is also available in **Settings &gt; Accessibility &gt; System controls &gt; Navigation mode**.

### Gesture navigation

The bottom of the screen is a reserved touch zone for system navigation. A line is displayed in the center to show that the navigation bar is present across the entire bottom of the screen. In most apps, this area will display padding. Modern apps are able to tell the OS that they can handle not having the padding to display app content there while still not being able to receive touches from it. Open up the Settings app for an example.

Swiping up from the navigation bar while removing your finger from the screen is the **Home** gesture.

Swiping up from the navigation bar while holding your finger on the screen before releasing is the **Recent Apps** gesture. The most recently opened activity is always on the furthest right. Each step left goes one step back through the history of recently opened apps. Opening an app with the recent apps activity will place it on the furthest right in the recent apps order just like a new app being opened.

The recent apps activity has a screenshot button as an alternative to holding power and volume down while using an app.

Rather than opening the recent apps activity, you can swipe left on the navigation bar for the **Previous** app and swipe right for the **Next** app. This will not change the recent apps order. This is usually the best way to navigate through recent apps.

Swiping from either the left or the right of the screen within the app (not the navigation bar) is the **Back** gesture. Apps are supposed to avoid implementing conflicting gestures, but have the option to override this gesture if they truly need to get rid of it. Some legacy apps without active development of their UI still haven't addressed this despite gestures being the default for several years on Google Android. You can avoid triggering the back gesture in one of 2 easy ways: avoid swiping from right near the edge or hold your finger on the side of the screen for a moment before swiping. The more advanced option is using a diagonal swipe pointing sharply to the bottom of the screen since this will bypass the back gesture but will still trigger most app gestures. The advanced option is the most convenient approach once you get used to doing it.

The launcher uses a swipe up gesture starting anywhere on the screen to open the app drawer from the home screen. You need to start that gesture above the system navigation bar since any gesture starting on the navigation bar is handled by the OS as a system navigation gesture.

### 3-button navigation

3-button navigation is Android's oldest touchscreen-based navigation system. It will remain supported for the foreseeable future to provide accessibility for users unable to easily use the gestures. It's older than 2-button navigation but isn't considered a legacy feature.

A large row across the bottom of the screen is reserved for navigation buttons. The **Back** button is on the left, the **Home** button is in the center and the **Recent Apps** button is on the right.

In the recent apps activity, the most recently opened activity is always on the furthest right. Each step left goes one step back through the history of recently opened apps. Opening an app with the recent apps activity will place it on the furthest right in the recent apps order just like a new app being opened.

The recent apps activity has a screenshot button as an alternative to holding power and volume down while using an app.

## Storage access

GrapheneOS inherits the same baseline approach to storage access as modern Android and extends it with our Storage Scopes feature as a fully compatible alternative to standard Android storage permissions. This section provides an overview of the standard approach to storage access primarily to provide context for explaining Storage Scopes.

There are two types of app-accessible storage:

- app-private ("internal") storage:

  - inaccessible to other apps
  - doesn't require any permission for full access
  - cleared when the app is uninstalled
- shared ("external") storage:

  - shared with other apps
  - access is regulated with permissions
  - files persist after uninstallation

  Android/data/ and Android/obb/ directories aren't considered to be parts of shared storage.

For modern apps, access to the shared storage is controlled in the following way:

- Without any storage permission, an app is allowed to:

  - create media files in standard directories (audio in Music/, Ringtones/, etc, images in Pictures/ and DCIM/, videos in DCIM/ and Movies/)
  - create files of any type (both media and non-media) in Documents/ and Download/
  - create new directories inside standard directories
  - rename/delete files that were created by the app itself
  - rename/delete directories if it can rename/delete all files within those directories
- Media access permission ("Allow access to media only", `READ_EXTERNAL_STORAGE`) allows the app to read media files that were created by other apps. Non-media files remain invisible to it. For apps targeting Android 13, the media access permission is split into `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO` and `READ_MEDIA_AUDIO`.
- Media management special access permission ("Allow app to manage media", `MANAGE_MEDIA`) allows the app to delete and to rename media files created by other apps.
- "All files access" special access permission (`MANAGE_EXTERNAL_STORAGE`) allows the app to read, create, rename and delete files and directories of any type in any directory of the shared storage (including the root directory).

For legacy apps (those that target Android 9 or lower and those that target Android 10 and request legacy storage mode), storage access permissions have a different meaning:

- Without a storage permission, app is not allowed any type of access to any files or directories inside the shared storage.
- `READ_EXTERNAL_STORAGE` permission allows the app to read both media and non-media files in any directory.
- `WRITE_EXTERNAL_STORAGE` permission allows the app to create, rename and delete files (of any type) and directories in any directory of shared storage (including the root directory).

Additionally, both modern and legacy Android apps can open the system file picker interface to have the user store or load one or more files/directories on their behalf. This type of access doesn't require any of the permissions listed above. Using this approach gives the user control over where files are stored in their home directory and which files/directories can be used by the app. This is based on the Storage Access Framework (SAF) introduced in Android 4.4. SAF allows the user to grant access to files/directories in their home directory, external drives and also app-based storage providers such as network shares, cloud storage, an encrypted volume, an external drive with a filesystem the OS doesn't support for external drives, etc. This is the only way to use those app-based storage providers and modern Android has removed the legacy approach for accessing external drives.

### Storage Scopes

GrapheneOS provides the Storage Scopes feature as a fully compatible alternative to the standard Android storage permissions. Storage Scopes can be enabled only if the app doesn't have any storage permission. Enabling Storage Scopes makes the app assume that it has all of storage permissions that were requested by it, despite not actually having any of them.

This means that the app can't see any of the files that were created by other apps. The app is still allowed to create files and directories, same as any other modern app that doesn't have any storage access permission.

Apps that would normally use the legacy storage mode are switched to the modern storage mode when Storage Scopes is enabled.

If the app requests the "All files access" permission (or is a legacy app that requests `WRITE_EXTERNAL_STORAGE` permission), then the write restrictions that are normally applied to apps that don't have a storage access permission are relaxed to provide the same write access that the app would have if it was granted the "All files access" permission. This is done to ensure compatibility with apps that, for example, create a new directory in the root of shared storage, or write a text file (eg lyrics.txt) to the Music/ directory (normally, only audio files can be placed there). No additional read access is granted to such apps, they still can see only their own files.

For all other apps, enabling Storage Scopes doesn't grant any additional storage access beyond what a modern app that doesn't have any storage permission already has.

Optionally, users can specify which of the files created by other apps the app can access. Access can be granted to a specific file or to all files in a directory. The standard SAF picker is used for this purpose in a special mode where it shows only shared storage files/directories.

The most significant limitation of Storage Scopes is the fact that the app will lose access to files that it created if it's uninstalled and then installed again, same as any other app that doesn't have a storage access permission. As a workaround, users can manually grant access to these files/directories via SAF picker.

## Contact Scopes

On Android, contact access is controlled with an all-or-nothing Contacts permission, which grants both read and write access to all contacts stored on the device.

A lot of apps (e.g. popular messaging apps) refuse to work unless the Contacts permission is granted.

GrapheneOS provides the Contact Scopes feature as an alternative to granting the Contacts permission. Enabling Contact Scopes makes the app assume that it has the Contacts permission, despite not actually having it. By default, an app that has Contact Scopes enabled is not allowed any kind of contact access.

Optionally, read access can be granted to the following scopes:

- Contact data (phone number or email). Access to each type of number and email in a contact is granted separately. Access to the contact name is granted automatically.
- Single contact. Access is granted to all contact data, except contact photo.
- Contact group ("label"). Equivalent to granting access to all contacts in the group. Any contact can be in any number of contact groups.

The type and name of the account that the contact is stored in are fully hidden from the app. The name of the contact account is usually the same as the email address of that account.

When Contact Scopes is enabled, write access is fully blocked: the app is not allowed to edit any contact data, add or remove contacts, etc.

## Accessibility

GrapheneOS includes all of the accessibility features from the Android Open Source Project and strives to fill in the gaps from not including Google apps and services. We include our own fork of the open source TalkBack accessibility service along with a Monochromacy option for the standard color correction menu.

GrapheneOS does not yet include a text-to-speech (TTS) service in the base OS due to limitations of the available options. Including one is planned in the future when a suitable option is available. RHVoice and eSpeak NG are both open source and are the most common choices by GrapheneOS users. Both of these work fine but have licensing issues. eSpeak NG has added Direct Boot based on our request for it, meaning it is able to function before the first unlock. RHVoice is missing Direct Boot and can't run before the first unlock. Installing and setting up either one of these or another TTS app will get TalkBack working. TalkBack itself supports Direct Boot and works before the first unlock but it needs to have a TTS app supporting it in order to do more than playing the activation sound before the first unlock. After installing a TTS service, you need to select it in the OS configuration to accept activating it. The OS will display one of them as already selected, but it won't simply work from being installed as that wouldn't be safe. This is the same as the stock OS but it comes with one set up already.

GrapheneOS disables showing the characters as passwords are typed by default. You can enable this in **Settings &gt; Security & privacy &gt; Privacy &gt; Show passwords**.

Third party accessibility services can be installed and activated. This includes the ones made by Google. Most of these will work but some may have a hard dependency on functionality from Google Play services for some of their functionality or to run at all. Accessibility services are very powerful and we strongly recommend against using third party implementations if you can get by well without them. We plan to add safeguards in this area while still keeping them working without problematic barriers.

## Auditor

See the [tutorial page on the site for the attestation sub-project](https://attestation.app/tutorial).

## Updates

The update system implements automatic background updates. It checks for updates approximately once every six hours when there's network connectivity and then downloads and installs updates in the background. It will pick up where it left off if downloads are interrupted, so you don't need to worry about interrupting it. Similarly, interrupting the installation isn't a risk because updates are installed to a secondary installation of GrapheneOS which only becomes the active installation after the update is complete. Once the update is complete, you'll be informed with a notification and simply need to reboot with the button in the notification or via a normal reboot. If the new version fails to boot, the OS will be rolled back to the past version and the updater will attempt to download and install the update again.

The updater will use incremental (delta) updates to download only changes rather than the whole OS when one is available to go directly from the installed version to the latest version. As long as you have working network connectivity on a regular basis and reboot when asked, you'll almost always be on one of the past couple versions of the OS which will minimize bandwidth usage since incrementals will always be available.

The updater works while the device is locked and idle, including before the first unlock since it's explicitly designed to be able to run before decryption of user data.

Release changelogs are available [in a section on the releases page](https://grapheneos.org/releases#changelog).

### Settings

The settings are available in the Settings app in **System &gt; System update**.

The "Check for updates" option will manually trigger an update check as soon as possible. It will still wait for the configuration conditions listed below to be satisfied, such as being connected to the internet via one of the permitted network types.

The "Release channel" setting can be changed from the default Stable channel to the Beta channel if you want to help with testing. The Beta channel will usually simply follow the Stable channel, but the Beta channel may be used to experiment with new features.

The "Permitted networks" setting controls which networks will be used to perform updates. It defaults to using any network connection. It can be set to "Non-roaming" to disable it when the cellular service is marked as roaming or "Unmetered" to disable it on cellular networks and also Wi-Fi networks marked as metered.

The "Require battery above warning level" setting controls whether updates will only be performed when the battery is above the level where the warning message is shown. The standard value is at 15% capacity.

The "Require device to be charging" setting controls whether updates will only be performed when the device is charging.

Enabling the opt-in "Automatic reboot" setting allows the updater to reboot the device after an update once it has been idle for a long time. When this setting is enabled, a device can take care of any number of updates completely automatically even if it's left completely idle.

The "Notification settings" option is a shortcut to the System Updater notification settings which allows you to control notification settings from System Updater such as notification dot, lock screen, and noisy or silent notifications. These notifications include updater errors, progress, already up to date, and reboot prompts. By default all notifications are enabled.

### Security

The update server isn't a trusted party since updates are signed and verified along with downgrade attacks being prevented. The update protocol doesn't send identifiable information to the update server and works well over a VPN or Tor. GrapheneOS isn't able to comply with a government order to build, sign and ship a malicious update to a specific user's device based on information like the IMEI, serial number, etc. The update server only ends up knowing the IP address used to connect to it and the version being upgraded from based on the requested incremental.

Android updates can support serialno constraints to make them validate only on a certain device but GrapheneOS rejects any update with a serialno constraint for both over-the-air updates (Updater app) and sideloaded updates (recovery).

### Disabling

It's highly recommended to leave automatic updates enabled and to configure the permitted networks if the bandwidth usage is a problem on your mobile data connection. However, it's possible to turn off the update client by going to **Settings &gt; Apps**, enabling Show system via the menu, selecting System Updater and disabling the app. If you do this, you'll need to remember to enable it again to start receiving updates.

### Sideloading

Updates can be downloaded via [the releases page](https://grapheneos.org/releases) and installed via recovery with adb sideloading. The zip files are signed and verified by recovery, just as they are by the update client within the OS. This includes providing downgrade protection, which prevents attempting to downgrade the version. If recovery didn't enforce these things, they would still be enforced via verified boot including downgrade protection and the attempted update would just fail to boot and be rolled back.

To install one by sideloading, first, boot into recovery. You may do this either by using `adb reboot recovery` from the operating system, or by selecting the "Recovery" option in the bootloader interface.

You should see the green Android lying on its back being repaired, with the text "No command" meaning that no command has been passed to recovery.

Next, access the recovery menu by holding down the power button and pressing the volume up button a single time. This key combination toggles between the GUI and text-based mode with the menu and log output.

Finally, select the "Apply update from ADB" option in the recovery menu and sideload the update with adb. For example:

```
adb sideload raven-ota_update-2021122018.zip
```
**You do not need to have adb enabled within the OS or the host's ADB key whitelisted within the OS to sideload an update to recovery. Recovery mode does not trust the attached computer and this can be considered a production feature. Trusting a computer with ADB access within the OS is much different and exposes the device to a huge amount of attack surface and control by the trusted computer.**

## USB-C port and pogo pins control

Our **USB-C port and pogo pins** setting protects against attacks through USB-C or pogo pins while the OS is booted. For the majority of devices without pogo pins, the setting is labelled **USB-C port**.

The setting is available in **Settings &gt; Security &gt; Exploit protection**.

The setting has five modes:

- Off
- Charging-only
- Charging-only when locked
- Charging-only when locked, except before first unlock
- On

The default is **Charging-only when locked**, which significantly reduces attack surface when the device is locked. After locking, it blocks any new USB connections immediately and disables USB data once any current connections end.

For technical details on how this feature works using a combination of hardware and software protection, see the [section on the features page](https://grapheneos.org/features#usb-c-port-and-pogo-pins-control).

## Web browsing

GrapheneOS includes our Vanadium subproject providing privacy and security enhanced releases of Chromium. Vanadium is both the user-facing browser included in the OS and the provider of the WebView used by other apps to render web content. The WebView is the browser engine used by nearly all other apps embedding web content or using web technologies for other uses. It's also used by many minor web browsers not forking Chromium as a whole. These apps using the WebView benefit from a subset of the Vanadium hardening.

Vanadium was previously primarily focused on security hardening but we plan on adding assorted privacy and usability features. In the near future, we plan to add support for always incognito mode, improved state partitioning, backup/restore and many other features.

Chromium-based browsers like Vanadium provide the strongest sandbox implementation, leagues ahead of the alternatives. It is much harder to escape from the sandbox and it provides much more than acting as a barrier to compromising the rest of the OS. Site isolation enforces security boundaries around each site using the sandbox by placing each site into an isolated sandbox. It required a huge overhaul of the browser since it has to enforce these rules on all the IPC APIs. Site isolation is important even without a compromise, due to side channels. Browsers without site isolation are very vulnerable to attacks like Spectre. On mobile, due to the lack of memory available to apps, there are different modes for site isolation. Vanadium turns on strict site isolation, matching Chromium on the desktop, along with strict origin isolation.

Chromium has decent exploit mitigations, unlike the available alternatives. This is improved upon in Vanadium by enabling further mitigations, including those developed upstream but not yet fully enabled due to code size, memory usage or performance. For example, it enables type-based CFI like Chromium on the desktop, uses a stronger SSP configuration, zero initializes variables by default, etc. Some of the mitigations are inherited from the OS itself, which also applies to other browsers, at least if they don't do things to break them.

We recommend against trying to achieve browser privacy and security through piling on browser extensions and modifications. Most privacy features for browsers are privacy theater without a clear threat model and these features often reduce privacy by aiding fingerprinting and adding more state shared between sites. Every change you make results in you standing out from the crowd and generally provides more ways to track you. Enumerating badness via content filtering is not a viable approach to achieving decent privacy, just as AntiVirus isn't a viable way to achieving decent security. These are losing battles, and are at best a stopgap reducing exposure while waiting for real privacy and security features.

Vanadium will be following the school of thought where hiding the IP address through Tor or a trusted VPN shared between many users is the essential baseline, with the browser partitioning state based on site and mitigating fingerprinting to avoid that being trivially bypassed. The Tor Browser's approach is the only one with any real potential, however flawed the current implementation may be. This work is currently in a very early stage and it is largely being implemented upstream with the strongest available implementation of state partitioning. Chromium is using Network Isolation Keys to divide up connection pools, caches and other state based on site and this will be the foundation for privacy. Chromium itself aims to prevent tracking through mechanisms other than cookies, greatly narrowing the scope downstream work needs to cover. The focus is currently on research since we don't see much benefit in deploying bits and pieces of this before everything is ready to come together. At the moment, the only browser with any semblance of privacy is the Tor Browser but there are many ways to bypass the anti-fingerprinting and state partitioning. The Tor Browser's security is weak which makes the privacy protection weak. The need to avoid diversity (fingerprinting) creates a monoculture for the most interesting targets. This needs to change, especially since Tor itself makes people into much more of a target (both locally and by the exit nodes).

WebView-based browsers use the hardened Vanadium rendering engine, but they can't offer as much privacy and control due to being limited to the capabilities supported by the WebView widget. For example, they can't provide a setting for toggling sensors access because the feature is fairly new and the WebView WebSettings API doesn't yet include support for it as it does for JavaScript, location, cookies, DOM storage and other older features. For sensors, the Sensors app permission added by GrapheneOS can be toggled off for the browser app as a whole instead. The WebView sandbox also currently runs every instance within the same sandbox and doesn't support site isolation.

Avoid Gecko-based browsers like Firefox as they're currently much more vulnerable to exploitation and inherently add a huge amount of attack surface. Gecko doesn't have a WebView implementation (GeckoView is not a WebView implementation), so it has to be used alongside the Chromium-based WebView rather than instead of Chromium, which means having the remote attack surface of two separate browser engines instead of only one. Firefox/Gecko also bypass or cripple a fair bit of the upstream and GrapheneOS hardening work for apps. Worst of all, Firefox does not have internal sandboxing on Android. This is despite the fact that Chromium semantic sandbox layer on Android is implemented via the OS `isolatedProcess` feature, which is a very easy to use boolean property for app service processes to provide strong isolation with only the ability to communicate with the app running them via the standard service API. Even in the desktop version, Firefox's sandbox is still substantially weaker (especially on Linux) and lacks full support for isolating sites from each other rather than only containing content as a whole. The sandbox has been gradually improving on the desktop but it isn't happening for their Android browser yet.

## Camera

GrapheneOS has the same camera capabilities and quality as the stock OS. It will match the stock OS when comparing the same app on each OS. GrapheneOS uses our own modern Camera app rather than the standard AOSP Camera app. On Pixels, Pixel Camera can be used as an alternative with more features. The section below has a detailed guide on using GrapheneOS Camera and the following section explains the remaining advantages of Pixel Camera on Pixels.

### GrapheneOS Camera app

GrapheneOS includes our own modern camera app focused on privacy and security. It includes modes for capturing images, videos and QR and barcode scanning along with additional modes based on CameraX vendor extensions (Portrait, HDR, Night, Face Retouch and Auto) on [devices where they're available](https://developer.android.com/training/camera/supported-devices) (Pixels currently only have support for Night mode).

Modes are displayed as tabs at the bottom of the screen. You can switch between modes using the tab interface or by swiping left/right anywhere on the screen. The arrow button at the top of the screen opens the settings panel and you can close it by pressing anywhere outside the settings panel. You can also swipe down to open the settings and swipe up to close it. Outside of the QR scanning mode, there's a row of large buttons above the tab bar for switching between the cameras (left), capturing images and starting/stopping video recording (middle) and opening the gallery (right). The volume keys can also be used as an equivalent to pressing the capture button. While recording a video, the gallery button becomes an image capture button for capturing images.

Our Camera app provides the system media intents used by other apps to capture images and record videos via the OS provided camera implementation. These intents can only be provided by a system app since Android 11, so the quality of the system camera is quite important.

The app has an in-app gallery and video player for images/videos taken with it. It currently opens an external editor activity for the edit action. GrapheneOS comes with AOSP Gallery which provides an editor activity. You can install a nicer photo editor and the Camera app will be able to use it. We plan to replace AOSP Gallery with a standalone variant of the gallery we're developing for the Camera app in the future.

Using the default 4:3 aspect ratio for image capture is recommended since 16:9 is simply cropped output on all supported devices. A device oriented towards video recording might actually have a wider image sensor but that's not the case for Pixels or nearly any other smartphone.

Image capture uses lightweight HDR+ on all supported Pixels and HDRnet for the preview on 5th generation Pixels. Using the torch or camera flash will result in HDR+ being disabled which is why automatic flash isn't enabled by default. The lightweight HDR+ doesn't use as many frames as the more aggressive Pixel Camera HDR+. CameraX extensions will eventually provide support for an HDR mode with more aggressive HDR+ taking/combining more than only around 3 frames. It currently supports a Night mode providing the Night Sight variant of HDR+ inflating the light of the scene through combining the frames. Other fancy features like Portrait mode will also depend on CameraX extensions being provided in the future. There isn't a timeline for when additional CameraX extensions will be added.

Zooming via pinch to zoom or the zoom slider will automatically make use of the wide angle and telephoto cameras on Pixels. 5th and 6th generation Pixels (4a (5G), 5, 5a, 6, 6 Pro) have a wide angle camera for zooming out to under 1x to capture a much wider field of view. Images taken with the wide angle lens won't match the quality of the normal camera, especially with 6th generation Pixels. Flagship 4th generation Pixels (4, 4 XL) have a telephoto camera providing 2x optical zoom and the Pixel 6 Pro has one providing 4x optical zoom.

By default, continuous auto focus, auto exposure and auto white balance are used across the whole scene. Tapping to focus will switch to auto focus, auto exposure and auto white balance based on that location. The focus timeout setting determines the timeout before it switches back the default mode. The exposure compensation slider on the left allows manually tuning exposure and will automatically adjust shutter speed, aperture and ISO without disrupting lightweight HDR+ support. Further configuration and tuning will be provided in the future.

The QR scanning mode only scans within the scanning square marked on the screen. The QR code should be aligned with the edges of the square but can have any 90 degree orientation. Non-standard inverted QR codes are fully supported. It's a very quick and high quality QR scanner able to easily scan very high density QR codes from Pixels. Every 2 seconds, it will refresh auto focus, auto exposure and auto white balance on the scanning square. It has full support for zooming in and out. The torch can be toggled with the button at the bottom center. The auto toggle at the bottom left can be used to toggle scanning for all supported barcode types. Alternatively, you can select which barcode types it should scan via the menu at the top. It only scans QR codes by default since that provides quick and reliable scanning. Most other types of barcodes can result in false positives. Each enabled type will slow down the scanning and will make it more prone to false positives especially with difficult to scan barcodes such as a dense QR code.

Camera permission is the only one that's required. Images and videos are stored via the Media Store API so media/storage permissions aren't required. The Microphone permission is needed for video recording by default but not when including audio is disabled. Location permission is only needed if you explicitly enabling location tagging.

By default, EXIF metadata is stripped for captured images and only includes the orientation. Stripping metadata for videos is planned but not supported yet. Orientation metadata isn't stripped since it's fully visible from how the image is displayed so it doesn't count as hidden metadata and is needed for proper display. You can toggle off stripping EXIF metadata in the More Settings menu opened from the settings dialog. Disabling metadata stripping will leave the timestamp, phone model, exposure configuration and other metadata. Location tagging is disabled by default and won't be stripped if you enable it.

Electronic Image Stabilization (EIS) is enabled by default on devices providing it via the Camera2 API and can be disabled using the video settings dialog.

Zero Shutter Lag (ZSL) is available as an opt-in toggle in More Settings and speeds up image capture for the Camera mode when flash is disabled.

### Pixel Camera

Pixel Camera (previously known as Google Camera) can take full advantage of the available cameras and image processing hardware as it can on the stock OS and does not require GSF or sandboxed Google Play on GrapheneOS. Direct TPU and GXP access by Google apps including Pixel Camera is controlled by a toggle added by GrapheneOS and doesn't provide them with any additional access to data. The toggle exists for attack surface reduction. Every app can use the TPU and GXP via standard APIs including the Android Neural Networks API and Camera2 API regardless.

We aim to reduce the benefits of Pixel Camera compared to GrapheneOS Camera over time, especially on Pixels. Many features of Pixel Camera will end up being available for GrapheneOS Camera in the next year or so via CameraX extensions including more aggressive HDR+, Night Sight and Portrait. Video features such as slow motion and time lapse are likely further away than within the next year. These video features could potentially be provided via CameraX vendor extensions or could be implemented via our own post-processing of the video output. Panorama, Photo Sphere, Astrophotography, Motion Photos, Frequent Faces, Dual Exposure Controls, Google Lens, etc. aren't on the roadmap for GrapheneOS Camera. Video frame rate configuration and H.265 support should be available for GrapheneOS Camera in the near future via CameraX improvements along with DNG (RAW) support in the further future.

## Exec spawning

GrapheneOS creates fresh processes (via exec) when spawning applications instead of using the traditional Zygote spawning model. This improves privacy and security at the expense of higher cold start app spawning time and higher initial memory usage. It doesn't impact runtime performance beyond the initial spawning time. It adds somewhere in the ballpark of 200ms to app spawning time on the flagship devices and is only very noticeable on lower-end devices with a weaker CPU and slower storage. The spawning time impact only applies when the app doesn't already have an app process and the OS will try to keep app processes cached in the background until memory pressure forces it to start killing them.

In the typical Zygote model, a template app process is created during boot and every app is spawned as a clone of it. This results in every app sharing the same initial memory content and layout, including sharing secrets that are meant to be randomized for each process. It saves time by reusing the initialization work. The initial memory usage is reduced due to copy-on-write semantics resulting in memory written only during initialization being shared between app processes.

The Zygote model weakens the security provided by features based on random secrets including Address Space Layout Randomization (ASLR), stack canaries, heap canaries, randomized heap layout and memory tags. It cripples these security features since every app has the values for every other app and the values don't change for fresh app processes until reboot. Much of the OS itself is implemented via non-user-facing apps with privileges reserved for OS components. The Zygote template is reused across user profiles, so it also provides a temporary set of device identifiers across profiles for each boot via the shared randomized values.

This feature can be disabled via **Settings &gt; Security & privacy &gt; Exploit protection &gt; Secure app spawning** if you prefer to have faster cold start app spawning time and lower app process memory usage instead of the substantial security benefits and the removal of the only known remaining direct device identifiers across profiles (i.e. not depending on fingerprinting global configuration, available storage space, etc. or using side channels).

## Bugs uncovered by security features

GrapheneOS substantially expands the standard mitigations for memory corruption vulnerabilities. Some of these features are designed to directly catch the memory corruption bugs either via an explicit check or memory protection and abort the program in order to prevent them from being exploited. Other features mitigate issues a bit less directly such as zeroing data immediately upon free, isolated memory regions, heap randomization, etc. and can also lead to latent memory corruption bugs crashing instead of the program continuing onwards with corrupted memory. This means that many latent memory corruption bugs in apps are caught along with some in the OS itself. These bugs are not caused by GrapheneOS, but rather already existed and are uncovered by the features. The features are aimed at preventing or hindering exploits, not finding bugs, but they do that as part of doing their actual job.

Similarly, some of the other privacy and security improvements reduce the access available to applications and they may crash. Some of these features are always enabled under the hood, while others like the Network and Sensors toggles are controlled by users via opt-in or opt-out toggles. Apps may not handle having access taken away like this, although it generally doesn't cause any issues as it's all designed to be friendly to apps and fully compatible rather than killing the application when it violates the rules.

You can enable our exploit protection compatibility mode via **Settings &gt; Apps &gt; `APP` &gt; Exploit protection compatibility mode**. The exploit protection compatibility mode toggle will:

- Switch from hardened\_malloc to Android's standard allocator (Scudo)
- Reduce address space size from 48 bit to Android's standard 39 bit
- Disable memory tagging, unless the app has opted-in to it (only on compatible devices)
- Allow native debugging (ptrace) access

All of these changes apply only to the selected app and can be toggled separately.

If you run into an application aborting, try to come up with a process for reproducing the issue and then capture a bug report via the 'Take bug report' feature in Developer options. Report an issue to [the GrapheneOS OS issue tracker](https://github.com/GrapheneOS/os-issue-tracker/issues) and email the bug report capture zip to [contact@grapheneos.org](mailto:contact@grapheneos.org) with the issue tracker number in the subject like "Bug report capture for issue #104". The bug report capture includes plain text 'tombstones' with logs, tracebacks, address space layout, register content and a tiny bit of context from memory from areas that are interesting for debugging. This may contain some sensitive data. Feel free to provide only the tombstone for the relevant crash and filter out information you don't want to send. However, it will be more difficult to debug if you provide less of the information. If the app doesn't work with sensitive information, just send the whole tombstone.

## Wi-Fi privacy

Wi-Fi on GrapheneOS is very privacy-friendly and is essentially anonymous as long as apps do not leak uniquely identifying information to the network. GrapheneOS avoids allowing itself to be fingerprinted as GrapheneOS, other than connections which are documented (see the [default connections FAQ](https://grapheneos.org/faq#default-connections)) and can be easily disabled or forced through a VPN service.

### Scanning

MAC randomization is always performed for Wi-Fi scanning. Pixel phones have firmware support for scanning MAC randomization going [significantly beyond a naive implementation](https://android-developers.googleblog.com/2017/04/changes-to-device-identifiers-in.html). On many other devices, there are identifiers exposed by Wi-Fi scanning beyond the MAC address such as the packet sequence number and assorted identifying information in the probe requests.

Avoid using hidden APs (i.e. APs not broadcasting their SSID) since all known hidden SSIDs end up being broadcast as part of scanning for networks to find them again. SSIDs are not broadcast for standard non-hidden APs. Hidden APs are only hidden when no devices are connected. It makes little sense as a privacy feature, especially for a non-mobile AP where knowing the AP exists can't be used for tracking it since it doesn't move. The feature reduces your privacy rather than increasing it. If you need to use a hidden AP, make sure to delete the saved network afterwards.

Wi-Fi and Bluetooth scanning for improving location detection are disabled by default, unlike the stock OS. These can be toggled in **Settings &gt; Location &gt; Location services &gt; Wi-Fi and Bluetooth scanning**. These features enable scanning even when Wi-Fi or Bluetooth is disabled, so these need to be kept disabled to fully disable the radios when Wi-Fi and Bluetooth are disabled. GrapheneOS itself doesn't currently include a supplementary location service based on Wi-Fi and Bluetooth scanning. These options impact whether apps such as sandboxed Google Play are able to use the functionality if you grant them the Location permission. GrapheneOS plans to eventually include an OS service based on local databases rather than a network-based service giving the user's location to a server whenever location is being used.

### Associated with an Access Point (AP)

Associated MAC randomization is performed by default. This can be controlled per-network in **Settings &gt; Network & internet &gt; Internet &gt; `NETWORK` &gt; Privacy**.

In the stock OS, the default is to use a unique persistent random MAC address for each network. It has 2 options available: "Use randomized MAC (default)" and "Use device MAC". In GrapheneOS, the default is generating a new random MAC address when connecting to a network. It has 3 options available: "Use per-connection randomized MAC (default)", "Use per-network randomized MAC" and "Use device MAC".

In rare cases, broken routers are unable to accept new clients once their DHCP table is full instead of clearing the last recently used entry. You can work around this by manually clearing the DHCP table via the router administration page and can switch to the per-network randomized MAC mode to avoid triggering the issue again. This would prevent a router being used in any situation where many clients naturally come and go even without per-connection MAC randomization and is not generally an issue for any modern routers. Per-connection MAC randomization only makes it more likely to find a one of the rare routers with this issue.

The DHCP client uses the anonymity profile rather than sending a hostname so it doesn't compromise the privacy offered by MAC randomization. When the per-connection MAC randomization added by GrapheneOS is being used, DHCP client state is flushed before reconnecting to a network to avoid revealing that it's likely the same device as before.

GrapheneOS also disables support for stable link-local IPv6 addresses, since these have the potential to be used as identifiers. It's more sensible to use typical link-local address generation based on the (randomized) MAC address since link-local devices have access to both. As of Android 11, Android only uses stable link-local privacy addresses when MAC randomization is disabled, so we no longer need to disable the feature.

## Network location

For more information on the network location feature and how it works, see the [features section](https://grapheneos.org/features#network-location).

The setting can be found at **Settings &gt; Location &gt; Location services &gt; Network location**. The available options are using Apple's network location service, or a GrapheneOS proxy to that service.

To use this feature, you need to make sure that you either have Wi-Fi enabled, or that Wi-Fi scanning is enabled at **Settings &gt; Location &gt; Location services &gt; Wi-Fi scanning**, or you have cell reception (far less accurate). Enabling the Wi-Fi scanning setting will allow you to use Wi-Fi-based network location even if you disable the global Wi-Fi toggle.

## LTE-only mode

If you have a reliable LTE connection from your carrier, you can reduce attack surface by disabling 2G, 3G and 5G connectivity in **Settings &gt; Network & internet &gt; SIMs &gt; `SIM` &gt; Preferred network type**. Traditional voice calls will only work in the LTE-only mode if you have either an LTE connection and VoLTE (Voice over LTE) support or a Wi-Fi connection and VoWi-Fi (Voice over Wi-Fi) support. VoLTE and VoWi-Fi works on GrapheneOS for most carriers unless they restrict it to carrier phones. Some carriers may be missing VoWi-Fi due to us not including their proprietary apps. Please note that AT&T users may see "5Ge" being used when LTE Only mode is enabled as AT&T intentionally mislabel LTE services as "5Ge" to mislead users.

This feature is not intended to improve the confidentiality of traditional calls and texts, but it might somewhat raise the bar for some forms of interception. It's not a substitute for end-to-end encrypted calls and texts or even transport layer encryption. LTE does provide basic network authentication and encryption, but it's for the network itself. The intention of the LTE-only feature is only hardening against remote exploitation by disabling an enormous amount of both legacy code (2G, 3G) and bleeding edge code (5G).

## Sandboxed Google Play

GrapheneOS has a compatibility layer providing the option to install and use the official releases of Google Play in the standard app sandbox. Google Play receives absolutely no special access or privileges on GrapheneOS as opposed to bypassing the app sandbox and receiving a massive amount of highly privileged access. Instead, the compatibility layer teaches it how to work within the full app sandbox. It also isn't used as a backend for the OS services as it would be elsewhere since GrapheneOS doesn't use Google Play even when it's installed.

Since the Google Play apps are simply regular apps on GrapheneOS, you install them within a specific user or work profile and they're only available within that profile. Only apps within the same profile can use it and they need to explicitly choose to use it. It works the same way as any other app and has no special capabilities. As with any other app, it can't access data of other apps and requires explicit user consent to gain access to profile data or the standard permissions. Apps within the same profile can communicate with mutual consent and it's no different for sandboxed Google Play.

Sandboxed Google Play is close to being fully functional and provides near complete compatibility with the app ecosystem depending on Google Play. Only a small subset of privileged functionality which we haven't yet ported to different approaches with our compatibility layer is unavailable. Some functionality is inherently privileged and can't be provided as part of the compatibility layer.

The vast majority of Play services functionality works perfectly including dynamically downloaded and updated modules (dynamite modules) and functionality provided by modular app components such as Google Play Games. By default, location requests are rerouted to a reimplementation of the Play geolocation service provided by GrapheneOS. You can disable rerouting and use the standard Play services geolocation service instead if you want the Google network location service and related features. This shouldn't be needed outside of testing or obscure use cases, since GrapheneOS provides its own opt-in [Network Location](https://grapheneos.org/features#network-location) feature.

Our compatibility layer includes full support for the Play Store. Play Store services are fully available including in-app purchases, Play Asset Delivery, Play Feature Delivery and app and content license checks. It can install, update and uninstall apps with the standard approach requiring that the user authorizes it as an app source and consents to each action. It will use the standard Android 12+ unattended update feature to do automatic updates for apps where it was the last installer.

### Installation

The simplest approach is to only use the Owner user profile. Apps installed in the Owner profile are sandboxed the same way as everywhere else and don't receive any special access. If you want to choose which apps use Google Play rather than making it available to all of them, install it in a separate user or work profile for apps depending on Google Play. You could also do it the other way around, but it makes more sense to try to use as much as possible without Google Play rather than treating not using it as the exceptional case.

To install sandboxed Google Play, open our App Store, select Google Play services and install it. This will install both Google Play services and Google Play Store which are interdependent. Existing installs of sandboxed Google Play from before Android 15 will also have Google Services Framework installed and it shouldn't be removed.

Google Play services and Google Play Store are updated through the App Store.

You should give a battery optimization exception to Google Play services for features like push notifications to work properly in the background. It isn't needed for the Google Play Store app.

Signing in into a Google account is optional, unless you want to use features depending on being signed into an account. For example, some apps use Google account authentication instead of their accounts having a username and password. The Play Store requires being signed into an account in order to install apps or use in-app purchases. This is still true even for an alternate frontend to the Play Store. Aurora Store still requires an account but fetches shared account credentials from Aurora Store's service by default.

The Play Store provides many services used by apps including Play Asset Delivery, Play Feature Delivery, in-app purchases and license checks for paid apps. The Play Store app is also the most secure way to install and update apps from the Play Store.

Our compatibility layer has support for Play Games Services which you can obtain by installing Google Play Games from the Play Store. Many games on the Play Store depend on having Google Play Games installed.

### Configuration

The compatibility layer has a configuration menu available at **Settings &gt; Apps &gt; Sandboxed Google Play**.

By default, apps using Google Play geolocation are redirected to our own implementation on top of the standard OS geolocation service. You don't need to grant any permissions to Google Play or change any settings for working location in apps using Google Play geolocation due to our rerouting feature.

This is not recommended unless you're testing something or have an obscure use case since our [network location](https://grapheneos.org/features#network-location) feature can be used instead, but if you want to use Google's network location service to provide location estimates without satellite reception, you can follow these steps:

1. Disable the "Reroute location requests to OS APIs" toggle.
2. Grant "Allow all the time" Location access to Google Play services along with the Nearby Devices permission for it to have all the access it needs.
3. Use the "Google Location Accuracy" link from the sandboxed Google Play configuration menu to access the Google Play services menu for opting into their network location service.
4. To take advantage of Wi-Fi and Bluetooth scanning, you also need to enable the scanning toggles in **Settings &gt; Location  &gt; Location services** which are disabled by default and control whether apps with the required permissions can scan when Wi-Fi and Bluetooth are otherwise disabled.

Re-routing location to the OS geolocation service will use more power than using the Google Play geolocation service unless you enable our opt-in [network location](https://grapheneos.org/features#network-location) feature.

The Google Location Accuracy and Google settings activities would normally be integrated into the OS but we don't include any of the standard Google Play integration so there needs to be an app providing a way to access them.

The menu also provides links to this usage guide, Play services system settings, Play Store system settings and Google settings. The Play services and Play Store system settings are only included for convenience since they can be accessed the same way as any other app via **Settings &gt; Apps**.

### Limitations

Our compatibility layer has to be expanded on a case-by-case basis to teach Play services to work as a regular app without any of the invasive access and integration it expects. In many cases, it doesn't truly need the access or we can teach it to use the regular approach available to a normal app. In some cases, the functionality it offers fundamentally requires privileged access and cannot be supported. For example, Android Auto cannot be supported by default as part of the baseline compatibility layer, but is supported as an extension of it with dedicated toggles for the functionality that's not possible to implement another way. The same applies to other highly invasive OS integration/control or privileged access to hardware. Our compatibility layer is a very actively developed work in progress and most of the remaining unavailable functionality is quickly becoming supported. In the future, we can also support redirection for more APIs such as FIDO2 rather than only the geolocation service.

Functionality depending on the OS integrating Play services and using it as a backend is unavailable. An OS integrating Play uses it as the backend for OS services such as geolocation. GrapheneOS never uses it as the backend/provider for OS services. In cases such as text-to-speech (TTS) where the OS allows the user to choose the provider, Play services can often be used. It's on a level playing field with other apps on GrapheneOS.

## eSIM support

By default, GrapheneOS has always shipped with baseline support for eSIM, where users can use any eSIMs installed previously on the device. However, in order to manage and add eSIMs, proprietary Google functionality is needed. This is fully disabled by default.

Even though proprietary functionality is needed, eSIM management on GrapheneOS doesn't require any dependency on Google Play, and it never shares data to Google Play even when installed. It won't connect to a Google service unless the carrier uses one themselves.

eSIM support can be enabled in **Settings &gt; Network & internet &gt; eSIM support**. The toggle is persistent across every boot.

Note that if the eSIM installation process does not progress past the "Checking network info..." stage despite having a stable Internet connection, you may need to call the USSD code `*#*#4636#*#*` and then enable DSDS in the menu that is presented.

If an eSIM locked with a PIN is used, it is recommended to leave the eSIM support toggle enabled even after activating the eSIM. This will allow you to disable the eSIM on the lockscreen in case the PIN is forgotten. If the eSIM support toggle is disabled and the PIN is forgotten, there is no way to access the device unless the PUK is provided.

## Android Auto

GrapheneOS provides an option to install and use the official releases of Android Auto.

Android Auto requires privileged access in order to work. GrapheneOS uses an extension of the sandboxed Google Play compatibility layer to make Android Auto work with a reduced level of privileges.

To install Android Auto, use the GrapheneOS App Store. Android Auto can't be installed through the Play Store or other app sources. Android Auto depends on sandboxed Google Play, you'll be prompted to install it if it's not already installed.

After installation, Android Auto has to be set up from the **Settings &gt; Apps &gt; Sandboxed Google Play &gt; Android Auto** configuration screen, which contains permission toggles, links to related configuration screens, configuration tips, and links to optional Android Auto dependencies. To set up Android Auto in Private Space, go to **Settings &gt; Security and privacy &gt; Private Space &gt; Sandboxed Google Play &gt; Android Auto**.

The permission toggles ask for a confirmation before turning on. The confirmation popup explains what access each permission toggle provides.

By default, Android Auto is not granted any kind of privileged access. It's treated the same way other apps are treated.

In order to work, Android Auto has to be granted baseline permissions for wired or wireless Android Auto. Wired Android Auto requires far less access than wireless Android Auto does. Baseline permissions are controlled by the "Allow permissions for wired/wireless Android Auto" toggles.

For some cars, baseline permissions for wireless Android Auto are needed even when using wired Android Auto. Therefore, if wired Android Auto is unable to connect to the car with only wired permissions granted, try granting wireless permissions instead.

To forward notifications from the device to the car, Android Auto has to be allowed notification access. The notification access settings are linked below the permission toggles.

In order to show up in the Android Auto car interface, apps have to be installed from the Play Store and include Android Auto support.

See Google's [Android Auto Help](https://support.google.com/androidauto/topic/6106969) pages for further Android Auto setup steps and usage instructions.

## Banking apps

Banking apps are a particularly problematic class of apps for compatibility with alternate operating systems. Some of these work fine with any GrapheneOS configuration but most of them have extensive dependencies on Play services. For many of these apps, it's enough to set up the GrapheneOS sandboxed Google Play feature in the same profile. Unfortunately, there are further complications not generally encountered with non-financial apps.

Many of these apps have their own crude anti-tampering mechanisms trying to prevent inspecting or modifying the app in a weak attempt to hide their code and API from security researchers. GrapheneOS allows users to disable **Native code debugging** via a toggle in **Settings &gt; Security & privacy &gt; Exploit protection** to improve the app sandbox and this can interfere with apps debugging their own code to add a barrier to analyzing the app. You should try enabling this again if you've disabled it and are encountering compatibility issues with these kinds of apps.

Banking apps are increasingly using Google's SafetyNet attestation service to check the integrity and certification status of the operating system. GrapheneOS passes the `basicIntegrity` check but isn't certified by Google so it fails the `ctsProfileMatch` check. Most apps currently only enforce weak software-based attestation which can be bypassed by spoofing what it checks. GrapheneOS doesn't attempt to bypass the checks since it would be very fragile and would repeatedly break as the checks are improved. Devices launched with Android 8 or later have hardware attestation support which cannot be bypassed without leaked keys or serious vulnerabilities so the era of being able to bypass these checks by spoofing results is coming to an end regardless.

The hardware attestation feature is part of the Android Open Source Project and is fully supported by GrapheneOS. SafetyNet attestation chooses to use it to enforce using Google certified operating systems. However, app developers can use it directly and permit other properly signed operating systems upholding the security model. GrapheneOS has a [detailed guide](https://grapheneos.org/articles/attestation-compatibility-guide) for app developers on how to support GrapheneOS with the hardware attestation API. Direct use of the hardware attestation API provides much higher assurance than using SafetyNet so these apps have nothing to lose by using a more meaningful API and supporting a more secure OS.

A 3rd party community-sourced effort containing [banking app compatibility](https://privsec.dev/posts/android/banking-applications-compatibility-with-grapheneos/) information is maintained by PrivSec.dev. GrapheneOS does not make any guarantees regarding the list's validity.

## App link verification

Android apps can declare associations with domains in order to handle those URLs in the app automatically. For security reasons, app links are disabled by default to prevent apps intercepting arbitrary URLs. First party apps associated with a domain are expected to be authorized by the domain. Apps can ask for their app links to be verified by the OS by marking them with `autoVerify` in their manifest. The OS will securely confirm that the domain authorizes the app to handle the domain's URLs. Users can also manually enable an app's link associations via **Settings &gt; Apps &gt; `APP` &gt; Open by default &gt; Add link**. Apps can ask users to enable the associations and send them to this page in the Settings app.

As an example, the first party YouTube app will have the app links verified by the OS automatically while the NewPipe app requires manually enabling handling links for YouTube and other sites.

Verification of app links by the OS is done by the Intent Filter Verification Service system app. It will use an HTTPS GET request to fetch `https://example.com/.well-known/assetlinks.json` in order to process a request to verify that an app can handle `example.com` links. The app needs to have their app id and signing keys authorized by the domain in order for the verification to succeed.

These network requests by the Intent Filter Verification Service to verify app associations with domains are commonly confused for network requests made by the apps. It's simply an HTTPS GET request without identifying information and doesn't offer a communication channel with the app. Redirects won't be followed so there will be a single request for each attempt to verify a domain.

If you don't want automatic app link verification, you can disable the Network permission added by GrapheneOS for the Intent Filter Verification Service system app. In the future, we may provide a way to disable verification directly instead of stopping it from working. It will make heavily throttled attempts to verify a domain after the check failed which won't negatively impact battery life due to the conservative JobScheduler-based implementation.

For more details, see the [developer documentation on app link verification](https://developer.android.com/training/app-links/verify-android-applinks).

## Carrier functionality

GrapheneOS aims to work with all carriers that are officially supported by Google on the stock operating system on Pixel devices. Wi-Fi Calling, VoLTE, Visual Voicemail, MMS, SMS, Calling and 5G (SA and NSA) all are supported, however some functionality may not be usable due to Google not supporting carriers on the stock OS officially or due to GrapheneOS not shipping proprietary apps required in order for this functionality to work on some carriers. GrapheneOS extracts CarrierConfigs, APNs, modem configurations, Visual Voicemail configurations and MMS configurations from the stock operating system to ensure users get easy carrier support that "just works".

Please note that in some regions, LTE is referred to as 4G.

Generally 5G, SMS, MMS, Calls and VoLTE will work fine on GrapheneOS with officially supported carriers by Google. Wi-Fi calling may vary due to a reliance on proprietary Google apps which GrapheneOS does not ship.

If you are having issues with Visual Voicemail, please be aware that AT&T USA users are unable to use this feature currently due to a lack of AOSP support. Other carriers are done on a best effort basis. We would suggest using [Google Dialer](https://play.google.com/store/apps/details?id=com.google.android.dialer) with sandboxed Google Play if you are unable to get this feature working.

If you are having problems sending or receiving SMS/MMS messages, we suggest that you perform the following steps:

- Deregister your phone number from [Apple iMessage](https://selfsolve.apple.com/deregister-imessage/)
- Deregister your phone number from [Google Chat Features](https://messages.google.com/disable-chat)
- Deregister your phone number from your carrier's RCS service (Not all carriers have this)

If you continue to have problems despite following the instructions above or you have another carrier related issue, we suggest that you perform the following steps:

- Some carriers require you to explicitly opt in to use services such as Wi-Fi calling. Consult your carrier's documentation on the process for this or contact them.
- **Reset Mobile Network Settings** in **Settings &gt; System &gt; Reset options** and then reboot the device.
- USA users only: You may need to request your carrier to enable CDMA-less mode if you have issues.
- Follow your carrier's instructions for setting up APNs, this can be found in **Settings &gt; Network & internet &gt; SIMs &gt; `SIM` &gt; Access Point Names**
- If calls do not work and you have [LTE-only mode](https://grapheneos.org/usage#lte-only-mode) enabled, try toggling it off. If "Allow 2G" is disabled, try toggling it back on. Your carrier may not properly support VoLTE.
- As a last resort you may need to ask your carrier for a replacement SIM card.

Some carriers may restrict functionality, such as VoLTE, on imported Pixel devices as they only whitelist the IMEI ranges of Pixel device SKUs which were sold locally. You can check your SKU on GrapheneOS by going to **Settings &gt; About phone &gt; Model &gt; Hardware SKU** and using the [official Google documentation](https://support.google.com/pixelphone/answer/7158570). You should check if such functionality works on the stock OS to troubleshoot. It is not possible to change the IMEI on a production device and GrapheneOS cannot add support for it since the hardware doesn't support it.

Android 12 introduced support for the [GSMA TS.43](https://www.gsma.com/newsroom/wp-content/uploads//TS.43-v11.0-Service-Entitlement-Configuration.pdf) standard where provisioning for VoLTE, VoNR and Wi-Fi calling may be handled by Google Firebase. Currently it is very rare for carriers to be using Firebase to handle this. It is unlikely, but technically possible, that with such carriers you may be required to install sandboxed Google Play in order to obtain the former mentioned functionality where the carrier has not implemented fallback provisioning via SMS. Currently only US Cellular, Orange France, Cspire US, and Cellcom US are using this standard.

GrapheneOS includes bypasses for carrier restrictions on APN editing, tethering via USB, Ethernet, Bluetooth and Wi-Fi and the ability to disable 2G (only on 6th generation Pixel devices onwards) actions which would not necessarily have been possible on the stock operating system.

### Carrier settings overrides

GrapheneOS has support for overriding a subset of carrier settings including forcing the availability of 5G, VoLTE, VoNR, Wi-FI calling and cross-SIM calling. This is useful when the stock OS has missing or incomplete configurations for some carriers. These overrides are saved per SIM and can be configured under **Settings &gt; Network & internet &gt; SIMs &gt; `SIM` &gt; Carrier settings overrides**.

### Cross-SIM calling

For dual SIM setups, GrapheneOS has support for cross-SIM calling (backup calling) which allows you to make calls using a SIM via the mobile data provided by another SIM similarly to Wi-Fi calling. This requires Automatic data switching to be enabled in **Settings &gt; Network & internet &gt; SIMs** . This is useful when the primary SIM has no connectivity and you have a second SIM with data, e.g. roaming outside of your country with a travel eSIM.

Cross-SIM calling is active when "Backup Calling" is added to the mobile operator name.

### RCS

GrapheneOS has support for RCS in [Google Messages](https://play.google.com/store/apps/details?id=com.google.android.apps.messaging) with sandboxed Google Play. With Google Messages, Google Play services handles a part of the verification and configuration for RCS. These steps should ideally be done before opening Google Messages and trying to activate RCS:

- RCS with Google Messages is currently only known to work in the Owner user profile.
- Some carriers use a verification method (GSMA TS.43) that requires Google Play services to have the permission to do ICC authentication with device identifiers. This can be granted under **Settings &gt; Apps &gt; Sandboxed Google Play &gt; Play services special permissions**.
- Google Play services needs to be granted the Phone permission.
- Google Messages needs to be set as the default SMS app.

---
url: https://grapheneos.org/releases
title: Releases
words: 27321
---
# Releases

## About the releases

These releases are available as both tags in the source code repositories and official builds.

The factory images are used for the initial installation and can be verified with OpenSSH. See the [installation page](https://grapheneos.org/install/) for details.

GrapheneOS uses automatic over-the-air updates, but full update packages are listed below for uncommon use cases like never connecting the device to the internet. A full update package can upgrade from any past version to the new version. The over-the-air updates use delta update packages when available. Those aren't currently linked below but may be in the future once they're being used more consistently. Update packages are not for performing the initial installation and you should ignore incorrect guides trying to use them to install the OS.

The update packages have an internal signature verified by the update client (or recovery when sideloading). Downgrade attacks are also prevented, and downgrades cannot be done unless a special downgrade update package has been signed with the release key. The internal payload for `update_engine` is also signed, providing another layer of signature verification and downgrade protection. Verified boot and the hardware-backed keystore also act as a final layer of protection.

Releases are tested by the developers and are then pushed out via the Alpha channel. The release is then pushed out via the Beta channel shortly afterwards. Finally, the release is then pushed out via the Stable channel after being tested by users using the Beta channel. In some cases, problems are caught during Beta channel testing and a new release is made via the Beta channel to replace the aborted one. In general, it's not possible to downgrade unless a downgrade update package is generated, so use the Stable channel if you cannot tolerate dealing with temporary issues while a new release for the Beta channel is being created.

## Release announcements

Releases are announced on this page and included in an [atom feed](https://grapheneos.org/releases.atom) usable from any standard feed reader app. A release announcement indicates that the source code tags are available and that the official builds will soon be pushed out via the Alpha channel.

The main place to discuss the releases are the threads posted on our [our discussion forum](https://discuss.grapheneos.org) with the [Announcements tag](https://discuss.grapheneos.org/t/announcements).

The announcements are also posted from the [@GrapheneOS X account](https://x.com/GrapheneOS), the [@GrapheneOS Mastodon account](https://grapheneos.social/@GrapheneOS), the [@grapheneos.org Bluesky account](https://bsky.app/profile/grapheneos.org), the [official subreddit](https://reddit.com/r/GrapheneOS), and in the official [GrapheneOS chat rooms](https://grapheneos.org/contact#community) including the dedicated releases room/channel on the respective chat platform (Matrix and Discord). Each of these links to the main discussion thread on our discussion forum.

## Devices

### Pixel 10a

ChannelVersionDownloads

Stable[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/stallion-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/stallion-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/stallion-ota_update-2026100600.zip)

Beta[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/stallion-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/stallion-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/stallion-ota_update-2026100600.zip)

Alpha[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/stallion-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/stallion-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/stallion-ota_update-2026100600.zip)

### Pixel 10 Pro Fold

ChannelVersionDownloads

Stable[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/rango-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/rango-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/rango-ota_update-2026100600.zip)

Beta[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/rango-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/rango-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/rango-ota_update-2026100600.zip)

Alpha[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/rango-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/rango-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/rango-ota_update-2026100600.zip)

### Pixel 10 Pro XL

ChannelVersionDownloads

Stable[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/mustang-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/mustang-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/mustang-ota_update-2026100600.zip)

Beta[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/mustang-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/mustang-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/mustang-ota_update-2026100600.zip)

Alpha[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/mustang-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/mustang-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/mustang-ota_update-2026100600.zip)

### Pixel 10 Pro

ChannelVersionDownloads

Stable[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/blazer-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/blazer-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/blazer-ota_update-2026100600.zip)

Beta[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/blazer-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/blazer-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/blazer-ota_update-2026100600.zip)

Alpha[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/blazer-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/blazer-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/blazer-ota_update-2026100600.zip)

### Pixel 10

ChannelVersionDownloads

Stable[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/frankel-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/frankel-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/frankel-ota_update-2026100600.zip)

Beta[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/frankel-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/frankel-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/frankel-ota_update-2026100600.zip)

Alpha[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/frankel-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/frankel-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/frankel-ota_update-2026100600.zip)

### Pixel 9a

ChannelVersionDownloads

Stable[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/tegu-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/tegu-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/tegu-ota_update-2026100600.zip)

Beta[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/tegu-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/tegu-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/tegu-ota_update-2026100600.zip)

Alpha[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/tegu-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/tegu-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/tegu-ota_update-2026100600.zip)

### Pixel 9 Pro Fold

ChannelVersionDownloads

Stable[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/comet-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/comet-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/comet-ota_update-2026100600.zip)

Beta[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/comet-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/comet-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/comet-ota_update-2026100600.zip)

Alpha[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/comet-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/comet-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/comet-ota_update-2026100600.zip)

### Pixel 9 Pro XL

ChannelVersionDownloads

Stable[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/komodo-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/komodo-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/komodo-ota_update-2026100600.zip)

Beta[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/komodo-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/komodo-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/komodo-ota_update-2026100600.zip)

Alpha[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/komodo-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/komodo-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/komodo-ota_update-2026100600.zip)

### Pixel 9 Pro

ChannelVersionDownloads

Stable[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/caiman-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/caiman-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/caiman-ota_update-2026100600.zip)

Beta[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/caiman-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/caiman-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/caiman-ota_update-2026100600.zip)

Alpha[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/caiman-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/caiman-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/caiman-ota_update-2026100600.zip)

### Pixel 9

ChannelVersionDownloads

Stable[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/tokay-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/tokay-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/tokay-ota_update-2026100600.zip)

Beta[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/tokay-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/tokay-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/tokay-ota_update-2026100600.zip)

Alpha[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/tokay-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/tokay-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/tokay-ota_update-2026100600.zip)

### Pixel 8a

ChannelVersionDownloads

Stable[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/akita-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/akita-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/akita-ota_update-2026100600.zip)

Beta[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/akita-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/akita-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/akita-ota_update-2026100600.zip)

Alpha[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/akita-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/akita-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/akita-ota_update-2026100600.zip)

### Pixel 8 Pro

ChannelVersionDownloads

Stable[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/husky-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/husky-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/husky-ota_update-2026100600.zip)

Beta[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/husky-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/husky-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/husky-ota_update-2026100600.zip)

Alpha[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/husky-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/husky-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/husky-ota_update-2026100600.zip)

### Pixel 8

ChannelVersionDownloads

Stable[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/shiba-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/shiba-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/shiba-ota_update-2026100600.zip)

Beta[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/shiba-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/shiba-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/shiba-ota_update-2026100600.zip)

Alpha[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/shiba-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/shiba-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/shiba-ota_update-2026100600.zip)

### Pixel Fold

ChannelVersionDownloads

Stable[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/felix-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/felix-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/felix-ota_update-2026100600.zip)

Beta[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/felix-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/felix-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/felix-ota_update-2026100600.zip)

Alpha[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/felix-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/felix-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/felix-ota_update-2026100600.zip)

### Pixel Tablet

ChannelVersionDownloads

Stable[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/tangorpro-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/tangorpro-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/tangorpro-ota_update-2026100600.zip)

Beta[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/tangorpro-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/tangorpro-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/tangorpro-ota_update-2026100600.zip)

Alpha[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/tangorpro-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/tangorpro-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/tangorpro-ota_update-2026100600.zip)

### Pixel 7a

ChannelVersionDownloads

Stable[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/lynx-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/lynx-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/lynx-ota_update-2026100600.zip)

Beta[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/lynx-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/lynx-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/lynx-ota_update-2026100600.zip)

Alpha[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/lynx-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/lynx-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/lynx-ota_update-2026100600.zip)

### Pixel 7 Pro

ChannelVersionDownloads

Stable[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/cheetah-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/cheetah-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/cheetah-ota_update-2026100600.zip)

Beta[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/cheetah-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/cheetah-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/cheetah-ota_update-2026100600.zip)

Alpha[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/cheetah-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/cheetah-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/cheetah-ota_update-2026100600.zip)

### Pixel 7

ChannelVersionDownloads

Stable[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/panther-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/panther-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/panther-ota_update-2026100600.zip)

Beta[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/panther-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/panther-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/panther-ota_update-2026100600.zip)

Alpha[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/panther-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/panther-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/panther-ota_update-2026100600.zip)

### Pixel 6a

ChannelVersionDownloads

Stable[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/bluejay-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/bluejay-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/bluejay-ota_update-2026100600.zip)

Beta[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/bluejay-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/bluejay-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/bluejay-ota_update-2026100600.zip)

Alpha[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/bluejay-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/bluejay-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/bluejay-ota_update-2026100600.zip)

### Pixel 6 Pro

ChannelVersionDownloads

Stable[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/raven-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/raven-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/raven-ota_update-2026100600.zip)

Beta[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/raven-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/raven-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/raven-ota_update-2026100600.zip)

Alpha[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/raven-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/raven-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/raven-ota_update-2026100600.zip)

### Pixel 6

ChannelVersionDownloads

Stable[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/oriole-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/oriole-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/oriole-ota_update-2026100600.zip)

Beta[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/oriole-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/oriole-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/oriole-ota_update-2026100600.zip)

Alpha[2026100600](https://grapheneos.org/releases#2026100600)

- [Install zip](https://releases.grapheneos.org/oriole-install-2026100600.zip)
- [Install zip signature](https://releases.grapheneos.org/oriole-install-2026100600.zip.sig)
- [Signed update package](https://releases.grapheneos.org/oriole-ota_update-2026100600.zip)

## Changelog

List of tagged releases. Snapshot releases without tags such as early releases of the project and early device support releases are not listed.

The changelog is also available as an [atom feed](https://grapheneos.org/releases.atom) usable in any standard feed reader.

The [legacy changelog page](https://grapheneos.org/history/legacy-changelog) has the release notes from before the rebranding of the project in 2018 and 2019.

### 2026100600

Tags:

- [2026100600](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026100600) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026100200 release:

- full 2026-10-05 security patch level
- Pixels: update to October 2026 firmware and HALs
- fix upstream integer overflow bug in ZipFileRO.cpp causing memory corruption with a 65,535 byte entry name
- use speed compiler filter for all system\_server JARs and non-APEX APKs instead of using speed-profile when a profile exists (improves core OS performance)
- Contacts: don't offer local accounts for new labels when default account is cloud
- kernel (6.1): update to latest GKI LTS branch revision
- kernel (6.12): update to latest GKI LTS branch revision including update to 6.12.94
- kernel (6.18): update to latest GKI LTS branch revision
- kernel (6.6, 6.12, 6.18): change approach to disabling Android's vendor hooks for INIT\_ON\_FREE to avoid conflicts
- Seedvault: migrate to the latest upstream Android 17 branch from our own port to Android 17 to get the latest upstream improvements
- Seedvault: implement downstream fixes for a bunch of bugs and user interface deficiencies
- Vanadium: update to [version 154.0.8037.126.0](https://github.com/GrapheneOS/Vanadium/releases/tag/154.0.8037.126.0)
- GmsCompatConfig: update to [version 176](https://github.com/GrapheneOS/platform_packages_apps_GmsCompat/releases/tag/config-176)

All of the Android 17 security patches from the current November 2026, December 2026, January 2027, February 2027, March 2027 and April 2027 Android Security Bulletins are included in the 2026100601 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-58814, CVE-2026-58820, CVE-2026-58868, CVE-2026-58876, CVE-2026-58882, CVE-2026-58984, CVE-2026-59062, CVE-2026-59069
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-48600, CVE-2026-0053, CVE-2026-28619, CVE-2026-28635, CVE-2026-28643, CVE-2026-28645, CVE-2026-45522, CVE-2026-45523, CVE-2026-47964, CVE-2026-49914, CVE-2026-49935, CVE-2026-55260, CVE-2026-55272, CVE-2026-55274, CVE-2026-55284, CVE-2026-58860, CVE-2026-58866, CVE-2026-58867, CVE-2026-58869, CVE-2026-58870, CVE-2026-58871, CVE-2026-58872, CVE-2026-58875, CVE-2026-58877, CVE-2026-58879, CVE-2026-58883, CVE-2026-58884, CVE-2026-58885, CVE-2026-58886, CVE-2026-58933, CVE-2026-58934, CVE-2026-58935, CVE-2026-58937, CVE-2026-58938, CVE-2026-58943, CVE-2026-58944, CVE-2026-58946, CVE-2026-58949, CVE-2026-58951, CVE-2026-58953, CVE-2026-58954, CVE-2026-58955, CVE-2026-58956, CVE-2026-58957, CVE-2026-58958, CVE-2026-58960, CVE-2026-58961, CVE-2026-58962, CVE-2026-58963, CVE-2026-58964, CVE-2026-58965, CVE-2026-58966, CVE-2026-58968, CVE-2026-58969, CVE-2026-58970, CVE-2026-58971, CVE-2026-58972, CVE-2026-58973, CVE-2026-58974, CVE-2026-58975, CVE-2026-58976, CVE-2026-58978, CVE-2026-58979, CVE-2026-58985, CVE-2026-58986, CVE-2026-58988, CVE-2026-58990, CVE-2026-58993, CVE-2026-58994, CVE-2026-58995, CVE-2026-58997, CVE-2026-58998, CVE-2026-59000, CVE-2026-59001, CVE-2026-59002, CVE-2026-59003, CVE-2026-59004, CVE-2026-59005, CVE-2026-59006, CVE-2026-59007, CVE-2026-59008, CVE-2026-59011, CVE-2026-59013, CVE-2026-59014, CVE-2026-59015, CVE-2026-59016, CVE-2026-59017, CVE-2026-59020, CVE-2026-59021, CVE-2026-59022, CVE-2026-59023, CVE-2026-59028, CVE-2026-59031, CVE-2026-59032, CVE-2026-59034, CVE-2026-59049, CVE-2026-59050, CVE-2026-59051, CVE-2026-59054, CVE-2026-59055, CVE-2026-59056, CVE-2026-59057, CVE-2026-59058, CVE-2026-59059, CVE-2026-59063, CVE-2026-59064, CVE-2026-59065, CVE-2026-59066, CVE-2026-59067, CVE-2026-59068, CVE-2026-59070, CVE-2026-59071

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026100200

Tags:

- [2026100200](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026100200) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026092500 release:

- kernel (Pixel): restore Android 17 (CP2A) mmap read-ahead behavior to resolve stuttering due to memory pressure caused by an upstream Pixel kernel change in Android 17 QPR1
- disable unprivileged hardware keepalives since it creates a VPN leak
- raise listed security patch level to 2026-09-05 since we've already had the 2026-09-05 Android security patch level for a while and have all the Pixel firmware/driver updates from Android 17 QPR1 since the last release
- kernel (6.1): update to latest GKI LTS branch revision
- kernel (6.6): update to latest GKI LTS branch revision
- kernel (6.12): update to latest GKI LTS branch revision
- kernel (6.18): update to latest GKI LTS branch revision including update to 6.18.33
- fix upstream Android bug causing last modified time being set incorrectly for files restored from Android backups due to it passing seconds to an API taking milliseconds (files had last modified time set to January 1970)
- Messaging: update to [version 13](https://github.com/GrapheneOS/Messaging/releases/tag/13)
- Messaging: update to [version 14](https://github.com/GrapheneOS/Messaging/releases/tag/14)
- Messaging: update to [version 15](https://github.com/GrapheneOS/Messaging/releases/tag/15)
- Messaging: update to [version 16](https://github.com/GrapheneOS/Messaging/releases/tag/16)
- Vanadium: update to [version 154.0.8037.92.0](https://github.com/GrapheneOS/Vanadium/releases/tag/154.0.8037.92.0)
- adevtool: add command for processing Pixel kernel tarballs
- arcslib: add support for system\_ext overlays
- apksig: handle APKs that lack a V3 signature in print-certs command
- add ColdFileReadBenchmark to benchmark cold mmap reads with low free swap

All of the Android 17 security patches from the current October 2026, November 2026, December 2026, January 2027, February 2027, March 2027 and April 2027 Android Security Bulletins are included in the 2026100201 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-55265, CVE-2026-58814, CVE-2026-58820, CVE-2026-58865, CVE-2026-58868, CVE-2026-58876, CVE-2026-58880, CVE-2026-58882, CVE-2026-58984, CVE-2026-59062
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-48600, CVE-2026-0053, CVE-2026-28619, CVE-2026-28635, CVE-2026-28643, CVE-2026-28645, CVE-2026-45522, CVE-2026-45523, CVE-2026-47964, CVE-2026-49914, CVE-2026-49935, CVE-2026-55260, CVE-2026-55272, CVE-2026-55274, CVE-2026-55284, CVE-2026-55286, CVE-2026-58860, CVE-2026-58866, CVE-2026-58867, CVE-2026-58869, CVE-2026-58870, CVE-2026-58871, CVE-2026-58872, CVE-2026-58875, CVE-2026-58877, CVE-2026-58879, CVE-2026-58883, CVE-2026-58884, CVE-2026-58885, CVE-2026-58886, CVE-2026-58933, CVE-2026-58934, CVE-2026-58935, CVE-2026-58937, CVE-2026-58938, CVE-2026-58943, CVE-2026-58944, CVE-2026-58946, CVE-2026-58949, CVE-2026-58951, CVE-2026-58953, CVE-2026-58954, CVE-2026-58955, CVE-2026-58956, CVE-2026-58957, CVE-2026-58958, CVE-2026-58960, CVE-2026-58961, CVE-2026-58962, CVE-2026-58963, CVE-2026-58964, CVE-2026-58965, CVE-2026-58966, CVE-2026-58968, CVE-2026-58969, CVE-2026-58970, CVE-2026-58971, CVE-2026-58972, CVE-2026-58973, CVE-2026-58974, CVE-2026-58975, CVE-2026-58976, CVE-2026-58978, CVE-2026-58979, CVE-2026-58985, CVE-2026-58986, CVE-2026-58988, CVE-2026-58990, CVE-2026-58993, CVE-2026-58994, CVE-2026-58995, CVE-2026-58998, CVE-2026-59000, CVE-2026-59001, CVE-2026-59002, CVE-2026-59003, CVE-2026-59004, CVE-2026-59005, CVE-2026-59006, CVE-2026-59007, CVE-2026-59008, CVE-2026-59011, CVE-2026-59013, CVE-2026-59014, CVE-2026-59015, CVE-2026-59016, CVE-2026-59017, CVE-2026-59020, CVE-2026-59021, CVE-2026-59022, CVE-2026-59023, CVE-2026-59028, CVE-2026-59031, CVE-2026-59032, CVE-2026-59034, CVE-2026-59049, CVE-2026-59050, CVE-2026-59051, CVE-2026-59054, CVE-2026-59055, CVE-2026-59056, CVE-2026-59059, CVE-2026-59063

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026092500

Tags:

- [2026092500](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026092500) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026091900 release:

- Pixels: fully update kernel drivers, firmware and userspace hardware support code to Android 17 QPR1 by adding infrastructure to support it on Android 17
- add back SIM PIN scrambling toggle in the new Protect SIM card screen
- Settings: improve user interface for the secure paste feature controlling clipboard access
- adevtool: restore the Cape modem carrier override for 6th generation Pixels since Google didn't include it
- adevtool: reclaim storage space reserved for preloaded AI models used by the stock Pixel OS on 10th/11th gen Pixels
- bionic libc: add missing stack size calculation overflow check (no real world impact)
- bionic libc: revert legacy change removing VLA due to -fstack-clash-protection making it safe for a while now (fixes an issue with Bionic trace markers)
- Sandboxed Google Play: add CLOEXEC to zip file descriptors created with dup for sandboxed Google Play services dynamite modules in ART, bionic and libcore (no real world impact)
- hardened\_malloc: optimize slab quarantine indexing by limiting slab quarantine length multipliers to a power of two (both multipliers are set to the default of 1)
- hardened\_malloc: optimize aligned size class calculation
- hardened\_malloc: optimize size class struct layout
- hardened\_malloc: add missing "cc" to clobber list for MTE assembly (bug inherited from LLVM with no real world impact)
- GmsCompatConfig: update to [version 175](https://github.com/GrapheneOS/platform_packages_apps_GmsCompat/releases/tag/config-175)
- Vanadium: update to [version 154.0.8037.57.0](https://github.com/GrapheneOS/Vanadium/releases/tag/154.0.8037.57.0)
- Vanadium: update to [version 154.0.8037.57.1](https://github.com/GrapheneOS/Vanadium/releases/tag/154.0.8037.57.1)
- add scripts for automating building kernels and updating the builds included in the OS source tree

All of the Android 17 security patches from the current October 2026, November 2026, December 2026, January 2027, February 2027 and March 2027 Android Security Bulletins are included in the 2026092501 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-55265, CVE-2026-58814, CVE-2026-58865, CVE-2026-58868, CVE-2026-58876, CVE-2026-58880, CVE-2026-58882, CVE-2026-58984
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-48600, CVE-2026-0053, CVE-2026-28635, CVE-2026-28643, CVE-2026-28645, CVE-2026-45522, CVE-2026-47964, CVE-2026-49914, CVE-2026-49935, CVE-2026-55272, CVE-2026-55274, CVE-2026-55284, CVE-2026-55286, CVE-2026-58866, CVE-2026-58867, CVE-2026-58869, CVE-2026-58870, CVE-2026-58871, CVE-2026-58872, CVE-2026-58875, CVE-2026-58877, CVE-2026-58879, CVE-2026-58883, CVE-2026-58884, CVE-2026-58885, CVE-2026-58886, CVE-2026-58933, CVE-2026-58934, CVE-2026-58935, CVE-2026-58937, CVE-2026-58938, CVE-2026-58943, CVE-2026-58944, CVE-2026-58946, CVE-2026-58949, CVE-2026-58951, CVE-2026-58953, CVE-2026-58954, CVE-2026-58955, CVE-2026-58956, CVE-2026-58957, CVE-2026-58958, CVE-2026-58960, CVE-2026-58961, CVE-2026-58962, CVE-2026-58963, CVE-2026-58964, CVE-2026-58965, CVE-2026-58966, CVE-2026-58968, CVE-2026-58969, CVE-2026-58970, CVE-2026-58971, CVE-2026-58972, CVE-2026-58973, CVE-2026-58974, CVE-2026-58975, CVE-2026-58976, CVE-2026-58978, CVE-2026-58979, CVE-2026-58985, CVE-2026-58986, CVE-2026-58988, CVE-2026-58990, CVE-2026-58993, CVE-2026-58994, CVE-2026-58995, CVE-2026-58998, CVE-2026-59000, CVE-2026-59001, CVE-2026-59002, CVE-2026-59003, CVE-2026-59004, CVE-2026-59005, CVE-2026-59006, CVE-2026-59007, CVE-2026-59008, CVE-2026-59011, CVE-2026-59013, CVE-2026-59014, CVE-2026-59015, CVE-2026-59016, CVE-2026-59017, CVE-2026-59020, CVE-2026-59021, CVE-2026-59022, CVE-2026-59023, CVE-2026-59028, CVE-2026-59031, CVE-2026-59032, CVE-2026-59034, CVE-2026-59049, CVE-2026-59050, CVE-2026-59051, CVE-2026-59054, CVE-2026-59055

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026091900

Tags:

- [2026091900](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026091900) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026091700 release:

- Pixels: backport CarrierSettings from Android 17 QPR1 to resolve carrier compatibility issues caused by the modem firmware backport
- Pixels: backport wfc-pkt-router from Android 17 QPR1 to resolve a crash
- reduce rate limit for notifying about clipboard reads blocked by our secure paste feature from 1 minute to 6 seconds since users can toggle off the notice on a per-app basis if it's an annoyance
- Vanadium: update to [version 153.0.8010.52.0](https://github.com/GrapheneOS/Vanadium/releases/tag/153.0.8010.52.0)

All of the Android 17 security patches from the current October 2026, November 2026, December 2026, January 2027, February 2027 and March 2027 Android Security Bulletins are included in the 2026091901 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-55265, CVE-2026-58814, CVE-2026-58865, CVE-2026-58868, CVE-2026-58876, CVE-2026-58880, CVE-2026-58882, CVE-2026-58984
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-48600, CVE-2026-0053, CVE-2026-28635, CVE-2026-28643, CVE-2026-28645, CVE-2026-45522, CVE-2026-47964, CVE-2026-49935, CVE-2026-55272, CVE-2026-55274, CVE-2026-55284, CVE-2026-55286, CVE-2026-58866, CVE-2026-58867, CVE-2026-58868, CVE-2026-58869, CVE-2026-58870, CVE-2026-58871, CVE-2026-58872, CVE-2026-58875, CVE-2026-58877, CVE-2026-58879, CVE-2026-58883, CVE-2026-58884, CVE-2026-58885, CVE-2026-58886, CVE-2026-58933, CVE-2026-58934, CVE-2026-58935, CVE-2026-58937, CVE-2026-58938, CVE-2026-58943, CVE-2026-58944, CVE-2026-58946, CVE-2026-58949, CVE-2026-58951, CVE-2026-58953, CVE-2026-58954, CVE-2026-58955, CVE-2026-58956, CVE-2026-58957, CVE-2026-58958, CVE-2026-58960, CVE-2026-58961, CVE-2026-58962, CVE-2026-58963, CVE-2026-58964, CVE-2026-58965, CVE-2026-58966, CVE-2026-58968, CVE-2026-58969, CVE-2026-58970, CVE-2026-58971, CVE-2026-58972, CVE-2026-58973, CVE-2026-58974, CVE-2026-58975, CVE-2026-58976, CVE-2026-58978, CVE-2026-58979, CVE-2026-58985, CVE-2026-58986, CVE-2026-58988, CVE-2026-58990, CVE-2026-58993, CVE-2026-58994, CVE-2026-58995, CVE-2026-58998, CVE-2026-59000, CVE-2026-59001, CVE-2026-59002, CVE-2026-59003, CVE-2026-59004, CVE-2026-59005, CVE-2026-59006, CVE-2026-59007, CVE-2026-59008, CVE-2026-59011, CVE-2026-59013, CVE-2026-59014, CVE-2026-59015, CVE-2026-59016, CVE-2026-59017, CVE-2026-59020, CVE-2026-59021, CVE-2026-59022, CVE-2026-59023, CVE-2026-59028, CVE-2026-59031, CVE-2026-59032, CVE-2026-59049, CVE-2026-59050, CVE-2026-59051, CVE-2026-59054
- Unclassified: CVE-2026-58994

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026091700

Tags:

- [2026091700](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026091700) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026091000 release:

- Pixels: backport cellular modem firmware from Android 17 QPR1
- add per-app toggle for disallowing apps reading the clipboard with a global toggle to make it the default (forces pasting via the OS selection toolbar, keyboard apps, keyboard shortcuts or accessibility services)
- Keyboard: add paste chip to offer pasting recently copied content when there's nothing else to show as an option
- Dialer: default to the contact opt-out mode for users enabling automatic call recording for the first time rather than opt-in
- update timezone data to 2026c
- kernel (6.1): update to latest GKI LTS branch revision including update to 6.1.177
- kernel (6.6): update to latest GKI LTS branch revision including update to 6.6.143
- kernel (6.12): update to latest GKI LTS branch revision including update to 6.12.93
- add 6.18 kernel branch
- Vanadium: update to [version 153.0.8010.47.0](https://github.com/GrapheneOS/Vanadium/releases/tag/153.0.8010.47.0)
- adevtool: improve the process-bulletin-patches command

All of the Android 17 security patches from the current October 2026, November 2026, December 2026, January 2027, February 2027 and March 2027 Android Security Bulletins are included in the 2026091701 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-55265, CVE-2026-58814, CVE-2026-58865, CVE-2026-58868, CVE-2026-58876, CVE-2026-58880, CVE-2026-58882, CVE-2026-58984
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-48600, CVE-2026-0053, CVE-2026-28635, CVE-2026-28643, CVE-2026-28645, CVE-2026-45522, CVE-2026-47964, CVE-2026-49935, CVE-2026-55272, CVE-2026-55274, CVE-2026-55284, CVE-2026-55286, CVE-2026-58866, CVE-2026-58867, CVE-2026-58868, CVE-2026-58869, CVE-2026-58870, CVE-2026-58871, CVE-2026-58872, CVE-2026-58875, CVE-2026-58877, CVE-2026-58879, CVE-2026-58883, CVE-2026-58884, CVE-2026-58885, CVE-2026-58886, CVE-2026-58933, CVE-2026-58934, CVE-2026-58935, CVE-2026-58937, CVE-2026-58938, CVE-2026-58943, CVE-2026-58944, CVE-2026-58946, CVE-2026-58949, CVE-2026-58951, CVE-2026-58953, CVE-2026-58954, CVE-2026-58955, CVE-2026-58956, CVE-2026-58957, CVE-2026-58958, CVE-2026-58960, CVE-2026-58961, CVE-2026-58962, CVE-2026-58963, CVE-2026-58964, CVE-2026-58965, CVE-2026-58966, CVE-2026-58968, CVE-2026-58969, CVE-2026-58970, CVE-2026-58971, CVE-2026-58972, CVE-2026-58973, CVE-2026-58974, CVE-2026-58975, CVE-2026-58976, CVE-2026-58978, CVE-2026-58979, CVE-2026-58985, CVE-2026-58986, CVE-2026-58988, CVE-2026-58990, CVE-2026-58993, CVE-2026-58994, CVE-2026-58995, CVE-2026-58998, CVE-2026-59000, CVE-2026-59001, CVE-2026-59002, CVE-2026-59003, CVE-2026-59004, CVE-2026-59005, CVE-2026-59006, CVE-2026-59007, CVE-2026-59008, CVE-2026-59011, CVE-2026-59013, CVE-2026-59014, CVE-2026-59015, CVE-2026-59016, CVE-2026-59017, CVE-2026-59020, CVE-2026-59021, CVE-2026-59022, CVE-2026-59023, CVE-2026-59028, CVE-2026-59031, CVE-2026-59032, CVE-2026-59049, CVE-2026-59050, CVE-2026-59051, CVE-2026-59054
- Unclassified: CVE-2026-58994

Other changes in the 2026091701 security preview release:

- fix upstream bug breaking sending MMS from secondary users

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026091000

Tags:

- [2026091000](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026091000) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026090700 release:

- full 2026-09-01 security patch level
- Contact Scopes: improve compatibility with certain apps
- Dialer: add the option to enable call recording for every contact by default with a list of excluded numbers
- Dialer: declare microphone and phone foreground service type to fix automatic call recording for answering calls via Bluetooth
- SystemUI: respect lockscreen media setting on always-on display
- kernel (6.1): update to latest GKI LTS branch revision
- kernel (6.6): update to latest GKI LTS branch revision
- kernel (6.12): update to latest GKI LTS branch revision
- GmsCompatConfig: update to [version 174](https://github.com/GrapheneOS/platform_packages_apps_GmsCompat/releases/tag/config-174)
- Vanadium: update to [version 153.0.8010.36.0](https://github.com/GrapheneOS/Vanadium/releases/tag/153.0.8010.36.0)
- adevtool: improve the apply-bulletin-patches command and rename it to process-bulletin-patches

All of the Android 17 security patches from the current October 2026, November 2026, December 2026, January 2027, February 2027 and March 2027 Android Security Bulletins are included in the 2026091001 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-55265, CVE-2026-58814, CVE-2026-58865, CVE-2026-58868, CVE-2026-58876, CVE-2026-58880, CVE-2026-58882, CVE-2026-58984
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-48600, CVE-2026-0053, CVE-2026-28635, CVE-2026-28643, CVE-2026-28645, CVE-2026-45522, CVE-2026-47964, CVE-2026-49935, CVE-2026-55272, CVE-2026-55274, CVE-2026-55284, CVE-2026-55286, CVE-2026-58866, CVE-2026-58867, CVE-2026-58868, CVE-2026-58869, CVE-2026-58870, CVE-2026-58871, CVE-2026-58872, CVE-2026-58875, CVE-2026-58877, CVE-2026-58879, CVE-2026-58883, CVE-2026-58884, CVE-2026-58885, CVE-2026-58886, CVE-2026-58933, CVE-2026-58934, CVE-2026-58935, CVE-2026-58937, CVE-2026-58938, CVE-2026-58943, CVE-2026-58944, CVE-2026-58946, CVE-2026-58949, CVE-2026-58951, CVE-2026-58953, CVE-2026-58954, CVE-2026-58955, CVE-2026-58956, CVE-2026-58957, CVE-2026-58958, CVE-2026-58960, CVE-2026-58961, CVE-2026-58962, CVE-2026-58963, CVE-2026-58964, CVE-2026-58965, CVE-2026-58966, CVE-2026-58968, CVE-2026-58969, CVE-2026-58970, CVE-2026-58971, CVE-2026-58972, CVE-2026-58973, CVE-2026-58974, CVE-2026-58975, CVE-2026-58976, CVE-2026-58978, CVE-2026-58979, CVE-2026-58985, CVE-2026-58986, CVE-2026-58988, CVE-2026-58990, CVE-2026-58993, CVE-2026-58994, CVE-2026-58995, CVE-2026-58998, CVE-2026-59000, CVE-2026-59001, CVE-2026-59002, CVE-2026-59003, CVE-2026-59004, CVE-2026-59005, CVE-2026-59006, CVE-2026-59007, CVE-2026-59008, CVE-2026-59011, CVE-2026-59013, CVE-2026-59014, CVE-2026-59015, CVE-2026-59016, CVE-2026-59017, CVE-2026-59020, CVE-2026-59021, CVE-2026-59022, CVE-2026-59023, CVE-2026-59028, CVE-2026-59031, CVE-2026-59032
- Unclassified: CVE-2026-58994

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026090700

Tags:

- [2026090700](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026090700) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026090500 release:

- dismiss app drawer keyboard before private space unlock to fix private space search credential prompt text disappearing on secondary users
- hardened\_malloc: update libdivide to 5.4.0

All of the Android 17 security patches from the current September 2026, October 2026, November 2026, December 2026, January 2027, February 2027 and March 2027 Android Security Bulletins are included in the 2026090701 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-28591, CVE-2026-28604, CVE-2026-28639, CVE-2026-28653, CVE-2026-28662, CVE-2026-28666, CVE-2026-45515, CVE-2026-45531, CVE-2026-49879, CVE-2026-49882, CVE-2026-49884, CVE-2026-49918, CVE-2026-49921, CVE-2026-49926, CVE-2026-49927, CVE-2026-49932, CVE-2026-49933, CVE-2026-55256, CVE-2026-55265, CVE-2026-55268, CVE-2026-55269, CVE-2026-55273, CVE-2026-55277, CVE-2026-55280, CVE-2026-58814, CVE-2026-58820, CVE-2026-58823, CVE-2026-58835, CVE-2026-58865, CVE-2026-58868, CVE-2026-58876, CVE-2026-58880, CVE-2026-58882, CVE-2026-58984
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-22442, CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2025-48600, CVE-2026-0053, CVE-2026-28581, CVE-2026-28582, CVE-2026-28584, CVE-2026-28588, CVE-2026-28593, CVE-2026-28594, CVE-2026-28599, CVE-2026-28600, CVE-2026-28602, CVE-2026-28603, CVE-2026-28606, CVE-2026-28607, CVE-2026-28612, CVE-2026-28613, CVE-2026-28614, CVE-2026-28617, CVE-2026-28619, CVE-2026-28620, CVE-2026-28622, CVE-2026-28623, CVE-2026-28624, CVE-2026-28626, CVE-2026-28627, CVE-2026-28630, CVE-2026-28631, CVE-2026-28633, CVE-2026-28634, CVE-2026-28635, CVE-2026-28638, CVE-2026-28643, CVE-2026-28645, CVE-2026-28650, CVE-2026-28652, CVE-2026-28655, CVE-2026-28657, CVE-2026-28658, CVE-2026-28660, CVE-2026-28663, CVE-2026-28664, CVE-2026-28665, CVE-2026-28667, CVE-2026-28668, CVE-2026-28671, CVE-2026-45513, CVE-2026-45514, CVE-2026-45517, CVE-2026-45518, CVE-2026-45519, CVE-2026-45520, CVE-2026-45521, CVE-2026-45522, CVE-2026-45523, CVE-2026-45524, CVE-2026-45525, CVE-2026-45527, CVE-2026-45528, CVE-2026-45529, CVE-2026-49878, CVE-2026-49880, CVE-2026-49881, CVE-2026-49885, CVE-2026-49887, CVE-2026-49895, CVE-2026-49896, CVE-2026-49912, CVE-2026-49913, CVE-2026-49914, CVE-2026-49923, CVE-2026-49924, CVE-2026-49925, CVE-2026-49931, CVE-2026-49934, CVE-2026-49935, CVE-2026-49937, CVE-2026-55257, CVE-2026-55260, CVE-2026-55261, CVE-2026-55262, CVE-2026-55263, CVE-2026-55264, CVE-2026-55266, CVE-2026-55270, CVE-2026-55271, CVE-2026-55272, CVE-2026-55274, CVE-2026-55278, CVE-2026-55279, CVE-2026-55282, CVE-2026-55284, CVE-2026-55286, CVE-2026-55287, CVE-2026-55288, CVE-2026-55289, CVE-2026-55290, CVE-2026-55292, CVE-2026-55294, CVE-2026-58815, CVE-2026-58817, CVE-2026-58821, CVE-2026-58822, CVE-2026-58834, CVE-2026-58836, CVE-2026-58837, CVE-2026-58838, CVE-2026-58841, CVE-2026-58853, CVE-2026-58854, CVE-2026-58856, CVE-2026-58857, CVE-2026-58859, CVE-2026-58866, CVE-2026-58867, CVE-2026-58868, CVE-2026-58869, CVE-2026-58870, CVE-2026-58871, CVE-2026-58872, CVE-2026-58875, CVE-2026-58877, CVE-2026-58879, CVE-2026-58883, CVE-2026-58884, CVE-2026-58885, CVE-2026-58886, CVE-2026-58933, CVE-2026-58934, CVE-2026-58935, CVE-2026-58937, CVE-2026-58938, CVE-2026-58943, CVE-2026-58944, CVE-2026-58945, CVE-2026-58946, CVE-2026-58949, CVE-2026-58951, CVE-2026-58953, CVE-2026-58954, CVE-2026-58955, CVE-2026-58956, CVE-2026-58957, CVE-2026-58958, CVE-2026-58960, CVE-2026-58961, CVE-2026-58962, CVE-2026-58963, CVE-2026-58964, CVE-2026-58965, CVE-2026-58966, CVE-2026-58968, CVE-2026-58969, CVE-2026-58970, CVE-2026-58971, CVE-2026-58972, CVE-2026-58973, CVE-2026-58974, CVE-2026-58975, CVE-2026-58976, CVE-2026-58978, CVE-2026-58979, CVE-2026-58985, CVE-2026-58986, CVE-2026-58988, CVE-2026-58990, CVE-2026-58993, CVE-2026-58994, CVE-2026-58995, CVE-2026-58997, CVE-2026-58998, CVE-2026-59000, CVE-2026-59001, CVE-2026-59002, CVE-2026-59003, CVE-2026-59004, CVE-2026-59005, CVE-2026-59006, CVE-2026-59007, CVE-2026-59008, CVE-2026-59011, CVE-2026-59013, CVE-2026-59014, CVE-2026-59015, CVE-2026-59016, CVE-2026-59017, CVE-2026-59020, CVE-2026-59021, CVE-2026-59022, CVE-2026-59023, CVE-2026-59028, CVE-2026-59032
- Unclassified: CVE-2026-58994

Other changes in the 2026090701 security preview release:

- fix security preview patch breaking the volume bar button for displaying the rest of the volume controls

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026090500

Tags:

- [2026090500](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026090500) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026081300 release:

- Launcher: filter Private Space apps from search while it's locked to resolve upstream privacy deficiency (Pixel Launcher delegates search to Android System Intelligence which fixed this already)
- Launcher: add "Private Space" action for unlocking the Private Space to app drawer search to match the Pixel Launcher
- Launcher: fix upstream crash on large-screen devices when opening a folder from the taskbar with 3-button navigation
- Settings: add warning about the standard Android feature for hiding Private Spaces only being superficial and having multiple known tricks for detecting it
- Dialer: add support for automatic call recording with a per-call opt-out switch for both incoming and outgoing calls along with a notice of automatic call recording being active during calls
- backport upstream Android 17 QPR1 Beta 5 fix for widgets disappearing after reboot
- exempt DocumentsUI from redaction of location metadata to resolve upstream bug causing the system file manager to redact location metadata for copies or certain moves
- Settings: initialize display color mode to the correct default value to resolve remaining issues with switching back to the default color mode for Pixels caused by an upstream bug not currently impacting the stock Pixel OS
- adevtool: remove Saturated color options from devices where it isn't properly supported
- Sandboxed Google Play compatibility layer: fix PackageInstaller.installPackageArchived() stub
- hardened\_malloc: replace MADV\_DONTNEED with MADV\_DONTNEED\_LOCKED to improve compatibility with mlockall
- hardened\_malloc: enforce success for MADV\_DONTNEED\_LOCKED to avoid the need for a memory clearing fallback path
- hardened\_malloc: avoid unnecessary purging end guard for shrinking large allocations
- hardened\_malloc: replace MAP\_FIXED and fix MREMAP\_FIXED ENOMEM handling to fix extreme out-of-memory edge cases where these unmap the target but fail to replace it
- kernel (Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold): update to latest upstream kernel driver sources (replaces our manual backport of CVE-2026-0163)
- kernel (6.6, 6.12): add workaround for an upstream arm64 KVM bug breaking booting with lockdown in confidentiality mode (this was previously only applied for a variant of the 6.6 branch specific to 10th gen Pixels but is more broadly applicable)
- kernel (6.6): fix edge case error handling for missing SELinux policy in our extensions to SELinux
- kernel (6.12): AutoFDO: disable machine function splitting due to an incompatibility with BTI which is enabled by GrapheneOS
- kernel (6.1): update to latest GKI LTS branch revision
- kernel (6.6): update to latest GKI LTS branch revision
- kernel (6.12): update to latest GKI LTS branch revision
- Vanadium: update to [version 152.0.7977.42.0](https://github.com/GrapheneOS/Vanadium/releases/tag/152.0.7977.42.0)
- Vanadium: update to [version 152.0.7977.54.0](https://github.com/GrapheneOS/Vanadium/releases/tag/152.0.7977.54.0)
- Vanadium: update to [version 152.0.7977.64.0](https://github.com/GrapheneOS/Vanadium/releases/tag/152.0.7977.64.0)
- Vanadium: update to [version 152.0.7977.84.0](https://github.com/GrapheneOS/Vanadium/releases/tag/152.0.7977.84.0)
- GmsCompatConfig: update to [version 173](https://github.com/GrapheneOS/platform_packages_apps_GmsCompat/releases/tag/config-173)
- AppCompatConfig: update to [version 8](https://github.com/GrapheneOS/platform_packages_apps_AppCompatConfig/releases/tag/8)
- adevtool: add support for unpacking optimized GrapheneOS factory images
- adevtool: add an option to use stock OS kernel files for testing purposes
- adevtool: improve the apply-bulletin-patches command
- Launcher: fix Launcher3QuickStepTests for Android 17
- SELinux policy: remove workaround no longer required by our current secure spawning implementation

All of the Android 17 security patches from the current September 2026, October 2026, November 2026, December 2026, January 2027, February 2027 and March 2027 Android Security Bulletins are included in the 2026090501 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-28591, CVE-2026-28604, CVE-2026-28639, CVE-2026-28653, CVE-2026-28662, CVE-2026-28666, CVE-2026-45515, CVE-2026-45531, CVE-2026-49879, CVE-2026-49882, CVE-2026-49884, CVE-2026-49918, CVE-2026-49921, CVE-2026-49926, CVE-2026-49927, CVE-2026-49932, CVE-2026-49933, CVE-2026-55256, CVE-2026-55265, CVE-2026-55268, CVE-2026-55269, CVE-2026-55273, CVE-2026-55277, CVE-2026-55280, CVE-2026-58814, CVE-2026-58820, CVE-2026-58823, CVE-2026-58835, CVE-2026-58865, CVE-2026-58868, CVE-2026-58876, CVE-2026-58880, CVE-2026-58882, CVE-2026-58984
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-22442, CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2025-48600, CVE-2026-0053, CVE-2026-28581, CVE-2026-28582, CVE-2026-28584, CVE-2026-28588, CVE-2026-28593, CVE-2026-28594, CVE-2026-28599, CVE-2026-28600, CVE-2026-28602, CVE-2026-28603, CVE-2026-28606, CVE-2026-28607, CVE-2026-28612, CVE-2026-28613, CVE-2026-28614, CVE-2026-28617, CVE-2026-28619, CVE-2026-28620, CVE-2026-28622, CVE-2026-28623, CVE-2026-28624, CVE-2026-28626, CVE-2026-28627, CVE-2026-28630, CVE-2026-28631, CVE-2026-28633, CVE-2026-28634, CVE-2026-28635, CVE-2026-28638, CVE-2026-28643, CVE-2026-28645, CVE-2026-28650, CVE-2026-28652, CVE-2026-28655, CVE-2026-28657, CVE-2026-28658, CVE-2026-28660, CVE-2026-28663, CVE-2026-28664, CVE-2026-28665, CVE-2026-28667, CVE-2026-28668, CVE-2026-28671, CVE-2026-45513, CVE-2026-45514, CVE-2026-45517, CVE-2026-45518, CVE-2026-45519, CVE-2026-45520, CVE-2026-45521, CVE-2026-45522, CVE-2026-45523, CVE-2026-45524, CVE-2026-45525, CVE-2026-45527, CVE-2026-45528, CVE-2026-45529, CVE-2026-49878, CVE-2026-49880, CVE-2026-49881, CVE-2026-49885, CVE-2026-49887, CVE-2026-49895, CVE-2026-49896, CVE-2026-49912, CVE-2026-49913, CVE-2026-49914, CVE-2026-49923, CVE-2026-49924, CVE-2026-49925, CVE-2026-49931, CVE-2026-49934, CVE-2026-49935, CVE-2026-49937, CVE-2026-55257, CVE-2026-55260, CVE-2026-55261, CVE-2026-55262, CVE-2026-55263, CVE-2026-55264, CVE-2026-55266, CVE-2026-55270, CVE-2026-55271, CVE-2026-55272, CVE-2026-55274, CVE-2026-55278, CVE-2026-55279, CVE-2026-55282, CVE-2026-55284, CVE-2026-55286, CVE-2026-55287, CVE-2026-55288, CVE-2026-55289, CVE-2026-55290, CVE-2026-55292, CVE-2026-55294, CVE-2026-58815, CVE-2026-58817, CVE-2026-58821, CVE-2026-58822, CVE-2026-58834, CVE-2026-58836, CVE-2026-58837, CVE-2026-58838, CVE-2026-58841, CVE-2026-58853, CVE-2026-58854, CVE-2026-58856, CVE-2026-58857, CVE-2026-58859, CVE-2026-58866, CVE-2026-58867, CVE-2026-58868, CVE-2026-58869, CVE-2026-58870, CVE-2026-58871, CVE-2026-58872, CVE-2026-58875, CVE-2026-58877, CVE-2026-58879, CVE-2026-58883, CVE-2026-58884, CVE-2026-58885, CVE-2026-58886, CVE-2026-58933, CVE-2026-58934, CVE-2026-58935, CVE-2026-58937, CVE-2026-58938, CVE-2026-58943, CVE-2026-58944, CVE-2026-58945, CVE-2026-58946, CVE-2026-58949, CVE-2026-58951, CVE-2026-58953, CVE-2026-58954, CVE-2026-58955, CVE-2026-58956, CVE-2026-58957, CVE-2026-58958, CVE-2026-58960, CVE-2026-58961, CVE-2026-58962, CVE-2026-58963, CVE-2026-58964, CVE-2026-58965, CVE-2026-58966, CVE-2026-58968, CVE-2026-58969, CVE-2026-58970, CVE-2026-58971, CVE-2026-58972, CVE-2026-58973, CVE-2026-58974, CVE-2026-58975, CVE-2026-58976, CVE-2026-58978, CVE-2026-58979, CVE-2026-58985, CVE-2026-58986, CVE-2026-58988, CVE-2026-58990, CVE-2026-58993, CVE-2026-58994, CVE-2026-58995, CVE-2026-58997, CVE-2026-58998, CVE-2026-59000, CVE-2026-59001, CVE-2026-59002, CVE-2026-59003, CVE-2026-59004, CVE-2026-59005, CVE-2026-59006, CVE-2026-59007, CVE-2026-59008, CVE-2026-59011, CVE-2026-59013, CVE-2026-59014, CVE-2026-59015, CVE-2026-59016, CVE-2026-59017, CVE-2026-59020, CVE-2026-59021, CVE-2026-59022, CVE-2026-59023, CVE-2026-59028, CVE-2026-59032
- Unclassified: CVE-2026-58994

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026081300

Tags:

- [2026081300](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026081300) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026080500 release:

- Bluetooth: handle nested secondary profiles when sending broadcasts to fix support for wireless Android Auto in nested secondary profiles (Private Spaces and work profiles)
- enable multiuser-unaware API usage warnings for Bluetooth processes
- Contact Scopes: use identity of the calling app for the filtered query since the query validation, projection mapping, etc. depend on the target SDK version of the calling app (this is a proper solution to the Contact Scopes compatibility issues for WhatsApp and sandboxed Google Play services in Android 17 replacing our previous workaround)
- CredentialManager: make CredentialSelectorActivity opaque (avoid showing activity underneath) to resolve security vulnerabilities not yet fixed upstream
- Sandboxed Google Play compatibility layer: mark all Play services FIDO activities as opaque (avoid showing activity underneath) to resolve Play services security vulnerabilities not yet fixed upstream
- Sandboxed Google Play compatibility layer: prevent the Play services from being frozen by the cached app freezer by binding to the persistent process from GmsCompat (this resolves Firebase Cloud Messaging delays)
- Sandboxed Google Play compatibility layer: fix race conditions in GLocationService.flushLocations() and PersistentFgService.requestStart() to avoid crashes in edge cases
- Sandboxed Google Play compatibility layer: add special handling for Android Auto OutOfCarLifecycle crashes to avoid getting issue reports for expected uncaught exceptions from Android Auto connectivity loss
- Sandboxed Google Play compatibility layer: only notify about missing Notifications permission for Play services since other components such as the Play Store handle it themselves
- Sandboxed Google Play compatibility layer: switch privSettingsPutStrings() to StringParceledListSlice to handle larger arrays
- kernel (6.1): update to latest GKI LTS branch revision including update to 6.1.176
- kernel (6.6): update to latest GKI LTS branch revision
- kernel (6.12): update to latest GKI LTS branch revision
- Vanadium: update to [version 151.0.7922.83.0](https://github.com/GrapheneOS/Vanadium/releases/tag/151.0.7922.83.0)
- Vanadium: update to [version 151.0.7922.108.0](https://github.com/GrapheneOS/Vanadium/releases/tag/151.0.7922.108.0)
- Vanadium: update to [version 151.0.7922.137.0](https://github.com/GrapheneOS/Vanadium/releases/tag/151.0.7922.137.0)
- adevtool: improve the apply-bulletin-patches command

All of the Android 17 security patches from the current September 2026, October 2026, November 2026, December 2026 and January 2027 Android Security Bulletins are included in the 2026081301 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-28591, CVE-2026-28604, CVE-2026-28639, CVE-2026-28653, CVE-2026-28662, CVE-2026-28666, CVE-2026-45515, CVE-2026-45531, CVE-2026-49879, CVE-2026-49882, CVE-2026-49884, CVE-2026-49918, CVE-2026-49921, CVE-2026-49926, CVE-2026-49927, CVE-2026-49932, CVE-2026-49933, CVE-2026-55256, CVE-2026-55265, CVE-2026-55268, CVE-2026-55269, CVE-2026-55273, CVE-2026-55277, CVE-2026-55280, CVE-2026-58814, CVE-2026-58820, CVE-2026-58823, CVE-2026-58835, CVE-2026-58865, CVE-2026-58868, CVE-2026-58876, CVE-2026-58880, CVE-2026-58882, CVE-2026-58984
- High: CVE-2025-22442, CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2026-0053, CVE-2026-28581, CVE-2026-28582, CVE-2026-28584, CVE-2026-28588, CVE-2026-28593, CVE-2026-28594, CVE-2026-28599, CVE-2026-28600, CVE-2026-28602, CVE-2026-28603, CVE-2026-28606, CVE-2026-28607, CVE-2026-28612, CVE-2026-28613, CVE-2026-28614, CVE-2026-28617, CVE-2026-28619, CVE-2026-28620, CVE-2026-28622, CVE-2026-28623, CVE-2026-28624, CVE-2026-28626, CVE-2026-28627, CVE-2026-28630, CVE-2026-28631, CVE-2026-28633, CVE-2026-28634, CVE-2026-28635, CVE-2026-28638, CVE-2026-28643, CVE-2026-28650, CVE-2026-28652, CVE-2026-28655, CVE-2026-28657, CVE-2026-28658, CVE-2026-28660, CVE-2026-28663, CVE-2026-28664, CVE-2026-28665, CVE-2026-28667, CVE-2026-28668, CVE-2026-28671, CVE-2026-45513, CVE-2026-45514, CVE-2026-45517, CVE-2026-45518, CVE-2026-45519, CVE-2026-45520, CVE-2026-45521, CVE-2026-45522, CVE-2026-45523, CVE-2026-45524, CVE-2026-45525, CVE-2026-45527, CVE-2026-45528, CVE-2026-45529, CVE-2026-49878, CVE-2026-49880, CVE-2026-49881, CVE-2026-49885, CVE-2026-49887, CVE-2026-49895, CVE-2026-49896, CVE-2026-49912, CVE-2026-49913, CVE-2026-49914, CVE-2026-49923, CVE-2026-49924, CVE-2026-49925, CVE-2026-49931, CVE-2026-49934, CVE-2026-49935, CVE-2026-49937, CVE-2026-55257, CVE-2026-55261, CVE-2026-55262, CVE-2026-55263, CVE-2026-55264, CVE-2026-55266, CVE-2026-55270, CVE-2026-55271, CVE-2026-55272, CVE-2026-55278, CVE-2026-55279, CVE-2026-55282, CVE-2026-55284, CVE-2026-55286, CVE-2026-55287, CVE-2026-55288, CVE-2026-55289, CVE-2026-55290, CVE-2026-55292, CVE-2026-55294, CVE-2026-58815, CVE-2026-58817, CVE-2026-58821, CVE-2026-58822, CVE-2026-58834, CVE-2026-58836, CVE-2026-58837, CVE-2026-58838, CVE-2026-58841, CVE-2026-58853, CVE-2026-58854, CVE-2026-58856, CVE-2026-58857, CVE-2026-58859, CVE-2026-58860, CVE-2026-58866, CVE-2026-58867, CVE-2026-58868, CVE-2026-58869, CVE-2026-58870, CVE-2026-58871, CVE-2026-58872, CVE-2026-58875, CVE-2026-58877, CVE-2026-58879, CVE-2026-58884, CVE-2026-58885, CVE-2026-58886, CVE-2026-58933, CVE-2026-58934, CVE-2026-58935, CVE-2026-58937, CVE-2026-58938, CVE-2026-58943, CVE-2026-58944, CVE-2026-58945, CVE-2026-58946, CVE-2026-58949, CVE-2026-58951, CVE-2026-58953, CVE-2026-58954, CVE-2026-58955, CVE-2026-58956, CVE-2026-58958, CVE-2026-58960, CVE-2026-58961, CVE-2026-58962, CVE-2026-58963, CVE-2026-58964, CVE-2026-58965, CVE-2026-58966, CVE-2026-58968, CVE-2026-58969, CVE-2026-58970, CVE-2026-58971, CVE-2026-58972, CVE-2026-58973, CVE-2026-58974, CVE-2026-58975, CVE-2026-58976, CVE-2026-58978, CVE-2026-58979
- Unclassified: CVE-2026-55260, CVE-2026-58883

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026080500

Tags:

- [2026080500](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026080500) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026072900 release:

- full 2026-08-05 Pixel security patch level
- update to August 2026 Pixel driver/firmware code
- kernel (Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold): apply fix for CVE-2026-0163
- Contact Scopes: add a workaround for WhatsApp ACCOUNT\_TYPE queries to resolve an incompatibility introduced with Android 17
- Sandboxed Google Play compatibility layer: retain RPC provider connection for out-of-memory adjustment
- backport Android 17 QPR1 fix for Bluetooth developer options confirmation
- kernel (6.1, 6.6, 6.12): backport patch for CVE-2026-64560
- kernel (6.1): update to latest GKI LTS branch revision
- kernel (6.6): update to latest GKI LTS branch revision
- kernel (6.12): update to latest GKI LTS branch revision
- Vanadium: update to [version 151.0.7922.71.0](https://github.com/GrapheneOS/Vanadium/releases/tag/151.0.7922.71.0)
- Camera: update to [version 91](https://github.com/GrapheneOS/Camera/releases/tag/91)
- Camera: update to [version 92](https://github.com/GrapheneOS/Camera/releases/tag/92)
- Camera: update to [version 93](https://github.com/GrapheneOS/Camera/releases/tag/93)
- PDF Viewer: update to [version 33](https://github.com/GrapheneOS/PdfViewer/releases/tag/33)
- adevtool: add command for removing unused device images
- adevtool: improve the apply-bulletin-patches command

All of the Android 17 security patches from the current September 2026, October 2026, November 2026, December 2026 and January 2027 Android Security Bulletins are included in the 2026080501 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-28591, CVE-2026-28604, CVE-2026-28639, CVE-2026-28653, CVE-2026-28662, CVE-2026-28666, CVE-2026-45515, CVE-2026-45531, CVE-2026-49879, CVE-2026-49882, CVE-2026-49884, CVE-2026-49918, CVE-2026-49921, CVE-2026-49926, CVE-2026-49927, CVE-2026-49932, CVE-2026-49933, CVE-2026-55256, CVE-2026-55268, CVE-2026-55269, CVE-2026-55273, CVE-2026-55277, CVE-2026-55280, CVE-2026-58814, CVE-2026-58820, CVE-2026-58823, CVE-2026-58835, CVE-2026-58865, CVE-2026-58868, CVE-2026-58876, CVE-2026-58880, CVE-2026-58882
- High: CVE-2025-22442, CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2026-0053, CVE-2026-28581, CVE-2026-28582, CVE-2026-28584, CVE-2026-28588, CVE-2026-28593, CVE-2026-28594, CVE-2026-28599, CVE-2026-28600, CVE-2026-28602, CVE-2026-28603, CVE-2026-28606, CVE-2026-28607, CVE-2026-28612, CVE-2026-28613, CVE-2026-28614, CVE-2026-28617, CVE-2026-28619, CVE-2026-28620, CVE-2026-28622, CVE-2026-28623, CVE-2026-28624, CVE-2026-28626, CVE-2026-28627, CVE-2026-28630, CVE-2026-28631, CVE-2026-28633, CVE-2026-28634, CVE-2026-28635, CVE-2026-28638, CVE-2026-28643, CVE-2026-28650, CVE-2026-28652, CVE-2026-28655, CVE-2026-28657, CVE-2026-28658, CVE-2026-28660, CVE-2026-28663, CVE-2026-28664, CVE-2026-28665, CVE-2026-28667, CVE-2026-28668, CVE-2026-28671, CVE-2026-45513, CVE-2026-45514, CVE-2026-45517, CVE-2026-45518, CVE-2026-45519, CVE-2026-45520, CVE-2026-45521, CVE-2026-45522, CVE-2026-45523, CVE-2026-45524, CVE-2026-45525, CVE-2026-45527, CVE-2026-45528, CVE-2026-45529, CVE-2026-49878, CVE-2026-49880, CVE-2026-49881, CVE-2026-49885, CVE-2026-49887, CVE-2026-49895, CVE-2026-49896, CVE-2026-49912, CVE-2026-49913, CVE-2026-49914, CVE-2026-49923, CVE-2026-49924, CVE-2026-49925, CVE-2026-49931, CVE-2026-49934, CVE-2026-49935, CVE-2026-49937, CVE-2026-55257, CVE-2026-55261, CVE-2026-55262, CVE-2026-55263, CVE-2026-55264, CVE-2026-55266, CVE-2026-55270, CVE-2026-55271, CVE-2026-55272, CVE-2026-55278, CVE-2026-55279, CVE-2026-55282, CVE-2026-55286, CVE-2026-55287, CVE-2026-55288, CVE-2026-55289, CVE-2026-55290, CVE-2026-55292, CVE-2026-55294, CVE-2026-58815, CVE-2026-58817, CVE-2026-58821, CVE-2026-58822, CVE-2026-58834, CVE-2026-58836, CVE-2026-58837, CVE-2026-58838, CVE-2026-58841, CVE-2026-58853, CVE-2026-58854, CVE-2026-58856, CVE-2026-58857, CVE-2026-58859, CVE-2026-58860, CVE-2026-58866, CVE-2026-58867, CVE-2026-58868, CVE-2026-58869, CVE-2026-58870, CVE-2026-58871, CVE-2026-58872, CVE-2026-58875, CVE-2026-58877, CVE-2026-58879, CVE-2026-58884, CVE-2026-58885, CVE-2026-58886, CVE-2026-58933, CVE-2026-58934, CVE-2026-58937, CVE-2026-58938, CVE-2026-58943, CVE-2026-58944, CVE-2026-58945, CVE-2026-58946, CVE-2026-58949, CVE-2026-58951, CVE-2026-58953, CVE-2026-58954, CVE-2026-58955, CVE-2026-58957, CVE-2026-58958
- Unclassified: CVE-2026-55260, CVE-2026-58883, CVE-2026-58935

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026072900

Tags:

- [2026072900](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026072900) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026071500 release:

- extend per-app opt-out for hardened\_malloc and extended virtual address space to child processes to support working around rare app compatibility issues involving separate native processes run by an app
- override previous SELinux context for secure (exec) spawning to fix compatibility with anti-tampering libraries checking for it
- ContactsProvider: fix upstream Android security vulnerability
- Telephony: fix upstream Android security vulnerability caused by missing system permission check for apps with API levels below 30
- adevtool: include feature flags for Pixel NFC/eSE/eSIM firmware updater to avoid deviating from the stock OS
- work around upstream bug for original-package renaming to resolve crashes with Vanadium on OS installs from 4-5 years ago when using the native zygote (we had to temporarily turn off javaless renderers in Vanadium Config 192 and will re-enable it after this OS release)
- libpng: backport upstream security patches
- kernel (6.1): update to latest GKI LTS branch revision including update to 6.1.175
- kernel (6.6): update to latest GKI LTS branch revision including update to 6.6.142
- kernel (6.12): update to latest GKI LTS branch revision including update to 6.12.92
- improve GrapheneOS package state infrastructure to fix minor rare non-serious bugs
- replace our workarounds for pseudo-locale crashes with a proper fix for the issue
- Vanadium: update to [version 151.0.7922.29.0](https://github.com/GrapheneOS/Vanadium/releases/tag/151.0.7922.29.0)
- Vanadium: update to [version 151.0.7922.47.0](https://github.com/GrapheneOS/Vanadium/releases/tag/151.0.7922.47.0)
- Info: update to [version 7](https://github.com/GrapheneOS/Info/releases/tag/7)
- GmsCompatConfig: update to [version 172](https://github.com/GrapheneOS/platform_packages_apps_GmsCompat/releases/tag/config-172)
- add a way to use any WebView provider on OS debug builds
- fix pointer aliasing in malloc dispatch tables to fix malloc debug functionality in certain cases

All of the Android 17 security patches from the current August 2026, September 2026, October 2026, November 2026, December 2026 and January 2027 Android Security Bulletins are included in the 2026072901 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-28591, CVE-2026-28604, CVE-2026-28639, CVE-2026-28662, CVE-2026-28666, CVE-2026-45515, CVE-2026-45531, CVE-2026-49879, CVE-2026-49882, CVE-2026-49884, CVE-2026-49918, CVE-2026-49921, CVE-2026-49926, CVE-2026-49927, CVE-2026-49932, CVE-2026-49933, CVE-2026-55256, CVE-2026-55268, CVE-2026-55269, CVE-2026-55273, CVE-2026-55277, CVE-2026-55280, CVE-2026-58814, CVE-2026-58823, CVE-2026-58835, CVE-2026-58865, CVE-2026-58868, CVE-2026-58876, CVE-2026-58880, CVE-2026-58882
- High: CVE-2025-22442, CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2026-0053, CVE-2026-28581, CVE-2026-28582, CVE-2026-28584, CVE-2026-28588, CVE-2026-28593, CVE-2026-28594, CVE-2026-28599, CVE-2026-28600, CVE-2026-28602, CVE-2026-28603, CVE-2026-28606, CVE-2026-28607, CVE-2026-28612, CVE-2026-28613, CVE-2026-28614, CVE-2026-28617, CVE-2026-28619, CVE-2026-28620, CVE-2026-28622, CVE-2026-28623, CVE-2026-28624, CVE-2026-28626, CVE-2026-28627, CVE-2026-28630, CVE-2026-28631, CVE-2026-28633, CVE-2026-28634, CVE-2026-28635, CVE-2026-28638, CVE-2026-28643, CVE-2026-28650, CVE-2026-28652, CVE-2026-28655, CVE-2026-28657, CVE-2026-28658, CVE-2026-28660, CVE-2026-28663, CVE-2026-28664, CVE-2026-28665, CVE-2026-28667, CVE-2026-28668, CVE-2026-28671, CVE-2026-45513, CVE-2026-45514, CVE-2026-45517, CVE-2026-45518, CVE-2026-45519, CVE-2026-45520, CVE-2026-45521, CVE-2026-45522, CVE-2026-45523, CVE-2026-45524, CVE-2026-45525, CVE-2026-45527, CVE-2026-45528, CVE-2026-45529, CVE-2026-49878, CVE-2026-49880, CVE-2026-49881, CVE-2026-49885, CVE-2026-49887, CVE-2026-49895, CVE-2026-49896, CVE-2026-49912, CVE-2026-49913, CVE-2026-49914, CVE-2026-49923, CVE-2026-49924, CVE-2026-49925, CVE-2026-49931, CVE-2026-49934, CVE-2026-49935, CVE-2026-49937, CVE-2026-55257, CVE-2026-55261, CVE-2026-55262, CVE-2026-55263, CVE-2026-55264, CVE-2026-55266, CVE-2026-55270, CVE-2026-55271, CVE-2026-55272, CVE-2026-55278, CVE-2026-55279, CVE-2026-55282, CVE-2026-55286, CVE-2026-55287, CVE-2026-55288, CVE-2026-55289, CVE-2026-55290, CVE-2026-55292, CVE-2026-55294, CVE-2026-58815, CVE-2026-58817, CVE-2026-58821, CVE-2026-58822, CVE-2026-58834, CVE-2026-58836, CVE-2026-58837, CVE-2026-58838, CVE-2026-58841, CVE-2026-58853, CVE-2026-58854, CVE-2026-58856, CVE-2026-58857, CVE-2026-58859, CVE-2026-58860, CVE-2026-58866, CVE-2026-58868, CVE-2026-58869, CVE-2026-58871, CVE-2026-58872, CVE-2026-58875, CVE-2026-58877, CVE-2026-58879, CVE-2026-58885, CVE-2026-58886, CVE-2026-58933, CVE-2026-58934, CVE-2026-58937, CVE-2026-58938, CVE-2026-58943, CVE-2026-58944, CVE-2026-58946, CVE-2026-58949
- Unclassified: CVE-2026-28653, CVE-2026-55260, CVE-2026-58820, CVE-2026-58883, CVE-2026-58935

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026071500

Tags:

- [2026071500](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026071500) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026071100 release:

- Secure (exec) spawning: skip vkey.android.vos.VosZygotePreload to make exec-based spawning compatible with apps using V-KEY V-OS Mobile App Protection
- Secure (exec) spawning: skip redundant mount namespace setup for compatibility with anti-tampering code checking Linux mount IDs
- start compat zygote at boot instead of on-demand for compatibility with anti-tampering code checking Linux mount IDs (compat zygote is only used when both secure spawning and hardened\_malloc are disabled for an app)
- use lazy preloading for compat zygote to reduce memory usage when it's not used (it's only used for app processes which disable both hardened\_malloc and secure spawning)
- install CarrierConfig2 in all profiles to avoid using default carrier configuration values in secondary users
- notify when Wi-Fi hotspot is disabled due to user change (since users have separate Wi-Fi settings since Android 17) to provide a shortcut for turning it back on via the notification
- remove our change raising the zygote's maximum file limit to 256Ki since this has been implemented upstream as a 512Ki limit with correct handling for 32-bit processes
- kernel (Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold): integrate minor upstream synopsys driver change unrelated to security
- kernel (6.6): update to latest GKI LTS branch revision including update to 6.6.141
- Vanadium: update to [version 150.0.7871.124.0](https://github.com/GrapheneOS/Vanadium/releases/tag/150.0.7871.124.0)
- add secure spawning file descriptor regression test

All of the Android 17 security patches from the current August 2026, September 2026, October 2026, November 2026, December 2026 and January 2027 Android Security Bulletins are included in the 2026071501 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-28591, CVE-2026-28604, CVE-2026-28639, CVE-2026-28662, CVE-2026-28666, CVE-2026-45515, CVE-2026-45531, CVE-2026-49879, CVE-2026-49882, CVE-2026-49884, CVE-2026-49918, CVE-2026-49921, CVE-2026-49926, CVE-2026-49927, CVE-2026-49932, CVE-2026-49933, CVE-2026-55256, CVE-2026-55268, CVE-2026-55269, CVE-2026-55273, CVE-2026-55277, CVE-2026-55280, CVE-2026-58823, CVE-2026-58835, CVE-2026-58865
- High: CVE-2025-22442, CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2026-0053, CVE-2026-28581, CVE-2026-28582, CVE-2026-28584, CVE-2026-28588, CVE-2026-28593, CVE-2026-28594, CVE-2026-28599, CVE-2026-28600, CVE-2026-28602, CVE-2026-28603, CVE-2026-28606, CVE-2026-28607, CVE-2026-28612, CVE-2026-28613, CVE-2026-28614, CVE-2026-28617, CVE-2026-28619, CVE-2026-28620, CVE-2026-28622, CVE-2026-28623, CVE-2026-28624, CVE-2026-28626, CVE-2026-28627, CVE-2026-28630, CVE-2026-28631, CVE-2026-28633, CVE-2026-28634, CVE-2026-28635, CVE-2026-28638, CVE-2026-28643, CVE-2026-28650, CVE-2026-28652, CVE-2026-28655, CVE-2026-28657, CVE-2026-28658, CVE-2026-28660, CVE-2026-28663, CVE-2026-28664, CVE-2026-28665, CVE-2026-28667, CVE-2026-28668, CVE-2026-28671, CVE-2026-45513, CVE-2026-45514, CVE-2026-45517, CVE-2026-45518, CVE-2026-45519, CVE-2026-45520, CVE-2026-45521, CVE-2026-45523, CVE-2026-45524, CVE-2026-45525, CVE-2026-45527, CVE-2026-45528, CVE-2026-45529, CVE-2026-49878, CVE-2026-49880, CVE-2026-49881, CVE-2026-49885, CVE-2026-49887, CVE-2026-49895, CVE-2026-49896, CVE-2026-49912, CVE-2026-49913, CVE-2026-49914, CVE-2026-49923, CVE-2026-49924, CVE-2026-49925, CVE-2026-49931, CVE-2026-49934, CVE-2026-49935, CVE-2026-49937, CVE-2026-55257, CVE-2026-55261, CVE-2026-55262, CVE-2026-55263, CVE-2026-55264, CVE-2026-55266, CVE-2026-55270, CVE-2026-55271, CVE-2026-55272, CVE-2026-55278, CVE-2026-55279, CVE-2026-55282, CVE-2026-55286, CVE-2026-55287, CVE-2026-55288, CVE-2026-55289, CVE-2026-55290, CVE-2026-55292, CVE-2026-55294, CVE-2026-58815, CVE-2026-58817, CVE-2026-58821, CVE-2026-58822, CVE-2026-58834, CVE-2026-58836, CVE-2026-58837, CVE-2026-58838, CVE-2026-58841, CVE-2026-58853, CVE-2026-58854, CVE-2026-58856, CVE-2026-58857, CVE-2026-58859, CVE-2026-58860, CVE-2026-58868, CVE-2026-58869
- Unclassified: CVE-2026-28653, CVE-2026-55260, CVE-2026-58820

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026071100

Tags:

- [2026071100](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026071100) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026070500 release:

- replace secure (exec) spawning feature with a new implementation with improved app compatibility and a per-app toggle replacing the previous global toggle
- extend exec spawning feature to the native zygote added in Android 17
- raise listed security patch level to 2026-07-05 security patch level which has no additional patches listed in either the Android or Pixel bulletin
- update to July 2026 Pixel driver/firmware code
- fix upstream bug in multi-user handling for the WifiService package state listener which among other possible issues was causing wireless Android Auto compatibility issues in secondary users
- fix upstream bug in RemoteException handling for GeocodeProviderBase causing exceptions between the geocoding service and client app to crash the geocoding service
- fix external display mirroring in secondary users (upstream bug)
- fix handling of multiple users for screen recording (upstream bug)
- Sandboxed Google Play compatibility layer: add MODIFY\_PHONE\_STATE to the special Android Auto phone call permissions toggle since it's needed for managing phone calls in recent versions
- kernel (6.6): update to latest GKI LTS branch revision including update to 6.6.140
- kernel (6.12): update to latest GKI LTS branch revision including update to 6.12.90
- bionic libc: fix API level check for %#m format string (upstream bug)
- update\_device.py: improve the experience of testing updates on debug builds by avoiding restarting ADB as root
- PDF Viewer: update to [version 32](https://github.com/GrapheneOS/PdfViewer/releases/tag/32)
- Vanadium: update to [version 150.0.7871.114.0](https://github.com/GrapheneOS/Vanadium/releases/tag/150.0.7871.114.0)

All of the Android 17 security patches from the current August 2026, September 2026, October 2026, November 2026, December 2026 and January 2027 Android Security Bulletins are included in the 2026071101 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-28591, CVE-2026-28604, CVE-2026-28639, CVE-2026-28662, CVE-2026-28666, CVE-2026-45515, CVE-2026-45531, CVE-2026-49879, CVE-2026-49882, CVE-2026-49884, CVE-2026-49918, CVE-2026-49921, CVE-2026-49926, CVE-2026-49927, CVE-2026-49933
- High: CVE-2025-22442, CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2026-28581, CVE-2026-28582, CVE-2026-28584, CVE-2026-28588, CVE-2026-28593, CVE-2026-28594, CVE-2026-28599, CVE-2026-28600, CVE-2026-28602, CVE-2026-28603, CVE-2026-28606, CVE-2026-28607, CVE-2026-28612, CVE-2026-28613, CVE-2026-28614, CVE-2026-28617, CVE-2026-28619, CVE-2026-28620, CVE-2026-28622, CVE-2026-28623, CVE-2026-28624, CVE-2026-28626, CVE-2026-28627, CVE-2026-28630, CVE-2026-28631, CVE-2026-28633, CVE-2026-28634, CVE-2026-28635, CVE-2026-28638, CVE-2026-28650, CVE-2026-28652, CVE-2026-28655, CVE-2026-28657, CVE-2026-28658, CVE-2026-28660, CVE-2026-28663, CVE-2026-28664, CVE-2026-28665, CVE-2026-28667, CVE-2026-28668, CVE-2026-28671, CVE-2026-45513, CVE-2026-45514, CVE-2026-45517, CVE-2026-45518, CVE-2026-45519, CVE-2026-45520, CVE-2026-45521, CVE-2026-45523, CVE-2026-45524, CVE-2026-45525, CVE-2026-45527, CVE-2026-45528, CVE-2026-45529, CVE-2026-49878, CVE-2026-49880, CVE-2026-49881, CVE-2026-49885, CVE-2026-49887, CVE-2026-49895, CVE-2026-49896, CVE-2026-49912, CVE-2026-49913, CVE-2026-49914, CVE-2026-49923, CVE-2026-49924, CVE-2026-49925, CVE-2026-49931, CVE-2026-49934, CVE-2026-49935, CVE-2026-49937, CVE-2026-55257, CVE-2026-55258, CVE-2026-55261, CVE-2026-55262, CVE-2026-55263
- Unclassified: CVE-2026-28653, CVE-2026-55260

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026070500

Users solely doing offline updates via recovery mode sideloading need a [special sideload-only release](https://discuss.grapheneos.org/d/37947-special-sideload-only-android-16-qpr2-release-fixing-sideloading-to-android-17) to update from Android 16 QPR2 to Android 17. This release fixes upstream bugs for sideloading present in Android 16 QPR2 which prevented updating to Android 17 unless the OS images were far larger than the GrapheneOS ones which triggers a fallback path avoiding the issue.

Tags:

- [2026070500](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026070500) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026062800 release:

- rebuild coarse locations from allowlisted fields to resolve an upstream Android privacy flaw leaking secondary fields such as altitude and accuracy to apps without precise location granted
- System UI:: run scroll capture tile handling on main thread to fix an upstream race condition causing memory corruption
- Launcher: fix removing space for the quick search bar to avoid removing padding at the bottom
- fix PIN scrambling for Private Spaces configured to use parent credentials
- implement enhanced PIN privacy for the new PIN pad used outside of the lockscreen
- fix handling of TEXT\_SHOW\_PASSWORD to split TEXT\_SHOW\_PASSWORD\_TOUCH TEXT\_SHOW\_PASSWORD\_PHYSICAL in Android 17
- backport security patches for FreeType
- kernel (6.1, 6.6, 6.12): fix upstream double-free bug in USB gadget Ethernet driver which was caught by hardware memory tagging in GrapheneOS
- kernel (6.1): update to latest GKI LTS branch revision
- kernel (6.6): update to latest GKI LTS branch revision
- kernel (6.12): update to latest GKI LTS branch revision
- kernel (6.1, 6.6, 6.12): backport fixes for CVE-2026-46242
- enable precompiling dex bytecode for Vanadium now that the Trichrome Library APK no longer breaks compatibility with it (shared library APKs are incompatible with precompilation and this is the only one in the OS)
- Theme Picker: replace references to apps not included in GrapheneOS to avoid black icons
- Vanadium: update to [version 150.0.7871.63.0](https://github.com/GrapheneOS/Vanadium/releases/tag/150.0.7871.63.0)
- Vanadium: update to [version 150.0.7871.63.1](https://github.com/GrapheneOS/Vanadium/releases/tag/150.0.7871.63.1)

All of the Android 17 security patches from the current July 2026, August 2026, September 2026, October 2026, November 2026, December 2026 and January 2027 Android Security Bulletins are included in the 2026070501 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-28591, CVE-2026-28604, CVE-2026-28639, CVE-2026-28662, CVE-2026-28666, CVE-2026-45515, CVE-2026-45531, CVE-2026-49879, CVE-2026-49882, CVE-2026-49884, CVE-2026-49918, CVE-2026-49921, CVE-2026-49926, CVE-2026-49927, CVE-2026-49933
- High: CVE-2025-22442, CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2026-28581, CVE-2026-28582, CVE-2026-28584, CVE-2026-28588, CVE-2026-28593, CVE-2026-28594, CVE-2026-28599, CVE-2026-28600, CVE-2026-28602, CVE-2026-28603, CVE-2026-28606, CVE-2026-28607, CVE-2026-28612, CVE-2026-28613, CVE-2026-28614, CVE-2026-28617, CVE-2026-28619, CVE-2026-28620, CVE-2026-28622, CVE-2026-28623, CVE-2026-28624, CVE-2026-28626, CVE-2026-28627, CVE-2026-28630, CVE-2026-28631, CVE-2026-28633, CVE-2026-28634, CVE-2026-28635, CVE-2026-28638, CVE-2026-28650, CVE-2026-28652, CVE-2026-28655, CVE-2026-28657, CVE-2026-28658, CVE-2026-28660, CVE-2026-28663, CVE-2026-28664, CVE-2026-28665, CVE-2026-28667, CVE-2026-28668, CVE-2026-28671, CVE-2026-45513, CVE-2026-45514, CVE-2026-45517, CVE-2026-45518, CVE-2026-45519, CVE-2026-45520, CVE-2026-45521, CVE-2026-45523, CVE-2026-45524, CVE-2026-45525, CVE-2026-45527, CVE-2026-45528, CVE-2026-45529, CVE-2026-49878, CVE-2026-49880, CVE-2026-49881, CVE-2026-49885, CVE-2026-49887, CVE-2026-49895, CVE-2026-49896, CVE-2026-49912, CVE-2026-49913, CVE-2026-49914, CVE-2026-49923, CVE-2026-49924, CVE-2026-49925, CVE-2026-49931, CVE-2026-49934, CVE-2026-49935, CVE-2026-49937, CVE-2026-55257, CVE-2026-55258, CVE-2026-55261, CVE-2026-55262, CVE-2026-55263
- Unclassified: CVE-2026-28653, CVE-2026-55260

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026062800

Tags:

- [2026062800](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026062800) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026062300 release:

- add setting for controlling Certificate Transparency (CT) log list downloads used for apps enforcing CT which is enabled by default for apps targeting Android 17+ with a choice between GrapheneOS (default), Standard (previous behavior) and Off
- enable register\_bluetooth\_receiver\_for\_all\_users feature flag to fix Bluetooth telecom functionality in secondary users (resolves an upstream regression in Android 17)
- temporarily use absolute media profile XML paths to work around an exec-based spawning compatibility issue breaking WhatsApp functionality which will be properly addressed by our upcoming overhaul to exec-based spawning
- add native zygote support to handle Chrome using it and for future use in Vanadium once exec spawning is ported to it
- build wpa\_supplicant\_mainline from source since it's used instead of the vendor wpa\_supplicant on the Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL and Pixel 10 Pro Fold
- fix NFC quick tile state not updating in secondary users
- Settings: fix lifecycle of the added NFC state listener to avoid crashes for the Connection preferences page in edge cases
- Settings: fix minor regression losing listing the duress password feature as being one of the settings available in the screen lock menu which helps people discover the feature
- Sandboxed Google Play compatibility layer: add stub for PackageInstaller.installPackageArchived()
- Sandboxed Google Play compatibility layer: use fresh file proxy file descriptors for app opens to fix compatibility issues
- kernel (Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold): fix another upstream out-of-bounds array read caught by hardware memory tagging in the DisplayPort driver caused by devices implementing the DisplayPort protocol incorrectly and the kernel driver not properly handling the incorrect data
- don't report harmless ExynosDevice::dynamicRecompositionThreadLoop crash
- Seedvault: grant local network access to fix local network usage for backups with Android 17
- Vanadium: update to [version 149.0.7827.197.0](https://github.com/GrapheneOS/Vanadium/releases/tag/149.0.7827.197.0)
- AppCompatConfig: update to [version 7](https://github.com/GrapheneOS/platform_packages_apps_AppCompatConfig/releases/tag/7)

All of the Android 17 security patches from the current July 2026, August 2026, September 2026, October 2026, November 2026 and December 2026 Android Security Bulletins are included in the 2026062801 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-28591, CVE-2026-28604, CVE-2026-28639, CVE-2026-28662, CVE-2026-28666, CVE-2026-45515, CVE-2026-45531, CVE-2026-49879, CVE-2026-49882, CVE-2026-49884, CVE-2026-49921
- High: CVE-2025-22442, CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2026-28581, CVE-2026-28582, CVE-2026-28584, CVE-2026-28588, CVE-2026-28593, CVE-2026-28594, CVE-2026-28599, CVE-2026-28600, CVE-2026-28602, CVE-2026-28603, CVE-2026-28606, CVE-2026-28607, CVE-2026-28612, CVE-2026-28613, CVE-2026-28614, CVE-2026-28617, CVE-2026-28619, CVE-2026-28620, CVE-2026-28622, CVE-2026-28623, CVE-2026-28624, CVE-2026-28626, CVE-2026-28627, CVE-2026-28630, CVE-2026-28631, CVE-2026-28633, CVE-2026-28634, CVE-2026-28635, CVE-2026-28638, CVE-2026-28650, CVE-2026-28652, CVE-2026-28655, CVE-2026-28657, CVE-2026-28658, CVE-2026-28660, CVE-2026-28663, CVE-2026-28664, CVE-2026-28665, CVE-2026-28667, CVE-2026-28668, CVE-2026-28671, CVE-2026-45513, CVE-2026-45514, CVE-2026-45516, CVE-2026-45517, CVE-2026-45518, CVE-2026-45519, CVE-2026-45520, CVE-2026-45521, CVE-2026-45523, CVE-2026-45524, CVE-2026-45525, CVE-2026-45527, CVE-2026-45528, CVE-2026-45529, CVE-2026-49878, CVE-2026-49880, CVE-2026-49881, CVE-2026-49885, CVE-2026-49887, CVE-2026-49895, CVE-2026-49896, CVE-2026-49912, CVE-2026-49913, CVE-2026-49914, CVE-2026-49924
- Unclassified: CVE-2026-28653

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026062300

Tags:

- [2026062300](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026062300) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026062200 release:

- fix serious upstream Android VPN race condition resulting in the always-on VPN being disabled in edge cases including VPN app updates
- fix Bluetooth auto-off in secondary users for Android 17
- Sandboxed Google Play compatibility layer: resolve ThermalManagerService droidguard incompatibility causing RCS to break after droidguard is updated
- Sandboxed Google Play compatibility layer: increase log level of maybeInterceptBinderProxyDump() to help with debugging droidguard checks

All of the Android 17 security patches from the current July 2026, August 2026, September 2026, October 2026, November 2026 and December 2026 Android Security Bulletins are included in the 2026062301 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-28591, CVE-2026-28604, CVE-2026-28639, CVE-2026-28662, CVE-2026-28666, CVE-2026-45515, CVE-2026-45531, CVE-2026-49879, CVE-2026-49882, CVE-2026-49884
- High: CVE-2025-22442, CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2026-28581, CVE-2026-28582, CVE-2026-28584, CVE-2026-28588, CVE-2026-28593, CVE-2026-28594, CVE-2026-28599, CVE-2026-28600, CVE-2026-28602, CVE-2026-28603, CVE-2026-28606, CVE-2026-28607, CVE-2026-28612, CVE-2026-28613, CVE-2026-28614, CVE-2026-28617, CVE-2026-28619, CVE-2026-28620, CVE-2026-28622, CVE-2026-28623, CVE-2026-28624, CVE-2026-28626, CVE-2026-28627, CVE-2026-28630, CVE-2026-28631, CVE-2026-28633, CVE-2026-28634, CVE-2026-28635, CVE-2026-28638, CVE-2026-28650, CVE-2026-28652, CVE-2026-28655, CVE-2026-28657, CVE-2026-28658, CVE-2026-28660, CVE-2026-28663, CVE-2026-28664, CVE-2026-28665, CVE-2026-28667, CVE-2026-28668, CVE-2026-28671, CVE-2026-45513, CVE-2026-45514, CVE-2026-45516, CVE-2026-45517, CVE-2026-45518, CVE-2026-45519, CVE-2026-45520, CVE-2026-45521, CVE-2026-45523, CVE-2026-45524, CVE-2026-45525, CVE-2026-45527, CVE-2026-45528, CVE-2026-45529, CVE-2026-49880, CVE-2026-49881, CVE-2026-49885
- Unclassified: CVE-2026-28653

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026062200

Tags:

- [2026062200](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026062200) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026062100 release:

- change the behavior of pressing the new Android 17 Wi-Fi quick tile to disabling Wi-Fi instead of only pausing it by disconnecting from the current network and not actively connecting to another automatically
- backport upstream fix for recovery mode sideloading to replace the workaround we included in our initial public Android 17 release (this will needed to be backported to Android 16 QPR2 to provide a sideload upgrade path)
- Sandboxed Google Play compatibility layer: add local network access to the permissions added by the wireless Android Auto toggle since it's often required
- Sandboxed Google Play compatibility layer: add stub for NsdManager.registerService() to handle lack of ACCESS\_LOCAL\_NETWORK
- enable photopicker in Wallpaper Picker app to restore photo picker functionality from before Android 17
- Wallpaper Picker: add vertical padding to the "Choose a photo" button
- Launcher: fix hidden workspace app labels on non-responsive grids

All of the Android 17 security patches from the current July 2026, August 2026, September 2026, October 2026, November 2026 and December 2026 Android Security Bulletins are included in the 2026062201 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-28591, CVE-2026-28604, CVE-2026-28639, CVE-2026-28662, CVE-2026-28666, CVE-2026-45515, CVE-2026-45531
- High: CVE-2025-22442, CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2026-28582, CVE-2026-28584, CVE-2026-28588, CVE-2026-28593, CVE-2026-28594, CVE-2026-28599, CVE-2026-28600, CVE-2026-28602, CVE-2026-28603, CVE-2026-28606, CVE-2026-28607, CVE-2026-28612, CVE-2026-28613, CVE-2026-28614, CVE-2026-28617, CVE-2026-28619, CVE-2026-28620, CVE-2026-28622, CVE-2026-28623, CVE-2026-28624, CVE-2026-28626, CVE-2026-28630, CVE-2026-28631, CVE-2026-28633, CVE-2026-28634, CVE-2026-28635, CVE-2026-28638, CVE-2026-28643, CVE-2026-28650, CVE-2026-28652, CVE-2026-28655, CVE-2026-28657, CVE-2026-28658, CVE-2026-28660, CVE-2026-28663, CVE-2026-28664, CVE-2026-28665, CVE-2026-28667, CVE-2026-28668, CVE-2026-28671, CVE-2026-45513, CVE-2026-45514, CVE-2026-45516, CVE-2026-45517, CVE-2026-45518, CVE-2026-45519, CVE-2026-45520, CVE-2026-45521, CVE-2026-45523, CVE-2026-45524, CVE-2026-45525, CVE-2026-45527, CVE-2026-45528, CVE-2026-45529, CVE-2026-49880
- Unclassified: CVE-2026-28653

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026062100

Tags:

- [2026062100](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026062100) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026061800 release:

- disable MTE for Widevine Rikers service since it's incompatible with it (issue predates Android 17)
- Sandboxed Google Play compatibility layer: avoid opening extra file descriptions to obtain Play services data prefix paths to avoid a compatibility issue with anti-tampering code used by the Kia Connect app and likely others (issue predates Android 17)
- separate GrapheneOS framework resource IDs from AOSP resource IDs to avoid incompatibilities with Pixel vendor components (issue predates Android 17)
- kernel (Pixel 10): fix for an upstream Broadcom Wi-Fi bcm4383 driver memory corruption bug to avoid invalid memory accesses caught by the kernel hardware memory tagging enabled by GrapheneOS
- disable UBLK feature flag for over-the-air updates due to it likely causing update reliability issues for devices with support for it (6.6 kernel or newer)
- disable UBLK for generated over-the-air update packages to force disable it for updates from the initial Android 17 release
- increase the maximum size of log events in production builds to match debug builds to avoid the kernel panic message and traceback being cut off
- use DevicePolicyManager.MAX\_PASSWORD\_LENGTH PIN length limit for the new upstream SystemUI PIN user interface for entering the PIN outside of the lockscreen to fix support for the expanded limit of 128 on GrapheneOS instead of using Android's limit of 16 (this didn't apply to passwords and it was straightforward to work around it by changing the PIN to a password)
- Settings: show night light settings even when Pixel Comfort View is enabled since we're missing the settings for it (currently only relevant to the 10th gen Pixels other than the Pixel 10a)
- allow using the new flashlight quick tile while locked (GrapheneOS requires unlocking by default for system quick tiles)
- SystemUI: avoid crashing when trying to edit a screen recording without a video editor app
- fix upstream bug causing the security scan in the Settings app to take much longer in Android 17 (also impacts the stock OS)
- fix compatibility issue breaking resetting permissions for apps with special-runtime permissions (Nearby Devices is now split to have Local Network access enabled by default for compatibility for apps not targeting Android 17 and there are bugs with how this is handled)
- Launcher: remove quick search bar from showing on large display devices since Android 17
- Launcher: remove space reserved for the quick search bar since Android 17
- add Pixel Comfort View settings for supported devices (Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold)
- add back error message for entering an incorrect 2nd factor PIN for the GrapheneOS 2-factor fingerprint unlock feature
- fix compatibility with the native zygote spawning system added by Android 17 which isn't enabled yet (this was added to provide more lightweight sandboxed renderer processes for Chromium and will benefit Vanadium even more due to having finer-grained process isolation but isn't used by Chromium/Chrome yet and our secure spawning will need to be ported to it)
- GmsCompatConfig: update to [version 171](https://github.com/GrapheneOS/platform_packages_apps_GmsCompat/releases/tag/config-171)

All of the Android 17 security patches from the current July 2026, August 2026, September 2026, October 2026, November 2026 and December 2026 Android Security Bulletins are included in the 2026062101 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-28591, CVE-2026-28604, CVE-2026-28639, CVE-2026-28662, CVE-2026-28666, CVE-2026-45515, CVE-2026-45531
- High: CVE-2025-22442, CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2026-28582, CVE-2026-28584, CVE-2026-28588, CVE-2026-28593, CVE-2026-28594, CVE-2026-28599, CVE-2026-28600, CVE-2026-28602, CVE-2026-28603, CVE-2026-28606, CVE-2026-28607, CVE-2026-28612, CVE-2026-28613, CVE-2026-28614, CVE-2026-28617, CVE-2026-28619, CVE-2026-28620, CVE-2026-28622, CVE-2026-28623, CVE-2026-28624, CVE-2026-28626, CVE-2026-28630, CVE-2026-28631, CVE-2026-28633, CVE-2026-28634, CVE-2026-28635, CVE-2026-28638, CVE-2026-28643, CVE-2026-28650, CVE-2026-28652, CVE-2026-28655, CVE-2026-28657, CVE-2026-28658, CVE-2026-28660, CVE-2026-28663, CVE-2026-28664, CVE-2026-28665, CVE-2026-28667, CVE-2026-28668, CVE-2026-28671, CVE-2026-45513, CVE-2026-45514, CVE-2026-45516, CVE-2026-45517, CVE-2026-45518, CVE-2026-45519, CVE-2026-45520, CVE-2026-45521, CVE-2026-45523, CVE-2026-45524, CVE-2026-45525, CVE-2026-45527, CVE-2026-45528, CVE-2026-45529, CVE-2026-49880
- Unclassified: CVE-2026-28653

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026061800

This is the initial release of GrapheneOS based on Android 17.

Tags:

- [2026061800](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026061800) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026061600 release:

- full 2026-06-05 Pixel security patch level (released with Android 17)
- rebased onto CP2A.260605.016 Android Open Source Project release (Android 17)
- add workaround for upstream bug breaking using recovery mode sideloading for updating to Android 17 releases
- revert in-process Opus codec sandboxed with LFI (Lightweight Fault Isolation) to dedicated sandboxed process in order to restore compatibility with hardware memory tagging and avoid likely holes in LFI
- Sandboxed Google Play compatibility layer: add stubs for BluetoothLeBroadcast methods
- Vanadium: update to [version 149.0.7827.159.0](https://github.com/GrapheneOS/Vanadium/releases/tag/149.0.7827.159.0)

All of the Android 17 security patches from the current July 2026, August 2026, September 2026, October 2026, November 2026 and December 2026 Android Security Bulletins are included in the 2026061801 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-28591, CVE-2026-28604, CVE-2026-28639, CVE-2026-28662, CVE-2026-28666, CVE-2026-45515, CVE-2026-45531
- High: CVE-2025-22442, CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2026-28582, CVE-2026-28584, CVE-2026-28588, CVE-2026-28593, CVE-2026-28594, CVE-2026-28599, CVE-2026-28600, CVE-2026-28602, CVE-2026-28603, CVE-2026-28606, CVE-2026-28607, CVE-2026-28612, CVE-2026-28613, CVE-2026-28614, CVE-2026-28617, CVE-2026-28619, CVE-2026-28620, CVE-2026-28622, CVE-2026-28623, CVE-2026-28624, CVE-2026-28626, CVE-2026-28630, CVE-2026-28631, CVE-2026-28633, CVE-2026-28634, CVE-2026-28635, CVE-2026-28638, CVE-2026-28643, CVE-2026-28650, CVE-2026-28652, CVE-2026-28655, CVE-2026-28657, CVE-2026-28658, CVE-2026-28660, CVE-2026-28663, CVE-2026-28664, CVE-2026-28665, CVE-2026-28667, CVE-2026-28668, CVE-2026-28671, CVE-2026-45513, CVE-2026-45514, CVE-2026-45516, CVE-2026-45517, CVE-2026-45518, CVE-2026-45519, CVE-2026-45520, CVE-2026-45521, CVE-2026-45523, CVE-2026-45524, CVE-2026-45525, CVE-2026-45527, CVE-2026-45528, CVE-2026-45529, CVE-2026-49880
- Unclassified: CVE-2026-28653

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026061600

This is our final release based on Android 16 QPR2/QPR3 since we've completed our initial port to Android 17 and are resolving regressions to prepare it for a public release very soon.

Tags:

- [2026061600](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026061600) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026060600 release:

- skip replacing pairip Play Store installer check with Play Store source stamp checks for apps installed directly from the Play Store where the check will pass to avoid causing compatibility issues for apps with deeper pairip integration
- hardened\_malloc: add support for Cuttlefish build targets
- Network Location: require TLSv1.3 for Apple and Apple China location services in addition to the GrapheneOS service
- kernel (6.1): update to latest GKI LTS branch revision including update to 6.1.174
- kernel (6.6): update to latest GKI LTS branch revision
- kernel (6.12): update to latest GKI LTS branch revision
- Vanadium: update to [version 149.0.7827.102.0](https://github.com/GrapheneOS/Vanadium/releases/tag/149.0.7827.102.0)
- Vanadium: update to [version 149.0.7827.114.0](https://github.com/GrapheneOS/Vanadium/releases/tag/149.0.7827.114.0)
- GmsCompatConfig: update to [version 170](https://github.com/GrapheneOS/platform_packages_apps_GmsCompat/releases/tag/config-170)
- Speech Services: update to [version 3](https://github.com/GrapheneOS/SpeechServices/releases/tag/3)

All of the Android 16 security patches from the current July 2026, August 2026, September 2026, October 2026, November 2026 and December 2026 Android Security Bulletins are included in the 2026061601 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-27280, CVE-2026-28590, CVE-2026-28591, CVE-2026-28604, CVE-2026-28618, CVE-2026-28639, CVE-2026-28662, CVE-2026-45515, CVE-2026-45531
- High: CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2026-0053, CVE-2026-0054, CVE-2026-0062, CVE-2026-0063, CVE-2026-0065, CVE-2026-0084, CVE-2026-28572, CVE-2026-28582, CVE-2026-28583, CVE-2026-28584, CVE-2026-28585, CVE-2026-28588, CVE-2026-28593, CVE-2026-28594, CVE-2026-28596, CVE-2026-28599, CVE-2026-28600, CVE-2026-28602, CVE-2026-28603, CVE-2026-28606, CVE-2026-28607, CVE-2026-28609, CVE-2026-28612, CVE-2026-28613, CVE-2026-28614, CVE-2026-28617, CVE-2026-28619, CVE-2026-28620, CVE-2026-28623, CVE-2026-28624, CVE-2026-28626, CVE-2026-28631, CVE-2026-28632, CVE-2026-28633, CVE-2026-28634, CVE-2026-28635, CVE-2026-28636, CVE-2026-28638, CVE-2026-28642, CVE-2026-28643, CVE-2026-28644, CVE-2026-28645, CVE-2026-28650, CVE-2026-28652, CVE-2026-28655, CVE-2026-28656, CVE-2026-28657, CVE-2026-28658, CVE-2026-28660, CVE-2026-28663, CVE-2026-28664, CVE-2026-28665, CVE-2026-28667, CVE-2026-28668, CVE-2026-28670, CVE-2026-28671, CVE-2026-45513, CVE-2026-45514, CVE-2026-45516, CVE-2026-45517, CVE-2026-45518, CVE-2026-45519, CVE-2026-45520, CVE-2026-45521, CVE-2026-45522, CVE-2026-45523, CVE-2026-45525, CVE-2026-45527, CVE-2026-45528, CVE-2026-45529, CVE-2026-49880
- Unclassified: CVE-2026-28653

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026060600

Tags:

- [2026060600](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026060600) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026060100 release:

- Launcher: fix upstream bug causing the recents button to become unresponsive for users with third party launchers
- replace validation of Play Store source stamps with a correct implementation (this isn't yet used for security-sensitive purposes but we plan to begin using it to replace security-relevant Play Store source checks in the near future)
- replace implementation of using Play Store source stamps as a substitute for Play Store installer checks included as part of Play Store anti-tampering protection enabled by certain apps (this prevents using the apps when combined with the Play Integrity API store lising toggles)
- Settings: correctly reset tethering offload developer setting when disabling developer options
- Settings: add one-time reset of tethering offload developer setting to re-enable it for everyone who had it disabled by the upstream Android bug when disabling developer options
- Settings: fix upstream null pointer exception bug in SettingsBasePreferenceFragment when listView is null which occurs with at least one of the developer options
- Pixel 10a: add missing SELinux policy for Pixel Camera TPU usage
- Vanadium: update to [version 149.0.7827.59.0](https://github.com/GrapheneOS/Vanadium/releases/tag/149.0.7827.59.0)
- AppCompatConfig: update to [version 5](https://github.com/GrapheneOS/platform_packages_apps_AppCompatConfig/releases/tag/5)
- AppCompatConfig: update to [version 6](https://github.com/GrapheneOS/platform_packages_apps_AppCompatConfig/releases/tag/6)

All of the Android 16 security patches from the current July 2026, August 2026, September 2026, October 2026 and November 2026 Android Security Bulletins are included in the 2026060601 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-27280, CVE-2026-28590, CVE-2026-28591, CVE-2026-28604, CVE-2026-28618, CVE-2026-28639, CVE-2026-28662
- High: CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2026-0053, CVE-2026-0054, CVE-2026-0062, CVE-2026-0063, CVE-2026-0065, CVE-2026-0084, CVE-2026-28572, CVE-2026-28582, CVE-2026-28583, CVE-2026-28584, CVE-2026-28585, CVE-2026-28588, CVE-2026-28593, CVE-2026-28594, CVE-2026-28596, CVE-2026-28599, CVE-2026-28600, CVE-2026-28602, CVE-2026-28603, CVE-2026-28606, CVE-2026-28607, CVE-2026-28609, CVE-2026-28612, CVE-2026-28613, CVE-2026-28614, CVE-2026-28617, CVE-2026-28619, CVE-2026-28620, CVE-2026-28623, CVE-2026-28624, CVE-2026-28626, CVE-2026-28631, CVE-2026-28632, CVE-2026-28633, CVE-2026-28634, CVE-2026-28635, CVE-2026-28636, CVE-2026-28638, CVE-2026-28642, CVE-2026-28643, CVE-2026-28644, CVE-2026-28645, CVE-2026-28650, CVE-2026-28652, CVE-2026-28655, CVE-2026-28656, CVE-2026-28657, CVE-2026-28658, CVE-2026-28660, CVE-2026-28663, CVE-2026-28667, CVE-2026-28668, CVE-2026-28670, CVE-2026-28671
- Unclassified: CVE-2026-28653

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026060100

Tags:

- [2026060100](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026060100) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026052400 release:

- full 2026-06-01 security patch level
- fix Location access indicator to always properly display when only coarse location is granted too
- kernel (Pixel): fix upstream use-after-free bug in Broadcom Wi-Fi driver caught by hardware memory tagging
- kernel (Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold): fix upstream out-of-bounds array read caught by hardware memory tagging in the DisplayPort driver caused by devices implementing the DisplayPort protocol incorrectly and the kernel driver not properly handling the incorrect data
- kernel (6.1): update to latest GKI LTS branch revision
- kernel (6.6): update to latest GKI LTS branch revision
- kernel (6.12): update to latest GKI LTS branch revision including update to 6.12.89
- Speech Services: update to [version 2](https://github.com/GrapheneOS/SpeechServices/releases/tag/2)
- Vanadium: update to [version 149.0.7827.48.0](https://github.com/GrapheneOS/Vanadium/releases/tag/149.0.7827.48.0)
- Auditor: update to [version 92](https://github.com/GrapheneOS/Auditor/releases/tag/92)

All of the Android 16 security patches from the current July 2026, August 2026, September 2026, October 2026 and November 2026 Android Security Bulletins are included in the 2026060101 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-27280, CVE-2026-28590, CVE-2026-28591, CVE-2026-28604, CVE-2026-28618, CVE-2026-28639, CVE-2026-28662
- High: CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2026-0053, CVE-2026-0054, CVE-2026-0062, CVE-2026-0063, CVE-2026-0065, CVE-2026-0084, CVE-2026-28572, CVE-2026-28582, CVE-2026-28583, CVE-2026-28584, CVE-2026-28585, CVE-2026-28588, CVE-2026-28593, CVE-2026-28594, CVE-2026-28596, CVE-2026-28599, CVE-2026-28600, CVE-2026-28602, CVE-2026-28603, CVE-2026-28606, CVE-2026-28607, CVE-2026-28609, CVE-2026-28612, CVE-2026-28613, CVE-2026-28614, CVE-2026-28617, CVE-2026-28619, CVE-2026-28620, CVE-2026-28623, CVE-2026-28624, CVE-2026-28626, CVE-2026-28631, CVE-2026-28632, CVE-2026-28633, CVE-2026-28634, CVE-2026-28635, CVE-2026-28636, CVE-2026-28638, CVE-2026-28642, CVE-2026-28643, CVE-2026-28644, CVE-2026-28645, CVE-2026-28650, CVE-2026-28652, CVE-2026-28655, CVE-2026-28656, CVE-2026-28657, CVE-2026-28658, CVE-2026-28660, CVE-2026-28663, CVE-2026-28667, CVE-2026-28668, CVE-2026-28670, CVE-2026-28671
- Unclassified: CVE-2026-28653

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026052400

Tags:

- [2026052400](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026052400) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026050900 release:

- add GrapheneOS Speech Services providing a local text-to-speech engine using a model trained by GrapheneOS with fully open source code and training data
- set GrapheneOS TalkBack as the default accessibility service to support easily enabling it via the accessibility shortcut
- Network Location: position estimation algorithm overhaul to improve accuracy, reliability and especially the consistency of results along with improving reporting the estimated accuracy
- Sandboxed Google Play compatibility layer: add stub for NetworkStatsManager.queryDetailsForUidTag()
- Sandboxed Google Play compatibility layer: stub CarrierConfigManager.getConfigForSubId for Android Auto
- Keyboard: expand heuristic for working around Jetpack Compose TextField bug
- remove android.hardware.telephony.satellite feature declaration since it's not supported by GrapheneOS and declaring the feature causes minor issues with recent Android Auto releases
- Calculator: fix long click to paste not working on first run
- Seedvault: allow new content provider for DAVx⁵ WebDAV provider (will be replaced with a better backup implementation in the future)
- kernel (6.1): update to latest GKI LTS branch revision including update to 6.1.173
- kernel (6.1): update to 6.1.174
- kernel (6.6): update to latest GKI LTS branch revision including update to 6.6.139
- kernel (6.6): backport security patches for CVE-2026-46300 and CVE-2026-43503 which aren't exploitable for local privilege escalation from non-root on Android due to not permitting unprivileged use of user namespaces
- kernel (6.12): update to latest GKI LTS branch revision including update to 6.12.88
- kernel (Pixel): fix upstream bug in Samsung TEE DMA heap driver used by the PowerVR and Mali GPU drivers for DRM support causing a crash with kernel hardware memory tagging from it freeing a pointer with the tag stripped
- Vanadium: update to [version 148.0.7778.167.0](https://github.com/GrapheneOS/Vanadium/releases/tag/148.0.7778.167.0)
- Vanadium: update to [version 148.0.7778.178.0](https://github.com/GrapheneOS/Vanadium/releases/tag/148.0.7778.178.0)
- Vanadium: update to [version 149.0.7827.22.0](https://github.com/GrapheneOS/Vanadium/releases/tag/149.0.7827.22.0)
- set the patch level to 2026-05-05 instead of the officially equivalent 2026-05-01 since no patches were listed for 2026-05-05 for either Android or Pixels but not raising it to the equivalent higher value leads to confusion

All of the Android 16 security patches from the current June 2026, July 2026, August 2026, September 2026, October 2026 and November 2026 Android Security Bulletins are included in the 2026052401 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-0039, CVE-2026-0040, CVE-2026-0041, CVE-2026-0042, CVE-2026-0043, CVE-2026-0044, CVE-2026-0051, CVE-2026-0052, CVE-2026-0080, CVE-2026-0097, CVE-2026-21352, CVE-2026-21353, CVE-2026-27280, CVE-2026-28590, CVE-2026-28591, CVE-2026-28604, CVE-2026-28618, CVE-2026-28639
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2025-48600, CVE-2025-48612, CVE-2026-0008, CVE-2026-0016, CVE-2026-0036, CVE-2026-0048, CVE-2026-0050, CVE-2026-0053, CVE-2026-0054, CVE-2026-0055, CVE-2026-0056, CVE-2026-0059, CVE-2026-0060, CVE-2026-0061, CVE-2026-0062, CVE-2026-0063, CVE-2026-0065, CVE-2026-0067, CVE-2026-0070, CVE-2026-0074, CVE-2026-0076, CVE-2026-0077, CVE-2026-0078, CVE-2026-0079, CVE-2026-0084, CVE-2026-0085, CVE-2026-0086, CVE-2026-0087, CVE-2026-0088, CVE-2026-0089, CVE-2026-0091, CVE-2026-0093, CVE-2026-0094, CVE-2026-0095, CVE-2026-0096, CVE-2026-0098, CVE-2026-0099, CVE-2026-0100, CVE-2026-28572, CVE-2026-28574, CVE-2026-28577, CVE-2026-28578, CVE-2026-28580, CVE-2026-28581, CVE-2026-28582, CVE-2026-28583, CVE-2026-28584, CVE-2026-28585, CVE-2026-28586, CVE-2026-28588, CVE-2026-28593, CVE-2026-28594, CVE-2026-28596, CVE-2026-28599, CVE-2026-28600, CVE-2026-28602, CVE-2026-28603, CVE-2026-28606, CVE-2026-28607, CVE-2026-28609, CVE-2026-28612, CVE-2026-28613, CVE-2026-28614, CVE-2026-28617, CVE-2026-28619, CVE-2026-28620, CVE-2026-28623, CVE-2026-28624, CVE-2026-28626, CVE-2026-28631, CVE-2026-28632, CVE-2026-28633, CVE-2026-28634, CVE-2026-28635, CVE-2026-28636, CVE-2026-28638, CVE-2026-28642, CVE-2026-28643, CVE-2026-28644, CVE-2026-28645, CVE-2026-28650, CVE-2026-28652, CVE-2026-28655, CVE-2026-28656, CVE-2026-28658, CVE-2026-28660
- Unclassified: CVE-2026-0075, CVE-2026-28653

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026050900

Tags:

- [2026050900](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026050900) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026050700 release:

- kernel (Pixel 8a, Pixel 9a): fix for an upstream Broadcom Wi-Fi bcm4383 driver memory corruption bug to avoid invalid memory accesses caught by the kernel hardware memory tagging enabled by GrapheneOS (the May 2026 Wi-Fi firmware + kernel driver update introduced this issue)
- backport Broadcom Wi-Fi bcm4383 driver changes from CP21.260330.008 (Android 17 Beta 4) to avoid invalid memory accesses (this didn't end up resolving the hardware memory tagging crashes introduced in the May 2026 Pixel update but we kept this to fix additional issues)
- disable buggy upstream IStatusBarNotificationHolder optimization via the upstream feature flag (no\_sbnholder) due to it causing occasional system\_server crashes from sending overly large Binder transactions

All of the Android 16 security patches from the current June 2026, July 2026, August 2026, September 2026, October 2026 and November 2026 Android Security Bulletins are included in the 2026050901 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-0039, CVE-2026-0040, CVE-2026-0041, CVE-2026-0042, CVE-2026-0043, CVE-2026-0044, CVE-2026-0051, CVE-2026-0052, CVE-2026-0080, CVE-2026-0097, CVE-2026-21352, CVE-2026-21353, CVE-2026-27280, CVE-2026-28590, CVE-2026-28591, CVE-2026-28604
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-48600, CVE-2025-48612, CVE-2026-0008, CVE-2026-0016, CVE-2026-0036, CVE-2026-0048, CVE-2026-0050, CVE-2026-0053, CVE-2026-0054, CVE-2026-0055, CVE-2026-0056, CVE-2026-0059, CVE-2026-0060, CVE-2026-0061, CVE-2026-0062, CVE-2026-0063, CVE-2026-0065, CVE-2026-0067, CVE-2026-0070, CVE-2026-0074, CVE-2026-0075, CVE-2026-0076, CVE-2026-0077, CVE-2026-0078, CVE-2026-0079, CVE-2026-0084, CVE-2026-0085, CVE-2026-0086, CVE-2026-0087, CVE-2026-0088, CVE-2026-0089, CVE-2026-0091, CVE-2026-0093, CVE-2026-0094, CVE-2026-0095, CVE-2026-0096, CVE-2026-0098, CVE-2026-0099, CVE-2026-0100, CVE-2026-28572, CVE-2026-28574, CVE-2026-28577, CVE-2026-28578, CVE-2026-28580, CVE-2026-28581, CVE-2026-28583, CVE-2026-28585, CVE-2026-28586, CVE-2026-28594, CVE-2026-28596, CVE-2026-28599, CVE-2026-28600, CVE-2026-28602, CVE-2026-28603, CVE-2026-28607, CVE-2026-28609, CVE-2026-28612, CVE-2026-28617, CVE-2026-28619, CVE-2026-28620
- Unclassified: CVE-2026-28618

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026050700

Tags:

- [2026050700](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026050700) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026050600 release:

- update Pixel kernel driver sources to May 2026 (this resolves the Pixel 8a and Pixel 9a issues resulting in the release for those being quickly cancelled after early Alpha testing due to the new firmware requiring driver changes)

All of the Android 16 security patches from the current June 2026, July 2026, August 2026, September 2026, October 2026 and November 2026 Android Security Bulletins are included in the 2026050701 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-0039, CVE-2026-0040, CVE-2026-0041, CVE-2026-0042, CVE-2026-0043, CVE-2026-0044, CVE-2026-0051, CVE-2026-0052, CVE-2026-0080, CVE-2026-0097, CVE-2026-21352, CVE-2026-21353, CVE-2026-27280, CVE-2026-28590, CVE-2026-28591
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-48600, CVE-2025-48612, CVE-2026-0008, CVE-2026-0016, CVE-2026-0036, CVE-2026-0048, CVE-2026-0050, CVE-2026-0053, CVE-2026-0054, CVE-2026-0055, CVE-2026-0056, CVE-2026-0059, CVE-2026-0060, CVE-2026-0061, CVE-2026-0062, CVE-2026-0063, CVE-2026-0065, CVE-2026-0067, CVE-2026-0070, CVE-2026-0074, CVE-2026-0075, CVE-2026-0076, CVE-2026-0077, CVE-2026-0078, CVE-2026-0079, CVE-2026-0084, CVE-2026-0085, CVE-2026-0086, CVE-2026-0087, CVE-2026-0088, CVE-2026-0089, CVE-2026-0091, CVE-2026-0093, CVE-2026-0094, CVE-2026-0095, CVE-2026-0096, CVE-2026-0098, CVE-2026-0099, CVE-2026-0100, CVE-2026-28572, CVE-2026-28574, CVE-2026-28577, CVE-2026-28578, CVE-2026-28580, CVE-2026-28581, CVE-2026-28582, CVE-2026-28583, CVE-2026-28585, CVE-2026-28586, CVE-2026-28588, CVE-2026-28594, CVE-2026-28596, CVE-2026-28602

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026050600

Tags:

- [2026050600](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026050600) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026050400 release:

- update Pixel firmware, driver libraries, HALs and other components backported from Android 16 QPR3 from the initial March 2026 release to the May 2026 release (CP1A.260505.005.A1)
- Contact Scopes: add missing handling for QUERY\_DEFAULT\_ACCOUNT\_FOR\_NEW\_CONTACTS\_METHOD was added in Android 16
- backport fix for stuck IME input from May 2026 Pixel update
- bionic: avoid adding an extra guard page below the main thread's pthread\_internal\_t since it serves no purpose (the stack is in a dedicated mapping from the kernel so the stack guard is immediately below pthread\_internal\_t) and it causes a crash for incorrect anti-tampering code shared across many banking apps which reads /proc/self/maps to find the main thread's thread-local data including pthread\_internal\_t based on mapping name and then tries to access the internal libc data stored in an entirely internal libc format without checking if there's a guard page (these anti-tampering checks serve no valid security purpose, cause these apps to break on major Android releases and hinder OS security hardening due to compatibility issues with their incorrect code)
- bionic: remove unnecessary extra naming for mappings to avoid 2 extra system calls for creating a thread
- adevtool: fix update-carrier-settings command

All of the Android 16 security patches from the current June 2026, July 2026, August 2026, September 2026, October 2026 and November 2026 Android Security Bulletins are included in the 2026050601 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-0039, CVE-2026-0040, CVE-2026-0041, CVE-2026-0042, CVE-2026-0043, CVE-2026-0044, CVE-2026-0051, CVE-2026-0052, CVE-2026-0080, CVE-2026-0097, CVE-2026-21352, CVE-2026-21353, CVE-2026-27280, CVE-2026-28590, CVE-2026-28591
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-48600, CVE-2025-48612, CVE-2026-0008, CVE-2026-0016, CVE-2026-0036, CVE-2026-0048, CVE-2026-0050, CVE-2026-0053, CVE-2026-0054, CVE-2026-0055, CVE-2026-0056, CVE-2026-0059, CVE-2026-0060, CVE-2026-0061, CVE-2026-0062, CVE-2026-0063, CVE-2026-0065, CVE-2026-0067, CVE-2026-0070, CVE-2026-0074, CVE-2026-0075, CVE-2026-0076, CVE-2026-0077, CVE-2026-0078, CVE-2026-0079, CVE-2026-0084, CVE-2026-0085, CVE-2026-0086, CVE-2026-0087, CVE-2026-0088, CVE-2026-0089, CVE-2026-0091, CVE-2026-0093, CVE-2026-0094, CVE-2026-0095, CVE-2026-0096, CVE-2026-0098, CVE-2026-0099, CVE-2026-0100, CVE-2026-28572, CVE-2026-28574, CVE-2026-28577, CVE-2026-28578, CVE-2026-28580, CVE-2026-28581, CVE-2026-28582, CVE-2026-28583, CVE-2026-28585, CVE-2026-28586, CVE-2026-28588, CVE-2026-28594, CVE-2026-28596, CVE-2026-28602

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026050400

Tags:

- [2026050400](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026050400) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026042100 release:

- full 2026-05-05 security patch level (listed as 2026-05-01 due to 2026-05-05 not being officially defined)
- disable registerQuicConnectionClosePayload optimization to fix VPN leak
- Sandboxed Google Play compatibility layer: add shim for BluetoothAdapter.ACTION\_REQUEST\_ENABLE
- apply active Dynamic Code Loading restrictions for Java inside isolated processes
- add app API for checking Dynamic Code Loading restriction states
- fully enable lockscreen widget support by default to avoid the swipe gesture being missing for the Pixel 10a and the whole feature being missing for the emulator
- enable standard secure NFC mode by default which can be changed via Settings &gt; Connected devices &gt; Connection preferences &gt; NFC &gt; Require device unlock for NFC (note this only disables card emulation while locked rather than all uses of NFC)
- backport upstream fix for getBubblePackageForLogging() crash
- kernel (6.1): update to latest GKI LTS branch revision including update to 6.1.170
- kernel (6.6): update to latest GKI LTS branch revision including update to 6.6.130
- kernel (6.12): update to latest GKI LTS branch revision
- hardened\_malloc: fix slightly non-uniform distribution of random u16 values used for randomizing slot selection, slab allocation quarantining and free slab quarantining
- hardened\_malloc: improve the robustness of disabling memory tagging against theoretical issues by making it fork-safe and adding more synchronization to avoid technically undefined parallel reads of the memory tagging state
- hardened\_malloc: improve handling of out-of-memory edge cases
- hardened\_malloc: improve sized deallocation hardening
- libpng: backport fix for CVE-2026-33636
- bionic: clamp the minimum size of the random guard region we add between the stack and pthread\_internal\_t (thread-local storage and other sensitive data) for secondary stack randomization to the page size to guarantee we always add a guard page protecting pthread\_internal\_t from stack buffer overflows
- App Store: update to [version 36](https://github.com/GrapheneOS/Apps/releases/tag/36)
- Vanadium: update to [version 147.0.7727.111.0](https://github.com/GrapheneOS/Vanadium/releases/tag/147.0.7727.111.0)
- Vanadium: update to [version 148.0.7778.49.0](https://github.com/GrapheneOS/Vanadium/releases/tag/148.0.7778.49.0)
- Vanadium: update to [version 148.0.7778.60.0](https://github.com/GrapheneOS/Vanadium/releases/tag/148.0.7778.60.0)
- Vanadium: update to [version 148.0.7778.60.1](https://github.com/GrapheneOS/Vanadium/releases/tag/148.0.7778.60.1)
- Vanadium: update to [version 148.0.7778.96.0](https://github.com/GrapheneOS/Vanadium/releases/tag/148.0.7778.96.0)
- adevtool: add update-gservices-flag command for fetching gservices flags

All of the Android 16 security patches from the current June 2026, July 2026, August 2026, September 2026, October 2026 and November 2026 Android Security Bulletins are included in the 2026050401 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-0039, CVE-2026-0040, CVE-2026-0041, CVE-2026-0042, CVE-2026-0043, CVE-2026-0044, CVE-2026-0051, CVE-2026-0052, CVE-2026-0080, CVE-2026-0097, CVE-2026-21352, CVE-2026-21353, CVE-2026-27280, CVE-2026-28590, CVE-2026-28591
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-48600, CVE-2025-48612, CVE-2026-0008, CVE-2026-0016, CVE-2026-0036, CVE-2026-0048, CVE-2026-0050, CVE-2026-0053, CVE-2026-0054, CVE-2026-0055, CVE-2026-0056, CVE-2026-0059, CVE-2026-0060, CVE-2026-0061, CVE-2026-0062, CVE-2026-0063, CVE-2026-0065, CVE-2026-0067, CVE-2026-0070, CVE-2026-0074, CVE-2026-0075, CVE-2026-0076, CVE-2026-0077, CVE-2026-0078, CVE-2026-0079, CVE-2026-0084, CVE-2026-0085, CVE-2026-0086, CVE-2026-0087, CVE-2026-0088, CVE-2026-0089, CVE-2026-0091, CVE-2026-0093, CVE-2026-0094, CVE-2026-0095, CVE-2026-0096, CVE-2026-0098, CVE-2026-0099, CVE-2026-0100, CVE-2026-28572, CVE-2026-28574, CVE-2026-28577, CVE-2026-28578, CVE-2026-28580, CVE-2026-28581, CVE-2026-28582, CVE-2026-28583, CVE-2026-28585, CVE-2026-28586, CVE-2026-28588, CVE-2026-28594, CVE-2026-28596, CVE-2026-28602

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026042100

Tags:

- [2026042100](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026042100) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026040800 release:

- Launcher: backport fix from Pixel Launcher for the recents overview with third party launchers
- Launcher: improve our implementation of hiding the app list when search is focused to more closely match Pixel Launcher
- don't allow irregular secondary users (guest, demo or restricted) to have a private space
- Settings: inherit user restrictions from full user to a nested private space and run a one-time task to add missing restrictions
- kernel (6.1): update to latest GKI LTS branch revision including update to 6.1.167
- kernel (6.6): update to latest GKI LTS branch revision
- kernel (6.12): update to latest GKI LTS branch revision
- kernel (6.1): backport SVE support for protected guests
- kernel (6.1, 6.6, 6.12): backport fix for race conditions in USB gadget UVC driver causing crashes with the device as webcam feature including use-after-free detected by hardware memory tagging
- kernel (6.6, 6.12): disable Android GKI vendor hooks for INIT\_ON\_FREE page zeroing to avoid Pixels deferring zero-on-free for reclaim (kswapd) via their driver tree since it reduces security to improve performance (the stock OS doesn't use INIT\_ON\_FREE but they tried to reduce the cost to be acceptable for the stock OS while we want the full security instead)
- adevtool: change added Cape cellular radio carrier configuration entry to use USCC (1952) instead of ATT (1187) to avoid outbound call issues for users opting into using their new setup early (stock Pixel OS will add the same entry but they take months to handle it so it was submitted to us too)
- hardened\_malloc: improve handling of out-of-memory edge cases
- Vanadium: update to [version 147.0.7727.101.0](https://github.com/GrapheneOS/Vanadium/releases/tag/147.0.7727.101.0)

All of the Android 16 security patches from the current May 2026, June 2026, July 2026, August 2026, September 2026 and October 2026 Android Security Bulletins are included in the 2026042101 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-0039, CVE-2026-0040, CVE-2026-0041, CVE-2026-0042, CVE-2026-0043, CVE-2026-0044, CVE-2026-0051, CVE-2026-0052, CVE-2026-0073, CVE-2026-0080, CVE-2026-0097, CVE-2026-21352, CVE-2026-21353
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-48600, CVE-2025-48612, CVE-2026-0016, CVE-2026-0036, CVE-2026-0048, CVE-2026-0050, CVE-2026-0053, CVE-2026-0054, CVE-2026-0055, CVE-2026-0056, CVE-2026-0059, CVE-2026-0060, CVE-2026-0061, CVE-2026-0062, CVE-2026-0063, CVE-2026-0065, CVE-2026-0067, CVE-2026-0070, CVE-2026-0074, CVE-2026-0075, CVE-2026-0076, CVE-2026-0077, CVE-2026-0078, CVE-2026-0079, CVE-2026-0084, CVE-2026-0085, CVE-2026-0086, CVE-2026-0087, CVE-2026-0088, CVE-2026-0089, CVE-2026-0091, CVE-2026-0093, CVE-2026-0094, CVE-2026-0095, CVE-2026-0096, CVE-2026-0098, CVE-2026-0099, CVE-2026-0100, CVE-2026-28572, CVE-2026-28574, CVE-2026-28577, CVE-2026-28578, CVE-2026-28580, CVE-2026-28581, CVE-2026-28585, CVE-2026-28586

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026040800

Tags:

- [2026040800](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026040800) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026040600 release:

- full 2026-04-05 security patch level
- update Pixel firmware, driver libraries, HALs and other components backported from Android 16 QPR3 from the initial March 2026 release to the April 2026 release (CP1A.260405.005)
- Settings: ProfileSelectFragment: backport Android 16 QPR3 to ease future porting
- Settings: ProfileSelectFragment: fix crash caused by upstream bug when opening credential settings from private profile
- kernel (6.12): update to latest GKI LTS branch revision
- kernel (6.12): temporarily disable RANDSTRUCT and LTO due to incompatibility with Rust since Android has started using the Rust ashmem rewrite (CFI still works without LTO due to using kCFI)
- kernel (6.12): switch to Rust ashmem implementation
- kernel (6.12): enable building Rust Binder implementation

All of the Android 16 security patches from the current May 2026, June 2026, July 2026, August 2026, September 2026 and October 2026 Android Security Bulletins are included in the 2026040801 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-0039, CVE-2026-0040, CVE-2026-0041, CVE-2026-0042, CVE-2026-0043, CVE-2026-0044, CVE-2026-0051, CVE-2026-0052, CVE-2026-0073, CVE-2026-0080, CVE-2026-0097, CVE-2026-21352, CVE-2026-21353
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-48600, CVE-2025-48612, CVE-2026-0016, CVE-2026-0036, CVE-2026-0048, CVE-2026-0050, CVE-2026-0053, CVE-2026-0054, CVE-2026-0055, CVE-2026-0056, CVE-2026-0059, CVE-2026-0060, CVE-2026-0061, CVE-2026-0062, CVE-2026-0063, CVE-2026-0065, CVE-2026-0067, CVE-2026-0070, CVE-2026-0074, CVE-2026-0075, CVE-2026-0076, CVE-2026-0077, CVE-2026-0078, CVE-2026-0079, CVE-2026-0084, CVE-2026-0085, CVE-2026-0086, CVE-2026-0087, CVE-2026-0088, CVE-2026-0089, CVE-2026-0091, CVE-2026-0093, CVE-2026-0094, CVE-2026-0095, CVE-2026-0096, CVE-2026-0098, CVE-2026-0099, CVE-2026-0100, CVE-2026-28572, CVE-2026-28577, CVE-2026-28578, CVE-2026-28580, CVE-2026-28581

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026040600

Tags:

- [2026040600](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026040600) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026040300 release:

- full 2026-04-01 security patch level
- make temporary biometric lockouts into permanent lockouts and ensure only framework can clear lockout to make sure our 5 attempt limit is always properly enforced across devices with different implementations of biometric unlock instead of batches of 5 temporary lockouts followed by permanent lockout after 20 attempts
- Launcher: fix layout for search bar which is broken in upstream AOSP due to lack of a predictive service

All of the Android 16 security patches from the current May 2026, June 2026, July 2026, August 2026, September 2026 and October 2026 Android Security Bulletins are included in the 2026040601 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-0039, CVE-2026-0040, CVE-2026-0041, CVE-2026-0042, CVE-2026-0043, CVE-2026-0044, CVE-2026-0052, CVE-2026-0073, CVE-2026-0080, CVE-2026-0097, CVE-2026-21352, CVE-2026-21353
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-48600, CVE-2025-48612, CVE-2026-0016, CVE-2026-0036, CVE-2026-0048, CVE-2026-0050, CVE-2026-0053, CVE-2026-0054, CVE-2026-0055, CVE-2026-0056, CVE-2026-0059, CVE-2026-0060, CVE-2026-0061, CVE-2026-0062, CVE-2026-0063, CVE-2026-0065, CVE-2026-0067, CVE-2026-0070, CVE-2026-0074, CVE-2026-0075, CVE-2026-0076, CVE-2026-0077, CVE-2026-0078, CVE-2026-0079, CVE-2026-0084, CVE-2026-0085, CVE-2026-0086, CVE-2026-0087, CVE-2026-0088, CVE-2026-0089, CVE-2026-0091, CVE-2026-0093, CVE-2026-0094, CVE-2026-0095, CVE-2026-0096, CVE-2026-0098, CVE-2026-0099, CVE-2026-0100, CVE-2026-28572, CVE-2026-28580, CVE-2026-28581

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026040300

Tags:

- [2026040300](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026040300) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026032000 release:

- Keyboard: add heuristic for detecting the input field is a Jetpack Compose TextField to work around a bug in Compose's implementation breaking backspace functionality by falling back to a legacy approach
- fix upstream use-after-free bug caught by MTE in the Pixel HWC3 service when an external display connects which causes soft reboots
- fix StrictMode BackgroundActivityLaunchCallback leak which was leading to exhaustion of the binder proxy object limit causing a crash
- Contact Scopes: resolve app compatibility issue causing crashes due to missing handling for \_count queries when scopes are empty
- Sandboxed Google Play compatibility layer: improve the user experience for using Google Messages RCS by showing users the access it requires is being requested along with overhauling the implementation
- Sandboxed Google Play compatibility layer: permit Android Auto retrieving A2DP connection policy when the special access permission for wireless Android Auto is granted to improve compatibility beyond the stub in GmsCompatConfig version 169
- Pixel 10a: add missing Multiuser app for multi-user switcher widget
- Pixel 10a: backport Android 16 QPR3 GNSS HAL to resolve a mismatch resulting in inaccurate GNSS data
- kernel (6.1): update to latest GKI LTS branch revision
- kernel (6.6): update to latest GKI LTS branch revision including update to 6.6.129
- kernel (6.12): update to latest GKI LTS branch revision including update to 6.12.77
- adevtool: update the cellular modem carrier configuration database for Cape to fix VoWifi support prior to the change shipping in the stock Pixel OS
- adevtool: heavily optimize carrier config decoding
- GmsCompatConfig: update to [version 168](https://github.com/GrapheneOS/platform_packages_apps_GmsCompat/releases/tag/config-168)
- GmsCompatConfig: update to [version 169](https://github.com/GrapheneOS/platform_packages_apps_GmsCompat/releases/tag/config-169)
- Vanadium: update to [version 146.0.7680.164.0](https://github.com/GrapheneOS/Vanadium/releases/tag/146.0.7680.164.0)
- Vanadium: update to [version 147.0.7727.24.0](https://github.com/GrapheneOS/Vanadium/releases/tag/147.0.7727.24.0)
- Vanadium: update to [version 147.0.7727.49.0](https://github.com/GrapheneOS/Vanadium/releases/tag/147.0.7727.49.0)
- Vanadium: update to [version 147.0.7727.49.1](https://github.com/GrapheneOS/Vanadium/releases/tag/147.0.7727.49.1)

All of the Android 16 security patches from the current April 2026, May 2026, June 2026, July 2026, August 2026, September 2026 and October 2026 Android Security Bulletins are included in the 2026040301 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-0039, CVE-2026-0040, CVE-2026-0041, CVE-2026-0042, CVE-2026-0043, CVE-2026-0044, CVE-2026-0049, CVE-2026-0052, CVE-2026-0073, CVE-2026-0080, CVE-2026-0097, CVE-2026-21352, CVE-2026-21353
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-48600, CVE-2025-48612, CVE-2026-0016, CVE-2026-0036, CVE-2026-0048, CVE-2026-0050, CVE-2026-0053, CVE-2026-0054, CVE-2026-0055, CVE-2026-0056, CVE-2026-0059, CVE-2026-0060, CVE-2026-0061, CVE-2026-0062, CVE-2026-0063, CVE-2026-0065, CVE-2026-0067, CVE-2026-0070, CVE-2026-0074, CVE-2026-0075, CVE-2026-0076, CVE-2026-0077, CVE-2026-0078, CVE-2026-0079, CVE-2026-0084, CVE-2026-0085, CVE-2026-0086, CVE-2026-0087, CVE-2026-0088, CVE-2026-0089, CVE-2026-0091, CVE-2026-0093, CVE-2026-0094, CVE-2026-0095, CVE-2026-0096, CVE-2026-0098, CVE-2026-0099, CVE-2026-0100, CVE-2026-28572, CVE-2026-28580, CVE-2026-28581

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026032000

Tags:

- [2026032000](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026032000) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, Pixel 10a, emulator, generic, other targets)

Changes since the 2026030700 release:

- add experimental Pixel 10a support
- Launcher: change app drawer search bar to cancelling search when the back action is invoked instead of the query becoming empty
- backport SELinux policy for CameraX extensions property used by the Pixel Camera HAL from Android 16 QPR3
- hardened\_malloc: multiple small optimizations to improve performance
- kernel (6.1): update to latest GKI LTS branch revision including update to 6.1.166
- kernel (6.6): update to latest GKI LTS branch revision including update to 6.6.127
- kernel (6.12): update to latest GKI LTS branch revision including update to 6.12.76
- Vanadium: update to [version 146.0.7680.65.1](https://github.com/GrapheneOS/Vanadium/releases/tag/146.0.7680.65.1)
- Vanadium: update to [version 146.0.7680.111.0](https://github.com/GrapheneOS/Vanadium/releases/tag/146.0.7680.111.0)
- Vanadium: update to [version 146.0.7680.115.0](https://github.com/GrapheneOS/Vanadium/releases/tag/146.0.7680.115.0)
- Vanadium: update to [version 146.0.7680.119.0](https://github.com/GrapheneOS/Vanadium/releases/tag/146.0.7680.119.0)
- Vanadium: update to [version 146.0.7680.153.0](https://github.com/GrapheneOS/Vanadium/releases/tag/146.0.7680.153.0)
- Auditor: update to [version 91](https://github.com/GrapheneOS/Auditor/releases/tag/91)
- switch to cross-device gmscompat\_lib key for 10th gen Pixels
- adevtool: add support for keeping only certain unpacked images to help with constrained storage

All of the Android 16 security patches from the current April 2026, May 2026, June 2026, July 2026 and August 2026 Android Security Bulletins are included in the 2026032001 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-0039, CVE-2026-0040, CVE-2026-0041, CVE-2026-0042, CVE-2026-0043, CVE-2026-0044, CVE-2026-0049, CVE-2026-0052, CVE-2026-0073, CVE-2026-0080
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-48600, CVE-2025-48612, CVE-2026-0016, CVE-2026-0036, CVE-2026-0048, CVE-2026-0050, CVE-2026-0053, CVE-2026-0054, CVE-2026-0055, CVE-2026-0056, CVE-2026-0059, CVE-2026-0060, CVE-2026-0061, CVE-2026-0062, CVE-2026-0063, CVE-2026-0065, CVE-2026-0067, CVE-2026-0070, CVE-2026-0074, CVE-2026-0075, CVE-2026-0076, CVE-2026-0077, CVE-2026-0078, CVE-2026-0079

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026030700

Tags:

- [2026030700](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026030700) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, emulator, generic, other targets)

Changes since the 2026030500 release:

- update Pixel Camera HAL to CP1A.260305.018 (Android 16 QPR3) to resolve compatibility issues with the backported Android 16 QPR3 kernel drivers
- Pixel 10 Pro Fold: change thermal info configuration to work around an incompatibility with the Android 16 QPR3 kernel device tree
- Setup Wizard: add opt-in toggles for geocoding to the Location services page since we now have a GrapheneOS geocoding service able to handle a large number of users
- replace "OpenStreetMaps" with the correct "OpenStreetMap" for the geocoder server option name
- Vanadium: update to [version 146.0.7680.65.0](https://github.com/GrapheneOS/Vanadium/releases/tag/146.0.7680.65.0)

All of the Android 16 security patches from the current April 2026, May 2026, June 2026, July 2026 and August 2026 Android Security Bulletins are included in the 2026030701 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-0039, CVE-2026-0040, CVE-2026-0041, CVE-2026-0042, CVE-2026-0043, CVE-2026-0044, CVE-2026-0049, CVE-2026-0052, CVE-2026-0073
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-48600, CVE-2025-48612, CVE-2026-0016, CVE-2026-0036, CVE-2026-0048, CVE-2026-0050, CVE-2026-0053, CVE-2026-0054, CVE-2026-0055, CVE-2026-0056, CVE-2026-0059, CVE-2026-0060, CVE-2026-0061, CVE-2026-0062, CVE-2026-0063, CVE-2026-0065, CVE-2026-0067, CVE-2026-0070, CVE-2026-0074, CVE-2026-0076

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026030500

Tags:

- [2026030500](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026030500) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, emulator, generic, other targets)

Changes since the 2026030200 release:

- full 2026-03-05 security patch level
- integrate extra security patches not included in the Android Security Bulletin from the March 2026 Android 16 security tag release
- update Pixel kernel sources to CP1A.260305.018 (Android 16 QPR3)
- update Pixel firmware and a large portion of the driver libraries/HALs to CP1A.260305.018 (Android 16 QPR3)
- fix Network permission enforcement for MediaPlayerService clients by closing a bypass caused by an upstream Android vulnerability for INTERNET permission enforcement caused by using case-sensitive rather than case-insensitive string comparisons
- rename geocoder options to "GrapheneOS server" and "OpenStreetMaps server" since we're now self-hosting Nominatim instead of providing a proxy to the OpenStreetMaps instance

All of the Android 16 security patches from the current April 2026, May 2026, June 2026, July 2026 and August 2026 Android Security Bulletins are included in the 2026030501 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-0039, CVE-2026-0040, CVE-2026-0041, CVE-2026-0042, CVE-2026-0043, CVE-2026-0044, CVE-2026-0049, CVE-2026-0052, CVE-2026-0073
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-48600, CVE-2025-48612, CVE-2026-0016, CVE-2026-0036, CVE-2026-0048, CVE-2026-0050, CVE-2026-0053, CVE-2026-0054, CVE-2026-0055, CVE-2026-0056, CVE-2026-0059, CVE-2026-0060, CVE-2026-0061, CVE-2026-0062, CVE-2026-0063, CVE-2026-0065, CVE-2026-0067, CVE-2026-0070, CVE-2026-0074, CVE-2026-0076

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026030200

Tags:

- [2026030200](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026030200) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, emulator, generic, other targets)

Changes since the 2026030100 release:

- full 2026-03-01 security patch level

All of the Android 16 security patches from the current April 2026, May 2026, June 2026, July 2026 and August 2026 Android Security Bulletins are included in the 2026030201 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-0039, CVE-2026-0040, CVE-2026-0041, CVE-2026-0042, CVE-2026-0043, CVE-2026-0044, CVE-2026-0049, CVE-2026-0052
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-32348, CVE-2025-48600, CVE-2025-48612, CVE-2025-48615, CVE-2025-48617, CVE-2025-48649, CVE-2025-48652, CVE-2026-0016, CVE-2026-0018, CVE-2026-0022, CVE-2026-0036, CVE-2026-0048, CVE-2026-0050, CVE-2026-0053, CVE-2026-0054, CVE-2026-0055, CVE-2026-0056, CVE-2026-0059, CVE-2026-0060, CVE-2026-0061, CVE-2026-0062, CVE-2026-0063, CVE-2026-0065, CVE-2026-0067, CVE-2026-0070

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026030100

Tags:

- [2026030100](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026030100) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, emulator, generic, other targets)

Changes since the 2026021200 release:

- SystemUI: migrate to the modern lockscreen infrastructure (smartspace) for showing lockscreen device status info to avoid many upstream bugs caused by AOSP still using the legacy lockscreen infrastructure no longer used on the stock Pixel OS (this allows us to revert a bunch of downstream fixes we were using)
- Settings: don't allow disabling eSIM when eSIM management support is disabled since it can persistently prevent using the eSIMs without using ADB shell to undo it
- modify our multicast firewall to stop dropping route advertisements received on the VPN interface which sometimes breaks IPv6 connectivity
- fix rare edge preventing dismissing the UI for our 2-factor fingerprint unlock feature
- Setup Wizard: add opt-in toggles for network-based location and always available Wi-Fi scanning to the Location services page
- kernel (Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold): raise lockdown mode from integrity to confidentiality mode to match the other devices
- kernel (Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold): add workaround for an upstream arm64 KVM bug breaking booting with lockdown in confidentiality mode
- kernel (6.1): update to latest GKI LTS branch revision including update to 6.1.163
- kernel (6.6): update to latest GKI LTS branch revision including update to 6.6.126
- kernel (6.12): update to latest GKI LTS branch revision including update to 6.12.73
- hardened\_malloc: update libdivide to 5.3.0
- hardened\_malloc: fix handling one form of realloc from small allocations made with alignment above PAGE\_SIZE (no known real world examples and it would be crashing if it was happening since it causes internal invalid accesses unable to go outside the bounds of the protected metadata region which is mainly PROT\_NONE)
- Vanadium: update to [version 145.0.7632.75.0](https://github.com/GrapheneOS/Vanadium/releases/tag/145.0.7632.75.0)
- Vanadium: update to [version 145.0.7632.109.0](https://github.com/GrapheneOS/Vanadium/releases/tag/145.0.7632.109.0)
- Vanadium: update to [version 145.0.7632.120.0](https://github.com/GrapheneOS/Vanadium/releases/tag/145.0.7632.120.0)
- Vanadium: update to [version 146.0.7680.31.0](https://github.com/GrapheneOS/Vanadium/releases/tag/146.0.7680.31.0)
- adevtool: handle Node.js fs.cp behavior change
- adevtool: update dependencies

All of the Android 16 security patches from the current March 2026, April 2026, May 2026, June 2026, July 2026 and August 2026 Android Security Bulletins are included in the 2026030101 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-0039, CVE-2026-0040, CVE-2026-0041, CVE-2026-0042, CVE-2026-0043, CVE-2026-0044, CVE-2026-0047, CVE-2026-0049, CVE-2026-0052
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-32348, CVE-2025-48600, CVE-2025-48612, CVE-2025-48615, CVE-2025-48617, CVE-2025-48630, CVE-2025-48641, CVE-2025-48642, CVE-2025-48644, CVE-2025-48645, CVE-2025-48646, CVE-2025-48649, CVE-2025-48652, CVE-2025-48653, CVE-2025-48654, CVE-2025-64783, CVE-2025-64784, CVE-2025-64893, CVE-2026-0011, CVE-2026-0014, CVE-2026-0015, CVE-2026-0016, CVE-2026-0017, CVE-2026-0018, CVE-2026-0020, CVE-2026-0021, CVE-2026-0022, CVE-2026-0023, CVE-2026-0024, CVE-2026-0025, CVE-2026-0034, CVE-2026-0035, CVE-2026-0036, CVE-2026-0048, CVE-2026-0050, CVE-2026-0053, CVE-2026-0054, CVE-2026-0055, CVE-2026-0056, CVE-2026-0059, CVE-2026-0060, CVE-2026-0061, CVE-2026-0062, CVE-2026-0063, CVE-2026-0065, CVE-2026-0067

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026021200

Tags:

- [2026021200](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026021200) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, emulator, generic, other targets)

Changes since the 2026020600 release:

- Sandboxed Google Play compatibility layer: add toggle for granting Play services access to ICC auth in order to support RCS with carriers requiring it for RCS in Google Messages including T-Mobile (see [RCS usage guide](https://grapheneos.org/usage#rcs))
- Launcher: fix rare upstream crash when switching users
- Dialer: add new opt-in implementation of call recording using the same framework APIs as Google Dialer with the goal of improving functionality (handover support) and robustness (currently an opt-in setting for testing and then it will replace the previous implementation)
- kernel (6.1, 6.6, 6.12): re-enable standard forced module signing with a workaround to make pKVM compatible with it
- kernel (6.1): update to latest GKI LTS branch revision including update to 6.1.162
- kernel (6.6): update to latest GKI LTS branch revision including update to 6.6.123
- kernel (6.12): update to latest GKI LTS branch revision including update to 6.12.69
- change default quick tile configuration for the new UI (replacing cast, wallet and device controls with camera, microphone and NFC toggles by default)
- Vanadium: update to [version 145.0.7632.45.1](https://github.com/GrapheneOS/Vanadium/releases/tag/145.0.7632.45.1)
- update release signing to handle AOSP APEX changes
- migrate otatools.zip changes to Android's modern build system (soong)

All of the Android 16 security patches from the current March 2026, April 2026, May 2026, June 2026, July 2026 and August 2026 Android Security Bulletins are included in the 2026021201 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-0039, CVE-2026-0040, CVE-2026-0041, CVE-2026-0042, CVE-2026-0043, CVE-2026-0044, CVE-2026-0047, CVE-2026-0049, CVE-2026-0052
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-32348, CVE-2025-48600, CVE-2025-48615, CVE-2025-48617, CVE-2025-48630, CVE-2025-48641, CVE-2025-48642, CVE-2025-48644, CVE-2025-48645, CVE-2025-48646, CVE-2025-48649, CVE-2025-48652, CVE-2025-48653, CVE-2025-48654, CVE-2026-0011, CVE-2026-0014, CVE-2026-0015, CVE-2026-0016, CVE-2026-0017, CVE-2026-0018, CVE-2026-0020, CVE-2026-0021, CVE-2026-0022, CVE-2026-0023, CVE-2026-0024, CVE-2026-0025, CVE-2026-0033, CVE-2026-0034, CVE-2026-0035, CVE-2026-0036, CVE-2026-0048, CVE-2026-0050, CVE-2026-0053, CVE-2026-0054, CVE-2026-0055, CVE-2026-0056

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026020600

Tags:

- [2026020600](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026020600) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, emulator, generic, other targets)

Changes since the 2026020400 release:

- raise declared Android security patch level to 2026-02-05 which has been provided since we moved to Android 16 QPR2 in December (was meant to be declared in the previous release)
- add cross-SIM calling support (making calls using a SIM via the mobile data provided by another SIM similarly to Wi-Fi calling); requires Automatic data switching in SIM settings, and existing installs may need to toggle Automatic data switching off and on to enable cross-SIM calling
- extend our carrier override feature with a toggle for forcing the availability of cross-SIM calling support
- Vanadium: update to [version 145.0.7632.45.0](https://github.com/GrapheneOS/Vanadium/releases/tag/145.0.7632.45.0)

All of the Android 16 security patches from the current March 2026, April 2026, May 2026, June 2026, July 2026 and August 2026 Android Security Bulletins are included in the 2026020601 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-0039, CVE-2026-0040, CVE-2026-0041, CVE-2026-0042, CVE-2026-0043, CVE-2026-0044, CVE-2026-0047, CVE-2026-0049, CVE-2026-0052
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-32348, CVE-2025-48600, CVE-2025-48615, CVE-2025-48617, CVE-2025-48630, CVE-2025-48641, CVE-2025-48642, CVE-2025-48644, CVE-2025-48645, CVE-2025-48646, CVE-2025-48649, CVE-2025-48652, CVE-2025-48653, CVE-2025-48654, CVE-2026-0011, CVE-2026-0014, CVE-2026-0015, CVE-2026-0016, CVE-2026-0017, CVE-2026-0018, CVE-2026-0020, CVE-2026-0021, CVE-2026-0022, CVE-2026-0023, CVE-2026-0024, CVE-2026-0025, CVE-2026-0033, CVE-2026-0034, CVE-2026-0035, CVE-2026-0036, CVE-2026-0048, CVE-2026-0050

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026020400

Tags:

- [2026020400](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026020400) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, emulator, generic, other targets)

Changes since the 2026012800 release:

- raise declared Android security patch level to February 2026 which has been provided since we moved to Android 16 QPR2 in December (currently declared as 2026-02-01 even though 2026-02-05 has been provided since Android 16 QPR2 but it wasn't worth restarting the builds)
- update to February 2026 Pixel driver/firmware code providing the 2026-02-05 Pixel security patch level
- Dialer: fix call recording button state after fragment re-creation to avoid showing call recording as active when it isn't
- kernel (6.1): update to latest GKI LTS branch revision
- kernel (6.6): update to latest GKI LTS branch revision including update to 6.6.121
- Vanadium: update to [version 145.0.7632.26.0](https://github.com/GrapheneOS/Vanadium/releases/tag/145.0.7632.26.0)
- switch to 64-bit-only Vanadium releases for devices without 32-bit support (7th gen Pixels and later)
- App Store: update to [version 34](https://github.com/GrapheneOS/Apps/releases/tag/34)
- App Store: update to [version 35](https://github.com/GrapheneOS/Apps/releases/tag/35)
- switch from 6.6 kernel branch to 6.12 kernel branch for emulator builds (used for development) to match AOSP since Android 16 QPR2

All of the Android 16 security patches from the current March 2026, April 2026, May 2026 and June 2026 Android Security Bulletins are included in the 2026020401 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-0039, CVE-2026-0040, CVE-2026-0041, CVE-2026-0042, CVE-2026-0043, CVE-2026-0044, CVE-2026-0047, CVE-2026-0049
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-32348, CVE-2025-48600, CVE-2025-48615, CVE-2025-48617, CVE-2025-48630, CVE-2025-48641, CVE-2025-48642, CVE-2025-48644, CVE-2025-48645, CVE-2025-48646, CVE-2025-48649, CVE-2025-48652, CVE-2025-48653, CVE-2025-48654, CVE-2026-0011, CVE-2026-0014, CVE-2026-0015, CVE-2026-0016, CVE-2026-0017, CVE-2026-0018, CVE-2026-0020, CVE-2026-0021, CVE-2026-0022, CVE-2026-0023, CVE-2026-0024, CVE-2026-0025, CVE-2026-0033, CVE-2026-0034, CVE-2026-0035, CVE-2026-0036, CVE-2026-0048, CVE-2026-0050

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026012800

Tags:

- [2026012800](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026012800) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, emulator, generic, other targets)

Changes since the 2026012100 release:

- FusedLocationProvider: restore pre-16-QPR1 GNSS usage policy of using GNSS for both balanced and high power requests instead of only high power requests since many GrapheneOS users don't enable network location and network location may not always be accessible such as temporarily not having internet access
- Sandboxed Google Play compatibility layer: add special case for sandboxed Play services making it so users granting the SMS permission enables reading SMS addressed to apps using the Google Play services client library (Android 16 QPR2 prevented using the SMS permission to read SMS addressed to other apps so a special case is needed for apps which use Google Play services to handle SMS-based authentication)
- Sandboxed Google Play compatibility layer: prevent sandboxed Play Store attempting to install the "Device configuration" package which is not used on GrapheneOS and serves no purpose
- avoid compatibility issues with misguided anti-tampering checks in a tiny subset of apps by changing the initial call stack for secure app spawning (exec spawning) to match the standard zygote-based spawning so these apps no longer detect secure spawning as an altered call stack indicating tampering
- Settings: require device restart after changing the secure app spawning setting
- Sandboxed Google Play compatibility layer: update Android Auto configuration UI to Material 3 Expressive
- add workaround for upstream system\_server startUserInBackgroundTemporarily crash
- fix GrapheneOS support for recording permission usage history for a broader set of permissions
- Dialer: set CallStyle for call notifications to improve the user interface and replace our temporary workaround of disabling notification grouping for it
- Network Location: rename "GrapheneOS proxy" option to "GrapheneOS Apple proxy" for clarity
- Network Location: add "Apple China" server choice required for China data due to China's laws about mapping the country (currently no proxy due to poor connectivity to and from China causing reliability issues with connecting to Apple's servers in China from ours but we plan to offer it as an option in the future)
- Pixel 8a, 9th gen Pixels and 10th gen Pixels: disable NTP usage in Samsung gnssd which isn't as useful on GrapheneOS due to reducing the system time update threshold from 2000ms to 50ms along with avoiding us needing to redirect this to our own NTP service as we did for Qualcomm xtra-daemon
- update code for disabling reporting of harmless fingerprint-service.goodix crash
- improve user interface for Network/Sensors permissions in the permission manager
- fix minor Material 3 Expressive styling issues for the Contact Scopes and Storage Scopes configuration UI
- adevtool: raise minimal supported Node.js version to 24
- adevtool: disallow running adevtool as root
- adevtool: check for presence of prebuilts dirs at startup
- kernel (6.12): update to latest GKI LTS branch revision including update to 6.12.67
- Vanadium: update to [version 144.0.7559.109.0](https://github.com/GrapheneOS/Vanadium/releases/tag/144.0.7559.109.0)

All of the Android 16 security patches from the current February 2026, March 2026, April 2026, May 2026 and June 2026 Android Security Bulletins are included in the 2026012801 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-0039, CVE-2026-0040, CVE-2026-0041, CVE-2026-0042, CVE-2026-0043, CVE-2026-0044, CVE-2026-0047, CVE-2026-0049
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-32348, CVE-2025-48600, CVE-2025-48615, CVE-2025-48617, CVE-2025-48630, CVE-2025-48641, CVE-2025-48642, CVE-2025-48644, CVE-2025-48645, CVE-2025-48646, CVE-2025-48649, CVE-2025-48652, CVE-2025-48653, CVE-2025-48654, CVE-2026-0011, CVE-2026-0014, CVE-2026-0015, CVE-2026-0016, CVE-2026-0017, CVE-2026-0018, CVE-2026-0020, CVE-2026-0021, CVE-2026-0022, CVE-2026-0023, CVE-2026-0024, CVE-2026-0025, CVE-2026-0033, CVE-2026-0034, CVE-2026-0035, CVE-2026-0036, CVE-2026-0048, CVE-2026-0050

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026012100

Tags:

- [2026012100](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026012100) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, emulator, generic, other targets)

Changes since the 2026011300 release:

- fix an upstream infinite loop bug in ProtoFieldFilter.skipBytes() causing an upstream system\_server issue leading to the OS being unusable in early boot for a tiny subset of users since Android 16 QPR2 (there are a bunch of reports of these symptoms with the stock Pixel OS)
- libpng: backport security patches
- remove unused INTERNET permission from Pixel Camera Services since GrapheneOS doesn't support the Pixel Connected Cameras feature
- kernel (6.1): update to latest GKI LTS branch revision including update to 6.1.161
- kernel (6.6): update to latest GKI LTS branch revision
- kernel (6.12): update to latest GKI LTS branch revision including update to 6.12.66
- kernel (Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold): enable lockdown in integrity mode which is a major step towards matching the other devices using it in confidentiality mode
- Vanadium: update to [version 144.0.7559.59.0](https://github.com/GrapheneOS/Vanadium/releases/tag/144.0.7559.59.0)
- Vanadium: update to [version 144.0.7559.59.1](https://github.com/GrapheneOS/Vanadium/releases/tag/144.0.7559.59.1)
- Vanadium: update to [version 144.0.7559.76.0](https://github.com/GrapheneOS/Vanadium/releases/tag/144.0.7559.76.0)
- Vanadium: update to [version 144.0.7559.76.1](https://github.com/GrapheneOS/Vanadium/releases/tag/144.0.7559.76.1)
- Vanadium: update to [version 144.0.7559.90.0](https://github.com/GrapheneOS/Vanadium/releases/tag/144.0.7559.90.0)

All of the Android 16 security patches from the current February 2026, March 2026, April 2026, May 2026 and June 2026 Android Security Bulletins are included in the 2026012101 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-0039, CVE-2026-0040, CVE-2026-0041, CVE-2026-0042, CVE-2026-0043, CVE-2026-0044
- High: CVE-2025-22424, CVE-2025-22426, CVE-2025-32348, CVE-2025-48561, CVE-2025-48615, CVE-2025-48617, CVE-2025-48630, CVE-2025-48641, CVE-2025-48642, CVE-2025-48644, CVE-2025-48645, CVE-2025-48646, CVE-2025-48649, CVE-2025-48652, CVE-2025-48653, CVE-2025-48654, CVE-2026-0011, CVE-2026-0014, CVE-2026-0015, CVE-2026-0016, CVE-2026-0017, CVE-2026-0018, CVE-2026-0020, CVE-2026-0021, CVE-2026-0022, CVE-2026-0023, CVE-2026-0024, CVE-2026-0025, CVE-2026-0033, CVE-2026-0034, CVE-2026-0036
- Unclassified: CVE-2026-0035

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026011300

Tags:

- [2026011300](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026011300) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, emulator, generic, other targets)

Changes since the 2026011000 release:

- update to January 2026 Pixel driver/firmware code for the subset of devices with a January 2026 release
- allow user to set any account as the default contacts account (since Android 16 QPR1, this was restricted to Google accounts for the stock Pixel OS and nothing permitted at all for AOSP)
- kernel (6.1): update to latest GKI LTS branch revision including update to 6.1.159
- kernel (6.6): update to latest GKI LTS branch revision
- kernel (6.12): update to latest GKI LTS branch revision

All of the Android 16 security patches from the current February 2026, March 2026, April 2026, May 2026 and June 2026 Android Security Bulletins are included in the 2026011301 security preview release. List of additional fixed CVEs:

- High: CVE-2025-32348, CVE-2025-48561, CVE-2025-48615, CVE-2025-48617, CVE-2025-48630, CVE-2025-48641, CVE-2025-48642, CVE-2025-48644, CVE-2025-48645, CVE-2025-48646, CVE-2025-48649, CVE-2025-48652, CVE-2025-48653, CVE-2025-48654, CVE-2026-0014, CVE-2026-0015, CVE-2026-0016, CVE-2026-0017, CVE-2026-0018, CVE-2026-0020, CVE-2026-0021, CVE-2026-0022, CVE-2026-0023, CVE-2026-0024, CVE-2026-0025, CVE-2026-0033, CVE-2026-0034, CVE-2026-0035, CVE-2026-0036

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026011000

Support for 10th gen Pixels is no longer considered experimental.

Tags:

- [2026011000](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026011000) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, emulator, generic, other targets)

Changes since the 2026010800 release:

- reimplement the standard Android USB data signal API with our hardware + software USB blocking functionality to preserve support for the device admin and lockdown mode features for fully toggling off USB while upgrading it to use hardware blocking (this was omitted in the previous Alpha-only release)
- fix regression in the last release causing sandboxed Google Play breakage in a subset of secondary users caused by the phenotype flag changes in the previous release
- Sandboxed Google Play compatibility layer: add stub for ContentResolver.acquireUnstableProvider()
- fix the Terminal virtual machine management app not working in a secondary user Private Space (GrapheneOS adds the ability to use the Terminal app in secondary users and also adds the ability to use Private Space in secondary users, so the combination of those things resulted in this being possible but the upstream code was incompatible with it)
- Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold: add high EMF (PWM) mode opt-in to the Settings app

All of the Android 16 security patches from the current February 2026, March 2026, April 2026, May 2026 and June 2026 Android Security Bulletins are included in the 2026011001 security preview release. List of additional fixed CVEs:

- High: CVE-2025-32348, CVE-2025-48561, CVE-2025-48615, CVE-2025-48617, CVE-2025-48630, CVE-2025-48641, CVE-2025-48642, CVE-2025-48644, CVE-2025-48645, CVE-2025-48646, CVE-2025-48649, CVE-2025-48652, CVE-2025-48653, CVE-2025-48654, CVE-2026-0014, CVE-2026-0015, CVE-2026-0016, CVE-2026-0017, CVE-2026-0018, CVE-2026-0020, CVE-2026-0021, CVE-2026-0022, CVE-2026-0023, CVE-2026-0024, CVE-2026-0025, CVE-2026-0033, CVE-2026-0034, CVE-2026-0035

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2026010800

Tags:

- [2026010800](https://github.com/GrapheneOS/platform_manifest/releases/tag/2026010800) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, emulator, generic, other targets)

Changes since the 2025122500 release:

- raise declared Android security patch level to 2026-01-05 which has been provided since we moved to Android 16 QPR2 in December due to Pixels shipping CVE-2025-54957 in December
- re-enable the system keyboard package at boot if the package is disabled (does not change keyboard settings)
- switch to the system keyboard when device boots to the Safe Mode
- add "Reboot to Safe Mode" power menu button in Before First Unlock state to make Safe Mode much more discoverable for working around app issues such as a broken third party keyboard
- add workaround for upstream UsageStatsDatabase OOM system\_server crash
- add workaround for upstream WindowContext.finalize() system\_server crash
- disable buggy upstream disable\_frozen\_process\_wakelocks feature causing system\_server crashes for some users
- Sandboxed Google Play compatibility layer: fix phenotype flags not working in Play services clients
- Sandboxed Google Play compatibility layer: add MEDIA\_CONTENT\_CONTROL as a requested permission for Android Auto as part of our toggles for it to avoid needing to grant the far more invasive notification access permission
- Sandboxed Google Play compatibility layer: extend opt-in Android Auto Bluetooth support to allow A2dpService.setConnectionPolicy() to fix Bluetooth functionality (previously worked around with a GmsCompatConfig update avoiding a crash)
- switch to new upstream PackageInstallerUI implementation added in Android 16 QPR2 and port our changes to it
- update SQLite to 3.50.6 LTS release
- add an extra layer of USB port protection on 10th gen Pixels based on upstream functionality to replace our USB gadget control which was causing compatibility issues with the Pixel 10 USB drivers
- allow SystemUI to access NFC service on 10th gen Pixels to fix the NFC quick tile
- disable the upstream Android USB data protection feature since it conflicts with our more advanced approach and causes issues
- issue CHARGING\_ONLY\_IMMEDIATE port control command in more cases
- fix an issue in our infrastructure for spoofing permission self-checks breaking automatically reading SMS one-time codes for certain apps
- add workaround for upstream KeySetManagerService system\_server crash causing a user to be stuck on an old OS version due to it causing a boot failure when booting a the new OS version after updating
- wipe DPM partition on 10th gen Pixels as part of installation as we do on earlier Pixels since it's always meant to be zeroed on production devices
- Settings: disable indexing of the unsupported "Parental controls" setting which is not currently available in AOSP
- Settings: disable redundant indexing of widgets on lockscreen contents which is already indexed another way
- skip all pseudo kernel crash reports caused by device reboot to avoid various false positive crash reports
- Vanadium: update to [version 143.0.7499.192.0](https://github.com/GrapheneOS/Vanadium/releases/tag/143.0.7499.192.0)

All of the Android 16 security patches from the current February 2026, March 2026, April 2026, May 2026 and June 2026 Android Security Bulletins are included in the 2026010801 security preview release. List of additional fixed CVEs:

- High: CVE-2025-32348, CVE-2025-48561, CVE-2025-48615, CVE-2025-48630, CVE-2025-48641, CVE-2025-48642, CVE-2025-48644, CVE-2025-48645, CVE-2025-48646, CVE-2025-48649, CVE-2025-48652, CVE-2025-48653, CVE-2026-0014, CVE-2026-0015, CVE-2026-0016, CVE-2026-0017, CVE-2026-0018, CVE-2026-0020, CVE-2026-0021, CVE-2026-0022, CVE-2026-0023, CVE-2026-0024, CVE-2026-0025

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2025122500

Tags:

- [2025122500](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025122500) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, emulator, generic, other targets)

Changes since the 2025121700 release:

- restore support for bypassing carriers disallowing choosing the cellular network mode (this was lost in a recent major version migration such as the port to Android 16 QPR1 but we aren't sure exactly when it regressed)
- remove poorly designed upstream end session button on the lockscreen (it remains available in the power menu)
- enable feature flag for new upstream end session button in the user switcher
- switch to vendor files from 2nd December 2025 release (BP4A.251205.006.E1) for devices with it available
- enable lockscreen widget support
- fix upstream system\_server crash in NotificationHistoryProtoHelper
- Wi-Fi HAL: ignore debug logging requests on all Pixels with MTE support to avoid a crash from detecting an invalid memory access in the upstream code
- Sandboxed Google Play compatibility layer: add support for redirecting Google Play location service requests from within Google Play services itself which means the GrapheneOS provided network location will work for internal Play services features such as Google Maps location sharing when redirecting to the OS is enabled (which is the default) and the Location permission is granted to it
- Sandboxed Google Play compatibility layer: force redirecting Google Play location service requests from within Google Play services and Android Auto when the Location permission is disabled for better error handling (neither properly handles the Location permission not being granted since it's always granted on any Google Mobile Services OS in practice instead of being explicitly opt-in)
- Sandboxed Google Play compatibility layer: fix a compatibility issue with the Chromium test suite
- Network Location: improve position estability accuracy and stability
- Network Location: prevent potential division by zero exception
- Network Location: improve experimental Wi-Fi RTT support which is still disabled in production
- kernel (6.1): update to latest GKI LTS branch revision
- kernel (6.6): update to latest GKI LTS branch revision including update to 6.6.119
- kernel (6.6): disable CONFIG\_TLS to reduce attack surface
- kernel (6.12): update to latest GKI LTS branch revision including update to 6.12.63
- kernel (6.12): disable CONFIG\_TLS to reduce attack surface
- include configuration for thermometer on 10th gen Pixels
- adevtool: auto-detect filesystem image type (ext4 vs. EROFS)
- adevtool: add support for canary builds
- adevtool: improve performance
- remove obsolete workaround for using a prebuilt recovery extension

All of the Android 16 security patches from the current January 2026, February 2026, March 2026, April 2026, May 2026 and June 2026 Android Security Bulletins are included in the 2025122501 security preview release. List of additional fixed CVEs:

- High: CVE-2025-32348, CVE-2025-48561, CVE-2025-48630, CVE-2025-48641, CVE-2025-48642, CVE-2025-48644, CVE-2025-48645, CVE-2025-48646, CVE-2025-48649, CVE-2025-48652, CVE-2025-48653, CVE-2026-0014, CVE-2026-0015, CVE-2026-0016, CVE-2026-0017, CVE-2026-0018, CVE-2026-0020, CVE-2026-0021, CVE-2026-0022, CVE-2026-0023, CVE-2026-0024, CVE-2026-0025

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2025121700

Tags:

- [2025121700](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025121700) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, emulator, generic, other targets)

Changes since the 2025121200 release:

- add workaround for upstream system\_server WallpaperManagerService.hasPermission() crash
- fix upstream system\_server crash in NotificationHistory.getPooledStringsToWrite()
- Launcher: add a workaround for upstream QuickstepModelDelegate.getContainer() crash
- set initial port security state at an earlier boot stage to improve debugging on production builds where the port state has been changed from the default "Charging-only when locked" to "Charging-only when locked, except before first unlock" or "On"
- use default desktop mode configuration since our changes are no longer needed to enable features and caused crashes for at least 1 user which were addressed with an out-of-band release prior to this one
- kernel (6.1): update to latest GKI LTS branch revision
- kernel (6.1): add back recent dma-buf changes now that an upstream use-after-free bug is resolved
- kernel (6.6): update to latest GKI LTS branch revision including update to 6.6.118
- adevtool: update carrier settings
- Vanadium: update to [version 143.0.7499.146.0](https://github.com/GrapheneOS/Vanadium/releases/tag/143.0.7499.146.0)

All of the Android 16 security patches from the current January 2026, February 2026, March 2026, April 2026, May 2026 and June 2026 Android Security Bulletins are included in the 2025121701 security preview release. List of additional fixed CVEs:

- High: CVE-2025-32348, CVE-2025-48641, CVE-2026-0014, CVE-2026-0015, CVE-2026-0016, CVE-2026-0017, CVE-2026-0018

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2025121200

Tags:

- [2025121200](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025121200) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, emulator, generic, other targets)

Changes since the 2025121000 release:

- disable notification summaries and organizer features due to AOSP and GrapheneOS lacking the AI models used to implement these features
- add workaround for notification background appearance regression in Android 16 QPR2
- Vanadium: update to [version 143.0.7499.109.0](https://github.com/GrapheneOS/Vanadium/releases/tag/143.0.7499.109.0)
- GmsCompatConfig: update to [version 167](https://github.com/GrapheneOS/platform_packages_apps_GmsCompat/releases/tag/config-167)

All of the Android 16 security patches from the current January 2026, February 2026, March 2026, April 2026, May 2026 and June 2026 Android Security Bulletins are included in the 2025121201 security preview release. List of additional fixed CVEs:

- High: CVE-2025-32348, CVE-2025-48641, CVE-2026-0014, CVE-2026-0015, CVE-2026-0016, CVE-2026-0017, CVE-2026-0018

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2025121000

This is our first non-experimental release based on Android 16 QPR2 after our initial experimental 2025120800 release.

The change to the style of notification backgrounds is an upstream regression rather than an intentional change to a more minimal style. It will be fixed in a subsequent release since we decided it isn't important enough to delay this.

Tags:

- [2025121000](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025121000) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, emulator, generic, other targets)

Changes since the 2025120400 release:

- full 2025-12-05 security patch level
- rebased onto BP4A.251205.006 Android Open Source Project release (Android 16 QPR2)
- disable promotion of identity check feature not currently present in GrapheneOS due to depending on privileged Google Mobile Services integration
- GmsCompatConfig: update to [version 166](https://github.com/GrapheneOS/platform_packages_apps_GmsCompat/releases/tag/config-166)

All of the Android 16 security patches from the current January 2026, February 2026, March 2026, April 2026, May 2026 and June 2026 Android Security Bulletins are included in the 2025121001 security preview release. List of additional fixed CVEs:

- High: CVE-2025-32348, CVE-2025-48641, CVE-2026-0014, CVE-2026-0015, CVE-2026-0016, CVE-2026-0017, CVE-2026-0018

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2025120400

Tags:

- [2025120400](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025120400) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL, Pixel 10 Pro Fold, emulator, generic, other targets)

Changes since the 2025112100 release:

- full 2025-12-01 security patch level (has already been fully provided by our security preview releases for at least a month and most of the patches since September)
- add experimental support for the Pixel 10, Pixel 10 Pro, Pixel 10 Pro XL and Pixel 10 Pro Fold (there were 2 standalone experimental releases prior to this via 2025112500 and 2025113000 along with corresponding security preview releases for each)
- Cell Broadcast Receiver: switch back to our modified text for the presidential alerts toggle
- kernel (6.1): update to latest GKI LTS branch revision including update to 6.1.158
- kernel (6.6): update to latest GKI LTS branch revision including update to 6.6.116
- kernel (6.12): update to latest GKI LTS branch revision including update to 6.12.60
- Auditor: update to [version 90](https://github.com/GrapheneOS/Auditor/releases/tag/90)
- Vanadium: update to [version 143.0.7499.34.0](https://github.com/GrapheneOS/Vanadium/releases/tag/143.0.7499.34.0)
- Vanadium: update to [version 143.0.7499.34.1](https://github.com/GrapheneOS/Vanadium/releases/tag/143.0.7499.34.1)
- Vanadium: update to [version 143.0.7499.34.2](https://github.com/GrapheneOS/Vanadium/releases/tag/143.0.7499.34.2)
- Vanadium: update to [version 143.0.7499.52.0](https://github.com/GrapheneOS/Vanadium/releases/tag/143.0.7499.52.0)
- GmsCompatConfig: update to [version 164](https://github.com/GrapheneOS/platform_packages_apps_GmsCompat/releases/tag/config-164)
- GmsCompatConfig: update to [version 165](https://github.com/GrapheneOS/platform_packages_apps_GmsCompat/releases/tag/config-165)

All of the Android 16 security patches from the current January 2026, February 2026 and March 2026 Android Security Bulletins are included in the 2025120401 security preview release. List of additional fixed CVEs:

- Critical: CVE-2026-0006
- High: CVE-2025-26447, CVE-2025-32348, CVE-2025-48578, CVE-2025-48579, CVE-2025-48582, CVE-2025-48585, CVE-2025-48587, CVE-2025-48609, CVE-2025-48622, CVE-2026-0005, CVE-2026-0007, CVE-2026-0008, CVE-2026-0009, CVE-2026-0010

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2025112100

Tags:

- [2025112100](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025112100) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025111800 release:

- fix regression from our Android 16 QPR1 port causing enabling the Network permission to not work without a reboot
- adevtool: fix SELinux policy handling issue causing fingerprint registration issues on the devices with power button fingerprint readers (Pixel Tablet, Pixel Fold, Pixel 9 Pro Fold) with Android QPR1
- fix port of our notification forwarding between user profiles feature to Android 16 QPR1
- enable new UI customization picker UI from Android 16 QPR1
- Wallpaper Picker: don't use the CuratedPhotos categories which aren't setup in AOSP
- Wallpaper Picker: hide the always-empty wallpaper carousel
- Wallpaper Picker: enable integration of the embedded photo picker
- System Updater, Sandboxed Google Play compatibility layer: switch to Material 3 Expressive theme for Settings app menus
- Cell Broadcast Receiver: fix presidential alerts toggle added by GrapheneOS not being enabled without the main emergency alerts toggle being toggled off and on
- Vanadium: update to [version 142.0.7444.171.0](https://github.com/GrapheneOS/Vanadium/releases/tag/142.0.7444.171.0)

All of the Android 16 security patches from the current December 2025, January 2026, February 2026 and March 2026 Android Security Bulletins are included in the 2025112101 security preview release. List of additional fixed CVEs:

- Critical: CVE-2025-48631, CVE-2026-0006
- High: CVE-2022-25836, CVE-2022-25837, CVE-2023-40130, CVE-2025-22420, CVE-2025-22432, CVE-2025-26447, CVE-2025-32319, CVE-2025-32348, CVE-2025-48525, CVE-2025-48536, CVE-2025-48555, CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2025-48567, CVE-2025-48572, CVE-2025-48573, CVE-2025-48574, CVE-2025-48575, CVE-2025-48576, CVE-2025-48577, CVE-2025-48578, CVE-2025-48579, CVE-2025-48580, CVE-2025-48582, CVE-2025-48583, CVE-2025-48584, CVE-2025-48585, CVE-2025-48586, CVE-2025-48587, CVE-2025-48589, CVE-2025-48590, CVE-2025-48592, CVE-2025-48594, CVE-2025-48596, CVE-2025-48597, CVE-2025-48598, CVE-2025-48600, CVE-2025-48601, CVE-2025-48602, CVE-2025-48603, CVE-2025-48604, CVE-2025-48605, CVE-2025-48609, CVE-2025-48612, CVE-2025-48614, CVE-2025-48615, CVE-2025-48616, CVE-2025-48617, CVE-2025-48618, CVE-2025-48619, CVE-2025-48620, CVE-2025-48621, CVE-2025-48622, CVE-2025-48626, CVE-2025-48628, CVE-2025-48629, CVE-2025-48630, CVE-2025-48632, CVE-2025-48633, CVE-2025-48634, CVE-2026-0005, CVE-2026-0007, CVE-2026-0008

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2025111800

Following our experimental releases, this is our first non-experimental release based on Android 16 QPR1, the first quarterly release of Android 16. Android 16 QPR1 was pushed to the Android Open Source Project on November 11 rather than September 3 as expected. This is a very large quarterly release with more prominent user-facing improvements than Android 16 provided compared to Android 15 QPR2.

Tags:

- [2025111800](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025111800) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025110800 release:

- rebased onto BP3A.250905.014 Android Open Source Project release (Android 16 QPR1)
- Terminal (virtual machine management app): re-enable GUI support now that the surfaceflinger crashes are resolved upstream by Android 16 QPR1
- adevtool: massive overhaul entirely replacing the small remnants of the Pixel device trees to fix several regressions introduced since Android 16 such as charging mode booting into the regular OS and to prepare for adding 10th gen Pixel devices via automated device support without any need for device trees to use as a reference
- kernel (6.12): update to latest GKI LTS branch revision
- raise declared patch level to 2025-11-05 which has already been provided in GrapheneOS since our regular [2025090200](https://grapheneos.org/releases#2025090200) release (not a security preview) since the patches were included in the September security preview and were then pushed to AOSP despite not being listed in the bulletin along with there being no Pixel Update Bulletin patches for November 2025
- Vanadium: update to [version 142.0.7444.158.0](https://github.com/GrapheneOS/Vanadium/releases/tag/142.0.7444.158.0)

All of the Android 16 security patches from the current December 2025, January 2026, February 2026 and March 2026 Android Security Bulletins are included in the 2025111801 security preview release. List of additional fixed CVEs:

- Critical: CVE-2025-48631, CVE-2026-0006
- High: CVE-2022-25836, CVE-2022-25837, CVE-2023-40130, CVE-2025-22420, CVE-2025-22432, CVE-2025-26447, CVE-2025-32319, CVE-2025-32348, CVE-2025-48525, CVE-2025-48536, CVE-2025-48555, CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2025-48567, CVE-2025-48572, CVE-2025-48573, CVE-2025-48574, CVE-2025-48575, CVE-2025-48576, CVE-2025-48577, CVE-2025-48578, CVE-2025-48579, CVE-2025-48580, CVE-2025-48582, CVE-2025-48583, CVE-2025-48584, CVE-2025-48585, CVE-2025-48586, CVE-2025-48587, CVE-2025-48589, CVE-2025-48590, CVE-2025-48592, CVE-2025-48594, CVE-2025-48596, CVE-2025-48597, CVE-2025-48598, CVE-2025-48600, CVE-2025-48601, CVE-2025-48602, CVE-2025-48603, CVE-2025-48604, CVE-2025-48605, CVE-2025-48609, CVE-2025-48612, CVE-2025-48614, CVE-2025-48615, CVE-2025-48616, CVE-2025-48617, CVE-2025-48618, CVE-2025-48619, CVE-2025-48620, CVE-2025-48621, CVE-2025-48622, CVE-2025-48626, CVE-2025-48628, CVE-2025-48629, CVE-2025-48630, CVE-2025-48632, CVE-2025-48633, CVE-2025-48634, CVE-2026-0005, CVE-2026-0007, CVE-2026-0008

The official Android security preview patches are for the initial release of Android 16 and we had to port the patches to Android 16 QPR1. This resulted in it taking significantly longer to be available. Due to this, 2025111801 also bundles Vanadium 142.0.7444.171.0 which was released through our App Store after the regular OS release but prior to the security preview OS release. It's otherwise a normal security preview release with no non-security-preview patch related changes beyond the Vanadium release being included.

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2025110800

Tags:

- [2025110800](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025110800) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025110600 release:

- adevtool: fully automate handling SoC and radio firmware image backports, which resolves an issue with a version string mismatch in the previous release for the initial installation process which resulted in us cancelling the Stable channel release
- Vanadium: update to [version 142.0.7444.138.1](https://github.com/GrapheneOS/Vanadium/releases/tag/142.0.7444.138.1)

All of the Android 16 security patches from the current December 2025, January 2026, February 2026 and March 2026 Android Security Bulletins are included in the 2025110801 security preview release. List of additional fixed CVEs:

- Critical: CVE-2025-48631, CVE-2026-0006
- High: CVE-2022-25836, CVE-2022-25837, CVE-2023-40130, CVE-2025-22420, CVE-2025-22432, CVE-2025-26447, CVE-2025-32319, CVE-2025-32348, CVE-2025-48525, CVE-2025-48536, CVE-2025-48555, CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2025-48567, CVE-2025-48572, CVE-2025-48573, CVE-2025-48574, CVE-2025-48575, CVE-2025-48576, CVE-2025-48577, CVE-2025-48578, CVE-2025-48579, CVE-2025-48580, CVE-2025-48582, CVE-2025-48583, CVE-2025-48584, CVE-2025-48585, CVE-2025-48586, CVE-2025-48587, CVE-2025-48589, CVE-2025-48590, CVE-2025-48592, CVE-2025-48594, CVE-2025-48596, CVE-2025-48597, CVE-2025-48598, CVE-2025-48600, CVE-2025-48601, CVE-2025-48602, CVE-2025-48603, CVE-2025-48604, CVE-2025-48605, CVE-2025-48609, CVE-2025-48612, CVE-2025-48614, CVE-2025-48615, CVE-2025-48616, CVE-2025-48617, CVE-2025-48618, CVE-2025-48619, CVE-2025-48620, CVE-2025-48621, CVE-2025-48622, CVE-2025-48626, CVE-2025-48628, CVE-2025-48629, CVE-2025-48630, CVE-2025-48632, CVE-2025-48633, CVE-2025-48634, CVE-2026-0005, CVE-2026-0007, CVE-2026-0008

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2025110600

Both of the November 2025 patches have been provided in our regular non-security-preview releases for over a month, so we've already had the 2025-11-05 Android security patch level for over a month. Our patch level is set based on providing both the Android and Pixel security patches, so we're leaving it at 2025-11-01 until the Pixel stock OS release and Pixel Update Bulletin are published. The stock Pixel OS also included both November 2025 patches in early September. We expect they made a 2nd October release to ship the November carrier changes and will make a release in mid-November with patches from future Android Security Bulletins.

Tags:

- [2025110600](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025110600) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025102800 release:

- raise declared patch level to 2025-11-01 which has already been provided in GrapheneOS since our regular [2025090200](https://grapheneos.org/releases#2025090200) release (not a security preview) since the patches were included in the September security preview and were then pushed to AOSP despite not being listed in the bulletin
- kernel (6.1): update to latest GKI LTS branch revision
- kernel (6.1): keep POSIX\_MQUEUE disabled to avoid increasing attack surface
- kernel (6.6): update to latest GKI LTS branch revision including update to 6.6.114
- kernel (6.12): update to latest GKI LTS branch revision
- adevtool: switch to obtaining Android 16 QPR1 backports from the latest November releases for relevant Pixels (there are no security patches listed for the Android or Pixel bulletins and not all Pixels received the tiny release)
- Settings: add 1 second delay for approving device admin activation to mitigate tapjacking (this matches the 1 second delay we add to both permission prompts and ADB authorization prompts which is currently not configurable)
- Vanadium: update to [version 142.0.7444.138.0](https://github.com/GrapheneOS/Vanadium/releases/tag/142.0.7444.138.0)

All of the Android 16 security patches from the current December 2025, January 2026, February 2026 and March 2026 Android Security Bulletins are included in the 2025110601 security preview release. List of additional fixed CVEs:

- Critical: CVE-2025-48631, CVE-2026-0006
- High: CVE-2022-25836, CVE-2022-25837, CVE-2023-40130, CVE-2025-22420, CVE-2025-22432, CVE-2025-26447, CVE-2025-32319, CVE-2025-32348, CVE-2025-48525, CVE-2025-48536, CVE-2025-48555, CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2025-48567, CVE-2025-48572, CVE-2025-48573, CVE-2025-48574, CVE-2025-48575, CVE-2025-48576, CVE-2025-48577, CVE-2025-48578, CVE-2025-48579, CVE-2025-48580, CVE-2025-48582, CVE-2025-48583, CVE-2025-48584, CVE-2025-48585, CVE-2025-48586, CVE-2025-48587, CVE-2025-48589, CVE-2025-48590, CVE-2025-48592, CVE-2025-48594, CVE-2025-48596, CVE-2025-48597, CVE-2025-48598, CVE-2025-48600, CVE-2025-48601, CVE-2025-48602, CVE-2025-48603, CVE-2025-48604, CVE-2025-48605, CVE-2025-48609, CVE-2025-48612, CVE-2025-48614, CVE-2025-48615, CVE-2025-48616, CVE-2025-48617, CVE-2025-48618, CVE-2025-48619, CVE-2025-48620, CVE-2025-48621, CVE-2025-48622, CVE-2025-48626, CVE-2025-48628, CVE-2025-48629, CVE-2025-48630, CVE-2025-48632, CVE-2025-48633, CVE-2025-48634, CVE-2026-0005, CVE-2026-0007, CVE-2026-0008

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2025102800

Tags:

- [2025102800](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025102800) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025102600 release:

- Sandboxed Google Play compatibility layer: temporarily limit system service override infrastructure added for GmsFontProvider shim to Pixel Camera to work around certain banking apps detecting it as tampering (we can change the approach to avoid this to enable it for all apps using the Google Play client libraries again, especially since we want to expand it to improve app compatibility without Play services installed)
- kernel (6.1): update to latest GKI LTS branch revision
- kernel (6.6): update to latest GKI LTS branch revision including update to 6.6.112
- kernel (6.12): update to latest GKI LTS branch revision including update to 6.12.53

All of the Android 16 security patches from the current November 2025, December 2025 and January 2026 Android Security Bulletins are included in the 2025102801 security preview release. List of additional fixed CVEs:

- Critical: CVE-2025-48593, CVE-2025-48631
- High: CVE-2022-25836, CVE-2022-25837, CVE-2023-40130, CVE-2024-43766, CVE-2025-22420, CVE-2025-22432, CVE-2025-32319, CVE-2025-32348, CVE-2025-48525, CVE-2025-48536, CVE-2025-48555, CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2025-48567, CVE-2025-48572, CVE-2025-48573, CVE-2025-48574, CVE-2025-48575, CVE-2025-48576, CVE-2025-48577, CVE-2025-48578, CVE-2025-48579, CVE-2025-48580, CVE-2025-48582, CVE-2025-48583, CVE-2025-48584, CVE-2025-48585, CVE-2025-48586, CVE-2025-48587, CVE-2025-48589, CVE-2025-48590, CVE-2025-48592, CVE-2025-48594, CVE-2025-48596, CVE-2025-48597, CVE-2025-48598, CVE-2025-48600, CVE-2025-48601, CVE-2025-48602, CVE-2025-48603, CVE-2025-48604, CVE-2025-48605, CVE-2025-48609, CVE-2025-48612, CVE-2025-48614, CVE-2025-48615, CVE-2025-48616, CVE-2025-48617, CVE-2025-48618, CVE-2025-48619, CVE-2025-48620, CVE-2025-48621, CVE-2025-48622, CVE-2025-48626, CVE-2025-48628, CVE-2025-48629, CVE-2025-48630, CVE-2025-48632, CVE-2025-48633, CVE-2025-48634

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2025102600

Tags:

- [2025102600](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025102600) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025102300 release:

- Sandboxed Google Play compatibility layer: add shim implementation of GmsFontProvider to prevent crashes of apps depending on Play services when it's missing or disabled (restores support for using Pixel Camera without Play services)
- Sandboxed Google Play compatibility layer: extend shim for background service starts to address edge cases where a foreground service is required
- Sandboxed Google Play compatibility layer: fix NoOpPrewarmService chain crash in Pixel Camera caused by lack of privileged OS integration
- kernel (6.6): update to latest GKI LTS branch revision
- Vanadium: update to [version 142.0.7444.48.0](https://github.com/GrapheneOS/Vanadium/releases/tag/142.0.7444.48.0)

All of the Android 16 security patches from the current November 2025, December 2025 and January 2026 Android Security Bulletins are included in the 2025102601 security preview release. List of additional fixed CVEs:

- Critical: CVE-2025-48593, CVE-2025-48631
- High: CVE-2022-25836, CVE-2022-25837, CVE-2023-40130, CVE-2024-43766, CVE-2025-22420, CVE-2025-22432, CVE-2025-32319, CVE-2025-32348, CVE-2025-48525, CVE-2025-48536, CVE-2025-48555, CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2025-48567, CVE-2025-48572, CVE-2025-48573, CVE-2025-48574, CVE-2025-48575, CVE-2025-48576, CVE-2025-48577, CVE-2025-48578, CVE-2025-48579, CVE-2025-48580, CVE-2025-48582, CVE-2025-48583, CVE-2025-48584, CVE-2025-48585, CVE-2025-48586, CVE-2025-48587, CVE-2025-48589, CVE-2025-48590, CVE-2025-48592, CVE-2025-48594, CVE-2025-48596, CVE-2025-48597, CVE-2025-48598, CVE-2025-48600, CVE-2025-48601, CVE-2025-48602, CVE-2025-48603, CVE-2025-48604, CVE-2025-48605, CVE-2025-48609, CVE-2025-48612, CVE-2025-48614, CVE-2025-48615, CVE-2025-48616, CVE-2025-48617, CVE-2025-48618, CVE-2025-48619, CVE-2025-48620, CVE-2025-48621, CVE-2025-48622, CVE-2025-48626, CVE-2025-48628, CVE-2025-48629, CVE-2025-48630, CVE-2025-48632, CVE-2025-48633, CVE-2025-48634

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2025102300

Tags:

- [2025102300](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025102300) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025102200 release:

- fix signing the GmsCompatLib package with a dedicated cross-device key, which was added in the last release but wasn't being replaced by a release key and blocked moving the last release past Alpha
- kernel (6.12): update to latest GKI LTS branch revision

All of the Android 16 security patches from the current November 2025, December 2025 and January 2026 Android Security Bulletins are included in the 2025102301 security preview release. List of additional fixed CVEs:

- Critical: CVE-2025-48593, CVE-2025-48631
- High: CVE-2022-25836, CVE-2022-25837, CVE-2023-40130, CVE-2024-43766, CVE-2025-22420, CVE-2025-22432, CVE-2025-32319, CVE-2025-32348, CVE-2025-48525, CVE-2025-48536, CVE-2025-48555, CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2025-48567, CVE-2025-48572, CVE-2025-48573, CVE-2025-48574, CVE-2025-48575, CVE-2025-48576, CVE-2025-48577, CVE-2025-48578, CVE-2025-48579, CVE-2025-48580, CVE-2025-48582, CVE-2025-48583, CVE-2025-48584, CVE-2025-48585, CVE-2025-48586, CVE-2025-48587, CVE-2025-48589, CVE-2025-48590, CVE-2025-48592, CVE-2025-48594, CVE-2025-48596, CVE-2025-48597, CVE-2025-48598, CVE-2025-48600, CVE-2025-48601, CVE-2025-48602, CVE-2025-48603, CVE-2025-48604, CVE-2025-48605, CVE-2025-48609, CVE-2025-48612, CVE-2025-48614, CVE-2025-48615, CVE-2025-48616, CVE-2025-48617, CVE-2025-48618, CVE-2025-48619, CVE-2025-48620, CVE-2025-48621, CVE-2025-48622, CVE-2025-48626, CVE-2025-48628, CVE-2025-48629, CVE-2025-48630, CVE-2025-48632, CVE-2025-48633, CVE-2025-48634

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2025102200

Tags:

- [2025102200](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025102200) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025100900 release:

- adevtool: add satellite eSIM overlays to avoid the special Skylo eSIM on 9th/10th gen Pixels being listed as a regular eSIM and being possible to erase with the regular eSIM erase functionality
- kernel (6.6): update to latest GKI LTS branch revision including update to 6.6.111
- kernel (6.12): update to latest GKI LTS branch revision including update to 6.12.52
- System Updater: prevent reboot and security preview notifications from timing out after 3 days which is standard behavior since Android 15 QPR1
- System Updater: mark notification permission as fixed to prevent disabling overall notifications but exclude the channels for progress, errors and already up to date notifications from it so that only reboot and security preview notifications are mandatory
- Sandboxed Google Play compatibility layer: add support for overriding BinderProxy transactions
- Sandboxed Google Play compatibility layer: add support for out-of-band updates to GmsCompatLib
- Vanadium: update to [version 141.0.7390.111.0](https://github.com/GrapheneOS/Vanadium/releases/tag/141.0.7390.111.0)
- Vanadium: update to [version 141.0.7390.122.0](https://github.com/GrapheneOS/Vanadium/releases/tag/141.0.7390.122.0)
- GmsCompatConfig: update to [version 163](https://github.com/GrapheneOS/platform_packages_apps_GmsCompat/releases/tag/config-163)
- raise emulator super / dynamic partition size due to reaching the limit in some cases
- adevtool: prefer prebuilt AOSP JDK 21

All of the Android 16 security patches from the current November 2025, December 2025 and January 2026 Android Security Bulletins are included in the 2025102201 security preview release. List of additional fixed CVEs:

- Critical: CVE-2025-48593, CVE-2025-48631
- High: CVE-2022-25836, CVE-2022-25837, CVE-2023-40130, CVE-2024-43766, CVE-2025-22420, CVE-2025-22432, CVE-2025-32319, CVE-2025-32348, CVE-2025-48525, CVE-2025-48536, CVE-2025-48555, CVE-2025-48564, CVE-2025-48565, CVE-2025-48566, CVE-2025-48567, CVE-2025-48572, CVE-2025-48573, CVE-2025-48574, CVE-2025-48575, CVE-2025-48576, CVE-2025-48577, CVE-2025-48578, CVE-2025-48579, CVE-2025-48580, CVE-2025-48582, CVE-2025-48583, CVE-2025-48584, CVE-2025-48585, CVE-2025-48586, CVE-2025-48587, CVE-2025-48589, CVE-2025-48590, CVE-2025-48592, CVE-2025-48594, CVE-2025-48596, CVE-2025-48597, CVE-2025-48598, CVE-2025-48600, CVE-2025-48601, CVE-2025-48602, CVE-2025-48603, CVE-2025-48604, CVE-2025-48605, CVE-2025-48609, CVE-2025-48612, CVE-2025-48614, CVE-2025-48615, CVE-2025-48616, CVE-2025-48617, CVE-2025-48618, CVE-2025-48619, CVE-2025-48620, CVE-2025-48621, CVE-2025-48622, CVE-2025-48626, CVE-2025-48628, CVE-2025-48629, CVE-2025-48630, CVE-2025-48632, CVE-2025-48633, CVE-2025-48634

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2025100900

One of the changes in this release should result in Google Messages RCS working for users receiving a verification error caused by Play Store checking for an emulator with an easy to bypass check. It was already working for many users without this but this should get it working for everyone else.

Tags:

- [2025100900](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025100900) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025100300 release:

- raise security patch level to 2025-10-05 since it's already provided without applying any additional patches
- System Updater, Setup Wizard: integrate support for recommending opting into security preview releases during the initial Owner user setup and for existing users via a persistent notification which is disabled after making an explicit choice on whether to use security preview releases (this is necessary to inform all users about the option with an explicit choice)
- Settings: add support for forcing VoWiFi availability
- Settings: improve the carrier configuration override by improving the summaries, adding detailed descriptions and using clarifying the options force features to be available since there are also toggles for directly enabling/disabling the features in the main SIM settings screen
- Sandboxed Google Play compatibility layer: fix a Google Messages RCS compatibility issue by removing the error string for the missing privileged permission from SurfaceFlinger::doDump() to make a DroidGuard check pass
- Sandboxed Google Play compatibility layer: make Play Store ignore app auto-install config
- Sandboxed Google Play compatibility layer: fix Build.getSerial() shim to fix an Android Auto issue
- Sandboxed Google Play compatibility layer: add stub for TelephonyManager.getImei()
- Sandboxed Google Play compatibility layer: add stub for Window.setHideOverlayWindows() to replace reliance on a feature flag override via GmsCompatConfig
- kernel (6.1): update to latest GKI LTS branch revision including update to 6.1.155
- update test suite to handle our carrier overrides support
- Vanadium: update to [version 141.0.7390.70.0](https://github.com/GrapheneOS/Vanadium/releases/tag/141.0.7390.70.0)
- Camera: update to [version 90](https://github.com/GrapheneOS/Camera/releases/tag/90)

All of the Android 16 security patches from the current November 2025, December 2025 and January 2026 Android Security Bulletins are included in the 2025100901 security preview release. List of additional fixed CVEs:

- Critical: CVE-2025-48593
- High: CVE-2022-25836, CVE-2022-25837, CVE-2023-40130, CVE-2024-43766, CVE-2025-22420, CVE-2025-22432, CVE-2025-32319, CVE-2025-32348, CVE-2025-48525, CVE-2025-48536, CVE-2025-48544, CVE-2025-48555, CVE-2025-48567, CVE-2025-48572, CVE-2025-48573, CVE-2025-48574, CVE-2025-48575, CVE-2025-48576, CVE-2025-48577, CVE-2025-48578, CVE-2025-48579, CVE-2025-48580, CVE-2025-48581, CVE-2025-48582, CVE-2025-48583, CVE-2025-48584, CVE-2025-48585, CVE-2025-48586, CVE-2025-48587, CVE-2025-48589, CVE-2025-48590, CVE-2025-48592, CVE-2025-48594, CVE-2025-48596, CVE-2025-48597, CVE-2025-48598, CVE-2025-48600, CVE-2025-48601, CVE-2025-48602, CVE-2025-48603, CVE-2025-48604, CVE-2025-48605, CVE-2025-48607, CVE-2025-48609, CVE-2025-48612, CVE-2025-48614, CVE-2025-48615, CVE-2025-48616, CVE-2025-48617, CVE-2025-48618, CVE-2025-48619, CVE-2025-48620, CVE-2025-48621, CVE-2025-48622, CVE-2025-48626, CVE-2025-48628, CVE-2025-48629

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2025100300

Tags:

- [2025100300](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025100300) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025092700 release:

- add support for force enabling VoLTE, VoNR and 5G for carriers where those aren't supported with the standard configurations
- revert backport of Pixel Wi-Fi extension APEX from Android 16 QPR1 due to it causing a system\_server crash since it needs changes there too (this does not reduce the patch level)
- kernel (6.1): update to latest GKI LTS branch revision including update to 6.1.154
- kernel (6.6): update to latest GKI LTS branch revision including update to 6.6.108
- kernel (6.12): update to latest GKI LTS branch revision including update to 6.12.49
- update SQLite to 3.44.5 LTS release
- Network Location, System Updater: add new Let's Encrypt roots to TLS key pinning configuration
- GmsCompatConfig: update to [version 162](https://github.com/GrapheneOS/platform_packages_apps_GmsCompat/releases/tag/config-162)
- Camera: update to [version 89](https://github.com/GrapheneOS/Camera/releases/tag/89)

All of the Android 16 security patches from the current November 2025 and December 2025 Android Security Bulletins are included in the 2025100301 security preview release. List of additional fixed CVEs:

- Critical: CVE-2025-48593
- High: CVE-2022-25836, CVE-2022-25837, CVE-2023-40130, CVE-2024-43766, CVE-2025-22420, CVE-2025-22432, CVE-2025-32348, CVE-2025-48525, CVE-2025-48536, CVE-2025-48544, CVE-2025-48555, CVE-2025-48567, CVE-2025-48572, CVE-2025-48573, CVE-2025-48574, CVE-2025-48575, CVE-2025-48576, CVE-2025-48577, CVE-2025-48578, CVE-2025-48579, CVE-2025-48580, CVE-2025-48581, CVE-2025-48582, CVE-2025-48583, CVE-2025-48584, CVE-2025-48585, CVE-2025-48586, CVE-2025-48587, CVE-2025-48589, CVE-2025-48590, CVE-2025-48592, CVE-2025-48594, CVE-2025-48596, CVE-2025-48597, CVE-2025-48598, CVE-2025-48600, CVE-2025-48601, CVE-2025-48602, CVE-2025-48603, CVE-2025-48604, CVE-2025-48605, CVE-2025-48607, CVE-2025-48609, CVE-2025-48611, CVE-2025-48612, CVE-2025-48614, CVE-2025-48615, CVE-2025-48616, CVE-2025-48617, CVE-2025-48618, CVE-2025-48619, CVE-2025-48620, CVE-2025-48621

CVE-2025-48595 was fixed in the regular GrapheneOS 2025100300 release and is no longer listed.

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2025092700

This release adds official support for using RCS in Google Messages. Using this requires granting the Phone permission to Play services to provide carrier information to it, granting the required permissions to Google Messages and then setting Google Messages as the current carrier messaging app. Setting an app as the carrier messaging app provides it with device identifier access which is documented in our FAQ. However, Google Messages is a special case where part of the implementation is in Play services. We've dealt with this by special casing the device identifier permission check to detect when the user has granted this access to the official Google Messages app which then also provides the official Play services app with the same access. This doesn't provide any extra access in practice since Google Messages shares the information with Play services.

Re-enabling RCS after disabling it isn't expected to work yet and you'll need to clear the app data to enable it.

Tags:

- [2025092700](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025092700) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025092500 release:

- add SystemUI and Settings integration for detecting and notifying Pixel 6a users with batteries impacted by the fire hazard issue resulting in capacity and charging being throttled along with directing users to the support options for getting a free battery replacement, $150 credit or $100 cash as compensation for the faulty battery (a subset of this will be replaced by AOSP code when Android 16 QPR1 is finally pushed to AOSP)
- Sandboxed Google Play compatibility layer: add request for the unprivileged `READ_PHONE_NUMBERS` permission to Play services which users can manually grant via the Phone permission since it's needed for RCS activation but is not requested since they request the privileged permission instead
- Sandboxed Google Play compatibility layer: when users have granted device identifier access to the official Google Messages app by setting it as the default SMS/MMS/RCS app
- Vanadium: update to [version 141.0.7390.43.0](https://github.com/GrapheneOS/Vanadium/releases/tag/141.0.7390.43.0)
- Vanadium: update to [version 141.0.7390.43.1](https://github.com/GrapheneOS/Vanadium/releases/tag/141.0.7390.43.1)

All of the Android 16 security patches from the current November 2025 and December 2025 Android Security Bulletins are included in the 2025092701 security preview release. List of additional fixed CVEs:

- Critical: CVE-2025-48593
- High: CVE-2022-25836, CVE-2022-25837, CVE-2023-40130, CVE-2024-43766, CVE-2025-22420, CVE-2025-22432, CVE-2025-32348, CVE-2025-48525, CVE-2025-48536, CVE-2025-48544, CVE-2025-48555, CVE-2025-48567, CVE-2025-48572, CVE-2025-48573, CVE-2025-48574, CVE-2025-48575, CVE-2025-48576, CVE-2025-48577, CVE-2025-48578, CVE-2025-48579, CVE-2025-48580, CVE-2025-48581, CVE-2025-48582, CVE-2025-48583, CVE-2025-48584, CVE-2025-48585, CVE-2025-48586, CVE-2025-48587, CVE-2025-48589, CVE-2025-48590, CVE-2025-48592, CVE-2025-48594, CVE-2025-48595, CVE-2025-48596, CVE-2025-48597, CVE-2025-48598, CVE-2025-48600, CVE-2025-48601, CVE-2025-48602, CVE-2025-48603, CVE-2025-48604, CVE-2025-48605, CVE-2025-48607, CVE-2025-48609, CVE-2025-48611, CVE-2025-48612, CVE-2025-48614, CVE-2025-48615, CVE-2025-48616, CVE-2025-48617, CVE-2025-48618, CVE-2025-48619, CVE-2025-48620, CVE-2025-48621

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2025092500

Tags:

- [2025092500](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025092500) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025091900 release:

- System Updater: add support for opting into security preview releases
- backport more cellular related code from Android 16 QPR1
- backport Pixel Wi-Fi extension APEX from Android 16 QPR1
- Vanadium: update to [version 140.0.7339.207.0](https://github.com/GrapheneOS/Vanadium/releases/tag/140.0.7339.207.0)

All of the Android 16 security patches from the current November 2025 and December 2025 Android Security Bulletins are included in the 2025092501 security preview release. List of additional fixed CVEs:

- Critical: CVE-2025-48593
- High: CVE-2022-25836, CVE-2022-25837, CVE-2023-40130, CVE-2024-43766, CVE-2025-22420, CVE-2025-22432, CVE-2025-32348, CVE-2025-48525, CVE-2025-48536, CVE-2025-48544, CVE-2025-48555, CVE-2025-48567, CVE-2025-48572, CVE-2025-48573, CVE-2025-48574, CVE-2025-48575, CVE-2025-48576, CVE-2025-48577, CVE-2025-48578, CVE-2025-48579, CVE-2025-48580, CVE-2025-48581, CVE-2025-48582, CVE-2025-48583, CVE-2025-48584, CVE-2025-48585, CVE-2025-48586, CVE-2025-48587, CVE-2025-48589, CVE-2025-48590, CVE-2025-48592, CVE-2025-48594, CVE-2025-48595, CVE-2025-48596, CVE-2025-48597, CVE-2025-48598, CVE-2025-48600, CVE-2025-48601, CVE-2025-48602, CVE-2025-48603, CVE-2025-48604, CVE-2025-48605, CVE-2025-48607, CVE-2025-48609, CVE-2025-48611, CVE-2025-48612, CVE-2025-48614, CVE-2025-48615, CVE-2025-48616, CVE-2025-48617, CVE-2025-48618, CVE-2025-48619, CVE-2025-48620, CVE-2025-48621

For detailed information on security preview releases, see our [post about it](https://discuss.grapheneos.org/d/27068-grapheneos-security-preview-releases).

### 2025091900

Tags:

- [2025091900](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025091900) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025091000 release:

- backport latest carrier and cellular radio configurations from Android 16 QPR1
- kernel (6.1): update to latest GKI LTS branch revision including update to 6.1.152
- kernel (6.6): update to latest GKI LTS branch revision including update to 6.6.104
- kernel (6.12): update to latest GKI LTS branch revision including update to 6.12.47
- kernel (6.6): prepare for usage on bare metal arm64 devices by setting up arm64 emulator builds (Pixel 10 uses 6.6 and earlier Pixels will likely move to it soon)
- Vanadium: update to [version 140.0.7339.155.0](https://github.com/GrapheneOS/Vanadium/releases/tag/140.0.7339.155.0)

### 2025091000

Tags:

- [2025091000](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025091000) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025090800 release:

- full 2025-10-01 security patch level
- partially backport Android 16 QPR1 Pixel userspace device support: RIL, eSIM, TPU and NeuralNetworks (deprecated)
- kernel (6.1): roll back recent upstream Android GKI dma-buf changes due to a few MTE crash reports
- kernel (6.1, 6.6, 6.12): disable unused memory hotplug support
- kernel (6.1, 6.6, 6.12): fix linear region randomization by dropping memory hotplug support (see [the Project Zero issue](https://project-zero.issues.chromium.org/issues/434208461) where the upstream Linux maintainers decided not to fix the issue)
- kernel (6.1): update to latest GKI LTS branch revision
- kernel (6.6): update to latest GKI LTS branch revision
- kernel (6.12): update to latest GKI LTS branch revision including update to 6.12.45
- Vanadium: update to [version 140.0.7339.123.0](https://github.com/GrapheneOS/Vanadium/releases/tag/140.0.7339.123.0)

### 2025090800

Tags:

- [2025090800](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025090800) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025090600 release:

- backport the rest of the Android 16 QPR1 Pixel firmware (Bluetooth, Wi-Fi, GNSS, UWB, NFC, secure element, GPU, AOC, TPU and GXP)

### 2025090600

Tags:

- [2025090600](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025090600) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025090500 release:

- Pixel Tablet: fix regression for install zips in the previous release causing a version check for non-existent cellular baseband firmware to fail when doing the initial installation
- add back Git commit metadata for the kernel image and modules by setting an environment variable to use the repo metadata from the Pixel kernel tarballs

### 2025090500

Tags:

- [2025090500](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025090500) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025090300 release:

- move to new monolithic Pixel kernel repository setup with a single repository for Pixels and our portable Generic Kernel Image repository as a submodule to more easily handle Pixel kernel sources being released as tarballs instead of Git tags (Git metadata for the kernel image and modules will be added back in the next release)
- update to Android 16 QPR1 kernel drivers and kernel build system to ship the security patches prior to Android 16 QPR1 being released to AOSP
- update Pixel SoC and cellular radio firmware to the Android 16 QPR1 releases to ship the security patches prior to Android 16 QPR1 being released to AOSP
- kernel (6.12): update to latest GKI LTS branch revision
- App Store: update to [version 32](https://github.com/GrapheneOS/Apps/releases/tag/32)
- App Store: update to [version 33](https://github.com/GrapheneOS/Apps/releases/tag/33)
- Vanadium: update to [version 140.0.7339.51.0](https://github.com/GrapheneOS/Vanadium/releases/tag/140.0.7339.51.0)

### 2025090300

Tags:

- [2025090300](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025090300) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025090200 release:

- Sandboxed Google Play compatibility layer: add stub for Debug.dumpService("media\_projection") to fix a recent regression caused by a Google Play Store behavior change yesterday which was breaking using the Play Integrity API and therefore slightly reducing app compatibility

### 2025090200

This is an early September security update release based on the September 2025 security patch backports since the quarterly Android Open Source Project and stock Pixel OS release scheduled for this month hasn't been published yet.

Tags:

- [2025090200](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025090200) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025081400 release:

- full 2025-09-01 security patch level
- add support for address lines in the GrapheneOS geocoder implementation
- Dialer: fix visual voicemail with Verizon MVNOs by working around AOSP Dialer not supporting vvm\_type\_vvm3\_mvno
- kernel (6.1): update to latest GKI LTS branch revision including update to 6.1.148
- kernel (6.1): reapply minor f2fs change we previously reverted due to it causing a regression since the stock Pixel OS has shipped it a while ago so the regression must have been fixed by other changes
- kernel (6.6): update to latest GKI LTS branch revision including update to 6.6.102
- kernel (6.12): update to latest GKI LTS branch revision including update to 6.12.42
- adevtool: massive overhaul to improve our infrastructure for device support
- adevtool: add command for extracting aconfig flag values from device images
- adevtool: add command for decompiling APKs and JARs from device images and creating an IntelliJ project from it
- adevtool: detect missing vendor regeneration after adevtool changes
- adevtool: parallelize state regeneration and remove unnecessary data from serialized build state files
- Theme Picker: use AOSP launcher name for fetching resources in preparation for Android 16 QPR1 requiring this to be set up properly
- Settings: prepare PIN scrambling setting for the upcoming port to Android 16 QPR1
- Seedvault: update to 16-5.7 (there are no changes to the code compared to the Android 16 development revision we previously shipped, only translation changes)
- GmsCompatConfig: update to [version 161](https://github.com/GrapheneOS/platform_packages_apps_GmsCompat/releases/tag/config-161)
- Vanadium: update to [version 139.0.7258.158.0](https://github.com/GrapheneOS/Vanadium/releases/tag/139.0.7258.158.0)
- Vanadium: update to [version 140.0.7339.35.0](https://github.com/GrapheneOS/Vanadium/releases/tag/140.0.7339.35.0)
- Camera: update to [version 87](https://github.com/GrapheneOS/Camera/releases/tag/87)
- Camera: update to [version 88](https://github.com/GrapheneOS/Camera/releases/tag/88)
- App Store: update to [version 31](https://github.com/GrapheneOS/Apps/releases/tag/31)
- PDF Viewer: update to [version 31](https://github.com/GrapheneOS/PdfViewer/releases/tag/31)

### 2025081400

Tags:

- [2025081400](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025081400) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025081300 release:

- temporarily revert extended fix for upstream MediaMetadata bug due to it causing a regression and needing to be adjusted
- Camera: update to [version 86](https://github.com/GrapheneOS/Camera/releases/tag/86)

### 2025081300

Tags:

- [2025081300](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025081300) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025080600 release:

- limit MediaMetadata object size to avoid Binder failures to resolve the rest of an upstream Android denial of service issue triggered in real world use by LibreTube (this extends our previous fix in our [2025072700](https://grapheneos.org/releases#2025072700) release)
- reduce time update threshold to 50ms from Android's default 2000ms instead of allowing the clock to get up to 2s out-of-date (this change was lost during one of the major release ports when Android significantly changed the code and moved where this is configured)
- Pixel 8a: fix inclusion of PSDS overlay since our port to Android 16 which was breaking using our PSDS proxy until we worked around it server-side with a redirect from broadcom.psds.grapheneos.org to samsung.psds.grapheneos.org for the Samsung PSDS download path
- Samsung GNSS devices (Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a): switch to TLSv1.3-only for SUPL instead of TLSv1.2-only now that it's supported by gnssd
- change User-Agent for geocoder to "GrapheneOS geocoder $USER\_AGENT\_VERSION" where the version is currently 1 and can be incremented if there are significant changes to how we make requests (this was previously using the default Android User-Agent sending more information than necessary)
- kernel (6.6): update to latest GKI LTS branch revision including update to 6.6.101
- Seedvault: update to latest revision for Android 16 (will be replaced with a better backup implementation in the future)
- Camera: update to [version 84](https://github.com/GrapheneOS/Camera/releases/tag/84)
- Camera: update to [version 85](https://github.com/GrapheneOS/Camera/releases/tag/85)
- Info: update to [version 6](https://github.com/GrapheneOS/Info/releases/tag/6)
- Vanadium: update to [version 139.0.7258.123.0](https://github.com/GrapheneOS/Vanadium/releases/tag/139.0.7258.123.0)

### 2025080600

Tags:

- [2025080600](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025080600) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025080400 release:

- full 2025-08-05 security patch level
- apply the only change not related to the Pixel 6a battery workaround from the August 2025 Pixel kernel drivers obtained via GPL source request
- update to August 2025 Pixel vendor/firmware code
- Messaging: update to [version 12](https://github.com/GrapheneOS/Messaging/releases/tag/12)

### 2025080400

This is an early August security update release based on the August 2025 security patch backports since the monthly Android Open Source Project and stock Pixel OS release scheduled for this month hasn't been published yet.

Android Security Bulletin tags have not yet been pushed to the Android Open Source Project this month but we've had access to the signed partner bulletin zip with the same patches for a month. There are only 3 patches in the August 2025-08-01 bulletin and one of those doesn't impact Android 16. Of the 2 marked as impacting Android 16, the critical severity issue was already fixed in the initial Android 16 release. Therefore, there's only a single High severity patch to Android 16 for the Android Open Source Project for August.

Tags:

- [2025080400](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025080400) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025073000 release:

- full 2025-08-01 security patch level
- add opt-in service for geocoding (translating location names to coordinates) and reverse geocoding (translating coordinations to location names) with the option of either a GrapheneOS proxy to Nomanatim or direct use of Nominatim which will improve compatibility with a tiny subset of apps depending on the OS providing this without an alternative (the service is open source with open data so our proxy is temporary and will be replaced with a self-hosted service, but we need to determine if we want to use Nominatim or Photon along with dealing with the high hardware requirements far beyond what our current network servers can provide)
- add a workaround for bug in sonycast.sdk.ScMediaRouteProvider used by Tidal and other apps causing occasional NsdService related crashes in combination with VPN lockdown due to us fixing NsdService related VPN leaks
- override pseudo locales with their respective base locales in the Android Runtime since they're currently broken and break using the device (we already disabled enabling pseudo locales in the previous release but a couple users enabled this developer option and need a release fixing it to use their device)
- kernel (6.1): update to latest GKI LTS branch revision including update to 6.1.147
- kernel (6.6): update to latest GKI LTS branch revision including update to 6.6.100
- Vanadium: update to [version 139.0.7258.62.0](https://github.com/GrapheneOS/Vanadium/releases/tag/139.0.7258.62.0)
- Vanadium: update to [version 139.0.7258.62.1](https://github.com/GrapheneOS/Vanadium/releases/tag/139.0.7258.62.1)

### 2025073000

Tags:

- [2025073000](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025073000) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025072800 release:

- extend our workaround for the upstream Android asynchronous dexopt optimization issue to handle original-package package renaming which we used to rename Vanadium's package name from org.chromium.chrome to app.vanadium.browser years ago and users on 6th gen Pixels with installs prior to it could have a crash caused by our fix for the upstream issue
- add a temporary workaround for AOSP Dialer still using a legacy approach to notifications which interacts badly with notification grouping
- remove support for switching to a pseudo-locale when developer options are enabled since it can cause major issues
- Sandboxed Google Play compatibility layer: add stub for BluetoothDevice.getBondState() to avoid Android Auto crash
- Settings: fix upstream Android null pointer exception in UserAspectRatioDetails.launchApplication()
- System Updater: update minimum and target API level to 36 (Android 16)

### 2025072800

Tags:

- [2025072800](https://github.com/GrapheneOS/platform_manifest/releases/tag/2025072800) (Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a, Pixel Tablet, Pixel Fold, Pixel 8, Pixel 8 Pro, Pixel 8a, Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL, Pixel 9 Pro Fold, Pixel 9a, emulator, generic, other targets)

Changes since the 2025072700 release:

- add missing multi-user handling to the package information query used by both of the new VPN leak protections which was discovered during Alpha channel testing from app crashes in secondary users for apps not installed in the Owner user
- fix implementation of INsdServiceConnector stub used as part of our NsdService#connect VPN leak protection to avoid an edge case resulting in app crashes found during Alpha channel testing
- include additional overlays from the stock Pixel OS for Settings animations and Settings/SystemUI strings mostly related to documentation

### 2025072700

This release resolves 2 upstream Android VPN leaks discovered by GrapheneOS and our community testers. We aren't aware of any other outbound Android VPN leaks when Private DNS is set to Off. Android's Private DNS feature needs a significant overhaul for how it works w

[truncated]
