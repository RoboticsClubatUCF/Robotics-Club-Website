import { Lock } from 'lucide-react'
import { Fragment, useId, useState } from 'react'
import { Link } from 'react-router'
import type { ApiSlicerWorkspace } from '../../lib/api/api'
import {
  PROCESS_SETTINGS,
  type ProcessOverrides,
  type SettingTab,
  TABS,
} from '../../lib/slicer/processSettings'
import { filamentsFor, onPrinter, printerOf } from '../../lib/slicer/profiles'
import { CHAPTER_TITLES, chapterFor, chapterLink, unlocked } from '../../lib/slicer/trainingChapters'
import type { PlateSettings } from '../../lib/slicer/useDraft'
import { SettingField } from './SettingField'
import { panelHeading, smallSelect } from './slicerChrome'

/**
 * The left column, in Orca's order: the printer, the filament, the process, then the process's
 * settings by tab. Everything here applies to the whole plate.
 *
 * Officers upload the choices on the profiles desk. With one printer there's nothing to pick, so
 * it's just named; the filaments are the ones made for it, and the processes are its own. A choice
 * an officer has since deleted or hidden shows as a blank to fill in. Temperatures and speeds come
 * with the filament and process and aren't offered at all.
 *
 * What the member hasn't taken the training chapter for is shown but locked, under a line naming
 * the chapter; the server refuses it too. A choice an officer took away can be made again without
 * the chapter, or the plate could never be sliced again.
 */
export function SettingsPanel({
  profiles,
  settings,
  chapters,
  disabled,
  onChange,
}: {
  profiles: ApiSlicerWorkspace['profiles']
  settings: PlateSettings
  /** The training chapters finished (`lib/slicer/trainingChapters.ts`). */
  chapters: readonly string[]
  disabled: boolean
  onChange: (change: Partial<PlateSettings>) => void
}) {
  const id = useId()
  const [tab, setTab] = useState<SettingTab>('quality')
  const printer = printerOf(profiles, settings.printerId)
  const preset = printer?.processes.find((p) => p.id === settings.processId)
  const filaments = filamentsFor(profiles, settings.printerId)
  const filament = filaments.find((f) => f.id === settings.filamentId)

  const locked = (key: string) => !unlocked(chapters, key)
  const choiceLocked = {
    printer: !!printer && locked('printer'),
    process: !!preset && locked('process'),
    filament: !!filament && locked('filament'),
  }
  // Only worth saying where there's something else to pick.
  const choiceNote =
    (choiceLocked.printer && profiles.printers.length > 1) ||
    (choiceLocked.process && (printer?.processes.length ?? 0) > 1) ||
    (choiceLocked.filament && filaments.length > 1)
      ? `${id}-lock-profiles`
      : undefined

  const setOverride = (key: string, value: ProcessOverrides[string]) => {
    const next = { ...settings.overrides }
    // Back to the preset's value is the same as not having changed it.
    if (value === undefined || value === preset?.values[key]) delete next[key]
    else next[key] = value
    onChange({ overrides: next })
  }

  const changedIn = (key: SettingTab) =>
    PROCESS_SETTINGS.filter((def) => def.tab === key && settings.overrides[def.key] !== undefined)
      .length
  const tabLocked = (key: SettingTab) =>
    PROCESS_SETTINGS.filter((def) => def.tab === key).every((def) => locked(def.key))
  const shown = PROCESS_SETTINGS.filter((def) => def.tab === tab)
  // The chapter that unlocks each locked setting on this tab. Settings sharing a chapter sit
  // together, so one line above each run says which, and each setting in the run points at it.
  const lockedBy = shown.map((def) => (locked(def.key) ? chapterFor(def.key) : undefined))
  const notes: (string | undefined)[] = []
  lockedBy.forEach((chapter, index) => {
    notes.push(
      chapter === undefined
        ? undefined
        : chapter === lockedBy[index - 1]
          ? notes[index - 1]
          : `${id}-lock-${shown[index]!.key}`,
    )
  })

  const blurb = 'text-faint mt-1.5 text-[12px] leading-[1.5]'

  return (
    <div className="space-y-5 p-4">
      <section aria-labelledby={`${id}-printer`}>
        <h2 id={`${id}-printer`} className={`${panelHeading} mb-2`}>
          PRINTER
        </h2>
        {profiles.printers.length === 1 && printer ? (
          <p className="text-sm font-medium">{printer.label}</p>
        ) : (
          <select
            aria-labelledby={`${id}-printer`}
            aria-invalid={!printer}
            aria-describedby={choiceLocked.printer ? choiceNote : undefined}
            value={printer?.id ?? ''}
            disabled={disabled || choiceLocked.printer}
            onChange={(event) => {
              onChange(onPrinter(profiles, settings, event.target.value))
            }}
            className={smallSelect}
          >
            {!printer && (
              <option value="" disabled>
                Choose a printer
              </option>
            )}
            {profiles.printers.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        )}
        {printer && (
          <p className="text-faint mt-1 font-mono text-[10px] tracking-[0.12em] uppercase">
            {printer.model} · {printer.nozzle} mm nozzle · {printer.bedType}
          </p>
        )}
        {printer?.description && <p className={blurb}>{printer.description}</p>}
      </section>

      <section aria-labelledby={`${id}-filament`}>
        <h2 id={`${id}-filament`} className={`${panelHeading} mb-2`}>
          FILAMENT
        </h2>
        <select
          data-coach="filament"
          aria-labelledby={`${id}-filament`}
          aria-invalid={printer !== undefined && !filament}
          aria-describedby={choiceLocked.filament ? choiceNote : undefined}
          value={filament?.id ?? ''}
          disabled={disabled || !printer || choiceLocked.filament}
          onChange={(event) => {
            onChange({ filamentId: event.target.value })
          }}
          className={smallSelect}
        >
          {!filament && (
            <option value="" disabled>
              Choose a filament
            </option>
          )}
          {filaments.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label === option.name ? option.label : `${option.label} · ${option.name}`}
            </option>
          ))}
        </select>
        {filament?.description && <p className={blurb}>{filament.description}</p>}
      </section>

      <section aria-labelledby={`${id}-process`}>
        <h2 id={`${id}-process`} className={`${panelHeading} mb-2`}>
          PROCESS
        </h2>
        <select
          data-coach="process"
          aria-labelledby={`${id}-process`}
          aria-describedby={
            [preset ? `${id}-process-about` : '', choiceLocked.process ? (choiceNote ?? '') : '']
              .filter(Boolean)
              .join(' ') || undefined
          }
          aria-invalid={printer !== undefined && !preset}
          value={preset?.id ?? ''}
          disabled={disabled || !printer || choiceLocked.process}
          onChange={(event) => {
            onChange({ processId: event.target.value })
          }}
          className={smallSelect}
        >
          {!preset && (
            <option value="" disabled>
              Choose a process
            </option>
          )}
          {printer?.processes.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        {preset && (
          <p id={`${id}-process-about`} className={blurb}>
            {preset.description.charAt(0).toUpperCase()}
            {preset.description.slice(1)}
            {/[.!?]$/.test(preset.description) ? '' : '.'}
          </p>
        )}
        {choiceNote && <LockNote id={choiceNote} chapter="materials" />}
      </section>

      <section aria-label="Process settings">
        <div
          role="tablist"
          aria-label="Setting groups"
          className="border-rule flex border-b"
          onKeyDown={(event) => {
            const index = TABS.findIndex((t) => t.key === tab)
            const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
            if (!step) return
            event.preventDefault()
            const next = TABS[(index + step + TABS.length) % TABS.length]!
            setTab(next.key)
            document.getElementById(`${id}-tab-${next.key}`)?.focus()
          }}
        >
          {TABS.map((option) => {
            const count = changedIn(option.key)
            const active = tab === option.key
            const shut = tabLocked(option.key)
            const named = [option.label, count > 0 ? `${String(count)} changed` : '', shut ? 'locked' : '']
              .filter(Boolean)
              .join(', ')
            return (
              <button
                key={option.key}
                id={`${id}-tab-${option.key}`}
                data-coach={`settings-tab:${option.key}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`${id}-panel`}
                aria-label={named === option.label ? undefined : named}
                tabIndex={active ? 0 : -1}
                onClick={() => {
                  setTab(option.key)
                }}
                className={`-mb-px inline-flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1 border-b-2 px-1 font-mono text-[10px] font-medium tracking-[0.06em] whitespace-nowrap uppercase transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary wide:min-h-9 ${
                  active ? 'border-primary text-primary' : 'text-dim hover:text-base-content border-transparent'
                }`}
              >
                {shut && <Lock aria-hidden="true" className="size-3 shrink-0" strokeWidth={1.6} />}
                {option.label}
                {count > 0 && (
                  <span className="bg-primary text-primary-content px-1 text-[9px] leading-[1.4]">{count}</span>
                )}
              </button>
            )
          })}
        </div>

        <div
          id={`${id}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${tab}`}
          className="mt-2 space-y-0.5"
        >
          {preset ? (
            shown.map((def, index) => {
              const chapter = lockedBy[index]
              const note = notes[index]
              return (
                <Fragment key={def.key}>
                  {chapter && note !== notes[index - 1] && (
                    <LockNote id={note!} chapter={chapter} />
                  )}
                  <SettingField
                    def={def}
                    value={settings.overrides[def.key]}
                    presetValue={preset.values[def.key]!}
                    disabled={disabled}
                    locked={chapter !== undefined}
                    describedBy={note}
                    onChange={(value) => {
                      setOverride(def.key, value)
                    }}
                  />
                </Fragment>
              )
            })
          ) : (
            <p className="text-dim py-3 text-[12.5px] leading-[1.5]">Pick a process to change how it prints.</p>
          )}
        </div>
        <p className="text-faint mt-3 text-[11.5px] leading-[1.5]">
          Temperatures, speeds and cooling come with the filament and process.
        </p>
      </section>
    </div>
  )
}

/** Which chapter of the training unlocks what's under it, with the way there. */
function LockNote({ id, chapter }: { id: string; chapter: string }) {
  return (
    <p id={id} className="text-dim flex items-start gap-1.5 py-1.5 text-[12px] leading-[1.5]">
      <Lock aria-hidden="true" className="mt-[3px] size-3 shrink-0" strokeWidth={1.6} />
      <span>
        Locked. Training chapter:{' '}
        <Link
          to={chapterLink(chapter)}
          className="text-primary underline underline-offset-2 hover:text-base-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {CHAPTER_TITLES[chapter]}
        </Link>
      </span>
    </p>
  )
}
