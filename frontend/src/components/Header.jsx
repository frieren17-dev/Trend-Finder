import { Link } from 'react-router-dom'
import Nav from './Nav.jsx'
import styles from './Header.module.css'

/** Editorial masthead: wordmark on the left, navigation on the right. */
export default function Header() {
  return (
    <header className={styles.header}>
      <div className={`container ${styles.inner}`}>
        <Link to="/" className={styles.brand} aria-label="TrendSite home">
          TrendSite<span className={styles.star}>✱</span>
        </Link>
        <Nav />
      </div>
    </header>
  )
}
