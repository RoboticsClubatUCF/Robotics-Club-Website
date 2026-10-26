import { useCallback, useEffect, useId, useState } from 'react'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { EventCalendarCheckbox } from '../shared/EventCalendarCheckbox'
import { FormPanel, fieldClass, labelClass } from '../shared/formChrome'
import { InfoTip } from '../shared/InfoTip'
import { deleteJson, getJson, patchJson, postJson, putJson } from '../../lib/api/api'
import type { ApiGoogleCalendar, ApiGoogleCalendarReport } from '../../lib/api/api'
import { explainApiError } from '../../lib/api/apiErrors'
import { ago } from '../../lib/format/formats'

const panelLabel = 'text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]'
const secondaryButton =
  'btn btn-outline h-auto min-h-0 border-base-content/28 px-5 py-2.5 text-[12px] font-semibold text-base-content hover:border-base-content hover:bg-base-content/6 hover:text-base-content disabled:opacity-60'
const smallButton =
  'text-faint hover:text-primary cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50'
const dangerButton =
  'text-faint hover:text-error cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50'

/** Mirrors `MAX_CALENDARS` in `server/src/calendar/googleCalendar.ts`; the server refuses past it. */
const MAX_CALENDARS = 10

type Message = { tone: 'error' | 'success'; text: string } | null
type Written = { calendars: ApiGoogleCalendar[]; report: ApiGoogleCalendarReport & { failed?: number } }

const summary = ({ created, updated, removed, failed = 0 }: Written['report']) => {
  const changed = created + updated + removed > 0
  const counts = changed
    ? `${String(created)} added, ${String(updated)} updated, ${String(removed)} removed.`
    : ''
  if (failed > 0) {
    return `${counts} ${String(failed)} ${failed === 1 ? 'calendar' : 'calendars'} failed to import.`.trim()
  }
  return counts || 'Up to date.'
}

const labelFor = (calendar: ApiGoogleCalendar) =>
  calendar.name ?? calendar.calendar ?? 'Google Calendar'

/**
 * The Google Calendars the site imports from: the club's on the events desk for officers, or one
 * project's on its manage page for its lead. Both ends are `calendar/calendarRoutes.ts` on the
 * server, which never returns an address, only which calendar each reads, so there is nothing here
 * to reveal or copy.
 *
 * A project's calendars each say whether their events also go on the public calendar; the club's
 * always do, so they have no switch.
 */
export function GoogleCalendarPanel({
  basePath,
  project = false,
  onImported = () => Promise.resolve(),
}: {
  /** `/officer/google-calendars` or `/projects/:id/google-calendars`. */
  basePath: string
  project?: boolean
  /** Called after anything that may have changed the events, so the page can reload them. */
  onImported?: () => Promise<void>
}) {
  const [calendars, setCalendars] = useState<ApiGoogleCalendar[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [changing, setChanging] = useState<string | null>(null)
  const [removing, setRemoving] = useState<ApiGoogleCalendar | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message>(null)
  const [adds, setAdds] = useState(0)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setCalendars(await getJson<ApiGoogleCalendar[]>(basePath, signal, true))
      setFailed(false)
    } catch {
      if (!signal?.aborted) setFailed(true)
    }
  }, [basePath])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => {
      controller.abort()
    }
  }, [load])

  const run = (action: () => Promise<string>) => {
    setBusy(true)
    setMessage(null)
    action()
      .then(async (text) => {
        setMessage({ tone: 'success', text })
        await onImported()
      })
      .catch(async (error: unknown) => {
        setMessage({ tone: 'error', text: explainApiError(error) })
        await load()
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const add = (url: string, published: boolean) => {
    run(async () => {
      const result = await postJson<Written>(basePath, project ? { url, published } : { url })
      setCalendars(result.calendars)
      // A fresh, empty field for the next one.
      setAdds((count) => count + 1)
      return `Connected. ${summary(result.report)}`
    })
  }

  const change = (id: string, url: string) => {
    run(async () => {
      const result = await putJson<Written>(`${basePath}/${id}`, { url })
      setCalendars(result.calendars)
      setChanging(null)
      return `Address changed. ${summary(result.report)}`
    })
  }

  const importNow = () => {
    run(async () => {
      const result = await postJson<Written>(`${basePath}/sync`, {})
      setCalendars(result.calendars)
      return summary(result.report)
    })
  }

  const remove = (calendar: ApiGoogleCalendar) => {
    run(async () => {
      const result = await deleteJson<{ calendars: ApiGoogleCalendar[] }>(
        `${basePath}/${calendar.id}`,
      )
      setCalendars(result.calendars)
      setRemoving(null)
      return `${labelFor(calendar)} disconnected.`
    })
  }

  const setPublished = (calendar: ApiGoogleCalendar, published: boolean) => {
    run(async () => {
      const result = await patchJson<{ calendars: ApiGoogleCalendar[] }>(
        `${basePath}/${calendar.id}`,
        { published },
      )
      setCalendars(result.calendars)
      return published
        ? `${labelFor(calendar)} is on the main calendar.`
        : `${labelFor(calendar)} is on the project calendar only.`
    })
  }

  return (
    <FormPanel>
      <p className={panelLabel}>GOOGLE CALENDARS</p>

      {calendars === null && !failed && (
        <div aria-busy="true" className="bg-base-300 h-10 w-full animate-pulse rounded-[2px]" />
      )}

      {failed && (
        <p className="text-dim text-sm leading-[1.7]">
          We couldn&rsquo;t load this just now. Try again in a moment.
        </p>
      )}

      {calendars && calendars.length > 0 && (
        <>
          <ul className="border-rule mb-4 divide-y divide-[var(--color-rule)] border-y">
            {calendars.map((calendar) => (
              <li key={calendar.id} className="py-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="truncate text-sm font-medium">{labelFor(calendar)}</p>
                    {calendar.name && calendar.calendar && (
                      <p className="text-faint truncate text-[12px]">{calendar.calendar}</p>
                    )}
                    {calendar.syncError ? (
                      <p className="text-error text-[13px] leading-[1.5]">
                        Last import failed. {calendar.syncError}
                      </p>
                    ) : (
                      <p className="text-faint font-mono text-[10px] font-medium tracking-[0.1em]">
                        {calendar.syncedAt
                          ? `LAST IMPORT ${ago(calendar.syncedAt).toUpperCase()}`
                          : 'NOT IMPORTED YET'}
                      </p>
                    )}
                    {project && (
                      <label className="mt-2 flex cursor-pointer items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={calendar.published}
                          disabled={busy}
                          onChange={(event) => {
                            setPublished(calendar, event.target.checked)
                          }}
                          className="checkbox checkbox-sm border-rule mt-0.5"
                        />
                        <span className="text-dim text-[13px] leading-[1.5]">
                          Show on the main calendar
                        </span>
                      </label>
                    )}
                  </div>
                  <div className="flex gap-4">
                    <button
                      type="button"
                      className={smallButton}
                      disabled={busy}
                      aria-label={`Change address of ${labelFor(calendar)}`}
                      onClick={() => {
                        setChanging(changing === calendar.id ? null : calendar.id)
                        setMessage(null)
                      }}
                    >
                      CHANGE ADDRESS
                    </button>
                    <button
                      type="button"
                      className={dangerButton}
                      disabled={busy}
                      aria-label={`Disconnect ${labelFor(calendar)}`}
                      onClick={() => {
                        setRemoving(calendar)
                      }}
                    >
                      DISCONNECT
                    </button>
                  </div>
                </div>

                {changing === calendar.id && (
                  <AddressForm
                    label="NEW SECRET ADDRESS"
                    submitLabel="SAVE"
                    busy={busy}
                    onSubmit={(url) => {
                      change(calendar.id, url)
                    }}
                    onCancel={() => {
                      setChanging(null)
                    }}
                  />
                )}
              </li>
            ))}
          </ul>

          <button type="button" className={secondaryButton} disabled={busy} onClick={importNow}>
            {busy ? 'WORKING…' : 'IMPORT NOW'}
          </button>
        </>
      )}

      {calendars && calendars.length < MAX_CALENDARS && (
        <AddressForm
          key={adds}
          label={calendars.length > 0 ? 'ADD ANOTHER CALENDAR' : 'SECRET ADDRESS IN ICAL FORMAT'}
          submitLabel="CONNECT"
          busy={busy}
          spaced={calendars.length > 0}
          withVisibility={project}
          onSubmit={add}
        />
      )}

      {message && (
        <p role="status" className="mt-4 text-[13px] leading-[1.5]">
          <span className={message.tone === 'error' ? 'text-error' : 'text-success'}>
            {message.text}
          </span>
        </p>
      )}

      {removing && (
        <ConfirmDialog
          title={`Stop importing from ${labelFor(removing)}?`}
          confirmLabel="DISCONNECT"
          busy={busy}
          onConfirm={() => {
            remove(removing)
          }}
          onDismiss={() => {
            setRemoving(null)
          }}
        >
          <p>Its events stay on the calendar and become editable here.</p>
        </ConfirmDialog>
      )}
    </FormPanel>
  )
}

/** The one field every address goes through: adding a calendar, or replacing one's address. */
function AddressForm({
  label,
  submitLabel,
  busy,
  spaced = false,
  withVisibility = false,
  onSubmit,
  onCancel,
}: {
  label: string
  submitLabel: string
  busy: boolean
  spaced?: boolean
  /** A project calendar's first choice: its events on the main calendar, or the project's only. */
  withVisibility?: boolean
  onSubmit: (url: string, published: boolean) => void
  onCancel?: () => void
}) {
  const id = useId()

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const raw = data.get('url')
        onSubmit(typeof raw === 'string' ? raw.trim() : '', data.get('published') === 'on')
      }}
      className={`space-y-4 ${spaced ? 'mt-6' : onCancel ? 'mt-3' : ''}`}
    >
      <div>
        <div className="mb-1.5 flex items-center gap-1 [&>label]:mb-0">
          <label htmlFor={`${id}-url`} className={labelClass}>
            {label}
          </label>
          <InfoTip label="Secret address in iCal format">
            In Google Calendar, open the calendar&rsquo;s settings and copy &ldquo;Secret address
            in iCal format&rdquo; from Integrate calendar. Its events then copy here every ten
            minutes.
          </InfoTip>
        </div>
        <input
          id={`${id}-url`}
          name="url"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="https://calendar.google.com/calendar/ical/…"
          className={fieldClass}
          disabled={busy}
        />
      </div>
      {withVisibility && <EventCalendarCheckbox disabled={busy} />}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <button type="submit" className={secondaryButton} disabled={busy}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className={smallButton} disabled={busy} onClick={onCancel}>
            CANCEL
          </button>
        )}
      </div>
    </form>
  )
}
