import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { type ApiTraining, getJson, putJson } from '../api/api'

/**
 * Where somebody is in the slicer training, kept on the server (`/api/print/training`) so it
 * follows them from one device to another. The chapters finished are what the slicer reads: each
 * optional one unlocks its settings, and they're only ever added.
 *
 * Saves go one at a time, the latest state each time, so a slow save can't land after a newer
 * one. The place used to be kept in the browser; whatever a member has there is uploaded once, the
 * first time the page finds nothing on the server.
 */

export interface TrainingProgress {
  /** Ids of the steps finished. */
  done: string[]
  /** The step they were on. */
  at: string | null
  /** Tasks started over but not finished again, including after completing the training. */
  restarted: string[]
  /** Chapters finished, required and optional. */
  chapters: string[]
}

export type TrainingLoad = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; trainedAt: string | null }

const EMPTY: TrainingProgress = { done: [], at: null, restarted: [], chapters: [] }

const legacyKey = (userId: string) => `rccf.slicer-training.${userId}`

const strings = (value: unknown) => (Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [])

/** What an older version of the page kept in this browser, if anything. */
export function readLegacyProgress(userId: string): Omit<TrainingProgress, 'chapters'> | null {
  try {
    const raw = localStorage.getItem(legacyKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { done?: unknown; at?: unknown; restarted?: unknown }
    return {
      done: strings(parsed.done),
      at: typeof parsed.at === 'string' ? parsed.at : null,
      restarted: strings(parsed.restarted),
    }
  } catch {
    return null
  }
}

function forgetLegacyProgress(userId: string) {
  try {
    localStorage.removeItem(legacyKey(userId))
  } catch {
    // Blocked storage has nothing in it to upload again.
  }
}

/**
 * `finished` says which chapters a set of steps completes; every change adds those to the
 * chapters, which nothing takes away.
 */
export function useTrainingProgress(userId: string, finished: (done: readonly string[]) => string[]) {
  const [load, setLoad] = useState<TrainingLoad>({ status: 'loading' })
  const [progress, setProgress] = useState<TrainingProgress>(EMPTY)
  const [saveFailed, setSaveFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const current = useRef(EMPTY)
  const pending = useRef<TrainingProgress | null>(null)
  const saving = useRef<Promise<boolean> | null>(null)
  const importing = useRef(false)

  const withChapters = (next: Omit<TrainingProgress, 'chapters'> & { chapters?: string[] }): TrainingProgress => ({
    ...next,
    chapters: [...new Set([...current.current.chapters, ...(next.chapters ?? []), ...finished(next.done)])],
  })

  /** Sends what's waiting, latest each time; true once the server has all of it. */
  const send = async () => {
    while (pending.current) {
      const body = pending.current
      pending.current = null
      try {
        await putJson<ApiTraining>('/print/training', {
          steps: body.done,
          at: body.at,
          restarted: body.restarted,
          chapters: body.chapters,
        })
        setSaveFailed(false)
        if (importing.current) {
          importing.current = false
          forgetLegacyProgress(userId)
        }
      } catch {
        // Carried by the next change, or SAVE AGAIN.
        pending.current ??= body
        setSaveFailed(true)
        return false
      }
    }
    return true
  }

  // A save already out picks up whatever is waiting when it's back, so a second one isn't started.
  const flush = () =>
    (saving.current ??= send().finally(() => {
      saving.current = null
    }))

  const adopt = (next: TrainingProgress) => {
    current.current = next
    setProgress(next)
  }

  const save = (next: TrainingProgress) => {
    adopt(next)
    pending.current = next
    void flush()
  }

  const loaded = useEffectEvent((saved: ApiTraining) => {
    current.current = { ...EMPTY, chapters: saved.chapters }
    const legacy = saved.steps.length === 0 && saved.at === null ? readLegacyProgress(userId) : null
    if (legacy && (legacy.done.length > 0 || legacy.at !== null)) {
      importing.current = true
      save(withChapters(legacy))
    } else {
      adopt({ done: saved.steps, at: saved.at, restarted: saved.restarted, chapters: saved.chapters })
    }
    setLoad({ status: 'ready', trainedAt: saved.trainedAt })
  })

  useEffect(() => {
    const controller = new AbortController()
    setLoad({ status: 'loading' })
    getJson<ApiTraining>('/print/training', controller.signal).then(
      (saved) => {
        if (!controller.signal.aborted) loaded(saved)
      },
      () => {
        if (!controller.signal.aborted) setLoad({ status: 'failed' })
      },
    )
    return () => {
      controller.abort()
    }
  }, [userId, attempt])

  return {
    load,
    progress,
    /** The last save failed; it's carried by the next change, or `retrySave`. */
    saveFailed,
    /** Loads it again after a failure. */
    reload: () => {
      setAttempt((n) => n + 1)
    },
    update: (change: (was: TrainingProgress) => Omit<TrainingProgress, 'chapters'> & { chapters?: string[] }) => {
      const was = current.current
      const next = change(was)
      if (next === was) return
      save(withChapters(next))
    },
    /** Resolves true once everything is saved. */
    retrySave: () => {
      pending.current ??= current.current
      return flush()
    },
  }
}
