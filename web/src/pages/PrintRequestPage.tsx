import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useOutletContext } from 'react-router'
import { DuesLocked } from '../components/dashboard/DuesLocked'
import { ClaimFree } from '../components/dashboard/ClaimFree'
import { MembersOnly } from '../components/dashboard/MembersOnly'
import type { DashboardContext } from '../components/dashboard/DashboardLayout'
import { accessLock } from '../lib/dues'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  fieldClass,
  labelClass,
  submitClass,
} from '../components/shared/formChrome'
import { ApiError, deleteJson, getJson, postForm } from '../lib/api'
import type {
  ApiMyProject,
  ApiPrintAllowance,
  ApiPrintRequest,
  PrintProcess,
  PrintRequestStatus,
} from '../lib/api'
import { STATUS_TONE, fileSize, shortDate } from '../lib/formats'
import type { StatusTone } from '../lib/formats'
import {
  DEFAULT_INFILL_DENSITY,
  DEFAULT_SETTINGS,
  INFILL_DENSITIES,
  INFILL_PATTERNS,
  MAX_QUANTITY,
  PROCESSES,
  actualSettings,
  countLabel,
  grams,
  hasInfill,
  materialsFor,
  settingsLine,
} from '../lib/printing'

/**
 * The 3D print request form, and the list of what you have asked for.
 *
 * Three club rules shape this page.
 *
 * The **file rule**: the printers take STL and STEP and nothing else, so the
 * file input says so, this page checks it before uploading, and the server
 * checks the bytes themselves — an extension is a claim, not evidence.
 *
 * The **storage rule**: a finished job's file is deleted, which is why a
 * settled row shows its name and size but no download. The record outlives the
 * model deliberately, and offering a link to nothing would be a lie.
 *
 * The **budget rule**: a personal print comes out of 500 g a term, and a print
 * for a project comes out of nothing at all. That is why the project field is
 * on the form rather than in the notes — it is not a label, it decides who
 * pays for the plastic.
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
 * A wrapper rather than an early return inside the page: everything under here
 * fetches on mount, and a locked account would fire those requests only to have
 * the server 403 every one of them into the console. Nothing renders, nothing
 * asks.
 *
 * The context is read as nullable for the reason the dues page reads it that
 * way — this page has its own suite that renders it alone, and a component that
 * falls over without a parent can only be tested through one. Null means "not
 * locked", and the server is the thing that actually refuses.
 */
export function PrintRequestPage() {
  const dashboard = useOutletContext<DashboardContext | null>()
  const lock = dashboard
    ? accessLock(dashboard.membership, dashboard.user.role)
    : null

  // Three locks, three sentences — see `accessLock` in `lib/dues.ts`. The
  // free one is the state that did not exist before: the club is charging
  // nobody and this person has still not claimed it.
  if (lock === 'claim') {
    return <ClaimFree eyebrow="/ 3D PRINTING" thing="The printers" />
  }

  if (lock === 'newcomer') {
    return <MembersOnly eyebrow="/ 3D PRINTING" thing="The printers" />
  }

  if (lock === 'dues') return <DuesLocked eyebrow="/ 3D PRINTING" />

  return <PrintRequestForm projects={dashboard?.projects} />
}

function PrintRequestForm({
  projects,
}: {
  projects: DashboardContext['projects'] | undefined
}) {
  const [requests, setRequests] = useState<ApiPrintRequest[] | null | 'loading'>(
    'loading',
  )
  const [allowance, setAllowance] = useState<ApiPrintAllowance | null>(null)

  const load = useCallback(async () => {
    // Settled together: submitting a print changes the list, and settling one
    // changes the balance, so a page that reloaded only the list would show a
    // finished job beside a balance that had not noticed it.
    const [list, balance] = await Promise.allSettled([
      getJson<ApiPrintRequest[]>('/me/print-requests'),
      getJson<ApiPrintAllowance>('/me/print-allowance'),
    ])

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
        Send the model and set it up. An officer slices it, prints it and
        records what it took — you'll see the status change on this page, and
        they can leave you a note with it. Ask early: the club's projects are
        printing too.
      </p>

      <div className="space-y-5">
        <Allowance allowance={allowance} />
        <RequestForm projects={mine} onSent={load} />
        <MyRequests requests={requests} reload={load} />
      </div>
    </>
  )
}

/**
 * The balance, and the two sentences that stop it being a surprise.
 *
 * Above the form rather than beside the submit button, because it changes what
 * somebody chooses — 40% infill on a big part is a different decision when
 * there are 80 g left. The bar is the same information as the numbers and is
 * there for the glance; the numbers are there because a bar cannot be read
 * exactly.
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
            <strong className="text-white">{grams(-remainingGrams)}</strong> past
            your allowance for the semester — an officer printed something
            knowing that. It resets with the next one.
          </>
        ) : (
          <>
            <strong className="text-white">{grams(remainingGrams)}</strong> left
            for your own prints. Resets each semester.
          </>
        )}{' '}
        Prints for a club project do not come out of this — put the project on
        the form and nothing is counted.
      </p>
    </FormPanel>
  )
}

function RequestForm({
  projects,
  onSent,
}: {
  projects: ApiMyProject[]
  onSent: () => Promise<void>
}) {
  const id = useId()
  const [state, setState] = useState<FormState>({ status: 'idle' })
  // The one setting the rest of the form depends on, so it is the one piece of
  // state here — everything else is uncontrolled and read at submit. Resin has
  // no infill and a different material, and both have to follow this.
  const [process, setProcess] = useState<PrintProcess>(DEFAULT_SETTINGS.process)
  // The file comes off the input rather than out of `new FormData(form)`,
  // unlike every other form here. Two reasons: the body is built by hand
  // anyway so the request says exactly what it sends, and a file input needs
  // its `value` cleared explicitly — `form.reset()` alone leaves the
  // filename sitting under a form that has already been sent.
  const fileInput = useRef<HTMLInputElement>(null)

  const materials = materialsFor(process)
  const infill = hasInfill(process)

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
    body.append('process', process)

    // Only what this process actually has. Sending an empty infill on a resin
    // print would be sending a field the server is right to refuse.
    for (const key of infill
      ? [
          'material',
          'infillPattern',
          'infillDensity',
          'quantity',
          'projectId',
          'notes',
        ]
      : ['material', 'quantity', 'projectId', 'notes']) {
      const value = fields.get(key)
      if (typeof value === 'string' && value.trim()) body.append(key, value.trim())
    }

    setState({ status: 'sending' })
    postForm<ApiPrintRequest>('/print', body)
      .then(async () => {
        form.reset()
        if (fileInput.current) fileInput.current.value = ''
        setProcess(DEFAULT_SETTINGS.process)
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

        {/* The whole card is the target rather than a radio dot beside it —
            the same reasoning as the dues plan picker. */}
        <fieldset className="mb-5" aria-label="Which printer">
          <legend className={labelClass}>WHICH PRINTER</legend>
          <div className="grid gap-3 wide:grid-cols-2">
            {PROCESSES.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer flex-col border p-4 transition-colors duration-200 ${
                  process === option.value
                    ? 'border-primary bg-primary/5'
                    : 'border-rule bg-base-200 hover:border-white/25'
                } ${sending ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="font-mono text-[10px] font-medium tracking-[0.16em]">
                    {option.label}
                  </span>
                  <input
                    type="radio"
                    name="process"
                    value={option.value}
                    checked={process === option.value}
                    disabled={sending}
                    onChange={() => {
                      setProcess(option.value)
                    }}
                    className="radio radio-sm border-rule checked:bg-primary checked:text-primary-content mt-0.5 shrink-0"
                  />
                </span>
                <span className="text-dim mt-2 block text-[13px] leading-[1.5] text-pretty">
                  {option.blurb}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mb-5 grid gap-4 wide:grid-cols-2">
          <div>
            <label htmlFor={`${id}-material`} className={labelClass}>
              MATERIAL
            </label>
            <select
              id={`${id}-material`}
              name="material"
              // Keyed on the process so switching printers resets the choice
              // rather than leaving a material the new one cannot take
              // selected in a box that no longer offers it.
              key={process}
              defaultValue={materials[0]?.value}
              disabled={sending}
              className={select}
            >
              {materials.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-faint mt-1.5 text-[12px] leading-[1.5]">
              {materials.length === 1
                ? 'The one resin the club stocks.'
                : materials[0]?.blurb}
            </p>
          </div>

          {/* Its own field rather than a sentence in the notes, because it is
              the one thing in there an officer has to act on — they slice four
              of something differently from one. */}
          <div>
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
        </div>

        {/* Absent on resin rather than disabled: a greyed-out infill box
            invites somebody to wonder what they did wrong, and resin prints
            genuinely have no infill to set. */}
        {infill && (
          <div className="mb-5 grid gap-4 wide:grid-cols-2">
            <div>
              <label htmlFor={`${id}-pattern`} className={labelClass}>
                INFILL PATTERN
              </label>
              <select
                id={`${id}-pattern`}
                name="infillPattern"
                defaultValue={DEFAULT_SETTINGS.infillPattern}
                disabled={sending}
                className={select}
              >
                {INFILL_PATTERNS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor={`${id}-density`} className={labelClass}>
                INFILL DENSITY
              </label>
              <select
                id={`${id}-density`}
                name="infillDensity"
                defaultValue={String(DEFAULT_SETTINGS.infillDensity)}
                disabled={sending}
                className={select}
              >
                {INFILL_DENSITIES.map((density) => (
                  <option key={density} value={density}>
                    {density}%
                    {density === 0
                      ? ' — hollow'
                      : density === DEFAULT_INFILL_DENSITY
                        ? ' — the usual'
                        : density === 100
                          ? ' — solid'
                          : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* On its own line rather than beside the material: this is the field
            that decides whether the print costs anybody anything, and its
            helper sentence is the one worth having room for. */}
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
              : 'A project print is not counted against your 500 g.'}
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
            placeholder="Black if there is any. No supports on the printed face."
            className="textarea border-rule bg-base-200 w-full text-sm"
          />
        </div>

        <button type="submit" disabled={sending} className={submitClass}>
          {sending ? 'SENDING…' : 'SEND THE REQUEST'}
        </button>

        <p role="status" className="mt-3 min-h-5 text-[13px] leading-[1.5]">
          {state.status === 'failed' && (
            <span className="text-error">{state.message}</span>
          )}
          {state.status === 'sent' && (
            <span className="text-success">
              Sent. An officer has been told, and it's in your list below.
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
 * The club asked for a notice about inappropriate prints. It sits at the foot
 * of the form in the quiet type rather than in a warning box at the top: a
 * page that opens by accusing its reader of something reads badly to the
 * hundred people who were only ever going to print a bracket.
 */
function Conduct() {
  return (
    <p className="text-faint mt-5 border-t border-white/8 pt-4 text-[12px] leading-[1.6] text-pretty">
      Your allowance is for your own projects and for learning on. Officers
      decline anything against club or university rules — weapons and weapon
      parts, anything meant to hurt somebody, anything you'd be printing to
      sell. A declined print's file is deleted with the decision, and nothing
      comes off your allowance for it.
    </p>
  )
}

function MyRequests({
  requests,
  reload,
}: {
  requests: ApiPrintRequest[] | null | 'loading'
  reload: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const withdraw = (request: ApiPrintRequest) => {
    if (!window.confirm(`Withdraw the request for ${request.fileName}?`)) return

    setBusy(true)
    setMessage('')
    deleteJson(`/print/${request.id}`)
      .then(reload)
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
            Nothing yet. Whatever you send lands here.
          </p>
        ) : (
          <ul className="divide-rule divide-y">
            {requests.map((request) => (
              <RequestRow
                key={request.id}
                request={request}
                busy={busy}
                onWithdraw={withdraw}
              />
            ))}
          </ul>
        ))}

      <p role="status" className="text-error mt-2 min-h-4 text-[12px]">
        {message}
      </p>
    </FormPanel>
  )
}

function RequestRow({
  request,
  busy,
  onWithdraw,
}: {
  request: ApiPrintRequest
  busy: boolean
  onWithdraw: (request: ApiPrintRequest) => void
}) {
  const label = STATUS_LABEL[request.status]
  const actual = actualSettings(request)

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate text-sm font-medium">
            {request.fileName}
          </span>
          {/* Only when it is not one — "×1" on every row is noise on all of
              them to make the rare one legible. */}
          {countLabel(request.quantity) && (
            <span className="text-primary shrink-0 font-mono text-[11px] font-semibold">
              {countLabel(request.quantity)}
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
        {settingsLine(actual)}
        {' · '}
        {request.project ? request.project.title : 'Personal'}
        {/* Only once there is a figure: a pending row saying "0 g" would read
            as a print that cost nothing rather than one not yet printed. */}
        {request.gramsUsed !== null && ` · ${grams(request.gramsUsed)}`}
      </p>

      <p className="text-faint mt-0.5 font-mono text-[10px] font-medium tracking-[0.12em] uppercase">
        {fileSize(request.fileSize)} · Sent {shortDate(request.createdAt)}
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
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            onWithdraw(request)
          }}
          className="text-faint hover:text-error mt-2 cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50"
        >
          WITHDRAW
        </button>
      )}
    </li>
  )
}
