#!/usr/bin/env python3
"""Build the LineageOS official support matrix. Stdlib only (needs git on PATH).
Run: python3 -I collect.py   (re-clones into raw/, rewrites devices.csv/json, branches.csv, install-methods.md, meta.json)
Wiki data: CC BY-SA (LineageOS/lineage_wiki). Facts only are extracted."""
import csv, glob, json, os, re, subprocess, shutil, datetime, collections, sys
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
REPOS = {"wiki": "https://github.com/LineageOS/lineage_wiki", "hudson": "https://github.com/LineageOS/hudson"}
# LineageOS version -> Android version (24.0 inferred: Pixel 7 'panther' wiki entry ships Android 17 fw for 24.0)
ANDROID = {"13.0": "6.0", "14.1": "7.1", "15.1": "8.1", "16.0": "9", "17.1": "10", "18.1": "11", "19.1": "12",
           "20": "13", "21": "14", "22.1": "15", "22.2": "15 (QPR2)", "23.0": "16", "23.2": "16 (QPR2)", "24.0": "17"}
# install_method -> (flow description, template path). Derived from reading templates in lineage_wiki.
T = "_includes/templates/recovery_install_%s.md"
FASTBOOT_TAIL = "then boot to fastboot, flash recovery ('fastboot flash <recovery_partition_name>' or 'fastboot boot' if needs_fastboot_boot), reboot to recovery, adb sideload LineageOS zip"
DESC = {
 "fastboot_generic": "Bootloader assumed already unlockable/unlocked (shared tail template); " + FASTBOOT_TAIL,
 "fastboot_unlocked": "Bootloader already unlocked, no unlock step; " + FASTBOOT_TAIL,
 "fastboot_nexus": "Generic Google/AOSP-style (also used by OnePlus, Pixels, many others): enable OEM unlock, 'fastboot oem unlock' per template, " + FASTBOOT_TAIL,
 "fastboot_custom": "Vendor-specific unlock guide (device.unlock_bootloader_guide link), then generic fastboot recovery + sideload",
 "fastboot_fairphone": "Unlock per Fairphone support page, then generic fastboot recovery + sideload",
 "fastboot_motorola": "Request unlock code from Motorola, 'fastboot oem unlock <code>', then generic fastboot recovery + sideload",
 "fastboot_sony": "Unlock code from Sony developer site, 'fastboot oem unlock <code>' (pre-2017 devices lose DRM keys/TA), then generic fastboot recovery + sideload",
 "fastboot_xiaomi": "Mi account + Mi Unlock app on Windows (wait period up to 30 days, 4 unlocks/yr), then generic fastboot recovery + sideload",
 "fastboot_xiaomi_hyperos": "As fastboot_xiaomi plus China-HyperOS unlock-permission exam notes (HyperOS device), then generic fastboot recovery + sideload",
 "fastboot_htc": "'fastboot oem get_identifier_token' -> HTC dev unlock token -> flash unlock bin, then generic fastboot recovery + sideload",
 "fastboot_lenovo": "Lenovo ZUI unlock site or 'fastboot oem unlock'/'flash unlock sn.img', then generic fastboot recovery + sideload",
 "fastboot_oppo": "Oppo unlock via Project Spectrum / unlockable bootloader files, 'fastboot oem unlock', then generic fastboot recovery + sideload",
 "fastboot_realme": "Template shows a 'bootloader not unlockable' alert (no unlock steps), then generic fastboot recovery + sideload",
 "fastboot_realme_china": "Chinese Realme: 'Deep Testing' unlock permission (slots, 7-day validity), 'fastboot flashing unlock', then generic fastboot recovery + sideload",
 "fastboot_oplus": "Chinese OnePlus/Oplus: permission thread then the fastboot_nexus unlock + generic recovery + sideload",
 "fastboot_oneplus_tmo": "OnePlus T-Mobile variants: carrier-specific unlock steps (see template) then generic fastboot recovery + sideload",
 "fastboot_nubia": "Nubia: enable OEM unlock, 'fastboot oem unlock' each bootloader session, then generic fastboot recovery + sideload",
 "fastboot_huawei": "Bootloader must already be unlockable (Huawei no longer issues codes); latest official EMUI advised; generic fastboot recovery + sideload",
 "fastboot_lg": "Bootloader must already be unlockable (alert); generic fastboot recovery + sideload",
 "fastboot_nokia": "Bootloader must already be unlockable (alert); generic fastboot recovery + sideload",
 "fastboot_zenfone": "Asus Zenfone: bootloader must already be unlockable (alert); generic fastboot recovery + sideload",
 "fastboot_zte": "ZTE: bootloader must already be unlockable (alert); generic fastboot recovery + sideload",
 "samloader_rs": "Samsung Download mode + samloader-rs ('samloader flash --partition RECOVERY ... --no-reboot'), OEM unlock toggle first, then recovery + adb sideload",
 "dd": "Root stock first (kingroot/custom), then 'dd' recovery image from /sdcard to the recovery partition (_a/_b on A/B), reboot to recovery, sideload",
 "oor": "Root stock, dd the aboot/recovery images via su (Oppo/OnePlus 'oor' flow), reboot to recovery, sideload",
 "edl_custom": "Qualcomm EDL (Emergency Download) flashing of a custom recovery with 'edl' tool, then recovery + sideload",
 "apx": "NVIDIA Tegra RCM/APX mode: Tegraflash flash package from download.lineageos.org (Linux, not in VM), then boot recovery and sideload",
 "amlogic_update": "Amlogic Burn Mode via aml-flash-tool: flash aml_install_package.img to eMMC (SD-only not supported)",
 "nintendo": "Nintendo Switch: exploitable v1 via RCM jig + Hekate, or modded Switch; install to SD card or eMMC from Hekate boot menu (not Android recovery)",
}

def sh(*a, cwd=None): return subprocess.run(a, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()

def fetch():
    os.makedirs(RAW, exist_ok=True)
    open(os.path.join(RAW, ".gitignore"), "w").write("*\n")
    shas = {}
    for n, url in REPOS.items():
        d = os.path.join(RAW, n)
        if os.path.isdir(d): shutil.rmtree(d)
        sh("git", "clone", "-q", "--depth", "1", url, d)
        shas[n] = sh("git", "rev-parse", "HEAD", cwd=d)
    return shas

def flow(s):
    """Parse a YAML flow value ([..], {..}, scalars) well enough for the wiki data."""
    s = s.strip(); i = 0
    def ws():
        nonlocal i
        while i < len(s) and s[i] in " \t": i += 1
    def val(stop):
        nonlocal i
        ws()
        if i >= len(s): return ""
        c = s[i]
        if c == "[":
            i += 1; out = []
            while True:
                ws()
                if i >= len(s): return out
                if s[i] == "]": i += 1; return out
                out.append(val(",]")); ws()
                if i < len(s) and s[i] == ",": i += 1
        if c == "{":
            i += 1; out = {}
            while True:
                ws()
                if i >= len(s): return out
                if s[i] == "}": i += 1; return out
                k = val(":,}"); ws()
                if i < len(s) and s[i] == ":": i += 1; out[k] = val(",}")
                else: out[k] = None
                ws()
                if i < len(s) and s[i] == ",": i += 1
        if c in "'\"":
            q = c; i += 1; b = ""
            while i < len(s):
                if s[i] == q:
                    if q == "'" and s[i+1:i+2] == "'": b += "'"; i += 2; continue
                    i += 1; break
                b += s[i]; i += 1
            return b
        b = ""
        while i < len(s) and s[i] not in stop: b += s[i]; i += 1
        b = b.strip()
        if b in ("true", "True"): return True
        if b in ("false", "False"): return False
        if b in ("None", "null", "~"): return None
        return b
    return val("")

def load(path):
    d, key, buf = {}, None, []
    def done():
        if key is None: return
        raw = buf[0].strip() if buf else ""
        if re.fullmatch(r"[>|][+-]?", raw): d[key] = " ".join(x.strip() for x in buf[1:]).strip()
        elif raw == "": d[key] = None  # block list/mapping: not needed
        else:
            try: d[key] = flow(" ".join(x.strip() for x in buf))
            except Exception: d[key] = raw
    for ln in open(path, encoding="utf-8"):
        ln = ln.rstrip("\n")
        if not ln.strip() or ln.lstrip().startswith("#"): continue
        m = re.match(r"([A-Za-z0-9_]+):\s?(.*)$", ln)
        if m and not ln[0].isspace(): done(); key, buf = m.group(1), [m.group(2)]
        elif key: buf.append(ln)
    done(); return d

def txt(v, n=240):
    if v is None or v is False: return ""
    if isinstance(v, dict): v = "; ".join(f"{k}={','.join(map(str, x)) if isinstance(x, list) else x}" for k, x in v.items())
    if isinstance(v, list): v = ",".join(map(str, v))
    v = re.sub(r"<[^>]+>", "", str(v)); v = re.sub(r"\s+", " ", v).strip()
    return v[:n]

def main():
    shas = fetch()
    today = datetime.date.today().isoformat()
    # build targets
    built = {}
    for ln in open(os.path.join(RAW, "hudson/lineage-build-targets")):
        p = ln.split()
        if len(p) == 4 and not ln.startswith("#"): built[p[0]] = (p[2].replace("lineage-", ""), p[3])
    upd = json.load(open(os.path.join(RAW, "hudson/updater/devices.json")))
    upd_models = {x["model"] for x in upd}
    rows = []
    for f in sorted(glob.glob(os.path.join(RAW, "wiki/_data/devices/*.yml"))):
        y = load(f); cn = y.get("codename") or os.path.basename(f)[:-4]
        vers = [str(v) for v in (y.get("versions") or [])]
        mt = y.get("maintainers") or []
        fw = []
        for k in ("before_install", "before_recovery_install", "before_lineage_install", "firmware_update", "required_bootloader", "format_on_upgrade"):
            if y.get(k): fw.append(f"{k}: {txt(y[k], 120)}")
        b = built.get(cn)
        rows.append({
            "wiki_id": os.path.basename(f)[:-4], "codename": cn, "vendor": y.get("vendor", ""), "name": y.get("name", ""),
            "models": ";".join(y.get("models") or []), "versions": ";".join(vers),
            "current_branch": str(y.get("current_branch") or ""),
            "built_now": b is not None, "built_branch": b[0] if b else "", "build_period": b[1] if b else "",
            "in_updater_devices_json": cn in upd_models,
            "maintained": bool(mt), "maintainers": ";".join(mt),
            "install_method": y.get("install_method", ""), "is_ab_device": bool(y.get("is_ab_device")),
            "recovery_partition_name": txt(y.get("recovery_partition_name")), "recovery_partition": txt(y.get("recovery_partition")),
            "uses_twrp": bool(y.get("uses_twrp")), "needs_fastboot_boot": bool(y.get("needs_fastboot_boot")),
            "is_unlockable": "" if y.get("is_unlockable") is None else y["is_unlockable"],
            "recovery_boot": txt(y.get("recovery_boot"), 160), "download_boot": txt(y.get("download_boot"), 160),
            "prerequisites": " | ".join(fw), "soc": txt(y.get("soc")), "release": txt(y.get("release")),
            "kernel_version": txt((y.get("kernel") or {}).get("version") if isinstance(y.get("kernel"), dict) else ""),
            "variant": txt(y.get("variant")), "carrier": txt(y.get("carrier")),
        })
    assert rows and all(r["codename"] for r in rows)
    flds = list(rows[0])
    with open(os.path.join(HERE, "devices.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, flds); w.writeheader(); w.writerows(rows)
    for r in rows:
        r["models"] = r["models"].split(";") if r["models"] else []
        r["versions"] = r["versions"].split(";") if r["versions"] else []
    json.dump({"fetched": today, "commits": shas, "devices": rows}, open(os.path.join(HERE, "devices.json"), "w"), indent=1)
    # branches
    # count unique codenames (several wiki pages share one codename, e.g. variants)
    ever_s, now_s = collections.defaultdict(set), collections.defaultdict(set)
    for r in rows:
        for v in r["versions"]: ever_s[v].add(r["codename"])
        if r["built_now"]: now_s[r["built_branch"]].add(r["codename"])
    ever = collections.Counter({k: len(v) for k, v in ever_s.items()}); now = collections.Counter({k: len(v) for k, v in now_s.items()})
    vs = sorted(set(ever) | set(now) | set(ANDROID), key=lambda v: float(v))
    with open(os.path.join(HERE, "branches.csv"), "w", newline="") as fh:
        w = csv.writer(fh); w.writerow(["lineage_version", "android_version", "codenames_ever", "codenames_built_now"])
        for v in vs: w.writerow([v, ANDROID.get(v, "?"), ever[v], now[v]])
    # install methods
    im = collections.Counter(r["install_method"] for r in rows)
    with open(os.path.join(HERE, "install-methods.md"), "w") as fh:
        fh.write(f"# LineageOS install methods\n\nSource: LineageOS/lineage_wiki @ {shas['wiki'][:12]}, fetched {today}. Flow text is a paraphrase of the template, CC BY-SA.\n"
                 "Common tail of all fastboot_* methods: `_includes/templates/recovery_install_fastboot_generic.md`; overall page: `_includes/templates/device_install.md`.\n\n"
                 "| install_method | devices | flow | source template |\n|---|---|---|---|\n")
        for m, c in im.most_common():
            fh.write(f"| `{m}` | {c} | {DESC.get(m, 'UNDESCRIBED')} | `{T % m}` |\n")
    json.dump({"fetched": today, "commits": shas, "built_targets": len(built), "updater_devices": len(upd)}, open(os.path.join(HERE, "meta.json"), "w"), indent=1)
    print(len(rows), "devices", shas, "built", len(built), file=sys.stderr)
    miss = [m for m in im if m not in DESC]
    if miss: print("UNDESCRIBED", miss, file=sys.stderr)

if __name__ == "__main__": main()
