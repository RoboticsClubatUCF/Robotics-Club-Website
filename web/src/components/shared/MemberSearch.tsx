import { useEffect, useId, useState } from 'react'
import { getJson } from '../../lib/api/api'
import type { ApiOfficerMember } from '../../lib/api/api'
import { explainApiError } from '../../lib/api/apiErrors'
import { fieldClass, labelClass } from './formChrome'

/**
 * The officer people-picker, answering as it is typed.
 *
 * It matches on name, email and Discord handle — see `GET /officer/members` in
 * `server/src/routes/officer/officer.ts`, where the search itself lives.
 *
 * Two details keep search-as-you-type honest. The debounce, so a name is one request rather than
 * one per keystroke; and the `AbortController`, without which "ro" can land after "rowan" and put
 * the wrong list on screen — a race that shows up exactly when the network is slow and nowhere
 * else.
 *
 * Under two characters nothing is asked at all, because the route's own validator refuses that and
 * a 400 per keystroke is not a search.
 *
 * It lived in `OfficerProjectsPage` until the roles desk needed it too. Both things it feeds —
 * appointing a lead, granting somebody a term — are the same question, and it would have been
 * copied otherwise.
 */
const DEBOUNCE_MS = 300

/**
 * How to say which account this is, in one line.
 *
 * Email first where there is one, and the Discord handle otherwise — an account
 * can have a handle and no email at all, and printing nothing for those made
 * them look like empty rows in the picker.
 */
const contactOf = (member: ApiOfficerMember) =>
  member.email ?? (member.discordUsername ? `@${member.discordUsername}` : null)

export function MemberSearch({
  picked,
  onPick,
  disabled,
  label = 'FIND A MEMBER',
}: {
  picked: ApiOfficerMember | null
  onPick: (member: ApiOfficerMember | null) => void
  disabled: boolean
  /** Overridable because two desks ask for a person for different reasons, and
      "FIND A MEMBER" twice on one page says nothing about either. */
  label?: string
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ApiOfficerMember[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [message, setMessage] = useState('')

  const term = query.trim()

  useEffect(() => {
    if (term.length < 2) {
      setResults(null)
      setSearching(false)
      setMessage('')
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(() => {
      setSearching(true)
      setMessage('')

      getJson<ApiOfficerMember[]>(
        `/officer/members?query=${encodeURIComponent(term)}`,
        controller.signal,
      )
        .then((found) => {
          setResults(found)
          setSearching(false)
        })
        .catch((error: unknown) => {
          // An abort is this effect being cleaned up, not a failure — what was
          // typed changed and a newer search is already on its way.
          if (controller.signal.aborted) return
          setResults(null)
          setSearching(false)
          setMessage(
            explainApiError(error, {
              forbidden: 'The server does not agree you are an officer.',
            }),
          )
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [term])

  if (picked) {
    return (
      <div className="border-rule bg-base-100 flex items-center justify-between gap-4 border px-3 py-2.5">
        <span className="text-sm font-medium">
          {picked.fullName}
          {contactOf(picked) && (
            <span className="text-faint ml-2 text-[12px] font-normal">
              {contactOf(picked)}
            </span>
          )}
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            onPick(null)
          }}
          className="text-faint hover:text-primary cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em]"
        >
          CHANGE
        </button>
      </div>
    )
  }

  return (
    <div>
      {/* Deliberately not a `<form>`: this picker has sat inside one, and a form inside a form is
          invalid HTML — the parser drops the inner one. React builds the DOM through the API rather
          than the parser, so a nested one happened to work; that is not a thing to rely on. Enter
          is swallowed below for the same reason. */}
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        name="query"
        type="search"
        autoComplete="off"
        value={query}
        minLength={2}
        maxLength={100}
        placeholder="Name, email or Discord"
        className={fieldClass}
        disabled={disabled}
        onChange={(event) => {
          setQuery(event.target.value)
        }}
        onKeyDown={(event) => {
          // The results are already there; without this the keypress can reach
          // a surrounding form and submit it half-filled.
          if (event.key === 'Enter') event.preventDefault()
        }}
      />

      {results && (
        <ul className="border-rule divide-rule mt-3 divide-y border">
          {results.length === 0 && (
            <li className="text-faint px-3 py-2.5 text-[13px]">
              Nobody matches that.
            </li>
          )}
          {results.map((member) => (
            <li key={member.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(member)
                  setResults(null)
                }}
                className="hover:bg-wash flex w-full cursor-pointer items-baseline justify-between gap-4 px-3 py-2.5 text-left transition-colors duration-150"
              >
                <span className="text-sm font-medium">{member.fullName}</span>
                {/* Both, stacked, because either can be the only one an account
                    has — and two students with the same name are told apart by
                    whichever of them the officer recognises. */}
                <span className="text-faint shrink-0 text-right text-[12px]">
                  {member.email}
                  {member.discordUsername && (
                    <span className="block text-[11px]">
                      @{member.discordUsername}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* One line, always rendered, carrying whichever of the three things is
          true — so the region exists before it has anything to announce and
          nothing below it moves when it does. */}
      <p
        role="status"
        className={`mt-2 min-h-4 text-[12px] ${message ? 'text-error' : 'text-faint'}`}
      >
        {message ||
          (searching
            ? 'Searching…'
            : term.length > 0 && term.length < 2
              ? 'Two letters or more.'
              : '')}
      </p>
    </div>
  )
}
