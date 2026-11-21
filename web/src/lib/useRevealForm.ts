import { useEffect, useRef } from 'react'

/**
 * Brings a form to the reader when a row's EDIT opens it. On a phone the form can be a screen or
 * more below the button, so without this the press looks like it did nothing.
 *
 * Focus goes to the first field that can be typed in, since some of an imported event's are
 * locked. `opened` counts presses of EDIT, so pressing it again on the open row brings the form
 * back, and a background refresh of that row doesn't move anybody.
 */
export function useRevealForm(opened: number) {
  const form = useRef<HTMLFormElement>(null)

  useEffect(() => {
    const element = form.current
    if (opened === 0 || !element) return

    const { top } = element.getBoundingClientRect()
    if (top < 96 || top > window.innerHeight * 0.6) {
      // Optional because jsdom has no layout and no `scrollIntoView`.
      element.scrollIntoView?.({ block: 'start' })
    }
    element
      .querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')
      ?.focus({ preventScroll: true })
  }, [opened])

  return form
}
