import { HeroSection } from '../../components/home/HeroSection'
import { StatStrip } from '../../components/home/StatStrip'
import { SponsorsSection } from '../../components/home/SponsorsSection'
import { CalendarSection } from '../../components/home/CalendarSection'
import { OfficersSection } from '../../components/home/OfficersSection'
import { PartnersSection } from '../../components/home/PartnersSection'
import { FaqSection } from '../../components/home/FaqSection'
import type { ApiFrontPage } from '../../lib/api/api'
import { useApi } from '../../lib/api/useApi'

/**
 * The landing page: hero → stat strip → sponsors → calendar → officers →
 * partner programs → FAQ.
 *
 * This composition used to be `App.tsx`, which was the whole site. `App` is the
 * router now and the nav and footer live in `SiteLayout`, so what is left here
 * is one route's worth of sections.
 *
 * **It is not only a composition any more: it fetches the page's words.** Three
 * of the sections below print copy officers write — the headline and its lede,
 * the line above the partner cards, and the FAQ — and all of it is one row and
 * two short lists behind `GET /api/front-page`. One request handed down beats
 * three inside the sections: it is one document somebody wrote in one sitting,
 * `useApi` has no cache to make asking three times cheap, and the alternative is
 * three loading states on one page for one answer.
 *
 * The sections still fetch their own **data** — the slideshow, the events, the
 * board, the sponsors — because those are lists that change on their own and
 * belong to whoever draws them. Copy and data are the line: this is the writing
 * around the lists rather than the lists.
 *
 * Each section is handed the whole `ApiState` rather than the copy inside it,
 * so each one decides what it looks like while the answer is out. They differ,
 * and they should: the hero holds its shape and fills in, and the partner
 * section is simply not on the page yet.
 *
 * The stat strip draws its own bottom rule, so whichever section comes first
 * goes without a `border-t` and every one after it carries one. Reordering
 * these means moving that class, not just the lines.
 */
export function HomePage() {
  const copy = useApi<ApiFrontPage>('/front-page')

  return (
    <>
      <HeroSection copy={copy} />
      <StatStrip />
      <SponsorsSection />
      <CalendarSection />
      <OfficersSection />
      <PartnersSection copy={copy} />
      <FaqSection copy={copy} />
    </>
  )
}
