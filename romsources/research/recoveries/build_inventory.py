#!/usr/bin/env python3
"""Rebuild sourced inventories from pinned/cached publisher metadata."""
import csv, datetime, hashlib, html, io, json, re, tarfile
from urllib.parse import urlsplit, unquote
from collect import Collector, ROOT
TWRP_COMMIT = '3fb09c958d84d6ee86908a2b7ca069171969c64b'
ARCHIVE = 'https://codeload.github.com/TeamWin/twrpme/tar.gz/' + TWRP_COMMIT
FOX = 'https://api.orangefox.download/v3/devices'
TARGETS = ['hero2lte', 'starlte', 'star2lte', 'laurel_sprout', 'sailfish']
def frontmatter(text):
    result = {}
    for line in text.split('---', 2)[1].splitlines():
        match = re.match(r'^([a-z_]+):\s*(.*)$', line)
        if match:
            result[match[1]] = match[2].strip().strip('\"\'')
    return result

def build():
    client = Collector()
    rows, releases = [], []
    archive = tarfile.open(fileobj=io.BytesIO(client.get(ARCHIVE)))
    for member in archive:
        if not member.isfile() or not member.name.endswith('.markdown'):
            continue
        stream = archive.extractfile(member)
        assert stream is not None
        text = stream.read().decode()
        if not text.startswith('---'):
            continue
        data = frontmatter(text)
        if data.get('layout') != 'device' or not data.get('codename'):
            continue
        path = member.name.split('/', 1)[1]
        row = dict(device_key=path, project='TWRP', codename=data['codename'], model=data.get('title'), vendor=data.get('oem'), official_status='official listing', support_status=data.get('supportstatus'), maintainers=data.get('maintainer'), last_build_date=None, last_build_date_status='not enumerated: no bulk release index found', downloadfolder=data.get('downloadfolder'), tree=data.get('devicetree'), sources=['https://github.com/TeamWin/twrpme/blob/' + TWRP_COMMIT + '/' + path], install_includes=re.findall(r'include ([^ ]+install[^ ]*)', text))
        rows.append(row)
    for code in TARGETS:
        url = 'https://dl.twrp.me/' + code + '/'
        page = client.get(url).decode()
        found = []
        for match in re.finditer(r'<tr><td><a href="([^"]+)">([^<]+)</a></td><td>.*?<small>([^<]+)</small>.*?<em>\s*([^<]+)</em>', page, re.S):
            link, name, size, date = match.groups()
            found.append(dict(project='TWRP', codename=code, filename=html.unescape(name), version=name.removeprefix('twrp-').split('-' + code)[0], size_display=size, size_bytes=None, published=date.strip(), source='https://dl.twrp.me' + link, sha256=None, signature=None, verification='metadata only'))
        for release in found:
            checksum_url = release['source'].removesuffix('.html') + '.sha256'
            cached = ROOT / 'evidence' / (hashlib.sha256(checksum_url.encode()).hexdigest()[:20] + '.bin')
            if cached.exists():
                digest = cached.read_text().split()[0].lower()
                assert re.fullmatch('[0-9a-f]{64}', digest)
                release.update(sha256=digest, checksum_source=checksum_url, verification='publisher SHA-256 only; binary verification failed')
        releases.extend(found)
        for row in rows:
            if row['project'] == 'TWRP' and code in (row.get('downloadfolder') or '').split('|'):
                row.update(last_build_date=max(r['published'] for r in found)[:10] if found else None, last_build_date_status='download index timestamp, not device support proof', sources=row['sources'] + [url])
    fox = json.loads(client.get(FOX))['data']
    for data in fox:
        rows.append(dict(project='OrangeFox', codename=data['codename'], aliases=data.get('codenames'), model=data.get('full_name'), vendor=data.get('oem_name'), official_status='official listing', support_status='supported' if data['supported'] else 'unsupported', maintainers=None, last_build_date=None, last_build_date_status='not yet resolved', sources=[FOX, data['url']]))
    fox_url = 'https://api.orangefox.download/v3/releases?limit=100'
    fox_releases = json.loads(client.get(fox_url))['data']
    fox_releases += json.loads(client.get('https://api.orangefox.download/v3/releases?device_id=5e59825a77c93477b29eaea4'))['data']
    fox_by_id = {d['id']: d['codename'] for d in fox}
    for data in fox_releases:
        code = fox_by_id.get(data['device_id'])
        published = datetime.datetime.fromtimestamp(data['date'], datetime.timezone.utc).isoformat()
        releases.append(dict(project='OrangeFox', codename=code, filename=data['filename'], version=data['version'], size_bytes=data['size'], published=published, source=data['url'], sha256=None, md5=data.get('md5'), mirrors=data.get('mirrors'), archived=data.get('archived'), signature=None, verification='publisher metadata only; MD5 is not SHA-256', metadata_source=('https://api.orangefox.download/v3/releases?device_id=5e59825a77c93477b29eaea4' if code == 'laurel_sprout' else fox_url)))
        for row in rows:
            if row['project'] == 'OrangeFox' and row['codename'] == code and (not row['last_build_date'] or published[:10] > row['last_build_date']):
                row.update(last_build_date=published[:10], last_build_date_status='latest observed in bounded API sample; not exhaustive', sources=row['sources'] + [fox_url])
    for filename in ['lineage/devices.json','other-devices.json']:
        path = ROOT / filename
        if path.exists():
            data = json.loads(path.read_text())
            rows.extend(data['records'] if isinstance(data, dict) else data)
    reborn_url = 'https://raw.githubusercontent.com/SHRP-Reborn/device_data/d046ee3c216432c76b281aaae196b893fa97b6eb/deviceData.json'
    reborn = json.loads(client.get(reborn_url))
    reborn_codes = set()
    for item in reborn:
        if not item.get('codeName'):
            continue
        reborn_codes.add(item['codeName'])
        rows.append(dict(project='SHRP Reborn', codename=item['codeName'], model=item['model'], vendor=item['brand'], maintainers=item['maintainer'], official_status='official metadata listing', last_build_date=None, last_build_date_status='not provided; filename date not independently verified', upstream_release=item['currentVersion'], latest_build=item['latestBuild'], sources=[reborn_url]))
    repo_url = 'https://api.github.com/orgs/SHRP-Reborn/repos?per_page=100'
    for repo in json.loads(client.get(repo_url)):
        if repo['name'].startswith('android_device_'):
            code = repo['name'].split('_', 3)[-1]
            if code not in reborn_codes:
                rows.append(dict(project='SHRP Reborn', codename=code, model=None, official_status='device tree only', last_build_date=None, tree_last_pushed_at=repo['pushed_at'], sources=[repo['html_url'], repo_url]))
    for row in rows:
        url = row.get('latest_build') or ''
        if '.zip/download' in url or url.endswith('.img'):
            releases.append(dict(project=row['project'], codename=row['codename'], filename=unquote(urlsplit(url).path.removesuffix('/download').split('/')[-1]), version=row.get('upstream_release'), size_bytes=None, published=None, source=row['sources'][-1], url=url, sha256=None, md5=row.get('checksum_md5'), signature=None, verification='static publisher metadata; artifact availability and digest not independently checked'))
    path = ROOT / 'lineage/releases.json'
    if path.exists():
        releases.extend(json.loads(path.read_text()))
    recovery_path = ROOT / 'lineage/recovery-releases.json'
    if recovery_path.exists():
        for artifact in json.loads(recovery_path.read_text())['targets']:
            releases.append(dict(artifact, published=artifact['build_date'], source='https://download.lineageos.org/api/v2/devices/' + artifact['codename'] + '/builds', artifact_kind='recovery boot image', verification='publisher SHA-256 metadata; signature not verified'))
    sample_path = ROOT / 'verified-samples.json'
    samples = json.loads(sample_path.read_text()) if sample_path.exists() else []
    lineage_samples = ROOT / 'lineage/verified-samples.json'
    if lineage_samples.exists():
        samples += json.loads(lineage_samples.read_text())
    for release in releases:
        for sample in samples:
            if sample.get('hash_matches') and all(release.get(key) == sample.get(key) for key in ('project', 'codename', 'filename')):
                release.update(sha256=sample['sha256'], size_bytes=sample['size_bytes'], verification='download matches publisher SHA-256; signature not verified')
    for filename, data in [('devices.json', rows), ('releases.json', releases)]:
        (ROOT / filename).write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    fields = sorted(set().union(*(row.keys() for row in rows)))
    with (ROOT / 'devices.csv').open('w', newline='') as output:
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        writer.writerows({key: json.dumps(value, ensure_ascii=False) if isinstance(value, (list, dict)) else value for key, value in row.items()} for row in rows)
    assert len({(row['project'], row.get('device_key', row['codename'])) for row in rows}) == len(rows), 'duplicate project/device identity'
    assert all(row.get('sources') for row in rows)
    print(len(rows), 'device rows;', len(releases), 'release rows')
if __name__ == '__main__':
    assert frontmatter('---\ncodename: "test"\n---')['codename'] == 'test'
    build()
