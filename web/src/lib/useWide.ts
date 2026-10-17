import { useSyncExternalStore } from 'react'

/**
 * Whether the viewport is at or past the `wide` breakpoint.
 *
 * For the few decisions CSS can't make, like whether something opens itself. The value is
 * `--breakpoint-wide` in `index.css`; the slicer reads it the same way. No `matchMedia`
 * (jsdom) counts as wide.
 */
const QUERY = '(min-width: 56.25rem)'

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(QUERY)
  query.addEventListener('change', onChange)
  return () => {
    query.removeEventListener('change', onChange)
  }
}

function wide() {
  return typeof window.matchMedia !== 'function' || window.matchMedia(QUERY).matches
}

export function useWide() {
  return useSyncExternalStore(subscribe, wide)
}
