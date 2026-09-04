import { useCallback, useEffect, useId, useState } from 'react'
import { useOutletContext } from 'react-router'
import { DuesLocked } from '../../components/dashboard/DuesLocked'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { ClaimFree } from '../../components/dashboard/ClaimFree'
import { MembersOnly } from '../../components/dashboard/MembersOnly'
import { accessLock } from '../../lib/dues/dues'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  fieldClass,
  labelClass,
  submitClass,
} from '../../components/shared/formChrome'
import { ApiError, getJson, postJson } from '../../lib/api/api'
import type { ApiEquipment, ApiLoan, LoanStatus } from '../../lib/api/api'
import {
  BOOKING_HORIZON_DAYS,
  addDays,
  capPhrase,
  daysBetween,
  endOfDay,
  startOfDay,
  today,
  windowFault,
} from '../../lib/equipment/borrowing'
import type { WindowFault } from '../../lib/equipment/borrowing'
import { narrow, showAllLabel } from '../../lib/equipment/catalogue'
import { FilterChips } from '../../components/shared/FilterChips'
import { STATUS_TONE, shortDate } from '../../lib/format/formats'
import type { StatusTone } from '../../lib/format/formats'

/**
 * Borrowing club equipment: pick a thing, say what for, wait for an officer.
 *
 * The catalogue is a pick-list rather than a free-text box because the club wanted to know
 * what's actually out and with whom — which needs the item to be a row, not a sentence. An item
 * with nothing free is shown and disabled rather than hidden: "the drill is all out" is the
 * answer to the question, and a missing card just looks like the club has no drill.
 *
 * The card pattern is `PlanPicker`'s — a fieldset of radios where the whole card is the label —
 * because it's the same job.
 */

const STATUS_LABEL: Record<LoanStatus, { text: string; tone: StatusTone }> = {
  REQUESTED: { text: 'WAITING ON AN OFFICER', tone: 'waiting' },
  APPROVED: { text: 'READY TO COLLECT', tone: 'progress' },
  CHECKED_OUT: { text: 'WITH YOU', tone: 'progress' },
  RETURNED: { text: 'RETURNED', tone: 'good' },
  DENIED: { text: 'DECLINED', tone: 'bad' },
  CANCELED: { text: 'CANCELLED', tone: 'neutral' },
}

/** The states where the thing is the member's problem, not the shelf's. */
const OPEN_STATUSES: LoanStatus[] = ['REQUESTED', 'APPROVED', 'CHECKED_OUT']

/**
 * What a card says when the member already has one of these on the go.
 *
 * Three states rather than one, and the distinction is the point: a card reading YOU HAVE ONE
 * over something nobody has approved yet is the site telling somebody they're holding a drill
 * that's still on the shelf.
 */
const MINE_LABEL: Record<'REQUESTED' | 'APPROVED' | 'CHECKED_OUT', string> = {
  REQUESTED: 'REQUESTED',
  APPROVED: 'READY TO COLLECT',
  CHECKED_OUT: 'YOU HAVE ONE',
}

/** Waiting is amber so it can be found; the other two are settled facts. */
const MINE_TONE: Record<'REQUESTED' | 'APPROVED' | 'CHECKED_OUT', string> = {
  REQUESTED: STATUS_TONE.waiting,
  APPROVED: STATUS_TONE.progress,
  CHECKED_OUT: STATUS_TONE.progress,
}

/** Only the three above ever reach a card, but the map has to be total. */
type OpenLoanStatus = keyof typeof MINE_LABEL

/**
 * What the shelf is showing.
 *
 * FREE NOW is the one that earns its place: everything else can be answered by reading, and
 * "what could I actually walk out with today" can't, because an all-out item is deliberately
 * still listed. MINE collects the handful somebody has in flight.
 */
const SHELF = [
  { value: 'ALL', label: 'EVERYTHING' },
  { value: 'FREE', label: 'FREE NOW' },
  { value: 'MINE', label: 'MINE' },
] as const

type ShelfFilter = (typeof SHELF)[number]['value']

/**
 * What to say about a window that won't do, in the page's own voice.
 *
 * The two unreadable cases name the year on purpose. A date box will take a five-digit year
 * without complaint, and somebody who has typed one has almost always mistyped the day and
 * pushed a digit along — telling them the date is "invalid" leaves them staring at a box that
 * looks fine.
 */
function sentenceFor(fault: WindowFault, item: ApiEquipment): string {
  switch (fault) {
    case 'start':
      return "That start date isn't a date — check the year."
    case 'due':
      return "That return date isn't a date — check the year."
    case 'backwards':
      return 'Bring it back after you take it, not before.'
    case 'too-long':
      return `That is longer than ${capPhrase(item.maxLoanDays)}. Ask an officer if you need it for longer.`
  }
}

function explain(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0)
      return "We couldn't reach the server. Try again in a moment."
    if (error.status === 429)
      return "That's a few requests in a row — give it a few minutes."
    if (error.detail) return error.detail
  }
  return "That didn't go through. Try again in a moment."
}

/**
 * The dues gate, split out so the page below it never mounts while locked.
 *
 * A wrapper rather than an early return inside the page: everything under here fetches on mount,
 * and a locked account would fire those requests only to have the server 403 every one into the
 * console.
 *
 * The context is read as nullable for the reason the dues page reads it that way — this page has
 * its own suite that renders it alone. Null means "not locked", and the server actually refuses.
 */
export function EquipmentPage() {
  const dashboard = useOutletContext<DashboardContext | null>()
  const lock = dashboard
    ? accessLock(dashboard.membership, dashboard.user.role)
    : null

  // Three locks, three sentences — see `accessLock` in `lib/dues/dues.ts`. The
  // free one is the state that did not exist before: the club is charging
  // nobody and this person has still not claimed it.
  if (lock === 'claim') {
    return <ClaimFree eyebrow="/ EQUIPMENT" thing="The club's tools" />
  }

  if (lock === 'newcomer') {
    return <MembersOnly eyebrow="/ EQUIPMENT" thing="The club's tools" />
  }

  if (lock === 'dues') return <DuesLocked eyebrow="/ EQUIPMENT" />

  return <EquipmentCatalogue />
}

function EquipmentCatalogue() {
  const [items, setItems] = useState<ApiEquipment[] | null | 'loading'>('loading')
  const [loans, setLoans] = useState<ApiLoan[] | null | 'loading'>('loading')

  const load = useCallback(async () => {
    // Both together: asking for something changes the availability count as
    // well as the list of what you have, and refreshing one without the other
    // shows a page that disagrees with itself.
    const [nextItems, nextLoans] = await Promise.allSettled([
      getJson<ApiEquipment[]>('/equipment'),
      getJson<ApiLoan[]>('/me/loans'),
    ])

    setItems(nextItems.status === 'fulfilled' ? nextItems.value : null)
    setLoans(nextLoans.status === 'fulfilled' ? nextLoans.value : null)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // What you already have on the go, so the catalogue can say where it has got
  // to instead of letting you ask twice and meeting a 409. Keyed by item, and
  // carrying the *status* rather than a boolean, because "waiting on an
  // officer" and "in your bag" are different sentences.
  const openLoans = new Map<string, OpenLoanStatus>(
    Array.isArray(loans)
      ? loans
          .filter((loan) => OPEN_STATUSES.includes(loan.status))
          .map((loan) => [loan.equipment.id, loan.status as OpenLoanStatus])
      : [],
  )

  return (
    <>
      <FormEyebrow>/ EQUIPMENT</FormEyebrow>
      <FormHeading>Borrow something.</FormHeading>

      <p className="text-dim mb-8 max-w-[42rem] text-sm leading-[1.7] text-pretty">
        An officer approves it before anything leaves the lab. The bot
        messages you the day before it's due.
      </p>

      {/* Asking for something and keeping track of what you've got are the two halves of this
          page, and neither waits on the other — so where there's room they sit side by side. The
          catalogue is the taller half by a long way, which is why the columns start at the top
          instead of stretching to match. */}
      <div className="grid-fluid items-start gap-5 [--col-min:32rem]">
        <BorrowForm items={items} openLoans={openLoans} onSent={load} />
        <MyLoans loans={loans} onChange={load} />
      </div>
    </>
  )
}

function BorrowForm({
  items,
  openLoans,
  onSent,
}: {
  items: ApiEquipment[] | null | 'loading'
  openLoans: Map<string, OpenLoanStatus>
  onSent: () => Promise<void>
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [shelf, setShelf] = useState<ShelfFilter>('ALL')
  /** Browsing the whole shelf rather than looking for one thing. */
  const [showAll, setShowAll] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  /** Booking it for later, rather than walking over for it now. */
  const [later, setLater] = useState(false)
  const [startDate, setStartDate] = useState(today)
  const [dueDate, setDueDate] = useState('')
  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'sending' }
    | { status: 'sent' }
    | { status: 'failed'; message: string }
  >({ status: 'idle' })

  if (items === 'loading') {
    return <div aria-busy="true" className="border-rule bg-base-200 h-48 border" />
  }

  if (items === null) {
    return (
      <FormPanel tone="accent">
        <p className="text-dim text-sm leading-[1.7]">
          We couldn't load the equipment list just now. Try again in a moment.
        </p>
      </FormPanel>
    )
  }

  if (items.length === 0) {
    return (
      <FormPanel>
        <p className="text-dim text-sm leading-[1.7] text-pretty">
          Nothing is on the lending list yet.
        </p>
      </FormPanel>
    )
  }

  const chosen = items.find((item) => item.id === picked) ?? null
  const from = later ? startDate : today()

  /**
   * What's wrong with the window, checked here so the form can say so before the server does. The
   * judging is `lib/equipment/borrowing.ts`'s precisely so the two answers can't drift — a form
   * that offers a window the desk then refuses is worse than one that never offered it.
   *
   * An empty return date isn't a fault, so the panel doesn't open in red.
   */
  const fault: WindowFault | null = chosen
    ? windowFault(from, dueDate, chosen.maxLoanDays)
    : null

  // Five at a time until asked otherwise, searched first — see `lib/catalogue`.
  const onShelf = items.filter((item) =>
    shelf === 'ALL'
      ? true
      : shelf === 'MINE'
        ? openLoans.has(item.id)
        : item.available > 0 && !openLoans.has(item.id),
  )
  const { shown, matched, hidden } = narrow(onShelf, query, showAll)

  const pick = (item: ApiEquipment) => {
    setPicked(item.id)
    // The club's default made visible: the longest this one goes out for.
    // Somebody wanting it back sooner moves the date, which is the easier
    // edit of the two.
    setDueDate(addDays(later ? startDate : today(), item.maxLoanDays))
  }

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!chosen) {
      setState({ status: 'failed', message: 'Pick what you need first.' })
      return
    }
    if (!dueDate) {
      setState({ status: 'failed', message: 'Say when you will bring it back.' })
      return
    }
    if (fault) {
      setState({ status: 'failed', message: sentenceFor(fault, chosen) })
      return
    }

    /**
     * Converted before anything is sent, and both ends checked.
     *
     * `fault` has already said these are dates, so neither can be null here — but the whole reason
     * this page needed hardening is that a date box can hand you something `Date` refuses, and a
     * second reader turning it into a `RangeError` mid-submit is exactly the failure being
     * designed out.
     */
    const startAt = later ? startOfDay(startDate) : null
    const requestedDueAt = endOfDay(dueDate)

    if (requestedDueAt === null || (later && startAt === null)) {
      setState({ status: 'failed', message: sentenceFor('due', chosen) })
      return
    }

    const form = event.currentTarget
    const note = new FormData(form).get('note')

    setState({ status: 'sending' })
    postJson(`/equipment/${chosen.id}/loans`, {
      note: typeof note === 'string' && note.trim() ? note.trim() : null,
      startAt,
      requestedDueAt,
    })
      .then(async () => {
        form.reset()
        setPicked(null)
        setLater(false)
        setStartDate(today())
        setDueDate('')
        setState({ status: 'sent' })
        await onSent()
      })
      .catch((error: unknown) => {
        setState({ status: 'failed', message: explain(error) })
      })
  }

  const sending = state.status === 'sending'

  return (
    <form onSubmit={submit}>
      <div className="mb-4">
        <label htmlFor={`${id}-search`} className="sr-only">
          Search the lending list
        </label>
        <input
          id={`${id}-search`}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
          placeholder="Search — drill, calipers, soldering…"
          className={fieldClass}
          disabled={sending}
        />

        <div className="mt-2">
          <FilterChips
            label="SHOWING"
            options={SHELF}
            value={shelf}
            onChange={setShelf}
            disabled={sending}
          />
        </div>
      </div>

      {matched === 0 && (
        <p className="text-dim mb-4 text-sm leading-[1.7]">
          {query.trim()
            ? `Nothing on the list matches “${query.trim()}”.`
            : shelf === 'MINE'
              ? "You have nothing borrowed or on the way."
              : 'Everything is out at the moment.'}
        </p>
      )}

      <fieldset className="grid-fluid gap-4 [--col-min:15rem]" disabled={sending}>
        <legend className="sr-only">What to borrow</legend>

        {shown.map((item) => {
          const mine = openLoans.get(item.id) ?? null
          const none = item.available === 0
          const unavailable = mine !== null || none

          return (
            <label
              key={item.id}
              className={`block cursor-pointer border p-4 transition-colors duration-200 ${
                picked === item.id
                  ? 'border-primary bg-primary/5'
                  : 'border-rule bg-base-200 hover:border-base-content/25'
              } ${unavailable ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <input
                type="radio"
                name="equipment"
                value={item.id}
                checked={picked === item.id}
                disabled={unavailable}
                onChange={() => {
                  pick(item)
                }}
                className="sr-only"
              />

              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold">{item.name}</span>
                {/* The card's own state, and it has to be the member's before
                    it is the shelf's: "all out" is true of a drill they are
                    themselves waiting on, and reading it there sends them to
                    an officer about a queue they are already in. */}
                <span
                  className={`font-mono text-[10px] font-medium tracking-[0.14em] ${
                    mine ? MINE_TONE[mine] : none ? 'text-faint' : 'text-primary'
                  }`}
                >
                  {mine
                    ? MINE_LABEL[mine]
                    : none
                      ? 'ALL OUT'
                      : `${item.available} OF ${item.quantity} FREE`}
                </span>
              </div>

              {item.description && (
                <p className="text-dim mt-1.5 text-[13px] leading-[1.5] text-pretty">
                  {item.description}
                </p>
              )}

              <p className="text-faint mt-1.5 font-mono text-[10px] font-medium tracking-[0.12em] uppercase">
                Up to {capPhrase(item.maxLoanDays)} at a time
              </p>
            </label>
          )
        })}
      </fieldset>

      {/* The list opens cut, and says so. A list that quietly stops at five
          looks like the whole shelf, which is how somebody concludes the club
          has no calipers and asks an officer to buy some. */}
      {hidden > 0 && (
        <div className="mt-4">
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

      {chosen && (
        <div className="mt-5">
          <BorrowWindow
            id={id}
            item={chosen}
            later={later}
            startDate={startDate}
            dueDate={dueDate}
            disabled={sending}
            onLater={(next) => {
              setLater(next)
              // The window moves with the start date, so the return date has
              // to follow it — a booking three weeks out with last week's
              // return date on it is nonsense the member never typed.
              const nextFrom = next ? startDate : today()
              setStartDate(nextFrom)
              setDueDate(addDays(nextFrom, chosen.maxLoanDays))
            }}
            onStart={(value) => {
              setStartDate(value)
              // Pushed along only when the start has genuinely passed the return date. Counted in
              // days rather than compared as strings: two values of different widths sort in the
              // wrong order, the same trap the year check exists for. An unreadable start answers
              // null and moves nothing.
              const gap = daysBetween(value, dueDate)
              if (gap !== null && gap < 0) {
                setDueDate(addDays(value, chosen.maxLoanDays))
              }
            }}
            onDue={setDueDate}
            problem={fault && sentenceFor(fault, chosen)}
          />
        </div>
      )}

      <div className="mt-5">
        <label htmlFor={`${id}-note`} className="sr-only">
          What you need it for
        </label>
        <textarea
          id={`${id}-note`}
          name="note"
          rows={2}
          maxLength={500}
          disabled={sending}
          placeholder="What you need it for."
          className="textarea border-rule bg-base-200 w-full text-sm"
        />
      </div>

      <div className="mt-4">
        <button type="submit" disabled={sending} className={submitClass}>
          {sending ? 'ASKING…' : 'ASK TO BORROW'}
        </button>
      </div>

      <p role="status" className="mt-3 min-h-5 text-[13px] leading-[1.5]">
        {state.status === 'failed' && (
          <span className="text-error">{state.message}</span>
        )}
        {state.status === 'sent' && (
          <span className="text-success">
            Asked. Watch for it below.
          </span>
        )}
      </p>
    </form>
  )
}

/**
 * When they want it and when it comes back.
 *
 * Two questions rather than one, because they're two different situations and a single "how long
 * for" box can't tell them apart: somebody in the lab now wants a return date, and somebody
 * booking the good soldering station for competition week wants both ends.
 *
 * Both boxes are `type="date"`, so what a member gets is whatever calendar their browser draws —
 * the one they already know, localised, and keyboard- and screen-reader-friendly without any of
 * it being this file's problem.
 */
function BorrowWindow({
  id,
  item,
  later,
  startDate,
  dueDate,
  disabled,
  problem,
  onLater,
  onStart,
  onDue,
}: {
  id: string
  item: ApiEquipment
  later: boolean
  startDate: string
  dueDate: string
  disabled: boolean
  problem: string | null
  onLater: (later: boolean) => void
  onStart: (value: string) => void
  onDue: (value: string) => void
}) {
  const when = today()

  /**
   * Bounds on the boxes themselves, so the browser refuses most of this before any of our code
   * runs — the picker won't scroll past them, and a typed value outside them makes the input
   * `:invalid`. Belt to the braces in `windowFault`, which is what actually gates the send.
   *
   * `addDays` returns empty for a value it can't read, and an empty `min` or `max` is simply no
   * bound — so a broken start date loosens the return box rather than pinning it to nonsense.
   */
  const horizon = addDays(when, BOOKING_HORIZON_DAYS)
  const from = later ? startDate : when
  const latestReturn = addDays(from, item.maxLoanDays)

  return (
    <FormPanel>
      <p className="text-faint mb-1 font-mono text-[10px] font-medium tracking-[0.16em]">
        WHEN YOU NEED IT
      </p>
      <p className="text-dim mb-4 text-[13px] leading-[1.6] text-pretty">
        {item.name} goes out for up to {capPhrase(item.maxLoanDays)} at a time.
      </p>

      <fieldset className="grid-fluid mb-4 gap-3 [--col-min:15rem]" disabled={disabled}>
        <legend className="sr-only">When you want it</legend>

        {[
          { value: false, label: 'I need it now', hint: 'Collect it once an officer approves.' },
          { value: true, label: 'Reserve it for later', hint: 'Hold it for a date coming up.' },
        ].map((option) => (
          <label
            key={String(option.value)}
            className={`block cursor-pointer border p-3 transition-colors duration-200 ${
              later === option.value
                ? 'border-primary bg-primary/5'
                : 'border-rule bg-base-200 hover:border-base-content/25'
            }`}
          >
            <input
              type="radio"
              name="when"
              checked={later === option.value}
              onChange={() => {
                onLater(option.value)
              }}
              className="sr-only"
            />
            <span className="block text-sm font-semibold">{option.label}</span>
            <span className="text-dim mt-0.5 block text-[12px] leading-[1.5]">
              {option.hint}
            </span>
          </label>
        ))}
      </fieldset>

      <div className="grid-fluid gap-3 [--col-min:13rem]">
        {later && (
          <div>
            <label htmlFor={`${id}-start`} className={labelClass}>
              TAKING IT FROM
            </label>
            <input
              id={`${id}-start`}
              type="date"
              value={startDate}
              min={when}
              max={horizon}
              disabled={disabled}
              onChange={(event) => {
                onStart(event.target.value)
              }}
              className={fieldClass}
            />
          </div>
        )}

        <div>
          <label htmlFor={`${id}-due`} className={labelClass}>
            BRINGING IT BACK BY
          </label>
          <input
            id={`${id}-due`}
            type="date"
            value={dueDate}
            min={from}
            max={latestReturn}
            disabled={disabled}
            onChange={(event) => {
              onDue(event.target.value)
            }}
            className={fieldClass}
          />
        </div>
      </div>

      <p role="status" className="text-error mt-2 min-h-4 text-[12px] leading-[1.5]">
        {problem}
      </p>
    </FormPanel>
  )
}

function MyLoans({
  loans,
  onChange,
}: {
  loans: ApiLoan[] | null | 'loading'
  onChange: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const cancel = (loan: ApiLoan) => {
    if (!window.confirm(`Cancel your request for ${loan.equipment.name}?`)) return

    setBusy(true)
    setMessage('')
    postJson(`/equipment/loans/${loan.id}/cancel`, {})
      .then(onChange)
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
        MY BORROWING
      </p>

      {loans === 'loading' && (
        <div aria-busy="true" className="space-y-2.5">
          <div className="bg-base-300 h-4 w-2/3 animate-pulse rounded-[2px]" />
          <div className="bg-base-300 h-3 w-1/2 animate-pulse rounded-[2px]" />
        </div>
      )}

      {loans === null && (
        <p className="text-dim text-sm leading-[1.7]">
          We couldn't load your borrowing just now.
        </p>
      )}

      {Array.isArray(loans) &&
        (loans.length === 0 ? (
          <p className="text-dim text-sm leading-[1.7]">
            You haven't borrowed anything yet.
          </p>
        ) : (
          <ul className="divide-rule divide-y">
            {loans.map((loan) => {
              const label = STATUS_LABEL[loan.status]
              return (
                <li key={loan.id} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="text-sm font-medium">
                      {loan.equipment.name}
                    </span>
                    <span
                      className={`${STATUS_TONE[label.tone]} font-mono text-[10px] font-medium tracking-[0.16em]`}
                    >
                      {label.text}
                    </span>
                  </div>

                  {/* `text-dim`, not `text-faint`. Dates are the thing being
                      scanned for on this list, not a label on it — and the
                      quietest ink on the page at ten pixels of uppercase mono
                      is the hardest reading here. */}
                  <p className="text-dim mt-0.5 font-mono text-[10px] font-medium tracking-[0.12em] uppercase">
                    Asked {shortDate(loan.requestedAt)}
                    {loan.startAt && ` · From ${shortDate(loan.startAt)}`}
                    {/* The officer's date once there is one, and until then
                        the member's own — so an ask that has not been looked
                        at yet still shows the date they put on it. */}
                    {loan.dueAt
                      ? ` · Back by ${shortDate(loan.dueAt)}`
                      : loan.requestedDueAt &&
                        ` · Asked to keep it until ${shortDate(loan.requestedDueAt)}`}
                  </p>

                  {loan.officerNote && (
                    <p className="border-primary/35 text-dim mt-2 border-l-2 pl-3 text-[13px] leading-[1.5] text-pretty">
                      {loan.officerNote}
                    </p>
                  )}

                  {loan.status === 'REQUESTED' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        cancel(loan)
                      }}
                      // Red before it is hovered, not on the way to being
                      // pressed. It is the only irreversible thing on this
                      // page, and a control that looks inert until the pointer
                      // is already on it is one somebody finds by accident.
                      className="border-error/40 text-error hover:border-error hover:bg-error/10 mt-2.5 cursor-pointer border px-3 py-1.5 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50"
                    >
                      CANCEL THIS REQUEST
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        ))}

      <p role="status" className="text-error mt-2 min-h-4 text-[12px]">
        {message}
      </p>
    </FormPanel>
  )
}
