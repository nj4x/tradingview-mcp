#!/usr/bin/env python3
"""Fetch TradingView charting-library API pages and convert to a single markdown doc."""

import os
import re
import sys
import time
import pathlib
import urllib.parse
import requests
import html2text
from bs4 import BeautifulSoup

URLS_FILE = pathlib.Path(__file__).parent / "tv_api_reference_urls.md"
PAGES_DIR = pathlib.Path(__file__).parent / "pages"
OUTPUT_FILE = pathlib.Path(__file__).parent / "tv_api_reference.md"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

DELAY = 0.3  # seconds between requests

def parse_urls(path: pathlib.Path) -> list[str]:
    seen = set()
    urls = []
    for line in path.read_text().splitlines():
        # strip line numbers (lines may start with digits+tab from Read tool output)
        line = re.sub(r"^\d+\t", "", line)
        # extract URL — may be bare or quoted
        m = re.search(r'https?://[^\s",]+', line)
        if m:
            url = m.group(0).rstrip('",')
            if url not in seen:
                seen.add(url)
                urls.append(url)
    return urls


def url_to_filename(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    path = parsed.path.strip("/").replace("/", "__")
    return path + ".html"


def fetch_page(session: requests.Session, url: str, dest: pathlib.Path) -> str:
    """Return raw HTML, using cache if already downloaded."""
    if dest.exists():
        return dest.read_text(encoding="utf-8", errors="replace")
    try:
        resp = session.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        html = resp.text
        dest.write_text(html, encoding="utf-8")
        time.sleep(DELAY)
        return html
    except Exception as exc:
        print(f"  WARN: {exc}", file=sys.stderr)
        return ""


def extract_content(html: str) -> str:
    """Return the inner HTML of the page's main content element only.

    Docusaurus pages wrap the actual docs in:
      article > div.theme-doc-markdown.markdown

    Everything else (navbar, left sidebar index tree, breadcrumbs, mobile/desktop
    TOC, footer) is chrome that repeats identically on every page.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Remove decorative heading anchor icons (<a class="hash-link">…</a>)
    for a in soup.find_all("a", class_=lambda c: c and "hash-link" in c):
        a.decompose()

    # Primary target: the markdown content div inside <article>
    content = soup.find("div", class_=lambda c: c and "theme-doc-markdown" in c and "markdown" in c)
    if content:
        return str(content)

    # Fallback: full <article> minus breadcrumb nav and mobile TOC
    article = soup.find("article")
    if article:
        for nav in article.find_all("nav", class_=lambda c: c and "breadcrumb" in " ".join(c)):
            nav.decompose()
        for toc in article.find_all("div", class_=lambda c: c and ("tocMobile" in " ".join(c) or "tocCollapsible" in " ".join(c))):
            toc.decompose()
        return str(article)

    # Last resort: full page (original behaviour)
    return html


def html_to_markdown(html: str, source_url: str) -> str:
    content_html = extract_content(html)
    h = html2text.HTML2Text()
    h.ignore_links = False
    h.ignore_images = True
    h.body_width = 0          # don't wrap lines
    h.unicode_snob = True
    h.bypass_tables = False
    h.protect_links = True
    h.wrap_links = False
    md = h.handle(content_html)
    # trim excessive blank lines
    md = re.sub(r'\n{4,}', '\n\n\n', md)
    return md.strip()


def main():
    PAGES_DIR.mkdir(parents=True, exist_ok=True)

    urls = parse_urls(URLS_FILE)
    print(f"Found {len(urls)} URLs")

    session = requests.Session()
    chunks: list[str] = []
    failed: list[str] = []

    for i, url in enumerate(urls, 1):
        fname = url_to_filename(url)
        dest = PAGES_DIR / fname
        cached = dest.exists()
        print(f"[{i:4d}/{len(urls)}] {'(cached) ' if cached else ''}{url}")

        html = fetch_page(session, url, dest)
        if not html:
            failed.append(url)
            continue

        md = html_to_markdown(html, url)
        if not md:
            failed.append(url)
            continue

        header = f"\n\n---\n\n# Source: {url}\n\n"
        chunks.append(header + md)

    # write combined output
    combined = (
        "# TradingView Charting Library — API Reference\n\n"
        f"Auto-generated from {len(chunks)} pages on {URLS_FILE.name}\n"
    ) + "\n".join(chunks)

    OUTPUT_FILE.write_text(combined, encoding="utf-8")
    size_mb = OUTPUT_FILE.stat().st_size / 1_048_576
    print(f"\nWrote {OUTPUT_FILE} ({size_mb:.1f} MB, {len(chunks)} pages)")

    if failed:
        print(f"\nFailed ({len(failed)}):")
        for u in failed:
            print(f"  {u}")


if __name__ == "__main__":
    main()
