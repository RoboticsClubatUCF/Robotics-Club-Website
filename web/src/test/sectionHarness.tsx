import { useState, type ReactNode } from 'react'
import type { ApiProjectDetail } from '../lib/api/api'
import {
  useEditorSaves,
  type SaveRegistry,
  type SaveSection,
} from '../lib/projects/editorSaves'

/**
 * One section of the project editor, with the machinery that stands behind the page's SAVE and
 * nothing else.
 *
 * Every section is controlled by `useEditorSaves`: it keeps a draft, reports upward whether it
 * holds anything unsaved, and hands up a function the button calls. A test that rendered a section
 * on its own would have nothing to press, so this is the smallest real parent — the same hook the
 * editor uses, a SAVE that runs it, and the two lines the editor prints beside it.
 *
 * The project is held in state and written back the way the page writes it, so a test can assert
 * the thing that used to be hardest to check: that after a save the section stops reporting itself
 * as unsaved.
 */
export function SectionHarness({
  initial,
  children,
}: {
  initial: ApiProjectDetail
  children: (bits: {
    project: ApiProjectDetail
    registry: SaveRegistry
    busy: boolean
  }) => ReactNode
}) {
  const [project, setProject] = useState(initial)
  const { registry, dirty, blocked, busy, saved, message, save } = useEditorSaves(
    SECTIONS,
    project,
    setProject,
  )

  return (
    <>
      {children({ project, registry, busy })}

      <button
        type="button"
        disabled={busy || blocked !== null}
        onClick={() => void save()}
      >
        {busy ? 'SAVING…' : 'SAVE'}
      </button>

      <p>{blocked}</p>
      <p>{message}</p>
      <p>{dirty ? 'UNSAVED' : saved ? 'SAVED' : 'CLEAN'}</p>
    </>
  )
}

/** Every section the editor has, so one harness serves all of them. Module-level
    because the array's identity is a dependency of the save. */
const SECTIONS: readonly SaveSection[] = [
  { name: 'title', label: 'The title' },
  { name: 'writing', label: 'The writing' },
  { name: 'gallery', label: 'The gallery' },
  { name: 'documents', label: 'The documentation' },
  { name: 'team', label: 'The team' },
]
