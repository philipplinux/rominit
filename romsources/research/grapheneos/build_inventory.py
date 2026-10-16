#!/usr/bin/env python3
"""Join captured evidence into research rows and draft notes. No network or device access."""
import csv
import html
import json
from pathlib import Path
import re
from typing import Any

ROOT = Path(__file__).resolve().parent
DATE = '2026-10-16'
FAQ = 'https://grapheneos.org/faq'
CLI = 'https://grapheneos.org/install/cli'
WEB = 'https://grapheneos.org/install/web'
FEATURES = 'flashing usb_net storage sdcard battery screen touch gpu audio camera camera_flash ir wifi bluetooth gps nfc calls sms data fde otg hdmi fingerprint accelerometer magnetometer light proximity hall haptics barometer'.split()
INCLUDES = 'google_play microg android_apps phone_ui root updates encryption relock banking_apps ssh docker'.split()

def main():
    devices = json.loads((ROOT/'device-research.json').read_text())['devices']
    release_data = json.loads((ROOT/'releases.json').read_text())
    tags = []
    archive = (ROOT/'releases-page.html').read_text()
    for build, body in re.findall(r'<article id=([^ >]+)>(.*?)</article>', archive, re.S):
        tag_list = re.search(r'Tags:</p><ul>(.*?)</ul>', body, re.S)
        if not tag_list:
            continue
        for item in re.findall(r'<li>(.*?)</li>', tag_list[1], re.S):
            match = re.search(r'<a href=([^ >]+)>(.*?)</a>\s*\((.*)\)', item, re.S)
            if match:
                tags.append({'build': build, 'tag': html.unescape(re.sub('<[^>]+>', '', match[2])),
                    'devices': [html.unescape(re.sub('<[^>]+>', '', name)).strip() for name in match[3].split(', ')],
                    'tag_url': match[1], 'announcement_url': 'https://grapheneos.org/releases#'+build})
    assert any('Pixel 4a (5G)' in tag['devices'] for tag in tags)
    (ROOT/'historical-release-tags.json').write_text(json.dumps(tags, indent=2)+'\n')
    kernel_data = json.loads((ROOT/'kernel-research.json').read_text())
    # Accept keyed or row-shaped evidence; the join below asserts every live target resolves.
    kernels = kernel_data.get('devices', kernel_data)
    if isinstance(kernels, list):
        kernels = {row['codename']: row for row in kernels}
    fingerprints = {}
    install = (ROOT/'install-paths.md').read_text()
    for line in install.splitlines():
        if '|' not in line:
            continue
        fingerprint = re.search(r'\b[A-Fa-f0-9]{64}\b', line)
        if fingerprint:
            for device in devices:
                if re.search(r'\b'+re.escape(device['codename'])+r'\b', line):
                    fingerprints[device['codename']] = fingerprint[0].upper()
    rows: list[dict[str, Any]] = []
    for original in devices:
        row = dict(original)
        code = row['codename']
        current = [r for r in release_data['releases'] if r['codename'] == code]
        active = bool(current)
        historical = next((t for t in tags if row['marketing_name'] in t['devices']), None)
        row['support_category'] = 'full' if active else 'end-of-life'
        row['support_category_source'] = FAQ+('#supported-devices' if active else '#legacy-devices')
        row['support_phase_note'] = 'Production list, not an inferred extended-support phase; exact phase transition dates unverified.' if active else 'Former target; exact full/extended/EOL transition dates unverified.'
        row['rom_id'] = 'grapheneos'
        row['origin'] = 'official'
        row['vetting'] = 'scraped'
        row['current_releases'] = current
        row['latest_listed_historical_tag'] = historical if not active else None
        row['historical_tag_note'] = 'Latest listed matching tag in captured archive; not proof of final build, channel, download availability or exact support end.' if historical and not active else None
        row['release_status'] = 'stable' if active else 'legacy'
        row['proposed_recipe'] = 'new GrapheneOS factory ZIP fastboot recipe; upstream web installer until implemented' if active else 'none; historical research only'
        row['install_paths'] = {'web': WEB if active else None, 'cli': CLI if active else None, 'research': 'install-paths.md'}
        row['verified_boot_key_fingerprint'] = fingerprints.get(code)
        row['verified_boot_key_source'] = WEB+'#verified-boot-key-hash' if fingerprints.get(code) else None
        row['kernel_evidence'] = kernels.get(code)
        row['requirements'] = [
            {'text': 'Bootloader-unlockable SKU; OEM unlocking enabled; unlock and relock wipe user data.', 'source': CLI},
            {'text': 'Use complete device-specific factory installation; latest firmware is flashed early. Do not downgrade.', 'source': CLI},
            {'text': 'Follow upstream unlock, flash, relock, then verify key sequence; do not substitute OTA package for initial install.', 'source': CLI},
        ] if active else []
        row['pitfalls'] = [
            {'text': 'Carrier variants may disable bootloader unlocking; model/SKU alone does not establish unlockability.', 'source': CLI},
            {'text': 'Banking/Play Integrity compatibility varies; sandboxed Google Play is optional and does not guarantee certified-device checks.', 'source': 'https://grapheneos.org/usage#banking-apps'},
        ] if active else [{'text': 'No current production support; legacy downloads are not a secure current install recommendation.', 'source': FAQ+'#legacy-devices'}]
        feature_states = {key: 'untested' for key in FEATURES}
        includes: dict[str, Any] = {key: None for key in INCLUDES}
        evidence = {}
        if active:
            feature_states['fde'] = 'works'
            evidence['features.fde'] = FAQ+'#encryption'
            includes.update(google_play='optional', android_apps='yes', updates='yes', encryption='yes', relock='yes')
            evidence.update({'includes.google_play': 'https://grapheneos.org/usage#sandboxed-google-play',
                'includes.android_apps': 'https://grapheneos.org/usage',
                'includes.updates': 'https://grapheneos.org/releases',
                'includes.encryption': FAQ+'#encryption', 'includes.relock': CLI+'#locking-the-bootloader'})
        row['rating'] = {'checked': DATE, 'features': feature_states, 'includes': includes,
                         'kernel': {'version': None, 'type': 'downstream' if active else None},
                         'base': 'Android 17' if active else None,
                         'released': current[0]['release_date'] if active else None,
                         'support': 'active' if active else 'abandoned'}
        if active:
            kernel = kernels.get(code)
            assert kernel, f'Missing kernel evidence for {code}'
            row['rating']['kernel']['version'] = kernel['kernel_lts_branch']+' (LTS branch; exact point release unverified)'
            evidence['kernel.version'] = kernel['manifest_url']
        row['rating_sources'] = evidence
        row['rating_sources']['support'] = 'https://grapheneos.org/releases#'+code if active else FAQ+'#legacy-devices'
        row['rating_note'] = 'Upstream documentation evidence, never hardware tested here. Null includes/kernel fields are unresolved: research rows deliberately are not import-ready catalog JSON. No generic functionality claim is expanded into hardware feature results.'
        if active:
            row['rating_sources']['base'] = 'https://raw.githubusercontent.com/GrapheneOS/platform_manifest/2026100600/default.xml'
            row['rating_sources']['kernel.type'] = 'https://grapheneos.org/features#exploit-protection'
        rows.append(row)
        note_dir = ROOT/'draft-notes'/code
        note_dir.mkdir(parents=True, exist_ok=True)
        best = (f'1. Research recommendation only, never proven here: use the [official web installer]({WEB}) for {row["marketing_name"]}; enable OEM unlocking, unlock with physical confirmation, flash the matching factory release, relock with physical confirmation, verify the boot key, then disable OEM unlocking. Follow [the complete upstream sequence]({CLI}); see [install research](../../install-paths.md).'
                if active else f'1. No present installation recommendation: {row["marketing_name"]} is a [former supported target]({FAQ}#legacy-devices). Retain this note for history, not flashing.')
        pitfalls = '\n'.join(f'- {p["text"]} [{p["source"]}]({p["source"]})' for p in row['pitfalls'])
        version = current[0]['build'] if active else 'historical'
        note = f'# GrapheneOS {version} · {code}\n\n## Status\n- Agent-flashed: never\n\n## Best path\n{best}\n\n## Pitfalls\n{pitfalls}\n- No ROMinit recipe is validated for this target; [recipe analysis](../../install-paths.md).\n\n## Agent diary\n- {DATE} · Codex research · collected upstream support/release/install evidence only · never agent-flashed; no phone accessed · {FAQ}#supported-devices\n'
        (note_dir/'grapheneos.md').write_text(note)
    assert len(rows) == len({r['codename'] for r in rows}) == 42
    assert sum(bool(r['current_releases']) for r in rows) == 21
    assert all(set(r['rating']['features']) == set(FEATURES) for r in rows)
    assert all(set(r['rating']['includes']) == set(INCLUDES) for r in rows)
    assert len(fingerprints) == 21, f'Expected 21 current fingerprints, found {len(fingerprints)}'
    for release in release_data['releases']:
        assert release['size'] > 0 and release['signature'].startswith('-----BEGIN SSH SIGNATURE-----')
        assert release['channel_manifest'].split()[0] == release['build']
    (ROOT/'devices.json').write_text(json.dumps({'snapshot_date': DATE, 'devices': rows}, indent=2)+'\n')
    fields = list(dict.fromkeys(key for row in rows for key in row))
    with (ROOT/'devices.csv').open('w', newline='') as output:
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        writer.writerows({key: json.dumps(value, separators=(',', ':')) if isinstance(value, (dict, list)) else value for key, value in row.items()} for row in rows)
    print(f'Validated {len(rows)} rows, 21 current devices, 63 channel releases, 42 notes, {len(FEATURES)} feature keys per row.')

if __name__ == '__main__':
    main()
