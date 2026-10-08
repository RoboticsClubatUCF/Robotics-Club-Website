import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useOutletContext } from 'react-router'
import { DuesLocked } from '../../components/dashboard/DuesLocked'
import { ClaimFree } from '../../components/dashboard/ClaimFree'
import { MembersOnly } from '../../components/dashboard/MembersOnly'
import { ConfirmDialog } from '../../components/shared/ConfirmDialog'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { accessLock } from '../../lib/dues/dues'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  fieldClass,
  labelClass,
  secondaryClass,
  submitClass,
} from '../../components/shared/formChrome'
import { ApiError, deleteJson, getJson, postForm, postJson } from '../../lib/api/api'
import type {
  ApiDraftSummary,
  ApiMyProject,
  ApiPrintAllowance,
  ApiPrintRequest,
  PrintRequestStatus,
} from '../../lib/api/api'
import { STATUS_TONE, fileSize, shortDate } from '../../lib/format/formats'
import type { StatusTone } from '../../lib/format/formats'
import {
  MAX_QUANTITY,
  actualSettings,
  grams,
  materialsFor,
  plateCount,
  settingsLine,
  slicedLine,
} from '../../lib/printing'
import { chargedGrams, duration } from '../../lib/slicer/estimate'

/**
 * 3D printing: filament plates you slice yourself, resin prints an officer slices, and the list of
 * what you've asked for.
 *
 * Filament goes through the slicer (`/dashboard/print/slicer`), so this page offers it and lists
 * the drafts waiting there; the form below takes resin only. Three club rules shape the rest.
 *
 * The file rule: the printers take STL and STEP and nothing else, so the file input says so, this
 * page checks it before uploading, and the server checks the bytes themselves — an extension is a
 * claim, not evidence.
 *
 * The storage rule: a finished job's file is deleted, which is why a settled row shows its name
 * and size but no download.
 *
 * The budget rule: a personal print comes out of 500 g a term, and a print for a project comes
 * out of nothing at all. That's why the project field is on the form rather than in the notes —
 * it isn't a label, it decides who pays for the plastic.
 */

/** What the form will attach. The server re-checks all of it. */
const ACCEPTED = ['.stl', '.step', '.stp']

const STATUS_LABEL: Record<PrintRequestStatus, { text: string; tone: StatusTone }> = {
  PENDING: { text: 'WAITING', tone: 'neutral' },
  PRINTING: { text: 'PRINTING', tone: 'progress' },
  DONE: { text: 'DONE', tone: 'good' },
  REJECTED: { text: 'DECLINED', tone: 'bad' },
}

type FormState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'sent' }
  | { status: 'failed'; message: string }

function explain(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0)
      return "We couldn't reach the server. Try again in a moment."
    if (error.status === 413)
      return 'That file is too big to upload. Ask an officer about large prints.'
    if (error.status === 429)
      return "That's a few requests in a row — give it a few minutes."
    if (error.detail) return error.detail
  }
  return "The upload didn't go through. Try again in a moment."
}

/**
 * The dues gate, split out so the page below it never mounts while locked.
 *
 * A wrapper rather than an early return inside the page: everything under here fetches on mount,
 * and a locked account would fire those requests only to have the server 403 every one into the
 * console.
 *
 * The context is read as nullable for the reason the dues page reads it that way — this page has
 * its own suite that renders it alone. Null means "not locked".
 */
export function PrintRequestPage() {
  const dashboard = useOutletContext<DashboardContext | null>()
  const lock = dashboard
    ? accessLock(dashboard.membership, dashboard.user.role)
    : null

  // Three locks, three sentences — see `accessLock` in `lib/dues/dues.ts`. The
  // free one is the state that did not exist before: the club is charging
  // nobody and this person has still not claimed it.
  if (lock === 'claim') {
    return <ClaimFree eyebrow="/ 3D PRINTING" thing="The printers" />
  }

  if (lock === 'newcomer') {
    return <MembersOnly eyebrow="/ 3D PRINTING" thing="The printers" />
  }

  if (lock === 'dues') return <DuesLocked eyebrow="/ 3D PRINTING" />

  return (
    <PrintRequestForm
      projects={dashboard?.projects}
      // Unknown until the standing loads, and unknown locks nothing, as with dues.
      trained={dashboard?.membership.status !== 'ready' || dashboard.membership.data.slicerTrained}
    />
  )
}

function PrintRequestForm({
  projects,
  trained,
}: {
  projects: DashboardContext['projects'] | undefined
  trained: boolean
}) {
  const [requests, setRequests] = useState<ApiPrintRequest[] | null | 'loading'>(
    'loading',
  )
  const [allowance, setAllowance] = useState<ApiPrintAllowance | null>(null)
  const [drafts, setDrafts] = useState<ApiDraftSummary[] | null | 'loading'>('loading')
  // A plate just sent from the slicer, named on arrival.
  const sent = (useLocation().state as { sent?: string } | null)?.sent

  const load = useCallback(async () => {
    // Settled together: submitting a print changes the list, and settling one
    // changes the balance, so a page that reloaded only the list would show a
    // finished job beside a balance that had not noticed it.
    const [list, balance, mine] = await Promise.allSettled([
      getJson<ApiPrintRequest[]>('/me/print-requests'),
      getJson<ApiPrintAllowance>('/me/print-allowance'),
      getJson<ApiDraftSummary[]>('/print/drafts'),
    ])

    if (mine.status === 'fulfilled') {
      setDrafts(mine.value)
    } else {
      console.error(mine.reason)
      setDrafts(null)
    }

    if (list.status === 'fulfilled') {
      setRequests(list.value)
    } else {
      console.error(list.reason)
      setRequests(null)
    }

    // Left as it was on failure rather than blanked: a stale balance is closer
    // to the truth than no balance, and the list beside it will have said
    // something went wrong.
    if (balance.status === 'fulfilled') setAllowance(balance.value)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const mine = projects?.status === 'ready' ? projects.data : []

  return (
    <>
      <FormEyebrow>/ 3D PRINTING</FormEyebrow>
      <FormHeading>Ask for a print.</FormHeading>

      <p className="text-dim mb-6 max-w-[42rem] text-sm leading-[1.7] text-pretty">
        Slice filament prints yourself and an officer prints the file. Resin
        prints an officer slices for you. Ask early — the club's projects are
        printing too.
      </p>

      {sent && (
        <p role="status" className="text-success mb-5 text-sm">
          Sent {sent}. It's in your list.
        </p>
      )}

      {/* Two halves wherever there's room: what you're asking for on one side, what you've already
          asked for on the other. They're the two things somebody opens this page to do and neither
          follows from the other, so stacking them only ever meant scrolling past a form to check
          on a print. The allowance stays with the form — it decides the infill you type into it.

          `--col-min` is set well above the width either half needs, so a laptop keeps the single
          column: two 30rem columns of dense form is worse than one 60rem one. */}
      <div className="grid-fluid items-start gap-5 [--col-min:32rem]">
        <div className="space-y-5">
          <Allowance allowance={allowance} />
          <Filament drafts={drafts} reload={load} trained={trained} />
          <RequestForm projects={mine} onSent={load} />
        </div>

        <MyRequests requests={requests} reload={load} trained={trained} />
      </div>
    </>
  )
}

/**
 * The balance, and the two sentences that stop it being a surprise.
 *
 * Above the form rather than beside the submit button, because it changes what somebody chooses —
 * 40% infill on a big part is a different decision when there are 80 g left. The bar is the same
 * information as the numbers and is there for the glance.
 */
function Allowance({ allowance }: { allowance: ApiPrintAllowance | null }) {
  if (!allowance) return null

  const { usedGrams, limitGrams, remainingGrams } = allowance
  const over = remainingGrams < 0
  // Clamped for the bar only — a negative width is not a thing, and the
  // numbers below say what actually happened.
  const filled = Math.min(100, Math.max(0, (usedGrams / limitGrams) * 100))

  return (
    <FormPanel tone={over ? 'accent' : 'plain'}>
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-faint font-mono text-[10px] font-medium tracking-[0.16em]">
          MY MATERIAL THIS SEMESTER
        </p>
        <p
          className={`font-mono text-[10px] font-medium tracking-[0.16em] ${
            over ? 'text-error' : 'text-dim'
          }`}
        >
          {grams(usedGrams)} OF {grams(limitGrams)} USED
        </p>
      </div>

      <div
        role="progressbar"
        aria-valuenow={usedGrams}
        aria-valuemin={0}
        aria-valuemax={limitGrams}
        aria-label="Material used this semester"
        className="bg-base-300 mb-3 h-1.5 w-full overflow-hidden rounded-[2px]"
      >
        <div
          className={`h-full ${over ? 'bg-error' : 'bg-primary'}`}
          style={{ width: `${String(filled)}%` }}
        />
      </div>

      <p className="text-dim text-[13px] leading-[1.6] text-pretty">
        {over ? (
          <>
            You are{' '}
            <strong className="text-base-content">{grams(-remainingGrams)}</strong> past
            your allowance for the semester. It resets with the next one.
          </>
        ) : (
          <>
            <strong className="text-base-content">{grams(remainingGrams)}</strong> left
            for your own prints. Resets each semester.
          </>
        )}{' '}
        Prints for a club project do not come out of this.
      </p>
    </FormPanel>
  )
}

/** "in 2 days", "in 5 hours", "within the hour". */
function expiresIn(iso: string, now: number = Date.now()): string {
  const hours = (new Date(iso).getTime() - now) / 3_600_000
  if (hours < 1) return 'within the hour'
  if (hours < 48) return `in ${String(Math.round(hours))} hours`
  return `in ${String(Math.round(hours / 24))} days`
}

const SLICE_STATE: Record<NonNullable<ApiDraftSummary['sliceState']> | 'NONE', string> = {
  NONE: 'Not sliced',
  QUEUED: 'Waiting to slice',
  RUNNING: 'Slicing',
  READY: 'Sliced',
  FAILED: "Couldn't slice",
}

/**
 * Filament: the way into the slicer, and the plates already started there.
 *
 * A draft is only its owner's until it's sent, and it goes on its own if left alone, so each
 * one says when.
 */
function Filament({
  drafts,
  reload,
  trained,
}: {
  drafts: ApiDraftSummary[] | null | 'loading'
  reload: () => Promise<void>
  /** The slicer needs its training first; until then this offers the training instead. */
  trained: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [discarding, setDiscarding] = useState<ApiDraftSummary | null>(null)

  const discard = (draft: ApiDraftSummary) => {
    setBusy(true)
    setMessage('')
    deleteJson(`/print/drafts/${draft.id}`)
      .then(reload)
      .catch((error: unknown) => {
        setMessage(explain(error))
      })
      .finally(() => {
        setBusy(false)
        setDiscarding(null)
      })
  }

  return (
    <FormPanel>
      <p className="text-faint mb-2 font-mono text-[10px] font-medium tracking-[0.16em]">
        FILAMENT — SLICE IT YOURSELF
      </p>
      {trained ? (
        <>
          <p className="text-dim mb-4 text-[13px] leading-[1.6] text-pretty">
            Put your models on the plate, choose PLA or PETG and how it prints, and slice it. The
            officer prints the file you sliced.
          </p>
          <Link to="/dashboard/print/slicer" className={`${submitClass} inline-flex items-center justify-center`}>
            OPEN THE SLICER
          </Link>
        </>
      ) : (
        <>
          <p className="text-dim mb-4 text-[13px] leading-[1.6] text-pretty">
            You slice filament prints yourself. The slicer opens once you&rsquo;ve done its
            training.
          </p>
          <Link to="/dashboard/profile/training" className={`${submitClass} inline-flex items-center justify-center`}>
            START THE SLICER TRAINING
          </Link>
        </>
      )}

      {drafts === 'loading' && (
        <div aria-busy="true" className="mt-5 space-y-2">
          <div className="bg-base-300 h-4 w-1/2 animate-pulse rounded-[2px]" />
        </div>
      )}
      {drafts === null && (
        <p className="text-dim mt-5 text-[13px] leading-[1.6]">
          We couldn't load your drafts just now.
        </p>
      )}
      {Array.isArray(drafts) && drafts.length > 0 && (
        <div className="mt-5">
          <p className="text-faint mb-1 font-mono text-[10px] font-medium tracking-[0.16em]">
            MY DRAFTS
          </p>
          <ul className="divide-rule divide-y">
            {drafts.map((draft) => (
              <li key={draft.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {draft.fileName}
                    {plateCount(draft) && (
                      <span className="text-primary ml-2 font-mono text-[11px] font-semibold">
                        {plateCount(draft)}
                      </span>
                    )}
                  </span>
                  <span className="text-faint block font-mono text-[10px] tracking-[0.12em] uppercase">
                    {draft.slicedWith.filament} · {draft.slicedWith.process} ·{' '}
                    {draft.missing ? (
                      <span className="text-warning">PICK A {draft.missing.toUpperCase()}</span>
                    ) : (
                      SLICE_STATE[draft.sliceState ?? 'NONE']
                    )}{' '}
                    · Goes{' '}
                    {expiresIn(draft.expiresAt)}
                  </span>
                </span>
                <span className="flex gap-4">
                  {trained && (
                    <Link
                      to={`/dashboard/print/slicer/${draft.id}`}
                      className="text-primary hover:text-base-content -mx-2 inline-flex min-h-11 items-center px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary wide:min-h-6 font-mono text-[10px] font-semibold tracking-[0.14em]"
                    >
                      OPEN
                    </Link>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setDiscarding(draft)
                    }}
                    className="text-faint hover:text-error -mx-2 inline-flex min-h-11 items-center px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary wide:min-h-6 cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50"
                  >
                    DISCARD
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {message && (
        <p role="status" className="text-error mt-2 text-[12px]">
          {message}
        </p>
      )}

      {discarding && (
        <ConfirmDialog
          title={`Discard ${discarding.fileName}?`}
          confirmLabel="DISCARD IT"
          busy={busy}
          onConfirm={() => {
            discard(discarding)
          }}
          onDismiss={() => {
            setDiscarding(null)
          }}
        >
          <p>The plate and every model on it are deleted. This can't be undone.</p>
        </ConfirmDialog>
      )}
    </FormPanel>
  )
}

/** The resin form. Filament goes through the slicer above. */
function RequestForm({
  projects,
  onSent,
}: {
  projects: ApiMyProject[]
  onSent: () => Promise<void>
}) {
  const id = useId()
  const [state, setState] = useState<FormState>({ status: 'idle' })
  // The file comes off the input rather than out of `new FormData(form)`, unlike every other form
  // here. The body is built by hand anyway so the request says exactly what it sends, and a file
  // input needs its `value` cleared explicitly — `form.reset()` alone leaves the filename sitting
  // under a form that has already been sent.
  const fileInput = useRef<HTMLInputElement>(null)
  const resin = materialsFor('SLA')[0]!

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const file = fileInput.current?.files?.[0]

    if (!file) {
      setState({ status: 'failed', message: 'Choose the model file first.' })
      return
    }

    // Checked here as well as on the server, because a wrong file should say
    // so instantly rather than after uploading thirty megabytes.
    const name = file.name.toLowerCase()
    if (!ACCEPTED.some((extension) => name.endsWith(extension))) {
      setState({
        status: 'failed',
        message: `The printers take ${ACCEPTED.join(', ')} files. That one is something else.`,
      })
      return
    }

    const fields = new FormData(form)
    const body = new FormData()
    body.append('file', file)
    body.append('process', 'SLA')
    body.append('material', resin.value)
    for (const key of ['quantity', 'projectId', 'notes']) {
      const value = fields.get(key)
      if (typeof value === 'string' && value.trim()) body.append(key, value.trim())
    }

    setState({ status: 'sending' })
    postForm<ApiPrintRequest>('/print', body)
      .then(async () => {
        form.reset()
        if (fileInput.current) fileInput.current.value = ''
        setState({ status: 'sent' })
        await onSent()
      })
      .catch((error: unknown) => {
        setState({ status: 'failed', message: explain(error) })
      })
  }

  const sending = state.status === 'sending'
  const select = 'select border-rule bg-base-200 w-full text-sm'

  return (
    <FormPanel>
      <form onSubmit={submit}>
        <p className="text-faint mb-2 font-mono text-[10px] font-medium tracking-[0.16em]">
          RESIN — AN OFFICER SLICES IT
        </p>
        <p className="text-dim mb-5 text-[13px] leading-[1.6] text-pretty">
          Fine detail and smooth faces, in {resin.label}. Slower, and worth it for small parts.
        </p>

        <div className="mb-5">
          <label htmlFor={`${id}-file`} className={labelClass}>
            THE MODEL — STL OR STEP
          </label>
          <input
            id={`${id}-file`}
            ref={fileInput}
            name="file"
            type="file"
            required
            accept={ACCEPTED.join(',')}
            disabled={sending}
            className="file-input border-rule bg-base-200 w-full text-sm"
          />
        </div>

        {/* Its own field rather than a sentence in the notes, because it is
            the one thing in there an officer has to act on — they slice four
            of something differently from one. */}
        <div className="mb-5">
          <label htmlFor={`${id}-quantity`} className={labelClass}>
            HOW MANY
          </label>
          <input
            id={`${id}-quantity`}
            name="quantity"
            type="number"
            min={1}
            max={MAX_QUANTITY}
            step={1}
            inputMode="numeric"
            defaultValue={1}
            disabled={sending}
            className={`${fieldClass} text-sm`}
          />
          <p className="text-faint mt-1.5 text-[12px] leading-[1.5]">
            Up to {MAX_QUANTITY}. More than that, ask an officer first.
          </p>
        </div>

        {/* On its own line: this is the field that decides whether the print
            costs anybody anything, and its helper sentence is the one worth
            having room for. */}
        <div className="mb-5">
          <label htmlFor={`${id}-project`} className={labelClass}>
            WHAT IT IS FOR
          </label>
          <select
            id={`${id}-project`}
            name="projectId"
            defaultValue=""
            disabled={sending}
            className={select}
          >
            <option value="">Personal print</option>
            {projects.map((membership) => (
              <option key={membership.project.id} value={membership.project.id}>
                {membership.project.title}
              </option>
            ))}
          </select>
          <p className="text-faint mt-1.5 text-[12px] leading-[1.5]">
            {projects.length === 0
              ? 'Join a project and it appears here.'
              : 'A project print is not counted against your allowance.'}
          </p>
        </div>

        <div className="mb-5">
          <label htmlFor={`${id}-notes`} className={labelClass}>
            SPECIAL REQUESTS
          </label>
          <textarea
            id={`${id}-notes`}
            name="notes"
            rows={2}
            maxLength={1000}
            disabled={sending}
            placeholder="Hollow it if you can. Supports off the front face."
            className="textarea border-rule bg-base-200 w-full text-sm"
          />
        </div>

        {/* Outlined: OPEN THE SLICER above is the page's one gold action, and filament is
            most of what the club prints. */}
        <button type="submit" disabled={sending} className={`${secondaryClass} w-full`}>
          {sending ? 'SENDING…' : 'SEND THE REQUEST'}
        </button>

        <p role="status" className="mt-3 min-h-5 text-[13px] leading-[1.5]">
          {state.status === 'failed' && (
            <span className="text-error">{state.message}</span>
          )}
          {state.status === 'sent' && (
            <span className="text-success">
              Sent. It's in your list.
            </span>
          )}
        </p>

        <Conduct />
      </form>
    </FormPanel>
  )
}

/**
 * What the printers are for, said before somebody uploads rather than after.
 *
 * The club asked for a notice about inappropriate prints. It sits at the foot of the form in the
 * quiet type rather than in a warning box at the top: a page that opens by accusing its reader of
 * something reads badly to the hundred people who were only ever going to print a bracket.
 */
function Conduct() {
  return (
    <p className="text-faint mt-5 border-t border-base-content/8 pt-4 text-[12px] leading-[1.6] text-pretty">
      Officers decline anything against club or university rules — weapons
      and weapon parts, anything meant to hurt somebody, anything you'd be
      printing to sell. A declined print costs nothing off your allowance.
    </p>
  )
}

function MyRequests({
  requests,
  reload,
  trained,
}: {
  requests: ApiPrintRequest[] | null | 'loading'
  reload: () => Promise<void>
  /** EDIT takes a plate back to the slicer, so it waits for the training too. */
  trained: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [asking, setAsking] = useState<{ act: 'edit' | 'withdraw'; request: ApiPrintRequest } | null>(
    null,
  )
  const navigate = useNavigate()

  const edit = (request: ApiPrintRequest) => {
    setBusy(true)
    setMessage('')
    postJson(`/print/${request.id}/unsubmit`, {})
      .then(() =>
        navigate(`/dashboard/print/slicer/${request.id}`, { state: { unsubmitted: true } }),
      )
      .catch(async (error: unknown) => {
        setMessage(explain(error))
        setAsking(null)
        await reload()
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const withdraw = (request: ApiPrintRequest) => {
    setBusy(true)
    setMessage('')
    deleteJson(`/print/${request.id}`)
      .then(reload)
      .catch((error: unknown) => {
        setMessage(explain(error))
      })
      .finally(() => {
        setBusy(false)
        setAsking(null)
      })
  }

  return (
    <FormPanel>
      <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
        MY REQUESTS
      </p>

      {requests === 'loading' && (
        <div aria-busy="true" className="space-y-2.5">
          <div className="bg-base-300 h-4 w-2/3 animate-pulse rounded-[2px]" />
          <div className="bg-base-300 h-3 w-1/2 animate-pulse rounded-[2px]" />
        </div>
      )}

      {requests === null && (
        <p className="text-dim text-sm leading-[1.7]">
          We couldn't load your requests just now.
        </p>
      )}

      {Array.isArray(requests) &&
        (requests.length === 0 ? (
          <p className="text-dim text-sm leading-[1.7]">
            Nothing yet.
          </p>
        ) : (
          <ul className="divide-rule divide-y">
            {requests.map((request) => (
              <RequestRow
                key={request.id}
                request={request}
                busy={busy}
                editable={trained}
                onEdit={(chosen) => {
                  setAsking({ act: 'edit', request: chosen })
                }}
                onWithdraw={(chosen) => {
                  setAsking({ act: 'withdraw', request: chosen })
                }}
              />
            ))}
          </ul>
        ))}

      <p role="status" className="text-error mt-2 min-h-4 text-[12px]">
        {message}
      </p>

      {asking?.act === 'edit' && (
        <ConfirmDialog
          title={`Take ${asking.request.fileName} back to the slicer?`}
          confirmLabel="EDIT IT"
          tone="primary"
          busy={busy}
          onConfirm={() => {
            edit(asking.request)
          }}
          onDismiss={() => {
            setAsking(null)
          }}
        >
          <p>
            It leaves the queue and goes back to being a draft. Slice it and send it again when
            it's ready.
          </p>
        </ConfirmDialog>
      )}
      {asking?.act === 'withdraw' && (
        <ConfirmDialog
          title={`Withdraw ${asking.request.fileName}?`}
          confirmLabel="WITHDRAW IT"
          busy={busy}
          onConfirm={() => {
            withdraw(asking.request)
          }}
          onDismiss={() => {
            setAsking(null)
          }}
        >
          <p>It leaves the queue and its files are deleted.</p>
        </ConfirmDialog>
      )}
    </FormPanel>
  )
}

function RequestRow({
  request,
  busy,
  editable,
  onEdit,
  onWithdraw,
}: {
  request: ApiPrintRequest
  busy: boolean
  /** The slicer is open to this member, so a sliced plate can go back into it. */
  editable: boolean
  onEdit: (request: ApiPrintRequest) => void
  onWithdraw: (request: ApiPrintRequest) => void
}) {
  const label = STATUS_LABEL[request.status]
  const actual = actualSettings(request)
  const sliced = request.slicedWith !== null

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate text-sm font-medium">
            {request.fileName}
          </span>
          {/* Only when it is not one — "×1" on every row is noise on all of
              them to make the rare one legible. */}
          {plateCount(request) && (
            <span className="text-primary shrink-0 font-mono text-[11px] font-semibold">
              {plateCount(request)}
            </span>
          )}
        </span>
        <span
          className={`${STATUS_TONE[label.tone]} font-mono text-[10px] font-medium tracking-[0.16em]`}
        >
          {label.text}
        </span>
      </div>

      <p className="text-faint mt-0.5 font-mono text-[10px] font-medium tracking-[0.12em] uppercase">
        {sliced ? slicedLine(request) : settingsLine(actual)}
        {' · '}
        {request.project ? request.project.title : 'Personal'}
        {/* Only once there is a figure: a pending row saying "0 g" would read
            as a print that cost nothing rather than one not yet printed. */}
        {request.gramsUsed !== null
          ? ` · ${grams(request.gramsUsed)}`
          : request.estimatedGrams !== null &&
            ` · About ${grams(chargedGrams(request.estimatedGrams))}, ${duration(request.estimatedSeconds)}`}
      </p>

      <p className="text-faint mt-0.5 font-mono text-[10px] font-medium tracking-[0.12em] uppercase">
        {fileSize(request.fileSize)} · Sent {shortDate(request.submittedAt ?? request.createdAt)}
      </p>

      {/* Said plainly, because "why is this PETG" is a question worth
          answering before it is asked. */}
      {actual.changed && (
        <p className="text-dim mt-1.5 text-[13px] leading-[1.5] text-pretty">
          Asked for {settingsLine(request)} — printed as above.
        </p>
      )}

      {request.notes && (
        <p className="text-dim mt-1.5 text-[13px] leading-[1.5] text-pretty">
          {request.notes}
        </p>
      )}

      {request.officerNote && (
        <p className="border-primary/35 text-dim mt-2 border-l-2 pl-3 text-[13px] leading-[1.5] text-pretty">
          {request.officerNote}
        </p>
      )}

      {request.status === 'PENDING' && (
        <span className="mt-1 flex gap-4 wide:mt-2">
          {/* A sliced plate can be taken back into the slicer until an officer starts it. */}
          {sliced && editable && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onEdit(request)
              }}
              className="text-primary hover:text-base-content -mx-2 inline-flex min-h-11 items-center px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary wide:min-h-6 cursor-pointer font-mono text-[10px] font-semibold tracking-[0.14em] transition-colors duration-200 disabled:opacity-50"
            >
              EDIT
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onWithdraw(request)
            }}
            className="text-faint hover:text-error -mx-2 inline-flex min-h-11 items-center px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary wide:min-h-6 cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50"
          >
            WITHDRAW
          </button>
        </span>
      )}
    </li>
  )
}
