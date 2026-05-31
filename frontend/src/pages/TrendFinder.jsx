import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getTrending, extractIdeas, downloadCsv } from '../api/research.js'
import ArticleCard from '../components/ArticleCard.jsx'
import IdeaPanel from '../components/IdeaPanel.jsx'
import BrowsePickModal from '../components/BrowsePickModal.jsx'
import PreviewModal from '../components/PreviewModal.jsx'
import GoogleNewsNotice from '../components/GoogleNewsNotice.jsx'
import styles from './TrendFinder.module.css'

export default function TrendFinder() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [articles, setArticles] = useState([])
  const [status, setStatus] = useState('idle') // idle | loading | success | error
  const [error, setError] = useState('')
  const [lastQuery, setLastQuery] = useState('')

  const [ideas, setIdeas] = useState([])
  const [working, setWorking] = useState({}) // { [url]: 'extract' | 'browse' }
  const [browseArticle, setBrowseArticle] = useState(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [gnews, setGnews] = useState(null) // { article, message } for Extract Ideas

  const abortRef = useRef(null)
  const isLoading = status === 'loading'

  // ── search ────────────────────────────────────────────────────────────────
  async function runSearch(topic) {
    const trimmed = topic.trim()
    if (!trimmed) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStatus('loading')
    setError('')
    setLastQuery(trimmed)
    try {
      const items = await getTrending(trimmed, controller.signal)
      setArticles(items)
      setStatus('success')
    } catch (err) {
      if (err.name === 'AbortError') return
      setError(err.message || 'Search failed.')
      setArticles([])
      setStatus('error')
    }
  }

  useEffect(() => {
    const q = searchParams.get('q')
    if (q && q.trim()) runSearch(q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSubmit(e) {
    e.preventDefault()
    const t = query.trim()
    if (!t) return
    setSearchParams({ q: t }, { replace: true })
    runSearch(t)
  }

  // ── idea collection ─────────────────────────────────────────────────────────
  function addIdeas(items, ctx) {
    setIdeas((prev) => {
      const have = new Set(prev.map((i) => i.id))
      const additions = items
        .map((it) => ({
          id: `${ctx.articleUrl}::${it.idea}`.toLowerCase(),
          rank: it.rank,
          idea: it.idea,
          articleTitle: ctx.articleTitle,
          source: ctx.source,
          articleUrl: ctx.articleUrl,
          checked: true,
        }))
        .filter((it) => !have.has(it.id))
      return [...prev, ...additions]
    })
  }

  async function doExtract(article, overrideUrl) {
    const url = overrideUrl || article.url
    setWorking((w) => ({ ...w, [article.url]: 'extract' }))
    setGnews(null)
    try {
      const res = await extractIdeas(url)
      if (res.needsRealUrl) {
        setGnews({ article, message: res.message })
        return
      }
      if (!res.items.length) {
        setGnews(null)
        setError('')
        alert('No ranked list of ideas was found in that article.')
        return
      }
      addIdeas(res.items, {
        articleTitle: article.title,
        source: article.source,
        articleUrl: url,
      })
    } catch (err) {
      alert(err.message || 'Extraction failed.')
    } finally {
      setWorking((w) => ({ ...w, [article.url]: null }))
    }
  }

  // panel actions
  const toggle = (id) => setIdeas((p) => p.map((i) => (i.id === id ? { ...i, checked: !i.checked } : i)))
  const remove = (id) => setIdeas((p) => p.filter((i) => i.id !== id))
  const clearAll = () => setIdeas([])
  const selectedRows = ideas.filter((i) => i.checked)
  const exportCsv = () => downloadCsv(selectedRows)

  return (
    <section className={styles.page}>
      {isLoading && (
        <div className={styles.topbar} role="progressbar" aria-label="Scanning">
          <div className={styles.topbarFill} />
        </div>
      )}

      <header className={styles.head}>
        <p className="eyebrow">Research the index</p>
        <h1 className={styles.title}>
          What's <span className={styles.em}>trending</span>?
        </h1>
        <p className={styles.lead}>
          Find trending articles, extract their ranked ideas with Gemini, pick the ones you want,
          and export to CSV.
        </p>
      </header>

      <form className={styles.form} onSubmit={handleSubmit} role="search">
        <span className={styles.formMark} aria-hidden="true">/</span>
        <input
          className={styles.input}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="type a topic…"
          aria-label="Topic to search"
          autoFocus
          autoComplete="off"
        />
        <button className="btn" type="submit" disabled={isLoading || !query.trim()}>
          {isLoading ? 'Searching…' : 'Search'}
        </button>
      </form>

      <div className={styles.layout}>
        {/* ── results column ── */}
        <div className={styles.results} aria-live="polite">
          {status === 'idle' && (
            <p className={styles.hint}>Enter a topic to pull the top 5 trending articles.</p>
          )}

          {isLoading && (
            <div className={styles.loading}>
              <span className={styles.loadingBadge}>
                <span className={styles.loadingDot} aria-hidden="true" /> Scanning
              </span>
              <div className={styles.scan} />
              <span className={styles.loadingText}>Searching News, Reddit & HN for “{lastQuery}”…</span>
            </div>
          )}

          {status === 'error' && (
            <div className={styles.errorBox}>
              <span className={styles.errBadge}>No signal</span>
              <p className={styles.errMsg}>{error}</p>
              <button className="btn" type="button" onClick={() => runSearch(lastQuery)}>
                Try again ↻
              </button>
            </div>
          )}

          {status === 'success' && articles.length === 0 && (
            <p className={styles.hint}>Nothing found for “{lastQuery}”. Try another topic.</p>
          )}

          {status === 'success' && articles.length > 0 && (
            <>
              <div className={styles.chartHead}>
                <span>Top {articles.length} articles</span>
                <span className={styles.chartQuery}>“{lastQuery}”</span>
              </div>

              {gnews && (
                <div className={styles.gnewsWrap}>
                  <GoogleNewsNotice
                    originalUrl={gnews.article.url}
                    message={gnews.message}
                    onResolve={(realUrl) => doExtract(gnews.article, realUrl)}
                  />
                </div>
              )}

              <div className={styles.cards}>
                {articles.map((a) => (
                  <ArticleCard
                    key={a.link}
                    rank={a.rank}
                    title={a.title}
                    source={a.source}
                    image={a.image}
                    url={a.link}
                    working={working[a.link] || null}
                    onExtract={() => doExtract({ title: a.title, source: a.source, url: a.link })}
                    onBrowse={() => setBrowseArticle({ title: a.title, source: a.source, url: a.link })}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── idea panel column ── */}
        <IdeaPanel
          ideas={ideas}
          onToggle={toggle}
          onRemove={remove}
          onClear={clearAll}
          onPreview={() => setPreviewOpen(true)}
          onExport={exportCsv}
        />
      </div>

      {browseArticle && (
        <BrowsePickModal
          article={browseArticle}
          onClose={() => setBrowseArticle(null)}
          onAdd={(items, ctx) => addIdeas(items, ctx)}
        />
      )}

      {previewOpen && (
        <PreviewModal
          rows={selectedRows}
          onClose={() => setPreviewOpen(false)}
          onExport={() => {
            exportCsv()
            setPreviewOpen(false)
          }}
        />
      )}
    </section>
  )
}
