"""Highest Android any of LineageOS, /e/OS, crDroid ever shipped per codename, and the highest still built (LineageOS hudson target, or a build in the last 6 months).
Reads the three devices.csv files next to it, writes community-max.csv. Run: python3 -I community_max.py"""
import csv, os

HERE = os.path.dirname(os.path.abspath(__file__))
ANDROID = {"Pie": 9, "Oreo": 8, "Nougat": 7, "12L": 12}
EOS = {"q": 10, "r": 11, "s": 12, "t": 13, "u": 14}  # a14/a15/a16 carry the number


def num(v):
    v = str(v).split()[0]
    return ANDROID.get(v) or float(v.replace("L", ""))


def rows(project):
    return csv.DictReader(open(os.path.join(HERE, project, "devices.csv"), encoding="utf-8"))


def collect():
    lin = {r["lineage_version"]: num(r["android_version"]) for r in csv.DictReader(open(os.path.join(HERE, "lineageos/branches.csv")))}
    crd = {r["branch"]: num(r["android"]) for r in csv.DictReader(open(os.path.join(HERE, "crdroid/branches.csv")))}
    best = {}  # codename -> {"ever": (android, label), "active": (android, label), "names": set}

    def add(cn, name, android, label, active):
        d = best.setdefault(cn, {"ever": (0, ""), "active": (0, ""), "name": name})
        d["name"] = d["name"] or name
        if android > d["ever"][0]: d["ever"] = (android, label)
        if active and android > d["active"][0]: d["active"] = (android, label)

    for r in rows("lineageos"):
        for v in filter(None, r["versions"].split(";")):
            add(r["codename"], f'{r["vendor"]} {r["name"]}', lin[v], f"LineageOS {v}", r["built_now"] == "True" and v == r["built_branch"])
    for r in rows("e-os"):
        active = set(r["active_branches"].split(";"))
        for b in filter(None, r["branches"].split(";")):
            br = b.split("/")[1]
            add(r["codename"], f'{r["vendor"]} {r["name"]}', EOS.get(br) or float(br[1:]), f"/e/OS {b}", b in active)
    for r in rows("crdroid"):
        latest = r["latest_branch"]
        for b in filter(None, r["branches"].split(";")):
            add(r["codename"], f'{r["vendor"]} {r["name"]}', crd[b], f"crDroid {b}", r["active_6mo"] == "True" and b == latest)
    return best


def fmt(a):
    return "" if not a else str(int(a)) if a == int(a) else str(a)


if __name__ == "__main__":
    best = collect()
    # self-check: starlte peaked at /e/OS a15 (Android 15), Mi A3 is built on LineageOS 24.0 (Android 17)
    assert best["starlte"]["ever"][0] == 15 and best["laurel_sprout"]["active"] == (17, "LineageOS 24.0"), (best["starlte"], best["laurel_sprout"])
    with open(os.path.join(HERE, "community-max.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["codename", "name", "max_android_ever", "max_ever_by", "max_android_built_now", "max_now_by"])
        for cn in sorted(best, key=str.lower):
            d = best[cn]
            w.writerow([cn, d["name"], fmt(d["ever"][0]), d["ever"][1], fmt(d["active"][0]), d["active"][1]])
    print(len(best), "codenames")
