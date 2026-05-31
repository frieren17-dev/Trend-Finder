import Modal from './Modal.jsx'
import styles from './PreviewModal.module.css'

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * Shows all selected ideas in a designed table — exactly the columns the CSV
 * will contain (Rank, Idea, Source, Article, Article URL) — before download.
 *
 * @param {{ rows:Array, onClose:()=>void, onExport:()=>void }} props
 */
export default function PreviewModal({ rows, onClose, onExport }) {
  return (
    <Modal
      title={`CSV Preview — ${rows.length} selected`}
      onClose={onClose}
      footer={
        <>
          <span className={styles.note}>
            {rows.length} row{rows.length === 1 ? '' : 's'} · 5 columns · UTF-8 (Excel-ready)
          </span>
          <button className={styles.export} onClick={onExport}>
            Export CSV ↓
          </button>
        </>
      }
    >
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.colRank}>Rank</th>
              <th>Idea</th>
              <th className={styles.colSrc}>Source</th>
              <th>Article</th>
              <th className={styles.colUrl}>Article URL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id || i}>
                <td className={styles.rank}>{String(r.rank).padStart(2, '0')}</td>
                <td className={styles.idea}>{r.idea}</td>
                <td className={styles.src}>{r.source}</td>
                <td className={styles.article}>{r.articleTitle}</td>
                <td className={styles.url}>
                  <a href={r.articleUrl} target="_blank" rel="noopener noreferrer" title={r.articleUrl}>
                    {domainOf(r.articleUrl)} ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}
