import { Link } from 'react-router-dom'
import styles from './Home.module.css'

const SAMPLE_TOPICS = ['camping gear', 'kitchen tools', 'photography', 'web cam']

/** Editorial landing page: oversized statement + entry into the index. */
export default function Home() {
  return (
    <section className={styles.hero}>
      <p className={`eyebrow ${styles.kicker}`}>Issue Nº01 — The Live Index</p>

      <h1 className={styles.title}>
        Mine the trends.
        <br />
        Extract the <span className={styles.em}>ideas</span>.
        <br />
        Export the list.
      </h1>

      <div className={styles.lower}>
        <p className={styles.lede}>
          Name a topic — “camping gear”, “kitchen tools”, “photography” — and we
          surface the <strong>top trending articles</strong> from News, Reddit and
          Hacker News. Then <strong>Gemini</strong> pulls each article's ranked list
          of products/ideas, you pick the keepers, and export them to CSV.
        </p>

        <div className={styles.cta}>
          <Link to="/trends" className="btn">
            Open the index ↗
          </Link>
          <ul className={styles.topics}>
            {SAMPLE_TOPICS.map((t) => (
              <li key={t}>
                <Link to={`/trends?q=${encodeURIComponent(t)}`}>{t}</Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className={styles.bigNum} aria-hidden="true">
        05
      </div>
    </section>
  )
}
