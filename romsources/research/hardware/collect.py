#!/usr/bin/env python3
"""Collect core hardware facts per phone from GSMArena. Stdlib only, cached, polite.

  python3 collect.py                      # targets.csv -> devices.json / devices.csv
  python3 collect.py --targets all.csv    # any other target list, same columns
  python3 collect.py --offline            # parse cache only, no network (never refetches)

targets.csv columns: codename,vendor,name,models,gsmarena_url,variant
  vendor        GSMArena brand slug (google, xiaomi, samsung, oneplus, nokia, fairphone ...)
  name          GSMArena listing name WITHOUT the brand ("Mi A1", "Pixel 8a")
  models        optional ';'-separated model numbers; if any appears in GSMArena's `models`
                field the match is upgraded to "model-exact"
  gsmarena_url  optional; skips lookup (match = "url-cited")
  variant       optional regex picking the right chipset line on multi-chipset pages
                (e.g. "845" for the Snapdragon S9 variants)
Resume: every fetched page lives in raw/ and is never fetched again; rerun after a block.
manual.json: per-codename overrides for phones GSMArena lacks (vendor/Nura data) and fixes.
match column: url-cited | model-exact | name-exact | name-fuzzy | manual | none.
Stops on HTTP 429/403 or a Turnstile page (Blocked) and writes what it has.
"""
import csv, json, os, re, sys, time, urllib.request, urllib.error
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
UA = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0"
DELAY = 9
CHECKED = "2026-10-16"
OFFLINE = "--offline" in sys.argv
_last = [0.0]


class Blocked(Exception):
    pass


def fetch(url):
    os.makedirs(RAW, exist_ok=True)
    gi = os.path.join(RAW, ".gitignore")
    if not os.path.exists(gi):
        open(gi, "w").write("*\n")
    path = os.path.join(RAW, re.sub(r"[^A-Za-z0-9_.+-]", "_", url.split("gsmarena.com/")[-1]) + ".html")
    if os.path.exists(path):
        return open(path, encoding="utf-8").read()
    if OFFLINE:
        return None
    wait = DELAY - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    try:
        h = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=40).read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        if e.code in (429, 403):
            raise Blocked("HTTP %d for %s" % (e.code, url))
        raise
    if "Turnstile check" in h:
        raise Blocked("Turnstile challenge for " + url)
    open(path, "w", encoding="utf-8").write(h)
    return h


# ---------- brand listing -> url lookup (quick-search is behind Turnstile) ----------
_brand_idx = {}


def brand_index(brand):
    if brand in _brand_idx:
        return _brand_idx[brand]
    idx = _brand_idx[brand] = []
    mk = fetch("https://www.gsmarena.com/makers.php3")
    m = mk and re.search(r'href="%s-phones-(\d+)\.php"' % re.escape(brand), mk)
    if not m:
        return idx
    bid = m.group(1)
    for p in range(1, 80):
        url = "https://www.gsmarena.com/%s-phones-%s.php" % (brand, bid) if p == 1 else \
              "https://www.gsmarena.com/%s-phones-f-%s-0-p%d.php" % (brand, bid, p)
        h = fetch(url)
        if not h:
            break
        for u, n in re.findall(r'<li><a href="([^"]+\.php)"><img[^>]*><strong><span>(.*?)</span>', h):
            idx.append((u, re.sub(r"\s+", " ", re.sub(r"<br\s*/?>", " ", n)).strip()))
        if not re.search(r"-p%d\.php" % (p + 1), h):
            break
    return idx


def norm(s):
    return re.sub(r"[^a-z0-9+]", "", s.lower())


def lookup(brand, name):
    idx = brand_index(brand)
    ex = [u for u, n in idx if norm(n) == norm(name)]
    if not ex:  # "Mi A1 (Mi 5X)" style alias suffix
        ex = [u for u, n in idx if norm(re.sub(r"\(.*?\)", "", n)) == norm(name)]
    if len(ex) == 1:
        return "https://www.gsmarena.com/" + ex[0], "name-exact", ""
    if len(ex) > 1:
        return None, "none", "ambiguous exact: " + ", ".join(ex)
    fz = [(u, n) for u, n in idx if norm(name) in norm(n)]
    if len(fz) == 1:
        return "https://www.gsmarena.com/" + fz[0][0], "name-fuzzy", "fuzzy: " + fz[0][1]
    return None, "none", ("candidates: " + "; ".join(u for u, _ in fz[:6])) if fz else "not in brand listing"


# ---------- spec parsing ----------
def txt(s):
    s = re.sub(r"<br\s*/?>", " | ", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("&thinsp;", " ").replace("&nbsp;", " ").replace("&amp;", "&").replace("&Prime;", '"')
    return re.sub(r"\s+", " ", s).strip(" |")


def spec(h):
    d = {m.group(1): txt(m.group(2)) for m in re.finditer(r'<td class="nfo"[^>]*data-spec="([a-z0-9-]+)"[^>]*>(.*?)</td>', h, re.S)}
    t = re.search(r"<h1[^>]*>(.*?)</h1>", h, re.S)
    d["_title"] = txt(t.group(1)) if t else ""
    return d


MON = {m: i + 1 for i, m in enumerate("january february march april may june july august september october november december".split())}


def pdate(s):
    """'2024, May 07' / 'Released 2018, March' / '2012, Q2' -> ISO-ish string."""
    m = re.search(r"(\d{4}),?\s*(?:(\w+)\s*(\d{1,2})?)?", s or "")
    if not m:
        return ""
    y, mo, dd = m.groups()
    mo = MON.get((mo or "").lower())
    return "%s-%02d-%02d" % (y, mo, int(dd)) if mo and dd else ("%s-%02d" % (y, mo) if mo else y)


# marketing names GSMArena uses for platform ids Qualcomm/Nura call something else
SOC_ALIAS = {"sdm730": "sm7150", "sdm732": "sm7150"}


def soc_id(chip):
    """Normalized lowercase platform id from GSMArena chipset text (one chipset line)."""
    c = chip or ""
    m = re.search(r"\b(SM|SDM|MSM|APQ|SC)(\d{3,4})", c)
    if m:
        x = (m.group(1) + m.group(2)).lower()
        return SOC_ALIAS.get(x, x)
    m = re.search(r"Tensor G(\d)", c)
    if m:
        return "tensor-g" + m.group(1)
    if re.search(r"Google Tensor", c):
        return "tensor-g1"
    m = re.search(r"Exynos\s*(\d{4})", c)
    if m:
        return "exynos" + m.group(1)
    m = re.search(r"(MT\d{4})", c)
    if m:
        return m.group(1).lower()
    m = re.search(r"Helio\s*(\w+)", c)
    if m:
        return "helio-" + m.group(1).lower()
    m = re.search(r"OMAP\s*(\d{4})", c, re.I)
    if m:
        return "omap" + m.group(1)
    m = re.search(r"Allwinner\s*(\w+)", c, re.I)
    if m:
        return "allwinner-" + m.group(1).lower()
    m = re.search(r"Rockchip\s*(\w+)", c, re.I)
    if m:
        return m.group(1).lower()
    m = re.search(r"i\.MX\s*(\w+)", c, re.I)
    if m:
        return "imx" + m.group(1).lower()
    return ""


def mem(s):
    """'128GB 8GB RAM, 256GB 8GB RAM' -> (['128','256'] GB, ['8 GB'])."""
    ram, sto = [], []
    for n, u, r in re.findall(r"(\d+(?:\.\d+)?)\s*(GB|MB|TB)(\s*RAM)?", s or "", re.I):
        v = "%s %s" % (n, u.upper())
        (ram if r else sto).append(v)
    return sorted(set(ram), key=lambda x: float(x.split()[0])), list(dict.fromkeys(sto))


def joinsz(v):
    """['128 GB','256 GB','1 TB'] -> '128/256 GB/1 TB'"""
    gb = [x[:-3] for x in v if x.endswith(" GB")]
    rest = [x for x in v if not x.endswith(" GB")]
    return "/".join(([("/".join(gb) + " GB")] if gb else []) + rest)


def android(os_):
    m = re.match(r"\s*Android\s*(\d+(?:\.\d+)?)", os_ or "")
    if not m:
        return "", "", ""
    launch = m.group(1)
    mx = re.search(r"(?:upgradable to|up to)\s*(?:Android\s*)?(\d+(?:\.\d+)?)", os_)
    parts = [p.strip() for p in os_.split(",")]
    skin = next((p for p in parts[1:] if not re.match(r"(upgradable|up to|Android|planned|\d)", p, re.I)), "")
    return launch, mx.group(1) if mx else launch, skin


def num(x):
    try:
        f = float(x)
        return int(f) if f == int(f) else f
    except (TypeError, ValueError):
        return ""


def build(t, h, url, match, note, variant):
    d = spec(h)
    lines = [l.strip() for l in (d.get("chipset", "")).split("|") if l.strip()]
    pick = next((l for l in lines if variant and re.search(variant, l)), lines[0] if lines else "")
    cpu = d.get("cpu", "")
    cl = [l.strip() for l in cpu.split("|")]
    cpu_pick = next((l for l in cl if variant and re.search(variant, l)), None)
    if variant and len(lines) > 1:
        # region-tagged lines: keep the line matching the variant (chipset/cpu/gpu lines are 1:1)
        i = lines.index(pick)
        cpu_pick = cl[i] if i < len(cl) else cpu
        g = [l.strip() for l in d.get("gpu", "").split("|")]
        gpu_pick = g[i] if i < len(g) else d.get("gpu", "")
    else:
        cpu_pick, gpu_pick = cpu, d.get("gpu", "")
    ram, sto = mem(d.get("internalmemory", ""))
    la, ma, skin = android(d.get("os", ""))
    ostxt = d.get("os", "")
    size = re.search(r"([\d.]+)\s*inch", d.get("displaysize", ""))
    res = re.search(r"(\d+)\s*x\s*(\d+)", d.get("displayresolution", ""))
    bat = re.search(r"(\d{3,5})\s*mAh", d.get("batdescription1", ""))
    models = [x.strip() for x in d.get("models", "").split(",") if x.strip()]
    tm = [x for x in (t.get("models") or "").split(";") if x]
    if tm and match != "url-cited" or (tm and match == "url-cited"):
        if any(x.lower() in [m.lower() for m in models] for x in tm):
            match = "model-exact"
    confl = []
    if len(lines) > 1 and not variant:
        confl.append("GSMArena lists several chipsets (%s); picked first, set `variant`" % " / ".join(lines))
    return {
        "codename": t["codename"], "name": t["name"], "gsmarena_url": url,
        "match": match, "match_note": note,
        "announced": pdate(d.get("year", "")),
        "released": pdate(d.get("status", "")) if re.search(r"Released", d.get("status", "")) else "",
        "status": d.get("status", ""),
        "launch_os": ostxt, "launch_android": num(la), "stock_max_android": num(ma), "stock_skin": skin,
        "soc": soc_id(pick), "chipset": pick, "cpu": cpu_pick, "gpu": gpu_pick,
        "ram": joinsz(ram),
        "storage": joinsz(sto)
                   + ((" " + d["memoryother"]) if d.get("memoryother") and d["memoryother"] != "No" else ""),
        "card_slot": d.get("memoryslot", ""),
        "display": {"size_in": num(size.group(1)) if size else "", "resolution": "%sx%s" % res.groups() if res else "", "type": d.get("displaytype", "").split(",")[0]},
        "battery_mah": int(bat.group(1)) if bat else "",
        "nfc": "yes" if d.get("nfc", "").lower().startswith("yes") else ("no" if d.get("nfc") else ""),
        "usb": d.get("usb", ""), "models": models,
        "soc_source": "gsmarena", "conflicts": confl, "checked": CHECKED,
    }


ROMVAULT = os.path.join(HERE, "..", "..", "..", "romvault", "devices")


def nura_soc(codename):
    """SoC id from what the ROMvault page recorded off the Nura wiki (Nura itself sits behind Anubis)."""
    p = os.path.join(ROMVAULT, codename + ".md")
    if not os.path.exists(p):
        return ""
    for l in open(p, encoding="utf-8"):
        if re.search(r"\*\*Chip:\*\*|Nura (?:wiki )?(?:lists|identifies)", l):
            ids = [soc_id(x) or x.lower().replace(" ", "").replace(".", "") for x in re.findall(
                r"(?:SM|SDM|MSM)\d{3,4}|RK\d{4}|i\.MX\s*8\w+|Allwinner A\d+|OMAP\s*\d{4}|Exynos\s*\d{4}|PXA\d{4}|MT\d{4}|Tensor G\d", l, re.I)]
            if ids:
                return "/".join(dict.fromkeys(ids))
    return ""


def main():
    targets = sys.argv[sys.argv.index("--targets") + 1] if "--targets" in sys.argv else os.path.join(HERE, "targets.csv")
    rows = list(csv.DictReader(open(targets, encoding="utf-8")))
    manual = json.load(open(os.path.join(HERE, "manual.json"))) if os.path.exists(os.path.join(HERE, "manual.json")) else {}
    out, gaps = [], []
    try:
        for t in rows:
            c = t["codename"]
            url, match, note = (t.get("gsmarena_url") or "").strip(), "url-cited", ""
            if not url and t.get("vendor") and not (c in manual and manual[c].get("no_gsmarena")):
                url, match, note = lookup(t["vendor"], t["name"])
            h = fetch(url) if url else None
            if h:
                rec = build(t, h, url, match, note, t.get("variant"))
            else:
                rec = {"codename": c, "name": t["name"], "gsmarena_url": "", "match": "none", "match_note": note, "checked": CHECKED,
                       "soc_source": "", "conflicts": [], "models": []}
            if c in manual:
                m = dict(manual[c]); m.pop("no_gsmarena", None)
                if rec["match"] == "none":
                    rec["match"] = "manual"
                rec.update(m)
            ns = nura_soc(c)
            rec["nura_soc"] = ns
            if ns and rec.get("soc") and not any(rec["soc"].startswith(x) or x.startswith(rec["soc"]) for x in ns.split("/")):
                rec.setdefault("conflicts", []).append("Nura/ROMvault SoC %s vs GSMArena/manual %s" % (ns, rec["soc"]))
            out.append(rec)
            if not rec.get("soc"):
                gaps.append(c)
    except Blocked as e:
        print("BLOCKED:", e, "- rerun later; cache is kept", file=sys.stderr)
    done = {r["codename"] for r in out}
    pending = [t["codename"] for t in rows if t["codename"] not in done]
    json.dump(out, open(os.path.join(HERE, "devices.json"), "w"), indent=1, ensure_ascii=False)
    cols = ["codename", "name", "gsmarena_url", "match", "match_note", "announced", "released", "launch_os", "launch_android",
            "stock_max_android", "stock_skin", "soc", "chipset", "cpu", "gpu", "ram", "storage", "card_slot",
            "display_size_in", "display_resolution", "display_type", "battery_mah", "nfc", "usb", "models", "soc_source", "nura_soc", "conflicts", "checked"]
    with open(os.path.join(HERE, "devices.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, cols)
        w.writeheader()
        for r in out:
            x = dict(r)
            dd = x.pop("display", {}) or {}
            x.update(display_size_in=dd.get("size_in", ""), display_resolution=dd.get("resolution", ""), display_type=dd.get("type", ""))
            x["models"] = ";".join(x.get("models") or [])
            x["conflicts"] = " || ".join(x.get("conflicts") or [])
            w.writerow({k: x.get(k, "") for k in cols})
    print("rows %d, no soc: %s, not reached: %s" % (len(out), gaps, pending))


if __name__ == "__main__":
    main()
