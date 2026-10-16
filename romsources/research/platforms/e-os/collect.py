#!/usr/bin/env python3 -I
"""Build the /e/OS official support matrix. Stdlib only.

Sources (facts only, no doc prose is kept):
  1. gitlab.e.foundation e/documentation/user  data/devices/*.yaml  (per-device metadata)
  2. images.ecloud.global /api/v2/devices[/<codename>/downloads]    (real builds per channel)
Run:  python3 -I collect.py [--refresh]   (re-uses raw/ unless --refresh)
Outputs next to this file: devices.csv devices.json branches.csv catalog_map.csv meta.json
"""
import csv, datetime, glob, io, json, os, re, sys, tarfile, time, urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
GL = "https://gitlab.e.foundation/api/v4/projects/464"  # e/documentation/user
API = "https://images.ecloud.global/api/v2"
TODAY = datetime.date.today()
CUTOFF = TODAY - datetime.timedelta(days=183)  # "last 6 months"
REFRESH = "--refresh" in sys.argv


def get(url, path, binary=False):
    p = os.path.join(RAW, path)
    if os.path.exists(p) and not REFRESH:
        return open(p, "rb").read()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "rominit-research/1"})
            data = urllib.request.urlopen(req, timeout=60).read()
            open(p, "wb").write(data)
            return data
        except Exception as e:  # ponytail: simple retry, no backoff tuning
            err = e
            time.sleep(2 * (i + 1))
    raise SystemExit(f"FAILED {url}: {err}")


def scalar(v):
    v = v.strip()
    if v in ("", "~", "null"):
        return None
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
        return v[1:-1]
    if v in ("true", "True"):
        return True
    if v in ("false", "False"):
        return False
    if v.startswith("[") and v.endswith("]"):
        return [scalar(x) for x in v[1:-1].split(",") if x.strip()]
    return v


def mini_yaml(text):
    """Top-level keys only: scalar | list of scalars | list of dicts (first-level scalars) | 1-level dict."""
    out, lines, i = {}, text.splitlines(), 0
    while i < len(lines):
        m = re.match(r"^([A-Za-z_][\w \-]*?):\s*(.*)$", lines[i])
        if not m:
            i += 1
            continue
        key, val = m.group(1).strip(), m.group(2)
        i += 1
        if val.strip() and not val.strip() in ("|", ">", "|-", ">-"):
            out[key] = scalar(val)
            continue
        block = []
        while i < len(lines) and (lines[i].startswith((" ", "-")) or not lines[i].strip()):
            block.append(lines[i]); i += 1
        block = [b for b in block if b.strip()]
        if not block:
            out[key] = None
        elif block[0].lstrip().startswith("- "):
            items, cur = [], None
            ind = len(block[0]) - len(block[0].lstrip())
            for b in block:
                s = b.strip()
                if len(b) - len(b.lstrip()) == ind and s.startswith("- "):
                    body = s[2:]
                    mm = re.match(r"^([\w\-]+):\s*(.*)$", body)
                    if mm:
                        cur = {mm.group(1): scalar(mm.group(2))}; items.append(cur)
                    else:
                        cur = None; items.append(scalar(body))
                elif cur is not None and len(b) - len(b.lstrip()) == ind + 2:
                    mm = re.match(r"^([\w\-]+):\s*(.*)$", s)
                    if mm: cur[mm.group(1)] = scalar(mm.group(2))
            out[key] = items
        else:
            d = {}
            ind = len(block[0]) - len(block[0].lstrip())
            for b in block:
                mm = re.match(r"^([\w\-]+):\s*(.*)$", b.strip())
                if mm and len(b) - len(b.lstrip()) == ind:
                    d[mm.group(1)] = scalar(mm.group(2))
            out[key] = d
    return out


def android_num(s):
    m = re.search(r"(\d+)", str(s or ""))
    return int(m.group(1)) if m else None


def dropped_docs(current_stems):
    """Device YAMLs removed from the docs repo (any past path layout): {stem: (yaml_dict, drop_date, drop_sha)}."""
    import subprocess
    g = os.path.join(RAW, "docs.git")
    if REFRESH or not os.path.isdir(g):
        subprocess.run(["rm", "-rf", g])
        subprocess.run(["git", "clone", "-q", "--bare", "--filter=blob:none", "https://gitlab.e.foundation/e/documentation/user.git", g], check=True)
    run = lambda *a: subprocess.run(["git", "-C", g, *a], capture_output=True, text=True)
    log = run("log", "--no-renames", "--name-status", "--format=@%H\t%cs", "--", "data/devices", "_data/devices", "htdocs/_data/devices").stdout
    seen, out, sha, day = set(), {}, None, None
    for ln in log.splitlines():  # newest first: first event per path decides
        if ln.startswith("@"): sha, day = ln[1:].split("\t"); continue
        if "\t" not in ln: continue
        st, path = ln.split("\t", 1)
        m = re.search(r"(?:^|/)(?:_data|data)/devices/([^/]+)\.ya?ml$", path)
        if not m or path in seen: continue
        seen.add(path)
        stem = m.group(1)
        if st == "D" and stem not in current_stems and stem not in out:
            txt = run("show", f"{sha}^:{path}").stdout
            if txt: out[stem] = (mini_yaml(txt), day, sha)
    return out


def products(o):
    """All `product` string values anywhere in a catalog device JSON."""
    if isinstance(o, dict):
        for k, v in o.items():
            if k == "product" and isinstance(v, str): yield v
            else: yield from products(v)
    elif isinstance(o, list):
        for v in o: yield from products(v)


def main():
    # --- source 1: docs repo
    commit = json.loads(get(f"{GL}/repository/commits/main", "gitlab-commit.json"))
    sha = commit["id"]
    tgz = get(f"{GL}/repository/archive.tar.gz?path=data/devices&sha={sha}", "devices-yaml.tgz")
    docs = {}
    with tarfile.open(fileobj=io.BytesIO(tgz)) as t:
        for m in t.getmembers():
            if m.isfile() and m.name.endswith(".yaml") and "/data/devices/" in m.name:
                y = mini_yaml(t.extractfile(m).read().decode("utf-8", "replace"))
                if y.get("codename"):
                    docs[str(y["codename"])] = y
    stems = {m.name.rsplit("/", 1)[1].rsplit(".", 1)[0] for m in tarfile.open(fileobj=io.BytesIO(tgz)).getmembers() if m.isfile() and m.name.endswith(".yaml")}
    dropped = dropped_docs(stems)
    dropped = {(v[0].get("codename") or k): v for k, v in dropped.items() if (v[0].get("codename") or k) not in docs}
    for cn, (y, _, _) in dropped.items(): docs.setdefault(cn, y)
    # --- source 2: builds API
    page, listing = 1, []
    while True:
        d = json.loads(get(f"{API}/devices?page_size=200&page={page}", f"api/devices-p{page}.json"))
        listing += d["results"]
        if not d["next"]: break
        page += 1
    api = {}
    for r in listing:
        cn = r["device"]
        dl = json.loads(get(f"{API}/devices/{cn}/downloads", f"api/downloads/{cn}.json"))
        api[cn] = dl["builds"]

    rows = []
    for cn in sorted(set(docs) | set(api), key=str.lower):
        y, builds = docs.get(cn, {}), api.get(cn, [])
        is_dropped = cn in dropped and cn not in api
        comp = y.get("compatibility") or {}
        # latest build per (channel, android branch)
        lat = {}
        for b in builds:
            k = (b["type"], b["android"])
            if k not in lat or b["datetime"] > lat[k]["datetime"]:
                lat[k] = b
        branches = []
        for (ch, an), b in sorted(lat.items(), key=lambda kv: (kv[0][0], -(kv[1]["android_version"] or 0))):
            branches.append({
                "channel": ch, "android": an, "android_version": b["android_version"],
                "eos_version": b["version"], "latest_date": b["date"], "os_patch_level": b.get("os_patch_level"),
                "file_types": sorted({f["ftype"] for f in b["files"]}),
                "builds_in_api": sum(1 for x in builds if (x["type"], x["android"]) == (ch, an)),
            })
        dates = [x["latest_date"] for x in branches]
        latest = max(dates) if dates else ""
        modes = [i.get("mode") for i in (y.get("install") or []) if isinstance(i, dict)]
        ba = y.get("before_install_args") or {}
        row = {
            "codename": cn, "vendor": y.get("vendor"), "name": y.get("name"), "type": y.get("type"),
            "models": y.get("models") or [],
            "in_docs": cn in docs and not is_dropped, "in_builds_api": cn in api,
            "dropped_from_docs": is_dropped, "dropped_date": dropped[cn][1] if is_dropped else "",
            "release_type_doc": comp.get("release_type"), "bootloader_lockable": comp.get("bootloader"),
            "build_variant": comp.get("build_variant"), "play_integrity": comp.get("play_integrity"),
            "doc_lineage_branch": y.get("current_branch"),
            "doc_build_version_stable": y.get("build_version_stable"), "doc_build_version_dev": y.get("build_version_dev"),
            "doc_versions": y.get("versions") or [],
            "is_lineageos_official": y.get("is_lineageos_official"),
            "is_ab": bool(y.get("is_ab_device")),
            "install_method": y.get("install_method"), "recovery_install_method": y.get("recovery_install_method"),
            "install_e_script": y.get("install_e_file_name") or y.get("install_e"),
            "eos_installer_web": "/e/OS Installer" in modes,
            "install_doc_modes": modes,
            "prereq_before_install": y.get("before_install_file_name") or y.get("before_install"),
            "prereq_stock_android_min": ba.get("version") if isinstance(ba, dict) else None,
            "prereq_firmware_update": y.get("firmware_update"),
            "recovery_partition": y.get("recovery_partition_name") or y.get("recovery_partition"),
            "can_rollback": y.get("can_rollback"), "maturity": y.get("maturity"),
            "branches": branches,
            "channels": sorted({b["channel"] for b in branches}),
            "latest_build_date": latest,
            "active_6mo": bool(latest) and latest >= CUTOFF.isoformat(),
        }
        row["maintained"] = row["active_6mo"]
        row["legacy"] = not row["active_6mo"]  # stale builds or dropped from docs
        row["status"] = "maintained" if row["maintained"] else ("dropped" if is_dropped else "stale")
        # branches with a build inside the window, per channel
        row["active_branches"] = [f'{b["channel"]}/{b["android"]}' for b in branches if b["latest_date"] >= CUTOFF.isoformat()]
        rows.append(row)

    json.dump({"fetched": TODAY.isoformat(), "docs_commit": sha, "devices": rows},
              open(os.path.join(HERE, "devices.json"), "w"), indent=1)

    def j(v): return ";".join(map(str, v)) if isinstance(v, list) else ("" if v is None else v)
    cols = [k for k in rows[0] if k not in ("branches",)]
    with open(os.path.join(HERE, "devices.csv"), "w", newline="") as f:
        w = csv.writer(f); w.writerow(cols + ["branches", "eos_versions", "api_file_types"])
        for r in rows:
            br = ";".join(f'{b["channel"]}/{b["android"]}' for b in r["branches"])
            ev = ";".join(f'{b["channel"]}/{b["android"]}={b["eos_version"]}@{b["latest_date"]}' for b in r["branches"])
            ft = ";".join(sorted({t for b in r["branches"] for t in b["file_types"]}))
            w.writerow([j(r[c]) for c in cols] + [br, ev, ft])

    # branches.csv: (channel, android branch)
    agg = defaultdict(lambda: {"dev": set(), "act": set(), "av": None, "ver": ""})
    for r in rows:
        for b in r["branches"]:
            a = agg[(b["channel"], b["android"])]
            a["dev"].add(r["codename"]); a["av"] = b["android_version"]
            if b["latest_date"] >= CUTOFF.isoformat(): a["act"].add(r["codename"])
            a["ver"] = max(a["ver"], b["eos_version"], key=lambda s: [int(x) if x.isdigit() else 0 for x in re.split(r"\D+", s)])
    with open(os.path.join(HERE, "branches.csv"), "w", newline="") as f:
        w = csv.writer(f); w.writerow(["channel", "branch", "android_version", "latest_eos_version", "device_count", "active_6mo_count", "active_6mo_devices"])
        for (ch, an), a in sorted(agg.items(), key=lambda kv: (kv[0][0], -(kv[1]["av"] or 0))):
            w.writerow([ch, an, a["av"], a["ver"], len(a["dev"]), len(a["act"]), ";".join(sorted(a["act"], key=str.lower))])

    # catalog mapping
    by_cn = {r["codename"].lower(): r for r in rows}
    with open(os.path.join(HERE, "catalog_map.csv"), "w", newline="") as f:
        w = csv.writer(f); w.writerow(["catalog_codename", "catalog_file", "eos_listed", "eos_branches", "latest_build_date", "install_method", "is_ab", "status"])
        for p in sorted(glob.glob(os.path.join(REPO_ROOT, "catalog", "devices", "*", "*.json"))):
            c = json.load(open(p)); cn = c.get("codename")
            # codename first, then the catalog's `product` field (e.g. codename fairphone-fp4, product FP4)
            r = by_cn.get(str(cn).lower()) or next((by_cn[x.lower()] for x in products(c) if x.lower() in by_cn), None)
            w.writerow([cn, os.path.relpath(p, REPO_ROOT), "yes" if r else "not listed",
                        j([f'{b["channel"]}/{b["android"]}' for b in r["branches"]]) if r else "not listed",
                        r["latest_build_date"] if r else "", (r["install_method"] or "") if r else "", r["is_ab"] if r else "", r["status"] if r else ""])

    json.dump({"fetched": TODAY.isoformat(), "cutoff": CUTOFF.isoformat(), "docs_commit": sha,
               "docs_commit_date": commit.get("created_at"), "api_device_count": len(api), "docs_device_count": len(docs) - len(dropped), "dropped_docs_devices": len(dropped)},
              open(os.path.join(HERE, "meta.json"), "w"), indent=1)
    print("devices", len(rows), "docs", len(docs)-len(dropped), "api", len(api), "commit", sha[:8])


if __name__ == "__main__":
    main()
