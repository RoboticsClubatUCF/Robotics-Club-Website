import { useId, useState } from 'react'
import type { ApiSlicerWorkspace, PrintPreset } from '../../lib/api/api'
import {
  PROCESS_SETTINGS,
  type ProcessOverrides,
  type SettingTab,
  TABS,
} from '../../lib/slicer/processSettings'
import type { PlateSettings } from '../../lib/slicer/useDraft'
import { SettingField } from './SettingField'
import { panelHeading, smallSelect } from './slicerChrome'

/**
 * The left column, in Orca's order: the printer, the filament, the process preset, then the
 * preset's settings by tab. Everything here applies to the whole plate.
 *
 * The printer isn't a choice: the club has one filament printer, and its profile is the approved
 * one. Temperatures and speeds come with the filament and preset and aren't offered at all.
 */
export function SettingsPanel({
  profiles,
  settings,
  disabled,
  onChange,
}: {
  profiles: ApiSlicerWorkspace['profiles']
  settings: PlateSettings
  disabled: boolean
  onChange: (change: Partial<PlateSettings>) => void
}) {
  const id = useId()
  const [tab, setTab] = useState<SettingTab>('quality')
  const preset = profiles.presets.find((p) => p.key === settings.preset) ?? profiles.presets[0]!

  const setOverride = (key: string, value: ProcessOverrides[string]) => {
    const next = { ...settings.overrides }
    // Back to the preset's value is the same as not having changed it.
    if (value === undefined || value === preset.values[key]) delete next[key]
    else next[key] = value
    onChange({ overrides: next })
  }

  const changedIn = (key: SettingTab) =>
    PROCESS_SETTINGS.filter((def) => def.tab === key && settings.overrides[def.key] !== undefined)
      .length

  return (
    <div className="space-y-5 p-4">
      <section aria-labelledby={`${id}-printer`}>
        <h2 id={`${id}-printer`} className={`${panelHeading} mb-2`}>
          PRINTER
        </h2>
        <p className="text-sm font-medium">{profiles.printer.name}</p>
        <p className="text-faint mt-0.5 font-mono text-[10px] tracking-[0.12em] uppercase">
          {profiles.printer.model} · {profiles.printer.nozzle} mm nozzle · {profiles.printer.bedType}
        </p>
      </section>

      <section aria-labelledby={`${id}-filament`}>
        <h2 id={`${id}-filament`} className={`${panelHeading} mb-2`}>
          FILAMENT
        </h2>
        <select
          aria-labelledby={`${id}-filament`}
          value={settings.material}
          disabled={disabled}
          onChange={(event) => {
            onChange({ material: event.target.value as PlateSettings['material'] })
          }}
          className={smallSelect}
        >
          {profiles.materials.map((material) => (
            <option key={material.key} value={material.key}>
              {material.key} · {material.name}
            </option>
          ))}
        </select>
      </section>

      <section aria-labelledby={`${id}-process`}>
        <h2 id={`${id}-process`} className={`${panelHeading} mb-2`}>
          PROCESS
        </h2>
        <select
          aria-labelledby={`${id}-process`}
          aria-describedby={`${id}-process-about`}
          value={settings.preset}
          disabled={disabled}
          onChange={(event) => {
            onChange({ preset: event.target.value as PrintPreset })
          }}
          className={smallSelect}
        >
          {profiles.presets.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
        <p id={`${id}-process-about`} className="text-faint mt-1.5 text-[12px] leading-[1.5]">
          {preset.description[0]!.toUpperCase()}
          {preset.description.slice(1)}.
        </p>
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
            return (
              <button
                key={option.key}
                id={`${id}-tab-${option.key}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`${id}-panel`}
                aria-label={count > 0 ? `${option.label}, ${String(count)} changed` : undefined}
                tabIndex={active ? 0 : -1}
                onClick={() => {
                  setTab(option.key)
                }}
                className={`-mb-px inline-flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1 border-b-2 px-1 font-mono text-[10px] font-medium tracking-[0.06em] whitespace-nowrap uppercase transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary wide:min-h-9 ${
                  active ? 'border-primary text-primary' : 'text-dim hover:text-base-content border-transparent'
                }`}
              >
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
          {PROCESS_SETTINGS.filter((def) => def.tab === tab).map((def) => (
            <SettingField
              key={def.key}
              def={def}
              value={settings.overrides[def.key]}
              presetValue={preset.values[def.key]!}
              disabled={disabled}
              onChange={(value) => {
                setOverride(def.key, value)
              }}
            />
          ))}
        </div>
        <p className="text-faint mt-3 text-[11.5px] leading-[1.5]">
          Temperatures, speeds and cooling come with the filament and preset.
        </p>
      </section>
    </div>
  )
}
