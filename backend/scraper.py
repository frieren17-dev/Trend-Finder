"""Live trend scraper for the Trend Finder feature.

Scrapes live search results with requests + BeautifulSoup (no JS execution).
For each result we extract the item name, image URL (if any), source/store,
and a link to the original page.

`get_trends()` is the public entry point. It tries **eBay** first (best for
product images + store source). eBay aggressively rate-limits/blocks bots, so
if it is unavailable or yields nothing, we fall back to **DuckDuckGo** live web
results for the same query.

NOTE: these sites change their HTML periodically. The selectors here are
defensive (they try a few known variants and skip anything malformed); if
results stop appearing, this module is the single place to update. There is
intentionally NO fake/sample data: failed fetches raise, and missing fields
degrade to None rather than being invented.
"""

import time
from urllib.parse import parse_qs, quote_plus, urlparse

import requests
from bs4 import BeautifulSoup

EBAY_HOME_URL = "https://www.ebay.com/"
EBAY_SEARCH_URL = "https://www.ebay.com/sch/i.html?_nkw={query}"
DDG_SEARCH_URL = "https://html.duckduckgo.com/html/"

# eBay returns 403/429/503 to clients it suspects are bots. We retry these a
# few times with backoff after warming up a real session (see _get_session).
_RETRY_STATUSES = {403, 429, 503}
_MAX_RETRIES = 3

# A realistic desktop User-Agent. eBay returns a bot/placeholder page to
# obviously-automated clients, so we present a normal browser identity.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,*/*;q=0.8"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
}

REQUEST_TIMEOUT = 12  # seconds

# eBay's first "result" is often a promo/placeholder card with this title.
_PLACEHOLDER_TITLES = {"shop on ebay"}


class ScrapeError(Exception):
    """Raised when the upstream request or parsing fails irrecoverably."""


def _get_session():
    """Create a session and warm it up by visiting the homepage first.

    eBay hands out cookies on the homepage and is far more likely to serve a
    real (non-403) search page to a client that already holds them.
    """
    session = requests.Session()
    session.headers.update(HEADERS)
    try:
        session.get(EBAY_HOME_URL, timeout=REQUEST_TIMEOUT)
    except requests.RequestException:
        # A failed warm-up isn't fatal; the search request may still succeed.
        pass
    return session


def _fetch(url):
    """Fetch ``url`` with a warmed-up session, retrying transient bot blocks."""
    session = _get_session()
    last_status = None
    for attempt in range(_MAX_RETRIES):
        try:
            resp = session.get(url, timeout=REQUEST_TIMEOUT)
        except requests.RequestException as exc:
            raise ScrapeError(f"Failed to fetch eBay results: {exc}") from exc

        if resp.status_code not in _RETRY_STATUSES:
            resp.raise_for_status()
            return resp

        last_status = resp.status_code
        if attempt < _MAX_RETRIES - 1:
            time.sleep(1.5 * (attempt + 1))  # linear backoff
            session = _get_session()  # fresh cookies for the next try

    raise ScrapeError(
        f"eBay blocked the request (HTTP {last_status}). It may be rate-limiting; "
        "please try again shortly."
    )


def _text(node):
    return node.get_text(strip=True) if node else None


def _extract_image(item):
    """Return an image URL for a result card, or None if unavailable."""
    img = item.select_one(".s-item__image-img, img.s-item__image-img, img")
    if not img:
        return None
    # eBay lazy-loads images; the real URL may live in src or data-src.
    for attr in ("src", "data-src", "data-img-src"):
        val = img.get(attr)
        if val and val.startswith("http"):
            return val
    return None


def _parse_items(soup, limit):
    """Parse result cards from the search page into clean dicts."""
    # Primary selector, with a fallback for eBay's newer card markup.
    cards = soup.select("li.s-item") or soup.select(".s-card") or soup.select(
        "li.s-card"
    )

    results = []
    for item in cards:
        title = _text(
            item.select_one(".s-item__title, .s-card__title, [role='heading']")
        )
        link_node = item.select_one("a.s-item__link, a.s-card__link, a[href]")
        url = link_node.get("href") if link_node else None

        # Skip placeholders and malformed cards (no name or no link).
        if not title or not url:
            continue
        if title.strip().lower() in _PLACEHOLDER_TITLES:
            continue

        results.append(
            {
                "name": title,
                "image": _extract_image(item),
                "source": "eBay",
                "url": url,
            }
        )
        if len(results) >= limit:
            break

    return results


def scrape_ebay(query, limit=5):
    """Scrape eBay search results for ``query``.

    Returns a list of up to ``limit`` dicts {name, image, source, url};
    ``image`` may be None. Raises ScrapeError if the page cannot be fetched
    (e.g. eBay blocks the request).
    """
    url = EBAY_SEARCH_URL.format(query=quote_plus(query))
    resp = _fetch(url)
    soup = BeautifulSoup(resp.text, "html.parser")
    return _parse_items(soup, limit)


def _ddg_resolve_url(href):
    """Resolve a DuckDuckGo result link to the real destination URL.

    DDG HTML results point at a redirector like
    ``//duckduckgo.com/l/?uddg=<encoded-real-url>``; unwrap it when present.
    """
    if href.startswith("//"):
        href = "https:" + href
    parsed = urlparse(href)
    if "duckduckgo.com" in parsed.netloc and parsed.path.startswith("/l/"):
        target = parse_qs(parsed.query).get("uddg")
        if target:
            return target[0]
    return href


def scrape_duckduckgo(query, limit=5):
    """Scrape live DuckDuckGo web results for ``query`` (fallback source).

    DuckDuckGo's HTML endpoint rarely exposes product images, so ``image`` is
    usually None here; ``source`` is the result's domain. Returns a list of up
    to ``limit`` dicts. Raises ScrapeError if the page cannot be fetched.
    """
    session = requests.Session()
    session.headers.update(HEADERS)
    try:
        resp = session.post(
            DDG_SEARCH_URL, data={"q": query}, timeout=REQUEST_TIMEOUT
        )
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise ScrapeError(f"Failed to fetch DuckDuckGo results: {exc}") from exc

    soup = BeautifulSoup(resp.text, "html.parser")
    results = []
    for res in soup.select("div.result"):
        # Skip sponsored/ad results — they're tracking redirects, not real items.
        classes = res.get("class", [])
        if any("result--ad" in c for c in classes):
            continue

        link = res.select_one("a.result__a")
        if not link:
            continue
        name = link.get_text(strip=True)
        href = link.get("href")
        if not name or not href:
            continue

        url = _ddg_resolve_url(href)
        # Defensive: drop any remaining ad/redirect links with no clean target.
        if "duckduckgo.com/y.js" in url:
            continue
        domain = urlparse(url).netloc.replace("www.", "") or "DuckDuckGo"

        results.append({"name": name, "image": None, "source": domain, "url": url})
        if len(results) >= limit:
            break

    return results


def get_trends(query, limit=5):
    """Public entry point: return up to ``limit`` live results for ``query``.

    Tries eBay first; if eBay is blocked/unavailable or returns nothing, falls
    back to DuckDuckGo. Raises ScrapeError only if BOTH sources fail.
    """
    try:
        results = scrape_ebay(query, limit)
        if results:
            return results
    except ScrapeError:
        pass  # eBay unavailable — fall through to the backup source.

    # eBay was blocked or empty; use the live fallback.
    return scrape_duckduckgo(query, limit)


if __name__ == "__main__":
    # Quick manual test:  python scraper.py "camping gear"
    import json
    import sys

    q = sys.argv[1] if len(sys.argv) > 1 else "camping gear"
    print(json.dumps(get_trends(q), indent=2))
