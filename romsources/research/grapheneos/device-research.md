# GrapheneOS device research

Snapshot: 2026-10-16. Reconstructed only from retained source captures; no network requests were made.

The roster combines the 21 production targets, 19 end-of-life consumer devices, and two source-only development boards enumerated in the captured [official FAQ](https://grapheneos.org/faq). `device-research.json` stores one row per codename. Every non-null claim has its captured source URL in `claims`; null means the saved evidence did not establish that value.

## Date and model-number limits

- `support_start_date` and `support_end_date` are null for all rows: the FAQ does not give exact GrapheneOS start or end dates for individual targets. Historical release tags are not used to infer an EOL date.
- `oem_minimum_support_end` is populated only for current Pixels where the captured FAQ gives the OEM minimum end month. It is not a GrapheneOS support-end date.
- Current model identifiers are the per-device ODM SKU values in the captured tagged GrapheneOS configuration; they identify configuration SKUs, not proof a SKU is carrier-unlockable.
- Historical Pixel model numbers are included only where found in the saved Google model/HAC captures. Nexus/Samsung and board model numbers remain null.
- Generation means the Pixel generation number when explicit in product name; Pixel Fold and Pixel Tablet labels are descriptive. Nexus and Samsung generation are null.
- Availability dates and exact historical Pixel generations are null where the retained files did not provide a clean per-device assertion.

## Saved evidence

- `sources/devices-grapheneos-faq.md` — official supported/former rosters and OEM minimum support table.
- `sources/devices-adevtool-2026100600.json` — tagged device configuration and current Pixel ODM SKU model identifiers.
- `sources/devices-google-model-numbers-hac.md`, `devices-google-pixel3-models.md`, `devices-google-pixel4-models.md` — official Google historical Pixel model identifiers.
- `sources/devices-google-availability.md` — retained Google availability listing; included as the source for generation/availability claims only where used.
- `kernel-research.json` — corroborates current supported target codenames and build mappings; it does not establish model names or support dates.

The current device scope and saved evidence also appear in `README.md` and `kernel-research.md`. No exact support transition dates were inferred.
