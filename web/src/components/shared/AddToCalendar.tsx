import { useEffect, useRef, useState } from 'react'
import type { ApiEvent } from '../../lib/api/api'
import {
  downloadIcs,
  googleCalendarUrl,
  seriesSummary,
} from '../../lib/events/calendarLinks'

/**
 * "Add to calendar", and the two ways out of the site.
 *
 * A menu rather than one button, because there is no single link that reaches
 * every calendar app: Google wants a URL at its own domain, and Samsung, Apple
 * and Outlook all want an `.ics` file. Guessing from the user agent would be
 * wrong for anyone signed into Google on an iPhone, which is most people.
 *
 * The menu is two `<button>`s and a `<a>`, not a `<select>`: one of the two
 * navigates away and the other downloads, and a select that does either on
 * change is a control that fires when somebody is only looking.
 *
 * On a recurring meeting the panel says what it is about to add — the term it
 * runs to, and that finals week is left out — because "add to calendar" on a
 * weekly meeting could reasonably mean one evening, and somebody should know
 * which before their phone fills up with Tuesdays.
 */
export function AddToCalendar({
  event,
  align = 'left',
  className = '',
}: {
  event: ApiEvent
  /** Which edge the panel hangs from. See the `z-30` note on the panel. */
  align?: 'left' | 'right'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // Close on a click anywhere else and on Escape. Both, because the panel hangs
  // over the agenda rows beneath it and the pointer route out is the one people
  // reach for — but a keyboard user who opened it has no click to make.
  useEffect(() => {
    if (!open) return

    const onPointer = (pointer: MouseEvent) => {
      if (!box.current?.contains(pointer.target as Node)) setOpen(false)
    }
    const onKey = (key: KeyboardEvent) => {
      if (key.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const itemClass =
    'text-dim hover:bg-wash hover:text-primary focus-visible:outline-primary flex min-h-11 w-full cursor-pointer items-center px-3 text-left font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 wide:min-h-9'

  return (
    <div ref={box} className={`relative inline-block ${className}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          setOpen(!open)
        }}
        className="text-faint border-rule hover:border-primary hover:text-primary focus-visible:outline-primary flex min-h-11 cursor-pointer items-center gap-1.5 border px-3 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 wide:min-h-8"
      >
        ADD TO CALENDAR
        <span
          aria-hidden
          className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        >
          ›
        </span>
      </button>

      {open && (
        <div
          role="menu"
          /* A step lighter than what it floats over, and `z-30` so it clears the
             chips' hover cards in the calendar grid, which sit at `z-20` — it
             opens *inside* one of those on the grid, and is wider than the card
             is, so which edge it hangs from is the caller's to say. */
          className={`border-rule bg-base-300 absolute top-full z-30 mt-1 w-[min(20rem,82vw)] border py-1 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <a
            role="menuitem"
            href={googleCalendarUrl(event)}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              setOpen(false)
            }}
            className={itemClass}
          >
            GOOGLE CALENDAR
          </a>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              downloadIcs(event)
              setOpen(false)
            }}
            className={itemClass}
          >
            DOWNLOAD .ICS
          </button>

          <p className="text-faint border-rule mt-1 border-t px-3 pt-2 pb-1 text-[11px] leading-[1.5] text-pretty">
            {/* Named rather than left as "other calendars": somebody looking for
                their own app wants to see its name, and ".ics" is not a word
                most people know they need. */}
            The .ics file opens in Samsung Calendar, Apple Calendar and Outlook.
            {event.meeting && ` ${seriesSummary(event.meeting)}`}
          </p>
        </div>
      )}
    </div>
  )
}
