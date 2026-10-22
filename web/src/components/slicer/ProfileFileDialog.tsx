import { useId, useRef, useState } from 'react'
import { ApiError, postForm } from '../../lib/api/api'
import type { ApiDeskProfile, ApiProfileFile, ApiSlicerDesk, SlicerProfileKind } from '../../lib/api/api'
import { NOUN } from '../../lib/slicer/profileDesk'
import { useDialogFocus } from '../../lib/useDialogFocus'
import { labelClass } from '../shared/formChrome'
import { loudButton, quietButton, smallSelect } from './slicerChrome'

/** What desktop Orca exports, under Export in its File menu. */
const ACCEPTED = '.orca_printer,.orca_filament,.zip,.json'

const GROUPS: { kind: SlicerProfileKind; heading: string }[] = [
  { kind: 'PRINTER', heading: 'PRINTER' },
  { kind: 'PROCESS', heading: 'PROCESSES' },
  { kind: 'FILAMENT', heading: 'FILAMENTS' },
]

function explain(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return `Couldn't reach the server. Try again in a moment.`
    if (error.status === 413) return 'That file is too big for an Orca export.'
    if (error.detail) return error.detail
  }
  return `That didn't go through. Try again in a moment.`
}

const PLURAL = { PROCESS: 'processes', FILAMENT: 'filaments' } as const

/**
 * Adding presets from an Orca export, adding processes or filaments to one printer, or replacing
 * one profile with a newer export of it.
 *
 * The file is read twice: once to list what's in it (a printer bundle carries the printer, its
 * processes and every filament the officer had), and again with the presets they picked. A preset
 * whose name is already here can only replace that profile, from its own REPLACE FILE, so it can't
 * be picked here.
 */
export function ProfileFileDialog({
  mode,
  printers,
  onDone,
  onDismiss,
}: {
  mode:
    | { kind: 'add'; printer?: ApiDeskProfile; only?: 'PROCESS' | 'FILAMENT' }
    | { kind: 'replace'; profile: ApiDeskProfile }
  /** The printers already here, for processes and filaments uploaded without theirs. */
  printers: ApiDeskProfile[]
  onDone: (desk: ApiSlicerDesk) => void
  onDismiss: () => void
}) {
  const id = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [contents, setContents] = useState<ApiProfileFile | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [printerId, setPrinterId] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useDialogFocus(panelRef, fileRef, onDismiss)

  const replacing = mode.kind === 'replace' ? mode.profile : null
  // Pressed under a printer: only its processes or its filaments, and they go on that printer.
  const onto = mode.kind === 'add' ? (mode.printer ?? null) : null
  const ontoKind = mode.kind === 'add' && onto ? (mode.only ?? 'PROCESS') : null
  const only = replacing?.kind ?? ontoKind
  const presets = (contents?.presets ?? []).filter((preset) => !only || preset.kind === only)
  const usable = (preset: (typeof presets)[number]) =>
    preset.existing === null || (replacing !== null && preset.existing.id === replacing.id)

  const read = async (chosen: File) => {
    setFile(chosen)
    setContents(null)
    setPicked([])
    setProblem(null)
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', chosen)
      if (onto) form.append('printerId', onto.id)
      const found = await postForm<ApiProfileFile>('/officer/slicer-profiles/inspect', form)
      setContents(found)
      const of = (kind: SlicerProfileKind) => found.presets.filter((p) => p.kind === kind)
      if (replacing) {
        const same = of(replacing.kind)
        setPicked(same.length === 1 ? [same[0]!.entry] : [])
        if (same.length === 0) setProblem(`That file has no ${NOUN[replacing.kind]} in it.`)
      } else if (ontoKind) {
        const fresh = of(ontoKind).filter((p) => p.existing === null)
        // A bundle carries every filament on the officer's machine, so those are opt-in unless
        // there's only the one.
        setPicked(ontoKind === 'PROCESS' || fresh.length === 1 ? fresh.map((p) => p.entry) : [])
        if (of(ontoKind).length === 0) setProblem(`That file has no ${PLURAL[ontoKind]} in it.`)
      } else if (found.presets.length === 1) {
        setPicked(found.presets.filter((p) => p.existing === null).map((p) => p.entry))
      } else {
        // A printer bundle also carries every filament on the officer's machine; those are opt-in.
        setPicked([...of('PRINTER'), ...of('PROCESS')].filter((p) => p.existing === null).map((p) => p.entry))
      }
      // Processes and filaments from a bundle whose printer is already here go on that printer.
      if (found.printer && printerId === '') setPrinterId(found.printer.id)
    } catch (error) {
      setProblem(explain(error))
    } finally {
      setBusy(false)
    }
  }

  /** Picking the printer reads the file again against it, so what that printer has shows as taken. */
  const pickPrinter = async (id: string) => {
    setPrinterId(id)
    if (!file || id === '') return
    setProblem(null)
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('printerId', id)
      const found = await postForm<ApiProfileFile>('/officer/slicer-profiles/inspect', form)
      setContents(found)
      setPicked((current) =>
        current.filter((entry) => found.presets.find((p) => p.entry === entry)?.existing === null),
      )
    } catch (error) {
      setProblem(explain(error))
    } finally {
      setBusy(false)
    }
  }

  const choose = (entry: string, kind: SlicerProfileKind, on: boolean) => {
    setPicked((current) => {
      if (replacing) return on ? [entry] : []
      // One printer at a time: picking another swaps it.
      const others =
        kind === 'PRINTER'
          ? current.filter((e) => presets.find((p) => p.entry === e)?.kind !== 'PRINTER')
          : current
      return on ? [...others.filter((e) => e !== entry), entry] : current.filter((e) => e !== entry)
    })
  }

  const pickedOf = (kind: SlicerProfileKind) =>
    picked.filter((entry) => presets.find((p) => p.entry === entry)?.kind === kind)
  const needsPrinter =
    !replacing &&
    !onto &&
    pickedOf('PROCESS').length + pickedOf('FILAMENT').length > 0 &&
    pickedOf('PRINTER').length === 0

  const send = async () => {
    if (!file || picked.length === 0) return
    if (needsPrinter && printerId === '') {
      setProblem('Say which printer they’re for.')
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      const form = new FormData()
      form.append('file', file)
      let desk: ApiSlicerDesk
      if (replacing) {
        form.append('entry', picked[0]!)
        desk = await postForm<ApiSlicerDesk>(`/officer/slicer-profiles/${replacing.id}/replace`, form)
      } else {
        form.append('entries', JSON.stringify(picked))
        if (onto) form.append('printerId', onto.id)
        else if (needsPrinter) form.append('printerId', printerId)
        desk = await postForm<ApiSlicerDesk>('/officer/slicer-profiles', form)
      }
      onDone(desk)
    } catch (error) {
      setProblem(explain(error))
      setBusy(false)
    }
  }

  const title = replacing
    ? `Replace ${replacing.label}`
    : onto && ontoKind
      ? `Add ${PLURAL[ontoKind]} to ${onto.label}`
      : 'Add from an Orca export'
  const action = replacing
    ? 'REPLACE'
    : picked.length > 1
      ? `ADD ${String(picked.length)} PRESETS`
      : 'ADD PRESET'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 wide:items-center" onClick={onDismiss}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onClick={(event) => {
          event.stopPropagation()
        }}
        className="border-rule bg-base-200 flex max-h-[min(42rem,calc(100dvh-2rem))] w-full max-w-[34rem] flex-col border shadow-2xl"
      >
        <div className="overflow-y-auto p-6">
          <h2 id={`${id}-title`} className="mb-2 text-lg leading-snug font-bold text-pretty break-words">
            {title}
          </h2>
          <p className="text-dim mb-4 text-sm leading-[1.6] text-pretty">
            {replacing
              ? `Export it again from desktop Orca. Plates sliced with the old one will need slicing again.`
              : ontoKind === 'FILAMENT'
                ? `From a printer bundle, a filament bundle, or a filament's .json. Only its filaments are added, to this printer.`
                : ontoKind === 'PROCESS'
                  ? `From a printer bundle or a process's .json. Only its processes are added, to this printer.`
                  : `A printer bundle, a filament bundle, or a preset's .json, from desktop Orca's File › Export.`}
          </p>

          <label htmlFor={`${id}-file`} className={labelClass}>
            FILE
          </label>
          <input
            ref={fileRef}
            id={`${id}-file`}
            type="file"
            accept={ACCEPTED}
            disabled={busy}
            onChange={(event) => {
              const chosen = event.target.files?.[0]
              if (chosen) void read(chosen)
            }}
            className="file-input file-input-sm border-rule bg-base-100 w-full"
          />

          {busy && !contents && <p className="text-faint mt-3 text-[12.5px]">Reading the file…</p>}

          {contents &&
            GROUPS.map(({ kind, heading }) => {
              const group = presets.filter((preset) => preset.kind === kind)
              if (group.length === 0) return null
              return (
                <fieldset key={kind} className="mt-5">
                  <legend className={labelClass}>{heading}</legend>
                  <ul className="space-y-1">
                    {group.map((preset) => {
                      const on = picked.includes(preset.entry)
                      const taken = !usable(preset)
                      return (
                        <li key={preset.entry}>
                          <label
                            className={`flex min-h-11 items-start gap-3 py-1.5 wide:min-h-0 ${taken ? 'opacity-60' : 'cursor-pointer'}`}
                          >
                            <input
                              type={replacing || kind === 'PRINTER' ? 'radio' : 'checkbox'}
                              name={`${id}-${kind}`}
                              className={replacing || kind === 'PRINTER' ? 'radio radio-sm mt-0.5' : 'checkbox checkbox-sm mt-0.5'}
                              checked={on}
                              disabled={taken || busy}
                              onChange={(event) => {
                                choose(preset.entry, kind, event.target.checked)
                              }}
                              onClick={() => {
                                // A radio can't be unticked by clicking it; this one can.
                                if (on && kind === 'PRINTER' && !replacing) choose(preset.entry, kind, false)
                              }}
                            />
                            <span className="min-w-0">
                              <span className="block text-sm break-words">{preset.name}</span>
                              <span className="text-faint block text-[11.5px] leading-[1.5] break-words">
                                {taken
                                  ? `Already here as ${preset.existing!.label}. Use REPLACE FILE on it instead.`
                                  : preset.inherits
                                    ? `Based on ${preset.inherits}`
                                    : 'Not based on a stock preset'}
                              </span>
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </fieldset>
              )
            })}

          {needsPrinter && (
            <div className="mt-5">
              <label htmlFor={`${id}-printer`} className={labelClass}>
                FOR WHICH PRINTER
              </label>
              {printers.length === 0 ? (
                <p className="text-dim text-[12.5px] leading-[1.5]">
                  There are no printers yet. Pick the printer in this file too.
                </p>
              ) : (
                <select
                  id={`${id}-printer`}
                  value={printerId}
                  disabled={busy}
                  onChange={(event) => {
                    void pickPrinter(event.target.value)
                  }}
                  className={smallSelect}
                >
                  <option value="" disabled>
                    Choose a printer
                  </option>
                  {printers.map((printer) => (
                    <option key={printer.id} value={printer.id}>
                      {printer.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {contents && !problem && picked.length === 0 && presets.some(usable) && (
            <p className="text-faint mt-4 text-[12.5px] leading-[1.5]">Tick what to add.</p>
          )}

          {problem && (
            <p role="alert" className="text-error mt-4 text-[13px] leading-[1.6]">
              {problem}
            </p>
          )}
        </div>

        <div className="border-rule flex flex-wrap justify-end gap-2.5 border-t px-6 py-4">
          <button type="button" onClick={onDismiss} className={quietButton}>
            GO BACK
          </button>
          <button
            type="button"
            disabled={busy || picked.length === 0 || (needsPrinter && printers.length === 0)}
            onClick={() => void send()}
            className={loudButton}
          >
            {busy && contents ? 'SENDING…' : action}
          </button>
        </div>
      </div>
    </div>
  )
}
