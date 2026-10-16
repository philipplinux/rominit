"""Offline checks for the XDA feed polling proof of concept."""
import sys
sys.dont_write_bytecode = True

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import poll_feeds


ROOT = poll_feeds.ROOT
RSS = b'''<?xml version="1.0"?>
<rss version="2.0"><channel><item>
  <title>LineageOS 21 update</title><link>https://example.test/thread/7</link>
  <guid>thread-7</guid><pubDate>Thu, 15 Oct 2026 10:00:00 GMT</pubDate>
  <dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">builder</dc:creator>
  <description><![CDATA[Build <b>released</b>]]></description>
</item></channel></rss>'''
ATOM = b'''<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><entry>
  <id>tag:example.test,2026:release-9</id><title>Pixel ROM build</title>
  <updated>2026-10-16T08:30:00Z</updated>
  <author><name>maintainer</name></author>
  <link rel="self" href="https://example.test/thread/9/feed"/>
  <link href="https://example.test/thread/9"/>
  <summary type="html">New &lt;b&gt;build&lt;/b&gt; available</summary>
</entry></feed>'''


class ParseFeedTests(unittest.TestCase):
    def test_parses_rss_fields_and_cleans_excerpt(self):
        self.assertEqual(poll_feeds.parse_feed(RSS), [{
            "id": "thread-7",
            "title": "LineageOS 21 update",
            "date": "Thu, 15 Oct 2026 10:00:00 GMT",
            "author": "builder",
            "link": "https://example.test/thread/7",
            "excerpt": "Build released",
        }])

    def test_parses_atom_author_and_alternate_link(self):
        self.assertEqual(poll_feeds.parse_feed(ATOM), [{
            "id": "tag:example.test,2026:release-9",
            "title": "Pixel ROM build",
            "date": "2026-10-16T08:30:00Z",
            "author": "maintainer",
            "link": "https://example.test/thread/9",
            "excerpt": "New build available",
        }])


class PollTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT)
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.feed_list = self.folder / "feeds.txt"
        self.feed_list.write_text("https://feeds.example.test/forum/4.rss\n", encoding="utf-8")
        self.state = self.folder / "state.json"

    def test_deduplicates_items_across_polls(self):
        first = b'''<rss><channel>
          <item><guid>a</guid><title>A</title><link>https://example.test/a</link></item>
        </channel></rss>'''
        second = b'''<rss><channel>
          <item><guid>a</guid><title>A edited</title><link>https://example.test/a</link></item>
          <item><guid>b</guid><title>B</title><link>https://example.test/b</link></item>
        </channel></rss>'''
        with patch.object(poll_feeds, "_robots") as robots, patch.object(
            poll_feeds, "_fetch", side_effect=[("application/rss+xml", first), ("application/rss+xml", second)]
        ) as fetch:
            initial = poll_feeds.poll(self.feed_list, self.state)
            later = poll_feeds.poll(self.feed_list, self.state)

        self.assertEqual([item["id"] for item in initial], ["a"])
        self.assertEqual([item["id"] for item in later], ["b"])
        self.assertEqual(robots.call_count, 2)
        self.assertEqual(fetch.call_count, 2)
        self.assertEqual(json.loads(self.state.read_text(encoding="utf-8"))["seen"], [
            '["https://feeds.example.test/forum/4.rss", "a"]',
            '["https://feeds.example.test/forum/4.rss", "b"]',
        ])

    def test_parse_and_robots_failures_preserve_existing_state(self):
        original = '{"seen":["prior-entry"]}\n'
        for failure in ("parse", "blocked"):
            with self.subTest(failure=failure):
                self.state.write_text(original, encoding="utf-8")
                if failure == "parse":
                    robots = patch.object(poll_feeds, "_robots")
                    fetch = patch.object(poll_feeds, "_fetch", return_value=("application/xml", b"<broken"))
                else:
                    robots = patch.object(poll_feeds, "_robots", side_effect=poll_feeds.PollError("robots disallow"))
                    fetch = patch.object(poll_feeds, "_fetch")
                with robots as check_robots, fetch as get_feed:
                    with self.assertRaises(poll_feeds.PollError):
                        poll_feeds.poll(self.feed_list, self.state)
                self.assertEqual(self.state.read_text(encoding="utf-8"), original)
                if failure == "blocked":
                    get_feed.assert_not_called()

    def test_rejects_xda_and_confined_state_paths_before_network(self):
        xda_list = self.folder / "xda.txt"
        xda_list.write_text("https://xdaforums.com/device/threads.rss\n", encoding="utf-8")
        with patch.object(poll_feeds, "_robots") as robots, patch.object(poll_feeds, "_fetch") as fetch:
            with self.assertRaisesRegex(poll_feeds.PollError, "XDA host is blocked"):
                poll_feeds.poll(xda_list, self.state)
            with self.assertRaisesRegex(poll_feeds.PollError, "state path must stay inside"):
                poll_feeds.poll(self.feed_list, ROOT.parent / "outside-state.json")
        robots.assert_not_called()
        fetch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
