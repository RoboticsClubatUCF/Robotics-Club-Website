import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  Navigate,
  useLocation,
  useNavigate,
  useOutletContext,
} from 'react-router'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { SubNav } from '../../components/dashboard/SubNav'
import { SubPage } from '../../components/dashboard/SubPage'
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
  ProfilePanel,
  noteClass,
  panelQuietClass,
} from '../../components/profile/profileChrome'
import { Avatar } from '../../components/shared/Avatar'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
} from '../../components/shared/formChrome'
import { ApiError, getJson, type ApiAccount } from '../../lib/api/api'
import { longDate } from '../../lib/format/formats'
import { useSession } from '../../lib/auth/session'
import type { ApiState } from '../../lib/api/useApi'
import { PROFILE_PAGES } from '../../lib/dashboard/subPages'

type Part = 'profile' | 'account' | 'standing'

const EYEBROW: Record<Part, string> = {
  profile: '/ PROFILE',
  account: '/ PROFILE · ACCOUNT',
  standing: '/ PROFILE · STANDING',
}

/**
 * The account pages: what other members see, how you sign in, and where you stand.
 *
 * Three sub-pages rather than one wall of panels. Each panel is its own decision with its own
 * save, so nothing here was ever a sequence, and nine of them at once tiled into columns of
 * uneven holes. The routes share this component, so switching between them keeps the one
 * account read.
 *
 * Panels write their answer into the session and this page's copy rather than refetching: the
 * nav and the rail are watching the session, and a refetch would blank half-typed input in
 * the panels around it.
 *
 * Never dues-gated. Owing dues isn't a reason somebody can't change their password or leave.
 */
export function ProfilePage({ part }: { part: Part }) {
  const { user, membership } = useOutletContext<DashboardContext>()
  const { search } = useLocation()

  const [account, setAccount] = useState<ApiState<ApiAccount>>({
    status: 'loading',
  })

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

  /** Fold a panel's answer back into the page's copy, without a refetch. */
  const merge = useCallback((changed: Partial<ApiAccount>) => {
    setAccount((current) =>
      current.status === 'ready'
        ? { status: 'ready', data: { ...current.data, ...changed } }
        : current,
    )
  }, [])

  // The email-change link the server sends still points at `/dashboard/profile`, and it's in
  // inboxes. The panel that spends the token lives on ACCOUNT now.
  if (part === 'profile' && new URLSearchParams(search).has('emailToken')) {
    return (
      <Navigate to={{ pathname: '/dashboard/profile/account', search }} replace />
    )
  }

  return (
    <>
      <FormEyebrow>{EYEBROW[part]}</FormEyebrow>

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

      <SubNav label="Profile pages" pages={PROFILE_PAGES} />

      {/* All three stay mounted and the other two hidden, so a half-typed field survives a
          look at a sibling. */}
      <SubPage shown={part === 'profile'}>
        {account.status === 'ready' ? (
          <Columns
            first={<ProfileIdentityPanel account={account.data} onSaved={merge} />}
            second={
              <>
                <ProfilePhotoPanel account={account.data} onSaved={merge} />
                {/* Straight after the photo, because it is what the photo does. */}
                <ProfileLinkPanel account={account.data} onSaved={merge} />
              </>
            }
          />
        ) : (
          <AccountState state={account} />
        )}
      </SubPage>

      <SubPage shown={part === 'account'}>
        <Columns
          first={
            account.status === 'ready' ? (
              <>
                <ProfileEmailPanel account={account.data} onSaved={merge} />
                <ProfilePasswordPanel />
                <ProfileDiscordPanel account={account.data} onSaved={merge} />
              </>
            ) : (
              <AccountState state={account} />
            )
          }
          // Neither needs the account read, so a failed one never takes away the way out.
          second={
            <>
              <SignOut />
              {/* Last, and behind its own colour. */}
              <DeleteAccountPanel fullName={user.fullName} />
            </>
          }
        />
      </SubPage>

      <SubPage shown={part === 'standing'}>
        <Columns
          first={
            <>
              <Standing account={account} role={user.role} />
              <ProfileTrainingPanel membership={membership} />
            </>
          }
          second={
            account.status === 'ready' ? (
              <ProfileSurveyPanel gradYear={account.data.gradYear} />
            ) : (
              <AccountState state={account} />
            )
          }
        />
      </SubPage>
    </>
  )
}

/**
 * Two columns that each stack, so a short panel sits straight under the one above it instead
 * of under a row-height hole. They fold to one column, first then second, when two won't fit.
 */
function Columns({ first, second }: { first: ReactNode; second: ReactNode }) {
  return (
    <div className="grid-fluid max-w-[80rem] items-start gap-5 [--col-min:24rem]">
      <div className="grid gap-5">{first}</div>
      <div className="grid gap-5">{second}</div>
    </div>
  )
}

function AccountState({ state }: { state: ApiState<ApiAccount> }) {
  if (state.status === 'error') {
    return (
      <FormPanel tone="accent">
        <p className="text-dim text-sm leading-[1.7] text-pretty">
          We couldn&rsquo;t load your account just now. Try again in a moment.
        </p>
      </FormPanel>
    )
  }

  // Sized to what it replaces, so nothing reflows when it lands.
  return (
    <div aria-busy="true" className="grid gap-5">
      <div className="border-rule bg-base-200 h-64 border" />
      <div className="border-rule bg-base-200 h-40 border" />
    </div>
  )
}

/** The facts nobody edits here: the answer to "is this the right account". */
function Standing({
  account,
  role,
}: {
  account: ApiState<ApiAccount>
  role: DashboardContext['user']['role']
}) {
  return (
    <ProfilePanel label="YOUR STANDING">
      <dl className="divide-rule divide-y">
        <PanelFact label="ROLE" value={role.replace(/_/g, ' ')} />
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
        An officer sets your role. The agreement is the one you accepted when
        you signed up.
      </p>
    </ProfilePanel>
  )
}

function SignOut() {
  const { signOut } = useSession()
  const navigate = useNavigate()
  const [leaving, setLeaving] = useState(false)

  const signOutAndGoHome = async () => {
    setLeaving(true)

    // Off the dashboard before the session drops. The layout sends anyone signed out to the
    // login page, which is a strange answer to having asked to sign out.
    await navigate('/', { replace: true })
    await signOut()
  }

  return (
    <ProfilePanel label="SIGN OUT">
      <button
        type="button"
        disabled={leaving}
        onClick={() => void signOutAndGoHome()}
        className={panelQuietClass}
      >
        {leaving ? 'SIGNING OUT…' : 'SIGN OUT'}
      </button>
      <p className={`${noteClass} mt-3`}>Ends this session on this device only.</p>
    </ProfilePanel>
  )
}
