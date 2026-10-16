#!/usr/bin/env python3
"""Capture official release metadata only; never GET an image. Python stdlib."""
import datetime
from functools import cache
import json
from pathlib import Path
import re
import urllib.request
from typing import Any

ROOT = Path(__file__).resolve().parent
BASE = 'https://releases.grapheneos.org/'

SAVED: dict[tuple[str, str], Any] = {}

@cache
def request(url, method='GET'):
    if (url, method) in SAVED:
        return SAVED[url, method]
    with urllib.request.urlopen(urllib.request.Request(url, method=method), timeout=35) as response:
        if method == 'HEAD':
            return dict(response.headers)
        data = response.read(1024 * 1024 + 1)
        assert len(data) <= 1024 * 1024, 'Metadata unexpectedly large'
        return data.decode()

def collect(item):
    codename, channel, build, url = item
    row: dict[str, Any] = dict(codename=codename, channel=channel, build=build,
               release_date=f'{build[:4]}-{build[4:6]}-{build[6:8]}',
               release_date_basis='Build identifier date, not channel promotion date',
               announcement_url='https://grapheneos.org/releases#' + build,
               source_url='https://grapheneos.org/releases#' + codename,
               filename=url.rsplit('/', 1)[1], url=url, direct_url_kind='version-pinned',
               size=None, sha256=None, signature_url=url+'.sig', signature=None,
               errors=[])
    for kind, target in [('head', url), ('signature', url+'.sig'),
                         ('channel_manifest', BASE+codename+'-'+channel)]:
        try:
            data = request(target, 'HEAD' if kind == 'head' else 'GET')
            if kind == 'head':
                headers = {k.lower(): v for k, v in data.items()}
                row['size'] = int(headers['content-length']) if 'content-length' in headers else None
                row['http_headers'] = data
            else:
                row[kind] = data
                row[kind+'_url'] = target
        except Exception as exc:
            row['errors'].append(f'{target}: {exc}')
    return row

def main():
    html = (ROOT/'releases-page.html').read_text()
    rows = []
    for code, channel, body in re.findall(r'<tr id=([a-z0-9]+)-(stable|beta|alpha)>(.*?)</tr>', html, re.S):
        match = re.search(r'href=(https://releases\.grapheneos\.org/[^ >]+-install-([0-9]+)\.zip)>', body)
        if match:
            rows.append((code, channel, match[2], match[1]))
    assert rows and len(set((x[0], x[1]) for x in rows)) == len(rows)
    output = ROOT/'releases.json'
    previous = json.loads(output.read_text()) if output.exists() else {}
    for row in previous.get('releases', []):
        if row.get('http_headers'):
            SAVED[row['url'], 'HEAD'] = row['http_headers']
        for key in ('signature', 'channel_manifest'):
            if row.get(key):
                SAVED[row[key+'_url'], 'GET'] = row[key]
    complete = {(r['codename'], r['channel'], r['build']): r
                for r in previous.get('releases', [])
                if r.get('size') and r.get('signature') and r.get('channel_manifest')
                and not r.get('errors')}
    # Sequential requests and memoization prevent duplicate shared ZIP metadata requests.
    releases = [complete.get(item[:3]) or collect(item) for item in rows]
    if releases == previous.get('releases'):
        print(f'{len(releases)} complete cached channel rows reused; no requests or rewrite')
        return
    (ROOT/'releases.json').write_text(json.dumps(dict(collected_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        source_url='https://grapheneos.org/releases', releases=releases), indent=2)+'\n')
    print(f'{len(releases)} channel rows, {len(set(x["codename"] for x in releases))} devices; '
          f'{sum(x["size"] is not None for x in releases)} sizes, '
          f'{sum(bool(x["signature"]) for x in releases)} signatures')

if __name__ == '__main__':
    main()
