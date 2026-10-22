import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router'
import { SubNav } from '../../components/dashboard/SubNav'
import { PRINT_QUEUE_PAGES } from '../../lib/dashboard/subPages'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { DuesLocked } from '../../components/dashboard/DuesLocked'
import { OfficerOnly } from '../../components/dashboard/OfficerOnly'
import { ConfirmDialog } from '../../components/shared/ConfirmDialog'
import { ErrorDialog } from '../../components/shared/ErrorDialog'
import { FormEyebrow, FormHeading, FormPanel, measureClass } from '../../components/shared/formChrome'
import { ProfileFileDialog } from '../../components/slicer/ProfileFileDialog'
import { type ProfileActions, ProfileRow } from '../../components/slicer/ProfileRow'
import { loudButton, quietButton } from '../../components/slicer/slicerChrome'
import { ApiError, deleteJson, getJson, patchJson } from '../../lib/api/api'
import type { ApiDeskProfile, ApiSlicerDesk } from '../../lib/api/api'
import { isOfficer } from '../../lib/auth/session'
import { duesLocked } from '../../lib/dues/dues'
import { NOUN, checking } from '../../lib/slicer/profileDesk'

/**
 * The printers, processes and filaments members slice with.
 *
 * An officer uploads what desktop Orca exports and the slicer worker reads each preset and slices
 * a test cube with it before members can pick it, so a new row says CHECKING for a few seconds
 * and the page keeps asking until it's done. Processes and filaments belong to a printer, since
 * the same spool is tuned differently on each. Order here is the order in the workspace, and the
 * first of each is what a new plate starts with.
 */

const EYEBROW = '/ MANAGE · PRINT QUEUE · SLICER PROFILES'
const POLL_EVERY = 2_000

type Load = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; desk: ApiSlicerDesk }

type Dialog =
  | { kind: 'add'; printer?: ApiDeskProfile; only?: 'PROCESS' | 'FILAMENT' }
  | { kind: 'replace'; profile: ApiDeskProfile }
  | { kind: 'delete'; profile: ApiDeskProfile }
  | { kind: 'hide'; profile: ApiDeskProfile }

/** "process", "2 processes", or null for none. */
const count = (n: number, one: string, many: string) =>
  n === 0 ? null : n === 1 ? one : `${String(n)} ${many}`

function explain(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return `Couldn't reach the server. Try again in a moment.`
    if (error.status === 403) return 'The server does not agree you are an officer.'
    if (error.detail) return error.detail
  }
  return `That didn't go through. Try again in a moment.`
}

export function OfficerSlicerProfilesPage() {
  const { user, membership } = useOutletContext<DashboardContext>()
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<{
    title: string
    message: string
    returnTo: HTMLElement | null
  } | null>(null)

  const allowed = !duesLocked(membership, user.role) && isOfficer(user.role)

  const fetchDesk = useCallback(async (signal?: AbortSignal) => {
    try {
      const desk = await getJson<ApiSlicerDesk>('/officer/slicer-profiles', signal, true)
      setLoad({ status: 'ready', desk })
    } catch (error) {
      if (signal?.aborted) return
      // A failed poll after a good answer keeps the good one.
      setLoad((current) => (current.status === 'ready' ? current : { status: 'failed' }))
      if (!(error instanceof ApiError)) console.error(error)
    }
  }, [])

  useEffect(() => {
    if (!allowed) return
    const controller = new AbortController()
    void fetchDesk(controller.signal)
    return () => {
      controller.abort()
    }
  }, [allowed, fetchDesk])

  // While the worker is reading something, ask again until it's done.
  const waiting = load.status === 'ready' && checking(load.desk)
  useEffect(() => {
    if (!waiting) return
    const handle = setInterval(() => {
      void fetchDesk()
    }, POLL_EVERY)
    return () => {
      clearInterval(handle)
    }
  }, [waiting, fetchDesk])

  if (duesLocked(membership, user.role)) return <DuesLocked eyebrow={EYEBROW} />
  if (!isOfficer(user.role)) {
    return <OfficerOnly eyebrow={EYEBROW} why="The printers and filaments members slice with are set up by the officers." />
  }

  /** Runs one write and shows the desk it answers with, or why it didn't go through. */
  const write = async (title: string, run: () => Promise<ApiSlicerDesk>): Promise<boolean> => {
    // Whatever was pressed gets focus back when the error is dismissed.
    const pressed = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setBusy(true)
    try {
      setLoad({ status: 'ready', desk: await run() })
      return true
    } catch (error) {
      setProblem({ title, message: explain(error), returnTo: pressed })
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) void fetchDesk()
      return false
    } finally {
      setBusy(false)
    }
  }

  const desk = load.status === 'ready' ? load.desk : null

  /** The list a profile is ordered within: the printers, or one printer's processes or filaments. */
  const siblings = (profile: ApiDeskProfile): ApiDeskProfile[] => {
    if (!desk) return []
    if (profile.kind === 'PRINTER') return desk.printers
    const list = (printer: ApiSlicerDesk['printers'][number]) =>
      profile.kind === 'PROCESS' ? printer.processes : printer.filaments
    const owner = desk.printers.find((printer) => list(printer).some((p) => p.id === profile.id))
    return owner ? list(owner) : []
  }

  /** "PLA on CC1" for a process or filament, since two printers can each have a PLA. */
  const called = (profile: ApiDeskProfile): string => {
    const owner = desk?.printers.find((printer) =>
      [...printer.processes, ...printer.filaments].some((p) => p.id === profile.id),
    )
    return owner ? `${profile.label} on ${owner.label}` : profile.label
  }
  /** "the PLA filament on CC1", for a dialog's title. */
  const named = (profile: ApiDeskProfile): string => {
    const owner = called(profile).slice(profile.label.length)
    return `the ${profile.label} ${NOUN[profile.kind]}${owner}`
  }

  const setOffered = (profile: ApiDeskProfile, offered: boolean) =>
    write(`Couldn't ${offered ? 'offer' : 'hide'} ${called(profile)}`, () =>
      patchJson<ApiSlicerDesk>(`/officer/slicer-profiles/${profile.id}`, { offered }),
    )

  const actions: ProfileActions = {
    busy,
    onSave: (profile, change) =>
      write(`Couldn't save ${called(profile)}`, () =>
        patchJson<ApiSlicerDesk>(`/officer/slicer-profiles/${profile.id}`, change),
      ),
    onToggle: (profile) => {
      // Hiding strands the drafts that use it, so that one asks first.
      if (profile.offered && profile.uses.drafts > 0) setDialog({ kind: 'hide', profile })
      else void setOffered(profile, !profile.offered)
    },
    onReplace: (profile) => {
      setDialog({ kind: 'replace', profile })
    },
    onDelete: (profile) => {
      setDialog({ kind: 'delete', profile })
    },
    onMove: (profile, by) => {
      const ids = siblings(profile).map((p) => p.id)
      const from = ids.indexOf(profile.id)
      const to = from + by
      if (from < 0 || to < 0 || to >= ids.length) return Promise.resolve(false)
      ;[ids[from], ids[to]] = [ids[to]!, ids[from]!]
      return write(`Couldn't move ${called(profile)}`, () =>
        patchJson<ApiSlicerDesk>('/officer/slicer-profiles/order', { ids }),
      )
    },
  }

  const deleting = dialog?.kind === 'delete' ? dialog.profile : null
  const hiding = dialog?.kind === 'hide' ? dialog.profile : null
  const draftsLine = (drafts: number) =>
    `${drafts === 1 ? '1 draft uses' : `${String(drafts)} drafts use`} it.`
  const deletingPrinter = deleting?.kind === 'PRINTER' ? desk?.printers.find((p) => p.id === deleting.id) : undefined
  const goesWith = [
    count(deletingPrinter?.processes.length ?? 0, 'process', 'processes'),
    count(deletingPrinter?.filaments.length ?? 0, 'filament', 'filaments'),
  ].filter(Boolean)
  const goes = (deletingPrinter?.processes.length ?? 0) + (deletingPrinter?.filaments.length ?? 0) === 1 ? 'goes' : 'go'

  return (
    <>
      <FormEyebrow>{EYEBROW}</FormEyebrow>
      <FormHeading>Slicer profiles.</FormHeading>
      <SubNav label="Print queue pages" pages={PRINT_QUEUE_PAGES} />

      <div className={`${measureClass} mb-6 flex flex-wrap items-center gap-3`}>
        <button
          type="button"
          className={loudButton}
          disabled={!desk}
          aria-disabled={busy}
          onClick={() => {
            if (!busy) setDialog({ kind: 'add' })
          }}
        >
          ADD FROM AN EXPORT
        </button>
      </div>

      {desk && !desk.workerOnline && (
        <div className={`${measureClass} mb-5`}>
          <FormPanel tone="accent">
            <p className="text-dim text-sm leading-[1.6]">
              The slicer is offline, so new uploads wait as CHECKING until it's back.
            </p>
          </FormPanel>
        </div>
      )}

      {load.status === 'loading' && (
        <div aria-busy="true" className="grid-fluid gap-5 [--col-min:30rem]">
          {['w-1/3', 'w-1/4'].map((width) => (
            <div key={width}>
              <div className="bg-base-300 mb-2 h-3 w-24 animate-pulse rounded-[2px]" />
              <FormPanel>
                <div className="space-y-2.5">
                  <div className={`bg-base-300 h-4 animate-pulse rounded-[2px] ${width}`} />
                  <div className="bg-base-300 h-3 w-1/2 animate-pulse rounded-[2px]" />
                  <div className="bg-base-300 h-3 w-2/5 animate-pulse rounded-[2px]" />
                  <div className="bg-base-300 mt-4 h-8 w-64 max-w-full animate-pulse rounded-[2px]" />
                </div>
              </FormPanel>
            </div>
          ))}
        </div>
      )}

      {load.status === 'failed' && (
        <div className={measureClass}>
        <FormPanel tone="accent">
          <p className="text-dim text-sm leading-[1.6]">Couldn't load the profiles. Try again in a moment.</p>
          <button
            type="button"
            className={`${quietButton} mt-3`}
            onClick={() => {
              setLoad({ status: 'loading' })
              void fetchDesk()
            }}
          >
            TRY AGAIN
          </button>
        </FormPanel>
        </div>
      )}

      {desk && (
        <section aria-labelledby="printers-heading">
          <h2 id="printers-heading" className="text-faint mb-2 font-mono text-[11px] font-medium tracking-[0.16em]">
            PRINTERS
          </h2>
          {desk.printers.length === 0 ? (
            <div className={measureClass}>
              <FormPanel>
                <p className="text-dim text-sm leading-[1.6]">
                  No printers yet. Add a printer bundle (.orca_printer) with its processes and filaments.
                </p>
              </FormPanel>
            </div>
          ) : (
            <div className="grid-fluid items-start gap-5 [--col-min:30rem]">
              {desk.printers.map((printer, index) => (
                <FormPanel key={printer.id}>
                  <ProfileRow
                    profile={printer}
                    desk={desk}
                    first={index === 0}
                    last={index === desk.printers.length - 1}
                    actions={actions}
                  >
                    {/* Side by side when one printer has the whole width, so the rows stay short. */}
                    <div className="grid-fluid items-start gap-x-6 [--col-min:24rem]">
                      {(['PROCESS', 'FILAMENT'] as const).map((kind) => (
                        <PrinterList
                          key={kind}
                          kind={kind}
                          printer={printer}
                          desk={desk}
                          actions={actions}
                          onAdd={() => {
                            if (!busy) setDialog({ kind: 'add', printer, only: kind })
                          }}
                        />
                      ))}
                    </div>
                  </ProfileRow>
                </FormPanel>
              ))}
            </div>
          )}
        </section>
      )}

      {desk && (dialog?.kind === 'add' || dialog?.kind === 'replace') && (
        <ProfileFileDialog
          mode={dialog}
          printers={desk.printers}
          onDone={(next) => {
            setLoad({ status: 'ready', desk: next })
            setDialog(null)
          }}
          onDismiss={() => {
            setDialog(null)
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${named(deleting)}?`}
          confirmLabel="DELETE"
          busy={busy}
          onConfirm={() => {
            setDialog(null)
            void write(`Couldn't delete ${called(deleting)}`, () =>
              deleteJson<ApiSlicerDesk>(`/officer/slicer-profiles/${deleting.id}`),
            )
          }}
          onDismiss={() => {
            setDialog(null)
          }}
        >
          {goesWith.length > 0 && (
            <p>
              Its {goesWith.join(' and ')} {goes} with it.
            </p>
          )}
          {deleting.uses.drafts > 0 && (
            <p>
              {draftsLine(deleting.uses.drafts)} Their owners will be asked to pick another{' '}
              {NOUN[deleting.kind]}.
            </p>
          )}
          {deleting.uses.sent > 0 && <p>Requests already sent keep their sliced file.</p>}
          <p>HIDE keeps it here for later instead.</p>
        </ConfirmDialog>
      )}

      {hiding && (
        <ConfirmDialog
          title={`Hide ${named(hiding)}?`}
          confirmLabel="HIDE IT"
          tone="primary"
          busy={busy}
          onConfirm={() => {
            setDialog(null)
            void setOffered(hiding, false)
          }}
          onDismiss={() => {
            setDialog(null)
          }}
        >
          <p>
            {draftsLine(hiding.uses.drafts)} They can't be sliced or sent until it's offered again or
            their owners pick another {NOUN[hiding.kind]}.
          </p>
          <p>Nobody can pick it for a new plate.</p>
        </ConfirmDialog>
      )}

      {problem && (
        <ErrorDialog
          title={problem.title}
          returnTo={problem.returnTo}
          onDismiss={() => {
            setProblem(null)
          }}
        >
          {problem.message}
        </ErrorDialog>
      )}
    </>
  )
}

const PLURAL = { PROCESS: 'processes', FILAMENT: 'filaments' } as const

/** One printer's processes or filaments, under it, with the button that adds more. */
function PrinterList({
  kind,
  printer,
  desk,
  actions,
  onAdd,
}: {
  kind: 'PROCESS' | 'FILAMENT'
  printer: ApiSlicerDesk['printers'][number]
  desk: ApiSlicerDesk
  actions: ProfileActions
  onAdd: () => void
}) {
  const list = kind === 'PROCESS' ? printer.processes : printer.filaments
  const plural = PLURAL[kind]
  return (
    <section aria-label={`${printer.label} ${plural}`} className="border-rule mt-4 border-l-2 pl-4">
      <h4 className="text-faint mb-1 font-mono text-[10px] font-medium tracking-[0.16em]">
        {plural.toUpperCase()}
      </h4>
      {list.length === 0 ? (
        <p className="text-dim text-[12.5px] leading-[1.5]">None yet.</p>
      ) : (
        <div className="divide-rule divide-y">
          {list.map((profile, at) => (
            <ProfileRow
              key={profile.id}
              profile={profile}
              desk={desk}
              first={at === 0}
              last={at === list.length - 1}
              actions={actions}
              printer={printer.label}
            />
          ))}
        </div>
      )}
      <button
        type="button"
        className={`${quietButton} mt-3`}
        aria-disabled={actions.busy}
        aria-label={`Add ${plural} to the ${printer.label} printer`}
        onClick={onAdd}
      >
        ADD {plural.toUpperCase()}
      </button>
    </section>
  )
}
