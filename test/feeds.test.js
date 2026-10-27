import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseFeed } from '../scripts/feeds.mjs';

test('release feeds: RSS, RDF and Atom entries parse to guid, title, link and date', () => {
  assert.deepEqual(parseFeed(`<rss><channel><title>Arch</title><item><title>2026.10.01 &amp; more</title><link>https://archlinux.org/releng/releases/2026.10.01/</link>
    <guid isPermaLink="false">arch-2026.10.01</guid><pubDate>Thu, 01 Oct 2026 00:00:00 +0000</pubDate></item></channel></rss>`),
  [{ guid: 'arch-2026.10.01', title: '2026.10.01 & more', link: 'https://archlinux.org/releng/releases/2026.10.01/', published: 'Thu, 01 Oct 2026 00:00:00 +0000' }]);
  assert.deepEqual(parseFeed(`<rdf:RDF><channel><items><rdf:Seq/></items></channel><item rdf:about="https://www.debian.org/News/2026/20261011">
    <title><![CDATA[Debian 13.7 released]]></title><dc:date>2026-10-11</dc:date></item></rdf:RDF>`),
  [{ guid: 'https://www.debian.org/News/2026/20261011', title: 'Debian 13.7 released', link: 'https://www.debian.org/News/2026/20261011', published: '2026-10-11' }]);
  assert.deepEqual(parseFeed(`<feed><title>Releases</title><entry><id>tag:github.com,2008:Repository/1/v3.1</id><link rel="alternate" type="text/html" href="https://github.com/o/r/releases/tag/v3.1"/>
    <title type="html">v3.1</title><updated>2026-10-20T10:00:00Z</updated></entry></feed>`),
  [{ guid: 'tag:github.com,2008:Repository/1/v3.1', title: 'v3.1', link: 'https://github.com/o/r/releases/tag/v3.1', published: '2026-10-20T10:00:00Z' }]);
});

test('release feeds: every listed feed is an https URL or null', () => {
  for (const [os, url] of Object.entries(JSON.parse(readFileSync(new URL('../catalog/feeds/os-pc.json', import.meta.url), 'utf8'))))
    assert.ok(url === null || /^https:\/\/[^\s]+$/.test(url), os);
});
