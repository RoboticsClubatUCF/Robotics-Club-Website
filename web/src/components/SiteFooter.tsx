import { BrandMark } from './BrandMark'
import { socialLinks } from '../content/home'

export function SiteFooter() {
  return (
    /* True black, a step below the page, so the footer closes the document
       rather than looking like one more section. */
    <footer className="border-rule px-page flex flex-col items-start gap-5 border-t bg-black py-8.5 wide:flex-row wide:items-center wide:justify-between">
      <div className="flex items-center gap-3">
        <BrandMark className="w-6.5 opacity-70" />
        <span className="text-faint font-mono text-[10px] font-medium tracking-[0.14em]">
          RCCF · UNIVERSITY OF CENTRAL FLORIDA · ORLANDO, FL
        </span>
      </div>

      <ul className="flex gap-5.5">
        {socialLinks.map((link) => (
          <li key={link.label}>
            <a
              href={link.href}
              className="text-faint hover:text-primary font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </footer>
  )
}
