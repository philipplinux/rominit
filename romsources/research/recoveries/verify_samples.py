#!/usr/bin/env python3
"""Verify three publisher images in memory; retain metadata, never binaries."""
import hashlib, json, re
from collect import Collector, ROOT

def main():
    client = Collector()
    releases = json.loads((ROOT / 'releases.json').read_text())
    destination = ROOT / 'verified-samples.json'
    previous = json.loads(destination.read_text()) if destination.exists() else []
    result = []
    for code in ['hero2lte', 'starlte', 'star2lte']:
        saved = next((s for s in previous if s.get('codename') == code), None)
        if saved is not None:
            result.append(saved)
            continue
        release = next(r for r in releases if r['project'] == 'TWRP' and r['codename'] == code and r['filename'].endswith('.img'))
        url = release['source'].removesuffix('.html').replace('https://dl.twrp.me/', 'https://eu.dl.twrp.me/')
        try:
            expected = client.get(url + '.sha256').decode().split()[0].lower()
            assert re.fullmatch('[0-9a-f]{64}', expected)
            raw = client.get(url)
            actual = hashlib.sha256(raw).hexdigest()
            (ROOT / 'evidence' / (hashlib.sha256(url.encode()).hexdigest()[:20] + '.bin')).unlink()
            assert raw[:8] == b'ANDROID!', 'not an Android boot image'
            assert actual == expected, 'publisher hash mismatch'
            record = dict(project='TWRP', codename=code, filename=release['filename'], source=release['source'], checksum_source=url + '.sha256', size_bytes=len(raw), sha256=actual, published_sha256=expected, hash_matches=True, binary_retained=False, signature_source=url + '.asc', signature_verified=False)
            result.append(record)
            print(code, len(raw), actual, flush=True)
        except Exception as error:
            result.append(dict(project='TWRP', codename=code, source=release['source'], error=str(error)))
            print(code, str(error), flush=True)
            if client.blocked:
                break
    (ROOT / 'verified-samples.json').write_text(json.dumps(result, indent=2) + '\n')
if __name__ == '__main__':
    main()
