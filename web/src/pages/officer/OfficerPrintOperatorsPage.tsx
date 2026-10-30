import { useEffect, useRef, useState } from 'react'
import { useOutletContext } from 'react-router'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { DuesLocked } from '../../components/dashboard/DuesLocked'
import { OfficerOnly } from '../../components/dashboard/OfficerOnly'
import { SubNav } from '../../components/dashboard/SubNav'
import { dangerButton, loudButton } from '../../components/dashboard/queueChrome'
import { ConfirmDialog } from '../../components/shared/ConfirmDialog'
import { InfoTip } from '../../components/shared/InfoTip'
import { MemberSearch } from '../../components/shared/MemberSearch'
import { Status } from '../../components/shared/Status'
import { FormEyebrow, FormHeading, FormPanel } from '../../components/shared/formChrome'
import { deleteJson, getJson, putJson } from '../../lib/api/api'
import type { ApiOfficerMember, ApiPrintOperator } from '../../lib/api/api'
import { explainApiError } from '../../lib/api/apiErrors'
import { isOfficer } from '../../lib/auth/session'
import { PRINT_QUEUE_PAGES } from '../../lib/dashboard/subPages'
import { duesLocked, formatDate } from '../../lib/dues/dues'

const EYEBROW = '/ MANAGE · PRINT QUEUE · OPERATORS'

const panelLabel = 'text-faint font-mono text-[10px] font-medium tracking-[0.16em]'

const byName = (a: ApiPrintOperator, b: ApiPrintOperator) => a.fullName.localeCompare(b.fullName)

/**
 * Who besides the officers may run the print queue.
 *
 * An officer picks a member and lets them in; the server checks their dues and the slicer
 * training, and the Discord bot gives them Print Crew. Taking it back removes both.
 */
export function OfficerPrintOperatorsPage() {
  const { user, membership } = useOutletContext<DashboardContext>()

  if (duesLocked(membership, user.role)) return <DuesLocked eyebrow={EYEBROW} />

  if (!isOfficer(user.role)) {
    return <OfficerOnly eyebrow={EYEBROW} why="Who runs the printers is the officers' call." />
  }

  return (
    <>
      <FormEyebrow>{EYEBROW}</FormEyebrow>
      <FormHeading>Print operators.</FormHeading>
      <SubNav label="Print queue pages" pages={PRINT_QUEUE_PAGES} />
      <div className="max-w-[46rem]">
        <OperatorsDesk />
      </div>
    </>
  )
}

function OperatorsDesk() {
  const [operators, setOperators] = useState<ApiPrintOperator[] | null | 'loading'>('loading')
  const [member, setMember] = useState<ApiOfficerMember | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'ok' } | null>(null)
  const [removing, setRemoving] = useState<ApiPrintOperator | null>(null)
  // After a grant or a removal the pressed button is disabled or gone, so focus moves to the
  // list it changed. A counter, so the effect runs after the dialog has handed focus back.
  const list = useRef<HTMLParagraphElement>(null)
  const [changed, setChanged] = useState(0)

  useEffect(() => {
    if (changed > 0) list.current?.focus()
  }, [changed])

  useEffect(() => {
    const controller = new AbortController()

    getJson<ApiPrintOperator[]>('/officer/print-operators', controller.signal)
      .then(setOperators)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        console.error(error)
        setOperators(null)
      })

    return () => {
      controller.abort()
    }
  }, [])

  const grant = () => {
    if (!member) return

    setBusy(true)
    setMessage(null)
    putJson<ApiPrintOperator>(`/officer/print-operators/${member.id}`, {})
      .then((added) => {
        setOperators((current) =>
          Array.isArray(current)
            ? [...current.filter((row) => row.id !== added.id), added].sort(byName)
            : current,
        )
        setMessage({ text: `${added.fullName} can run the print queue.`, tone: 'ok' })
        setMember(null)
        setChanged((count) => count + 1)
      })
      .catch((error: unknown) => {
        setMessage({ text: explainApiError(error), tone: 'error' })
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const remove = (operator: ApiPrintOperator) => {
    setBusy(true)
    setMessage(null)
    deleteJson<{ removed: boolean }>(`/officer/print-operators/${operator.id}`)
      .then(() => {
        setOperators((current) =>
          Array.isArray(current) ? current.filter((row) => row.id !== operator.id) : current,
        )
        setMessage({ text: `${operator.fullName} no longer runs the print queue.`, tone: 'ok' })
        setRemoving(null)
        setChanged((count) => count + 1)
      })
      .catch((error: unknown) => {
        setMessage({ text: explainApiError(error), tone: 'error' })
        setRemoving(null)
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <div className="space-y-5">
      <FormPanel>
        <div className="mb-4 flex items-center gap-1">
          <p className={panelLabel}>LET SOMEONE IN</p>
          <InfoTip label="Let someone in">
            They need current dues and the slicer training. Operators start and finish other
            members' prints. Declining and going past someone's allowance stay with officers.
          </InfoTip>
        </div>

        <div className="space-y-4">
          <MemberSearch picked={member} onPick={setMember} disabled={busy} label="WHO" />

          <button type="button" disabled={busy || !member} onClick={grant} className={loudButton}>
            LET THEM IN
          </button>
        </div>

        {message && <Status message={message.text} tone={message.tone} />}
      </FormPanel>

      <FormPanel>
        <p
          ref={list}
          tabIndex={-1}
          className={`${panelLabel} mb-4 focus-visible:outline-primary focus-visible:outline-2 focus-visible:outline-offset-2`}
        >
          OPERATORS
        </p>

        {operators === 'loading' && (
          <div aria-busy="true" className="space-y-2.5">
            <div className="bg-base-300 h-4 w-2/3 animate-pulse rounded-[2px]" />
            <div className="bg-base-300 h-3 w-1/2 animate-pulse rounded-[2px]" />
          </div>
        )}

        {operators === null && (
          <p className="text-dim text-sm leading-[1.7]">
            We couldn't load the operators just now.
          </p>
        )}

        {Array.isArray(operators) &&
          (operators.length === 0 ? (
            <p className="text-dim text-sm leading-[1.7]">Nobody yet. Officers run the queue.</p>
          ) : (
            <ul className="divide-rule divide-y">
              {operators.map((operator) => (
                <li
                  key={operator.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
                      <span className="min-w-0 wrap-anywhere">{operator.fullName}</span>
                      {/* The grant stays while dues lapse, and the queue stays shut until they
                          pay. Said so the officer knows why they can't get in. */}
                      {!operator.active && (
                        <span className="text-error font-mono text-[10px] font-medium tracking-[0.16em]">
                          DUES LAPSED
                        </span>
                      )}
                    </p>
                    <p className="text-faint mt-0.5 text-[12px] leading-[1.5] wrap-anywhere">
                      {operator.discordUsername && `@${operator.discordUsername} · `}
                      Since {formatDate(operator.grantedAt)}
                      {operator.grantedBy && `, by ${operator.grantedBy.fullName}`}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setRemoving(operator)
                    }}
                    className={dangerButton}
                    aria-label={`Remove ${operator.fullName}`}
                  >
                    REMOVE
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </FormPanel>

      {removing && (
        <ConfirmDialog
          title={`Take the print queue from ${removing.fullName}?`}
          confirmLabel="REMOVE"
          busy={busy}
          onConfirm={() => {
            remove(removing)
          }}
          onDismiss={() => {
            setRemoving(null)
          }}
        >
          <p>They lose the Print Crew role in Discord too. You can let them back in later.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
