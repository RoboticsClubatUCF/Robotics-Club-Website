import { useId, useState, type FormEvent } from 'react'
import { patchJson, type ApiAccount, type ApiProfileLink } from '../../lib/api/api'
import { explainApiError } from '../../lib/api/apiErrors'
import { profileSiteName } from '../../lib/format/profileLink'
import { fieldClass, labelClass } from '../shared/formChrome'
import {
  PanelStatus,
  ProfilePanel,
  noteClass,
  panelQuietClass,
  panelSaveClass,
  type PanelMessage,
} from './profileChrome'

/**
 * Where this member's photograph points.
 *
 * **It replaced PUBLIC PROFILE**, which was a row in YOUR STANDING that said
 * "No profile page yet" to almost everybody and could say nothing else: a slug
 * is an officer's to set, `/members/:slug` is still unbuilt, and a fact nobody
 * reading it can change or use is a fact worth deleting. What people actually
 * wanted from that row — somewhere on the club's site that points at *them* —
 * is a field, and this is it. Their face on `/members` and on the officer board
 * becomes a link to whatever they put here.
 *
 * **The check is the server's and there is no copy of it here.** `socialUrl` in
 * `server/src/core/validate.ts` holds an allowlist of known platforms, because
 * this is the only public address on the site an ordinary member types and the
 * roster is several hundred anchors. A second list in the browser would be a
 * second answer to "what is allowed" — so a refusal arrives as the server's own
 * sentence, in the same strip that says "Saved.", and the note below says
 * roughly what the list holds without pretending to be it.
 *
 * The box takes what people paste. `linkedin.com/in/someone` has no scheme
 * because no browser has shown one since 2018, and the server adds it — so what
 * comes back is not always what was typed, and the field adopts the answer
 * rather than keeping the input. Somebody who typed `http://` and finds
 * `https://` in the box is looking at what was stored.
 */
export function ProfileLinkPanel({
  account,
  onSaved,
}: {
  account: ApiAccount
  onSaved: (account: Partial<ApiAccount>) => void
}) {
  const id = useId()

  const [profileUrl, setProfileUrl] = useState(account.profileUrl ?? '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<PanelMessage>(null)

  /** Where the stored one goes, named — the answer to "is that the right
      link", which is the question somebody re-reading this panel is asking. */
  const site = account.profileUrl ? profileSiteName(account.profileUrl) : null

  const send = (value: string | null) => {
    if (saving) return

    setSaving(true)
    setMessage(null)

    patchJson<ApiProfileLink>('/account/profile-link', { profileUrl: value })
      .then((answer) => {
        // The server's version, not the typed one: it adds a missing scheme and
        // upgrades `http`, and a box still showing the input would disagree with
        // the row behind it until the page was reloaded.
        setProfileUrl(answer.profileUrl ?? '')
        onSaved({ profileUrl: answer.profileUrl })
        setMessage({
          tone: 'ok',
          text: answer.profileUrl ? 'Saved.' : 'Removed.',
        })
      })
      .catch((error: unknown) => {
        console.error(error)
        setMessage({ tone: 'error', text: explainApiError(error) })
      })
      .finally(() => {
        setSaving(false)
      })
  }

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    // An empty box is "I have not given one", not an address — the same rule
    // every other nullable address on this API follows, and it is what makes
    // clearing the field work without a second control.
    send(profileUrl.trim() || null)
  }

  return (
    <ProfilePanel label="PROFILE LINK">
      <form onSubmit={save} className="flex flex-col gap-4">
        <div>
          <label htmlFor={`${id}-link`} className={labelClass}>
            YOUR LINK
          </label>
          <input
            id={`${id}-link`}
            name="profileUrl"
            /* `type="url"` would have the browser refuse `linkedin.com/in/me`
               before the request left, which is exactly the paste the server
               goes out of its way to accept. */
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            maxLength={300}
            placeholder="linkedin.com/in/your-name"
            value={profileUrl}
            onChange={(event) => {
              setProfileUrl(event.target.value)
            }}
            className={fieldClass}
          />
          <p className={`${noteClass} mt-1.5`}>
            Your photo on the members page and the officer board becomes a link
            to this. LinkedIn, GitHub, Instagram, YouTube and the other
            well-known ones are accepted; anything else is refused, so nobody
            can hang an unexpected address off the club&rsquo;s roster.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button type="submit" disabled={saving} className={panelSaveClass}>
            {saving ? 'SAVING…' : 'SAVE'}
          </button>

          {/* Only once there is one stored. Clearing the box and saving does the
              same thing, and this is the version somebody finds. */}
          {account.profileUrl && (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setProfileUrl('')
                send(null)
              }}
              className={panelQuietClass}
            >
              REMOVE
            </button>
          )}
        </div>
      </form>

      {site && (
        <p className={`${noteClass} mt-3`}>
          Your photo currently goes to {site}.
        </p>
      )}

      <PanelStatus message={message} />
    </ProfilePanel>
  )
}
