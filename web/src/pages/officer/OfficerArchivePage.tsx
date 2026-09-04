import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useOutletContext } from 'react-router'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { DuesLocked } from '../../components/dashboard/DuesLocked'
import { OfficerOnly } from '../../components/dashboard/OfficerOnly'
import { isOfficer } from '../../lib/auth/session'
import { ConfirmDialog } from '../../components/shared/ConfirmDialog'
import { FilterChips } from '../../components/shared/FilterChips'
import { MemberSearch } from '../../components/shared/MemberSearch'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  fieldClass,
  labelClass,
} from '../../components/shared/formChrome'
import { deleteJson, getJson, patchJson, postForm, postJson } from '../../lib/api/api'
import type {
  ApiArchivedTerm,
  ApiOfficerArchiveDesk,
  ApiOfficerMember,
  OfficerPosition,
} from '../../lib/api/api'
import { explainApiError } from '../../lib/api/apiErrors'
import { duesLocked } from '../../lib/dues/dues'
import { ACCEPTED_IMAGE_TYPES, downscaleImage } from '../../lib/media/downscaleImage'
import { imageSrc } from '../../lib/media/storedFiles'
import {
  ANY,
  filterTerms,
  groupByYear,
  seatLabel,
  servedRange,
  yearOf,
  yearsIn,
} from '../../lib/officerTerms'

/**
 * `/dashboard/officer/officers` — everybody who has ever run this club.
 *
 * The desk behind `/officers`, and the only way the club's history can be written at
 * all. Everything else that touches `officer_terms` describes today: the Discord sync
 * opens a term when somebody gains the officer role and closes it when they lose it, and
 * the roles desk moves people between chairs. Neither can say Marisol Vega was president
 * in 2011, so the archive only ever grew forwards and a term entered against the wrong
 * person stayed there.
 *
 * The same person, as many terms as they served. Nothing here is keyed on a person, and
 * the list groups by year rather than by name. The one uniqueness rule is the seat one
 * and it applies only to open terms: the club has one sitting treasurer and forty former
 * ones. A second open holder is refused and handed to the roles desk.
 *
 * This is also what makes somebody an officer alumnus: `/members` files a person under
 * ALUMNI when they carry the Discord Officer Alumni role or hold a term here that has
 * ended. So typing in a past board is the whole job.
 *
 * A term's `source` is fixed: it says who may close the row, and the sync only ever
 * closes what the sync opened. That's what keeps the faculty advisor from being stood
 * down by the first sweep that notices they carry no Discord role.
 */

export function OfficerArchivePage() {
  const { user, membership } = useOutletContext<DashboardContext>()

  // Dues before role, the same order every other desk uses: a lapsed officer is an
  // officer, and the sentence they need is about a payment.
  if (duesLocked(membership, user.role)) {
    return <DuesLocked eyebrow="/ MANAGE · OFFICERS" />
  }

  if (!isOfficer(user.role)) {
    return (
      <OfficerOnly
        eyebrow="/ MANAGE · OFFICERS"
        why="Who has run this club is the club's own record, so it is board business."
      />
    )
  }

  return <Archive />
}

const panelLabel =
  'text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]'
const primaryButton =
  'btn btn-primary btn-cta px-5 py-2.5 text-[12px] font-semibold disabled:opacity-60'
const secondaryButton =
  'btn btn-outline h-auto min-h-0 border-base-content/28 px-5 py-2.5 text-[12px] font-semibold text-base-content hover:border-base-content hover:bg-base-content/6 hover:text-base-content disabled:opacity-60'

type Message = { tone: 'error' | 'success'; text: string } | null

function Status({ message }: { message: Message }) {
  if (!message) return null

  return (
    <p
      role="status"
      className={`text-[13px] leading-[1.6] ${
        message.tone === 'error' ? 'text-error' : 'text-primary'
      }`}
    >
      {message.text}
    </p>
  )
}

/** `<input type="date">` speaks `YYYY-MM-DD` and nothing else. */
const asDateValue = (iso: string | null) => (iso === null ? '' : iso.slice(0, 10))

/**
 * A typed date, as the server wants it.
 *
 * Midday UTC rather than midnight, and that isn't fussiness. The archive groups terms
 * into academic years by reading the month in UTC, and a term stamped midnight UTC on 1
 * August is still 31 July in Orlando — the previous academic year. Noon is far enough
 * from either edge that no zone the club operates in can shift the date.
 */
const asInstant = (value: string) => (value === '' ? null : `${value}T12:00:00Z`)

/** The fields a term is made of, as the two forms on this page hold them. */
type Draft = {
  fullName: string
  userId: string | null
  position: OfficerPosition | ''
  startedAt: string
  endedAt: string
  endedReason: string
}

const emptyDraft: Draft = {
  fullName: '',
  userId: null,
  position: '',
  startedAt: '',
  endedAt: '',
  endedReason: '',
}

const draftOf = (term: ApiArchivedTerm): Draft => ({
  fullName: term.fullName,
  userId: term.user?.id ?? null,
  position: term.position ?? '',
  startedAt: asDateValue(term.startedAt),
  endedAt: asDateValue(term.endedAt),
  endedReason: term.endedReason ?? '',
})

/** What goes on the wire. `endedReason` empties to null rather than `''`, which the
    column has never held and which would print as a blank line. */
const bodyOf = (draft: Draft) => ({
  fullName: draft.fullName.trim(),
  userId: draft.userId,
  position: draft.position === '' ? null : draft.position,
  startedAt: asInstant(draft.startedAt),
  endedAt: asInstant(draft.endedAt),
  endedReason: draft.endedReason.trim() || null,
})

function Archive() {
  const [desk, setDesk] = useState<ApiOfficerArchiveDesk | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message>(null)

  /** Which row is open for editing, and which is being removed. One at a time each: two
      forms of the same shape on screen is two places to lose work. */
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<ApiArchivedTerm | null>(null)

  const [query, setQuery] = useState('')
  const [position, setPosition] = useState<OfficerPosition | typeof ANY>(ANY)
  const [year, setYear] = useState<string>(ANY)

  // Its own loader rather than `useApi`, which has no refetch — every write on this page
  // changes the list it's written into.
  const reload = useCallback(
    () =>
      getJson<ApiOfficerArchiveDesk>('/officer/archive')
        .then((answer) => {
          setDesk(answer)
          setFailed(false)
        })
        .catch(() => {
          setFailed(true)
        }),
    [],
  )

  useEffect(() => {
    void reload()
  }, [reload])

  const explain = (error: unknown) =>
    explainApiError(error, {
      forbidden: 'The server does not agree you are an officer.',
    })

  const terms = desk?.terms ?? []
  const shown = groupByYear(filterTerms(terms, { query, position, year }))
  const sitting = terms.filter((term) => term.endedAt === null).length

  /**
   * The seats and years to offer, read off the rows rather than a list.
   *
   * The public archive lets the server decide its chip rows, because that response is a
   * window and the browser can't see what fell outside it. This one has the whole table
   * in hand — and it has to work them out itself, since a seat that appears only on an
   * open term is one this desk shows and `/officers/past` never sends.
   */
  const seatsUsed = (desk?.seats ?? []).filter((seat) =>
    terms.some((term) => term.position === seat),
  )

  const remove = (term: ApiArchivedTerm) => {
    setRemoving(null)
    setBusy(true)
    setMessage(null)

    deleteJson(`/officer/archive/${term.id}`)
      .then(() => reload())
      .then(() => {
        setMessage({
          tone: 'success',
          text: `${term.fullName}'s term is off the officers page.`,
        })
      })
      .catch((error: unknown) => {
        setMessage({ tone: 'error', text: explain(error) })
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <section className="px-page py-10 wide:py-14">
      <FormEyebrow>/ MANAGE · OFFICERS</FormEyebrow>
      <FormHeading>Who has run this club</FormHeading>

      <p className="text-dim mb-8 max-w-[46rem] text-[14px] leading-[1.7] text-pretty">
        Every tenure the club has recorded, and the only place a finished one can
        be written. A term that has ended also files that person under{' '}
        <strong className="text-base-content font-semibold">ALUMNI</strong> on the
        members page, so typing in an old board is the whole job.
      </p>

      <div className="grid items-start gap-6 wide:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <FormPanel>
          <p className={panelLabel}>
            THE ARCHIVE
            {desk && (
              <span className="text-faint">
                {' '}
                &mdash; {terms.length}{' '}
                {terms.length === 1 ? 'term' : 'terms'}, {sitting} still open
              </span>
            )}
          </p>

          {failed && (
            <p className="text-dim mb-4 text-[13px] leading-[1.6]">
              We couldn&rsquo;t load the archive just now. Adding a term still
              works.
            </p>
          )}

          {!desk && !failed && (
            <p className="text-faint text-[13px]">Loading&hellip;</p>
          )}

          {desk && terms.length === 0 && (
            <p className="text-faint text-[13px] leading-[1.6]">
              Nothing recorded yet. Add the board you have, oldest or newest
              first &mdash; the page sorts itself.
            </p>
          )}

          {desk && terms.length > 0 && (
            <>
              <div className="mb-5 space-y-3">
                <input
                  type="search"
                  className={fieldClass}
                  placeholder="Search by name"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                  }}
                />

                <FilterChips
                  label="SEAT"
                  value={position}
                  onChange={setPosition}
                  options={[
                    { value: ANY, label: 'ANY' },
                    ...seatsUsed.map((seat) => ({
                      value: seat,
                      label: seatLabel(seat).toUpperCase(),
                    })),
                  ]}
                />

                <FilterChips
                  label="YEAR"
                  value={year}
                  onChange={setYear}
                  options={[
                    { value: ANY, label: 'ANY' },
                    ...yearsIn(terms).map((label) => ({
                      value: label,
                      label,
                    })),
                  ]}
                />
              </div>

              {shown.length === 0 && (
                <p className="text-faint text-[13px]">
                  Nothing matches those three together.
                </p>
              )}

              {shown.map((group) => (
                <div key={group.year} className="mb-6 last:mb-0">
                  <p className="text-primary border-rule mb-1 border-b pb-1.5 font-mono text-[11px] font-medium tracking-[0.16em]">
                    {group.year}
                  </p>

                  <ul className="divide-y divide-[var(--color-rule)]">
                    {group.terms.map((term) => (
                      <li key={term.id} className="py-3">
                        <TermRow
                          term={term}
                          seats={desk.seats}
                          open={editing === term.id}
                          busy={busy}
                          onEdit={() => {
                            setEditing(editing === term.id ? null : term.id)
                            setMessage(null)
                          }}
                          onRemove={() => {
                            setRemoving(term)
                          }}
                          onSaved={(saved) => {
                            setEditing(null)
                            setMessage({
                              tone: 'success',
                              text: `${saved.fullName}'s term is updated.`,
                            })
                            void reload()
                          }}
                          // The photo goes up on its own request, so it must not close
                          // the form somebody is still filling in.
                          onRefresh={() => {
                            void reload()
                          }}
                          onBusy={setBusy}
                          explain={explain}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}

          <div className="mt-5">
            <Status message={message} />
          </div>
        </FormPanel>

        <AddTerm
          seats={desk?.seats ?? []}
          busy={busy}
          onBusy={setBusy}
          explain={explain}
          onAdded={() => {
            setMessage(null)
            void reload()
          }}
        />
      </div>

      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.fullName}'s term?`}
          confirmLabel="REMOVE IT"
          busy={busy}
          onConfirm={() => {
            remove(removing)
          }}
          onDismiss={() => {
            setRemoving(null)
          }}
        >
          <p>
            The entry goes off the officers page for good. This is for a row that
            should never have existed &mdash; a duplicate, or the wrong person.
            Somebody whose term simply ended belongs in the archive, so give the
            term an end date instead.
          </p>
          {/* The one thing that makes this look broken if left unsaid. */}
          {removing.source === 'DISCORD' && removing.endedAt === null && (
            <p className="mt-3">
              The role sync opened this one, so if they still carry the officer
              role in Discord the next sweep will put it straight back. Take the
              role away there first if that is not what you want.
            </p>
          )}
        </ConfirmDialog>
      )}
    </section>
  )
}

/**
 * One row of the archive: the facts on one line, the whole form underneath when it's
 * open.
 *
 * Expanding in place rather than in a dialog, because editing a term is nearly always
 * comparing it with the rows around it — a date that reads wrong reads wrong next to the
 * year above it, and a modal hides exactly that.
 */
function TermRow({
  term,
  seats,
  open,
  busy,
  onEdit,
  onRemove,
  onSaved,
  onRefresh,
  onBusy,
  explain,
}: {
  term: ApiArchivedTerm
  seats: OfficerPosition[]
  open: boolean
  busy: boolean
  onEdit: () => void
  onRemove: () => void
  onSaved: (saved: ApiArchivedTerm) => void
  /** The list has changed but this form has not finished. */
  onRefresh: () => void
  onBusy: (busy: boolean) => void
  explain: (error: unknown) => string
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(term))
  const [message, setMessage] = useState<Message>(null)

  // So the reset below can read the current row without depending on it.
  const termRef = useRef(term)
  termRef.current = term

  /**
   * Reset whenever the row is opened, so cancelling and reopening shows what's stored
   * rather than what was abandoned last time.
   *
   * Keyed on the id, not on the term. A reload hands every row down as a fresh object, so
   * depending on `term` would throw away whatever is half-typed the moment anything else
   * refreshed the list — which the photo panel does, from inside this very form.
   */
  const id = term.id
  useEffect(() => {
    if (open) {
      setDraft(draftOf(termRef.current))
      setMessage(null)
    }
  }, [open, id])

  const save = () => {
    onBusy(true)
    setMessage(null)

    patchJson<ApiArchivedTerm>(`/officer/archive/${term.id}`, bodyOf(draft))
      .then(onSaved)
      .catch((error: unknown) => {
        setMessage({ tone: 'error', text: explain(error) })
      })
      .finally(() => {
        onBusy(false)
      })
  }

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">
            {term.fullName}
            {/* An open term in a page of finished ones. Said in words rather than left to
                an empty end date, which reads as missing data. */}
            {term.endedAt === null && (
              <span className="text-primary ml-2 font-mono text-[10px] tracking-[0.14em]">
                ON THE BOARD
              </span>
            )}
          </p>
          <p className="text-faint font-mono text-[10px] tracking-[0.14em] uppercase">
            {seatLabel(term.position)} · {servedRange(term.startedAt, term.endedAt)}
            {/* Where the row came from. A synced one comes back if it's closed while the
                person still holds the Discord role, which is the difference between a bug
                and the sync working. */}
            {term.source === 'DISCORD' && ' · from discord'}
            {term.user === null && ' · no account'}
          </p>
          {term.endedReason !== null && (
            <p className="text-dim mt-0.5 text-[12px] leading-[1.5]">
              {term.endedReason}
            </p>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            className={secondaryButton}
            disabled={busy}
            aria-expanded={open}
            onClick={onEdit}
          >
            {open ? 'CLOSE' : 'EDIT'}
          </button>
          <button
            type="button"
            className={secondaryButton}
            disabled={busy}
            onClick={onRemove}
          >
            REMOVE
          </button>
        </div>
      </div>

      {open && (
        <div className="border-rule mt-3 space-y-4 border-t pt-4">
          <TermFields
            draft={draft}
            setDraft={setDraft}
            seats={seats}
            busy={busy}
          />

          <TermPhoto
            term={term}
            busy={busy}
            onBusy={onBusy}
            onChanged={onRefresh}
            explain={explain}
          />

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={primaryButton}
              disabled={busy || draft.fullName.trim().length < 2 || draft.startedAt === ''}
              onClick={save}
            >
              {busy ? 'SAVING…' : 'SAVE THE TERM'}
            </button>
            <button
              type="button"
              className={secondaryButton}
              disabled={busy}
              onClick={onEdit}
            >
              CANCEL
            </button>
          </div>

          <Status message={message} />
        </div>
      )}
    </>
  )
}

/**
 * The fields every term has, shared by the add form and the edit form.
 *
 * One component rather than two copies, because both write the same six columns and a
 * field that drifted between them would be one the desk could set but not correct.
 */
function TermFields({
  draft,
  setDraft,
  seats,
  busy,
}: {
  draft: Draft
  setDraft: (draft: Draft) => void
  seats: OfficerPosition[]
  busy: boolean
}) {
  const id = useId()
  const set = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch })
  }

  return (
    <>
      <div>
        <label htmlFor={`${id}-name`} className={labelClass}>
          WHO HELD IT
        </label>
        <input
          id={`${id}-name`}
          className={fieldClass}
          value={draft.fullName}
          disabled={busy}
          maxLength={120}
          onChange={(event) => {
            set({ fullName: event.target.value })
          }}
        />
        {/* Why the name is typed even when an account is linked: it's the record of a
            year, not a view of a profile. */}
        <p className="text-faint mt-1.5 text-[12px] leading-[1.5]">
          Stored on the term itself, so correcting a spelling on somebody&rsquo;s
          account never rewrites the year they served.
        </p>
      </div>

      <div>
        <label htmlFor={`${id}-seat`} className={labelClass}>
          WHICH SEAT
        </label>
        <select
          id={`${id}-seat`}
          className={`${fieldClass} select`}
          value={draft.position}
          disabled={busy}
          onChange={(event) => {
            set({ position: event.target.value as OfficerPosition | '' })
          }}
        >
          {/* Empty is a real answer, not a prompt: somebody can serve without a named
              chair, which is what the Discord sync creates before anybody has been given
              one. */}
          <option value="">No named seat</option>
          {seats.map((seat) => (
            <option key={seat} value={seat}>
              {seatLabel(seat)}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 wide:grid-cols-2">
        <div>
          <label htmlFor={`${id}-from`} className={labelClass}>
            STARTED
          </label>
          <input
            id={`${id}-from`}
            type="date"
            className={fieldClass}
            value={draft.startedAt}
            disabled={busy}
            onChange={(event) => {
              set({ startedAt: event.target.value })
            }}
          />
        </div>

        {/* On the add form as much as the edit one: a board typed in from 2011 is
            finished before it's entered, which is the case this whole desk exists for. */}
        <div>
          <label htmlFor={`${id}-to`} className={labelClass}>
            ENDED
          </label>
          <input
            id={`${id}-to`}
            type="date"
            className={fieldClass}
            value={draft.endedAt}
            disabled={busy}
            onChange={(event) => {
              set({ endedAt: event.target.value })
            }}
          />
          <p className="text-faint mt-1.5 text-[12px] leading-[1.5]">
            Leave it empty for somebody still on the board.
          </p>
        </div>
      </div>

      <div>
        <label htmlFor={`${id}-why`} className={labelClass}>
          WHY IT ENDED
        </label>
        <input
          id={`${id}-why`}
          className={fieldClass}
          value={draft.endedReason}
          disabled={busy}
          maxLength={200}
          placeholder="Graduated, handed over to…, stood down"
          onChange={(event) => {
            set({ endedReason: event.target.value })
          }}
        />
      </div>
    </>
  )
}

/**
 * The headshot filed against the term itself.
 *
 * The public page prefers the linked account's picture, so this only shows on
 * `/officers` for a term with nobody behind it — which is most of the archive, and the
 * whole reason the column exists.
 *
 * Said on the panel rather than left to be discovered, because uploading a photo and
 * watching the account's one still appear is indistinguishable from a broken upload.
 */
function TermPhoto({
  term,
  busy,
  onBusy,
  onChanged,
  explain,
}: {
  term: ApiArchivedTerm
  busy: boolean
  onBusy: (busy: boolean) => void
  /** Tell the page the row moved. Deliberately not "the form is finished" — somebody may
      still be halfway through the fields above. */
  onChanged: () => void
  explain: (error: unknown) => string
}) {
  const id = useId()
  const [message, setMessage] = useState<Message>(null)
  const input = useRef<HTMLInputElement>(null)

  /**
   * What the well is showing, from this panel's own answers.
   *
   * Held here rather than read off `term`, because the list behind it reloads
   * asynchronously and the picture has to change the instant the upload lands — a well
   * that stayed empty for a beat is the one thing that would make somebody upload twice.
   */
  const [photo, setPhoto] = useState(term.photoUrl)
  useEffect(() => {
    setPhoto(term.photoUrl)
  }, [term.photoUrl])

  const took = (saved: ApiArchivedTerm) => {
    setPhoto(saved.photoUrl)
    onChanged()
  }

  const upload = async (picked: File) => {
    onBusy(true)
    setMessage(null)

    try {
      // Downscaled in the browser for the reason every other upload here is: a phone
      // photograph is several megabytes and the cap refuses it, which reads as "the site
      // is broken" rather than "resize it".
      const { file } = await downscaleImage(picked)
      const form = new FormData()
      form.append('file', file)

      took(await postForm<ApiArchivedTerm>(`/officer/archive/${term.id}/photo`, form))
    } catch (error: unknown) {
      setMessage({ tone: 'error', text: explain(error) })
    } finally {
      onBusy(false)
      // So picking the same file again after a failure still fires a change.
      if (input.current) input.current.value = ''
    }
  }

  const clear = () => {
    onBusy(true)
    setMessage(null)

    deleteJson<ApiArchivedTerm>(`/officer/archive/${term.id}/photo`)
      .then(took)
      .catch((error: unknown) => {
        setMessage({ tone: 'error', text: explain(error) })
      })
      .finally(() => {
        onBusy(false)
      })
  }

  return (
    <div className="border-rule border-t pt-4">
      <p className={labelClass}>PHOTOGRAPH</p>

      <div className="flex items-start gap-4">
        <div className="bg-base-200 border-rule flex size-16 shrink-0 items-center justify-center overflow-hidden border">
          {photo === null ? (
            <span className="text-faint font-mono text-[9px] tracking-[0.14em]">
              NONE
            </span>
          ) : (
            <img
              // Every stored upload goes through `imageSrc` — the column is root-relative
              // and the API is another origin.
              src={imageSrc(photo)}
              alt=""
              className="size-full object-cover"
            />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-faint text-[12px] leading-[1.5] text-pretty">
            {term.user
              ? `Only used if ${term.user.fullName}'s account has no photo — the account's own picture wins, so it follows them when they change it.`
              : 'Nobody is linked to this term, so this is the only picture the officers page can draw.'}
          </p>

          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              id={`${id}-photo`}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES}
              className="file-input file-input-sm border-rule bg-base-200 max-w-[15rem] text-xs"
              disabled={busy}
              onChange={(event) => {
                const picked = event.target.files?.[0]
                if (picked) void upload(picked)
              }}
            />
            {photo !== null && (
              <button
                type="button"
                className={secondaryButton}
                disabled={busy}
                onClick={clear}
              >
                REMOVE PHOTO
              </button>
            )}
          </div>

          <Status message={message} />
        </div>
      </div>
    </div>
  )
}

/**
 * Adding a term, which is what this desk exists for.
 *
 * Linking an account is optional and the form says so. Most of the archive predates the
 * site; where there is an account the link carries the headshot forward, so rolling a
 * board over is eight rows pointing at eight accounts rather than eight photographs
 * uploaded again. Picking somebody fills the name in, because typing it again is how a
 * term ends up filed under a misspelling of its own holder.
 */
function AddTerm({
  seats,
  busy,
  onBusy,
  explain,
  onAdded,
}: {
  seats: OfficerPosition[]
  busy: boolean
  onBusy: (busy: boolean) => void
  explain: (error: unknown) => string
  onAdded: () => void
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [linked, setLinked] = useState<ApiOfficerMember | null>(null)
  const [message, setMessage] = useState<Message>(null)

  const pick = (member: ApiOfficerMember | null) => {
    setLinked(member)
    setDraft({
      ...draft,
      userId: member?.id ?? null,
      // Only when the field is empty, so an officer who has already typed "M. Vega" over
      // the account's "Marisol Vega" doesn't lose it by linking the account afterwards.
      fullName: draft.fullName === '' ? (member?.fullName ?? '') : draft.fullName,
    })
  }

  const submit = () => {
    onBusy(true)
    setMessage(null)

    postJson<ApiArchivedTerm>('/officer/archive', bodyOf(draft))
      .then((added) => {
        onAdded()
        setDraft(emptyDraft)
        setLinked(null)
        setMessage({
          tone: 'success',
          text:
            added.endedAt === null
              ? `${added.fullName} is on the board.`
              : `${added.fullName} is in the archive under ${yearOf(added)}.`,
        })
      })
      .catch((error: unknown) => {
        setMessage({ tone: 'error', text: explain(error) })
      })
      .finally(() => {
        onBusy(false)
      })
  }

  return (
    <FormPanel>
      <p className={panelLabel}>ADD A TERM</p>
      <p className="text-dim mb-4 text-[13px] leading-[1.6] text-pretty">
        One entry per person per tenure &mdash; three years in one seat is one
        entry, three chairs is three.
      </p>

      <div className="space-y-4">
        <div>
          <MemberSearch
            picked={linked}
            onPick={pick}
            disabled={busy}
            label="THEIR ACCOUNT, IF THEY HAVE ONE"
          />
          <p className="text-faint mt-1.5 text-[12px] leading-[1.5] text-pretty">
            Optional. Most past officers were here before the site was and have
            no account &mdash; leave it empty and type the name. Linking one
            makes the officers page use their headshot and their profile link.
          </p>
        </div>

        <TermFields
          draft={draft}
          setDraft={setDraft}
          seats={seats}
          busy={busy}
        />

        <button
          type="button"
          className={primaryButton}
          disabled={
            busy || draft.fullName.trim().length < 2 || draft.startedAt === ''
          }
          onClick={submit}
        >
          {busy ? 'SAVING…' : 'ADD THE TERM'}
        </button>

        <Status message={message} />
      </div>
    </FormPanel>
  )
}
