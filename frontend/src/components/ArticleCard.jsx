import { useState } from 'react'
import { img } from '../api/research.js'
import styles from './ArticleCard.module.css'

/**
 * A trending-article result.
 *
 * @param {{
 *   rank:number, title:string, source:string, image:string|null, url:string,
 *   onExtract:()=>void, onBrowse:()=>void, working?:('extract'|'browse'|null)
 * }} props
 */
export default function ArticleCard({ rank, title, source, image, url, onExtract, onBrowse, working }) {
  const [imgFailed, setImgFailed] = useState(false)
  const showImage = image && !imgFailed
  const rankLabel = String(rank).padStart(2, '0')

  return (
    <article className={styles.card}>
      <span className={styles.rank}>{rankLabel}</span>

      <div className={styles.thumb}>
        {showImage ? (
          <img src={img(image)} alt="" loading="lazy" onError={() => setImgFailed(true)} />
        ) : (
          <span className={styles.thumbGlyph} aria-hidden="true">
            {source.replace(/^r\//, '').charAt(0).toUpperCase() || '#'}
          </span>
        )}
      </div>

      <div className={styles.body}>
        <span className={styles.source}>{source}</span>
        <h3 className={styles.title}>
          <a href={url} target="_blank" rel="noopener noreferrer">
            {title}
          </a>
        </h3>
        <div className={styles.actions}>
          <button
            className={styles.primary}
            onClick={onExtract}
            disabled={!!working}
          >
            {working === 'extract' ? 'Extracting…' : 'Extract Ideas'}
          </button>
          <button className={styles.ghost} onClick={onBrowse} disabled={!!working}>
            {working === 'browse' ? 'Loading…' : 'Browse & Pick'}
          </button>
        </div>
      </div>
    </article>
  )
}
