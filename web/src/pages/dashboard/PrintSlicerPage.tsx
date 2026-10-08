import { type ReactNode, useEffect, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router'
import { ClaimFree } from '../../components/dashboard/ClaimFree'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { DuesLocked } from '../../components/dashboard/DuesLocked'
import { MembersOnly } from '../../components/dashboard/MembersOnly'
import { SlicerWorkspace } from '../../components/slicer/SlicerWorkspace'
import { FormEyebrow, FormHeading, FormPage, FormPanel } from '../../components/shared/formChrome'
import { ApiError, getJson } from '../../lib/api/api'
import type { ApiPrintAllowance, ApiSlicerWorkspace } from '../../lib/api/api'
import { accessLock } from '../../lib/dues/dues'

/**
 * `/dashboard/print/slicer` and `/dashboard/print/slicer/:id`: slicing a filament plate.
 *
 * Without an id it's a new, empty plate; the first model uploaded makes the draft and the address
 * moves to it. The dashboard drops its rail here so the plate gets the whole width, the way a
 * slicer does.
 */
export function PrintSlicerPage() {
  const dashboard = useOutletContext<DashboardContext | null>()
  const lock = dashboard ? accessLock(dashboard.membership, dashboard.user.role) : null

  if (lock === 'claim') return <Padded><ClaimFree eyebrow="/ 3D PRINTING" thing="The printers" /></Padded>
  if (lock === 'newcomer') return <Padded><MembersOnly eyebrow="/ 3D PRINTING" thing="The printers" /></Padded>
  if (lock === 'dues') return <Padded><DuesLocked eyebrow="/ 3D PRINTING" /></Padded>

  return <Slicer projects={dashboard?.projects} />
}

function Padded({ children }: { children: ReactNode }) {
  return <div className="px-page py-9 wide:py-12">{children}</div>
}

type Load =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; workspace: ApiSlicerWorkspace; allowance: ApiPrintAllowance | null }

function Slicer({ projects }: { projects: DashboardContext['projects'] | undefined }) {
  const { id } = useParams()
  const [load, setLoad] = useState<Load>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    void Promise.allSettled([
      getJson<ApiSlicerWorkspace>('/print/workspace', controller.signal),
      getJson<ApiPrintAllowance>('/me/print-allowance', controller.signal),
    ]).then(([workspace, allowance]) => {
      if (controller.signal.aborted) return
      if (workspace.status === 'rejected') {
        const error: unknown = workspace.reason
        setLoad({
          status: 'failed',
          message:
            // The server says which: no printers set up yet, or the slicer is down.
            error instanceof ApiError && error.status === 503
              ? (error.detail ?? 'The slicer is unavailable right now. Try again later.')
              : `We couldn't reach the server. Try again in a moment.`,
        })
        return
      }
      setLoad({
        status: 'ready',
        workspace: workspace.value,
        allowance: allowance.status === 'fulfilled' ? allowance.value : null,
      })
    })
    return () => {
      controller.abort()
    }
  }, [])

  if (load.status === 'loading') {
    return (
      <div aria-busy="true" className="flex h-[calc(100dvh-var(--spacing-nav))] flex-col">
        <div className="border-rule bg-base-200 h-12 border-b" />
        <div className="flex min-h-0 flex-1">
          <div className="border-rule bg-base-200 hidden w-[19rem] border-r wide:block" />
          <div className="flex-1" />
        </div>
      </div>
    )
  }

  if (load.status === 'failed') {
    return (
      <FormPage width="wide">
        <FormEyebrow>/ 3D PRINTING · SLICER</FormEyebrow>
        <FormHeading>The slicer didn't load.</FormHeading>
        <FormPanel tone="accent">
          <p className="text-dim text-sm leading-[1.7]">{load.message}</p>
          <Link to="/dashboard/print" className="text-primary mt-3 inline-block font-mono text-[11px] font-semibold tracking-[0.12em]">
            ‹ BACK TO PRINTING
          </Link>
        </FormPanel>
      </FormPage>
    )
  }

  return (
    <SlicerWorkspace
      draftId={id}
      workspace={load.workspace}
      projects={projects?.status === 'ready' ? projects.data : []}
      allowance={load.allowance}
    />
  )
}
