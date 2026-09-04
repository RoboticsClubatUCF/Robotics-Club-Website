import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { followSystem } from './lib/theme.ts'

/**
 * Which theme is on was already decided, by the inline script in `index.html` — before this bundle
 * was fetched, which is the point of it being there. What is left for the app to do is keep
 * listening: somebody who has never pressed the toggle is following their operating system, and an
 * OS that switches to light at sunrise should take this tab with it.
 *
 * Started here rather than in a component because it is about the document, and it has to work on a
 * page with no toggle rendered on it. Never torn down — it lives exactly as long as the tab does,
 * and the returned unsubscribe is for the tests.
 */
followSystem()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
