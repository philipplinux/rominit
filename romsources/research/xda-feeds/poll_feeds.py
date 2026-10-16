#!/usr/bin/env python3
"""Poll permitted RSS/Atom feeds and print new entries as JSONL.

The first successful run prints every entry currently present in each feed.
Seen IDs are stable keys, so edits under an existing ID are ignored.
"""
import argparse
import html
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser
from urllib.request import HTTPRedirectHandler, Request, build_opener
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parent
UA = "ROMinit/0.1 (ROM release feed feasibility research)"
BLOCKED_HOSTS = ("xdaforums.com", "xda-developers.com")
DELAY = 2.0
MAX_BYTES = 2 * 1024 * 1024
_last_request = 0.0


class PollError(Exception):
    pass


def _check_url(url):
    parts = urlsplit(url)
    if parts.scheme.lower() not in ("http", "https") or not parts.hostname or parts.username or parts.password:
        raise PollError(f"invalid feed URL: {url}")
    try:
        parts.port
    except ValueError as exc:
        raise PollError(f"invalid feed URL: {url}") from exc
    host = parts.hostname.lower()
    if any(host == blocked or host.endswith("." + blocked) for blocked in BLOCKED_HOSTS):
        raise PollError(f"XDA host is blocked for this snapshot: {host}")
    return urlunsplit((parts.scheme.lower(), parts.netloc, parts.path or "/", parts.query, ""))


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise PollError(f"redirect blocked: {req.full_url} -> {newurl}")


def _challenge(body):
    sample = body[:65536].decode("utf-8", "ignore").lower()
    return any(marker in sample for marker in ("bunny-shield", "checking your browser", "verify you are human",
                                                "captcha", "challenge-platform", "security service"))


def _fetch(url):
    global _last_request
    wait = DELAY - (time.monotonic() - _last_request)
    if wait > 0:
        time.sleep(wait)
    _last_request = time.monotonic()
    try:
        request = Request(url, headers={"User-Agent": UA})
        with build_opener(_NoRedirect()).open(request, timeout=30) as response:
            body = response.read(MAX_BYTES + 1)
            content_type = response.headers.get_content_type()
    except HTTPError as exc:
        detail = "; stopping" if exc.code in (401, 403, 429) else ""
        raise PollError(f"HTTP {exc.code} fetching {url}{detail}") from exc
    except (URLError, TimeoutError, OSError, PollError) as exc:
        raise PollError(f"fetch failed for {url}: {exc}") from exc
    if _challenge(body):
        raise PollError(f"HTML challenge returned by {url}; stopping")
    if len(body) > MAX_BYTES:
        raise PollError(f"response exceeds {MAX_BYTES} bytes: {url}")
    return content_type, body


def _robots(feed_url):
    parts = urlsplit(feed_url)
    robots_url = f"{parts.scheme}://{parts.netloc}/robots.txt"
    content_type, body = _fetch(robots_url)
    if content_type in ("text/html", "application/xhtml+xml"):
        raise PollError(f"robots.txt was HTML; refusing {feed_url}")
    lines = body.decode("utf-8", "replace").splitlines()
    # shortcut: urllib.robotparser cannot match wildcard/end-anchor paths; deny them until a full matcher is needed.
    for line in lines:
        directive = re.match(r"\s*(?:allow|disallow)\s*:\s*([^#]*)", line, re.I)
        if directive and re.search(r"[*$]", directive.group(1)):
            raise PollError("robots.txt has unsupported wildcard/end-anchor rules; failing closed")
    parser = RobotFileParser(robots_url)
    parser.parse(lines)
    if not parser.can_fetch(UA, feed_url):
        raise PollError(f"robots.txt disallows {feed_url}")


def _local(tag):
    return tag.rsplit("}", 1)[-1].lower() if isinstance(tag, str) else ""


def _plain(value):
    return " ".join(html.unescape(re.sub(r"<[^>]*>", " ", value or "")).split())


def _child_text(entry, names):
    for child in entry:
        if _local(child.tag) in names:
            return _plain("".join(child.itertext()))
    return ""


def _link(entry):
    links = [node for node in entry if _local(node.tag) == "link"]
    for node in links:
        href = node.attrib.get("href")
        if href and node.attrib.get("rel", "alternate") in ("", "alternate"):
            return href
        if not href and (node.text or "").strip():
            return node.text.strip()
    return ""


def parse_feed(body):
    try:
        root = ElementTree.fromstring(body)
    except ElementTree.ParseError as exc:
        raise PollError(f"invalid RSS/Atom XML: {exc}") from exc
    if _local(root.tag) not in ("rss", "feed", "rdf"):
        raise PollError("response root is not RSS or Atom")
    items = []
    entries = [node for node in root.iter() if _local(node.tag) in ("item", "entry")]
    for entry in entries:
        link = _link(entry)
        item_id = _child_text(entry, {"guid", "id"}) or link
        if not item_id:
            continue
        author = _child_text(entry, {"author", "creator"})
        if author:
            for node in entry:
                if _local(node.tag) == "author":
                    name = _child_text(node, {"name"})
                    if name:
                        author = name
                    break
        items.append({"id": item_id, "title": _child_text(entry, {"title"}),
                      "date": _child_text(entry, {"pubdate", "published", "updated", "date"}),
                      "author": author, "link": link,
                      "excerpt": _child_text(entry, {"description", "summary", "encoded", "content"})[:300]})
    return items


def _state_path(raw):
    path = Path(raw).expanduser().resolve()
    try:
        path.relative_to(ROOT)
    except ValueError as exc:
        raise PollError(f"state path must stay inside {ROOT}") from exc
    if path == ROOT:
        raise PollError("state path must name a file inside the research folder")
    return path


def _load_state(path):
    if not path.exists():
        return set()
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PollError(f"cannot read state file {path}: {exc}") from exc
    if not isinstance(document, dict) or set(document) != {"seen"} or not isinstance(document["seen"], list) or not all(isinstance(x, str) for x in document["seen"]):
        raise PollError(f"invalid state file {path}")
    return set(document["seen"])


def _save_state(path, seen):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as temp:
            json.dump({"seen": sorted(seen)}, temp, ensure_ascii=False)
            temp.write("\n")
            temp.flush()
            os.fsync(temp.fileno())
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def poll(feed_file, state_path):
    state_path = _state_path(state_path)
    try:
        lines = Path(feed_file).read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise PollError(f"cannot read feed list {feed_file}: {exc}") from exc
    feeds = [line.split("#", 1)[0].strip() for line in lines]
    feeds = [_check_url(url) for url in feeds if url.split("#", 1)[0].strip()]
    seen = _load_state(state_path)
    known = set(seen)
    new_items = []
    for feed in feeds:
        _robots(feed)
        _, body = _fetch(feed)
        for item in parse_feed(body):
            state_key = json.dumps([feed, item["id"]], ensure_ascii=False)
            if state_key not in known:
                known.add(state_key)
                new_items.append(item)
    if feeds:
        try:
            _save_state(state_path, known)
        except OSError as exc:
            raise PollError(f"cannot save state file {state_path}: {exc}") from exc
    return new_items


def main(argv=None):
    parser = argparse.ArgumentParser(description="Print new RSS/Atom entries as JSONL; first run prints all current entries.")
    parser.add_argument("feed_list", help="text file with one permitted feed URL per line")
    parser.add_argument("--state", required=True, help="state JSON path inside this research folder")
    args = parser.parse_args(argv)
    try:
        state_path = _state_path(args.state)
        for item in poll(args.feed_list, state_path):
            print(json.dumps(item, ensure_ascii=False))
    except PollError as exc:
        print(f"poll_feeds: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
