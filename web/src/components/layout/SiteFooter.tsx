import { BrandMark } from './BrandMark'
import { ThemeToggle } from './ThemeToggle'
import { SocialLinks } from '../shared/SocialLinks'

/**
 * The footer, and the site's one theme switch.
 *
 * The switch lives here rather than in the nav, at the far right of the last row on the page. Two
 * reasons, and the second decided it. It's a setting rather than a destination, and the bar is a
 * row of destinations. And the bar is already three things wide at 320px, so it couldn't be in the
 * bar at every width anyway — it would have had to be in the bar on a laptop and buried in the
 * phone panel otherwise, which is two places to look for one control.
 */
export function SiteFooter() {
  return (
    /* A step away from the content, so the footer closes the document rather than looking like one
       more section. `bg-sink` rather than a colour, because "away" points in opposite directions
       in the two themes: true black under a near-black page, a grey under an off-white one. */
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

      {/* The social row and the switch travel together as one right-hand cluster, rather than as a
          third child of the footer. `justify-between` across three items would strand the social
          links in the middle of the bar at width.

          Full-width below the breakpoint, where the footer is a column: that's what puts the links
          at the left margin and the switch at the right on the same line. */}
      <div className="flex w-full items-center justify-between gap-5 wide:w-auto wide:justify-end wide:gap-6">
        <SocialLinks />

        {/* 44px on a phone and back to 36 above the breakpoint, the same rule the calendar's month
            arrows follow — and, now that the social links are fixed boxes rather than words, the
            same size as them. The two used to be sized by different rules because a text target
            can only be grown with padding and a negative margin. */}
        <ThemeToggle className="size-11 wide:size-9" />
      </div>
    </footer>
  )
}
