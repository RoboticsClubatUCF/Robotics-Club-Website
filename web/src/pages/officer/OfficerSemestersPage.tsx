import { useCallback, useEffect, useId, useState } from 'react'
import { useOutletContext } from 'react-router'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { DuesLocked } from '../../components/dashboard/DuesLocked'
import { OfficerOnly } from '../../components/dashboard/OfficerOnly'
import { isOfficer } from '../../lib/auth/session'
import { ConfirmDialog } from '../../components/shared/ConfirmDialog'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  fieldClass,
  labelClass,
} from '../../components/shared/formChrome'
import { deleteJson, getJson, putJson } from '../../lib/api/api'
import type { ApiSemesterTerm, Season } from '../../lib/api/api'
import { explainApiError } from '../../lib/api/apiErrors'
import { duesLocked } from '../../lib/dues/dues'

/**
 * `/dashboard/officer/semesters` — when the club says a term starts and ends.
 *
 * The site reads UCF's academic calendar to decide what everybody is charged
 * and when a membership lapses, and that feed is somebody else's document: it
 * publishes late, renames the events the parser looks for, and sometimes omits
 * a term entirely. When it cannot be read the server falls back to fixed dates
 * in `server/src/membership/semester.ts`, and until this page existed the only way to
 * correct one was to edit those constants and deploy.
 *
 * **So the first thing every row says is where its dates came from.** A term
 * reading FALLBACK is the site guessing, and that is the whole reason to open
 * this page; CALENDAR is UCF answering; SET BY THE CLUB is a row somebody here
 * typed. Without that line the page would be three pairs of dates with no way
 * to tell a fact from a guess.
 *
 * **Changing a term does not re-charge anybody.** Every payment stores the
 * dates it was sold against, so this moves what the *next* one buys and leaves
 * settled ones alone — the same property that makes the fallback dates
 * survivable at all. The page says so, because "will this bill people again"
 * is the question anybody hesitates over.
 */

const SEASON_LABEL: Record<Season, string> = {
  SPRING: 'Spring',
  SUMMER: 'Summer',
  FALL: 'Fall',
}

const SOURCE_LABEL: Record<ApiSemesterTerm['source'], string> = {
  override: 'SET BY THE CLUB',
  calendar: 'FROM UCF',
  fallback: 'GUESSED',
}

/** The gold is for the one that wants attention. A guess is not an error — the
    site works fine on one — but it is the row worth looking at. */
const SOURCE_CLASS: Record<ApiSemesterTerm['source'], string> = {
  override: 'text-primary',
  calendar: 'text-faint',
  fallback: 'text-warning',
}

/** `<input type="date">` speaks `YYYY-MM-DD` and nothing else. */
const asDateValue = (iso: string) => iso.slice(0, 10)

export function OfficerSemestersPage() {
  const { user, membership } = useOutletContext<DashboardContext>()

  // Dues before role, the same order every other desk uses: a lapsed officer
  // is an officer, and the sentence they need is about a payment.
  if (duesLocked(membership, user.role)) {
    return <DuesLocked eyebrow="/ MANAGE · SEMESTERS" />
  }

  if (!isOfficer(user.role)) {
    return <OfficerOnly eyebrow="/ MANAGE · SEMESTERS" why="When a term runs decides what everybody is charged, so it is board business." />
  }

  return <Semesters />
}

const panelLabel =
  'text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]'
const primaryButton =
  'btn btn-primary btn-cta px-5 py-2.5 text-[12px] font-semibold disabled:opacity-60'
const secondaryButton =
  'btn btn-outline h-auto min-h-0 border-base-content/28 px-5 py-2.5 text-[12px] font-semibold text-base-content hover:border-base-content hover:bg-base-content/6 hover:text-base-content disabled:opacity-60'

type Message = { tone: 'error' | 'success'; text: string } | null

function Semesters() {
  const id = useId()
  // The year in view. Starts on this one — the term being corrected is nearly
  // always the current or the next, and both are reachable in one press.
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [terms, setTerms] = useState<ApiSemesterTerm[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState<Season | null>(null)
  const [resetting, setResetting] = useState<ApiSemesterTerm | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message>(null)

  // Its own loader rather than `useApi`, which has no refetch: every write on
  // this page changes the list it is written into.
  const reload = useCallback(() => {
    setTerms(null)
    getJson<ApiSemesterTerm[]>(`/officer/semesters/${String(year)}`)
      .then((rows) => {
        setTerms(rows)
        setFailed(false)
      })
      .catch(() => {
        setFailed(true)
      })
  }, [year])

  useEffect(reload, [reload])

  const explain = (error: unknown) =>
    explainApiError(error, {
      forbidden: 'The server does not agree you are an officer.',
    })

  const save = (
    season: Season,
    startsAt: string,
    endsAt: string,
    finalsStartsAt: string,
    finalsEndsAt: string,
    note: string,
  ) => {
    setBusy(true)
    setMessage(null)

    putJson(`/officer/semesters/${String(year)}/${season}`, {
      startsAt,
      endsAt,
      // Both or neither. Empty means "we have not said" and hands finals back
      // to UCF's calendar, which is not the same as "there is no finals week".
      finalsStartsAt: finalsStartsAt || null,
      finalsEndsAt: finalsEndsAt || null,
      note: note.trim() || null,
    })
      .then(() => {
        setMessage({
          tone: 'success',
          text: `${SEASON_LABEL[season]} ${String(year)} is now the club's own dates.`,
        })
        setEditing(null)
        reload()
      })
      .catch((error: unknown) => {
        setMessage({ tone: 'error', text: explain(error) })
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const reset = (term: ApiSemesterTerm) => {
    setResetting(null)
    setBusy(true)
    setMessage(null)

    deleteJson(`/officer/semesters/${String(year)}/${term.season}`)
      .then(() => {
        setMessage({
          tone: 'success',
          text: `${SEASON_LABEL[term.season]} ${String(year)} follows UCF again.`,
        })
        reload()
      })
      .catch((error: unknown) => {
        setMessage({ tone: 'error', text: explain(error) })
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <>
      <FormEyebrow>/ MANAGE · SEMESTERS</FormEyebrow>
      <FormHeading>When the terms run.</FormHeading>

      <FormPanel>
        <p className="text-dim mb-4 max-w-[46rem] text-[13px] leading-[1.6] text-pretty">
          These dates decide what dues cover and when a membership lapses.
          The site reads UCF&rsquo;s academic calendar &mdash; set them here
          when UCF is late, or wrong. Nobody already charged is re-charged.
        </p>

        <div className="mb-5 flex items-center gap-2">
          <label htmlFor={`${id}-year`} className={labelClass + ' mb-0'}>
            YEAR
          </label>
          <button
            type="button"
            className={secondaryButton}
            disabled={busy}
            onClick={() => {
              setYear((current) => current - 1)
            }}
            aria-label="Previous year"
          >
            &larr;
          </button>
          <output id={`${id}-year`} className="font-mono text-sm font-semibold">
            {year}
          </output>
          <button
            type="button"
            className={secondaryButton}
            disabled={busy}
            onClick={() => {
              setYear((current) => current + 1)
            }}
            aria-label="Next year"
          >
            &rarr;
          </button>
        </div>

        {failed && (
          <p className="text-dim text-sm leading-[1.7]">
            We couldn&rsquo;t load that year just now. Try again in a moment.
          </p>
        )}

        {terms === null && !failed && (
          <div aria-busy="true" className="space-y-2.5">
            {Array.from({ length: 3 }, (_, index) => (
              <div
                key={index}
                className="bg-base-300 h-12 w-full animate-pulse rounded-[2px]"
              />
            ))}
          </div>
        )}

        {/* Three terms across rather than three rows down. A year is what this
            page is about — the picker above it moves a year at a time — and
            three cards side by side is a year you can compare at a glance,
            where three rules across a monitor was one fact per screenful with
            the buttons stranded at the far right. Each term carries its own
            border now, since there is no longer a single stack for a shared
            hairline to sit between. */}
        {terms && (
          <ul className="grid-fluid items-start gap-3 [--col-min:22rem]">
            {terms.map((term) => (
              <li key={term.season} className="border-rule border p-4">
                {editing === term.season ? (
                  <TermForm
                    term={term}
                    busy={busy}
                    onCancel={() => {
                      setEditing(null)
                    }}
                    onSave={(startsAt, endsAt, finalsStart, finalsEnd, note) => {
                      save(
                        term.season,
                        startsAt,
                        endsAt,
                        finalsStart,
                        finalsEnd,
                        note,
                      )
                    }}
                  />
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold">
                        {SEASON_LABEL[term.season]} {term.year}
                      </p>
                      <p className="text-dim mt-0.5 text-[12px]">
                        {asDateValue(term.startsAt)} &rarr;{' '}
                        {asDateValue(term.endsAt)}
                      </p>
                      {/* Finals, on its own line, because it answers a
                          different question from the term dates: not "when is
                          the semester" but "when does every project stop".
                          Said in words when nobody has set it — a blank pair of
                          dates reads as a finals week of no days rather than as
                          a question still open, and nothing is paused either
                          way. */}
                      <p className="text-dim mt-0.5 text-[12px]">
                        {term.finalsStartAt && term.finalsEndAt ? (
                          <>
                            Finals {asDateValue(term.finalsStartAt)} &rarr;{' '}
                            {asDateValue(term.finalsEndAt)} — projects on halt
                          </>
                        ) : (
                          <span className="text-faint">
                            No finals week set — nothing is paused
                          </span>
                        )}
                      </p>
                      <p
                        className={`mt-1 font-mono text-[10px] font-medium tracking-[0.14em] ${SOURCE_CLASS[term.source]}`}
                      >
                        {SOURCE_LABEL[term.source]}
                        {term.finalsSource &&
                          term.finalsSource !== term.source &&
                          ` · FINALS FROM ${term.finalsSource === 'override' ? 'THE CLUB' : 'UCF'}`}
                        {term.note && ` · ${term.note}`}
                      </p>
                    </div>

                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        className={secondaryButton}
                        disabled={busy}
                        onClick={() => {
                          setEditing(term.season)
                        }}
                      >
                        SET DATES
                      </button>
                      {/* Only where there is something to undo. A reset button
                          on a term nobody has touched would suggest the
                          calendar's own dates can be cleared. */}
                      {term.source === 'override' && (
                        <button
                          type="button"
                          className={secondaryButton}
                          disabled={busy}
                          onClick={() => {
                            setResetting(term)
                          }}
                        >
                          USE UCF&rsquo;S
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <p role="status" className="mt-4 min-h-4 text-[13px]">
          {message && (
            <span
              className={
                message.tone === 'error' ? 'text-error' : 'text-success'
              }
            >
              {message.text}
            </span>
          )}
        </p>
      </FormPanel>

      {resetting && (
        <ConfirmDialog
          title={`Hand ${SEASON_LABEL[resetting.season]} ${String(year)} back to UCF?`}
          confirmLabel="USE UCF'S DATES"
          busy={busy}
          onConfirm={() => {
            reset(resetting)
          }}
          onDismiss={() => {
            setResetting(null)
          }}
        >
          <p>
            The club&rsquo;s dates for that term are removed and the site
            goes back to reading UCF&rsquo;s calendar.
          </p>
        </ConfirmDialog>
      )}
    </>
  )
}

/**
 * The two dates and a note, as a form.
 *
 * Native `type="date"` rather than anything hand-rolled: it is one of the few
 * inputs where the platform's is better than a component, it comes with a
 * keyboard and a picker for free, and the value it produces — `YYYY-MM-DD` — is
 * exactly what the route parses.
 */
function TermForm({
  term,
  busy,
  onSave,
  onCancel,
}: {
  term: ApiSemesterTerm
  busy: boolean
  onSave: (
    startsAt: string,
    endsAt: string,
    finalsStartsAt: string,
    finalsEndsAt: string,
    note: string,
  ) => void
  onCancel: () => void
}) {
  const id = useId()
  // Seeded from whatever is in force, so correcting UCF by three days is an
  // edit rather than typing both dates out.
  const [startsAt, setStartsAt] = useState(() => asDateValue(term.startsAt))
  const [endsAt, setEndsAt] = useState(() => asDateValue(term.endsAt))
  // Seeded the same way, and empty when nothing has answered — which is a
  // state the term dates never have, since those always fall back.
  const [finalsStart, setFinalsStart] = useState(() =>
    term.finalsStartAt ? asDateValue(term.finalsStartAt) : '',
  )
  const [finalsEnd, setFinalsEnd] = useState(() =>
    term.finalsEndAt ? asDateValue(term.finalsEndAt) : '',
  )
  const [note, setNote] = useState(term.note ?? '')

  const fault = startsAt && endsAt && startsAt >= endsAt
  // The three ways finals can be wrong, in the order somebody hits them. The
  // server refuses all three as well; this is the copy anybody reads.
  const finalsFault =
    Boolean(finalsStart) !== Boolean(finalsEnd)
      ? 'Give finals week both ends, or clear both to follow UCF.'
      : finalsStart && finalsEnd && finalsStart >= finalsEnd
        ? 'Finals week has to end after it starts.'
        : finalsStart &&
            finalsEnd &&
            startsAt &&
            endsAt &&
            (finalsStart < startsAt || finalsEnd > endsAt)
          ? 'Finals week has to fall inside the term.'
          : ''

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!fault && !finalsFault) {
          onSave(startsAt, endsAt, finalsStart, finalsEnd, note)
        }
      }}
    >
      <p className={panelLabel}>
        {SEASON_LABEL[term.season].toUpperCase()} {term.year}
      </p>

      <div className="grid-fluid mb-3 gap-3 [--col-min:13rem]">
        <div>
          <label htmlFor={`${id}-start`} className={labelClass}>
            FIRST DAY
          </label>
          <input
            id={`${id}-start`}
            type="date"
            required
            className={fieldClass}
            value={startsAt}
            disabled={busy}
            onChange={(event) => {
              setStartsAt(event.target.value)
            }}
          />
        </div>
        <div>
          <label htmlFor={`${id}-end`} className={labelClass}>
            LAST DAY
          </label>
          <input
            id={`${id}-end`}
            type="date"
            required
            className={fieldClass}
            value={endsAt}
            disabled={busy}
            onChange={(event) => {
              setEndsAt(event.target.value)
            }}
          />
        </div>
      </div>

      <div className="grid-fluid mb-3 gap-3 [--col-min:13rem]">
        <div>
          <label htmlFor={`${id}-finals-start`} className={labelClass}>
            FINALS BEGINS
          </label>
          <input
            id={`${id}-finals-start`}
            type="date"
            className={fieldClass}
            value={finalsStart}
            disabled={busy}
            onChange={(event) => {
              setFinalsStart(event.target.value)
            }}
          />
        </div>
        <div>
          <label htmlFor={`${id}-finals-end`} className={labelClass}>
            FINALS ENDS
          </label>
          <input
            id={`${id}-finals-end`}
            type="date"
            className={fieldClass}
            value={finalsEnd}
            disabled={busy}
            onChange={(event) => {
              setFinalsEnd(event.target.value)
            }}
          />
        </div>
      </div>

      <p className="text-faint mb-3 text-[11px] leading-[1.5] text-pretty">
        Every project is on halt for these dates — no weekly meetings are drawn
        on any calendar. Leave both blank to follow UCF&rsquo;s calendar, which
        counts finals as everything after the last day of classes.
      </p>

      <div className="mb-3">
        <label htmlFor={`${id}-note`} className={labelClass}>
          WHY (OPTIONAL)
        </label>
        <input
          id={`${id}-note`}
          type="text"
          maxLength={200}
          className={fieldClass}
          placeholder="UCF hadn't published yet"
          value={note}
          disabled={busy}
          onChange={(event) => {
            setNote(event.target.value)
          }}
        />
      </div>

      {/* Said before the button rather than after the server refuses it: the
          server checks this too, and one of the two has to be the one somebody
          actually reads. */}
      {fault && (
        <p className="text-error mb-3 text-[13px]">
          A term has to end after it starts.
        </p>
      )}

      {finalsFault && (
        <p className="text-error mb-3 text-[13px]">{finalsFault}</p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          className={primaryButton}
          disabled={busy || Boolean(fault) || Boolean(finalsFault)}
        >
          {busy ? 'SAVING…' : 'SAVE DATES'}
        </button>
        <button
          type="button"
          className={secondaryButton}
          disabled={busy}
          onClick={onCancel}
        >
          CANCEL
        </button>
      </div>
    </form>
  )
}
