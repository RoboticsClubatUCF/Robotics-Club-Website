import { BrandMark } from './BrandMark'
import { ThemeToggle } from './ThemeToggle'
import { socialLinks } from '../../content/home'

/**
 * The footer, and the site's one theme switch.
 *
 * **The switch lives here rather than in the nav**, at the far right of the last
 * row on the page. Two reasons, and the second is the one that decided it. It is
 * a setting rather than a destination, and the bar is a row of destinations —
 * putting it there made it the only thing in the bar that does not take you
 * anywhere. And the bar is already three things wide at 320px (the mark, the
 * call to action, the menu toggle), so it could not be in the bar at every width
 * anyway; it would have had to be in the bar on a laptop and buried in the
 * phone panel otherwise, which is two places to look for one control. The
 * footer is on every route and has room at every width, so there is exactly one
 * of these on the site.
 */
export function SiteFooter() {
  return (
    /* A step *away* from the content, so the footer closes the document rather
       than looking like one more section. `bg-sink` rather than a colour,
       because "away" points in opposite directions in the two themes: true
       black under a near-black page, a grey under an off-white one. It is the
       one place on the site that needs that token. */
    <footer className="border-rule bg-sink px-page flex flex-col items-start gap-5 border-t py-8.5 wide:flex-row wide:items-center wide:justify-between">
      <div className="flex items-center gap-3">
        <BrandMark className="w-6.5 shrink-0 opacity-70" />
        {/* Wraps to two lines on a phone rather than being squeezed: the line is
            about 360px of tracked-out mono and there is no width at which it
            both fits and stays legible. */}
        <span className="text-faint font-mono text-[10px] leading-[1.6] font-medium tracking-[0.14em]">
          RCCF · UNIVERSITY OF CENTRAL FLORIDA · ORLANDO, FL
        </span>
      </div>

      {/* The social row and the switch travel together as one right-hand
          cluster, rather than as a third child of the footer. `justify-between`
          across three items would strand the social links in the middle of the
          bar at width; grouped, they stay where they have always been and the
          switch sits outside them at the edge.

          Full-width below the breakpoint, where the footer is a column: that is
          what puts the links at the left margin and the switch at the right one
          on the same line, instead of stacking it under them at the left. */}
      <div className="flex w-full items-center justify-between gap-5 wide:w-auto wide:justify-end wide:gap-6">
        <ul className="flex flex-wrap gap-x-5.5 gap-y-1">
          {socialLinks.map((link) => (
            <li key={link.label}>
              <a
                href={link.href}
                /* These leave the site, so they leave the tab too — someone part
                   way down the page keeps their place. `noopener` is the one that
                   matters: without it the opened page gets a handle on this one
                   through `window.opener` and can navigate it. */
                target="_blank"
                rel="noreferrer noopener"
                /* Padded to a thumb's worth of height on a phone. The negative
                   margin keeps the row's visual rhythm — the target grows, the
                   layout doesn't. */
                className="text-faint hover:text-primary -my-2 flex min-h-9 items-center py-2 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        {/* 44px on a phone and back to 36 above the breakpoint, the same rule
            the calendar's month arrows follow. It cannot use the social links'
            negative-margin trick — that grows a text target without moving the
            row, and this one has a visible border, so the border is the size. */}
        <ThemeToggle className="size-11 wide:size-9" />
      </div>
    </footer>
  )
}
