import { Suspense, useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { ApiError, getJson, postJson } from '../../lib/api/api'
import type {
  ApiDuesStatus,
  ApiMembership,
  ApiMyProject,
  ApiUser,
} from '../../lib/api/api'
import { surveyPrompt } from '../../lib/dues/dues'
import { useSession } from '../../lib/auth/session'
import type { ApiState } from '../../lib/api/useApi'
import { DashboardRail } from './DashboardRail'
import { SurveyPromptDialog } from './SurveyPromptDialog'
import {
  FormEyebrow,
  FormHeading,
  FormPage,
  FormPanel,
} from '../shared/formChrome'

/**
 * The frame around every dashboard page: one session gate, one rail, one fetch of
 * "my projects" shared with everything inside.
 *
 * The gate lives here and nowhere else — child pages render assuming somebody is
 * signed in, because this has already redirected anyone who isn't. `state.from` on
 * that redirect is what brings a person back to the page they asked for.
 *
 * `/me/projects` is fetched once and passed down through outlet context rather than
 * per page: the rail needs it for the project links, the overview for the cards, and
 * `useApi` has no cache to make asking twice cheap.
 *
 * The `/ MANAGE` group is the officer desks plus EVENTS, which project leads reach
 * too — so the group is gated by the global role or by holding a lead's rank on any
 * membership, and its rows are gated individually. Cosmetics either way, since every
 * route re-checks on the server. Named for what those pages do rather than who may
 * open them: a group headed OFFICERS describes the reader, and the reader knows.
 *
 * Everything the dashboard offers is a route under `/dashboard`. Dues used to be the
 * exception and it was the wrong shape — clicking a rail link and losing the rail
 * makes a section feel like separate pages sharing a heading. `/dues` still resolves
 * as a redirect, because it's in Stripe return URLs and in people's history.
 */
export interface DashboardContext {
  user: ApiUser
  projects: ApiState<ApiMyProject[]>
  /** Call after anything that changes a membership — joining, leaving, team
      edits — so the rail and overview agree with what just happened. */
  reloadProjects: () => Promise<void>
  /**
   * Where this person stands on dues, fetched once for the whole section — the rail
   * needs it to lock, the overview to draw the panel, and asking twice would be two
   * reads of UCF's calendar per page.
   *
   * Anything but `ready` means "lock nothing": the server refuses a lapsed lead
   * whatever this says, so the worst a pending answer does is let somebody click
   * through to an honest 403. The alternative is flashing a padlock at a paid-up
   * member on every page load.
   */
  membership: ApiState<ApiMembership>
  /** Call after paying or claiming a free break, so the rail unlocks. */
  reloadMembership: () => Promise<void>
}

export function DashboardLayout() {
  const { session } = useSession()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (session.status === 'signed-out') {
      void navigate('/login', {
        replace: true,
        // The search string too, not just the path. The email-change confirmation
        // lands on `/dashboard/profile?emailToken=…`, and somebody following that
        // link from a phone is usually not signed in there. Dropping the query would
        // bring them back with the token gone and nothing to say why the confirmation
        // didn't happen.
        state: { from: `${location.pathname}${location.search}` },
      })
    }
  }, [session.status, navigate, location.pathname, location.search])

  if (session.status === 'loading') {
    return (
      <FormPage width="wide">
        <div aria-busy="true">
          <FormEyebrow>/ DASHBOARD</FormEyebrow>
          <FormHeading>Loading…</FormHeading>
          <div className="border-rule bg-base-200 h-40 border" />
        </div>
      </FormPage>
    )
  }

  if (session.status === 'error') {
    return (
      <FormPage width="wide">
        <FormEyebrow>/ DASHBOARD</FormEyebrow>
        <FormHeading>We can't reach the server.</FormHeading>
        <FormPanel tone="accent">
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            This page couldn't check who you are. Try again in a moment.
          </p>
        </FormPanel>
      </FormPage>
    )
  }

  // The redirect above is on its way.
  if (session.status !== 'signed-in') return null

  return <DashboardShell user={session.user} />
}

/**
 * Split from the gate so the `/me/projects` request only fires for somebody signed
 * in — mounted earlier it would 401 into the console of every visitor on their way
 * to the login page.
 *
 * The fetch is hand-rolled rather than `useApi` for the reason the dues page's is:
 * children mutate memberships, and a hook with no refetch would leave the rail
 * describing the world as it was before the click.
 *
 * No `px-page` on the outer element, and that's the whole layout decision. The rail
 * is flush to the left edge with its own surface and one hairline down its right
 * side, so it reads as fixed furniture rather than a column of links that happens to
 * be first. The gutter moves onto the content column.
 */
function DashboardShell({ user }: { user: ApiUser }) {
  const location = useLocation()
  /**
   * Put away for the rest of this page session.
   *
   * The permanent answer is a column on the user — the checkbox writes
   * `surveyPromptDismissedAt` — and this only keeps the dialog down between that
   * write and the refetch that confirms it. It also stands alone for somebody who
   * closed the prompt without ticking the box, where asking again next reload is the
   * right side to err on: nothing is locked either way.
   */
  const [promptClosed, setPromptClosed] = useState(false)

  const [projects, setProjects] = useState<ApiState<ApiMyProject[]>>({
    status: 'loading',
  })
  const [membership, setMembership] = useState<ApiState<ApiMembership>>({
    status: 'loading',
  })

  const reloadMembership = useCallback(async () => {
    try {
      const status = await getJson<ApiDuesStatus>('/dues/status')
      setMembership({ status: 'ready', data: status.membership })
    } catch (error) {
      console.error(error)
      setMembership({
        status: 'error',
        code: error instanceof ApiError ? error.status : 0,
      })
    }
  }, [])

  const reloadProjects = useCallback(async () => {
    try {
      const data = await getJson<ApiMyProject[]>('/me/projects')
      setProjects({ status: 'ready', data })
    } catch (error) {
      console.error(error)
      setProjects({
        status: 'error',
        code: error instanceof ApiError ? error.status : 0,
      })
    }
  }, [])

  useEffect(() => {
    void reloadProjects()
    void reloadMembership()
  }, [reloadProjects, reloadMembership])

  /**
   * Closing the prompt, and the checkbox on it.
   *
   * The write is fired and not waited on; the dialog is already down by then. A
   * failed dismissal costs the member one more prompt on their next visit, which is
   * the cheapest way for this to go wrong and the reason nothing reports an error.
   */
  const closeSurveyPrompt = useCallback(
    (dontAsk: boolean) => {
      setPromptClosed(true)

      if (!dontAsk) return

      void postJson('/survey/dismiss', {})
        .then(reloadMembership)
        .catch((error: unknown) => {
          console.error(error)
        })
    },
    [reloadMembership],
  )

  /**
   * The survey prompt, and the two pages it stays off.
   *
   * `/dashboard/survey` for the obvious reason, and `/dashboard/profile` because
   * that's where signing out lives — a prompt covering the way out of an account is
   * the one version of this that could strand somebody.
   *
   * It's the whole of what asks now, which is why it's only ever mounted here. The
   * survey used to be a gate, so a member met it as a wall of padlocks; it's a
   * question asked once, because a club that can't make anybody answer had better
   * not annoy the people who would.
   */
  const asking = surveyPrompt(membership)
  /**
   * The slicer gets the whole width, the way a slicer does: no rail, no gutter. It keeps the
   * gate and the context, and the site's nav above it is the way back. No survey prompt over a
   * plate somebody is in the middle of arranging, either. The slicer training is the slicer on a
   * practice plate, so it gets the same.
   */
  const workspace =
    location.pathname.startsWith('/dashboard/print/slicer') ||
    location.pathname.startsWith('/dashboard/profile/training')
  const promptable =
    !workspace &&
    !location.pathname.startsWith('/dashboard/survey') &&
    !location.pathname.startsWith('/dashboard/profile')
  const context = {
    user,
    projects,
    reloadProjects,
    membership,
    reloadMembership,
  } satisfies DashboardContext

  if (workspace) {
    return (
      <div data-skip-target tabIndex={-1} className="min-w-0 outline-none">
        <Suspense fallback={<div aria-busy="true" className="h-[calc(100dvh-var(--spacing-nav))]" />}>
          <Outlet context={context} />
        </Suspense>
      </div>
    )
  }

  return (
    <div className="wide:grid wide:grid-cols-[15rem_1fr]">
      <DashboardRail user={user} projects={projects} membership={membership} />

      {asking && promptable && !promptClosed && (
        <SurveyPromptDialog onClose={closeSurveyPrompt} />
      )}

      {/* Where SKIP TO CONTENT lands. The rail is inside `<main>` too, and skipping to
          `<main>` left seventeen rail links between the skip and the page. */}
      <div data-skip-target tabIndex={-1} className="px-page min-w-0 py-9 outline-none wide:py-12">
        {/* Still left-aligned rather than centred in the remaining space: the rail is
            the left edge of the layout, and content that drifted away would put the
            canyon between the two.

            62rem was a reading measure applied to a whole section, which was the wrong
            thing to measure — on anything wider than a laptop it left a third of the
            screen empty while the pages inside stacked into one narrow column. The
            measure belongs to the panels; this only has to stop the widest monitors
            drawing a 2000px row of controls. */}
        <div className="min-w-0 max-w-[112rem]">
          {/* Every page under here is fetched on first use — see the note at the top
              of `App.tsx`. The boundary is inside the layout on purpose: the rail is
              what somebody navigates with, so it stays on screen while the next page
              arrives rather than the whole dashboard blinking out and back.

              The fallback reserves height and says nothing. It's on screen for a few
              hundred milliseconds once per session, and the pages behind it draw their
              own skeletons — a second spinner would be two loading states for one
              navigation. `aria-busy` rather than `role="status"`: nothing to announce. */}
          <Suspense fallback={<div aria-busy="true" className="min-h-[60vh]" />}>
            <Outlet context={context} />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
