import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Home from './pages/Home.jsx'
import TrendFinder from './pages/TrendFinder.jsx'

export default function App() {
  return (
    <Routes>
      {/* Every page renders inside the shared Layout shell */}
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="trends" element={<TrendFinder />} />
        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  )
}
