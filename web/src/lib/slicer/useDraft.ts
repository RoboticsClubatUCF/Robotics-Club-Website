import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { ApiError, deleteJson, getJson, patchJson, postForm, postJson } from '../api/api'
import type { ApiDraft, ApiPlacement, ApiPlateObject, ApiPrintRequest } from '../api/api'
import type { ProcessOverrides } from './processSettings'
import type { PlateChoice } from './profiles'

/**
 * One filament plate in the workspace: what the member sees, saving behind them as they work.
 *
 * Edits apply locally at once and are sent after a short pause, one request at a time, each naming
 * the revision it was made against. If another tab moved the plate on, the server answers 409 and
 * the plate is reloaded as it now stands; the member is told rather than having either tab's work
 * silently win. SLICE, adding a model and SUBMIT send anything unsaved first, because each of them
 * names a revision too.
 *
 * Before the first upload there is no draft yet: the settings chosen are held here, starting from
 * the workspace's defaults (`fresh`), and go with the file that creates it. From then on every call goes to that draft, even before the address bar
 * has caught up, so a batch of files dropped on an empty plate lands on one draft.
 */

export interface PlateSettings extends PlateChoice {
  overrides: ProcessOverrides
}

export interface Plate extends PlateSettings {
  objects: ApiPlateObject[]
}

type Edit = Partial<Plate>

export type DraftLoad =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'failed' }
  | { status: 'ready' }

/**
 * What the workspace needs from a plate. `useDraft` is the real one; the slicer training's
 * practice plate (`lib/training/usePracticePlate.ts`) keeps the same shape in the browser.
 */
export interface PlateSource {
  load: DraftLoad
  draft: ApiDraft | null
  plate: Plate
  edit: (change: Edit) => void
  preview: (placements: ReadonlyMap<string, Partial<ApiPlacement>>) => void
  reload: () => Promise<void>
  addModel: (file: File, object: { id: string } & ApiPlacement) => Promise<ApiDraft>
  slice: () => Promise<void>
  submit: (details: { projectId: string | null; notes: string }) => Promise<{ fileName: string }>
  saving: boolean
  unsaved: boolean
  notice: string | null
  clearNotice: () => void
}

const SAVE_DELAY = 400
const POLL_EVERY = 1_500

const plateOf = (draft: ApiDraft): Plate => ({
  printerId: draft.printerId,
  processId: draft.processId,
  filamentId: draft.filamentId,
  overrides: draft.overrides,
  objects: draft.objects,
})

/** Whether the worker still owes this plate something. */
export const working = (draft: ApiDraft | null): boolean =>
  !!draft &&
  (draft.slice?.state === 'QUEUED' ||
    draft.slice?.state === 'RUNNING' ||
    draft.models.some((model) => model.meshState === 'QUEUED' || model.meshState === 'RUNNING'))

export function useDraft(id: string | undefined, fresh: PlateChoice): PlateSource & {
  flush: () => Promise<void>
  discard: () => Promise<void>
} {
  const [load, setLoad] = useState<DraftLoad>(id ? { status: 'loading' } : { status: 'ready' })
  const [draft, setDraft] = useState<ApiDraft | null>(null)
  const [plate, setPlate] = useState<Plate>(() => ({ ...fresh, overrides: {}, objects: [] }))
  // Read when a different plate starts, not a reason to start one.
  const emptyPlate = useEffectEvent((): Plate => ({ ...fresh, overrides: {}, objects: [] }))
  const [saving, setSaving] = useState(false)
  // True from the first unsent edit until the server has it: the debounce counts, so REQUEST
  // PRINT can't send a slice the member has just changed the plate under.
  const [unsaved, setUnsaved] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // The draft every call goes to: the one in the address, or the one the first upload just made.
  const target = useRef(id)
  const revision = useRef(0)
  const pending = useRef<Edit | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Takes the server's word for everything, unless edits are still waiting to be sent. */
  const adopt = useCallback((next: ApiDraft) => {
    setDraft(next)
    revision.current = next.revision
    if (!pending.current) setPlate(plateOf(next))
  }, [])

  const reload = useCallback(async () => {
    const current = target.current
    if (!current) return
    try {
      const next = await getJson<ApiDraft>(`/print/drafts/${current}`, undefined, true)
      pending.current = null
      adopt(next)
      setLoad({ status: 'ready' })
    } catch (error) {
      setLoad(error instanceof ApiError && error.status === 404 ? { status: 'missing' } : { status: 'failed' })
    }
  }, [adopt])

  useEffect(() => {
    // Arriving at the draft the first upload made: it's already loaded.
    if (id && id === target.current && revision.current > 0) return
    // A different plate in the same tab starts clean.
    target.current = id
    revision.current = 0
    pending.current = null
    setDraft(null)
    setPlate(emptyPlate())
    setLoad(id ? { status: 'loading' } : { status: 'ready' })
    void reload()
  }, [id, reload])

  /** One save. False when it failed and the edit is still waiting. */
  const send = useCallback(async (): Promise<boolean> => {
    const current = target.current
    if (!current || !pending.current) return true
    const body = { revision: revision.current, ...pending.current }
    pending.current = null
    setSaving(true)
    try {
      adopt(await patchJson<ApiDraft>(`/print/drafts/${current}`, body))
      return true
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setNotice('This plate was changed in another tab. It has been reloaded as it is now.')
        await reload()
        return true
      } else {
        // Put the edit back so the next save carries it, under anything made since.
        const { revision: _seen, ...unsent } = body
        const since: Edit = pending.current ?? {}
        pending.current = { ...unsent, ...since }
        setNotice(
          error instanceof ApiError && error.detail
            ? error.detail
            : `Couldn't save the last change. It'll be tried again with the next one.`,
        )
        return false
      }
    } finally {
      setSaving(false)
    }
  }, [adopt, reload])

  /**
   * Sends whatever is waiting and resolves once the plate on the server matches this one, or
   * throws if a save fails, so SLICE and SUBMIT never go out against an older plate. A failed
   * save is tried again with the next edit, not in a loop.
   */
  const inFlight = useRef<Promise<boolean> | null>(null)
  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    while (inFlight.current || pending.current) {
      const running =
        inFlight.current ??
        (inFlight.current = send().finally(() => {
          inFlight.current = null
        }))
      if (!(await running)) throw new Error(`the plate couldn't be saved`)
    }
    setUnsaved(false)
  }, [send])

  const edit = useCallback(
    (change: Edit) => {
      setPlate((current) => ({ ...current, ...change }))
      if (!target.current) return
      pending.current = { ...pending.current, ...change }
      setUnsaved(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        flush().catch(() => {
          // The notice says so; the next edit tries again.
        })
      }, SAVE_DELAY)
    },
    [flush],
  )

  /** Moves a selection together without saving, for a drag in progress. */
  const preview = useCallback((placements: ReadonlyMap<string, Partial<ApiPlacement>>) => {
    setPlate((current) => ({
      ...current,
      objects: current.objects.map((object) =>
        placements.has(object.id) ? { ...object, ...placements.get(object.id) } : object,
      ),
    }))
  }, [])

  // Poll while the worker has something of ours: a STEP being meshed or a plate being sliced.
  const busy = working(draft)
  const polled = draft?.id
  useEffect(() => {
    if (!busy || !polled) return
    const handle = setInterval(() => {
      void getJson<ApiDraft>(`/print/drafts/${polled}`, undefined, true)
        .then(adopt)
        .catch(() => {
          // A missed poll is tried again on the next tick.
        })
    }, POLL_EVERY)
    return () => {
      clearInterval(handle)
    }
  }, [busy, polled, adopt])

  // A tab closed with an edit waiting still sends it.
  useEffect(() => {
    const leave = () => {
      if (pending.current) flush().catch(() => undefined)
    }
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('pagehide', leave)
      leave()
    }
  }, [flush])

  /** Uploads a model. Without a draft this creates one; the caller navigates to its address. */
  const addModel = useCallback(
    async (file: File, object: { id: string } & ApiPlacement): Promise<ApiDraft> => {
      const form = new FormData()
      form.append('file', file)
      form.append('object', JSON.stringify(object))
      if (!target.current) {
        const { objects: _objects, ...settings } = plate
        form.append('settings', JSON.stringify(settings))
        const created = await postForm<ApiDraft>('/print/drafts', form)
        target.current = created.id
        adopt(created)
        return created
      }
      await flush()
      form.append('revision', String(revision.current))
      const next = await postForm<ApiDraft>(`/print/drafts/${target.current}/models`, form)
      adopt(next)
      return next
    },
    [plate, flush, adopt],
  )

  const slice = useCallback(async () => {
    if (!target.current) return
    await flush()
    adopt(
      await postJson<ApiDraft>(`/print/drafts/${target.current}/slice`, { revision: revision.current }),
    )
  }, [flush, adopt])

  const submit = useCallback(
    async (details: { projectId: string | null; notes: string }) => {
      if (!target.current) throw new Error('nothing to submit')
      await flush()
      return postJson<ApiPrintRequest>(`/print/drafts/${target.current}/submit`, {
        revision: revision.current,
        projectId: details.projectId,
        notes: details.notes.trim() || null,
      })
    },
    [flush],
  )

  const discard = useCallback(async () => {
    if (!target.current) return
    if (timer.current) clearTimeout(timer.current)
    pending.current = null
    await deleteJson(`/print/drafts/${target.current}`)
  }, [])

  return {
    load,
    draft,
    plate,
    edit,
    preview,
    flush,
    reload,
    addModel,
    slice,
    submit,
    discard,
    saving,
    unsaved,
    notice,
    clearNotice: () => {
      setNotice(null)
    },
  }
}
