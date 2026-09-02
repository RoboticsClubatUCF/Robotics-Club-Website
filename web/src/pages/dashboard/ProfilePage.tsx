import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { DeleteAccountPanel } from '../../components/profile/DeleteAccountPanel'
import { ProfileDiscordPanel } from '../../components/profile/ProfileDiscordPanel'
import { ProfileEmailPanel } from '../../components/profile/ProfileEmailPanel'
import { ProfileIdentityPanel } from '../../components/profile/ProfileIdentityPanel'
import { ProfileLinkPanel } from '../../components/profile/ProfileLinkPanel'
import { ProfilePasswordPanel } from '../../components/profile/ProfilePasswordPanel'
import { ProfilePhotoPanel } from '../../components/profile/ProfilePhotoPanel'
import { ProfileSurveyPanel } from '../../components/profile/ProfileSurveyPanel'
import {
  PanelFact,
  noteClass,
  panelLabelClass,
} from '../../components/profile/profileChrome'
import { Avatar } from '../../components/shared/Avatar'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  secondaryClass,
} from '../../components/shared/formChrome'
import { ApiError, getJson, type ApiAccount } from '../../lib/api/api'
import { longDate } from '../../lib/format/formats'
import { useSession } from '../../lib/auth/session'
import type { ApiState } from '../../lib/api/useApi'

/**
 * The account page.
 *
 * It used to be a placeholder with one real button on it — signing out had to
 * live somewhere, and the bottom of the overview was the wrong somewhere. Every
 * other thing it said was coming now exists: the name, the photo, the Discord
 * handle, the address somebody signs in with, the password, and leaving.
 *
 * **One account read, and a panel per decision.** The page owns the
 * `GET /api/account` loader; each panel owns its own save, its own busy state
 * and its own answer line, because they are separate decisions rather than one
 * form with several parts. A single SAVE at the bottom would mean changing a
 * bio and a password in the same press, which is exactly the shape that makes
 * people careful about pressing anything.
 *
 * `ProfileSurveyPanel` is the one that reads something the page did not: the
 * member survey is another table behind another route, and widening the account
 * payload for one panel would be the wrong trade. Everything else about it
 * follows the same rule as its neighbours.
 *
 * The panels adopt their answer into the session context rather than refetching
 * — the nav bar and the rail are watching it, and a round trip is a visible
 * flicker in both for no new information. `useApi` is not used here for the
 * same reason `DashboardLayout` avoids it: this page mutates what it reads.
 *
 * **Never dues-gated.** A lapsed member keeps this page, their own projects and
 * the dues page. Being behind on dues is not a reason somebody cannot change
 * their password or leave.
 */
export function ProfilePage() {
  const { user } = useOutletContext<DashboardContext>()
  const { signOut } = useSession()
  const navigate = useNavigate()

  const [account, setAccount] = useState<ApiState<ApiAccount>>({
    status: 'loading',
  })
  const [leaving, setLeaving] = useState(false)

  const load = useCallback(async () => {
    try {
      setAccount({ status: 'ready', data: await getJson<ApiAccount>('/account') })
    } catch (error) {
      console.error(error)
      setAccount({
        status: 'error',
        code: error instanceof ApiError ? error.status : 0,
      })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Fold a panel's answer back into the page's copy.
   *
   * Cheaper than reloading, and steadier: a refetch would blank every other
   * panel's fields back to their stored values while it was in flight, losing
   * whatever somebody had half-typed in one of them.
   */
  const merge = useCallback((changed: Partial<ApiAccount>) => {
    setAccount((current) =>
      current.status === 'ready'
        ? { status: 'ready', data: { ...current.data, ...changed } }
        : current,
    )
  }, [])

  const signOutAndGoHome = async () => {
    setLeaving(true)

    // Off the dashboard *before* the session drops. The layout sends anyone
    // signed out to the login page, and being shown a sign-in form is a strange
    // answer to having just asked to sign out.
    await navigate('/', { replace: true })
    await signOut()
  }

  return (
    <>
      <FormEyebrow>/ PROFILE</FormEyebrow>

      <div className="mb-7 flex items-center gap-4">
        <Avatar
          fullName={user.fullName}
          photoUrl={user.photoUrl}
          framing={{
            focalX: user.photoFocalX,
            focalY: user.photoFocalY,
            zoom: user.photoZoom,
          }}
          tone="outline"
          className="size-14 text-lg"
        />
        {/* The heading's own bottom margin would fight the row it is in. */}
        <div className="min-w-0 [&_h1]:mb-0">
          <FormHeading>{user.fullName}</FormHeading>
        </div>
      </div>

      {/* Columns rather than a stack, and it costs this page nothing: the whole
          point of the account page is that each panel is its own decision with
          its own save, so they were never a sequence to be read down. On a
          monitor that turns eight one-line forms strung down the left edge into
          two or three columns of them; on a laptop it is the column it always
          was.

          **Multi-column rather than `grid-fluid`, and this is the one page that
          wants it.** A grid aligns rows, so every card in a row is followed by
          as much empty space as the tallest card in that row leaves over —
          and the panels here run from three lines of text to a framed square,
          so YOUR STANDING sat above a hole the height of the photo well. Column
          flow puts each panel directly under the last one in its column, so a
          card ends where its content does.

          The trade is that reading goes down a column and then down the next,
          rather than across. Nothing here is sequential — that is the same
          property that let these sit side by side at all — and tab order still
          follows the markup, which is the order they are read in. `[&>*]`
          because the panels are components: the margin and the no-break rule
          have to reach children this page does not render itself, and
          multi-column has no row gap to set. */}
      <div className="columns-[24rem] gap-x-5 [&>*]:mb-5 [&>*]:break-inside-avoid">
        {/* The facts nobody edits here, first, because they are the answer to
            "is this the right account" — which is the question somebody opening
            this page is usually asking. */}
        <FormPanel>
          <p className={panelLabelClass}>YOUR STANDING</p>
          <dl className="divide-rule divide-y">
            <PanelFact label="ROLE" value={user.role.replace(/_/g, ' ')} />
            <PanelFact
              label="MEMBER AGREEMENT"
              value={
                account.status === 'ready'
                  ? account.data.acknowledgementAcceptedAt
                    ? `Accepted ${longDate(account.data.acknowledgementAcceptedAt)}`
                    : 'No record — your account predates the form'
                  : null
              }
            />
          </dl>
          {/* PUBLIC PROFILE used to be the third row here, printing a
              `/members/:slug` address or "No profile page yet". It said the
              second to almost everybody and could say nothing else — a slug is
              an officer's to set and that page is still unbuilt — so it was a
              row nobody could act on. PROFILE LINK, below, is what it asked
              for: the member's own address, which needs nobody's permission. */}
          {/* Two rows, two different origins, so the line names them rather
              than covering both with "an officer sets these" — which is now
              half wrong: nobody set the agreement, it was accepted. */}
          <p className={`${noteClass} mt-3`}>
            An officer sets your role. The agreement is the one you accepted
            when you signed up.
          </p>
        </FormPanel>

        {account.status === 'loading' && (
          <div aria-busy="true" className="space-y-5">
            {/* Sized to what it replaces, so nothing reflows when it lands. */}
            <div className="border-rule bg-base-200 h-64 border" />
            <div className="border-rule bg-base-200 h-40 border" />
          </div>
        )}

        {account.status === 'error' && (
          <FormPanel tone="accent">
            <p className="text-dim text-sm leading-[1.7] text-pretty">
              We couldn&rsquo;t load your account just now. Try again in a
              moment.
            </p>
          </FormPanel>
        )}

        {account.status === 'ready' && (
          <>
            <ProfileIdentityPanel account={account.data} onSaved={merge} />
            <ProfilePhotoPanel account={account.data} onSaved={merge} />
            {/* Straight after the photo, because it is what the photo does. */}
            <ProfileLinkPanel account={account.data} onSaved={merge} />
            <ProfileDiscordPanel account={account.data} onSaved={merge} />
            <ProfileEmailPanel account={account.data} onSaved={merge} />
            <ProfilePasswordPanel />
            {/* Last, and the only panel that reads a resource of its own — the
                survey is another table with another route, so it fetches for
                itself rather than widening the account payload for one panel.
                It also renders nothing until it knows, which is why it sits at
                the end: a panel that appears late would push the ones after it
                around. The one panel here that does not save anything, either;
                it prints the answers back and sends you to `/dashboard/survey`
                to change them, because the survey is a page's worth of form and
                this page is a column of one-field decisions. */}
            <ProfileSurveyPanel gradYear={account.data.gradYear} />
          </>
        )}
      </div>

      {/* The two ways out, below the panels and in a grid of their own so that
          widening the page cannot slide the red box up alongside a field
          somebody is editing. Signing out first: it is the one people are
          looking for, and the one that is not destructive. */}
      <div className="grid-fluid mt-10 items-start gap-5 [--col-min:24rem]">
        <div>
          <p className={panelLabelClass}>SIGN OUT</p>
          <button
            type="button"
            disabled={leaving}
            onClick={() => void signOutAndGoHome()}
            className={`${secondaryClass} disabled:opacity-60`}
          >
            {leaving ? 'SIGNING OUT…' : 'SIGN OUT'}
          </button>
          <p className={`${noteClass} mt-3`}>
            Ends this session on this device only.
          </p>
        </div>

        {/* Last on the page, and behind its own colour. Everything above it is
            something somebody might do on a Tuesday; this is not. */}
        <DeleteAccountPanel fullName={user.fullName} />
      </div>
    </>
  )
}
