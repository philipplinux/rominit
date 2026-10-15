#!/usr/bin/env python3
"""Statically map pmaports device recipes to kernel APKBUILDs."""

from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
from pathlib import Path


PROJECT = "https://gitlab.postmarketos.org/postmarketOS/pmaports"
FIELDS: tuple[str, ...] = (
    "snapshot_commit",
    "device_category",
    "device_package",
    "device_codename",
    "device_pkgver",
    "device_pkgrel",
    "device_recipe_path",
    "device_recipe_url",
    "kernel_dependency",
    "kernel_category",
    "kernel_pkgver",
    "kernel_pkgrel",
    "kernel_recipe_path",
    "kernel_recipe_url",
    "kernel_project_url",
    "kernel_source_url_templates",
    "kernel_source_commit",
    "kernel_source_tag",
    "unresolved",
)


def _quote_end(text: str, quote: str) -> int | None:
    escaped = False
    for pos, char in enumerate(text):
        if escaped:
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == quote:
            return pos
    return None


def parse_assignments(text: str) -> dict[str, list[str]]:
    """Read top-level assignments as text; never source or execute APKBUILD."""
    lines = text.splitlines()
    found: dict[str, list[str]] = {}
    pos = 0
    while pos < len(lines):
        line = lines[pos]
        if re.match(r"^\s*(?:function\s+)?[A-Za-z_][A-Za-z0-9_]*\s*\(\)\s*\{", line):
            break
        match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
        if not match:
            pos += 1
            continue
        name, rhs = match.groups()
        rhs = rhs.strip()
        if rhs.startswith(("\"", "'")):
            quote = rhs[0]
            chunks = [rhs[1:]]
            end = _quote_end(chunks[0], quote)
            while end is None and pos + 1 < len(lines):
                pos += 1
                chunks.append(lines[pos])
                end = _quote_end(chunks[-1], quote)
            if end is None:
                value = "\n".join(chunks)
            else:
                chunks[-1] = chunks[-1][:end]
                value = "\n".join(chunks)
        else:
            value = rhs.split("#", 1)[0].strip()
        found.setdefault(name, []).append(value)
        pos += 1
    return found


def one(values: dict[str, list[str]], key: str) -> tuple[str, str]:
    choices = values.get(key, [])
    unique = list(dict.fromkeys(choices))
    if not unique:
        return "", ""
    if len(unique) > 1:
        return "", f"multiple {key} assignments"
    return unique[0], ""


def literal(value: str) -> bool:
    return bool(value) and "$" not in value and "`" not in value and "$((" not in value


def read_recipe(path: Path, root: Path) -> dict[str, object]:
    values = parse_assignments(path.read_text(errors="replace"))
    relative = path.relative_to(root).as_posix()
    pkgname, pkgname_issue = one(values, "pkgname")
    pkgver, pkgver_issue = one(values, "pkgver")
    pkgrel, pkgrel_issue = one(values, "pkgrel")
    if not literal(pkgname):
        pkgname = path.parent.name
        pkgname_issue = pkgname_issue or "pkgname is not a static literal; directory name used as label"
    if not literal(pkgver):
        pkgver_issue = pkgver_issue or "pkgver is not a static literal"
    if not literal(pkgrel):
        pkgrel_issue = pkgrel_issue or "pkgrel is not a static literal"
    category = path.relative_to(root).parts[1]
    source, _ = one(values, "source")
    source_url_templates = []
    for line in source.splitlines():
        item = line.strip().strip("\"'")
        if "::" in item:
            item = item.split("::", 1)[1]
            if re.match(r"(?:https?|git)://|^\$[A-Za-z_][A-Za-z0-9_]*(?:/|$)", item):
                source_url_templates.append(item)
        elif re.match(r"(?:https?|git)://", item):
            source_url_templates.append(item)
    project_url, _ = one(values, "url")
    commit, _ = one(values, "_commit")
    tag, _ = one(values, "_tag")
    repository, _ = one(values, "_repository")
    branch, _ = one(values, "_branch")
    revisions = {key: one(values, key)[0] for key in ("_commit", "_tag", "_repository", "_branch")}
    return {
        "path": relative,
        "category": category,
        "package": pkgname,
        "pkgname_issue": pkgname_issue,
        "pkgver": pkgver,
        "pkgrel": pkgrel,
        "pkgver_issue": pkgver_issue,
        "pkgrel_issue": pkgrel_issue,
        "depends": one(values, "depends")[0],
        "depends_issue": one(values, "depends")[1],
        "project_url": project_url if literal(project_url) else "",
        "source_url_templates": list(dict.fromkeys(source_url_templates)),
        "source_commit": commit if literal(commit) else "",
        "source_tag": tag if literal(tag) else "",
        "source_revision_dynamic": bool((commit and not literal(commit)) or (tag and not literal(tag))),
        "source_revision_fields": revisions,
        "source_raw": source,
    }


def kernel_dependencies(depends: str) -> tuple[list[str], list[str]]:
    names: list[str] = []
    unresolved: list[str] = []
    for token in re.split(r"\s+", depends.strip()):
        token = token.strip("\"'`,")
        if not token.startswith("linux-") or token.startswith("linux-firmware-"):
            continue
        name = re.split(r"[<>=~]", token, maxsplit=1)[0]
        if "$" in token or not re.fullmatch(r"linux-[A-Za-z0-9][A-Za-z0-9_.+-]*", name):
            unresolved.append(f"dynamic kernel dependency {token}")
        else:
            names.append(name)
    return list(dict.fromkeys(names)), unresolved


def recipe_url(commit: str, path: str) -> str:
    return f"{PROJECT}/-/blob/{commit}/{path}"


def build_records(
    devices: list[dict[str, object]],
    kernels: dict[str, list[dict[str, object]]],
    commit: str,
) -> tuple[list[dict[str, str]], int, int]:
    records: list[dict[str, str]] = []
    unresolved_device_paths: set[str] = set()
    matched_links = 0
    for device in devices:
        reasons: list[str] = []
        for key in ("pkgname_issue", "pkgver_issue", "pkgrel_issue", "depends_issue"):
            if device[key]:
                reasons.append(str(device[key]))
        package_names, dependency_issues = kernel_dependencies(str(device["depends"]))
        reasons.extend(dependency_issues)
        if not package_names:
            reasons.append("no static linux-* dependency found in device APKBUILD depends")
        outputs: list[dict[str, object] | None] = []
        for name in package_names:
            candidates = kernels.get(name, [])
            if len(candidates) == 1:
                outputs.append(candidates[0])
                matched_links += 1
            else:
                outputs.append(None)
                why = "no current device/* kernel APKBUILD found" if not candidates else "multiple current kernel APKBUILDs found"
                reasons.append(f"{name}: {why}")
        if not outputs:
            outputs = [None]
        for name, kernel in zip(package_names or [""], outputs):
            row_reasons = list(reasons)
            if kernel is not None:
                for key in ("pkgver_issue", "pkgrel_issue"):
                    if kernel[key]:
                        row_reasons.append(str(kernel[key]))
                if kernel["source_revision_dynamic"]:
                    row_reasons.append("kernel source _commit/_tag is dynamic")
                if not kernel["source_commit"] and not kernel["source_tag"]:
                    row_reasons.append("kernel source commit/tag not stated as a static _commit/_tag")
                if not kernel["source_url_templates"]:
                    row_reasons.append("kernel source URL not statically captured")
            if row_reasons:
                unresolved_device_paths.add(str(device["path"]))
            package = str(device["package"])
            kernel_url_templates = kernel["source_url_templates"] if kernel else []
            row = {
                "snapshot_commit": commit,
                "device_category": str(device["category"]),
                "device_package": package,
                "device_codename": package[len("device-"):] if package.startswith("device-") else package,
                "device_pkgver": str(device["pkgver"]),
                "device_pkgrel": str(device["pkgrel"]),
                "device_recipe_path": str(device["path"]),
                "device_recipe_url": recipe_url(commit, str(device["path"])),
                "kernel_dependency": name,
                "kernel_category": str(kernel["category"]) if kernel else "",
                "kernel_pkgver": str(kernel["pkgver"]) if kernel else "",
                "kernel_pkgrel": str(kernel["pkgrel"]) if kernel else "",
                "kernel_recipe_path": str(kernel["path"]) if kernel else "",
                "kernel_recipe_url": recipe_url(commit, str(kernel["path"])) if kernel else "",
                "kernel_project_url": str(kernel["project_url"]) if kernel else "",
                "kernel_source_url_templates": json.dumps(kernel_url_templates, ensure_ascii=False),
                "kernel_source_commit": str(kernel["source_commit"]) if kernel else "",
                "kernel_source_tag": str(kernel["source_tag"]) if kernel else "",
                "unresolved": " | ".join(dict.fromkeys(row_reasons)),
            }
            records.append(row)
    return records, matched_links, len(unresolved_device_paths)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pmaports", type=Path, help="checkout of the official pmaports repository")
    args = parser.parse_args()
    root = args.pmaports.resolve()
    tree = root / "device"
    if not tree.is_dir():
        parser.error(f"{root} does not contain device/")
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=root, check=True, capture_output=True, text=True
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        parser.error("pmaports source must be a Git checkout so the snapshot commit is recorded")

    all_recipes = [read_recipe(path, root) for path in sorted(tree.glob("*/*/APKBUILD"))]
    kernels: dict[str, list[dict[str, object]]] = {}
    for recipe in all_recipes:
        if str(recipe["package"]).startswith("linux-"):
            kernels.setdefault(str(recipe["package"]), []).append(recipe)

    devices = [recipe for recipe in all_recipes if str(recipe["package"]).startswith("device-")]
    archived = [recipe for recipe in devices if recipe["category"] == "archived"]
    records, matched_links, unresolved_count = build_records(archived, kernels, commit)
    all_device_records, all_device_links, all_device_unresolved = build_records(devices, kernels, commit)

    # Tiny parser checks plus a dataset integrity check for every archived device recipe.
    assert parse_assignments('pkgname=linux-demo\npkgver="6.1"\ndepends="linux-demo"\n') == {
        "pkgname": ["linux-demo"], "pkgver": ["6.1"], "depends": ["linux-demo"]
    }
    assert kernel_dependencies("postmarketos-base linux-demo linux-other=6.1-r0") == (
        ["linux-demo", "linux-other"], []
    )
    assert archived and len({str(row["device_recipe_path"]) for row in records}) == len(archived)
    assert all(row["device_recipe_path"].startswith("device/archived/device-") for row in records)
    assert len({str(row["device_recipe_path"]) for row in all_device_records}) == len(devices)

    output_dir = Path(__file__).resolve().parent
    csv_path = output_dir / "archived-recipes.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(records)
    all_csv_path = output_dir / "recipe-sources-all-devices.csv"
    with all_csv_path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(all_device_records)
    manifest = {
        "source_project": PROJECT,
        "source_default_branch": "main",
        "source_commit": commit,
        "source_commit_url": f"{PROJECT}/-/commit/{commit}",
        "source_tree": "device/*/device-*/APKBUILD and matching kernel APKBUILDs under device/*/",
        "regeneration": "python archived-recipes.py /path/to/pmaports-checkout",
        "method": "Read APKBUILD text only. Static top-level pkgname/pkgver/pkgrel/depends/source/url/_commit/_tag fields are extracted; APKBUILD shell is never executed. Device-to-kernel links use explicit linux-* tokens in depends. Source URL templates are retained without expanding shell variables; the recipe url field is recorded separately.",
        "interpretation": "These are package recipes present at the snapshot commit, including archived/unmaintained recipes. Recipe presence and package version do not establish maintained support or a bootable port. pkgver/pkgrel are APK package versions, not necessarily uname -r.",
        "counts": {
            "archived_device_recipes": len(archived),
            "output_rows": len(records),
            "static_device_to_kernel_links_resolved": matched_links,
            "device_recipes_with_unresolved_items": unresolved_count,
            "current_device_kernel_recipes_indexed": len(kernels),
            "all_device_recipes": len(devices),
            "all_device_output_rows": len(all_device_records),
            "all_device_static_kernel_links_resolved": all_device_links,
            "all_device_recipes_with_unresolved_items": all_device_unresolved,
        },
        "known_limits": [
            "Computed, conditional, or indirect shell values remain blank or are marked unresolved; the parser does not evaluate them.",
            "Only explicit linux-* package tokens in the device recipe depends field create a mapping.",
            "Source URL templates and the separate recipe url field are preserved as written; templates may contain unresolved shell variables.",
        ],
    }
    (output_dir / "recipe-sources.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(manifest["counts"], sort_keys=True))


if __name__ == "__main__":
    main()
