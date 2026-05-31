"""Gemini Flash helper — TEXT ANALYSIS ONLY (no image generation).

Sends an article's text to Gemini and asks for the real ranked list of
products/ideas the article is about, ignoring navigation, sidebars and ads.
The API key is read from the environment (loaded from the root .env) and is
never returned to or exposed in the browser.
"""

import json
import os
import time

import requests

GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)
DEFAULT_MODEL = "gemini-2.5-flash"
TIMEOUT = 45

# Gemini is frequently, transiently OVERLOADED (5xx) — retry those with backoff.
# A 429 is a RATE LIMIT (free-tier quota): retrying it quickly just burns more
# quota, so we fail fast and let the caller fall back to the HTML parser.
_RETRY_STATUSES = {500, 502, 503, 504}
_MAX_RETRIES = 4


class GeminiUnavailable(Exception):
    """Raised when Gemini can't be used (no key) or returns nothing usable."""


def api_key():
    return os.environ.get("GEMINI_API_KEY", "").strip()


def model_name():
    return os.environ.get("GEMINI_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL


def build_prompt(article_title, article_text):
    return (
        "You are extracting the main ranked list from an article (e.g. a "
        '"best of" / "top picks" listicle).\n'
        "From the ARTICLE TEXT below, identify ONLY the actual ranked list of "
        "products or ideas the article is about. IGNORE navigation menus, "
        "sidebars, related-article links, ads, newsletter prompts and comments.\n"
        "Return STRICT JSON of the form:\n"
        '{"title": "<article title>", "items": [{"rank": 1, "idea": "<product or idea name>"}]}\n'
        "Rank items in the order they appear. If the article has no ranked list "
        'of products/ideas, return {"title": "...", "items": []}.\n\n'
        f"ARTICLE TITLE: {article_title}\n\n"
        f"ARTICLE TEXT:\n{article_text}"
    )


def extract_ideas(article_title, article_text):
    """Ask Gemini for the ranked idea list.

    Returns {"title": str, "items": [{"rank": int, "idea": str}]}.
    Raises GeminiUnavailable when no key is set or the response is unusable.
    """
    key = api_key()
    if not key:
        raise GeminiUnavailable("GEMINI_API_KEY is not set")
    if not (article_text or "").strip():
        raise GeminiUnavailable("No article text to analyze")

    url = GEMINI_URL.format(model=model_name())
    payload = {
        "contents": [{"parts": [{"text": build_prompt(article_title, article_text)}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2},
    }

    last_status = None
    for attempt in range(_MAX_RETRIES):
        try:
            # NOTE: never let the key reach an exception string — pass it as a
            # param and inspect status_code ourselves (raise_for_status would
            # embed the full URL incl. key in the error).
            resp = requests.post(url, params={"key": key}, json=payload, timeout=TIMEOUT)
        except requests.RequestException:
            last_status = "network"
            time.sleep(1.0 * (attempt + 1))
            continue

        if resp.status_code == 429:
            raise GeminiUnavailable(
                "Gemini rate limit reached (HTTP 429) — free-tier quota. "
                "Wait a moment and retry, or use a billed key."
            )
        if resp.status_code in _RETRY_STATUSES:
            last_status = resp.status_code
            time.sleep(1.0 * (attempt + 1))  # linear backoff
            continue
        if resp.status_code != 200:
            raise GeminiUnavailable(f"Gemini returned HTTP {resp.status_code}")

        try:
            body = resp.json()
            text = body["candidates"][0]["content"]["parts"][0]["text"]
            data = json.loads(text)
        except (KeyError, IndexError, ValueError) as exc:
            raise GeminiUnavailable(f"Gemini response was unparseable: {exc}") from exc

        items = _normalize_items(data.get("items"))
        if not items:
            raise GeminiUnavailable("Gemini returned no ranked items")
        return {"title": data.get("title") or article_title, "items": items}

    raise GeminiUnavailable(f"Gemini unavailable after {_MAX_RETRIES} tries (last: HTTP {last_status})")


def _normalize_items(raw):
    """Coerce Gemini's items into clean {rank, idea} dicts."""
    if not isinstance(raw, list):
        return []
    items = []
    for i, entry in enumerate(raw, start=1):
        if isinstance(entry, dict):
            idea = str(entry.get("idea") or entry.get("name") or "").strip()
            rank = entry.get("rank")
        else:
            idea = str(entry).strip()
            rank = None
        if not idea:
            continue
        items.append({"rank": int(rank) if isinstance(rank, (int, float)) else i, "idea": idea})
    return items
