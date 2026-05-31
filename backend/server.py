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

import requests
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request
from flask_cors import CORS

import extract
import gemini
import trending

PROXY_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

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


@app.post("/api/gemini")
def gemini_proxy():
    """Run Gemini on supplied article text (Browse & Pick path).

    The key stays server-side. Folded in from serve.mjs so a single serverless
    function covers all backend routes on Vercel.
    """
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "text is required"}), 400
    try:
        result = gemini.extract_ideas(title, text)
    except gemini.GeminiUnavailable as exc:
        msg = str(exc)
        code = 429 if "rate limit" in msg.lower() else 502
        return jsonify({"error": msg, "items": []}), code
    return jsonify(result)


@app.get("/img")
def img_proxy():
    """Stream a remote image (so Reddit/news thumbnails load past CORS/hotlink)."""
    target = (request.args.get("url") or "").strip()
    if not (target.startswith("http://") or target.startswith("https://")):
        return jsonify({"error": "bad url"}), 400
    try:
        r = requests.get(target, headers={"User-Agent": PROXY_UA}, timeout=10)
        r.raise_for_status()
    except requests.RequestException:
        return jsonify({"error": "image fetch failed"}), 502
    return Response(
        r.content,
        mimetype=r.headers.get("content-type", "image/jpeg"),
        headers={"Cache-Control": "public, max-age=86400"},
    )


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
