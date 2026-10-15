#!/usr/bin/env python3
"""Fetch Nura Wiki device metadata and resolve packaged kernels from APKINDEX."""
import csv
import io
import json
import re
import sys
import tarfile
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent
API = "https://wiki.nura.eco/api.php"
ARCHES = ("aarch64", "armhf", "armv7", "x86_64", "x86", "loongarch64", "riscv64", "ppc64le")
BRANCHES = {"stable": "v26.06", "edge": "master"}
HEADERS = {"User-Agent": "Codex device-support research (read-only)"}
SUPPORTED = {"main", "community", "testing", "downstream"}
FIELDS = ("codename", "architecture", "category", "booting", "packaged", "pmoskernel", "genericdevice")


def get_json(params):
    url = API + "?" + urlencode(params)
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=45) as response:
        return json.load(response)


def roster():
    params = {"action": "query", "list": "categorymembers", "cmtitle": "Category:Devices",
              "cmnamespace": "0", "cmlimit": "max", "format": "json"}
    rows = []
    while True:
        data = get_json(params)
        rows.extend(data["query"]["categorymembers"])
        if "continue" not in data:
            break
        params.update(data["continue"])
    return rows


def parse_infobox(text):
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    start = text.find("{{Infobox device")
    fields = {}
    if start < 0:
        return fields
    start += len("{{Infobox device")
    depth, end = 0, len(text)
    for match in re.finditer(r"\{\{|\}\}", text[start:]):
        depth += 1 if match.group() == "{{" else -1
        if depth < 0:
            end = start + match.start()
            break
    depth = 0
    for line in text[start:end].splitlines():
        if depth == 0:
            match = re.match(r"\s*\|\s*([a-zA-Z0-9_-]+)\s*=\s*(.*?)\s*$", line)
            if match:
                fields[match.group(1).lower()] = match.group(2).strip()
        depth += len(re.findall(r"\{\{", line)) - len(re.findall(r"\}\}", line))
    return fields


def page_records(rows):
    records = []
    titles = [row["title"] for row in rows]
    for offset in range(0, len(titles), 50):
        data = get_json({"action": "query", "prop": "revisions|categories", "titles": "|".join(titles[offset:offset + 50]),
                         "cllimit": "max", "rvprop": "content", "rvslots": "main", "format": "json"})
        for page in data["query"]["pages"].values():
            rev = page.get("revisions", [{}])[0]
            slot = rev.get("slots", {}).get("main", {})
            text = slot.get("*", slot.get("content", ""))
            fields = parse_infobox(text)
            categories = [c["title"].removeprefix("Category:") for c in page.get("categories", [])]
            records.append({"title": page["title"], "pageid": page.get("pageid"), "fields": fields,
                            "categories": categories, "missing": "missing" in page})
        time.sleep(0.08)
    return records


def catalog_entries():
    soup = BeautifulSoup((ROOT / "postmarketos-devices-ketch.html").read_text(encoding="utf-8"), "html.parser")
    content = soup.select_one("#mw-content-text")
    if content is None:
        raise RuntimeError("source Devices capture has no #mw-content-text block")
    entries = []

    def add(display, title, codename, architecture, status):
        entries.append({"display": display, "title": (title or "").replace("_", " ").strip(),
                        "codename": codename, "architecture": architecture, "status": status})

    for heading in content.find_all("h2"):
        section = heading.get_text(" ", strip=True).lower()
        if section not in {"main", "community", "testing", "downstream", "non-booting and unavailable devices"}:
            continue
        for node in heading.find_all_next():
            if node.name == "h2":
                break
            if section == "community" and node.name == "tr" and node.find_parent("table", class_="cargoTable"):
                cells = node.find_all("td", recursive=False)
                if len(cells) >= 3:
                    link = cells[0].find("a")
                    add(cells[0].get_text(" ", strip=True), link.get("title") if link else "",
                        cells[1].get_text(" ", strip=True), cells[2].get_text(" ", strip=True), "community")
            elif section in {"testing", "downstream"} and node.name == "li":
                link = node.find("a", href=re.compile(r"^/wiki/"))
                text = node.get_text(" ", strip=True)
                details = re.search(r"\(\s*(?:Codename:\s*([^,()]+)\s*,\s*)?Architecture:\s*([^()]+)\s*\)", text)
                code = details.group(1).strip() if details and details.group(1) else ""
                arch = details.group(2).strip() if details else ""
                display = link.get_text(" ", strip=True) if link else re.sub(r"\s*\(.*$", "", text).strip()
                if not code and not link and re.fullmatch(r"[A-Za-z0-9_-]+", display):
                    code = display
                add(display, link.get("title") if link else "", code, arch, section)
            elif section == "non-booting and unavailable devices" and node.name == "li":
                group = node.find_previous("h3")
                if group:
                    group = group.get_text(" ", strip=True).lower()
                    status = {"archived devices": "archived", "non-packaged devices": "non-packaged",
                              "non-booting devices": "non-booting"}.get(group)
                    link = node.find("a", href=re.compile(r"^/wiki/"))
                    text = node.get_text(" ", strip=True)
                    details = re.search(r"\(\s*(?:Codename:\s*([^,()]+)\s*,\s*)?Architecture:\s*([^()]+)\s*\)", text)
                    code = details.group(1).strip() if details and details.group(1) else ""
                    arch = details.group(2).strip() if details else ""
                    display = link.get_text(" ", strip=True) if link else re.sub(r"\s*\(.*$", "", text).strip()
                    if status:
                        add(display, link.get("title") if link else "", code, arch, status)
    return entries


def catalog_statuses(entries):
    priority = {"non-booting": 0, "non-packaged": 1, "archived": 2, "downstream": 3,
                "testing": 4, "community": 5, "main": 6}
    statuses = {}
    for entry in entries:
        title, status = entry["title"], entry["status"]
        if title and (title not in statuses or priority.get(status, -1) > priority.get(statuses[title], -1)):
            statuses[title] = status
    return statuses


def parse_apkindex(blob):
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as archive:
        index_file = archive.extractfile("APKINDEX")
        if index_file is None:
            raise ValueError("APKINDEX.tar.gz archive is missing APKINDEX")
        raw = index_file.read().decode("utf-8", "replace")
    packages = {}
    for block in raw.split("\n\n"):
        entry = dict(line.split(":", 1) for line in block.splitlines() if ":" in line)
        if entry.get("P"):
            packages[entry["P"]] = entry
    return packages


def apk_records(branch, arch, cache_only=False):
    path = ROOT / "apkindexes" / branch / arch / "APKINDEX.tar.gz"
    url = f"https://mirror.nura.eco/postmarketos/{branch}/{arch}/APKINDEX.tar.gz"
    if cache_only:
        blob = path.read_bytes()
        packages = parse_apkindex(blob)
        for entry in packages.values():
            entry["_repo"] = f"postmarketOS:{branch}"
        source = {"url": url, "source": "saved APKINDEX", "origin": f"postmarketOS:{branch}"}
        return packages, source
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=45) as response:
        blob = response.read()
        source = {"url": response.geturl(), "last_modified": response.headers.get("Last-Modified"),
                  "content_length": response.headers.get("Content-Length"), "http_status": response.status}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(blob)
    packages = parse_apkindex(blob)
    for entry in packages.values():
        entry["_repo"] = f"postmarketOS:{branch}"
    return packages, source


def alpine_records(branch, arch, cache_only=False):
    version = "v3.24" if branch == "stable" else "edge"
    path = ROOT / "apkindexes" / "alpine" / version / arch / "APKINDEX.tar.gz"
    url = f"https://dl-cdn.alpinelinux.org/alpine/{version}/main/{arch}/APKINDEX.tar.gz"
    if cache_only:
        blob = path.read_bytes()
        source = {"url": url, "source": "saved APKINDEX", "origin": f"Alpine:{version}"}
    else:
        req = Request(url, headers=HEADERS)
        with urlopen(req, timeout=45) as response:
            blob = response.read()
            source = {"url": response.geturl(), "last_modified": response.headers.get("Last-Modified"),
                      "content_length": response.headers.get("Content-Length"), "http_status": response.status,
                      "origin": f"Alpine:{version}"}
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(blob)
    packages = parse_apkindex(blob)
    for entry in packages.values():
        entry["_repo"] = f"Alpine:{version}"
    return packages, source


def merge_indexes(pmos, alpine):
    """Overlay pmOS on its Alpine base repository and retain version conflicts."""
    merged = dict(alpine)
    conflicts = []
    for name, entry in pmos.items():
        base = alpine.get(name)
        if base:
            conflicts.append({"package": name, "pmos_version": entry.get("V", ""),
                              "alpine_version": base.get("V", ""), "selected": "postmarketOS"})
        merged[name] = entry
    return merged, conflicts


def kernel_package(name, entry):
    # Alpine/pmOS kernel package descriptions are inconsistent (some omit the
    # word "kernel"), while linux-firmware and linux-headers are not kernels.
    return bool(re.match(r"^(?:linux|kernel)-", name, re.I)) and not re.search(
        r"(?:^|[- ])(?:firmware|headers?|api-headers|docs?|source|dev)(?:$|[- ])", name, re.I
    )


def kernel_deps(start_names, packages):
    found, seen, todo = {}, set(), [(name, [name]) for name in start_names]
    while todo:
        name, path = todo.pop()
        if name in seen:
            continue
        seen.add(name)
        entry = packages.get(name)
        if not entry:
            continue
        if kernel_package(name, entry):
            found[name] = (entry.get("V", ""), path, entry.get("_repo", "unknown"))
            continue
        for dep in entry.get("D", "").split():
            if dep.startswith("!"):
                continue
            for alternative in dep.split("|"):
                if alternative.startswith(("so:", "cmd:", "pc:")):
                    continue
                package = re.split(r"[<>=~]", alternative, maxsplit=1)[0]
                if package in packages and package not in seen:
                    todo.append((package, path + [package]))
    return found


def package_matches(codename, packages):
    if not codename:
        return []
    prefix = "device-" + codename
    return sorted(name for name in packages if name == prefix or name.startswith(prefix + "-"))


def generic_codenames(value):
    found = re.findall(r"\(([A-Za-z0-9_-]+)\)", value or "")
    if not found and re.fullmatch(r"[A-Za-z0-9_-]+", value or ""):
        found = [value]
    return found


def codename_candidates(value):
    """Return compound codename alternatives without asserting a package exists."""
    return [part.strip() for part in (value or "").split(",")
            if re.fullmatch(r"[A-Za-z0-9_-]+", part.strip())]


def self_check():
    sample = """<!-- {{Infobox device\n| pmoskernel = 3.x.x\n}} -->\n{{Infobox device\n| name = Sample\n| nested = {{Template\n| category = false\n}}\n| category = community\n| pmoskernel = 6.19.5\n}}\n{{Other template\n| category = testing\n}}"""
    fields = parse_infobox(sample)
    assert fields["category"] == "community" and fields["pmoskernel"] == "6.19.5", fields
    packages = {
        "device-sample": {"P": "device-sample", "D": "!linux-forbidden linux-firmware linux-real"},
        "linux-forbidden": {"P": "linux-forbidden", "V": "1", "T": "Sample Linux kernel"},
        "linux-firmware": {"P": "linux-firmware", "V": "2", "T": "Firmware blobs"},
        "linux-real": {"P": "linux-real", "V": "6.19.5-r0", "T": "Sample Linux kernel"},
    }
    resolved = kernel_deps(["device-sample"], packages)
    assert set(resolved) == {"linux-real"} and resolved["linux-real"][0] == "6.19.5-r0", resolved
    assert kernel_package("linux-postmarketos-marvell", {"T": "mainline stable for Marvell SoC"})
    assert not kernel_package("linux-firmware-qcom", {"T": "Qualcomm firmware"})
    assert codename_candidates("oneplus-guacamoleb,guacamole,hotdogb") == [
        "oneplus-guacamoleb", "guacamole", "hotdogb"]
    merged, conflicts = merge_indexes(
        {"linux-x": {"P": "linux-x", "V": "1-r1", "_repo": "postmarketOS:v26.06"}},
        {"linux-x": {"P": "linux-x", "V": "1-r0", "_repo": "Alpine:v3.24"}})
    assert merged["linux-x"]["V"] == "1-r1" and conflicts[0]["alpine_version"] == "1-r0"


def resolve(record, indexes):
    fields = record["fields"]
    catalog_codenames = codename_candidates(record.get("catalog_codename", ""))
    infobox_codenames = codename_candidates(fields.get("codename", ""))
    generic = generic_codenames(fields.get("genericdevice", ""))
    out = {}
    for label in BRANCHES:
        device_versions, kernel_versions, kernel_repos = set(), set(), set()
        package_names, package_arches = set(), set()
        kernel_paths, mapping_sources = set(), set()
        for (repo_branch, arch), packages in indexes.items():
            if repo_branch != label:
                continue
            matches = sorted({name for code in catalog_codenames for name in package_matches(code, packages)
                              if packages[name].get("_repo", "").startswith("postmarketOS:")})
            mapping_source = "catalog codename" if matches else ""
            if not matches:
                matches = sorted({name for code in infobox_codenames for name in package_matches(code, packages)
                                  if packages[name].get("_repo", "").startswith("postmarketOS:")})
                mapping_source = "infobox codename" if matches else ""
            if not matches:
                matches = sorted({name for parent in generic for name in package_matches(parent, packages)
                                  if packages[name].get("_repo", "").startswith("postmarketOS:")})
                mapping_source = "genericdevice inherited" if matches else ""
            for name in matches:
                entry = packages[name]
                package_names.add(name)
                package_arches.add(arch)
                device_versions.add(f"{name}={entry.get('V','')}")
                mapping_sources.add(mapping_source)
                for kernel, (version, path, origin) in kernel_deps([name], packages).items():
                    kernel_versions.add(f"{kernel}={version}")
                    kernel_repos.add(origin)
                    kernel_paths.add(f"{' > '.join(path)} [{arch}]")
        out[f"{label}_device_packages"] = ";".join(sorted(device_versions))
        out[f"{label}_package_arches"] = ";".join(sorted(package_arches))
        out[f"{label}_kernel_packages"] = ";".join(sorted(kernel_versions))
        out[f"{label}_kernel_origin_repo"] = ";".join(sorted(kernel_repos))
        out[f"{label}_kernel_paths"] = ";".join(sorted(kernel_paths))
        out[f"{label}_mapping_source"] = ";".join(sorted(mapping_sources))
    stable = bool(out["stable_kernel_packages"])
    edge = bool(out["edge_kernel_packages"])
    device_stable = bool(out["stable_device_packages"])
    device_edge = bool(out["edge_device_packages"])
    out["resolution"] = ("stable+edge kernels" if stable and edge else "stable kernel only" if stable
                          else "edge kernel only" if edge else "device package, kernel unresolved"
                          if device_stable or device_edge else "no indexed device package")
    return out


def main(cache_only=False, refresh_alpine=False):
    captured = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if cache_only:
        pages = json.loads((ROOT / "nura-device-page-roster.json").read_text())["pages"]
        records = json.loads((ROOT / "nura-device-page-metadata.json").read_text())["pages"]
        index_sources = json.loads((ROOT / "apkindex-sources.json").read_text())["sources"]
    else:
        pages = roster()
        assert len({row["title"] for row in pages}) == len(pages)
        (ROOT / "nura-device-page-roster.json").write_text(json.dumps({"captured_at": captured, "source": API,
            "category": "Category:Devices", "count": len(pages), "pages": pages}, indent=2) + "\n")
        records = page_records(pages)
        assert len(records) == len(pages), (len(records), len(pages))
        (ROOT / "nura-device-page-metadata.json").write_text(json.dumps({"captured_at": captured, "source": API,
            "count": len(records), "pages": records}, indent=2) + "\n")
        revisions = {}
        for title in ("Devices", "All devices"):
            result = get_json({"action": "query", "prop": "revisions", "titles": title,
                               "rvprop": "ids|timestamp", "format": "json"})
            page = next(iter(result["query"]["pages"].values()))
            revisions[title] = page.get("revisions", [{}])[0]
        (ROOT / "nura-wiki-page-revisions.json").write_text(json.dumps({"captured_at": captured, "pages": revisions}, indent=2) + "\n")
        index_sources = {}

    indexes = {}
    saved_sources = json.loads((ROOT / "apkindex-sources.json").read_text())["sources"] if cache_only else {}
    alpine_saved = {}
    alpine_path = ROOT / "alpine-index-sources.json"
    if cache_only and alpine_path.exists():
        alpine_saved = json.loads(alpine_path.read_text()).get("sources", {})
    alpine_index_sources, index_conflicts = {}, {}
    for label, branch in BRANCHES.items():
        for arch in ARCHES:
            key = f"{label}/{arch}"
            if cache_only and (key not in saved_sources or "error" in saved_sources[key]):
                index_sources[key] = saved_sources.get(key, {"url": f"https://mirror.nura.eco/postmarketos/{branch}/{arch}/APKINDEX.tar.gz",
                                                              "error": "not captured"})
                continue
            try:
                packages, source = apk_records(branch, arch, cache_only=cache_only)
            except Exception as exc:
                index_sources[key] = {"url": f"https://mirror.nura.eco/postmarketos/{branch}/{arch}/APKINDEX.tar.gz", "error": str(exc)}
                continue
            pmos_packages = packages
            index_sources[key] = (saved_sources.get(key, {}) if cache_only else source) | {"package_count": len(packages)}
            alpine_cache_only = cache_only and not refresh_alpine
            try:
                alpine_packages, alpine_source = alpine_records(label, arch, cache_only=alpine_cache_only)
            except Exception as exc:
                alpine_index_sources[key] = {"url": f"https://dl-cdn.alpinelinux.org/alpine/{'v3.24' if label == 'stable' else 'edge'}/main/{arch}/APKINDEX.tar.gz",
                                             "error": str(exc)}
                # Keep device package metadata usable; report unresolved kernel
                # dependencies where the Alpine base index is absent.
                indexes[(label, arch)] = pmos_packages
                continue
            merged, conflicts = merge_indexes(pmos_packages, alpine_packages)
            indexes[(label, arch)] = merged
            alpine_index_sources[key] = (alpine_saved.get(key, {}) if alpine_cache_only else alpine_source) | {
                "package_count": len(alpine_packages), "overlap_package_count": len(conflicts),
                "version_conflicts": [row for row in conflicts if row["pmos_version"] != row["alpine_version"]]}
            if conflicts:
                index_conflicts[key] = conflicts
    (ROOT / "apkindex-sources.json").write_text(json.dumps({"captured_at": captured, "sources": index_sources}, indent=2) + "\n")
    (ROOT / "alpine-index-sources.json").write_text(json.dumps({"captured_at": captured, "sources": alpine_index_sources,
        "pmos_precedence": "For duplicate package names, postmarketOS APKINDEX records replace Alpine base records.",
        "duplicate_package_conflicts": index_conflicts}, indent=2) + "\n")

    catalog = catalog_entries()
    page_statuses = catalog_statuses(catalog)
    (ROOT / "nura-catalog-entries.json").write_text(json.dumps({"captured_at": captured,
        "source": "https://wiki.nura.eco/wiki/Devices", "count": len(catalog), "entries": catalog}, indent=2) + "\n")
    columns = ["catalog_row_id", "catalog_display_name", "catalog_codename", "catalog_architecture", "wiki_title", "wiki_url",
               "codename", "architecture", "catalog_status", "infobox_category", "booting", "packaged",
               "genericdevice", "wiki_kernel_version", "wiki_categories", "pageid", "missing",
               "stable_device_packages", "stable_package_arches", "stable_kernel_packages", "stable_kernel_origin_repo", "stable_kernel_paths", "stable_mapping_source",
               "edge_device_packages", "edge_package_arches", "edge_kernel_packages", "edge_kernel_origin_repo", "edge_kernel_paths", "edge_mapping_source", "resolution"]
    output = []
    by_title = {record["title"]: record for record in records}
    by_codename = {}
    for record in records:
        code = record["fields"].get("codename", "")
        if code:
            by_codename.setdefault(code, record)
    for record in records:
        fields = record["fields"]
        catalog_status = page_statuses.get(record["title"], "unlisted-on-devices-page")
        title_entries = [entry for entry in catalog if entry["title"] == record["title"]]
        row = {"catalog_row_id": "", "catalog_display_name": ";".join(e["display"] for e in title_entries),
               "catalog_codename": ";".join(e["codename"] for e in title_entries),
               "catalog_architecture": ";".join(e["architecture"] for e in title_entries),
               "wiki_title": record["title"], "wiki_url": "https://wiki.nura.eco/wiki/" + quote(record["title"].replace(" ", "_"), safe="()_-"),
               "pageid": record["pageid"], "missing": record["missing"], "wiki_categories": ";".join(record["categories"]),
               "codename": fields.get("codename", ""), "architecture": fields.get("architecture", ""),
               "catalog_status": catalog_status, "infobox_category": fields.get("category", ""),
               "booting": fields.get("booting", ""), "packaged": fields.get("packaged", ""),
               "genericdevice": fields.get("genericdevice", ""), "wiki_kernel_version": fields.get("pmoskernel", "")}
        row.update(resolve(record, indexes))
        output.append(row)
    output.sort(key=lambda row: (row["catalog_status"], row["wiki_title"]))
    supported_pages = [r for r in output if r["catalog_status"] in SUPPORTED]
    supported_entries = [entry for entry in catalog if entry["status"] in SUPPORTED]
    assert len(supported_entries) == 424, f"Devices page supported rows changed: {len(supported_entries)}"
    supported_rows = []
    for number, entry in enumerate(supported_entries, 1):
        record = by_title.get(entry["title"]) or by_codename.get(entry["codename"]) or {"title": "", "fields": {}, "categories": [], "pageid": "", "missing": True}
        fields = dict(record["fields"])
        merged = dict(record, fields=fields, catalog_codename=entry["codename"])
        row = {"catalog_row_id": f"{entry['status']}-{number:03d}", "catalog_display_name": entry["display"],
               "catalog_codename": entry["codename"], "catalog_architecture": entry["architecture"],
               "wiki_title": record["title"],
               "wiki_url": ("https://wiki.nura.eco/wiki/" + quote(record["title"].replace(" ", "_"), safe="()_-")) if record["title"] else "",
               "codename": fields.get("codename", ""), "architecture": fields.get("architecture", ""),
               "catalog_status": entry["status"], "infobox_category": fields.get("category", ""),
               "booting": fields.get("booting", ""), "packaged": fields.get("packaged", ""),
               "genericdevice": fields.get("genericdevice", ""), "wiki_kernel_version": fields.get("pmoskernel", ""),
               "wiki_categories": ";".join(record["categories"]), "pageid": record["pageid"], "missing": record["missing"]}
        row.update(resolve(merged, indexes))
        supported_rows.append(row)
    for filename, subset in (("nura-all-device-pages.csv", output), ("nura-supported-devices.csv", supported_rows)):
        with (ROOT / filename).open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=columns, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(subset)
    counts = {}
    for row in supported_pages:
        counts[row["catalog_status"]] = counts.get(row["catalog_status"], 0) + 1
    assert len(output) == len(pages)
    print(json.dumps({"page_count": len(pages), "metadata_records": len(records), "status_counts": counts,
                      "supported_wiki_pages": len(supported_pages), "supported_source_rows": len(supported_rows),
                      "catalog_rows": len(catalog), "catalog_status_counts": {key: sum(e["status"] == key for e in catalog) for key in sorted({e["status"] for e in catalog})},
                      "indexed_packages": {k: v.get("package_count", 0) for k, v in index_sources.items()}}, indent=2))


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-check"]:
        self_check()
        print("self-check passed")
    elif sys.argv[1:] == ["--refresh-alpine"]:
        main(cache_only=True, refresh_alpine=True)
    else:
        main(cache_only=sys.argv[1:] == ["--from-cache"])
