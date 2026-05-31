import { useCallback, useEffect, useRef, useState } from 'react'
import Modal from './Modal.jsx'
import GoogleNewsNotice from './GoogleNewsNotice.jsx'
import { browseAndExtract } from '../api/research.js'
import styles from './BrowsePickModal.module.css'

/**
 * Popup that fetches an article, uses Gemini (via the Node proxy) to extract
 * all listed ideas, and shows them as a checklist so the user picks which to
 * keep before adding them to the Idea Panel.
 *
 * @param {{ article:{title,url,source}, onClose:()=>void, onAdd:(items, ctx)=>void }} props
 */
export default function BrowsePickModal({ article, onClose, onAdd }) {
  const [status, setStatus] = useState('loading') // loading | picking | gnews | error
  const [error, setError] = useState('')
  const [gnews, setGnews] = useState(null) // { message, originalUrl }
  const [items, setItems] = useState([]) // { rank, idea, checked }
  const [sourceUrl, setSourceUrl] = useState(article.url)
  const [copied, setCopied] = useState(false)
  const abortRef = useRef(null)

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(sourceUrl)
    } catch {
      // Fallback for non-secure contexts
      const ta = document.createElement('textarea')
      ta.value = sourceUrl
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const run = useCallback(async (url) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStatus('loading')
    setError('')
    setSourceUrl(url)
    try {
      const res = await browseAndExtract(url, controller.signal)
      if (res.needsRealUrl) {
        setGnews({ message: res.message, originalUrl: url })
        setStatus('gnews')
        return
      }
      if (!res.items.length) {
        setError('No ranked list of ideas was found in this article.')
        setStatus('error')
        return
      }
      setItems(res.items.map((it) => ({ ...it, checked: true })))
      setStatus('picking')
    } catch (err) {
      if (err.name === 'AbortError') return
      setError(err.message || 'Extraction failed.')
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    run(article.url)
    return () => abortRef.current?.abort()
  }, [article.url, run])

  const toggle = (rank) =>
    setItems((prev) => prev.map((it) => (it.rank === rank ? { ...it, checked: !it.checked } : it)))
  const allChecked = items.length > 0 && items.every((i) => i.checked)
  const toggleAll = () => setItems((prev) => prev.map((it) => ({ ...it, checked: !allChecked })))

  const selectedCount = items.filter((i) => i.checked).length

  function addSelected() {
    const chosen = items.filter((i) => i.checked)
    onAdd(chosen, { articleTitle: article.title, source: article.source, articleUrl: sourceUrl })
    onClose()
  }

  return (
    <Modal
      title="Browse & Pick"
      onClose={onClose}
      footer={
        status === 'picking' && (
          <>
            <label className={styles.allLabel}>
              <input type="checkbox" checked={allChecked} onChange={toggleAll} /> Select all
            </label>
            <button className={styles.add} onClick={addSelected} disabled={selectedCount === 0}>
              Add {selectedCount} to panel ↗
            </button>
          </>
        )
      }
    >
      <p className={styles.articleTitle}>{article.title}</p>
      <div className={styles.meta}>
        <span className={styles.articleSrc}>{article.source}</span>
        <div className={styles.metaActions}>
          <a className={styles.openLink} href={sourceUrl} target="_blank" rel="noopener noreferrer">
            Open ↗
          </a>
          <button
            className={`${styles.copy} ${copied ? styles.copied : ''}`}
            onClick={copyUrl}
            type="button"
          >
            {copied ? 'Copied ✓' : '⧉ Copy URL'}
          </button>
        </div>
      </div>

      {status === 'loading' && (
        <div className={styles.loading}>
          <span className={styles.spinner} /> Reading the article & asking Gemini…
        </div>
      )}

      {status === 'gnews' && gnews && (
        <GoogleNewsNotice
          originalUrl={gnews.originalUrl}
          message={gnews.message}
          onResolve={(realUrl) => run(realUrl)}
        />
      )}

      {status === 'error' && (
        <div className={styles.error}>
          <p>{error}</p>
          <button className={styles.retry} onClick={() => run(sourceUrl)}>
            Try again ↻
          </button>
        </div>
      )}

      {status === 'picking' && (
        <ul className={styles.list}>
          {items.map((it) => (
            <li key={it.rank} className={styles.item}>
              <label className={styles.label}>
                <input type="checkbox" checked={it.checked} onChange={() => toggle(it.rank)} />
                <span className={styles.rank}>{String(it.rank).padStart(2, '0')}</span>
                <span className={styles.idea}>{it.idea}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
