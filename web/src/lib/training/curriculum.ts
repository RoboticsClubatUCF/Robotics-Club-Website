import type { ReactNode } from 'react'
import type { ApiPlateObject } from '../api/api'
import type { Plate } from '../slicer/useDraft'
import type { Goal } from './goals'

/**
 * The shape of the slicer training. The words and the tasks are in
 * `components/training/chapters.tsx`; this is what the page walks through.
 *
 * A step is something to read, a question to answer, a task to do on the practice plate, or the
 * end. Steps unlock in order: reading one counts once NEXT is pressed, a question once it's
 * answered right, a task once every goal has been met.
 */

export interface Option {
  text: string
  right?: boolean
  /** Shown once it's picked, right or wrong. */
  why: string
}

/** What a task puts on the practice plate before it starts. */
export interface Setup {
  objects: () => ApiPlateObject[]
  settings?: Partial<Omit<Plate, 'objects'>>
}

export type Step =
  | { kind: 'read'; id: string; title: string; body: ReactNode }
  | { kind: 'check'; id: string; title: string; question: string; picture?: ReactNode; options: Option[] }
  | {
      kind: 'try'
      id: string
      title: string
      brief?: ReactNode
      /** Left out, the task carries on with the plate as the last one left it. */
      setUp?: Setup
      goals: Goal[]
      hint?: ReactNode
    }
  | { kind: 'finish'; id: string; title: string }

export interface Chapter {
  id: string
  title: string
  steps: Step[]
}

export interface PlacedStep {
  step: Step
  chapter: Chapter
  chapterIndex: number
  index: number
}

export function flatten(chapters: Chapter[]): PlacedStep[] {
  return chapters.flatMap((chapter, chapterIndex) => chapter.steps.map((step) => ({ step, chapter, chapterIndex }))).map(
    (placed, index) => ({ ...placed, index }),
  )
}
