// API client for the Trend Finder research system.
//
// All requests are same-origin: the Node server (serve.mjs, :3002) serves this
// app and proxies /api/* to Flask (:5001), handles /api/gemini itself (key stays
// server-side), and proxies thumbnails via /img.

async function getJson(url, opts) {
  let res
  try {
    res = await fetch(url, opts)
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new Error('Could not reach the server. Are both servers running?')
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    /* non-JSON body */
  }
  if (!res.ok && res.status !== 409) {
    if (data?.error) throw new Error(data.error)
    if ([502, 503, 504].includes(res.status)) {
      throw new Error('Could not reach the API server. Make sure both servers are running.')
    }
    throw new Error(`Request failed (HTTP ${res.status})`)
  }
  return { data, status: res.status }
}

/** Proxy a remote image through the Node server (avoids CORS/hotlink blocks). */
export function img(url) {
  return url ? `/img?url=${encodeURIComponent(url)}` : ''
}

/** Top 5 trending articles for a topic. */
export async function getTrending(query, signal) {
  const { data } = await getJson(`/api/trending?q=${encodeURIComponent(query)}`, { signal })
  return data?.results || []
}

/**
 * Extract the ranked idea list from an article (Gemini primary + HTML fallback).
 * Returns { needsRealUrl, message, title, url, items, method }.
 */
export async function extractIdeas(url, signal) {
  const { data, status } = await getJson(`/api/extract?url=${encodeURIComponent(url)}`, { signal })
  if (status === 409 || data?.needs_real_url) {
    return { needsRealUrl: true, message: data?.message, url }
  }
  return { needsRealUrl: false, title: data?.title, url: data?.url || url, items: data?.items || [], method: data?.method }
}

/** Fetch cleaned article text (used by Browse & Pick before the Gemini proxy). */
export async function getArticleText(url, signal) {
  const { data, status } = await getJson(`/api/article-text?url=${encodeURIComponent(url)}`, { signal })
  if (status === 409 || data?.needs_real_url) {
    return { needsRealUrl: true, message: data?.message, url }
  }
  return { needsRealUrl: false, title: data?.title, url, text: data?.text || '' }
}

/** Run Gemini on article text via the Node proxy (key never reaches the browser). */
export async function geminiExtract({ title, text }, signal) {
  const { data } = await getJson('/api/gemini', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, text }),
    signal,
  })
  return { title: data?.title || title, items: data?.items || [] }
}

/**
 * Browse & Pick: get article text, then extract ideas via the Node Gemini proxy.
 * Returns { needsRealUrl, message, title, url, items }.
 */
export async function browseAndExtract(url, signal) {
  const article = await getArticleText(url, signal)
  if (article.needsRealUrl) return article
  try {
    const { title, items } = await geminiExtract({ title: article.title, text: article.text }, signal)
    return { needsRealUrl: false, title, url, items }
  } catch (err) {
    if (err.name === 'AbortError') throw err
    // Gemini proxy unavailable (e.g. quota) — fall back to the Flask extractor,
    // which uses Gemini-or-HTML-parser. Keeps Browse & Pick working.
    const fb = await extractIdeas(url, signal)
    return { needsRealUrl: false, title: fb.title || article.title, url, items: fb.items || [] }
  }
}

/** Build a UTF-8 CSV (with BOM, so Excel/Sheets open it cleanly). */
export function toCsv(rows) {
  const headers = ['Rank', 'Idea', 'Source', 'Article', 'Article URL']
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [headers.map(esc).join(',')]
  rows.forEach((r) => {
    lines.push([r.rank, r.idea, r.source, r.articleTitle, r.articleUrl].map(esc).join(','))
  })
  return '﻿' + lines.join('\r\n')
}

/** Trigger a client-side CSV download. */
export function downloadCsv(rows, filename = 'trendfinder-ideas.csv') {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
