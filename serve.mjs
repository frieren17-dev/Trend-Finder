// serve.mjs — Trend Finder frontend server (Node, http://localhost:3002)
//
// Responsibilities:
//   1. Serve the built React app from frontend/dist (with SPA fallback).
//   2. Proxy /api/* → Flask (http://localhost:5001) so the frontend is same-origin.
//   3. /img?url=<remote>  — image proxy so Reddit/news thumbnails load (CORS/hotlink).
//   4. POST /api/gemini    — Gemini proxy: the API key stays in Node and is
//                            never sent to the browser.
//
// Zero npm dependencies — Node 18+ built-ins + global fetch only.

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, normalize, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const DIST = join(ROOT, 'frontend', 'dist')

// ── load root .env (no dependency) ──────────────────────────────────────────
async function loadEnv() {
  try {
    const raw = await readFile(join(ROOT, '.env'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
      if (m && !m[1].startsWith('#')) {
        const val = m[2].replace(/^["']|["']$/g, '')
        if (!(m[1] in process.env)) process.env[m[1]] = val
      }
    }
  } catch {
    /* no .env — that's fine for serving static files */
  }
}
await loadEnv()

const NODE_PORT = Number(process.env.NODE_PORT || 3002)
const FLASK_BASE = process.env.FLASK_BASE || 'http://localhost:5001'
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const GEMINI_KEY = (process.env.GEMINI_API_KEY || '').trim()

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

// ── 3. image proxy ──────────────────────────────────────────────────────────
async function handleImage(res, target) {
  if (!/^https?:\/\//i.test(target)) return sendJson(res, 400, { error: 'bad url' })
  try {
    const upstream = await fetch(target, { headers: { 'User-Agent': UA } })
    if (!upstream.ok) return sendJson(res, 502, { error: `image ${upstream.status}` })
    const buf = Buffer.from(await upstream.arrayBuffer())
    res.writeHead(200, {
      'content-type': upstream.headers.get('content-type') || 'image/jpeg',
      'cache-control': 'public, max-age=86400',
    })
    res.end(buf)
  } catch (err) {
    sendJson(res, 502, { error: String(err) })
  }
}

// ── 4. Gemini proxy (key stays server-side) ─────────────────────────────────
function geminiPrompt(title, text) {
  return (
    'You are extracting the main ranked list from an article (e.g. a ' +
    '"best of" / "top picks" listicle).\n' +
    'From the ARTICLE TEXT below, identify ONLY the actual ranked list of ' +
    'products or ideas the article is about. IGNORE navigation menus, ' +
    'sidebars, related-article links, ads, newsletter prompts and comments.\n' +
    'Return STRICT JSON: {"title":"<article title>","items":[{"rank":1,"idea":"<name>"}]}\n' +
    'Rank items in the order they appear. If there is no such list, return ' +
    '{"title":"...","items":[]}.\n\n' +
    `ARTICLE TITLE: ${title}\n\nARTICLE TEXT:\n${text}`
  )
}

function normalizeItems(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  raw.forEach((entry, i) => {
    const idea =
      typeof entry === 'object' && entry ? String(entry.idea ?? entry.name ?? '').trim() : String(entry).trim()
    if (!idea) return
    const rank = typeof entry === 'object' && entry && Number.isFinite(+entry.rank) ? +entry.rank : i + 1
    out.push({ rank, idea })
  })
  return out
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

async function handleGemini(req, res) {
  if (!GEMINI_KEY) return sendJson(res, 503, { error: 'GEMINI_API_KEY is not set on the server' })
  let payload
  try {
    payload = JSON.parse((await readBody(req)) || '{}')
  } catch {
    return sendJson(res, 400, { error: 'invalid JSON body' })
  }
  const { title = '', text = '' } = payload
  if (!text.trim()) return sendJson(res, 400, { error: 'text is required' })

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`
  // Retry transient overloads (5xx) only. A 429 is a free-tier rate limit —
  // fail fast so the browser can fall back to the Flask extractor.
  const RETRY = new Set([500, 502, 503, 504])
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  let lastStatus = null
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: geminiPrompt(title, text) }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
        }),
      })
      if (upstream.status === 429) {
        return sendJson(res, 429, {
          error: 'Gemini rate limit reached (HTTP 429) — free-tier quota. Try again shortly.',
        })
      }
      if (RETRY.has(upstream.status)) {
        lastStatus = upstream.status
        await sleep(1000 * (attempt + 1))
        continue
      }
      if (!upstream.ok) return sendJson(res, 502, { error: `Gemini returned HTTP ${upstream.status}` })

      const body = await upstream.json()
      const raw = body?.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
      const data = JSON.parse(raw)
      return sendJson(res, 200, { title: data.title || title, items: normalizeItems(data.items) })
    } catch {
      lastStatus = 'network'
      await sleep(1000 * (attempt + 1))
    }
  }
  return sendJson(res, 502, { error: `Gemini unavailable after retries (last: HTTP ${lastStatus})` })
}

// ── 2. proxy other /api/* → Flask ────────────────────────────────────────────
async function proxyToFlask(req, res, pathWithQuery) {
  try {
    const upstream = await fetch(FLASK_BASE + pathWithQuery, { headers: { accept: 'application/json' } })
    const text = await upstream.text()
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') || 'application/json',
    })
    res.end(text)
  } catch {
    sendJson(res, 502, {
      error: "Couldn't reach the API server. Make sure the Flask backend is running on port 5001.",
    })
  }
}

// ── 1. static files + SPA fallback ───────────────────────────────────────────
async function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname)
  if (rel === '/' || rel === '') rel = '/index.html'
  // prevent path traversal
  const filePath = normalize(join(DIST, rel))
  if (!filePath.startsWith(DIST)) return sendJson(res, 403, { error: 'forbidden' })

  try {
    const info = await stat(filePath)
    if (info.isDirectory()) throw new Error('dir')
    const data = await readFile(filePath)
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' })
    res.end(data)
  } catch {
    // SPA fallback: serve index.html for client-side routes.
    try {
      const html = await readFile(join(DIST, 'index.html'))
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('Frontend build not found. Run: npm --prefix frontend run build')
    }
  }
}

const server = createServer(async (req, res) => {
  const { pathname, searchParams, search } = new URL(req.url, `http://localhost:${NODE_PORT}`)

  if (pathname === '/img') return handleImage(res, searchParams.get('url') || '')
  if (pathname === '/api/gemini') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
    return handleGemini(req, res)
  }
  if (pathname.startsWith('/api/')) return proxyToFlask(req, res, pathname + search)
  return serveStatic(res, pathname)
})

server.listen(NODE_PORT, () => {
  console.log(`Trend Finder frontend → http://localhost:${NODE_PORT}`)
  console.log(`  serving:  ${DIST}`)
  console.log(`  api → ${FLASK_BASE}   gemini key: ${GEMINI_KEY ? 'loaded' : 'MISSING'}`)
})
