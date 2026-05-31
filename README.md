# Trend Finder

Type any topic (e.g. "camping gear") and get the **Top 5 trending items** scraped
**live** from the web — each shown as a card with the item name, image, source, and a
link that opens the original page in a new tab. No fake or sample data.

Results come from **eBay** first (best for product images + store names). eBay
aggressively blocks bots, so if it's unavailable the backend automatically falls back
to **live DuckDuckGo** web results for the same query. Each card's "source" reflects
where the result actually came from.

- **Frontend:** React (Vite) + react-router-dom — `frontend/`
- **Backend:** Python + Flask + requests + BeautifulSoup (CORS enabled) — `backend/`

```
Trend Finder/
├── frontend/                 # React + Vite app
│   └── src/
│       ├── components/       # Layout, Header, Nav, ResultCard (reusable shell + cards)
│       ├── pages/            # Home, TrendFinder
│       ├── api/trends.js     # API client (getTrends)
│       └── styles/index.css  # shared design tokens + globals
└── backend/
    ├── server.py             # Flask API:  GET /api/trends?query=<topic>
    ├── scraper.py            # live scraper: eBay primary + DuckDuckGo fallback
    └── requirements.txt
```

## Prerequisites
- Node.js 18+ and npm
- Python 3.10+

## 1) Run the backend (terminal 1)

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1          # Windows PowerShell
#   source .venv/bin/activate        # macOS/Linux
pip install -r requirements.txt
python server.py                     # serves http://localhost:5000
```

Quick check:

```powershell
curl "http://localhost:5000/api/trends?query=camping+gear"
```

Returns JSON like:

```json
{
  "query": "camping gear",
  "count": 5,
  "results": [
    { "name": "...", "image": "https://... or null", "source": "eBay", "url": "https://..." }
  ]
}
```

## 2) Run the frontend (terminal 2)

```powershell
cd frontend
npm install
npm run dev                          # serves http://localhost:5173
```

Open **http://localhost:5173**, click the **Trend Finder** tab, type a topic, and hit
Search. The Vite dev server proxies `/api/*` to the Flask backend on port 5000, so both
must be running.

> To call the API at a different URL instead of using the proxy, copy `frontend/.env.example`
> to `frontend/.env` and set `VITE_API_BASE` (CORS is enabled server-side).

## API

`GET /api/trends?query=<topic>`

| Status | Meaning |
| ------ | ------- |
| `200`  | `{ query, count, results: [...] }` — up to 5 live items |
| `400`  | `query` parameter missing/blank |
| `502`  | both upstream sources failed |

Each result: `{ name, image, source, url }`. `image` is `null` when no image is
available (cards show a graceful "No image" placeholder — common for DuckDuckGo results).

## Notes on live scraping
eBay employs bot protection and rate limiting. The scraper warms up a browser-like
session and retries transient blocks (`backend/scraper.py`). If eBay still blocks or
returns nothing, the request transparently falls back to live DuckDuckGo results, so the
feature keeps working. Only when **both** sources fail does the API return `502` and the
UI show an error — it never fabricates data. These sites change their HTML periodically;
if results stop appearing, update the selectors in `backend/scraper.py` — the single
place that touches site markup.
