"""Flask API for Trend Finder (trend-research & data-collection system).

Runs on http://localhost:5001. Endpoints:
  GET /api/trending?q=<query>      → top 5 trending articles (News/Reddit/HN)
  GET /api/extract?url=<article>   → ranked product/idea list (Gemini + fallback)
  GET /api/article-text?url=<url>  → cleaned article text (for the Node Gemini proxy)
  GET /api/health                  → liveness probe

CORS is enabled, though in normal use the Node server (serve.mjs, :3002)
proxies these routes so the frontend is same-origin. The Gemini API key is
read from the root .env via python-dotenv and is never sent to the browser.
"""

import os

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS

import extract
import trending

# Load the project-root .env (one level up from backend/).
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

app = Flask(__name__)
CORS(app)

RESULT_LIMIT = 5


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "gemini_configured": bool(os.environ.get("GEMINI_API_KEY"))})


@app.get("/api/trending")
def trending_endpoint():
    query = (request.args.get("q") or "").strip()
    if not query:
        return jsonify({"error": "q parameter is required"}), 400

    data = trending.get_trending(query, limit=RESULT_LIMIT)
    # attach a rank for the UI
    for i, item in enumerate(data["results"], start=1):
        item["rank"] = i
    return jsonify({"query": query, "count": len(data["results"]), **data})


@app.get("/api/extract")
def extract_endpoint():
    url = (request.args.get("url") or "").strip()
    if not url:
        return jsonify({"error": "url parameter is required"}), 400

    try:
        result = extract.extract_from_url(url)
    except extract.GoogleNewsRedirect:
        return _google_news_payload(url), 409
    except extract.ExtractError as exc:
        return jsonify({"error": str(exc), "url": url, "items": []}), 502

    return jsonify(result)


@app.get("/api/article-text")
def article_text_endpoint():
    url = (request.args.get("url") or "").strip()
    if not url:
        return jsonify({"error": "url parameter is required"}), 400

    try:
        result = extract.article_text_from_url(url)
    except extract.GoogleNewsRedirect:
        return _google_news_payload(url), 409
    except extract.ExtractError as exc:
        return jsonify({"error": str(exc), "url": url, "text": ""}), 502

    return jsonify(result)


def _google_news_payload(url):
    """Signal the frontend to ask the user for the real (redirected) URL."""
    return jsonify(
        {
            "needs_real_url": True,
            "url": url,
            "message": (
                "This is a Google News link, which redirects in the browser only. "
                "Open the article, copy the real URL (GQ, Forbes, Wirecutter, …), "
                "and paste it to extract."
            ),
            "items": [],
        }
    )


if __name__ == "__main__":
    port = int(os.environ.get("FLASK_PORT", 5001))
    app.run(host="127.0.0.1", port=port, debug=True)
