# LineageOS recovery roster research

`devices.json` contains the 631 unique codenames represented by 764 device YAML files in the official `LineageOS/lineage_wiki` snapshot. Duplicate variant pages are collapsed by codename; `model` is the wiki's human-readable device name, or a list when a codename has multiple names.

`official_status` is `current` when the codename appeared in the official Downloads API `/api/v2/oems` catalog during collection, and `discontinued` otherwise. This is a snapshot of catalog membership, not a promise of future support. `last_build_date` is the newest `date` returned by `/api/v2/devices/{codename}/builds`; `null` means that endpoint had no dated build (or the target was absent from the current catalog). The current catalog contained 345 targets; 344 had a dated build. The other 286 wiki codenames were absent from that catalog.

`releases.json` preserves the latest official ZIP release returned for five requested targets. The three retired Samsung targets currently return an empty builds list, represented as `latest_release: null`; Laurel Sprout and Pixel (`sailfish`) return current records. A missing release record does not imply that no historical unofficial builds exist.

## Sources and limits

- Roster and names: [LineageOS device wiki](https://wiki.lineageos.org/devices/) and the single immutable archive recorded in `snapshot.json`.
- Current target catalog: `https://download.lineageos.org/api/v2/oems`.
- Per-target metadata/builds: `https://download.lineageos.org/api/v2/devices/{codename}` and `/builds`; per-target URLs are listed in each JSON record.
- `last_build_date` uses the API's build `date`, not the device page's `current_branch` or a guessed release cadence.
- The wiki YAML files are read with a small field parser for `codename`, `name`, `models`, `versions`, and `current_branch`; no general YAML interpretation or other device facts are claimed here.
- Collected 2026-10-15/16 UTC. Re-run against the official APIs for current status and dates.
