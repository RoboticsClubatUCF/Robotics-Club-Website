import { useEffect } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router'
import { SiteLayout } from './components/layout/SiteLayout'
import { HomePage } from './pages/HomePage'
import { JoinPage } from './pages/JoinPage'
import { NotFoundPage } from './pages/NotFoundPage'

/**
 * The router.
 *
 * `BrowserRouter` rather than a data router: nothing here loads through a route
 * loader — components fetch what they need via `useApi` — so the data APIs
 * would be machinery for nothing. Real paths rather than hashes, because the
 * signup verification link goes in an email and `/join?token=…` is a URL
 * somebody might have to read out.
 *
 * Two routes are real so far. The rest of `src/pages/` is still the empty files
 * that named the destinations before anything was built, and the stat strip and
 * section headers point at several of them — those land on `NotFoundPage` until
 * somebody writes them, which is at least honest about what exists.
 *
 * A dev server hands any path back to `index.html` and so does a static host
 * once it is told to; without that rewrite rule, `/join` 404s before React ever
 * runs. See the deploy notes in `web/README.md`.
 */
function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route element={<SiteLayout />}>
          <Route index element={<HomePage />} />
          <Route path="join" element={<JoinPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

/**
 * Start a new page at the top of it.
 *
 * A history push does not move the scroll position, so following the join
 * button from the bottom of the FAQ otherwise lands you on the signup form
 * already scrolled past its heading.
 *
 * Two details keep it from breaking the things that were already right. It sits
 * out when there is a hash, because that URL is asking for a particular section
 * and the browser is about to go there. And it scrolls instantly rather than
 * inheriting the page's smooth behaviour — smooth is for a click that says
 * where it is going, not for arriving somewhere new and watching it travel.
 */
function ScrollToTop() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    if (!hash) window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname, hash])

  return null
}

export default App
