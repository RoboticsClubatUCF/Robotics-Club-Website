import { useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router'
import type { DashboardContext } from '../components/dashboard/DashboardLayout'
import { Avatar } from '../components/shared/Avatar'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  secondaryClass,
} from '../components/shared/formChrome'
import { useSession } from '../lib/session'

/**
 * The account page — a placeholder with one real button on it.
 *
 * It exists now because signing out had to go somewhere. It used to sit at the
 * bottom of the overview, next to a link to the Discord, which put a
 * once-a-term action in the middle of the page people open every day.
 *
 * What it shows is only what the session already knows, and it says outright
 * that none of it is editable yet rather than rendering disabled inputs that
 * imply a save button is coming in the next release. Editing a name, setting a
 * photo and changing a password all want the server routes that do not exist —
 * see the not-built list in `.claude/docs/frontend.md`.
 */
export function ProfilePage() {
  const { user } = useOutletContext<DashboardContext>()
  const { signOut } = useSession()
  const navigate = useNavigate()
  const [leaving, setLeaving] = useState(false)

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
          tone="outline"
          className="size-14 text-lg"
        />
        {/* The heading's own bottom margin would fight the row it is in. */}
        <div className="min-w-0 [&_h1]:mb-0">
          <FormHeading>{user.fullName}</FormHeading>
        </div>
      </div>

      <div className="space-y-5">
        <FormPanel>
          <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
            YOUR ACCOUNT
          </p>
          <dl className="divide-rule divide-y">
            <Row label="NAME" value={user.fullName} />
            <Row label="EMAIL" value={user.email} />
            <Row label="DISCORD" value={user.discordUsername} />
            <Row label="ROLE" value={user.role.replace(/_/g, ' ')} />
            <Row
              label="PUBLIC PROFILE"
              value={
                user.slug
                  ? `/members/${user.slug}`
                  : 'Not on the public roster'
              }
            />
          </dl>
        </FormPanel>

        <FormPanel>
          <p className="text-faint mb-3 font-mono text-[10px] font-medium tracking-[0.16em]">
            EDITING
          </p>
          <p className="text-faint text-[13px] leading-[1.6] text-pretty">
            Not built yet. Changing your name, adding a photo and setting a new
            password all live here when they exist — ask an officer in the
            meantime.
          </p>
        </FormPanel>
      </div>

      <div className="mt-8">
        <p className="text-faint mb-3 font-mono text-[10px] font-medium tracking-[0.16em]">
          SIGN OUT
        </p>
        <button
          type="button"
          disabled={leaving}
          onClick={() => void signOutAndGoHome()}
          className={`${secondaryClass} disabled:opacity-60`}
        >
          {leaving ? 'SIGNING OUT…' : 'SIGN OUT'}
        </button>
        <p className="text-faint mt-3 text-[13px] leading-[1.6] text-pretty">
          Ends this session on this device only. Anywhere else you are signed in
          stays signed in.
        </p>
      </div>
    </>
  )
}

/**
 * One fact about the account. `—` rather than an empty cell for the two fields
 * that are genuinely allowed to be null, because a blank row reads as a value
 * that failed to load.
 */
function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
      <dt className="text-faint font-mono text-[10px] font-medium tracking-[0.14em]">
        {label}
      </dt>
      <dd className="text-dim min-w-0 text-[13px] break-words">
        {value ?? '—'}
      </dd>
    </div>
  )
}
