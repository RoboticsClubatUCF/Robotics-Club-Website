import { useEffect, useId, useRef, useState } from 'react'
import { getJson, postJson } from '../../lib/api/api'
import {
  feedUrl,
  googleSubscribeUrl,
  isPrivateFeed,
  webcalUrl,
  type Feed,
} from '../../lib/events/feeds'
import { ConfirmDialog } from './ConfirmDialog'

/** The person's token, for a private feed. The public feed needs none and starts ready. */
type Token =
  | { status: 'idle' | 'loading' | 'error' }
  | { status: 'ready'; token: string }

const NOTE: Record<Feed['kind'], string> = {
  club: 'Google Calendar checks for changes about once a day.',
  project: 'Your private link. Google Calendar checks for changes about once a day.',
  officers: 'Club events not on the main calendar yet. Your private link.',
}

const NOTICE = {
  copied: 'Link copied.',
  copyFailed: 'Couldn’t copy. The link is selected above.',
  reset: 'New link ready. Subscribe again.',
} as const

/**
 * SUBSCRIBE: a calendar that keeps itself up to date, beside ADD TO CALENDAR's one-off copy.
 *
 * A disclosure rather than a menu, because the panel holds the link itself in a field to
 * select, and a menu may only hold menu items. A private feed asks for the person's token the
 * first time the panel opens, so nobody who never subscribes is given one.
 */
export function SubscribeCalendar({
  feed,
  label = 'SUBSCRIBE TO CALENDAR',
  align = 'left',
  className = '',
}: {
  feed: Feed
  label?: string
  /** Which edge the panel hangs from. */
  align?: 'left' | 'right'
  className?: string
}) {
  const panelId = useId()
  const [open, setOpen] = useState(false)
  // The token rather than the link: the page can change project under a mounted panel, and the
  // link follows `feed` on every render.
  const [token, setToken] = useState<Token>(() =>
    isPrivateFeed(feed) ? { status: 'idle' } : { status: 'ready', token: '' },
  )
  const url = token.status === 'ready' ? feedUrl(feed, token.token) : null
  /** What the status line says, when it says anything. */
  const [notice, setNotice] = useState<'copied' | 'copyFailed' | 'reset' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetFailed, setResetFailed] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return

    const onPointer = (pointer: MouseEvent) => {
      if (!box.current?.contains(pointer.target as Node)) setOpen(false)
    }
    const onKey = (key: KeyboardEvent) => {
      if (key.key !== 'Escape') return
      // The panel is about to unmount, and focus inside it would fall to the page.
      if (box.current?.contains(document.activeElement)) toggleRef.current?.focus()
      setOpen(false)
    }

    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (notice !== 'copied') return
    const timer = setTimeout(() => {
      setNotice(null)
    }, 2000)
    return () => {
      clearTimeout(timer)
    }
  }, [notice])

  const fetchLink = () => {
    setToken({ status: 'loading' })
    getJson<{ token: string }>('/me/calendar')
      .then((answer) => {
        setToken({ status: 'ready', token: answer.token })
      })
      .catch(() => {
        setToken({ status: 'error' })
      })
  }

  const toggle = () => {
    if (!open && (token.status === 'idle' || token.status === 'error')) fetchLink()
    setNotice(null)
    setOpen(!open)
  }

  const copy = (url: string) => {
    // Falls back to selecting the field for the person to copy. Focused first, since iOS
    // ignores a selection in a read-only field that doesn't have focus.
    const select = () => {
      field.current?.focus()
      field.current?.setSelectionRange(0, url.length)
      setNotice('copyFailed')
    }
    if (!navigator.clipboard) {
      select()
      return
    }
    navigator.clipboard.writeText(url).then(() => {
      setNotice('copied')
    }, select)
  }

  /** Before anything in the panel goes away with it, so focus isn't left on nothing. */
  const closeToButton = () => {
    toggleRef.current?.focus()
    setOpen(false)
  }

  const reset = () => {
    setResetting(true)
    setResetFailed(false)
    postJson<{ token: string }>('/me/calendar/reset', {})
      .then((answer) => {
        setToken({ status: 'ready', token: answer.token })
        setConfirming(false)
        setNotice('reset')
        setOpen(true)
      })
      .catch(() => {
        setResetFailed(true)
      })
      .finally(() => {
        setResetting(false)
      })
  }

  const itemClass =
    'text-dim hover:bg-wash hover:text-primary focus-visible:outline-primary flex min-h-11 w-full cursor-pointer items-center px-3 text-left font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 wide:min-h-9'
  const smallButton =
    'text-faint hover:text-primary focus-visible:outline-primary min-h-11 cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 wide:min-h-0'

  return (
    <div
      ref={box}
      className={`relative inline-block ${className}`}
      // Tabbing out closes it, so it never covers the field that now has focus. A click on
      // nothing focusable has no `relatedTarget`, and the mousedown listener handles that.
      onBlur={(event) => {
        const next = event.relatedTarget
        if (open && next instanceof Node && !box.current?.contains(next)) setOpen(false)
      }}
    >
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className="text-faint border-rule hover:border-primary hover:text-primary focus-visible:outline-primary flex min-h-11 cursor-pointer items-center gap-1.5 border px-3 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 wide:min-h-8"
      >
        {label}
        <span
          aria-hidden
          className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        >
          ›
        </span>
      </button>

      {open && (
        <div
          id={panelId}
          className={`border-rule bg-base-300 absolute top-full z-30 mt-1 w-[min(20rem,82vw)] border py-1 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {token.status === 'loading' && (
            // The ready panel's shape: three rows, the link field and the note.
            <div aria-busy="true">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="flex h-11 items-center px-3 wide:h-9">
                  <div className="bg-base-200 h-2.5 w-32 animate-pulse rounded-[2px]" />
                </div>
              ))}
              <div className="border-rule mt-1 border-t px-3 pt-2 pb-1">
                <div className="bg-base-200 h-7 w-full animate-pulse rounded-[2px]" />
                <div className="bg-base-200 mt-2 h-3 w-48 animate-pulse rounded-[2px]" />
              </div>
            </div>
          )}

          {token.status === 'error' && (
            <div className="px-3 py-2">
              <p role="alert" className="text-dim text-[13px] leading-[1.5]">
                Couldn&rsquo;t get your link.
              </p>
              <button type="button" onClick={fetchLink} className={smallButton}>
                TRY AGAIN
              </button>
            </div>
          )}

          {url !== null && (
            <>
              <a
                href={googleSubscribeUrl(url)}
                target="_blank"
                rel="noreferrer"
                onClick={closeToButton}
                className={itemClass}
              >
                GOOGLE CALENDAR
              </a>
              <a
                href={webcalUrl(url)}
                onClick={closeToButton}
                className={itemClass}
              >
                APPLE OR OUTLOOK
              </a>
              <button
                type="button"
                onClick={() => {
                  copy(url)
                }}
                className={itemClass}
              >
                {notice === 'copied' ? 'COPIED' : 'COPY LINK'}
              </button>

              <div className="border-rule mt-1 border-t px-3 pt-2 pb-1">
                <input
                  ref={field}
                  type="text"
                  readOnly
                  value={url}
                  aria-label="Calendar link"
                  onFocus={(event) => {
                    event.currentTarget.select()
                  }}
                  className="border-rule bg-base-200 text-dim w-full border px-2 py-1.5 font-mono text-[11px]"
                />
                {notice && (
                  <p role="status" className="text-base-content mt-2 text-[11px] leading-[1.5]">
                    {NOTICE[notice]}
                  </p>
                )}
                <p className="text-faint mt-2 text-[11px] leading-[1.5] text-pretty">
                  {NOTE[feed.kind]}
                </p>
                {isPrivateFeed(feed) && (
                  <button
                    type="button"
                    onClick={() => {
                      // The dialog hands focus back to whatever had it, and this button
                      // goes with the panel.
                      toggleRef.current?.focus()
                      setOpen(false)
                      setResetFailed(false)
                      setConfirming(true)
                    }}
                    className={smallButton}
                  >
                    RESET LINKS
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title="Reset your calendar links?"
          confirmLabel="RESET LINKS"
          busy={resetting}
          onConfirm={reset}
          // Not while the reset is in flight: the token is already changing, and the panel
          // has to come back with the new link.
          onDismiss={() => {
            if (!resetting) setConfirming(false)
          }}
        >
          <p>
            Every calendar you subscribed with a private link stops updating. Subscribe
            again with the new link.
          </p>
          {resetFailed && (
            <p role="alert" className="text-error">
              Couldn&rsquo;t reset the link. Try again.
            </p>
          )}
        </ConfirmDialog>
      )}
    </div>
  )
}
