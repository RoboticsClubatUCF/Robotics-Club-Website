import { useCallback, useEffect, useId, useState } from 'react'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { FormPanel, fieldClass, labelClass } from '../shared/formChrome'
import { InfoTip } from '../shared/InfoTip'
import { ApiError, deleteJson, getJson, postJson, putJson } from '../../lib/api/api'
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

type Message = { tone: 'error' | 'success'; text: string } | null
type WithReport = ApiGoogleCalendar & { report: ApiGoogleCalendarReport }

const summary = ({ created, updated, removed }: ApiGoogleCalendarReport) =>
  created + updated + removed === 0
    ? 'Up to date.'
    : `${String(created)} added, ${String(updated)} updated, ${String(removed)} removed.`

/**
 * The club Google Calendar the site imports from, on the events desk for officers. The server
 * (`routes/officer/googleCalendar.ts`) never returns the secret address, only which calendar it
 * reads, so there is nothing here to reveal or copy.
 */
export function GoogleCalendarPanel({ onImported }: { onImported: () => Promise<void> }) {
  const id = useId()
  const [status, setStatus] = useState<ApiGoogleCalendar | null>(null)
  const [failed, setFailed] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setStatus(await getJson<ApiGoogleCalendar>('/officer/google-calendar', signal, true))
      setFailed(false)
    } catch {
      if (!signal?.aborted) setFailed(true)
    }
  }, [])

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
        // A failed import (502) is kept on the settings row, and the status line already says it.
        if (!(error instanceof ApiError && error.status === 502)) {
          setMessage({ tone: 'error', text: explainApiError(error) })
        }
        await load()
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const connect = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const raw = new FormData(event.currentTarget).get('url')
    const url = typeof raw === 'string' ? raw.trim() : ''
    run(async () => {
      const result = await putJson<WithReport>('/officer/google-calendar', { url })
      setStatus(result)
      setReplacing(false)
      return `Connected. ${summary(result.report)}`
    })
  }

  const importNow = () => {
    run(async () => {
      const result = await postJson<WithReport>('/officer/google-calendar/sync', {})
      setStatus(result)
      return summary(result.report)
    })
  }

  const disconnect = () => {
    run(async () => {
      const result = await deleteJson<ApiGoogleCalendar>('/officer/google-calendar')
      setStatus(result)
      setConfirming(false)
      return 'Disconnected.'
    })
  }

  const connected = status?.calendar != null

  return (
    <FormPanel>
      <p className={panelLabel}>GOOGLE CALENDAR</p>

      {status === null && !failed && (
        <div aria-busy="true" className="bg-base-300 h-10 w-full animate-pulse rounded-[2px]" />
      )}

      {failed && (
        <p className="text-dim text-sm leading-[1.7]">
          We couldn&rsquo;t load this just now. Try again in a moment.
        </p>
      )}

      {status && connected && !replacing && (
        <div className="space-y-4">
          <div>
            <p className="text-sm break-all">
              Importing from <span className="font-medium">{status.calendar}</span>
            </p>
            {status.syncError ? (
              <p className="text-error mt-1 text-[13px] leading-[1.5]">
                Last import failed. {status.syncError}
              </p>
            ) : (
              <p className="text-faint mt-1 font-mono text-[10px] font-medium tracking-[0.1em]">
                {status.syncedAt
                  ? `LAST IMPORT ${ago(status.syncedAt).toUpperCase()}`
                  : 'NOT IMPORTED YET'}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <button type="button" className={secondaryButton} disabled={busy} onClick={importNow}>
              {busy ? 'WORKING…' : 'IMPORT NOW'}
            </button>
            <button
              type="button"
              className={smallButton}
              disabled={busy}
              onClick={() => {
                setReplacing(true)
                setMessage(null)
              }}
            >
              CHANGE ADDRESS
            </button>
            <button
              type="button"
              className={dangerButton}
              disabled={busy}
              onClick={() => {
                setConfirming(true)
              }}
            >
              DISCONNECT
            </button>
          </div>
        </div>
      )}

      {status && (!connected || replacing) && (
        <form onSubmit={connect} className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-center gap-1 [&>label]:mb-0">
              <label htmlFor={`${id}-url`} className={labelClass}>
                SECRET ADDRESS IN ICAL FORMAT
              </label>
              <InfoTip label="Secret address in iCal format">
                In Google Calendar, open the club calendar&rsquo;s settings and copy it from
                Integrate calendar. Its events then copy here every ten minutes.
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
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <button type="submit" className={secondaryButton} disabled={busy}>
              {busy ? 'CONNECTING…' : 'CONNECT'}
            </button>
            {replacing && (
              <button
                type="button"
                className={smallButton}
                disabled={busy}
                onClick={() => {
                  setReplacing(false)
                  setMessage(null)
                }}
              >
                CANCEL
              </button>
            )}
          </div>
        </form>
      )}

      {message && (
        <p role="status" className="mt-4 text-[13px] leading-[1.5]">
          <span className={message.tone === 'error' ? 'text-error' : 'text-success'}>
            {message.text}
          </span>
        </p>
      )}

      {confirming && (
        <ConfirmDialog
          title="Stop importing from Google Calendar?"
          confirmLabel="DISCONNECT"
          busy={busy}
          onConfirm={disconnect}
          onDismiss={() => {
            setConfirming(false)
          }}
        >
          <p>Events already imported stay on the calendar and become editable here.</p>
        </ConfirmDialog>
      )}
    </FormPanel>
  )
}
