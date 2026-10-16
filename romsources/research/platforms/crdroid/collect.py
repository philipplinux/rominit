#!/usr/bin/env python3 -I
"""Build the crDroid official support matrix. Stdlib only (+ git binary).

Sources (facts only):
  1. github.com/crdroidandroid/android_vendor_crDroidOTA, one branch per Android version,
     <codename>.json = latest OTA entry (maintainer, version, date, recovery/firmware links, ...)
  2. https://crdroid.net/downloads  (device cards: OEM, name, crDroid versions offered, last build)
  3. https://crdroid.net/<codename>/<major>/install  (latest version only; reduced to flash-step tags)
Run:  python3 -I collect.py [--refresh]
Outputs next to this file: devices.csv devices.json branches.csv catalog_map.csv meta.json
"""
import csv, datetime, glob, html, json, os, re, subprocess, sys, time, urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
OTA = "https://github.com/crdroidandroid/android_vendor_crDroidOTA.git"
SITE = "https://crdroid.net"
TODAY = datetime.date.today()
CUTOFF = TODAY - datetime.timedelta(days=183)
REFRESH = "--refresh" in sys.argv
GIT = os.path.join(RAW, "ota.git")
ANDROID_NAME = {"7.1": "Nougat", "8.0": "Oreo", "8.1": "Oreo", "9.0": "Pie", "10.0": "10", "11.0": "11", "12.0": "12",
                "12.1": "12L", "13.0": "13", "14.0": "14", "15.0": "15", "16.0": "16", "17.0": "17"}


def get(url, path):
    p = os.path.join(RAW, path)
    if os.path.exists(p) and not REFRESH:
        return open(p, "rb").read()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    err = None
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "rominit-research/1"})
            data = urllib.request.urlopen(req, timeout=60).read()
            open(p, "wb").write(data)
            return data
        except Exception as e:
            err = e
            if getattr(e, "code", None) == 404:
                return b""
            time.sleep(2 * (i + 1))
    print("FAILED", url, err, file=sys.stderr)
    return b""


def git(*a):
    return subprocess.run(["git", "-C", GIT, *a], capture_output=True, text=True, check=True).stdout


def parse_xml(text, branch):
    """{codename: build dict} from the old OTA xml layouts (<Z00L><maintainer>.. or SlimOTA <Z00L><Filename>..)."""
    out, man = {}, None
    for m in re.finditer(r'<manufacturer id="([^"]*)"|<!--\s*([^<>]*?)\s*-->|<([A-Za-z0-9_\-]+)>\s*(?:<maintainer>|<Filename>|<devicename>)(.*?)</\3>', text, re.S):
        if m.group(1) is not None: man = m.group(1); continue
        if m.group(2) is not None:
            man = m.group(2) if m.group(2).isupper() and len(m.group(2)) < 30 else man; continue
        cn, body = m.group(3), m.group(4)
        full = m.group(0)
        fn = re.search(r"<[Ff]ilename>([^<]*)<", full); fn = fn.group(1).strip() if fn else ""
        d = re.search(r"-(\d{8})-", fn); v = re.search(r"-v(\d+(?:\.\d+)*)", fn)
        tag = lambda t: (re.search(rf"<{t}>([^<]*)<", full) or [None, ""])[1].strip()
        out[cn] = {"branch": branch, "android": ANDROID_NAME.get(branch, branch),
                   "version": v.group(1) if v else None, "date": f"{d.group(1)[:4]}-{d.group(1)[4:6]}-{d.group(1)[6:]}" if d else "",
                   "sdk": None, "patch": None, "buildtype": tag("buildtype") or ("Stable" if "devices.xml" in full else ""),
                   "maintainer": tag("maintainer") or None, "oem": (man.title() if len(man) > 3 else man) if man and man.isupper() else man, "name": tag("devicename") or None,
                   "recovery": "", "firmware": "", "modem": "", "bootloader": "", "forum": tag("forum"), "dt": "", "common_dt": "", "kernel": "",
                   "sha256": "", "size": None, "filename": fn}
    return out


def vkey(s):
    return [int(x) for x in re.findall(r"\d+", s)]


def install_tags(text):
    t = text.lower()
    tags = []
    for tag, pat in [("odin", r"\bodin\b"), ("heimdall", r"heimdall"), ("download_mode", r"download mode"),
                     ("fastboot_flash_boot", r"fastboot flash boot\b"), ("fastboot_flash_init_boot", r"flash init_boot"),
                     ("fastboot_flash_vendor_boot", r"flash vendor_boot"), ("fastboot_flash_dtbo", r"flash dtbo"),
                     ("fastboot_flash_recovery", r"fastboot flash recovery"), ("fastboot_flash_other", r"fastboot flash (?!boot|dtbo|vendor_boot|init_boot|recovery)\w+"),
                     ("fastboot_boot", r"fastboot boot\b"), ("adb_sideload", r"sideload"), ("twrp", r"twrp"),
                     ("format_data", r"format data|wipe data|factory reset"), ("latest_stock_required", r"latest (available )?stock|latest firmware|stock rom")]:
        if re.search(pat, t):
            tags.append(tag)
    return tags


def main():
    os.makedirs(RAW, exist_ok=True)
    if REFRESH or not os.path.isdir(GIT):
        subprocess.run(["rm", "-rf", GIT]); 
        subprocess.run(["git", "clone", "-q", "--bare", "--no-single-branch", OTA, GIT], check=True)
    branches = sorted([b.strip("* ").strip() for b in git("branch").splitlines()], key=vkey)
    shas = {b: git("rev-parse", b).strip() for b in branches}

    dev = defaultdict(lambda: {"builds": []})
    for b in branches:
        # newest-first history of the branch: first event per <codename>.json decides (D = device dropped from this branch,
        # content then comes from the parent of the deleting commit)
        seen, files = set(), []
        sha = day = None
        for ln in git("log", "--no-renames", "--name-status", "--format=@%H\t%cs", b).splitlines():
            if ln.startswith("@"): sha, day = ln[1:].split("\t"); continue
            if "\t" not in ln: continue
            st, f = ln.split("\t", 1)
            if "/" in f or not f.endswith(".json") or f in seen or "changelog" in f.lower() or f.startswith(".") or ":" in f: continue
            seen.add(f); files.append((f, st, sha, day))
        for f, st, csha, cday in files:
            cn = f[:-5]
            try:
                resp = json.loads(git("show", f"{csha}^:{f}" if st == "D" else f"{b}:{f}"))["response"]
            except Exception as e:
                print("bad json", b, f, e, file=sys.stderr); continue
            for r in resp:
                ts = r.get("timestamp") or 0
                dev[cn]["builds"].append({
                    "branch": b, "android": ANDROID_NAME.get(b, b), "present_in_branch": st != "D", "removed_date": cday if st == "D" else "",
                    "version": r.get("version"), "date": datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).date().isoformat() if ts else "",
                    "sdk": r.get("os_sdk_level"), "patch": r.get("os_patch_level"), "buildtype": (r.get("buildtype") or "").strip(),
                    "maintainer": r.get("maintainer"), "oem": r.get("oem"), "name": r.get("device"),
                    "recovery": r.get("recovery") or "", "firmware": r.get("firmware") or "", "modem": r.get("modem") or "",
                    "bootloader": r.get("bootloader") or "", "forum": r.get("forum") or "", "dt": r.get("dt") or "",
                    "common_dt": r.get("common-dt") or "", "kernel": r.get("kernel") or "",
                    "sha256": r.get("sha256") or "", "size": r.get("size"), "filename": r.get("filename")})

    # Android 7.1-9.0 branches have no JSON: devices.xml / update.xml, walk every revision (newest first wins)
    for b in branches:
        xf = next((x for x in ("devices.xml", "update.xml") if git("ls-tree", "--name-only", b, x).strip()), None)
        if not xf: continue
        tip = set(parse_xml(git("show", f"{b}:{xf}"), b))
        got = {}
        for ln in git("log", "--format=%H\t%cs", b, "--", xf).splitlines():
            h, day = ln.split("\t")
            try: rev = parse_xml(git("show", f"{h}:{xf}"), b)
            except subprocess.CalledProcessError: continue
            for cn, rec in rev.items():
                if cn not in got: got[cn] = (rec, day)
        for cn, (rec, day) in got.items():
            rec.update({"present_in_branch": cn in tip, "removed_date": "" if cn in tip else day})
            dev[cn]["builds"].append(rec)

    # site cards
    page = get(f"{SITE}/downloads", "downloads.html").decode("utf-8", "replace")
    site, oem = {}, None
    for m in re.finditer(r"<div id='([^']+)' class='oem[^']*'><h1>.*?</i>([^<]+)<i|<div class='card border-secondary shadow' id='([^']+)'>(.*?)<div class='card-footer text-muted'>([^<]*)</div>", page, re.S):
        if m.group(1):
            oem = html.unescape(m.group(2)); continue
        cn, body, foot = m.group(3), m.group(4), m.group(5)
        nm = re.search(r"devicename'>([^<]*)<", body)
        vs = re.findall(r"href='[^']+/(\d+(?:\.\d+)?)'>crDroid [^|]*\| Android ([^<]*)<", body)
        d = re.search(r"(\d{4}-\d{2}-\d{2})", foot)
        site[cn] = {"oem": oem, "name": html.unescape(nm.group(1)).strip() if nm else "", "versions": vs, "last_build": d.group(1) if d else ""}

    # install pages for newest crDroid major of each device
    def latest_major(cn):
        b = max(dev[cn]["builds"], key=lambda x: (x["date"], vkey(x["branch"])))
        return str(b["version"]).split(".")[0]
    need = sorted(set(dev) | set(site), key=str.lower)
    def fetch_install(cn):
        if cn in dev: mj = latest_major(cn)
        elif site[cn]["versions"]: mj = site[cn]["versions"][0][0].split(".")[0]
        else: return cn, "", None
        raw = get(f"{SITE}/{cn}/{mj}/install", f"install/{cn}-{mj}.html").decode("utf-8", "replace")
        i = raw.find("Flashing instructions")
        txt = re.sub(r"<[^>]+>", " ", re.sub(r"<script.*?</script>", "", raw[i:] if i >= 0 else "", flags=re.S))
        return cn, mj, install_tags(html.unescape(txt)) if i >= 0 else None
    with ThreadPoolExecutor(6) as ex:
        inst = {cn: (mj, tg) for cn, mj, tg in ex.map(fetch_install, need)}

    rows = []
    for cn in need:
        bl = sorted(dev[cn]["builds"], key=lambda x: vkey(x["branch"]), reverse=True) if cn in dev else []
        s = site.get(cn, {})
        newest = max(bl, key=lambda x: x["date"]) if bl else None
        latest = max([x["date"] for x in bl] + ([s["last_build"]] if s.get("last_build") else []) or [""])
        mj, tags = inst.get(cn, ("", None))
        rec = sorted({x["recovery"] for x in bl if x["recovery"]})
        rows.append({
            "codename": cn, "vendor": (newest or {}).get("oem") or s.get("oem"), "name": (newest or {}).get("name") or s.get("name"),
            "in_ota_repo": cn in dev, "in_tip": any(x["present_in_branch"] for x in bl), "on_website": cn in site,
            "branches": [x["branch"] for x in bl],
            "crdroid_versions": sorted({str(x["version"]) for x in bl}, key=vkey, reverse=True),
            "site_versions": [f"{v}|Android {a}" for v, a in s.get("versions", [])],
            "removed_branches": [x["branch"] for x in bl if not x["present_in_branch"]],
            "latest_build_date": latest, "active_6mo": latest >= CUTOFF.isoformat() if latest else False,
            "maintained": latest >= CUTOFF.isoformat() if latest else False, "legacy": not (latest >= CUTOFF.isoformat() if latest else False),
            "latest_branch": newest["branch"] if newest else None, "latest_version": newest["version"] if newest else None,
            "buildtype": newest["buildtype"] if newest else None,
            "maintainer": newest["maintainer"] if newest else None,
            "recovery_link": bool(rec), "recovery_urls": rec, "firmware_link": bool(any(x["firmware"] for x in bl)),
            "firmware_urls": sorted({x["firmware"] for x in bl if x["firmware"]}),
            "bootloader_link": bool(any(x["bootloader"] for x in bl)),
            "install_page_version": mj, "install_tags": tags or [], "install_page_found": tags is not None,
            "device_tree": newest["dt"] if newest else None, "forum": newest["forum"] if newest else None,
            "builds": bl,
        })
    json.dump({"fetched": TODAY.isoformat(), "ota_branch_shas": shas, "devices": rows},
              open(os.path.join(HERE, "devices.json"), "w"), indent=1)

    def j(v): return ";".join(map(str, v)) if isinstance(v, list) else ("" if v is None else v)
    cols = [k for k in rows[0] if k != "builds"]
    with open(os.path.join(HERE, "devices.csv"), "w", newline="") as f:
        w = csv.writer(f); w.writerow(cols + ["branch_builds"])
        for r in rows:
            w.writerow([j(r[c]) for c in cols] + [";".join(f'{b["branch"]}={b["version"]}@{b["date"]}' + ("" if b["present_in_branch"] else "(removed)") for b in r["builds"])])

    agg = defaultdict(lambda: {"dev": set(), "act": set(), "v": set(), "t": set()})
    for r in rows:
        for b in r["builds"]:
            a = agg[b["branch"]]; a["dev"].add(r["codename"]); a["v"].add(str(b["version"])); a["t"].add(b["buildtype"])
            if b["date"] >= CUTOFF.isoformat(): a["act"].add(r["codename"])
    with open(os.path.join(HERE, "branches.csv"), "w", newline="") as f:
        w = csv.writer(f); w.writerow(["branch", "android", "branch_sha", "crdroid_versions", "device_count", "active_6mo_count", "active_6mo_devices"])
        for b in sorted(agg, key=vkey, reverse=True):
            a = agg[b]
            w.writerow([b, ANDROID_NAME.get(b, b), shas[b][:10], ";".join(sorted(a["v"], key=vkey, reverse=True)), len(a["dev"]), len(a["act"]), ";".join(sorted(a["act"], key=str.lower))])

    by = {r["codename"].lower(): r for r in rows}
    def products(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "product" and isinstance(v, str): yield v
                else: yield from products(v)
        elif isinstance(o, list):
            for v in o: yield from products(v)
    with open(os.path.join(HERE, "catalog_map.csv"), "w", newline="") as f:
        w = csv.writer(f); w.writerow(["catalog_codename", "catalog_file", "crdroid_listed", "crdroid_branches", "latest_build_date", "active_6mo", "install_tags"])
        for p in sorted(glob.glob(os.path.join(REPO_ROOT, "catalog", "devices", "*", "*.json"))):
            c = json.load(open(p)); cn = c.get("codename")
            r = by.get(str(cn).lower()) or next((by[x.lower()] for x in products(c) if x.lower() in by), None)
            w.writerow([cn, os.path.relpath(p, REPO_ROOT), "yes" if r else "not listed", j(r["branches"]) if r else "not listed",
                        r["latest_build_date"] if r else "", r["active_6mo"] if r else "", j(r["install_tags"]) if r else ""])
    json.dump({"fetched": TODAY.isoformat(), "cutoff": CUTOFF.isoformat(), "ota_branch_shas": shas, "devices": len(rows),
               "site_devices": len(site)}, open(os.path.join(HERE, "meta.json"), "w"), indent=1)
    print("devices", len(rows), "site", len(site), "ota", len(dev), "branches", len(branches))


if __name__ == "__main__":
    main()
