import { SiteNav } from './components/SiteNav'
import { HeroSection } from './components/HeroSection'
import { StatStrip } from './components/StatStrip'
import { ProjectsSection } from './components/ProjectsSection'
import { MeetingsSection } from './components/MeetingsSection'
import { SiteFooter } from './components/SiteFooter'

/**
 * The landing page. There is still no router, so this is the whole site — when
 * one lands, this composition becomes the home route and `SiteNav`/`SiteFooter`
 * move up into a layout around it.
 */
function App() {
  return (
    <>
      <SiteNav />
      <main>
        <HeroSection />
        <StatStrip />
        <ProjectsSection />
        <MeetingsSection />
      </main>
      <SiteFooter />
    </>
  )
}

export default App
