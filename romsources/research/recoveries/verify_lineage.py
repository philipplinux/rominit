#!/usr/bin/env python3
"""Check recovery pins, reusing saved download attestations across interrupted runs."""
import hashlib, json
from collect import Collector, ROOT

def main():
    client = Collector()
    manifest = [json.loads(line) for line in (ROOT / 'evidence/requests.jsonl').read_text().splitlines()]
    destination = ROOT / 'lineage/verified-samples.json'
    previous = json.loads(destination.read_text()) if destination.exists() else []
    result = []
    for artifact in json.loads((ROOT / 'lineage/recovery-releases.json').read_text())['targets']:
        saved = next((s for s in previous if s['url'] == artifact['url']), None)
        if saved is not None:
            result.append(saved)
            continue
        record = dict(artifact, hash_matches=False, signature_verified=False, binary_retained=False)
        attestation = next((m for m in manifest if m['url'] == artifact['url']), None)
        try:
            if attestation is not None:
                size, digest = attestation['bytes'], attestation['sha256']
                record['verification_basis'] = 'saved collector download attestation; binary already deleted; no repeat download'
                record['retrieved_utc'] = attestation['retrieved_utc']
            else:
                raw = client.get(artifact['url'])
                size, digest = len(raw), hashlib.sha256(raw).hexdigest()
                (ROOT / 'evidence' / (hashlib.sha256(artifact['url'].encode()).hexdigest()[:20] + '.bin')).unlink()
                record['verification_basis'] = 'downloaded bytes measured in this resumed run; binary deleted'
            record.update(observed_size_bytes=size, measured_sha256=digest)
            record['hash_matches'] = digest == artifact['sha256'] and size == artifact['size_bytes']
            if not record['hash_matches']:
                record['error'] = 'download does not match publisher size/SHA-256; not verified'
        except Exception as error:
            record['error'] = str(error)
        result.append(record)
        destination.write_text(json.dumps(result, indent=2) + '\n')
        print(artifact['codename'], record.get('hash_matches'), record.get('error'), flush=True)
        if client.blocked:
            break
    destination.write_text(json.dumps(result, indent=2) + '\n')
if __name__ == '__main__':
    main()
