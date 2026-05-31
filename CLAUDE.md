# CLAUDE.md

## Project Overview
Trend Finder is a **trend-research & data-collection** web tool. For any topic
(e.g. "camping gear", "kitchen tools", "photography accessories") it lets a user:
1. **Find trending articles** for the topic (Google News, Reddit, Hacker News).
2. **Extract the ranked list of products/ideas** from an article using **Gemini Flash**.
3. **Select** which ideas to keep (checkboxes in an Idea Panel).
4. **Export** the selected ideas to **CSV** (opens cleanly in Excel/Google Sheets).

## Tech Stack
- **Frontend:** React (scaffolded with Vite) — component-based, no plain HTML/CSS pages.
- **Styling:** Editorial "Trend Index" design system (warm paper, vermilion accent,
  Fraunces + Space Mono) defined in `frontend/src/styles/index.css`; per-component CSS modules.
- **Frontend server:** Node.js `serve.mjs` (zero deps) — serves the built app + proxies.
- **Backend:** Python + Flask (CORS enabled).
- **Scraping/Parsing:** `requests`, `beautifulsoup4`, `feedparser`.
- **AI (text only):** Google **Gemini Flash** — used to identify the real ranked list
  in an article. **No image generation.**
- **No fake/sample data** — results come from live sources; failures degrade gracefully.

## Two-Server Architecture
Two servers run simultaneously:

| Server | Port | Role |
| ------ | ---- | ---- |
| **Node** (`serve.mjs`) | **3002** | Serves the built React app (`frontend/dist`). Proxies `/api/*` → Flask, handles `/img` (image proxy for thumbnails) and `/api/gemini` (Gemini proxy — key stays server-side). |
| **Flask** (`backend/server.py`) | **5001** | Data + extraction API. |

The frontend is **same-origin** to the Node server (all requests go to `:3002`).

## Backend Endpoints (Flask, :5001)
- `GET /api/trending?q=<query>` — searches **Google News RSS + Reddit + Hacker News**,
  merges and returns the **top 5** results. Each: `{ rank, title, link, source, image }`.
- `GET /api/extract?url=<article_url>` — fetches the article, extracts full text, and
  sends it to **Gemini Flash** to return the real ranked list (ignoring nav/sidebars/ads):
  `{ title, url, items: [{ rank, idea }], method }`. **Gemini is primary; an HTML
  pattern-matching parser is the fallback** when Gemini is unavailable/unusable.
- `GET /api/article-text?url=<url>` — returns cleaned article text `{ title, url, text }`,
  used by the Browse & Pick flow which runs Gemini via the Node proxy.
- `GET /api/health` — liveness + whether the Gemini key is configured.

Google News links use a browser-only redirect a server can't follow. When `/api/extract`
or `/api/article-text` hits one, it responds `409` with `{ needs_real_url: true, message }`
so the frontend shows a yellow warning + "Open article ↗" link + a paste box.

## Node Server (`serve.mjs`, :3002)
- Serves `frontend/dist` with SPA fallback.
- `GET /img?url=<remote>` — streams a remote image (so Reddit/news thumbnails load).
- `POST /api/gemini` (body `{ title, text }`) — calls Gemini with the server-side key and
  returns `{ title, items }`. The key is **never** sent to the browser.
- All other `/api/*` → proxied to Flask `:5001`.

## Environment / Keys
- A single **root `.env`** holds secrets; both servers read it.
  - `GEMINI_API_KEY` (required for Gemini), `GEMINI_MODEL` (default `gemini-2.0-flash`),
    `FLASK_PORT=5001`, `NODE_PORT=3002`, `FLASK_BASE=http://localhost:5001`.
- `.env` is git-ignored; `.env.example` documents the keys. Never hardcode the key or
  expose it to the browser.

## Frontend — Trend Finder page
- Search bar → calls `/api/trending` → renders results as **article cards**
  (`rank`, title, source, thumbnail) each with two buttons:
  - **Extract Ideas** — `/api/extract`; adds the ranked ideas to the Idea Panel.
  - **Browse & Pick** — opens a popup that gets article text + runs Gemini (via the Node
    proxy) and shows the ideas as a **checklist** to pick before adding to the panel.
- **Idea Panel** (right side) — collected ideas as checkbox items; **Preview** (table) and
  **Export CSV** buttons. CSV is UTF-8 (with BOM) for Excel/Sheets.
- Google News redirect → yellow warning + paste box (paste the real URL, press Enter).

## Project Structure
```
Trend Finder/
├── serve.mjs                 # Node frontend server + proxies (:3002)
├── package.json              # root scripts (build / serve)
├── .env                      # secrets (git-ignored) — you create this
├── .env.example
├── backend/                  # Flask API (:5001)
│   ├── server.py             # endpoints
│   ├── trending.py           # Google News + Reddit + HN aggregator
│   ├── extract.py            # article fetch/clean + ranked-list extraction + fallback
│   ├── gemini.py             # Gemini Flash helper (text only)
│   └── requirements.txt
└── frontend/                 # React + Vite
    └── src/
        ├── api/research.js   # API client + CSV helpers
        ├── components/       # ArticleCard, IdeaPanel, BrowsePickModal, PreviewModal,
        │                     #   GoogleNewsNotice, Modal, Layout, Header, Nav
        ├── pages/            # Home, TrendFinder
        └── styles/index.css  # shared design system
```

## Run locally (two servers)
```powershell
# 1) Backend (Flask :5001)
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python server.py

# 2) Frontend (build once, then Node :3002)  — in a second terminal, from repo root
npm run build          # installs + builds frontend → frontend/dist
npm run serve          # node serve.mjs  → http://localhost:3002
```
Open **http://localhost:3002**. Add your key to `.env` first (copy `.env.example`).
For live frontend iteration: `npm run dev:frontend` (rebuilds on change) alongside `npm run serve`.

## Notes
- `backend/scraper.py` is **legacy** (the old eBay/DuckDuckGo product search) and is no
  longer used by the app.
- Reddit/eBay may rate-limit datacenter IPs; sources fail independently so the others
  still populate results.
