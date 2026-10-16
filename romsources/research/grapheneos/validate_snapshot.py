#!/usr/bin/env python3
"""Offline acceptance checks; never contacts a server or device. Python stdlib."""
import csv
import json
from pathlib import Path
import re
import runpy
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent


def main():
    rows = json.loads((ROOT / 'devices.json').read_text())['devices']
    releases = json.loads((ROOT / 'releases.json').read_text())['releases']
    assert len(rows) == len({r['codename'] for r in rows}) == 42
    assert len(list(csv.DictReader((ROOT / 'devices.csv').open()))) == 42
    live = [r for r in rows if r['current_releases']]
    assert len(live) == 21 and len(releases) == 63
    assert len({(r['codename'], r['channel']) for r in releases}) == 63
    for row in live:
        hashes = row['verified_boot_key_fingerprint']
        assert re.fullmatch('[A-F0-9]{64}', hashes)
        for source in ('install-web.md', 'install-cli.md'):
            assert hashes.lower() in (ROOT / 'sources' / source).read_text().lower()
        assert {r['channel'] for r in row['current_releases']} == {'stable', 'beta', 'alpha'}
    for release in releases:
        assert not release['errors']
        assert release['size'] == int(release['http_headers']['Content-Length'])
        assert release['filename'] == release['url'].rsplit('/', 1)[1]
        assert release['signature'].startswith('-----BEGIN SSH SIGNATURE-----\n')
        assert release['channel_manifest'].split()[0] == release['build']
    notes = list((ROOT / 'draft-notes').glob('*/grapheneos.md'))
    assert len(notes) == 42
    for note in notes:
        text = note.read_text()
        for heading in ('## Status', '## Best path', '## Pitfalls', '## Agent diary'):
            assert heading in text
        assert 'Agent-flashed: never' in text
        for relative in re.findall(r'\]\((\.{1,2}/[^)]+)\)', text):
            assert (note.parent / relative).resolve().exists(), relative
    before = (ROOT / 'releases.json').read_bytes()
    with patch('urllib.request.urlopen', side_effect=AssertionError('Unexpected network request')):
        runpy.run_path(str(ROOT / 'collect_releases.py'), run_name='__main__')
    assert before == (ROOT / 'releases.json').read_bytes()
    print('PASS: 42 JSON/CSV rows, 63 releases, 21 source-matched boot keys, 42 notes; cached collector makes no requests or rewrites.')


if __name__ == '__main__':
    main()
