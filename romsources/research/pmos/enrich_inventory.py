#!/usr/bin/env python3
"""Add explicitly labeled recipe evidence to the wiki/package inventories."""
import csv
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def codenames(value: str) -> set[str]:
    return set(re.findall(r"[a-zA-Z0-9]+-[a-zA-Z0-9_-]+", value))


def main() -> None:
    recipes: dict[str, list[dict[str, str]]] = defaultdict(list)
    with (ROOT / "recipe-sources-all-devices.csv").open() as stream:
        for recipe in csv.DictReader(stream):
            recipes[recipe["device_codename"]].append(recipe)
    assert "htc-leo" in recipes and "samsung-starlte" in recipes
    for source, target in (("nura-all-device-pages.csv", "all-devices-with-kernels.csv"),
                           ("nura-supported-devices.csv", "active-devices-with-kernels.csv")):
        with (ROOT / source).open() as stream:
            rows = list(csv.DictReader(stream))
        for row in rows:
            direct = codenames(row["codename"])
            matches = [recipe for code in direct for recipe in recipes.get(code, [])]
            mapping = "direct"
            if not matches:
                title_aliases = codenames(row["wiki_title"].rsplit("(", 1)[-1])
                matches = [recipe for code in title_aliases for recipe in recipes.get(code, [])]
                mapping = "wiki title alias (infobox differs)"
            if not matches:
                mapping = "genericdevice inherited"
                matches = [recipe for code in codenames(row["genericdevice"])
                           for recipe in recipes.get(code, [])]
            versions = set()
            for recipe in matches:
                if (recipe["kernel_dependency"] and recipe["kernel_pkgver"]
                        and not any(c in recipe["kernel_pkgver"] + recipe["kernel_pkgrel"] for c in "$`")):
                    versions.add(f"{recipe['kernel_dependency']}={recipe['kernel_pkgver']}-r{recipe['kernel_pkgrel']}")
            row["recipe_kernel_packages"] = ";".join(sorted(versions))
            row["recipe_device_categories"] = ";".join(sorted({r["device_category"] for r in matches}))
            row["recipe_mapping"] = mapping if matches else ""
            row["recipe_source_urls"] = ";".join(sorted({r["kernel_recipe_url"] for r in matches if r["kernel_recipe_url"]}))
            row["recipe_unresolved"] = ";".join(sorted({r["unresolved"] for r in matches if r["unresolved"]}))
            row["kernel_evidence"] = ";".join(label for key, label in (
                ("edge_kernel_packages", "published edge"), ("stable_kernel_packages", "published stable"),
                ("recipe_kernel_packages", "source recipe (not a build test)"),
                ("wiki_kernel_version", "wiki declaration")) if row[key]) or "unresolved"
        with (ROOT / target).open("w", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
        print(target, len(rows), "rows;", sum(r["kernel_evidence"] != "unresolved" for r in rows), "with kernel evidence")


if __name__ == "__main__":
    assert codenames("oneplus-guacamoleb, oneplus-guacamole") == {"oneplus-guacamoleb", "oneplus-guacamole"}
    main()
