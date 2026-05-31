"""Article extraction for Trend Finder.

Fetches an article, pulls out its readable text, and turns it into a ranked
list of products/ideas. Gemini Flash is the PRIMARY method (see gemini.py);
a lightweight HTML pattern matcher is the FALLBACK when Gemini is unavailable
or returns nothing usable.

Google News links use a browser-only redirect a server can't follow, so we
detect them and signal the frontend to ask the user for the real URL.
"""

import os
import re
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

import gemini

# Shorter fetch budget on serverless (Vercel ~10s function limit).
REQUEST_TIMEOUT = 8 if os.environ.get("VERCEL") else 12
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}
MAX_TEXT_CHARS = 24000  # keep the Gemini prompt within a sane size


class ExtractError(Exception):
    """Raised when the article cannot be fetched."""


class GoogleNewsRedirect(Exception):
    """Raised for Google News links the server cannot resolve."""


def is_google_news_url(url):
    host = urlparse(url or "").netloc.lower()
    return host.endswith("news.google.com") or host.endswith("google.com/rss")


def fetch_article(url):
    """Fetch the article HTML. Raises GoogleNewsRedirect / ExtractError."""
    if is_google_news_url(url):
        raise GoogleNewsRedirect(url)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise ExtractError(f"Could not fetch the article: {exc}") from exc

    # Some Google News links 30x into the real article — but many bounce
    # through a JS interstitial that lands back on google.com.
    if is_google_news_url(resp.url):
        raise GoogleNewsRedirect(url)
    return resp.text


def clean_article(html):
    """Return (title, readable_text) with chrome/boilerplate stripped."""
    soup = BeautifulSoup(html, "html.parser")

    title = ""
    if soup.title and soup.title.string:
        title = soup.title.string.strip()
    h1 = soup.find("h1")
    if h1 and h1.get_text(strip=True):
        title = h1.get_text(strip=True)

    for tag in soup(["script", "style", "nav", "header", "footer", "aside", "form", "noscript"]):
        tag.decompose()

    main = soup.find("article") or soup.find("main") or soup.body or soup
    text = main.get_text("\n", strip=True)
    text = re.sub(r"\n{2,}", "\n", text)
    return title, text[:MAX_TEXT_CHARS]


# ── fallback ranked-list parser ─────────────────────────────────────────────
_NUM_PREFIX = re.compile(r"^\s*(\d{1,3})\s*[\.\):\-]\s+(.{3,120})")


def _looks_like_citation(text):
    return text.startswith("^") or "Retrieved" in text or "Archived from" in text


def fallback_extract(html):
    """Heuristically pull a ranked list from the HTML without Gemini.

    Strategy: prefer numbered headings (h2/h3 like "1. Product") — the common
    listicle structure — then the longest non-citation <ol>. Best effort only.
    """
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "header", "footer", "aside"]):
        tag.decompose()

    items = []

    # 1) Numbered headings (canonical "best of" listicle structure).
    for h in soup.find_all(["h2", "h3"]):
        m = _NUM_PREFIX.match(h.get_text(" ", strip=True))
        if m:
            items.append({"rank": int(m.group(1)), "idea": m.group(2).strip()})

    # 2) Longest ordered list that isn't a references/footnotes block.
    if not items:
        def is_refs(ol):
            classes = " ".join(ol.get("class", [])).lower()
            pid = (ol.parent.get("id", "") if ol.parent else "").lower()
            return "reference" in classes or "footnote" in classes or "reference" in pid

        candidates = [ol for ol in soup.find_all("ol") if not is_refs(ol)]
        best_ol = max(candidates, key=lambda ol: len(ol.find_all("li")), default=None)
        if best_ol and len(best_ol.find_all("li")) >= 3:
            for i, li in enumerate(best_ol.find_all("li"), start=1):
                idea = li.get_text(" ", strip=True)
                if idea and not _looks_like_citation(idea):
                    items.append({"rank": i, "idea": idea[:160]})

    # de-dupe & renumber sequentially
    seen, cleaned = set(), []
    for it in items:
        k = it["idea"].lower()
        if k in seen:
            continue
        seen.add(k)
        cleaned.append({"rank": len(cleaned) + 1, "idea": it["idea"]})
    return cleaned[:25]


def article_text_from_url(url):
    """Fetch + clean an article → {title, url, text}.

    Used by the Browse & Pick flow, which runs Gemini via the Node proxy
    (serve.mjs) so the API key stays server-side in Node.
    Raises GoogleNewsRedirect / ExtractError like ``extract_from_url``.
    """
    html = fetch_article(url)
    title, text = clean_article(html)
    return {"title": title or url, "url": url, "text": text}


def extract_from_url(url):
    """Full pipeline → {title, url, items, method}.

    Raises GoogleNewsRedirect for unresolvable Google News links and
    ExtractError when the article can't be fetched.
    """
    html = fetch_article(url)
    title, text = clean_article(html)

    # PRIMARY: Gemini.
    try:
        result = gemini.extract_ideas(title, text)
        return {"title": result["title"], "url": url, "items": result["items"], "method": "gemini"}
    except gemini.GeminiUnavailable:
        pass  # fall through to the HTML parser

    # FALLBACK: HTML pattern matching.
    items = fallback_extract(html)
    return {"title": title or url, "url": url, "items": items, "method": "fallback"}
