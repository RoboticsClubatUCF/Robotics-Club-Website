/**
 * Where somebody is in the slicer training, kept in this browser. Only finishing it is stored on
 * the server (`POST /api/print/training`); the steps on the way are a convenience, so a cleared
 * browser or another device starts from the top, and nothing breaks without storage.
 *
 * The profile page reads this too, which is why it carries the step count: the page shouldn't
 * have to load the training to say how far along somebody is.
 */

export interface TrainingProgress {
  /** Ids of the steps finished. */
  done: string[]
  /** The step they were on. */
  at: string | null
  total: number
}

const EMPTY: TrainingProgress = { done: [], at: null, total: 0 }

const key = (userId: string) => `rccf.slicer-training.${userId}`

export function readProgress(userId: string): TrainingProgress {
  try {
    const raw = localStorage.getItem(key(userId))
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<TrainingProgress>
    return {
      done: Array.isArray(parsed.done) ? parsed.done.filter((id) => typeof id === 'string') : [],
      at: typeof parsed.at === 'string' ? parsed.at : null,
      total: typeof parsed.total === 'number' ? parsed.total : 0,
    }
  } catch {
    return EMPTY
  }
}

export function writeProgress(userId: string, progress: TrainingProgress): void {
  try {
    localStorage.setItem(key(userId), JSON.stringify(progress))
  } catch {
    // Private windows and full storage: the training still works, it just won't remember.
  }
}
