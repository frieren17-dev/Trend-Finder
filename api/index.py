"""Vercel Python serverless entrypoint.

Exposes the Flask app (WSGI ``app``) that lives in backend/server.py. All
backend routes — /api/trending, /api/extract, /api/article-text, /api/gemini,
/img, /api/health — are served by this single function on Vercel. Locally, use
`python backend/server.py` (and serve.mjs) instead.
"""

import os
import sys

# Make the backend package importable.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from server import app  # noqa: E402  (WSGI callable Vercel will serve)
