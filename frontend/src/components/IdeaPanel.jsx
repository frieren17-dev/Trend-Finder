import styles from './IdeaPanel.module.css'

/**
 * Right-side panel of collected ideas. Each is a checkbox the user toggles to
 * choose which to keep, then Preview / Export CSV.
 *
 * @param {{
 *   ideas:Array, onToggle:(id)=>void, onRemove:(id)=>void, onClear:()=>void,
 *   onPreview:()=>void, onExport:()=>void
 * }} props
 */
export default function IdeaPanel({ ideas, onToggle, onRemove, onClear, onPreview, onExport }) {
  const selected = ideas.filter((i) => i.checked).length

  return (
    <aside className={styles.panel} aria-label="Idea panel">
      <div className={styles.head}>
        <h2 className={styles.title}>Idea Panel</h2>
        <span className={styles.count}>
          {selected}/{ideas.length} selected
        </span>
      </div>

      {ideas.length === 0 ? (
        <p className={styles.empty}>
          No ideas yet. Use <strong>Extract Ideas</strong> or <strong>Browse&nbsp;&amp;&nbsp;Pick</strong> on
          an article to collect them here.
        </p>
      ) : (
        <ul className={styles.list}>
          {ideas.map((it) => (
            <li key={it.id} className={styles.item}>
              <label className={styles.label}>
                <input
                  type="checkbox"
                  checked={it.checked}
                  onChange={() => onToggle(it.id)}
                  className={styles.checkbox}
                />
                <span className={styles.ideaText}>
                  <span className={styles.ideaName}>
                    <span className={styles.ideaRank}>{String(it.rank).padStart(2, '0')}</span>
                    {it.idea}
                  </span>
                  <span className={styles.ideaSrc}>{it.source}</span>
                </span>
              </label>
              <button className={styles.remove} onClick={() => onRemove(it.id)} aria-label="Remove">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.actions}>
        <button className={styles.preview} onClick={onPreview} disabled={selected === 0}>
          Preview
        </button>
        <button className={styles.export} onClick={onExport} disabled={selected === 0}>
          Export CSV ↓
        </button>
      </div>
      {ideas.length > 0 && (
        <button className={styles.clear} onClick={onClear}>
          Clear all
        </button>
      )}
    </aside>
  )
}
