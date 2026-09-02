import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { ProjectEditor } from '../../components/projects/ProjectEditor'
import { ProjectGallery } from '../../components/projects/ProjectGallery'
import { ProjectProse } from '../../components/projects/ProjectProse'
import { useUnsavedGuard } from '../../components/projects/useUnsavedGuard'
import { LeaveProjectButton } from '../../components/shared/LeaveProjectButton'
import { FormEyebrow, FormHeading, FormPanel } from '../../components/shared/formChrome'
import { ApiError, getJson, postJson } from '../../lib/api/api'
import type {
  ApiDuesStatus,
  ApiMyProject,
  ApiProjectDetail,
  ApiUser,
  ProjectMemberRank,
} from '../../lib/api/api'
import { LOCK_COPY, accessLock, coverGap } from '../../lib/dues/dues'
import {
  canEditProject,
  editingAsOfficer,
  rankOn,
} from '../../lib/projects/projectEditing'
import { memberLabel } from '../../lib/projects/projectRoles'
import { slidesOf } from '../../lib/projects/projectGallery'
import { useSession } from '../../lib/auth/session'
import type { ApiState } from '../../lib/api/useApi'
import { useApi } from '../../lib/api/useApi'

/**
 * `/projects/:slug` — one project's public profile.
 *
 * This is where "open projects" links from the dashboard land, and it is
 * reachable signed out on purpose: a guest deciding whether to pay dues should
 * be able to read what they would be joining. The join panel below the fold is
 * where the gate lives — signed out it points at signing in, unpaid it points
 * at the dues page, and only a covered member gets the button. The server
 * re-checks all three, so the panel is honesty rather than enforcement.
 */
export function ProjectPage() {
  const { slug = '' } = useParams()
  const [state, setState] = useState<ApiState<ApiProjectDetail>>({
    status: 'loading',
  })

  /**
   * Its own loader rather than `useApi`, for the one thing `useApi` cannot do:
   * refetch. The editor changes this page, and a page that cannot re-read
   * itself would have to guess at what the server now holds.
   *
   * `fresh` bypasses the browser's HTTP cache. `/projects/:slug` is a public,
   * cacheable route by design, so the read after a save would otherwise be
   * answered from the cache with the copy from *before* the save — which looks
   * exactly like the save having failed. See `getJson`.
   */
  const load = useCallback(
    async (fresh = false) => {
      try {
        const data = await getJson<ApiProjectDetail>(
          `/projects/${slug}`,
          undefined,
          fresh,
        )
        setState({ status: 'ready', data })
      } catch (error) {
        setState({
          status: 'error',
          code: error instanceof ApiError ? error.status : 0,
        })
      }
    },
    [slug],
  )

  useEffect(() => {
    setState({ status: 'loading' })
    void load()
  }, [load])

  return (
    <section className="px-page py-14 wide:py-20">
      <div className="mx-auto w-full max-w-[46rem]">
        <Link
          to="/projects"
          className="text-faint hover:text-primary mb-8 inline-block font-mono text-[11px] font-medium tracking-[0.14em] transition-colors duration-200"
        >
          ‹ ALL PROJECTS
        </Link>

        {state.status === 'loading' && <ProjectSkeleton />}

        {state.status === 'error' &&
          (state.code === 404 ? (
            <>
              <FormEyebrow>/ PROJECT</FormEyebrow>
              <FormHeading>There is no project here.</FormHeading>
              <FormPanel>
                <p className="text-dim text-sm leading-[1.7] text-pretty">
                  Either the link is wrong or the project has been taken
                  down.
                </p>
              </FormPanel>
            </>
          ) : (
            <>
              <FormEyebrow>/ PROJECT</FormEyebrow>
              <FormHeading>We can't reach the server.</FormHeading>
              <FormPanel tone="accent">
                <p className="text-dim text-sm leading-[1.7] text-pretty">
                  This page couldn't load it. Try again in a moment.
                </p>
              </FormPanel>
            </>
          ))}

        {state.status === 'ready' && (
          <ProjectShell
            project={state.data}
            reload={load}
            apply={(data) => {
              setState({ status: 'ready', data })
            }}
          />
        )}
      </div>
    </section>
  )
}

/**
 * What being signed in adds to this page: the join panel's answer, and whether
 * the edit affordance appears at all.
 *
 * Both halves need the same two reads, so they are taken **once, here, and only
 * when somebody is signed in**. That last part is the contract worth keeping:
 * a signed-out visitor — which is most of this page's traffic, and the whole
 * reason it is reachable signed out — makes exactly one request for the whole
 * page. `useApi` has no dedupe, so a hook added at the top of `ProjectBody`
 * instead would be a request every visitor paid for so that a handful of leads
 * could see a button. There is a test on this.
 */
type SignedIn = {
  user: ApiUser
  dues: ApiState<ApiDuesStatus>
  mine: ApiState<ApiMyProject[]>
}

function ProjectShell(props: {
  project: ApiProjectDetail
  reload: (fresh?: boolean) => Promise<void>
  apply: (project: ApiProjectDetail) => void
}) {
  const { session } = useSession()

  if (session.status === 'signed-in') {
    return <SignedInBody {...props} user={session.user} />
  }

  return <ProjectBody {...props} signedIn={null} />
}

function SignedInBody({
  user,
  ...props
}: {
  user: ApiUser
  project: ApiProjectDetail
  reload: (fresh?: boolean) => Promise<void>
  apply: (project: ApiProjectDetail) => void
}) {
  // Unconditionally, for any project status. The join panel used to bail out
  // before fetching on a finished project; the editor has to work on one, so
  // a signed-in reader of an archived project now costs these two reads too.
  const dues = useApi<ApiDuesStatus>('/dues/status')
  const mine = useApi<ApiMyProject[]>('/me/projects')

  return <ProjectBody {...props} signedIn={{ user, dues, mine }} />
}

function ProjectBody({
  project,
  reload,
  apply,
  signedIn,
}: {
  project: ApiProjectDetail
  reload: (fresh?: boolean) => Promise<void>
  apply: (project: ApiProjectDetail) => void
  signedIn: SignedIn | null
}) {
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const { guard, dialog } = useUnsavedGuard(dirty)

  /**
   * The way out, guarded. Nothing in the editor reaches the server before its
   * SAVE, so leaving is genuinely destructive and `useUnsavedGuard` is what asks
   * — and the refetch afterwards is what puts the reader back on the server's
   * copy rather than on a draft they abandoned.
   */
  const leaveEditing = guard(() => {
    setEditing(false)
    setDirty(false)
    // Fresh, so what the reader lands back on is the server's copy and not a
    // cached one from before any of this.
    void reload(true)
  })

  // "IN_PROGRESS" is an enum name, not a sentence.
  const meta = [project.status.replace(/_/g, ' '), project.season]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      {/* The eyebrow shares its line with the edit affordance, so the button is
          above the fold and out of the reading column. For everyone else —
          which is most people, most of the time — nothing is rendered here at
          all, rather than something greyed out.

          **Nothing takes its place while editing.** This slot used to hold a
          second DONE EDITING, on the argument that the way out belongs where
          somebody last saw the way in. That was worth its weight while the page
          saved as you touched it; now that it saves once, at the bottom, the
          exit belongs with the button it is the alternative to — and two of them
          on one page was one of the three duplicate controls this editor was
          asked to stop having. */}
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <p className="text-faint font-mono text-[13px] font-bold tracking-[0.2em]">
          / PROJECT
        </p>
        {signedIn && !editing && (
          <EditAffordance
            project={project}
            signedIn={signedIn}
            onEdit={() => {
              setEditing(true)
            }}
          />
        )}
      </div>

      <FormHeading>{project.title}</FormHeading>

      <p className="text-faint mb-6 font-mono text-[11px] font-medium tracking-[0.14em]">
        {meta}
        {project.competition && (
          <>
            {' · '}
            <span className="text-primary">{project.competition}</span>
          </>
        )}
      </p>

      {editing && signedIn ? (
        <ProjectEditor
          project={project}
          asOfficer={editingAsOfficer(signedIn.user.role, minesOf(signedIn), project.id)}
          me={signedIn.user}
          apply={apply}
          onDone={leaveEditing}
          onDirtyChange={setDirty}
        />
      ) : (
        <ReadView project={project} signedIn={signedIn} reload={reload} />
      )}

      {dialog}
    </>
  )
}

/** `/me/projects` once it has landed, or null while it has not. */
const minesOf = (signedIn: SignedIn) =>
  signedIn.mine.status === 'ready' ? signedIn.mine.data : null

/** The page as everybody sees it, and as a lead sees it when not editing. */
function ReadView({
  project,
  signedIn,
  reload,
}: {
  project: ApiProjectDetail
  signedIn: SignedIn | null
  reload: (fresh?: boolean) => Promise<void>
}) {
  return (
    <>
      {/* Where the bare cover `<img>` used to sit, so nothing has moved for a
          reader — the picture just got better. Above the prose because the
          picture is what makes somebody read the paragraph. The spacing lives
          inside the component, which renders nothing at all for a project with
          no pictures. */}
      <ProjectGallery
        slides={slidesOf(project)}
        heading={project.galleryHeading ?? 'GALLERY'}
      />

      {project.summary && (
        <p className="text-base leading-[1.7] text-pretty">{project.summary}</p>
      )}

      <ProjectProse
        description={project.description}
        className="text-dim mt-5 text-sm leading-[1.7] text-pretty"
      />

      <Resources project={project} />

      {/* The margin lives on the wrapper because the panel renders nothing at
          all for finished projects, and an empty div's margins collapse away. */}
      <div className="mt-10">
        <JoinPanel project={project} signedIn={signedIn} reload={reload} />
      </div>

      <div className="mt-12">
        <p className="mb-4 font-mono text-[13px] font-bold tracking-[0.2em] text-faint uppercase">
          / {project.teamHeading ?? 'THE TEAM'}
        </p>

        {project.members.length === 0 ? (
          <p className="text-faint border-rule border-t py-5 text-sm">
            Nobody is listed on this project yet.
          </p>
        ) : (
          <ul className="divide-y divide-rule border border-rule">
            {project.members.map((member) => {
              /* **Rank, then whatever they typed — and never the club title.**
                 This row used to print `User.title` beside the name, which is
                 the club-wide one nothing in the product writes, so an officer's
                 "Lab Manager" turned up on a rover roster meaning nothing. It
                 printed no rank at all, so the person running the build was
                 indistinguishable from everybody else on it — `rank` only sorted
                 them to the top and said nothing about why. `memberLabel` is the
                 one place that order of preference lives; the dashboard reads
                 the same function. */
              const label = memberLabel(member)

              return (
                <li
                  key={`${member.user.fullName}-${member.user.slug ?? ''}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3.5"
                >
                  <span className="text-sm font-medium">{member.user.fullName}</span>
                  {label && (
                    <span className="font-mono text-[10px] font-medium tracking-[0.14em] text-faint uppercase">
                      {label}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}

/**
 * The EDIT PAGE button, or the reason there isn't one.
 *
 * Three outcomes, and the middle one is the interesting one:
 *
 *   - **Not a lead here, and not an officer** → nothing at all. Not a disabled
 *     button; the affordance simply does not exist for the overwhelming
 *     majority of people who will ever read this page.
 *   - **A lead or officer whose dues have lapsed** → one line saying so, and a
 *     way to fix it. Not silence, because somebody who has edited this page
 *     before will look for the button, fail to find it, and conclude the site
 *     is broken. And deliberately not the dashboard's whole-page `DuesLocked`:
 *     this is a *public* page, and blanking it over one reader's unpaid dues
 *     would be absurd. The wording follows the server's promise — nothing has
 *     been taken away, and paying gives it straight back.
 *   - **A lead or officer in good standing** → the button.
 *
 * Nothing renders until both reads have landed, so no lapsed line ever flashes
 * at a paid-up lead on the way past.
 */
function EditAffordance({
  project,
  signedIn,
  onEdit,
}: {
  project: ApiProjectDetail
  signedIn: SignedIn
  onEdit: () => void
}) {
  const { user, dues, mine } = signedIn

  if (dues.status === 'loading' || mine.status === 'loading') return null
  if (!canEditProject(user.role, minesOf(signedIn), project.id)) return null

  // `accessLock` wants the membership itself, and `/dues/status` wraps it —
  // the dashboard gets the unwrapped form from its layout context, this page
  // does not. It also handles the ADMIN exemption and "not ready reads as
  // unlocked", so neither is re-decided here.
  const locked = accessLock(
    dues.status === 'ready'
      ? { status: 'ready', data: dues.data.membership }
      : dues,
    user.role,
  )

  if (locked) {
    return (
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[10px] font-medium tracking-[0.14em]">
        {/* Not always "DUES LAPSED": the same lock now fires inside a free
            window, where nothing has lapsed and nothing is owed. */}
        <span className="text-faint">{LOCK_COPY[locked].short}</span>
        <Link
          to="/dashboard/dues"
          className="text-primary hover:underline underline-offset-2"
        >
          {LOCK_COPY[locked].cta} ›
        </Link>
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={onEdit}
      className="border-rule text-faint hover:border-primary hover:text-primary cursor-pointer border px-3 py-1.5 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200"
    >
      EDIT PAGE
    </button>
  )
}

/**
 * Everything a project points at: its own documentation, the design doc, the
 * CAD, the rules, and the repository.
 *
 * Two kinds of row, and the difference is visible on purpose. Documentation is
 * the club's own writing and stays on the site, so it is a `<Link>` with a
 * count and a `›`; everything else is somebody else's hosting, opens in a new
 * tab, and carries the bare host and a `↗`. A reader deciding whether to follow
 * a link is asking where it goes, and those two answers are not the same shape.
 *
 * **There is no `SOURCE CODE` row any more, and nothing was lost.** `repoUrl`
 * was a column of its own, printed here as a fixed row and asked for by a fixed
 * box in the editor — on a site where most of what the club builds has no
 * repository, so the section could never be empty and the box could never be
 * removed. Every value moved into an ordinary `ProjectLink` and the column went
 * with the migration; a repository is a resource like the rest of them, labelled
 * by whoever added it.
 *
 * Documentation goes first because it is the only row that stays on the site,
 * and because a project that has written something down would rather be read
 * than cloned. Its label is not a project's to rename — it names a route.
 */
function Resources({ project }: { project: ApiProjectDetail }) {
  const rows: ResourceRow[] = [
    ...(project.documents.length > 0
      ? [
          {
            id: 'docs',
            label: 'DOCUMENTATION',
            to: `/projects/${project.slug}/docs`,
            note: `${project.documents.length} ${project.documents.length === 1 ? 'DOCUMENT' : 'DOCUMENTS'} ›`,
          } as const,
        ]
      : []),
    ...project.links,
  ]

  if (rows.length === 0) return null

  const rowClass =
    'hover:bg-wash flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3.5 transition-colors duration-200'

  return (
    <div className="mt-10">
      <p className="mb-4 font-mono text-[13px] font-bold tracking-[0.2em] text-faint uppercase">
        / {project.resourcesHeading ?? 'RESOURCES'}
      </p>

      <ul className="border-rule divide-rule divide-y border">
        {rows.map((row) => (
          <li key={row.id}>
            {'to' in row ? (
              <Link to={row.to} className={rowClass}>
                <span className="text-sm font-medium">{row.label}</span>
                <span className="text-faint font-mono text-[11px] font-medium tracking-[0.06em]">
                  {row.note}
                </span>
              </Link>
            ) : (
              <a
                href={row.url}
                target="_blank"
                rel="noreferrer noopener"
                className={rowClass}
              >
                <span className="text-sm font-medium">{row.label}</span>
                {/* The bare host, not the whole URL: a reader is deciding
                    whether they trust where this goes, and a 90-character
                    Notion link wrapping onto three lines answers that worse
                    than "notion.so" does. `↗` says it leaves the site. */}
                <span className="text-faint font-mono text-[11px] font-medium tracking-[0.06em]">
                  {hostOf(row.url)} ↗
                </span>
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A row that leaves the site, or one that does not. `to` is the discriminant. */
type ResourceRow =
  | { id: string; label: string; url: string }
  | { id: string; label: string; to: string; note: string }

/**
 * The host a link points at, for the right-hand column.
 *
 * Total, because these URLs come from a database rather than from a validator
 * on this render: the routes check them with `z.url()` on the way in, but a row
 * written before that check existed, or by hand in Studio, must not throw
 * inside a map and blank the page. An unparseable value falls back to itself.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * The join gate, in its three honest states. Not rendered at all for a
 * project that isn't running — a join button on an archived project is an
 * invitation to a room with the lights off.
 */
function JoinPanel({
  project,
  signedIn,
  reload,
}: {
  project: ApiProjectDetail
  signedIn: SignedIn | null
  reload: (fresh?: boolean) => Promise<void>
}) {
  const { session } = useSession()
  const location = useLocation()

  if (project.status !== 'IN_PROGRESS') return null
  if (session.status === 'loading') {
    return <div aria-busy="true" className="mt-10 h-24 border border-rule bg-base-200" />
  }
  // The page itself loaded, so the API is up — this is a blip. The project is
  // still readable; only the join panel goes quiet.
  if (session.status === 'error') return null

  if (signedIn)
    return <JoinAction project={project} signedIn={signedIn} reload={reload} />

  return (
    <FormPanel tone="accent">
      <div className="mt-0">
        <p className="text-faint mb-2 font-mono text-[10px] font-medium tracking-[0.16em]">
          JOIN THIS PROJECT
        </p>
        <p className="text-dim mb-4 text-sm leading-[1.7] text-pretty">
          Members with paid dues can join. Sign in, or make an account.
        </p>
        <Link
          to="/login"
          state={{ from: location.pathname }}
          className="btn btn-primary btn-cta px-6 py-3 text-[13px] font-semibold"
        >
          SIGN IN TO JOIN
        </Link>
      </div>
    </FormPanel>
  )
}

function JoinAction({
  project,
  signedIn: { dues, mine },
  reload,
}: {
  project: ApiProjectDetail
  signedIn: SignedIn
  /**
   * Joining and leaving both change `/ THE TEAM` directly above this panel, and
   * that list is part of the *project* read rather than of anything this panel
   * holds. Without a refetch the roster somebody has just put their name on
   * still does not carry it, which reads as the join not having worked — the
   * same failure the editor's `reload` was added for.
   *
   * `fresh`, for the reason spelled out on `getJson`: `/projects/:slug` is
   * public and answers `max-age=60`, so the read taken a second after the write
   * comes back from the browser's cache with the pre-join copy.
   */
  reload: (fresh?: boolean) => Promise<void>
}) {
  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'joining' }
    /**
     * Joined just now, carrying the rank the *server* answered with.
     *
     * It has to be carried rather than looked up: `rank` below comes from
     * `/me/projects`, `useApi` cannot refetch it, and so the snapshot this panel
     * holds is from before the join and knows nothing about it. That left the
     * LEAVE THIS PROJECT link absent until a page refresh — somebody had joined,
     * the panel said so, and the only way back out was to reload the page.
     *
     * The join route returns `{ projectId, rank }` for exactly this, so nothing
     * here has to assume a new member lands on `MEMBER` — which is true today
     * and is not this component's fact to depend on.
     */
    | { status: 'joined'; rank: ProjectMemberRank }
    /** Left just now, so `/me/projects` still says otherwise. */
    | { status: 'left' }
    | { status: 'failed'; message: string }
  >({ status: 'idle' })

  if (dues.status === 'loading' || mine.status === 'loading') {
    return <div aria-busy="true" className="mt-10 h-24 border border-rule bg-base-200" />
  }

  // `state` wins over the fetched list in both directions: `/me/projects` has
  // no refetch, so it is a snapshot from before whichever of these happened.
  const alreadyOn =
    state.status !== 'left' &&
    (state.status === 'joined' ||
      (mine.status === 'ready' &&
        mine.data.some((m) => m.project.id === project.id)))

  if (alreadyOn) {
    // The join's own answer first, for the same reason `alreadyOn` prefers
    // `state`: the fetched list is a snapshot from before it happened.
    const rank =
      state.status === 'joined'
        ? state.rank
        : rankOn(mine.status === 'ready' ? mine.data : null, project.id)

    return (
      <FormPanel tone="accent">
        <p className="text-dim text-sm leading-[1.7] text-pretty">
          You're on this project.{' '}
          <Link
            to={`/dashboard/projects/${project.slug}`}
            className="text-primary underline underline-offset-2"
          >
            Open it on your dashboard
          </Link>
          .
        </p>

        {/* Leaving is offered here as well as on the dashboard, because this is
            where somebody who has decided a project is not for them actually
            is. Absent only while there is genuinely no rank to draw the dialog
            from — the warning turns on it, and a dialog that guessed would be
            worse than a moment's wait. Somebody who joined a second ago has one
            from the join itself, so this no longer waits on `/me/projects`. */}
        {rank && (
          <span className="mt-3 block">
            <LeaveProjectButton
              projectId={project.id}
              projectTitle={project.title}
              rank={rank}
              teamName={
                mine.status === 'ready'
                  ? (mine.data.find((row) => row.project.id === project.id)?.team
                      ?.name ?? null)
                  : null
              }
              onLeft={() => {
                // The panel goes back to the join gate, and the roster above
                // has to lose the name in the same beat — leaving a project and
                // still being listed on it is the same lie as joining one and
                // not being.
                setState({ status: 'left' })
                void reload(true)
              }}
            />
          </span>
        )}
      </FormPanel>
    )
  }

  // If the dues read failed there is no way to promise the join will pass the
  // gate — send them via the dues page, which can explain properly.
  const gap =
    dues.status === 'error' ? 'newcomer' : coverGap(dues.data.membership)

  if (gap) {
    return (
      <FormPanel tone="accent">
        <p className="text-faint mb-2 font-mono text-[10px] font-medium tracking-[0.16em]">
          JOIN THIS PROJECT
        </p>
        {/* Three reasons, three sentences, matching the 403 this route would
            answer with. It used to say "settle your dues" whatever the reason,
            which inside a free window is telling somebody to pay for a thing
            that is free and one press away. */}
        <p className="text-dim mb-4 text-sm leading-[1.7] text-pretty">
          {gap === 'claim'
            ? 'Joining needs a current membership, and yours is free to switch on right now. One press, no card.'
            : gap === 'dues'
              ? 'Joining a project needs current dues. Settle them and come straight back.'
              : 'Joining a project is for paid-up members.'}
        </p>
        <Link
          to="/dashboard/dues"
          className="btn btn-primary btn-cta px-6 py-3 text-[13px] font-semibold"
        >
          {LOCK_COPY[gap].cta}
        </Link>
      </FormPanel>
    )
  }

  const join = () => {
    setState({ status: 'joining' })
    postJson<{ projectId: string; rank: ProjectMemberRank }>(
      `/projects/${project.id}/join`,
      {},
    )
      .then((membership) => {
        setState({ status: 'joined', rank: membership.rank })
        // The panel answers from `state` either way, so the roster is what this
        // is for. Not awaited: the panel has already flipped, and a slow read
        // must not leave the button spinning.
        void reload(true)
      })
      .catch((error: unknown) => {
        setState({
          status: 'failed',
          message:
            error instanceof ApiError && error.detail
              ? error.detail
              : "Joining didn't go through. Try again in a moment.",
        })
      })
  }

  return (
    <FormPanel tone="accent">
      <p className="text-faint mb-2 font-mono text-[10px] font-medium tracking-[0.16em]">
        JOIN THIS PROJECT
      </p>
      <p className="text-dim mb-4 text-sm leading-[1.7] text-pretty">
        Your membership covers this. Joining puts you on the roster; showing up
        does the rest.
      </p>
      <button
        type="button"
        onClick={join}
        disabled={state.status === 'joining'}
        className="btn btn-primary btn-cta px-6 py-3 text-[13px] font-semibold disabled:opacity-60"
      >
        {state.status === 'joining' ? 'JOINING…' : 'JOIN THIS PROJECT'}
      </button>
      <p role="status" className="text-error mt-2 min-h-4 text-[12px]">
        {state.status === 'failed' ? state.message : ''}
      </p>
    </FormPanel>
  )
}

/** Header-shaped placeholders, sized so the page doesn't jump when data lands. */
function ProjectSkeleton() {
  return (
    <div aria-busy="true">
      <div className="bg-base-300 h-3 w-24 animate-pulse rounded-[2px]" />
      <div className="bg-base-300 mt-6 h-9 w-72 max-w-full animate-pulse rounded-[2px]" />
      <div className="bg-base-300 mt-5 h-3 w-48 animate-pulse rounded-[2px]" />
      {/* Same aspect ratio as the gallery frame, so the page does not jump the
          moment the pictures land. */}
      <div className="bg-base-300 mt-6 aspect-[16/10] w-full animate-pulse rounded-[2px]" />
      <div className="mt-8 space-y-2.5">
        <div className="bg-base-300 h-3 w-full animate-pulse rounded-[2px]" />
        <div className="bg-base-300 h-3 w-11/12 animate-pulse rounded-[2px]" />
        <div className="bg-base-300 h-3 w-4/5 animate-pulse rounded-[2px]" />
      </div>
    </div>
  )
}
