import { BrandMark } from './BrandMark'
import { socialLinks } from '../../content/home'

export function SiteFooter() {
  return (
    /* True black, a step below the page, so the footer closes the document
       rather than looking like one more section. */
    <footer className="border-rule px-page flex flex-col items-start gap-5 border-t bg-black py-8.5 wide:flex-row wide:items-center wide:justify-between">
      <div className="flex items-center gap-3">
        <BrandMark className="w-6.5 shrink-0 opacity-70" />
        {/* Wraps to two lines on a phone rather than being squeezed: the line is
            about 360px of tracked-out mono and there is no width at which it
            both fits and stays legible. */}
        <span className="text-faint font-mono text-[10px] leading-[1.6] font-medium tracking-[0.14em]">
          RCCF · UNIVERSITY OF CENTRAL FLORIDA · ORLANDO, FL
        </span>
      </div>

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
    </footer>
  )
}
