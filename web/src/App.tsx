import { SiteNav } from './components/SiteNav'
import { HeroSection } from './components/HeroSection'
import { StatStrip } from './components/StatStrip'
import { SponsorsSection } from './components/SponsorsSection'
import { CalendarSection } from './components/CalendarSection'
import { OfficersSection } from './components/OfficersSection'
import { FaqSection } from './components/FaqSection'
import { SiteFooter } from './components/SiteFooter'

/**
 * The landing page. There is still no router, so this is the whole site — when
 * one lands, this composition becomes the home route and `SiteNav`/`SiteFooter`
 * move up into a layout around it.
 *
 * The project list used to sit between the stat strip and the sponsors. It has
 * its own page now, which `src/pages/ProjectsPage.tsx` is waiting to become.
 *
 * The stat strip draws its own bottom rule, so whichever section comes first
 * here goes without a `border-t` and every one after it carries one. Reordering
 * these means moving that class, not just the lines.
 */
function App() {
  return (
    <>
      <SiteNav />
      <main>
        <HeroSection />
        <StatStrip />
        <SponsorsSection />
        <CalendarSection />
        <OfficersSection />
        <FaqSection />
      </main>
      <SiteFooter />
    </>
  )
}

export default App
