"""Trending-article aggregator for Trend Finder.

Searches three live sources for a topic and merges the best 5 results:
  - Google News (RSS)
  - Reddit (search JSON)
  - Hacker News (Algolia API)

Each result is a dict: { title, link, source, image }.
``image`` may be None — the frontend falls back to a typographic thumbnail.
Every source fails independently and gracefully; if one is down, the others
still fill the list. No fake/sample data.
"""

import os
from urllib.parse import quote_plus, urlparse

import feedparser
import requests

# Tighter per-source budget on serverless (Vercel ~10s function limit); the
# three sources run sequentially, so keep each quick.
REQUEST_TIMEOUT = 7 if os.environ.get("VERCEL") else 10
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 TrendFinder/1.0"
)
HEADERS = {"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"}


def _favicon(url_or_domain):
    """Return a favicon thumbnail URL for a domain, or None."""
    if not url_or_domain:
        return None
    domain = urlparse(url_or_domain).netloc or url_or_domain
    domain = domain.replace("www.", "")
    if not domain:
        return None
    return f"https://www.google.com/s2/favicons?domain={domain}&sz=128"


def from_google_news(query, limit=5):
    """Top stories for the query from Google News RSS."""
    url = (
        "https://news.google.com/rss/search?q="
        f"{quote_plus(query)}&hl=en-US&gl=US&ceid=US:en"
    )
    # Fetch with an explicit timeout (feedparser.parse(url) has none and can hang).
    resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    feed = feedparser.parse(resp.content)
    results = []
    for entry in feed.entries[:limit]:
        source = getattr(getattr(entry, "source", None), "title", None) or "Google News"
        results.append(
            {
                "title": entry.get("title", "").strip(),
                "link": entry.get("link"),
                "source": source,
                # GN RSS rarely carries images; frontend renders a fallback.
                "image": None,
            }
        )
    return [r for r in results if r["title"] and r["link"]]


def from_reddit(query, limit=5):
    """Relevant posts for the query from Reddit search."""
    url = (
        "https://www.reddit.com/search.json?q="
        f"{quote_plus(query)}&limit={limit * 2}&sort=relevance&t=year"
    )
    resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()

    results = []
    for child in data.get("data", {}).get("children", []):
        d = child.get("data", {})
        title = (d.get("title") or "").strip()
        permalink = d.get("permalink")
        if not title or not permalink:
            continue

        # Prefer a real preview image; fall back to the thumbnail field.
        image = None
        thumb = d.get("thumbnail", "")
        if isinstance(thumb, str) and thumb.startswith("http"):
            image = thumb
        try:
            previews = d["preview"]["images"]
            if previews:
                image = previews[0]["source"]["url"].replace("&amp;", "&")
        except (KeyError, IndexError, TypeError):
            pass

        results.append(
            {
                "title": title,
                "link": "https://www.reddit.com" + permalink,
                "source": d.get("subreddit_name_prefixed") or "Reddit",
                "image": image,
            }
        )
        if len(results) >= limit:
            break
    return results


def from_hacker_news(query, limit=5):
    """Top stories for the query from Hacker News (Algolia search API)."""
    url = (
        "https://hn.algolia.com/api/v1/search?query="
        f"{quote_plus(query)}&tags=story&hitsPerPage={limit * 2}"
    )
    resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()

    results = []
    for hit in data.get("hits", []):
        title = (hit.get("title") or "").strip()
        if not title:
            continue
        link = hit.get("url") or f"https://news.ycombinator.com/item?id={hit.get('objectID')}"
        results.append(
            {
                "title": title,
                "link": link,
                "source": "Hacker News",
                "image": _favicon(hit.get("url")),
            }
        )
        if len(results) >= limit:
            break
    return results


def get_trending(query, limit=5):
    """Merge all sources and return up to ``limit`` results.

    Sources are queried independently; a failing source is skipped (logged in
    the returned ``errors`` list) so the others can still populate the feed.
    Results are interleaved round-robin for source variety and de-duplicated
    by title.
    """
    sources = [
        ("Google News", from_google_news),
        ("Reddit", from_reddit),
        ("Hacker News", from_hacker_news),
    ]

    buckets, errors = [], []
    for name, fn in sources:
        try:
            buckets.append(fn(query, limit))
        except Exception as exc:  # noqa: BLE001 - one source must not kill others
            errors.append({"source": name, "error": str(exc)})
            buckets.append([])

    # Round-robin interleave so the top 5 mixes sources.
    merged, seen = [], set()
    for i in range(max((len(b) for b in buckets), default=0)):
        for bucket in buckets:
            if i < len(bucket):
                item = bucket[i]
                key = item["title"].lower()
                if key in seen:
                    continue
                seen.add(key)
                merged.append(item)
                if len(merged) >= limit:
                    return {"results": merged, "errors": errors}
    return {"results": merged, "errors": errors}
