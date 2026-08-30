import { lazy, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { SiteLayout } from './components/layout/SiteLayout'
import { SessionProvider } from './lib/auth/auth'
import { DashboardLayout } from './components/dashboard/DashboardLayout'
import { AboutPage } from './pages/public/AboutPage'
import { EventsPage } from './pages/public/EventsPage'
import { HomePage } from './pages/public/HomePage'
import { JoinPage } from './pages/auth/JoinPage'
import { LoginPage } from './pages/auth/LoginPage'
import { MembersPage } from './pages/public/MembersPage'
import { NotFoundPage } from './pages/public/NotFoundPage'
import { PastOfficersPage } from './pages/public/PastOfficersPage'
import { ProjectDocsPage } from './pages/public/ProjectDocsPage'
import { ProjectPage } from './pages/public/ProjectPage'
import { ProjectsPage } from './pages/public/ProjectsPage'
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage'
import { SponsorsPage } from './pages/public/SponsorsPage'

/**
 * Everything under `/dashboard`, fetched when somebody first opens it.
 *
 * Twenty pages, nine of them officer desks, and none of them are reachable
 * without a session — so shipping them in the bundle meant every visitor who
 * read the front page and left downloaded the print queue, the survey editor
 * and the sponsor desk to do it. That was most of one 874 kB chunk.
 *
 * Split here rather than per page inside the layout, because the boundary that
 * matters is signed-in / not: a member who opens the dashboard goes on to open
 * several of these, and the rail is a list of links between them. The
 * `<Suspense>` that catches them is around the layout's `<Outlet />`, so the
 * rail stays on screen while a page arrives.
 *
 * `lazy` wants a default export and these are all named, hence the unwrap. The
 * public pages are deliberately *not* split: they are what a first-time visitor
 * gets, and a second round trip before the front page paints is the opposite of
 * the trade being made here.
 */
const DashboardPage = lazy(async () => ({
  default: (await import('./pages/dashboard/DashboardPage')).DashboardPage,
}))
const DuesPage = lazy(async () => ({
  default: (await import('./pages/dashboard/DuesPage')).DuesPage,
}))
const EquipmentPage = lazy(async () => ({
  default: (await import('./pages/dashboard/EquipmentPage')).EquipmentPage,
}))
const EventsManagePage = lazy(async () => ({
  default: (await import('./pages/dashboard/EventsManagePage')).EventsManagePage,
}))
const MemberSurveyPage = lazy(async () => ({
  default: (await import('./pages/dashboard/MemberSurveyPage')).MemberSurveyPage,
}))
const OfficerEquipmentPage = lazy(async () => ({
  default: (await import('./pages/officer/OfficerEquipmentPage')).OfficerEquipmentPage,
}))
const OfficerFrontPagePage = lazy(async () => ({
  default: (await import('./pages/officer/OfficerFrontPagePage')).OfficerFrontPagePage,
}))
const OfficerPrintQueuePage = lazy(async () => ({
  default: (await import('./pages/officer/OfficerPrintQueuePage')).OfficerPrintQueuePage,
}))
const OfficerProjectsPage = lazy(async () => ({
  default: (await import('./pages/officer/OfficerProjectsPage')).OfficerProjectsPage,
}))
const OfficerRolesPage = lazy(async () => ({
  default: (await import('./pages/officer/OfficerRolesPage')).OfficerRolesPage,
}))
const OfficerSemestersPage = lazy(async () => ({
  default: (await import('./pages/officer/OfficerSemestersPage')).OfficerSemestersPage,
}))
const OfficerSponsorsPage = lazy(async () => ({
  default: (await import('./pages/officer/OfficerSponsorsPage')).OfficerSponsorsPage,
}))
const OfficerSurveyPage = lazy(async () => ({
  default: (await import('./pages/officer/OfficerSurveyPage')).OfficerSurveyPage,
}))
const OfficerSurveyQuestionsPage = lazy(async () => ({
  default: (await import('./pages/officer/OfficerSurveyQuestionsPage')).OfficerSurveyQuestionsPage,
}))
const PastProjectsPage = lazy(async () => ({
  default: (await import('./pages/dashboard/PastProjectsPage')).PastProjectsPage,
}))
const PrintRequestPage = lazy(async () => ({
  default: (await import('./pages/dashboard/PrintRequestPage')).PrintRequestPage,
}))
const ProfilePage = lazy(async () => ({
  default: (await import('./pages/dashboard/ProfilePage')).ProfilePage,
}))
const ProjectDashboardPage = lazy(async () => ({
  default: (await import('./pages/dashboard/ProjectDashboardPage')).ProjectDashboardPage,
}))
const ProjectManagePage = lazy(async () => ({
  default: (await import('./pages/dashboard/ProjectManagePage')).ProjectManagePage,
}))
const TasksPage = lazy(async () => ({
  default: (await import('./pages/dashboard/TasksPage')).TasksPage,
}))

/**
 * The router.
 *
 * `BrowserRouter` rather than a data router: nothing here loads through a route
 * loader — components fetch what they need via `useApi` — so the data APIs
 * would be machinery for nothing. Real paths rather than hashes, because the
 * signup verification link goes in an email and `/join?token=…` is a URL
 * somebody might have to read out.
 *
 * `/members`, `/events`, `/about` and `/sponsors` were the four addresses the
 * stat strip and two section headers had always pointed at with nothing behind
 * them. They are pages now, and the links that named them are `<Link>`s. **One
 * of the four is still a mockup**: the club's history in `src/content/about.ts`
 * is placeholder copy, marked as such on the page itself so nobody quotes an
 * invented milestone back at the club. `/sponsors` used to be the second, and
 * is not any more — every word of it, the price list included, is written by
 * officers at `/dashboard/officer/sponsors`.
 *
 * `/events` is the *public* schedule and is a different thing from
 * `/dashboard/events`, which is the desk leads and officers write it from.
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
            {/* Its own route rather than a screen of the login page, because
                the address goes in an email: the link is `/reset-password?token=…`
                and the page posts the token back, so a mail scanner following
                it cannot spend it. Both halves live there, keyed on the token,
                the same way `/join` holds signup's four screens. */}
            <Route path="reset-password" element={<ResetPasswordPage />} />
            {/* The dashboard is a section, not a page: the layout holds the
                session gate and the sidebar, the children assume both. */}
            <Route path="dashboard" element={<DashboardLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="profile" element={<ProfilePage />} />
              {/* Ahead of dues in the rail as well as in the gate: this is
                  the one page nothing can lock, because everything else is
                  locked until it is done. */}
              <Route path="survey" element={<MemberSurveyPage />} />
              <Route path="dues" element={<DuesPage />} />
              {/* Under `/dashboard` rather than `/dashboard/officer`, the same
                  call the events desk makes: leads and officers write tasks
                  here, but so does every member reading their own, and this is
                  one page rather than two that differ by who is looking. */}
              <Route path="tasks" element={<TasksPage />} />
              <Route path="print" element={<PrintRequestPage />} />
              <Route path="equipment" element={<EquipmentPage />} />
              {/* Under `/dashboard` rather than `/dashboard/officer`, unlike
                  every other `/ MANAGE` row: project leads open this one too,
                  and `officer` in a URL they are entitled to would be a lie in
                  the address bar. The page gates on membership rank, which is
                  where project authority actually lives. */}
              <Route path="events" element={<EventsManagePage />} />
              {/* Before the `:slug` routes below. React Router ranks a static
                  segment above a dynamic one whatever the order here, so this
                  is for the reader — but it is also the reminder that a project
                  slugged `past` would be unreachable from the dashboard. */}
              <Route path="projects/past" element={<PastProjectsPage />} />
              <Route path="projects/:slug" element={<ProjectDashboardPage />} />
              <Route path="projects/:slug/manage" element={<ProjectManagePage />} />
              <Route path="officer/roles" element={<OfficerRolesPage />} />
              <Route
                path="officer/semesters"
                element={<OfficerSemestersPage />}
              />
              <Route path="officer/survey" element={<OfficerSurveyPage />} />
              {/* Under the survey desk rather than beside it: it is the same
                  desk, and the rail already has a row for it. The two pages
                  link to each other. */}
              <Route
                path="officer/survey/questions"
                element={<OfficerSurveyQuestionsPage />}
              />
              {/* The photographs beside the landing page's headline. Under
                  `officer/` like the rest of the desks — what the club leads
                  with is a board decision, and unlike EVENTS there is no
                  per-project half of it for a lead to hold. */}
              <Route
                path="officer/front-page"
                element={<OfficerFrontPagePage />}
              />
              {/* Beside FRONT PAGE rather than beside PROJECTS, because it is
                  the same kind of thing: what the club says about itself on a
                  public page. It writes all three of `/sponsors` — who backs
                  the club, what a tier costs, and the ways to help that are not
                  money — which is why there is one desk and not three. */}
              <Route path="officer/sponsors" element={<OfficerSponsorsPage />} />
              <Route path="officer/projects" element={<OfficerProjectsPage />} />
              <Route path="officer/print" element={<OfficerPrintQueuePage />} />
              <Route path="officer/equipment" element={<OfficerEquipmentPage />} />
            </Route>
            {/* Dues moved inside the dashboard. This stays because the address
                is out in the world: it is in browser histories, and it was the
                Stripe `return_url` for every payment started before the move —
                one of which may still be sitting on a bank's 3-D Secure page. */}
            <Route path="dues" element={<MovedToDashboardDues />} />
            {/* `/officers` is the archive, and the sitting board stays a
                section of the front page at `/#officers`. Two different things
                under one word, so the page says which it is in its heading —
                somebody arriving here from a search engine has no nav trail to
                tell them. */}
            <Route path="officers" element={<PastOfficersPage />} />
            <Route path="members" element={<MembersPage />} />
            {/* The public schedule. `/dashboard/events` is the desk it is
                written from, and the two are deliberately different words in
                different sections rather than one page that changes shape
                depending on who is looking at it. */}
            <Route path="events" element={<EventsPage />} />
            <Route path="sponsors" element={<SponsorsPage />} />
            <Route path="about" element={<AboutPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:slug" element={<ProjectPage />} />
            {/* A section of the project rather than a page of its own: it
                reads the same `/projects/:slug` the page above does, and is
                reachable from that page's `/ RESOURCES` list. Public for the
                same reason the project is — a judge asking for documentation
                should get a link, not an invitation to a Drive folder. */}
            <Route path="projects/:slug/docs" element={<ProjectDocsPage />} />
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
