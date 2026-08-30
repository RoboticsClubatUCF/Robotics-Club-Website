import type { ReactNode } from 'react'

/**
 * The chrome every task page on this site draws the same way.
 *
 * Signing up, signing in and paying dues are the three pages that are a *task*
 * rather than something to read: one narrow column, an eyebrow, a heading, and
 * panels for the things somebody actually has to take in. Keeping the class
 * strings here rather than repeating them is what makes the three look like one
 * site, and what stops signup appearing to jump between its four screens.
 *
 * This started in `components/join/` and moved out when the login page became
 * the second user — the rule in `.claude/docs/frontend.md` is that a component
 * earns `shared/` by being used on two pages, not by looking reusable.
 */

/** Matches the section headings on the front page: `/ EYEBROW` in mono. */
export function FormEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-faint mb-5 font-mono text-[13px] font-bold tracking-[0.2em]">
      {children}
    </p>
  )
}

export function FormHeading({ children }: { children: ReactNode }) {
  return (
    <h1 className="mb-5 text-[clamp(1.6rem,6vw,2.25rem)] leading-[1.1] font-bold tracking-[-0.02em] text-pretty">
      {children}
    </h1>
  )
}

/** A bordered panel: the disclaimer, the spam warning, the Discord block. */
export function FormPanel({
  children,
  tone = 'plain',
}: {
  children: ReactNode
  /** `accent` is for the things somebody has to actually read — the
      eligibility requirement, where the email will land, what a payment buys. */
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

/**
 * A reading measure, for a page whose whole content is a sentence.
 *
 * The dashboard's own column is as wide as the monitor now — the pages in it
 * lay themselves out with `grid-fluid` and get their measure from their
 * columns. The screens that have no columns are the ones that had no layout to
 * begin with: a desk refusing somebody, a lock, a load that failed. One panel
 * of prose stretched across 1700px is what that width costs them, so they say
 * how wide they want to be. Written down once because it is the same number in
 * a dozen places and a number written twice is a number that drifts.
 */
export const measureClass = 'max-w-[46rem]'

export const labelClass =
  'text-faint mb-1.5 block font-mono text-[10px] font-medium tracking-[0.16em]'

export const fieldClass = 'input border-rule bg-base-200 w-full text-sm'

export const submitClass =
  'btn btn-primary btn-cta w-full px-6 py-3.5 text-[13px] font-semibold disabled:opacity-60'

/**
 * The quieter of the two buttons — "back to the front page", "cancel".
 *
 * Outlined in the page's own ink rather than in gold, because a page with two
 * gold buttons on it has no primary action. `base-content` rather than the
 * `white` this was written as: the intent was always "full-strength text
 * colour", and only in a one-theme site were those the same thing.
 */
export const secondaryClass =
  'btn btn-outline h-auto min-h-0 border-base-content/28 px-7 py-[15px] text-[13px] font-semibold tracking-[0.04em] text-base-content transition-[border-color,background-color] duration-200 hover:border-base-content hover:bg-base-content/6 hover:text-base-content'

/**
 * The one column every task page sits in.
 *
 * Narrow on purpose: these are forms, and a form stretched across a wide
 * monitor is a form nobody can follow down.
 */
export function FormPage({
  children,
  width = 'narrow',
}: {
  children: ReactNode
  /** `wide` is for the dues page, which puts plan cards side by side. */
  width?: 'narrow' | 'wide'
}) {
  return (
    <section className="px-page py-14 wide:py-20">
      <div
        className={`mx-auto w-full ${
          width === 'wide' ? 'max-w-[46rem]' : 'max-w-[34rem]'
        }`}
      >
        {children}
      </div>
    </section>
  )
}
