import { BrandMark } from './BrandMark'
import { navLinks } from '../content/home'

/**
 * Sticky top bar. The blur is what lets the near-black background sit at 90%
 * opacity — content scrolling underneath stays suggested rather than legible.
 */
export function SiteNav() {
  return (
    <header className="border-rule bg-base-100/90 sticky top-0 z-10 border-b backdrop-blur-sm">
      <nav className="navbar px-page gap-6 py-5">
        <a href="#top" className="flex flex-1 items-center gap-3.5">
          <BrandMark className="w-10" />
          <span>
            <span className="block text-[13px] leading-none font-bold tracking-[0.06em]">
              ROBOTICS CLUB
            </span>
            <span className="text-primary mt-[3px] block font-mono text-[9px] leading-none font-medium tracking-[0.22em]">
              OF CENTRAL FLORIDA
            </span>
          </span>
        </a>

        {/* The links collapse below the breakpoint but the join button does
            not: it is the only reason the bar exists, and a phone is where
            most people first hit the site. A menu replaces the links once
            there are real routes behind them. */}
        <ul className="hidden items-center gap-8.5 wide:flex">
          {navLinks.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="text-dim text-[13px] font-medium transition-colors duration-200 hover:text-white"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <a
          href="#join"
          className="btn btn-primary btn-cta px-4.5 py-2.5 text-xs font-semibold"
        >
          JOIN THE CLUB
        </a>
      </nav>
    </header>
  )
}
