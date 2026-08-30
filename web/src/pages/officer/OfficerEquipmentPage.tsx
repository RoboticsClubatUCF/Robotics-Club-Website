import { useCallback, useEffect, useId, useState } from 'react'
import { useOutletContext } from 'react-router'
import { DuesLocked } from '../../components/dashboard/DuesLocked'
import { OfficerOnly } from '../../components/dashboard/OfficerOnly'
import { isOfficer } from '../../lib/auth/session'
import { duesLocked } from '../../lib/dues/dues'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  fieldClass,
  labelClass,
} from '../../components/shared/formChrome'
import { ConfirmDialog } from '../../components/shared/ConfirmDialog'
import { ApiError, deleteJson, getJson, patchJson, postJson } from '../../lib/api/api'
import type {
  ApiOfficerEquipment,
  ApiOfficerLoan,
  LoanStatus,
  NewEquipment,
} from '../../lib/api/api'
import {
  LAST_SENSIBLE_DATE,
  capPhrase,
  dateInputValue,
  endOfDay,
} from '../../lib/equipment/borrowing'
import { hits, narrow, showAllLabel } from '../../lib/equipment/catalogue'
import { FilterChips } from '../../components/shared/FilterChips'
import { STATUS_TONE, shortDate } from '../../lib/format/formats'
import type { StatusTone } from '../../lib/format/formats'

/**
 * The lending desk: the inventory, and the queue of who wants what.
 *
 * The buttons on a loan offer only the moves its current state actually has —
 * the server keeps the same table and refuses anything else, so this is the
 * readable half of one rule rather than a second rule that could drift.
 */

const STATUS_LABEL: Record<LoanStatus, { text: string; tone: StatusTone }> = {
  // Amber, because this is the only row on the queue that is a job. Everything
  // else is a fact about something already decided.
  REQUESTED: { text: 'NEEDS A DECISION', tone: 'waiting' },
  APPROVED: { text: 'SET ASIDE', tone: 'progress' },
  CHECKED_OUT: { text: 'OUT', tone: 'progress' },
  RETURNED: { text: 'BACK', tone: 'good' },
  DENIED: { text: 'DECLINED', tone: 'bad' },
  CANCELED: { text: 'CANCELLED', tone: 'neutral' },
}

/**
 * The queue's actions, drawn the way the print queue draws its own.
 *
 * One shape, three weights: gold for the natural next step, outline white for
 * the other move, red outline for the one that ends it badly. They were bare
 * mono text sharing a row with the note box, which read as labels rather than
 * controls and put DECLINE two millimetres from APPROVE. Copied deliberately
 * rather than shared — the two queues are the same job on two desks, and an
 * officer moving between them should not have to learn a second vocabulary.
 */
const actionBase =
  'btn h-auto min-h-0 cursor-pointer px-4 py-2 text-[11px] font-semibold tracking-[0.04em] disabled:opacity-50'

const loudButton = `${actionBase} btn-primary btn-cta`

const quietButton = `${actionBase} btn-outline border-base-content/28 text-base-content hover:border-base-content hover:bg-base-content/6 hover:text-base-content`

const dangerButton = `${actionBase} btn-outline border-error/40 text-error hover:border-error hover:bg-error/10 hover:text-error`

/**
 * The same lifecycle the server enforces, as buttons.
 *
 * Nothing goes straight from asked to handed over any more: the club's rule is
 * that an officer approves a request before the member takes the thing, so the
 * shortcut that used to sit on a REQUESTED row is gone. Handing something over
 * on the spot is APPROVE then HAND OVER, two clicks in a row.
 */
const MOVES: Record<LoanStatus, { status: LoanStatus; label: string }[]> = {
  REQUESTED: [
    { status: 'APPROVED', label: 'APPROVE' },
    { status: 'DENIED', label: 'DECLINE' },
  ],
  APPROVED: [
    { status: 'CHECKED_OUT', label: 'HAND OVER' },
    { status: 'DENIED', label: 'DECLINE' },
  ],
  CHECKED_OUT: [{ status: 'RETURNED', label: 'CHECK IT IN' }],
  RETURNED: [],
  DENIED: [],
  CANCELED: [],
}

/**
 * The move that carries the gold, per state — the shift's usual answer.
 *
 * It walks along as a loan progresses, the way the print queue's primary
 * moves from START PRINTING to MARK DONE, so the button an officer wants is
 * always the one that looks like a button.
 */
const NEXT_STEP: Partial<Record<LoanStatus, LoanStatus>> = {
  REQUESTED: 'APPROVED',
  APPROVED: 'CHECKED_OUT',
  CHECKED_OUT: 'RETURNED',
}

const FILTERS = [
  { value: '', label: 'LIVE' },
  { value: 'REQUESTED', label: 'ASKED' },
  { value: 'APPROVED', label: 'SET ASIDE' },
  { value: 'CHECKED_OUT', label: 'OUT' },
  { value: 'RETURNED', label: 'BACK' },
  { value: 'DENIED', label: 'DECLINED' },
] as const

/**
 * The dates, which is what an officer chasing returns is actually sorting by.
 *
 * OVERDUE first because it is the only one that is a job. BOOKED AHEAD is the
 * reservation pile — approved, holding a unit, and not collected for weeks —
 * which is worth being able to see on its own precisely because it is easy to
 * forget those units are off the shelf.
 */
const WHENS = [
  { value: 'ALL', label: 'ANY' },
  { value: 'OVERDUE', label: 'OVERDUE' },
  { value: 'SOON', label: 'DUE THIS WEEK' },
  { value: 'BOOKED', label: 'BOOKED AHEAD' },
] as const

type WhenFilter = (typeof WHENS)[number]['value']

/**
 * The inventory's own narrowing.
 *
 * Retired items are on this list and on no other, so being able to see only
 * them is how somebody brings one back without scrolling past everything that
 * is fine. OUT NOW answers the question a member has just asked in person.
 */
const STOCK = [
  { value: 'ALL', label: 'EVERYTHING' },
  { value: 'ACTIVE', label: 'ON THE LIST' },
  { value: 'OUT', label: 'OUT NOW' },
  { value: 'RETIRED', label: 'RETIRED' },
] as const

type StockFilter = (typeof STOCK)[number]['value']

/** Whether a loan answers the date filter above. */
function inWindow(loan: ApiOfficerLoan, when: WhenFilter, now: number): boolean {
  if (when === 'ALL') return true

  if (when === 'BOOKED') {
    return loan.startAt !== null && new Date(loan.startAt).getTime() > now
  }

  // Both of the remaining two are about a deadline, so a loan without one is
  // in neither — an undated ask is not overdue, it is undecided.
  if (!loan.dueAt) return false

  const due = new Date(loan.dueAt).getTime()

  return when === 'OVERDUE'
    ? due < now && loan.status === 'CHECKED_OUT'
    : due >= now && due <= now + 7 * 24 * 60 * 60 * 1000
}

function explain(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0)
      return "We couldn't reach the server. Try again in a moment."
    if (error.status === 403) return 'The server does not agree you are an officer.'
    if (error.detail) return error.detail
  }
  return 'That change did not go through. Try again in a moment.'
}

export function OfficerEquipmentPage() {
  const { user, membership } = useOutletContext<DashboardContext>()

  // Dues before role, because a lapsed officer *is* an officer and the
  // sentence they need is about a payment rather than about the board.
  if (duesLocked(membership, user.role)) {
    return <DuesLocked eyebrow="/ MANAGE · EQUIPMENT" />
  }

  if (!isOfficer(user.role)) {
    return <OfficerOnly eyebrow="/ MANAGE · EQUIPMENT" why="The lending list and the borrowing queue are run by the officers with keys to the lab." />
  }

  return (
    <>
      <FormEyebrow>/ MANAGE · EQUIPMENT</FormEyebrow>
      <FormHeading>Equipment.</FormHeading>

      {/* The queue and the list are two jobs, not two halves of one: approving
          what people have asked for, and deciding what the club lends at all.
          Side by side where there is room, because checking whether the club
          even owns a second one of something is a question the queue raises and
          the list answers. `--col-min` is high — both panels carry a search box
          and a row of chips, and squeezing those into half a laptop helps
          nobody. */}
      <div className="grid-fluid items-start gap-5 [--col-min:34rem]">
        <LoanQueue />
        <Inventory />
      </div>
    </>
  )
}

function LoanQueue() {
  const id = useId()
  const [filter, setFilter] = useState<string>('')
  const [query, setQuery] = useState('')
  const [when, setWhen] = useState<WhenFilter>('ALL')
  const [loans, setLoans] = useState<ApiOfficerLoan[] | null | 'loading'>('loading')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [dueDates, setDueDates] = useState<Record<string, string>>({})

  /**
   * Searching from LIVE reaches the whole ledger; searching inside a section
   * stays there. Same rule as the print queue, and the same reason: LIVE means
   * "what needs doing", and somebody typing a name into it has stopped asking
   * that and started looking for a loan that has usually already come back.
   *
   * A boolean in the dependency list rather than the text, so this is one
   * fetch when the box fills and one when it empties.
   */
  const widen = filter === '' && query.trim() !== ''

  const load = useCallback(async () => {
    const scope = widen ? '?all=1' : filter ? `?status=${filter}` : ''

    try {
      setLoans(await getJson<ApiOfficerLoan[]>(`/officer/loans${scope}`))
    } catch (error) {
      console.error(error)
      setLoans(null)
    }
  }, [filter, widen])

  useEffect(() => {
    void load()
  }, [load])

  const now = Date.now()
  const rows = Array.isArray(loans)
    ? loans.filter(
        (loan) =>
          hits(
            [loan.user.fullName, loan.user.discordUsername, loan.equipment.name],
            query,
          ) && inWindow(loan, when, now),
      )
    : []

  /**
   * What the due-date box shows: the officer's own edit, then whatever is
   * already on the loan, then the date the member asked for.
   *
   * Starting from the member's date rather than empty is the difference
   * between a field an officer has to think about and one they can glance at.
   * The server would fill the same gap on its own — see `routes/officer/officer.ts` —
   * but a date the officer can see before they click is a date they can
   * disagree with.
   */
  const dueValue = (loan: ApiOfficerLoan) =>
    dueDates[loan.id] ?? dateInputValue(loan.dueAt ?? loan.requestedDueAt)

  const move = (loan: ApiOfficerLoan, status: LoanStatus) => {
    const note = (notes[loan.id] ?? loan.officerNote ?? '').trim()
    const due = loan.status === 'CHECKED_OUT' ? '' : dueValue(loan)

    // End of the chosen day, local — "back by Friday" means Friday, not Friday
    // at midnight when it was still Thursday. Null when the box holds
    // something that is not a date: a date input will accept a five-digit
    // year, and turning that into an instant throws. Refused here with a
    // sentence rather than thrown out of the click handler.
    const dueAt = due ? endOfDay(due) : null

    if (due && dueAt === null) {
      setMessage("That due date isn't a date — check the year.")
      return
    }

    setBusy(true)
    setMessage('')
    patchJson(`/officer/loans/${loan.id}`, {
      status,
      ...(note ? { officerNote: note } : {}),
      ...(dueAt ? { dueAt } : {}),
    })
      .then(load)
      .catch((error: unknown) => {
        setMessage(explain(error))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <FormPanel>
      <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
        BORROWING QUEUE
      </p>

      <div className="mb-3">
        <FilterChips
          options={FILTERS}
          value={filter as (typeof FILTERS)[number]['value']}
          onChange={setFilter}
        />
      </div>

      <div className="mb-3">
        <label htmlFor={`${id}-search`} className="sr-only">
          Search the borrowing queue
        </label>
        <input
          id={`${id}-search`}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
          placeholder="Search — name, Discord handle, item"
          className={fieldClass}
        />
        <p className="text-faint mt-1 text-[12px] leading-[1.5]">
          {filter === ''
            ? 'Searches every loan — asked, out, back or declined.'
            : `Searches ${FILTERS.find((f) => f.value === filter)?.label.toLowerCase()} loans only.`}
        </p>
      </div>

      <div className="mb-4">
        <FilterChips label="WHEN" options={WHENS} value={when} onChange={setWhen} />
      </div>

      {loans === 'loading' && (
        <div aria-busy="true" className="space-y-2.5">
          <div className="bg-base-300 h-4 w-2/3 animate-pulse rounded-[2px]" />
          <div className="bg-base-300 h-3 w-1/2 animate-pulse rounded-[2px]" />
        </div>
      )}

      {loans === null && (
        <p className="text-dim text-sm leading-[1.7]">
          We couldn't load the queue just now.
        </p>
      )}

      {Array.isArray(loans) &&
        (rows.length === 0 ? (
          <p className="text-dim text-sm leading-[1.7]">
            {query.trim() || when !== 'ALL'
              ? 'Nothing matches what you are looking for.'
              : filter === ''
                ? 'Nothing asked for, nothing out.'
                : 'Nothing here.'}
          </p>
        ) : (
          <ul className="divide-rule divide-y">
            {rows.map((loan) => {
              const label = STATUS_LABEL[loan.status]
              const moves = MOVES[loan.status]
              const next = NEXT_STEP[loan.status]

              return (
                <li key={loan.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="text-sm font-semibold">
                      {loan.equipment.name}
                    </span>
                    <span
                      className={`${STATUS_TONE[label.tone]} font-mono text-[10px] font-medium tracking-[0.16em]`}
                    >
                      {label.text}
                    </span>
                  </div>

                  <p className="text-faint mt-0.5 font-mono text-[10px] font-medium tracking-[0.12em] uppercase">
                    {loan.user.fullName}
                    {loan.user.discordUsername && ` · @${loan.user.discordUsername}`}
                    {' · Asked '}
                    {shortDate(loan.requestedAt)}
                    {loan.dueAt && ` · Back by ${shortDate(loan.dueAt)}`}
                  </p>

                  {/* What they asked for, kept beside what they were given.
                      A booking is worth seeing before approving it — the unit
                      comes off the shelf the moment you say yes, whatever
                      date they put on it. */}
                  {(loan.startAt ?? loan.requestedDueAt) && (
                    <p className="text-faint mt-0.5 font-mono text-[10px] font-medium tracking-[0.12em] uppercase">
                      {loan.startAt
                        ? `Wants it ${shortDate(loan.startAt)}`
                        : 'Wants it now'}
                      {loan.requestedDueAt &&
                        ` · Back by ${shortDate(loan.requestedDueAt)}`}
                    </p>
                  )}

                  {/* Which officer decided it. The column has been filled in
                      on every move since this queue was built and nothing
                      showed it — so "who approved this" was a question only
                      answerable from the database. */}
                  {loan.decidedBy && loan.decidedAt && (
                    <p className="text-faint mt-0.5 font-mono text-[10px] font-medium tracking-[0.12em] uppercase">
                      {STATUS_LABEL[loan.status].text} by {loan.decidedBy.fullName} ·{' '}
                      {shortDate(loan.decidedAt)}
                    </p>
                  )}

                  {loan.note && (
                    <p className="text-dim mt-2 text-[13px] leading-[1.5] text-pretty">
                      {loan.note}
                    </p>
                  )}

                  {moves.length === 0 ? (
                    loan.officerNote && (
                      <p className="text-faint mt-2 text-[12px] leading-[1.5]">
                        {loan.officerNote}
                      </p>
                    )
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-2.5">
                      {/* The two boxes stay on their own line above the
                          buttons. They are what an officer *edits*; the
                          buttons are what they *do*, and mixing the two on one
                          row is what made the old text links read as labels. */}
                      {/* Only worth setting while the thing is still going
                          out — a returned loan's due date is history. */}
                      {loan.status !== 'CHECKED_OUT' && (
                        <input
                          type="date"
                          aria-label={`Due date for ${loan.equipment.name}`}
                          value={dueValue(loan)}
                          // No lower bound: an officer back-dating a loan
                          // they forgot to enter is a real thing they do. The
                          // upper one is only a guard against a mistyped year.
                          max={LAST_SENSIBLE_DATE()}
                          onChange={(event) => {
                            setDueDates((current) => ({
                              ...current,
                              [loan.id]: event.target.value,
                            }))
                          }}
                          className={`${fieldClass} h-8 w-40`}
                          disabled={busy}
                        />
                      )}

                      <input
                        value={notes[loan.id] ?? loan.officerNote ?? ''}
                        onChange={(event) => {
                          setNotes((current) => ({
                            ...current,
                            [loan.id]: event.target.value,
                          }))
                        }}
                        maxLength={1000}
                        placeholder="Note back to them (optional)"
                        aria-label={`Note about ${loan.equipment.name}`}
                        className={`${fieldClass} h-8 min-w-44 flex-1`}
                        disabled={busy}
                      />

                      {/* Its own band under a rule, so the controls are not
                          mistaken for more of the form above them. DECLINE is
                          pushed to the far end: it is the one that cannot be
                          walked back, and it should not sit a thumb's width
                          from the one an officer presses all day. */}
                      <div className="border-rule mt-1 flex w-full flex-wrap items-center gap-2.5 border-t pt-3">
                        {moves.map((option) => (
                          <button
                            key={option.status}
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              move(loan, option.status)
                            }}
                            className={`${
                              option.status === 'DENIED'
                                ? `${dangerButton} ml-auto`
                                : option.status === next
                                  ? loudButton
                                  : quietButton
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        ))}

      <p role="status" className="text-error mt-3 min-h-4 text-[12px]">
        {message}
      </p>
    </FormPanel>
  )
}

function Inventory() {
  const id = useId()
  const [items, setItems] = useState<ApiOfficerEquipment[] | null | 'loading'>(
    'loading',
  )
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [stock, setStock] = useState<StockFilter>('ALL')
  const [showAll, setShowAll] = useState(false)
  /** The name box, held here so the duplicate check can watch it being typed. */
  const [name, setName] = useState('')
  /** The item a DELETE is waiting on the officer confirming. */
  const [doomed, setDoomed] = useState<ApiOfficerEquipment | null>(null)

  const load = useCallback(async () => {
    try {
      setItems(await getJson<ApiOfficerEquipment[]>('/officer/equipment'))
    } catch (error) {
      console.error(error)
      setItems(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const listed = (Array.isArray(items) ? items : []).filter((item) =>
    stock === 'ALL'
      ? true
      : stock === 'RETIRED'
        ? !item.active
        : stock === 'OUT'
          ? item.out > 0
          : item.active,
  )
  const { shown, matched, hidden } = narrow(listed, query, showAll)

  /**
   * Whether this name is already on the list, matched as the officer types.
   *
   * The server refuses it either way — and refuses it case-insensitively, which
   * a browser comparing two strings would not — but a 409 arrives *after*
   * somebody has filled in four boxes and pressed the button. What they almost
   * always wanted was to change the number on the row that already exists, and
   * that is a thing to say while the name is still being typed.
   */
  const clash = name.trim()
    ? (listed.find(
        (item) => item.name.toLowerCase() === name.trim().toLowerCase(),
      ) ?? null)
    : null

  const add = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!name.trim() || clash) return

    const form = event.currentTarget
    const data = new FormData(form)
    const quantity = data.get('quantity')
    const maxLoanDays = data.get('maxLoanDays')
    const description = data.get('description')

    const body: NewEquipment = {
      name: name.trim(),
      quantity: Number(quantity) || 1,
      maxLoanDays: Number(maxLoanDays) || 7,
      description:
        typeof description === 'string' && description.trim()
          ? description.trim()
          : null,
    }

    setBusy(true)
    setMessage('')
    postJson('/officer/equipment', body)
      .then(async () => {
        form.reset()
        setName('')
        await load()
      })
      .catch((error: unknown) => {
        setMessage(explain(error))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const patch = (itemId: string, body: Record<string, unknown>) => {
    setBusy(true)
    setMessage('')
    patchJson(`/officer/equipment/${itemId}`, body)
      .then(load)
      .catch((error: unknown) => {
        setMessage(explain(error))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const destroy = (item: ApiOfficerEquipment) => {
    setBusy(true)
    setMessage('')
    deleteJson(`/officer/equipment/${item.id}`)
      .then(async () => {
        setDoomed(null)
        await load()
      })
      .catch((error: unknown) => {
        setDoomed(null)
        setMessage(explain(error))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <FormPanel>
      <p className="text-faint mb-1 font-mono text-[10px] font-medium tracking-[0.16em]">
        THE LENDING LIST
      </p>
      <p className="text-dim mb-4 text-[13px] leading-[1.6] text-pretty">
        <strong className="font-semibold text-base-content">Retiring</strong> takes
        something off the members' list and keeps its borrowing records.{' '}
        <strong className="font-semibold text-base-content">Deleting</strong> removes
        the item and its history for good.
      </p>

      {items === 'loading' && (
        <div aria-busy="true" className="space-y-2.5">
          <div className="bg-base-300 h-4 w-2/3 animate-pulse rounded-[2px]" />
          <div className="bg-base-300 h-3 w-1/2 animate-pulse rounded-[2px]" />
        </div>
      )}

      {items === null && (
        <p className="text-dim text-sm leading-[1.7]">
          We couldn't load the list just now.
        </p>
      )}

      {/* The search is here for the same reason it is on the members' page and
          one more: it is how an officer checks whether the club already lists
          something before adding it a second time. */}
      {Array.isArray(items) && items.length > 0 && (
        <div className="mb-4">
          <label htmlFor={`${id}-find`} className="sr-only">
            Search the lending list
          </label>
          <input
            id={`${id}-find`}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
            placeholder="Search the list — is it already here?"
            className={fieldClass}
            disabled={busy}
          />

          <div className="mt-2">
            <FilterChips
              label="SHOWING"
              options={STOCK}
              value={stock}
              onChange={setStock}
              disabled={busy}
            />
          </div>
        </div>
      )}

      {Array.isArray(items) && items.length > 0 && matched === 0 && (
        <p className="text-dim mb-5 text-sm leading-[1.7]">
          Nothing on the list matches “{query.trim()}”. If it belongs to the
          club, add it below.
        </p>
      )}

      {shown.length > 0 && (
        <ul className="divide-rule mb-5 divide-y">
          {shown.map((item) => (
            <li
              key={item.id}
              className={`flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 ${
                item.active ? '' : 'opacity-50'
              }`}
            >
              <div className="min-w-0 flex-1 basis-40">
                <p className="truncate text-sm font-medium">{item.name}</p>
                <p className="text-faint font-mono text-[10px] font-medium tracking-[0.12em] uppercase">
                  {item.out} of {item.quantity} out · Up to{' '}
                  {capPhrase(item.maxLoanDays)}
                  {!item.active && ' · Retired'}
                </p>
              </div>

              <label className="flex items-center gap-2">
                <span className="text-faint font-mono text-[10px] tracking-[0.14em]">
                  HAVE
                </span>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  aria-label={`How many ${item.name}`}
                  defaultValue={item.quantity}
                  disabled={busy}
                  onBlur={(event) => {
                    const quantity = Number(event.target.value)
                    if (quantity !== item.quantity && quantity >= 0) {
                      patch(item.id, { quantity })
                    }
                  }}
                  className={`${fieldClass} h-8 w-20`}
                />
              </label>

              <label className="flex items-center gap-2">
                <span className="text-faint font-mono text-[10px] tracking-[0.14em]">
                  FOR
                </span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  aria-label={`Longest borrow of ${item.name}, in days`}
                  defaultValue={item.maxLoanDays}
                  disabled={busy}
                  onBlur={(event) => {
                    const maxLoanDays = Number(event.target.value)
                    if (maxLoanDays !== item.maxLoanDays && maxLoanDays >= 1) {
                      patch(item.id, { maxLoanDays })
                    }
                  }}
                  className={`${fieldClass} h-8 w-20`}
                />
                <span className="text-faint font-mono text-[10px] tracking-[0.14em]">
                  DAYS
                </span>
              </label>

              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  patch(item.id, { active: !item.active })
                }}
                className="text-faint hover:text-primary cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50"
              >
                {item.active ? 'RETIRE' : 'BRING BACK'}
              </button>

              {/* Quieter than RETIRE rather than louder, which is the right
                  way round: the reversible move is the one an officer should
                  reach for, and this one only opens a box that explains what
                  it costs. */}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setDoomed(item)
                }}
                className="text-faint hover:text-error cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50"
              >
                DELETE
              </button>
            </li>
          ))}
        </ul>
      )}

      {hidden > 0 && (
        <div className="mb-5">
          <button
            type="button"
            onClick={() => {
              setShowAll(!showAll)
            }}
            className="border-rule text-faint hover:text-primary hover:border-primary cursor-pointer border px-3 py-1.5 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200"
          >
            {showAllLabel(hidden, showAll)}
          </button>
        </div>
      )}

      {/* Every field spelled out above its box rather than hinted at inside
          it. A placeholder disappears the moment somebody types, so a form
          built out of them is one that stops explaining itself exactly when
          it is being filled in — and "1" in an unlabelled box next to a name
          could be a quantity, a shelf number or a price. */}
      <form onSubmit={add} className="space-y-4">
        <p className={labelClass}>ADD SOMETHING TO THE LIST</p>

        <div>
          <label htmlFor={`${id}-name`} className={labelClass}>
            WHAT IT IS
          </label>
          <input
            id={`${id}-name`}
            name="name"
            required
            maxLength={120}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
            }}
            placeholder="Cordless drill"
            className={`${fieldClass} ${clash ? 'border-warning' : ''}`}
            aria-invalid={clash ? true : undefined}
            disabled={busy}
          />
          {clash ? (
            <p role="status" className="text-warning mt-1 text-[12px] leading-[1.5]">
              “{clash.name}” is already on the list, with {clash.quantity} of
              them. Change that row's number instead of adding a second one.
            </p>
          ) : (
            <p className="text-faint mt-1 text-[12px] leading-[1.5]">
              One row per kind of thing, not per unit.
            </p>
          )}
        </div>

        <div className="grid-fluid gap-3 [--col-min:13rem]">
          <div>
            <label htmlFor={`${id}-quantity`} className={labelClass}>
              HOW MANY THE CLUB HAS
            </label>
            <input
              id={`${id}-quantity`}
              name="quantity"
              type="number"
              min={0}
              max={1000}
              defaultValue={1}
              className={fieldClass}
              disabled={busy}
            />
            <p className="text-faint mt-1 text-[12px] leading-[1.5]">
              How many can be out at once.
            </p>
          </div>

          <div>
            <label htmlFor={`${id}-days`} className={labelClass}>
              LONGEST BORROW, IN DAYS
            </label>
            <input
              id={`${id}-days`}
              name="maxLoanDays"
              type="number"
              min={1}
              max={365}
              defaultValue={7}
              className={fieldClass}
              disabled={busy}
            />
            <p className="text-faint mt-1 text-[12px] leading-[1.5]">
              Members cannot ask for longer.
            </p>
          </div>
        </div>

        <div>
          <label htmlFor={`${id}-description`} className={labelClass}>
            ANYTHING WORTH KNOWING (OPTIONAL)
          </label>
          <input
            id={`${id}-description`}
            name="description"
            maxLength={500}
            placeholder="Battery and charger in the case. Lives on the shelf by the door."
            className={fieldClass}
            disabled={busy}
          />
          <p className="text-faint mt-1 text-[12px] leading-[1.5]">
            Shown under the name, and searched.
          </p>
        </div>

        <button
          type="submit"
          disabled={busy || clash !== null}
          className="btn btn-primary btn-cta px-5 py-2.5 text-[12px] font-semibold disabled:opacity-60"
        >
          ADD TO THE LIST
        </button>
      </form>

      <p role="status" className="text-error mt-2 min-h-4 text-[12px]">
        {message}
      </p>

      {/* Named and counted, because "are you sure" is a question nobody has
          ever answered no to. What makes this one land is the history: an
          officer clearing out a typo has nothing to lose and can see that,
          and an officer about to take four years of borrowing with them can
          see that too. */}
      {doomed && (
        <ConfirmDialog
          title={`Delete ${doomed.name}?`}
          confirmLabel="DELETE FOR GOOD"
          busy={busy}
          onConfirm={() => {
            destroy(doomed)
          }}
          onDismiss={() => {
            setDoomed(null)
          }}
        >
          <p>
            This removes it from the database along with{' '}
            {doomed.loanCount === 0
              ? 'the borrowing records it never had'
              : `all ${doomed.loanCount} of its borrowing records`}
            . There is no undo.
          </p>
          <p>
            If the club still owns it,{' '}
            <strong className="font-semibold text-base-content">retire it instead</strong>{' '}
            — that keeps the history.
          </p>
        </ConfirmDialog>
      )}
    </FormPanel>
  )
}
