import { Outlet } from 'react-router-dom'
import Header from './Header.jsx'
import styles from './Layout.module.css'

/**
 * Shared editorial shell: a live ticker strip, the masthead (with nav),
 * the active page (<Outlet/>), and a colophon footer. Every route reuses it.
 */
export default function Layout() {
  return (
    <div className={styles.shell}>
      <div className={styles.ticker}>
        <div className={`container ${styles.tickerInner}`}>
          <span className={styles.live}>
            <span className={styles.dot} aria-hidden="true" /> Live
          </span>
          <span>The Trend Index — what the internet is buying right now</span>
          <span className={styles.edition}>EST. MMXXVI</span>
        </div>
      </div>

      <Header />

      <main className={styles.main}>
        <div className="container">
          <Outlet />
        </div>
      </main>

      <footer className={styles.footer}>
        <div className={`container ${styles.footerInner}`}>
          <span className={styles.footMark}>TrendSite✱</span>
          <span className={styles.footNote}>
            Live results, scraped on demand — no sample data.
          </span>
        </div>
      </footer>
    </div>
  )
}
