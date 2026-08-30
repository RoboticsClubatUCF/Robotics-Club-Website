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
} from '../../components/shared/formChrome'
import { ApiError, getJson, patchJson } from '../../lib/api/api'
import type {
  ApiPrintQueueItem,
  InfillPattern,
  PrintMaterial,
  PrintProcess,
  PrintRequestStatus,
} from '../../lib/api/api'
import { hits } from '../../lib/equipment/catalogue'
import { FilterChips } from '../../components/shared/FilterChips'
import { STATUS_TONE, dateAndTime, fileSize } from '../../lib/format/formats'
import type { StatusTone } from '../../lib/format/formats'
import { storedFileUrl } from '../../lib/media/storedFiles'
import { ConfirmDialog } from '../../components/shared/ConfirmDialog'
import {
  DEFAULT_INFILL_DENSITY,
  INFILL_DENSITIES,
  INFILL_PATTERNS,
  actionPhrase,
  actualSettings,
  countLabel,
  grams,
  hasInfill,
  isCancel,
  materialsFor,
  settingsLine,
} from '../../lib/printing'

/**
 * The 3D print queue, as the officer running the printers sees it.
 *
 * The queue defaults to live work — waiting and printing — because that is
 * the shift's to-do list; settled jobs are a filter away rather than noise on
 * top. Marking one DONE or DECLINED deletes the uploaded model in the same
 * breath, which is the club's storage rule and the reason those two are
 * one-way: after them there is nothing left to print from. The page says so
 * before the click rather than after.
 *
 * The other half of the job is the material. The officer slices the model,
 * reads the figure off the slicer and types it in beside the buttons, and on a
 * personal print that is what comes out of the member's 500 g for the term —
 * so their remaining balance sits right next to the box. Going past it is
 * allowed and deliberate: the confirm names the overage, and the officer at
 * the printer is the one who decides. A project print has no cap at all and
 * shows no balance, because weighing one against a budget it does not come out
 * of is exactly the mistake that would cause.
 *
 * The correction row exists because officers print in whatever is on the
 * shelf. It starts on what was asked for, so leaving it alone sends the truth.
 */

const STATUS_LABEL: Record<PrintRequestStatus, { text: string; tone: StatusTone }> = {
  PENDING: { text: 'WAITING', tone: 'neutral' },
  PRINTING: { text: 'PRINTING', tone: 'progress' },
  DONE: { text: 'DONE', tone: 'good' },
  REJECTED: { text: 'DECLINED', tone: 'bad' },
}

const FILTERS = [
  { value: '', label: 'LIVE' },
  { value: 'PENDING', label: 'WAITING' },
  { value: 'PRINTING', label: 'PRINTING' },
  { value: 'DONE', label: 'DONE' },
  { value: 'REJECTED', label: 'DECLINED' },
] as const

/**
 * Which machine, so an officer standing at one can see only its work.
 *
 * The two are different jobs with different consumables and usually different
 * people running them — filtering to SLA is how somebody about to fill a resin
 * vat finds out whether it is worth doing.
 */
const PROCESSES = [
  { value: 'ALL', label: 'ANY MACHINE' },
  { value: 'FDM', label: 'FDM' },
  { value: 'SLA', label: 'RESIN' },
] as const

/**
 * Whose budget it comes out of, which is the other question an officer asks
 * before touching a row: a personal print is charged against 500 g and a
 * project print is not charged at all.
 */
const KINDS = [
  { value: 'ALL', label: 'ANY' },
  { value: 'PERSONAL', label: 'PERSONAL' },
  { value: 'PROJECT', label: 'FOR A PROJECT' },
] as const

type ProcessFilter = (typeof PROCESSES)[number]['value']
type KindFilter = (typeof KINDS)[number]['value']

function explain(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0)
      return "We couldn't reach the server. Try again in a moment."
    if (error.status === 403) return 'The server does not agree you are an officer.'
    if (error.detail) return error.detail
  }
  return 'That change did not go through. Try again in a moment.'
}

/**
 * The three queue actions, drawn as buttons rather than as text.
 *
 * One shape, three weights: gold for whatever the natural next step is, outline
 * for the other move, red for the one that ends the job badly. All three are
 * the same size so the row reads as a set of choices rather than as a heading
 * with links after it.
 */
const actionBase =
  'btn h-auto min-h-0 cursor-pointer px-4 py-2 text-[11px] font-semibold tracking-[0.04em] disabled:opacity-50'

const loudButton = `${actionBase} btn-primary btn-cta`

const quietButton = `${actionBase} btn-outline border-base-content/28 text-base-content hover:border-base-content hover:bg-base-content/6 hover:text-base-content`

const dangerButton = `${actionBase} btn-outline border-error/40 text-error hover:border-error hover:bg-error/10 hover:text-error`

/** A settlement waiting on the officer confirming it. */
interface Pending {
  request: ApiPrintQueueItem
  status: PrintRequestStatus
  draft: Draft
  /** Grams past the member's allowance, or 0. Computed before the ask so the
      dialog can name the number rather than repeat the rule. */
  over: number
}

/** What an officer has typed against one row but not yet sent. */
interface Draft {
  officerNote: string
  gramsUsed: string
  process: PrintProcess
  material: PrintMaterial
  infillPattern: InfillPattern | null
  infillDensity: number | null
}

export function OfficerPrintQueuePage() {
  const { user, membership } = useOutletContext<DashboardContext>()
  const id = useId()
  const [filter, setFilter] = useState<string>('')
  const [query, setQuery] = useState('')
  const [process, setProcess] = useState<ProcessFilter>('ALL')
  const [kind, setKind] = useState<KindFilter>('ALL')
  const [queue, setQueue] = useState<ApiPrintQueueItem[] | null | 'loading'>(
    'loading',
  )
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  // Held at the page rather than per row: one dialog exists, and whichever row
  // opened it is carried inside. A dialog per row would mean as many mounted
  // overlays as there are jobs in the queue.
  const [pending, setPending] = useState<Pending | null>(null)

  /**
   * Searching from LIVE reaches the whole archive; searching from a named
   * section stays inside it.
   *
   * That is the club's rule and it is the right way round: LIVE is "what needs
   * doing", and somebody who types a name into it is no longer asking what
   * needs doing — they are looking for a print, and the one they want has
   * usually already been done. Inside DONE or DECLINED the section *is* the
   * question, so widening it would undo the filter they just pressed.
   *
   * This is a **boolean** in the dependency list, not the search text, which
   * is what makes it one extra fetch when the box goes from empty to typed
   * and one more when it is cleared — rather than a request per keystroke,
   * which is the shape that would need a debounce and a stale-response guard.
   */
  const widen = filter === '' && query.trim() !== ''

  const load = useCallback(async () => {
    const scope = widen ? '?all=1' : filter ? `?status=${filter}` : ''

    try {
      setQueue(await getJson<ApiPrintQueueItem[]>(`/officer/print-queue${scope}`))
    } catch (error) {
      console.error(error)
      setQueue(null)
    }
  }, [filter, widen])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Narrowed in the browser, over what the fetch above brought back.
   *
   * Instant, no round trip and no debounce — and the widening is what keeps it
   * honest, because the alternative reading of "search everything" is a search
   * that silently only covers the rows already on screen.
   */
  const rows = Array.isArray(queue)
    ? queue.filter(
        (request) =>
          hits(
            [
              request.user.fullName,
              request.user.discordUsername,
              request.fileName,
              request.project?.title,
            ],
            query,
          ) &&
          (process === 'ALL' || actualSettings(request).process === process) &&
          (kind === 'ALL' ||
            (kind === 'PROJECT') === (request.project !== null)),
      )
    : []

  // Dues before role, because a lapsed officer *is* an officer and the
  // sentence they need is about a payment rather than about the board.
  if (duesLocked(membership, user.role)) {
    return <DuesLocked eyebrow="/ MANAGE · PRINT QUEUE" />
  }

  if (!isOfficer(user.role)) {
    return <OfficerOnly eyebrow="/ MANAGE · PRINT QUEUE" why="The print queue is run by the officers with access to the printers." />
  }

  /** Do it, having asked where asking was warranted. */
  const send = ({ request, status, draft, over }: Pending) => {
    const officerNote = draft.officerNote.trim()
    const gramsUsed = draft.gramsUsed.trim() === '' ? null : Number(draft.gramsUsed)

    // Only when it actually differs. Sending the ask back unchanged would fill
    // the `printed*` columns on every job and lose "was this changed?".
    const asked = actualSettings(request)
    const corrected =
      draft.process !== asked.process ||
      draft.material !== asked.material ||
      draft.infillPattern !== asked.infillPattern ||
      draft.infillDensity !== asked.infillDensity

    setBusy(true)
    setMessage('')
    setPending(null)
    patchJson(`/officer/print/${request.id}`, {
      status,
      ...(officerNote ? { officerNote } : {}),
      // Never on a decline: nothing was printed, and the server refuses it.
      ...(status === 'REJECTED' || gramsUsed === null ? {} : { gramsUsed }),
      ...(corrected
        ? {
            printed: hasInfill(draft.process)
              ? {
                  process: draft.process,
                  material: draft.material,
                  infillPattern: draft.infillPattern,
                  infillDensity: draft.infillDensity,
                }
              : { process: draft.process, material: draft.material },
          }
        : {}),
      // The officer has already been shown the numbers and pressed through.
      ...(over > 0 ? { overAllowance: true } : {}),
    })
      .then(load)
      .catch((error: unknown) => {
        setMessage(explain(error))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const settle = (
    request: ApiPrintQueueItem,
    status: PrintRequestStatus,
    draft: Draft,
  ) => {
    const gramsUsed = draft.gramsUsed.trim() === '' ? null : Number(draft.gramsUsed)

    if (status === 'DONE' && request.allowance && gramsUsed === null) {
      // Said here rather than let through to the 400, because the officer is
      // standing at a printer and a round trip to be told to fill in a box is
      // a round trip too many.
      setMessage(
        `Say how much ${request.fileName} took — it comes out of ${request.user.fullName}'s allowance.`,
      )
      return
    }

    /**
     * Both warnings in one box.
     *
     * The file deletion is the storage rule and the overage is the budget one,
     * and a row can trip both at once. Two boxes back to back is how the second
     * one gets dismissed unread, so they share a dialog — which is most of why
     * that dialog is ours rather than the browser's: the native one has nowhere
     * to put the second sentence, let alone the numbers.
     */
    const over =
      status === 'DONE' && request.allowance && gramsUsed !== null
        ? gramsUsed - request.allowance.remainingGrams
        : 0

    const terminal = status === 'DONE' || status === 'REJECTED'
    const next = { request, status, draft, over }

    // Only the irreversible ones ask. Putting a job on a printer is a step
    // forward that can be walked back; the two below delete the model.
    if (terminal) setPending(next)
    else send(next)
  }

  return (
    <>
      <FormEyebrow>/ MANAGE · PRINT QUEUE</FormEyebrow>
      <FormHeading>3D print queue.</FormHeading>

      <div className="mb-4">
        <FilterChips
          options={FILTERS}
          value={filter as (typeof FILTERS)[number]['value']}
          onChange={setFilter}
        />
      </div>

      {/* Capped, unlike the queue under it. `fieldClass` is `w-full`, and a
          search box the width of a monitor looks like the page's main event
          rather than the thing you narrow it with. */}
      <div className="mb-3 max-w-[46rem]">
        <label htmlFor={`${id}-search`} className="sr-only">
          Search the print queue
        </label>
        <input
          id={`${id}-search`}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
          placeholder="Search — name, Discord handle, file, project"
          className={fieldClass}
        />
        {/* Said out loud, because it is a rule the reader cannot see. From
            LIVE a search covers the whole archive; inside a section it stays
            in that section, which is what makes the section worth pressing. */}
        <p className="text-faint mt-1 text-[12px] leading-[1.5]">
          {filter === ''
            ? 'Searches every request — waiting, printing, done or declined.'
            : `Searches ${FILTERS.find((f) => f.value === filter)?.label.toLowerCase()} requests only.`}
        </p>
      </div>

      <div className="mb-5 flex flex-wrap gap-x-6 gap-y-2">
        <FilterChips
          label="MACHINE"
          options={PROCESSES}
          value={process}
          onChange={setProcess}
        />
        <FilterChips label="BUDGET" options={KINDS} value={kind} onChange={setKind} />
      </div>

      <FormPanel>
        {queue === 'loading' && (
          <div aria-busy="true" className="space-y-2.5">
            <div className="bg-base-300 h-4 w-2/3 animate-pulse rounded-[2px]" />
            <div className="bg-base-300 h-3 w-1/2 animate-pulse rounded-[2px]" />
          </div>
        )}

        {queue === null && (
          <p className="text-dim text-sm leading-[1.7]">
            We couldn't load the queue just now.
          </p>
        )}

        {Array.isArray(queue) &&
          (rows.length === 0 ? (
            <p className="text-dim text-sm leading-[1.7]">
              {query.trim() || process !== 'ALL' || kind !== 'ALL'
                ? 'Nothing matches what you are looking for.'
                : filter === ''
                  ? 'Nothing waiting. Printers are free.'
                  : 'Nothing here.'}
            </p>
          ) : (
            /* Jobs across as well as down. A queue row is a card — a filename,
               five lines of settings and a row of controls — and one card per
               screen-width was the worst of both: an officer working through a
               Sunday's requests could see two at a time on a monitor that had
               room for six. Each carries its own border now, since a hairline
               between rows means nothing once there are columns. `items-start`
               so a job with a long note does not stretch the two beside it. */
            <ul className="grid-fluid items-start gap-4 [--col-min:28rem]">
              {rows.map((request) => (
                <QueueRow
                  key={request.id}
                  request={request}
                  busy={busy}
                  onSettle={settle}
                />
              ))}
            </ul>
          ))}

        <p role="status" className="text-error mt-3 min-h-4 text-[12px]">
          {message}
        </p>
      </FormPanel>

      {pending && (
        <SettleDialog
          pending={pending}
          busy={busy}
          onConfirm={() => {
            send(pending)
          }}
          onDismiss={() => {
            setPending(null)
          }}
        />
      )}
    </>
  )
}

/**
 * The last thing between an officer and an irreversible act.
 *
 * Three different acts share it, and the words are what make them different:
 * finishing a job, refusing one nobody started, and stopping one already on a
 * printer. Each names the file, says the model is about to go, and — when the
 * grams take somebody past their allowance — puts both numbers in front of the
 * person deciding, which is the whole reason this is not `window.confirm`.
 */
function SettleDialog({
  pending,
  busy,
  onConfirm,
  onDismiss,
}: {
  pending: Pending
  busy: boolean
  onConfirm: () => void
  onDismiss: () => void
}) {
  const { request, status, over } = pending
  const cancelling = status === 'REJECTED' && isCancel(request.status)
  const done = status === 'DONE'

  const title = done
    ? `Mark ${request.fileName} as done?`
    : cancelling
      ? `Stop the print of ${request.fileName}?`
      : `Decline ${request.fileName}?`

  return (
    <ConfirmDialog
      title={title}
      tone={done ? 'primary' : 'danger'}
      confirmLabel={done ? 'MARK DONE' : cancelling ? 'STOP THE PRINT' : 'DECLINE'}
      busy={busy}
      onConfirm={onConfirm}
      onDismiss={onDismiss}
    >
      {/* The overage first: it is the fact most likely to change the answer,
          and a warning under the paragraph explaining the storage rule is a
          warning read second. */}
      {over > 0 && (
        <p className="text-error font-semibold">
          {request.user.fullName} has{' '}
          {grams(request.allowance?.remainingGrams ?? 0)} left this semester, so
          this puts them {grams(over)} over.
        </p>
      )}

      {cancelling && (
        <p>
          Stopping it here does not stop the machine — go and clear the bed.
        </p>
      )}

      <p>
        This deletes the uploaded model. The record of the request stays.
      </p>

      {!done && (
        <p>Nothing comes off their allowance for a print that was not finished.</p>
      )}
    </ConfirmDialog>
  )
}

/**
 * One request, and everything an officer might do to it.
 *
 * The draft lives here rather than in a map on the page above, because there
 * are six fields per row now and a `Record<string, …>` per field is five more
 * places for a stale key to survive a reload. Keyed by request id at the call
 * site, so a row that leaves the queue takes its half-typed state with it.
 */
function QueueRow({
  request,
  busy,
  onSettle,
}: {
  request: ApiPrintQueueItem
  busy: boolean
  onSettle: (
    request: ApiPrintQueueItem,
    status: PrintRequestStatus,
    draft: Draft,
  ) => void
}) {
  const asked = actualSettings(request)
  // Starts on what was asked for, so an officer who changes nothing sends the
  // truth and the `printed*` columns stay null.
  const [draft, setDraft] = useState<Draft>({
    officerNote: request.officerNote ?? '',
    gramsUsed: request.gramsUsed === null ? '' : String(request.gramsUsed),
    process: asked.process,
    material: asked.material,
    infillPattern: asked.infillPattern,
    infillDensity: asked.infillDensity,
  })

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const label = STATUS_LABEL[request.status]
  const settled = request.status === 'DONE' || request.status === 'REJECTED'
  const typed = draft.gramsUsed.trim() === '' ? null : Number(draft.gramsUsed)
  const over =
    request.allowance && typed !== null
      ? typed - request.allowance.remainingGrams
      : 0
  const field = 'select border-rule bg-base-200 h-8 min-h-8 py-0 text-[12px]'

  return (
    <li className="border-rule border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate text-sm font-semibold">
            {request.fileName}
          </span>
          {/* Next to the filename rather than down in the settings line: it
              changes how the job is sliced, so it has to be seen before the
              file is opened. Absent when it is one. */}
          {countLabel(request.quantity) && (
            <span className="text-primary shrink-0 font-mono text-[12px] font-semibold">
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
        {request.user.fullName}
        {request.user.discordUsername && ` · @${request.user.discordUsername}`}
        {' · '}
        {fileSize(request.fileSize)} · {dateAndTime(request.createdAt)}
      </p>

      <p className="text-dim mt-1.5 font-mono text-[10px] font-medium tracking-[0.12em] uppercase">
        {settingsLine(request)}
        {' · '}
        {/* The word that decides whether anything is deducted. Spelled out
            rather than left as an absence. */}
        <span className={request.project ? 'text-info' : ''}>
          {request.project ? request.project.title : 'Personal'}
        </span>
      </p>

      {/* Whose grams, and how many are left. Only on personal rows — a project
          print is uncapped, and a balance beside one invites the officer to
          weigh it against a budget it does not come out of. */}
      {request.allowance && (
        <p
          className={`mt-0.5 font-mono text-[10px] font-medium tracking-[0.12em] uppercase ${
            request.allowance.remainingGrams <= 0 ? 'text-error' : 'text-faint'
          }`}
        >
          {grams(request.allowance.remainingGrams)} left of{' '}
          {grams(request.allowance.limitGrams)} this semester
        </p>
      )}

      {request.notes && (
        <p className="text-dim mt-2 text-[13px] leading-[1.5] text-pretty">
          {request.notes}
        </p>
      )}

      {/* Named by what was *done*, not by where the row ended up. The status is
          not the event: `REJECTED` is a request somebody declined or a print
          somebody stopped, and only `startedAt` knows which. "Last moved by"
          made the reader work that out from the badge. */}
      {settled ? (
        <p className="text-faint mt-2 text-[12px] leading-[1.5]">
          {request.decidedBy
            ? `${request.decidedBy.fullName} ${actionPhrase(request.status, request.startedAt)}`
            : 'This was settled'}
          {request.gramsUsed !== null && `, at ${grams(request.gramsUsed)}`}.
          {asked.changed && ` Printed as ${settingsLine(asked)}.`}{' '}
          {/* Said plainly, because "where is my file" is the question this
              answers before it is asked. */}
          The model was deleted with it.
          {request.officerNote && ` — ${request.officerNote}`}
        </p>
      ) : (
        <>
          {request.decidedBy && (
            <p className="text-faint mt-1.5 text-[12px] leading-[1.5]">
              {request.decidedBy.fullName}{' '}
              {actionPhrase(request.status, request.startedAt)}.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-faint font-mono text-[10px] tracking-[0.14em]">
              PRINTED AS
            </span>

            <select
              aria-label={`Printer used for ${request.fileName}`}
              value={draft.process}
              disabled={busy}
              onChange={(event) => {
                const process = event.target.value as PrintProcess
                // The material has to follow the machine, and resin has no
                // infill to carry over.
                setDraft((current) => ({
                  ...current,
                  process,
                  material: materialsFor(process)[0]!.value,
                  infillPattern: hasInfill(process)
                    ? (current.infillPattern ?? 'GRID')
                    : null,
                  infillDensity: hasInfill(process)
                    ? (current.infillDensity ?? DEFAULT_INFILL_DENSITY)
                    : null,
                }))
              }}
              className={field}
            >
              <option value="FDM">FDM</option>
              <option value="SLA">SLA</option>
            </select>

            <select
              aria-label={`Material used for ${request.fileName}`}
              value={draft.material}
              disabled={busy}
              onChange={(event) => {
                set('material', event.target.value as PrintMaterial)
              }}
              className={field}
            >
              {materialsFor(draft.process).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            {hasInfill(draft.process) && (
              <>
                <select
                  aria-label={`Infill density used for ${request.fileName}`}
                  value={String(draft.infillDensity ?? DEFAULT_INFILL_DENSITY)}
                  disabled={busy}
                  onChange={(event) => {
                    set('infillDensity', Number(event.target.value))
                  }}
                  className={field}
                >
                  {INFILL_DENSITIES.map((density) => (
                    <option key={density} value={density}>
                      {density}%
                    </option>
                  ))}
                </select>

                <select
                  aria-label={`Infill pattern used for ${request.fileName}`}
                  value={draft.infillPattern ?? 'GRID'}
                  disabled={busy}
                  onChange={(event) => {
                    set('infillPattern', event.target.value as InfillPattern)
                  }}
                  className={field}
                >
                  {INFILL_PATTERNS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </>
            )}

            <label className="flex items-center gap-1.5">
              <span className="text-faint font-mono text-[10px] tracking-[0.14em]">
                USED
              </span>
              <input
                type="number"
                min={0}
                max={100000}
                inputMode="numeric"
                value={draft.gramsUsed}
                onChange={(event) => {
                  set('gramsUsed', event.target.value)
                }}
                placeholder="g"
                aria-label={`Grams used for ${request.fileName}`}
                className={`${fieldClass} h-8 w-24`}
                disabled={busy}
              />
            </label>
          </div>

          {/* Before the press, not after the 409. The server checks it again
              and is the one that actually refuses — this is so the officer
              knows what the button is about to do. */}
          {over > 0 && (
            <p className="text-error mt-2 text-[12px] leading-[1.5]">
              That is {grams(over)} past what {request.user.fullName} has
              left.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            {request.fileId && (
              <a
                href={storedFileUrl(request.fileId)}
                className={`${quietButton} shrink-0`}
              >
                DOWNLOAD
              </a>
            )}

            <input
              value={draft.officerNote}
              onChange={(event) => {
                set('officerNote', event.target.value)
              }}
              maxLength={1000}
              placeholder="Note back to them (optional)"
              aria-label={`Note about ${request.fileName}`}
              className={`${fieldClass} h-9 min-w-48 flex-1`}
              disabled={busy}
            />
          </div>

          {/*
            The three decisions, on their own band with a rule above them.

            They were bare mono text before, sharing a wrapping row with the
            note field — which made them read as labels rather than as things
            to press, and put DECLINE two millimetres from MARK DONE. These are
            the irreversible actions on the page: settling one deletes the
            model, and there is no undo.

            Whichever is the *natural* next step carries the primary weight, so
            it moves from START PRINTING to MARK DONE as the job progresses and
            an officer working the queue can aim at the gold one. DECLINE is
            pushed to the far end and coloured for what it is, because the
            failure worth designing against is hitting it by accident while
            reaching for the button beside it.
          */}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-base-content/8 pt-3">
            {request.status === 'PENDING' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  onSettle(request, 'PRINTING', draft)
                }}
                className={loudButton}
              >
                START PRINTING
              </button>
            )}

            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onSettle(request, 'DONE', draft)
              }}
              className={request.status === 'PENDING' ? quietButton : loudButton}
            >
              MARK DONE
            </button>

            {/* Declining is refusing something nobody started; cancelling is
                stopping something already running. One status underneath, two
                different acts, and the officer pressing this is looking at a
                printer in one case and not in the other. */}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onSettle(request, 'REJECTED', draft)
              }}
              // `ml-auto` rather than a spacer: at narrow widths the row wraps
              // and this simply lands on its own line, which is still the far
              // side of everything else.
              className={`${dangerButton} ml-auto`}
            >
              {isCancel(request.status) ? 'CANCEL THE PRINT' : 'DECLINE'}
            </button>
          </div>
        </>
      )}
    </li>
  )
}
