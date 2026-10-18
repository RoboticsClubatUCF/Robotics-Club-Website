import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** A hint opened by mouse, touch, or keyboard without taking space in the form. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLSpanElement>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [position, setPosition] = useState<{
    left: number
    top?: number
    bottom?: number
  } | null>(null)
  const open = !dismissed && (hovered || focused || pinned)

  const enter = () => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current)
    setHovered(true)
    setDismissed(false)
  }
  const leave = () => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => {
      setHovered(false)
    }, 100)
  }

  useEffect(
    () => () => {
      if (hoverTimer.current !== null) clearTimeout(hoverTimer.current)
    },
    [],
  )

  useEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }

    const place = () => {
      const box = trigger.current?.getBoundingClientRect()
      if (!box) return
      setPosition({
        left: Math.max(16, Math.min(box.left, window.innerWidth - 304)),
        ...(window.innerHeight - box.bottom < 120
          ? { bottom: window.innerHeight - box.top + 6 }
          : { top: box.bottom + 6 }),
      })
    }
    place()
    const close = () => {
      setDismissed(true)
      setPinned(false)
    }
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !trigger.current?.contains(event.target) &&
        !popup.current?.contains(event.target)
      ) {
        close()
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
      }
    }
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
    }
  }, [open])

  return (
    <span
      className="inline-flex size-3.5 shrink-0 align-middle"
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={`${label} info`}
        aria-expanded={open}
        aria-controls={position ? id : undefined}
        aria-describedby={position ? id : undefined}
        onClick={() => {
          setPinned(!pinned)
          setDismissed(pinned)
        }}
        onFocus={() => {
          setFocused(true)
          setDismissed(false)
        }}
        onBlur={() => {
          setFocused(false)
          setPinned(false)
        }}
        className="relative inline-flex size-3.5 cursor-pointer items-center justify-center text-faint before:absolute before:-inset-1.5 before:content-[''] hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          className="block size-3.5"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6M12 7h.01" />
        </svg>
      </button>
      {position &&
        createPortal(
          <span
            ref={popup}
            id={id}
            role="tooltip"
            onMouseEnter={enter}
            onMouseLeave={leave}
            style={position}
            className="fixed z-50 w-72 max-w-[calc(100vw-2rem)] border border-rule bg-base-200 p-3 text-left font-sans text-[13px] leading-[1.6] font-normal tracking-normal text-dim normal-case shadow-xl"
          >
            {children}
          </span>,
          document.body,
        )}
    </span>
  )
}
