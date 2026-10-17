import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useSearchParams } from 'react-router'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { DeleteAccountPanel } from '../../components/profile/DeleteAccountPanel'
import { ProfileDiscordPanel } from '../../components/profile/ProfileDiscordPanel'
import { ProfileEmailPanel } from '../../components/profile/ProfileEmailPanel'
import { ProfileIdentityPanel } from '../../components/profile/ProfileIdentityPanel'
import { ProfileLinkPanel } from '../../components/profile/ProfileLinkPanel'
import { ProfilePasswordPanel } from '../../components/profile/ProfilePasswordPanel'
import { ProfilePhotoPanel } from '../../components/profile/ProfilePhotoPanel'
import { ProfileSurveyPanel } from '../../components/profile/ProfileSurveyPanel'
import { ProfileTrainingPanel } from '../../components/profile/ProfileTrainingPanel'
import {
  PanelFact,
  noteClass,
  panelLabelClass,
} from '../../components/profile/profileChrome'
import { Avatar } from '../../components/shared/Avatar'
import { SubMenu } from '../../components/shared/SubMenu'
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

type ProfileTab = 'profile' | 'survey' | 'security'

const PROFILE_TABS: readonly { value: ProfileTab; label: string }[] = [
  { value: 'profile', label: 'PROFILE & STANDING' },
  { value: 'survey', label: 'MEMBER SURVEY' },
  { value: 'security', label: 'SECURITY & ACCOUNT' },
]

/**
 * The account page.
 *
 * One account read, and a panel per decision. The page owns the `GET /api/account` loader; each
 * panel owns its own save, busy state and answer line, because they're separate decisions rather
 * than one form with several parts.
 *
 * Grouped under a horizontal sub-menu (`PROFILE & STANDING`, `MEMBER SURVEY`, `SECURITY & ACCOUNT`)
 * with two-column vertical stacks inside so expanding the photo framer or loading the survey never
 * pushes unrelated panels into another column. Signing out sits in the page header so it's always
 * reachable without scrolling.
 *
 * Never dues-gated. Being behind on dues isn't a reason somebody can't change their password or
 * leave.
 */
export function ProfilePage() {
  const { user, membership } = useOutletContext<DashboardContext>()
  const { signOut } = useSession()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [tab, setTab] = useState<ProfileTab>(
    params.has('emailToken') ? 'security' : 'profile',
  )
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

      <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
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

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={leaving}
            onClick={() => void signOutAndGoHome()}
            className={`${secondaryClass} disabled:opacity-60`}
          >
            {leaving ? 'SIGNING OUT…' : 'SIGN OUT'}
          </button>
        </div>
      </div>

      <SubMenu
        label="Account sections"
        options={PROFILE_TABS}
        value={tab}
        onChange={setTab}
      />

      {account.status === 'error' && (
        <div className="mb-5 max-w-[46rem]">
          <FormPanel tone="accent">
            <p className="text-dim text-sm leading-[1.7] text-pretty">
              We couldn&rsquo;t load your account just now. Try again in a
              moment.
            </p>
          </FormPanel>
        </div>
      )}

      {/* Tab 1: Public identity and club standing in two vertical columns so
          expanding the photo crop never jumps panels across columns. */}
      <div
        className={
          tab === 'profile'
            ? 'grid grid-cols-1 items-start gap-5 wide:grid-cols-2'
            : 'hidden'
        }
      >
        <div className="space-y-5">
          {account.status === 'loading' && (
            <div aria-busy="true" className="space-y-5">
              <div className="border-rule bg-base-200 h-64 border" />
              <div className="border-rule bg-base-200 h-40 border" />
            </div>
          )}

          {account.status === 'ready' && (
            <>
              <ProfileIdentityPanel account={account.data} onSaved={merge} />
              <ProfileLinkPanel account={account.data} onSaved={merge} />
            </>
          )}
        </div>

        <div className="space-y-5">
          {account.status === 'ready' && (
            <>
              <ProfilePhotoPanel account={account.data} onSaved={merge} />
              <ProfileDiscordPanel account={account.data} onSaved={merge} />
            </>
          )}

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
            <p className={`${noteClass} mt-3`}>
              An officer sets your role. The agreement is the one you accepted
              when you signed up.
            </p>
          </FormPanel>

          <ProfileTrainingPanel userId={user.id} membership={membership} />
        </div>
      </div>

      {/* Tab 2: Member survey answers and link back to the survey editor. */}
      <div className={tab === 'survey' ? 'max-w-[46rem]' : 'hidden'}>
        {account.status === 'loading' && (
          <div aria-busy="true" className="border-rule bg-base-200 h-48 border" />
        )}
        {account.status === 'ready' && (
          <ProfileSurveyPanel gradYear={account.data.gradYear} />
        )}
      </div>

      {/* Tab 3: Email, password, and account deletion behind action buttons. */}
      <div
        className={
          tab === 'security'
            ? 'grid grid-cols-1 items-start gap-5 wide:grid-cols-2'
            : 'hidden'
        }
      >
        <div className="space-y-5">
          {account.status === 'loading' && (
            <div aria-busy="true" className="border-rule bg-base-200 h-48 border" />
          )}
          {account.status === 'ready' && (
            <>
              <ProfileEmailPanel account={account.data} onSaved={merge} />
              <ProfilePasswordPanel />
            </>
          )}
        </div>

        <div className="space-y-5">
          <DeleteAccountPanel fullName={user.fullName} />
        </div>
      </div>
    </>
  )
}
