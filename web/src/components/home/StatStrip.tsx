import { Link } from 'react-router'
import { stats } from '../../content/home'
import type { ApiStats } from '../../lib/api/api'
import { useApi } from '../../lib/api/useApi'

/**
 * Full-bleed strip of headline numbers, each cell a link into the page it
 * counts. Three of the four come from `GET /api/stats`; the founding year is a
 * constant.
 *
 * **All four destinations exist now**, so the cells are `<Link>`s rather than
 * plain anchors — the whole strip used to reload the document into a 404. Each
 * count is deliberately the number of rows its page shows by default: `/stats`
 * applies the same filters the listing routes apply, so the number you read
 * here is the number you find when you land. Change one and change the other.
 *
 * **ACTIVE MEMBERS used to be the one cell that broke that**, and its label was
 * how: `/members` listed every account, guests included, while the count was
 * the club's membership. That page defaults to the same membership now and the
 * two agree. The label stays — it is what the number is — and it stays in
 * `content/home.ts` beside the count it belongs to rather than being derived
 * here, because the roster's chip carries the same two words and the two are
 * meant to be read as one claim.
 *
 * Hand-rolled rather than DaisyUI's `stats`: that component is an `inline-grid`
 * with its own radius, dashed dividers and horizontal scroll, so using it here
 * would mean overriding all four. The dividers are the container's background
 * showing through a 1px grid gap, which gets the rules right at both column
 * counts without any nth-child arithmetic.
 */
export function StatStrip() {
  const counts = useApi<ApiStats>('/stats')

  return (
    <section className="bg-rule border-rule grid grid-cols-2 gap-px border-y wide:grid-cols-4">
      {stats.map((stat) => (
        <Link
          key={stat.label}
          to={stat.href}
          /* Only the first cell aligns to the page gutter; the rest are
             internal to the strip, which runs edge to edge. The focus ring is
             inset because the cell is flush with its neighbours — an outset one
             would be clipped by the rules on either side. */
          className="bg-base-100 hover:bg-wash focus-visible:bg-wash focus-visible:outline-primary pl-page py-7 pr-8 transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 wide:pl-8 wide:first:pl-page"
        >
          <div
            className={`flex h-[2.125rem] items-center text-[2.125rem] leading-none font-bold ${
              stat.accent ? 'text-primary' : ''
            }`}
          >
            {stat.countOf === undefined ? (
              stat.value
            ) : counts.status === 'ready' ? (
              counts.data[stat.countOf].toLocaleString()
            ) : counts.status === 'loading' ? (
              /* Sized to the digits it replaces, so the strip doesn't reflow
                 when the number lands. */
              <span className="bg-base-300 h-7 w-14 animate-pulse rounded-[2px]" />
            ) : (
              /* The API is unreachable. An em dash keeps the cell honest — and
                 still clickable — rather than showing a stale or invented
                 number. */
              <span className="text-faint" title="Could not load">
                —
              </span>
            )}
          </div>
          <div className="text-faint mt-2 font-mono text-[10px] font-medium tracking-[0.16em]">
            {stat.label}
          </div>
        </Link>
      ))}
    </section>
  )
}
