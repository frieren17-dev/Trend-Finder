import { NavLink } from 'react-router-dom'
import styles from './Nav.module.css'

const LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/trends', label: 'Trend Finder', end: false },
]

/** Primary navigation, styled as editorial mono labels. */
export default function Nav() {
  return (
    <nav className={styles.nav}>
      {LINKS.map(({ to, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            isActive ? `${styles.link} ${styles.active}` : styles.link
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
