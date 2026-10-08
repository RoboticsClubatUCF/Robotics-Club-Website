import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { PROCESS_SETTINGS } from '../../lib/slicer/processSettings'
import { flatten } from '../../lib/training/curriculum'
import { CHAPTERS } from './chapters'

/**
 * The training has to explain, or have somebody use, every setting the slicer offers and every
 * choice under it. This reads the words the training shows (lessons, tasks, questions) and checks
 * each setting's label and choices are in there, so a setting added to `processSettings.ts`
 * without a lesson fails here.
 */

// Lessons with a preview fetch it; the words are what's under test.
vi.mock('./LessonParts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./LessonParts')>()),
  PreviewCompare: ({ caption }: { caption: string }) => <p>{caption}</p>,
  SliceNumbers: ({ caption }: { caption: string }) => <p>{caption}</p>,
}))

const steps = flatten(CHAPTERS)

function allWords(): string {
  const parts: string[] = []
  for (const { step } of steps) {
    parts.push(step.title)
    if (step.kind === 'read') {
      const { container, unmount } = render(<MemoryRouter>{step.body}</MemoryRouter>)
      parts.push(container.textContent ?? '')
      unmount()
    } else if (step.kind === 'check') {
      parts.push(step.question, ...step.options.flatMap((option) => [option.text, option.why]))
    } else if (step.kind === 'try') {
      parts.push(...step.goals.map((goal) => goal.text))
    }
  }
  return parts.join('\n').toLowerCase()
}

describe('the slicer training', () => {
  it('covers every setting the slicer offers, and every choice under one', () => {
    const words = allWords()
    const missing: string[] = []
    for (const def of PROCESS_SETTINGS) {
      if (!words.includes(def.label.toLowerCase())) missing.push(def.label)
      if (def.kind === 'choice') {
        for (const choice of def.choices) {
          if (!words.includes(choice.label.toLowerCase())) missing.push(`${def.label}: ${choice.label}`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('names every tool on the plate', () => {
    const words = allWords()
    for (const tool of ['add a model', 'arrange', 'auto-orient', 'copy', 'delete', 'move', 'rotate', 'scale', 'lay on face', 'reset', 'undo']) {
      expect(words).toContain(tool)
    }
  })

  it('gives every step its own id, and every question one right answer', () => {
    expect(new Set(steps.map(({ step }) => step.id)).size).toBe(steps.length)
    for (const { step } of steps) {
      if (step.kind === 'check') expect(step.options.filter((option) => option.right)).toHaveLength(1)
      if (step.kind === 'try') expect(step.goals.length).toBeGreaterThan(0)
    }
    expect(steps.at(-1)?.step.kind).toBe('finish')
  })
})
