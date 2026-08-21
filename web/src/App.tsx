import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { SiteLayout } from './components/layout/SiteLayout'
import { SessionProvider } from './lib/auth'
import { DashboardLayout } from './components/dashboard/DashboardLayout'
import { DashboardPage } from './pages/DashboardPage'
import { DuesPage } from './pages/DuesPage'
import { EquipmentPage } from './pages/EquipmentPage'
import { HomePage } from './pages/HomePage'
import { JoinPage } from './pages/JoinPage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { OfficerEquipmentPage } from './pages/OfficerEquipmentPage'
import { OfficerPrintQueuePage } from './pages/OfficerPrintQueuePage'
import { OfficerProjectsPage } from './pages/OfficerProjectsPage'
import { OfficerRolesPage } from './pages/OfficerRolesPage'
import { PastProjectsPage } from './pages/PastProjectsPage'
import { PrintRequestPage } from './pages/PrintRequestPage'
import { ProjectDashboardPage } from './pages/ProjectDashboardPage'
import { ProjectManagePage } from './pages/ProjectManagePage'
import { ProjectPage } from './pages/ProjectPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { ProfilePage } from './pages/ProfilePage'

/**
 * The router.
 *
 * `BrowserRouter` rather than a data router: nothing here loads through a route
 * loader — components fetch what they need via `useApi` — so the data APIs
 * would be machinery for nothing. Real paths rather than hashes, because the
 * signup verification link goes in an email and `/join?token=…` is a URL
 * somebody might have to read out.
 *
 * `MembersPage`, `EventsPage` and `AboutPage` are still the empty files that
 * named the destinations before anything was built, and a few section headers
 * point at them — those land on `NotFoundPage` until somebody writes them,
 * which is at least honest about what exists.
 *
 * A dev server hands any path back to `index.html` and so does a static host
 * once it is told to; without that rewrite rule, `/join` 404s before React ever
 * runs. See the deploy notes in `web/README.md`.
 */
function App() {
  return (
    <BrowserRouter>
      {/* Outside the routes, and inside the router. Outside, because the nav
          and three pages all want the same answer and asking per component
          would flicker; inside, because signing in navigates. */}
      <SessionProvider>
        <ScrollToTop />
        <Routes>
          <Route element={<SiteLayout />}>
            <Route index element={<HomePage />} />
            <Route path="join" element={<JoinPage />} />
            <Route path="login" element={<LoginPage />} />
            {/* The dashboard is a section, not a page: the layout holds the
                session gate and the sidebar, the children assume both. */}
            <Route path="dashboard" element={<DashboardLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="dues" element={<DuesPage />} />
              <Route path="print" element={<PrintRequestPage />} />
              <Route path="equipment" element={<EquipmentPage />} />
              {/* Before the `:slug` routes below. React Router ranks a static
                  segment above a dynamic one whatever the order here, so this
                  is for the reader — but it is also the reminder that a project
                  slugged `past` would be unreachable from the dashboard. */}
              <Route path="projects/past" element={<PastProjectsPage />} />
              <Route path="projects/:slug" element={<ProjectDashboardPage />} />
              <Route path="projects/:slug/manage" element={<ProjectManagePage />} />
              <Route path="officer/roles" element={<OfficerRolesPage />} />
              <Route path="officer/projects" element={<OfficerProjectsPage />} />
              <Route path="officer/print" element={<OfficerPrintQueuePage />} />
              <Route path="officer/equipment" element={<OfficerEquipmentPage />} />
            </Route>
            {/* Dues moved inside the dashboard. This stays because the address
                is out in the world: it is in browser histories, and it was the
                Stripe `return_url` for every payment started before the move —
                one of which may still be sitting on a bank's 3-D Secure page. */}
            <Route path="dues" element={<MovedToDashboardDues />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:slug" element={<ProjectPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  )
}

/**
 * `/dues` → `/dashboard/dues`, keeping the query string.
 *
 * The query string is the whole reason this is a component rather than a bare
 * `<Navigate to="/dashboard/dues" />`. A payment method that bounces through a
 * bank returns to `?payment_intent=…`, and that parameter is the only thing the
 * dues page has to go on when it lands — dropping it on the way through the
 * redirect would leave somebody who has just been charged looking at a page
 * that says they still owe $25.
 */
function MovedToDashboardDues() {
  const { search, hash } = useLocation()

  return <Navigate to={{ pathname: '/dashboard/dues', search, hash }} replace />
}

/**
 * Start a new page at the top of it.
 *
 * A history push does not move the scroll position, so following the join
 * button from the bottom of the FAQ otherwise lands you on the signup form
 * already scrolled past its heading.
 *
 * Two details keep it from breaking the things that were already right. It sits
 * out when there is a hash, because that URL is asking for a particular section
 * and the browser is about to go there. And it scrolls instantly rather than
 * inheriting the page's smooth behaviour — smooth is for a click that says
 * where it is going, not for arriving somewhere new and watching it travel.
 */
function ScrollToTop() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    if (!hash) window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname, hash])

  return null
}

export default App
