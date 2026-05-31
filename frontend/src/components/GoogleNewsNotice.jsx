import { useState } from 'react'
import styles from './GoogleNewsNotice.module.css'

/**
 * Yellow warning shown when extraction hits a Google News link (browser-only
 * redirect). Lets the user open the article, copy the real URL, and paste it
 * to extract from the actual page.
 *
 * @param {{ originalUrl:string, message?:string, onResolve:(realUrl:string)=>void }} props
 */
export default function GoogleNewsNotice({ originalUrl, message, onResolve }) {
  const [value, setValue] = useState('')

  function submit(e) {
    e.preventDefault()
    const url = value.trim()
    if (/^https?:\/\//i.test(url)) onResolve(url)
  }

  return (
    <div className={styles.notice}>
      <div className={styles.head}>
        <span className={styles.badge}>⚠ Google News link</span>
        <a className={styles.open} href={originalUrl} target="_blank" rel="noopener noreferrer">
          Open article ↗
        </a>
      </div>
      <p className={styles.msg}>
        {message ||
          'This link redirects in the browser only. Open the article, copy the real URL, and paste it below.'}
      </p>
      <form className={styles.form} onSubmit={submit}>
        <input
          className={styles.input}
          type="url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste the real article URL, then press Enter"
          aria-label="Real article URL"
        />
        <button className={styles.go} type="submit" disabled={!/^https?:\/\//i.test(value.trim())}>
          Extract ↵
        </button>
      </form>
    </div>
  )
}
