import { BrandMark } from './BrandMark'
import { socialMarks } from './socialMarks'
import { ThemeToggle } from './ThemeToggle'
import { socialLinks } from '../../content/home'

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
        {/* The four accounts as their own marks rather than four words. `socialMarks` is keyed by
            the same label the list already carries, and a label it doesn't know falls back to that
            word — an account added without a glyph is then merely plain in a row of logos, rather
            than an invisible link in a footer that's on every route. */}
        <ul className="flex items-center gap-x-1">
          {socialLinks.map((link) => {
            const mark = socialMarks[link.label]

            return (
              <li key={link.label}>
                <a
                  href={link.href}
                  /* These leave the site, so they leave the tab too — someone part
                     way down the page keeps their place. `noopener` is the one that
                     matters: without it the opened page gets a handle on this one
                     through `window.opener` and can navigate it. */
                  target="_blank"
                  rel="noreferrer noopener"
                  /* The name in words, because the link no longer has any. Set
                     in ordinary case rather than as the list's `INSTAGRAM`:
                     nothing on screen is uppercase any more, and a screen
                     reader handed all-caps may spell it out. The `title` is the
                     same string — what a pointer gets for a glyph it doesn't
                     recognise. */
                  aria-label={mark?.name ?? link.label}
                  title={mark?.name ?? link.label}
                  className={
                    mark
                      ? /* 44px on a phone, 36 above the breakpoint — the
                           toggle's rule, which these could not follow while they
                           were words of four different widths. A fixed box is
                           what makes them able to now, and it is why the row and
                           the switch line up exactly. */
                        'text-faint hover:text-primary flex size-11 items-center justify-center transition-colors duration-200 wide:size-9'
                      : 'text-faint hover:text-primary -my-2 flex min-h-9 items-center px-1 py-2 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200'
                  }
                >
                  {mark ? (
                    /* `currentColor`, so the mark takes the anchor's `text-faint`
                       and its hover with it — `socialMarks` deliberately holds no
                       colour of its own. `aria-hidden` because the anchor above
                       is what carries the name. */
                    <svg
                      aria-hidden
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="size-4.5"
                    >
                      <path d={mark.path} />
                    </svg>
                  ) : (
                    link.label
                  )}
                </a>
              </li>
            )
          })}
        </ul>

        {/* 44px on a phone and back to 36 above the breakpoint, the same rule the calendar's month
            arrows follow — and, now that the social links are fixed boxes rather than words, the
            same size as them. The two used to be sized by different rules because a text target
            can only be grown with padding and a negative margin. */}
        <ThemeToggle className="size-11 wide:size-9" />
      </div>
    </footer>
  )
}
