import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { explainApiError } from '../api/apiErrors'
import type { ApiProjectDetail } from '../api/api'

/**
 * One SAVE for a page made of five sections.
 *
 * The project editor used to save in three different ways at once: the writing
 * and the links waited for a button, the title and its cover waited for a
 * *second* button, and pictures, documents and member titles went up the moment
 * they were touched. Every one of those was defensible on its own, and together
 * they were a page nobody could predict — two buttons reading SAVE, neither of
 * them covering the thing somebody had just changed.
 *
 * So there is one button now, and this is what stands behind it. Each section
 * keeps its own draft state and hands up three things: whether it holds anything
 * unsaved, whether it is in a state that cannot be sent at all, and a function
 * that sends it. The button runs them **in a fixed order, one at a time**, and
 * stops at the first failure.
 *
 * **Sequential rather than `Promise.all`, and the ordering is not cosmetic.**
 * These writes share a rate-limit budget, and the gallery's order route refuses a
 * set of ids that does not match what it holds — which is exactly what it would
 * be handed mid-flight. Firing them together also makes the failure report
 * meaningless, because the caller cannot say which of five things the sentence
 * is about.
 *
 * **Everything that landed before a failure is applied anyway.** A save is not a
 * transaction — six requests cannot be one — so the honest thing is to show the
 * four that worked as saved and name the section that did not. Pressing SAVE
 * again then retries the rest instead of uploading the first four photos twice.
 */
export type SectionSave = () => Promise<Partial<ApiProjectDetail> | void>

/** What a section reports upward on every render. */
export type SectionState = {
  dirty: boolean
  /**
   * Why the page cannot be saved at all, or null. One sentence, shown beside the
   * button, which is disabled while any section says anything here.
   *
   * For the *page's* sake rather than the section's: a blank title is refused by
   * the server with a 400, and finding that out after four uploads have already
   * gone is a worse way to learn it than a disabled button.
   */
  blocked?: string | null
  save: SectionSave
}

export type SaveRegistry = {
  register: (name: string, state: SectionState) => void
  forget: (name: string) => void
}

/** A section of the editor, in the order its writes go out. */
export type SaveSection = {
  name: string
  /** What the status line calls it when its save is the one that failed. */
  label: string
}

export function useEditorSaves(
  sections: readonly SaveSection[],
  project: ApiProjectDetail,
  apply: (project: ApiProjectDetail) => void,
) {
  /**
   * What each section last reported, read at the moment of the press.
   *
   * A ref rather than the state below because both halves are needed *then*: the
   * newest closure over the draft, and whether that draft holds anything at all.
   * **A section with nothing to save is skipped**, which is what keeps an
   * untouched gallery from costing a reorder and an untouched title from costing
   * a patch — five sections share one rate-limit budget under one button.
   */
  const saves = useRef(new Map<string, SectionState>())
  const [reported, setReported] = useState<
    Record<string, { dirty: boolean; blocked: string | null }>
  >({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [saved, setSaved] = useState(false)

  /**
   * The project and the applier as of this render.
   *
   * Read through a ref because `save` runs long after the render that built it,
   * and because the sections' saves run inside one press: each returns the part
   * of the project it wrote, they are merged here, and the merge is handed
   * upward once. Applying per section instead would have each of them spreading
   * a `project` from before the ones ahead of it, and the last write would
   * quietly undo the rest.
   */
  const latest = useRef({ project, apply })
  latest.current = { project, apply }

  const register = useCallback((name: string, state: SectionState) => {
    saves.current.set(name, state)

    const blocked = state.blocked ?? null
    setReported((current) =>
      current[name]?.dirty === state.dirty && current[name]?.blocked === blocked
        ? current
        : { ...current, [name]: { dirty: state.dirty, blocked } },
    )
  }, [])

  const forget = useCallback((name: string) => {
    saves.current.delete(name)
    setReported((current) => {
      if (!(name in current)) return current
      const next = { ...current }
      delete next[name]
      return next
    })
  }, [])

  const registry = useMemo<SaveRegistry>(
    () => ({ register, forget }),
    [register, forget],
  )

  const dirty = Object.values(reported).some((section) => section.dirty)
  const blocked =
    Object.values(reported).find((section) => section.blocked)?.blocked ?? null

  /** Resolves to whether the whole page went up, which is what the caller needs
      to decide whether the listing's cached copy is now worth replacing. */
  const save = useCallback(async (): Promise<boolean> => {
    setBusy(true)
    setMessage('')
    setSaved(false)

    let merged = latest.current.project
    let failure: string | null = null

    for (const section of sections) {
      const held = saves.current.get(section.name)
      if (!held || !held.dirty) continue

      try {
        const part = await held.save()
        if (part) merged = { ...merged, ...part }
      } catch (error) {
        failure = `${section.label}: ${explainApiError(error)}`
        break
      }
    }

    latest.current.apply(merged)
    setMessage(failure ?? '')
    setSaved(failure === null)
    setBusy(false)

    return failure === null
  }, [sections])

  return { registry, dirty, blocked, busy, saved, message, save }
}

/**
 * The section's half of the arrangement, in one line.
 *
 * **No dependency array on the first effect, on purpose.** `save` closes over
 * this render's draft state, and the registry has to be holding the newest one
 * when the button is finally pressed — a stale closure here would send the text
 * as it was several keystrokes ago. Re-registering costs a `Map.set`, and what
 * is reported is written through a bail-out, so an unchanged section does not
 * re-render anybody.
 */
export function useSectionSave(
  registry: SaveRegistry,
  name: string,
  state: SectionState,
): void {
  useEffect(() => {
    registry.register(name, state)
  })

  useEffect(
    () => () => {
      registry.forget(name)
    },
    [registry, name],
  )
}
