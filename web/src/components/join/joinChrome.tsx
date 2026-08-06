import type { ReactNode } from 'react'

/**
 * The bits of the join page every step draws the same way.
 *
 * Signup is four screens that replace each other in one column, so the chrome
 * has to be identical between them or the page appears to jump as it advances.
 * Keeping it here rather than repeating the class strings is what makes that
 * true by construction.
 */

/** Matches the section headings on the front page: `/ EYEBROW` in mono. */
export function JoinEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-faint mb-5 font-mono text-[13px] font-bold tracking-[0.2em]">
      {children}
    </p>
  )
}

export function JoinHeading({ children }: { children: ReactNode }) {
  return (
    <h1 className="mb-5 text-[clamp(1.6rem,6vw,2.25rem)] leading-[1.1] font-bold tracking-[-0.02em] text-pretty">
      {children}
    </h1>
  )
}

/** A bordered panel: the disclaimer, the spam warning, the Discord block. */
export function JoinPanel({
  children,
  tone = 'plain',
}: {
  children: ReactNode
  /** `accent` is for the two things somebody has to actually read — the
      eligibility requirement and where the email will land. */
  tone?: 'plain' | 'accent'
}) {
  return (
    <div
      className={`border p-5 ${
        tone === 'accent'
          ? 'border-primary/35 bg-primary/5'
          : 'border-rule bg-base-200'
      }`}
    >
      {children}
    </div>
  )
}

export const labelClass =
  'text-faint mb-1.5 block font-mono text-[10px] font-medium tracking-[0.16em]'

export const fieldClass = 'input border-rule bg-base-200 w-full text-sm'

export const submitClass =
  'btn btn-primary btn-cta w-full px-6 py-3.5 text-[13px] font-semibold disabled:opacity-60'
