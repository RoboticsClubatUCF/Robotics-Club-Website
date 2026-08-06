import { HeroSection } from '../components/home/HeroSection'
import { StatStrip } from '../components/home/StatStrip'
import { SponsorsSection } from '../components/home/SponsorsSection'
import { CalendarSection } from '../components/home/CalendarSection'
import { OfficersSection } from '../components/home/OfficersSection'
import { FaqSection } from '../components/home/FaqSection'

/**
 * The landing page: hero → stat strip → sponsors → calendar → officers → FAQ.
 *
 * This composition used to be `App.tsx`, which was the whole site. `App` is the
 * router now and the nav and footer live in `SiteLayout`, so what is left here
 * is one route's worth of sections.
 *
 * The stat strip draws its own bottom rule, so whichever section comes first
 * goes without a `border-t` and every one after it carries one. Reordering
 * these means moving that class, not just the lines.
 *
 * The project list used to sit between the stat strip and the sponsors. It has
 * its own page now, which `src/pages/ProjectsPage.tsx` is waiting to become.
 */
export function HomePage() {
  return (
    <>
      <HeroSection />
      <StatStrip />
      <SponsorsSection />
      <CalendarSection />
      <OfficersSection />
      <FaqSection />
    </>
  )
}
