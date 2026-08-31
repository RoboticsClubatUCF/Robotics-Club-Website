import { useId, useState, type FormEvent } from 'react'
import { patchJson, type ApiAccount, type ApiAccountUser } from '../../lib/api/api'
import { explainApiError } from '../../lib/api/apiErrors'
import { useSession } from '../../lib/auth/session'
import { fieldClass, labelClass } from '../shared/formChrome'
import {
  PanelStatus,
  ProfilePanel,
  noteClass,
  panelSaveClass,
  type PanelMessage,
} from './profileChrome'

/**
 * Name, bio and graduation year — one form and one save, because they are one
 * thought. Somebody updating their year has usually just changed their bio too.
 *
 * All three appear on the public roster, which is why they are the member's own
 * to edit — and since that page lists every account, everybody editing this is
 * already on it. The two that are *not* here are `title` and `slug`: a club
 * title is the board's to award, and a slug gives somebody a profile page of
 * their own. Neither is a fact about themselves that they are best placed to
 * state.
 */
export function ProfileIdentityPanel({
  account,
  onSaved,
}: {
  account: ApiAccount
  onSaved: (account: Partial<ApiAccount>) => void
}) {
  const { adopt } = useSession()
  const id = useId()

  const [fullName, setFullName] = useState(account.fullName)
  const [bio, setBio] = useState(account.bio ?? '')
  const [gradYear, setGradYear] = useState(
    account.gradYear === null ? '' : String(account.gradYear),
  )
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<PanelMessage>(null)

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return

    setSaving(true)
    setMessage(null)

    patchJson<ApiAccountUser>('/account/profile', {
      fullName: fullName.trim(),
      bio: bio.trim(),
      // An empty field is "no answer", not a year. `null` is what the column
      // holds for everybody who has never said.
      gradYear: gradYear.trim() === '' ? null : Number(gradYear),
    })
      .then(({ user }) => {
        // Adopted straight into the session rather than refetching: the rail
        // and the nav bar are watching the same context, and a round trip here
        // is a visible flicker in both for no new information.
        adopt(user)
        onSaved({
          fullName: user.fullName,
          bio: bio.trim() || null,
          gradYear: gradYear.trim() === '' ? null : Number(gradYear),
        })
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
    <ProfilePanel label="ABOUT YOU">
      <form onSubmit={save} className="flex flex-col gap-4">
        <div>
          <label htmlFor={`${id}-name`} className={labelClass}>
            FULL NAME
          </label>
          <input
            id={`${id}-name`}
            name="fullName"
            type="text"
            required
            maxLength={100}
            value={fullName}
            onChange={(event) => {
              setFullName(event.target.value)
            }}
            className={fieldClass}
          />
          <p className={`${noteClass} mt-1.5`}>
            What the roster, your projects and the club&rsquo;s messages call
            you.
          </p>
        </div>

        <div>
          <label htmlFor={`${id}-grad`} className={labelClass}>
            GRADUATION YEAR
          </label>
          <input
            id={`${id}-grad`}
            name="gradYear"
            /* `inputMode` rather than `type="number"`: a spinner on a year is
               four clicks to move a decade, and the scroll wheel changes it by
               accident on a page somebody is reading. */
            type="text"
            inputMode="numeric"
            maxLength={4}
            placeholder="2027"
            value={gradYear}
            onChange={(event) => {
              setGradYear(event.target.value.replace(/[^0-9]/g, ''))
            }}
            className={`${fieldClass} max-w-[9rem]`}
          />
        </div>

        <div>
          <label htmlFor={`${id}-bio`} className={labelClass}>
            BIO
          </label>
          <textarea
            id={`${id}-bio`}
            name="bio"
            rows={4}
            maxLength={2000}
            value={bio}
            onChange={(event) => {
              setBio(event.target.value)
            }}
            className={`${fieldClass} h-auto py-2.5 leading-[1.6]`}
          />
          <p className={`${noteClass} mt-1.5`}>
            A couple of sentences, shown beside your name on the public
            roster.
          </p>
        </div>

        <div>
          <button type="submit" disabled={saving} className={panelSaveClass}>
            {saving ? 'SAVING…' : 'SAVE'}
          </button>
        </div>
      </form>

      <PanelStatus message={message} />
    </ProfilePanel>
  )
}
