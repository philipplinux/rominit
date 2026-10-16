#!/usr/bin/env python3
"""Offline consistency checks for the saved recovery research snapshot."""
import csv
import datetime as dt
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
HEX = re.compile(r"^[0-9a-fA-F]+$")
DATE_FIELDS = {"last_build_date", "published", "captured_utc", "retrieved_utc", "date"}


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def url_ok(value):
    try:
        parsed = urlsplit(value)
        return parsed.scheme in ("http", "https") and bool(parsed.hostname)
    except ValueError:
        return False


def check_links(value, where, errors):
    if isinstance(value, dict):
        for key, item in value.items():
            if key in ("source", "tree", "url", "archive_url") and isinstance(item, str) and not url_ok(item):
                errors.append(f"{where}.{key}: invalid source URL {item!r}")
            elif key == "sources" and isinstance(item, list):
                for index, link in enumerate(item):
                    if not isinstance(link, str) or not url_ok(link):
                        errors.append(f"{where}.sources[{index}]: invalid source URL {link!r}")
            else:
                check_links(item, f"{where}.{key}", errors)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            check_links(item, f"{where}[{index}]", errors)


def check_dates(value, where, errors):
    if isinstance(value, dict):
        for key, item in value.items():
            if key in DATE_FIELDS and item is not None:
                try:
                    if key == "published" and str(item).endswith(" UTC"):
                        dt.datetime.strptime(str(item), "%Y-%m-%d %H:%M:%S UTC")
                    elif key in ("captured_utc", "retrieved_utc") or "T" in str(item):
                        dt.datetime.fromisoformat(str(item).replace("Z", "+00:00"))
                    else:
                        dt.date.fromisoformat(str(item))
                except ValueError:
                    errors.append(f"{where}.{key}: invalid date {item!r}")
            check_dates(item, f"{where}.{key}", errors)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            check_dates(item, f"{where}[{index}]", errors)


def check_checksums(value, where, errors):
    if isinstance(value, dict):
        for key, item in value.items():
            lengths = {"sha256": 64, "published_sha256": 64, "measured_sha256": 64, "archive_sha256": 64, "md5": 32, "checksum_md5": 32}
            if key in lengths and item is not None and (not isinstance(item, str) or len(item) != lengths[key] or not HEX.fullmatch(item)):
                errors.append(f"{where}.{key}: expected {lengths[key]} hexadecimal characters")
            check_checksums(item, f"{where}.{key}", errors)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            check_checksums(item, f"{where}[{index}]", errors)


def check_devices(path, errors):
    rows = load_json(path)
    seen = set()
    for index, row in enumerate(rows):
        identity = (row.get("project"), row.get("device_key") or row.get("codename"))
        if None in identity or identity in seen:
            errors.append(f"{path.name}[{index}]: missing or duplicate source device identity {identity!r}")
        seen.add(identity)
    return rows


def check_csv_parity(devices, errors):
    with (ROOT / "devices.csv").open(newline="", encoding="utf-8") as stream:
        csv_rows = list(csv.DictReader(stream))
    if len(csv_rows) != len(devices):
        errors.append(f"devices.csv: {len(csv_rows)} rows, devices.json: {len(devices)} rows")
        return
    fields = set().union(*(row.keys() for row in devices))
    if csv_rows and set(csv_rows[0]) != fields:
        errors.append("devices.csv: header fields differ from devices.json")
        return
    for index, (json_row, csv_row) in enumerate(zip(devices, csv_rows)):
        for key in fields:
            expected = json_row.get(key)
            actual = csv_row[key]
            if isinstance(expected, (list, dict)):
                try:
                    actual = json.loads(actual)
                except json.JSONDecodeError:
                    errors.append(f"devices.csv[{index}].{key}: invalid JSON cell")
                    continue
            elif expected is None:
                expected = ""
            if actual != expected:
                errors.append(f"devices.csv[{index}].{key}: differs from devices.json")


def check_cache(errors):
    manifest_path = ROOT / "evidence/requests.jsonl"
    entries = [json.loads(line) for line in manifest_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    urls = Counter(entry.get("url") for entry in entries)
    origins = Counter(urlsplit(entry["url"]).netloc for entry in entries if isinstance(entry.get("url"), str) and url_ok(entry["url"]))
    missing, checked = [], 0
    for index, entry in enumerate(entries):
        label = f"requests.jsonl[{index}]"
        name = entry.get("file", "")
        if not isinstance(name, str) or Path(name).name != name or not name.endswith(".bin"):
            errors.append(f"{label}: unsafe/invalid cache filename {name!r}")
            continue
        path = ROOT / "evidence" / name
        if not path.exists():
            missing.append(name)
            continue
        raw = path.read_bytes()
        checked += 1
        if len(raw) != entry.get("bytes"):
            errors.append(f"{label}: cache byte count differs for {name}")
        if hashlib.sha256(raw).hexdigest() != entry.get("sha256"):
            errors.append(f"{label}: cache SHA-256 differs for {name}")
    duplicate_count = sum(count - 1 for count in urls.values() if count > 1)
    duplicate_requests = [url for url, count in urls.items() if count > 1]
    return len(entries), checked, missing, duplicate_count, duplicate_requests, origins


def main():
    errors = []
    devices = check_devices(ROOT / "devices.json", errors)
    check_csv_parity(devices, errors)
    documents = ["devices.json", "releases.json", "verified-samples.json", "other-devices.json",
                 "lineage/verified-samples.json", "lineage/devices.json", "lineage/releases.json", "lineage/recovery-releases.json", "lineage/snapshot.json"]
    for name in documents:
        path = ROOT / name
        if not path.exists():
            continue
        data = load_json(path)
        check_links(data, name, errors)
        check_dates(data, name, errors)
        check_checksums(data, name, errors)
    for sample in load_json(ROOT / 'lineage/verified-samples.json'):
        if sample.get('hash_matches'):
            if sample['sha256'] != sample['measured_sha256'] or sample['size_bytes'] != sample['observed_size_bytes']:
                errors.append('sample publisher/measured mismatch: ' + sample['codename'])
            release = next((r for r in load_json(ROOT / 'releases.json') if all(r.get(k) == sample.get(k) for k in ('project', 'codename', 'filename'))), None)
            if release is None or release['sha256'] != sample['sha256'] or release['size_bytes'] != sample['size_bytes']:
                errors.append('combined release pin differs from sample: ' + sample['codename'])
    # Separate Lineage roster also has its own source-entry identity space.
    lineage = load_json(ROOT / "lineage/devices.json")
    identities = [(row.get("project"), row.get("codename")) for row in lineage]
    if len(identities) != len(set(identities)):
        errors.append("lineage/devices.json: duplicate project/codename identity")
    manifest_count, checked, missing, duplicate_count, duplicates, origins = check_cache(errors)
    print(f"Devices: {len(devices)}; releases: {len(load_json(ROOT / 'releases.json'))}; CSV parity: checked")
    print(f"Cache manifest: {manifest_count} requests; {checked} existing entries verified; {len(missing)} missing entries (reported separately)")
    print(f"Duplicate requests: {duplicate_count} extra entries across {len(duplicates)} URLs")
    for url in duplicates:
        print(f"  duplicate: {url}")
    print("Origins: " + ", ".join(f"{origin}={count}" for origin, count in sorted(origins.items())))
    if missing:
        print("Missing cache entries: " + ", ".join(missing))
    if errors:
        print(f"Errors: {len(errors)}")
        for error in errors:
            print("  ERROR: " + error)
        return 1
    print("Snapshot checks: passed (missing cache entries are not treated as errors)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
