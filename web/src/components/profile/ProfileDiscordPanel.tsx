import { useState } from 'react'
import { postJson, type ApiAccount, type ApiAccountUser } from '../../lib/api/api'
import { explainApiError } from '../../lib/api/apiErrors'
import { useSession } from '../../lib/auth/session'
import { DiscordUsernameField } from '../shared/DiscordUsernameField'
import {
  PanelStatus,
  ProfilePanel,
  noteClass,
  panelSaveClass,
  type PanelMessage,
} from './profileChrome'

/**
 * The Discord handle, edited on an account that already exists.
 *
 * The same field signup uses, pointed at the account check instead — which
 * excuses the caller, so somebody re-saving the handle they already have is not
 * told it is taken by themselves.
 *
 * Worth changing rather than leaving to an officer because a handle is the one
 * thing on this page somebody can alter *elsewhere*: Discord lets them rename
 * whenever they like, and everything the club builds joins on this string. The
 * stored account id survives a rename, so the two together are what keep a
 * member reachable.
 */
export function ProfileDiscordPanel({
  account,
  onSaved,
}: {
  account: ApiAccount
  onSaved: (account: Partial<ApiAccount>) => void
}) {
  const { adopt } = useSession()

  const [handle, setHandle] = useState(account.discordUsername ?? '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<PanelMessage>(null)

  const unchanged = handle.trim().toLowerCase() === (account.discordUsername ?? '')

  const save = () => {
    if (saving) return

    setSaving(true)
    setMessage(null)

    postJson<ApiAccountUser>('/account/discord', { discordUsername: handle })
      .then(({ user }) => {
        adopt(user)
        onSaved({ discordUsername: user.discordUsername })
        // Discord's own spelling, which may differ from what was typed — the
        // field normalises, and so does the server. Showing it back is how
        // somebody knows which of the two was stored.
        setHandle(user.discordUsername ?? '')
        setMessage({ tone: 'ok', text: 'Saved.' })
      })
      .catch((error: unknown) => {
        console.error(error)
        setMessage({ tone: 'error', text: explainApiError(error) })
      })
      .finally(() => {
        setSaving(false)
      })
  }

  return (
    <ProfilePanel label="DISCORD">
      <div className="flex flex-col gap-4">
        <DiscordUsernameField
          value={handle}
          onChange={setHandle}
          // The authenticated check, which does not count this account against
          // itself. See the prop's own note.
          checkPath="/account/discord-check"
        />

        <div>
          <button
            type="button"
            disabled={saving || unchanged || handle.trim() === ''}
            onClick={save}
            className={panelSaveClass}
          >
            {saving ? 'SAVING…' : 'SAVE'}
          </button>
        </div>

        <p className={noteClass}>
          How the club finds you in Discord. Change it here whenever you
          change it there.
        </p>
      </div>

      <PanelStatus message={message} />
    </ProfilePanel>
  )
}
