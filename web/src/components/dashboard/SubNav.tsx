import { NavLink } from 'react-router'
import type { SubPage } from '../../lib/dashboard/subPages'

/**
 * A section's sub-pages as a row of links under the heading.
 *
 * Phones only by default. At `wide` the rail is on screen with the same list open under the
 * section, and printing it twice would be one label on screen two times. Below `wide` the
 * rail is folded behind MENU, so without this a sub-page would be three presses away.
 *
 * `always` is for a page the rail doesn't list: an officer managing a project they aren't on
 * has no rail row for it.
 */
export function SubNav({
  label,
  pages,
  always = false,
}: {
  /** The landmark's name, e.g. "Roles pages". */
  label: string
  pages: readonly SubPage[]
  always?: boolean
}) {
  return (
    <nav aria-label={label} className={`mb-7 ${always ? '' : 'wide:hidden'}`}>
      <ul className="flex flex-wrap gap-2">
        {pages.map((page) => (
          <li key={page.to}>
            <NavLink
              to={page.to}
              end
              className={({ isActive }) =>
                `border-rule flex items-center border px-3 py-1.5 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 max-wide:min-h-11 ${
                  isActive
                    ? 'border-primary text-primary bg-primary/5'
                    : 'text-dim hover:text-primary'
                }`
              }
            >
              {page.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
