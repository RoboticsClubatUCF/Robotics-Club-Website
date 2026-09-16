import { useEffect, useRef, type RefObject } from 'react'

const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Focus for an overlay drawn by hand rather than with `<dialog>`: `initial` gets focus on open,
 * Tab and Shift+Tab wrap inside `panel`, Escape calls `onEscape`, and focus goes back to whatever
 * opened it on close.
 *
 * `aria-modal` tells a screen reader the page behind is inert, but nothing made it so for a
 * keyboard — Tab walked out of the survey prompt onto OPEN THE LAB under the scrim. Only the two
 * ends of the panel are intercepted, so the order inside stays the browser's.
 *
 * `onEscape` is read through a ref, so a caller passing a fresh closure each render doesn't re-run
 * the effect and yank focus back to `initial` mid-typing.
 */
export function useDialogFocus(
  panel: RefObject<HTMLElement | null>,
  initial: RefObject<HTMLElement | null>,
  onEscape: () => void,
) {
  const escape = useRef(onEscape)

  useEffect(() => {
    escape.current = onEscape
  })

  useEffect(() => {
    // Read before focus moves, so it's the button that opened this.
    const opener = document.activeElement as HTMLElement | null
    initial.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        escape.current()
        return
      }

      if (event.key !== 'Tab' || !panel.current) return

      const stops = [...panel.current.querySelectorAll<HTMLElement>(TABBABLE)].filter(
        (element) => !element.closest('[hidden], [inert]'),
      )

      const first = stops[0]
      const last = stops.at(-1)

      if (!first || !last) {
        event.preventDefault()
        return
      }

      const active = document.activeElement
      const inside = panel.current.contains(active)

      if (event.shiftKey && (active === first || !inside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !inside)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      opener?.focus?.()
    }
  }, [panel, initial])
}
