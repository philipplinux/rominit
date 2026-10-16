#!/usr/bin/env python3
"""Polite cached HTTP evidence collection; Python stdlib only."""
import argparse, hashlib, json, time, urllib.request, urllib.error, urllib.robotparser
from pathlib import Path
from urllib.parse import urlsplit
ROOT = Path(__file__).resolve().parent
UA = 'ROMinit-research/1.0 (+https://github.com/philipplinux/rominit; research snapshot)'
class Collector:
    def __init__(self):
        self.robots = {}
        self.blocked = set()
    def get(self, url):
        host = '{0.scheme}://{0.netloc}'.format(urlsplit(url))
        if host in self.blocked:
            raise RuntimeError('host previously blocked: ' + host)
        cache = ROOT / 'evidence' / (hashlib.sha256(url.encode()).hexdigest()[:20] + '.bin')
        if cache.exists():
            return cache.read_bytes()
        if host not in self.robots:
            robot = urllib.robotparser.RobotFileParser(host + '/robots.txt')
            try:
                robots_url = host + '/robots.txt'
                robots_cache = ROOT / 'evidence' / (hashlib.sha256(robots_url.encode()).hexdigest()[:20] + '.bin')
                if robots_cache.exists():
                    raw = robots_cache.read_bytes()
                else:
                    req = urllib.request.Request(robots_url, headers={'User-Agent': UA})
                    with urllib.request.urlopen(req, timeout=45) as response:
                        raw = response.read()
                    self.save(robots_url, raw)
                robot.parse(raw.decode(errors='replace').splitlines())
            except urllib.error.HTTPError as error:
                if error.code == 404:
                    robot.parse([])
                else:
                    self.blocked.add(host)
                    raise
            self.robots[host] = robot
        robot = self.robots[host]
        if not robot.can_fetch(UA, url):
            raise RuntimeError('robots disallows ' + url)
        time.sleep(max(1, robot.crawl_delay(UA) or 0))
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=90) as response:
                raw = response.read()
            self.save(url, raw)
            return raw
        except urllib.error.HTTPError as error:
            if error.code in (401, 403, 429):
                self.blocked.add(host)
            raise
    def save(self, url, raw):
        directory = ROOT / 'evidence'
        directory.mkdir(exist_ok=True)
        name = hashlib.sha256(url.encode()).hexdigest()[:20] + '.bin'
        (directory / name).write_bytes(raw)
        with (directory / 'requests.jsonl').open('a') as out:
            out.write(json.dumps({'url': url, 'file': name, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(), 'retrieved_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}) + '\n')
if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('urls', nargs='+')
    args = parser.parse_args()
    client = Collector()
    for url in args.urls:
        try:
            raw = client.get(url)
            print(url, len(raw), raw[:180])
        except Exception as error:
            print(url, type(error).__name__, str(error))
