import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { ApiMyProject } from '../../lib/api/api'
import type { Step } from '../../lib/training/curriculum'
import type { Memory, PracticeState } from '../../lib/training/goals'
import { PRACTICE_WORKSPACE } from '../../lib/training/practiceProfiles'
import type { PracticePlate } from '../../lib/training/usePracticePlate'
import type { PreviewLoad } from '../../lib/slicer/usePreview'
import { WorkspaceView, type WorkspaceWatch } from '../slicer/SlicerWorkspace'
import { TaskStrip } from './TaskStrip'

/**
 * A practice task: the real workspace on the practice plate, with the task over it. Goals are
 * checked in order as the plate, the view and the preview change, and stay met once they are.
 * Where the browser can't draw 3D, goals that need the view count as met.
 */
export function PracticeStep({
  step,
  state,
  practice,
  preview,
  projects,
  completed,
  can3d,
  watch,
  onComplete,
  onStartOver,
  onBack,
  onNext,
}: {
  step: Extract<Step, { kind: 'try' }>
  state: PracticeState
  practice: PracticePlate
  preview: PreviewLoad
  projects: ApiMyProject[]
  completed: boolean
  can3d: boolean
  watch: WorkspaceWatch
  onComplete: () => void
  onStartOver: () => void
  onBack: () => void
  onNext: () => void
}) {
  const fresh = () => step.goals.map((goal) => completed || (!can3d && goal.needs3d === true))
  const [achieved, setAchieved] = useState(fresh)
  const [announce, setAnnounce] = useState('')
  const [round, setRound] = useState(0)
  const memory = useRef<Memory>({})

  const check = useEffectEvent(() => {
    const next = [...achieved]
    let met: string | null = null
    let index = next.findIndex((done) => !done)
    while (index !== -1 && step.goals[index]!.done(state, memory.current)) {
      next[index] = true
      met = step.goals[index]!.text
      index = next.findIndex((done) => !done)
    }
    if (met === null) return
    setAchieved(next)
    setAnnounce(index === -1 ? 'Task done. Press NEXT.' : `Done: ${met}`)
    if (index === -1) onComplete()
  })
  useEffect(() => {
    check()
  }, [state])

  return (
    // The task above the workspace rather than inside it, so on a phone, where the page grows, the
    // workspace's minimum height is the plate's and an open task can't squeeze it.
    <div className="flex min-h-0 flex-1 flex-col">
      <TaskStrip
        title={step.title}
        brief={step.brief}
        goals={step.goals}
        achieved={achieved}
        hint={step.hint}
        complete={achieved.every(Boolean)}
        announce={announce}
        onSkipView={() => {
          const next = achieved.map((met, index) => met || step.goals[index]!.needs3d === true)
          setAchieved(next)
          setAnnounce(next.every(Boolean) ? 'Task done. Press NEXT.' : 'Skipped the goals that need a mouse or touch screen.')
          if (next.every(Boolean)) onComplete()
        }}
        onStartOver={() => {
          onStartOver()
          memory.current = {}
          setAchieved(fresh())
          setAnnounce('')
          setRound(round + 1)
        }}
        onBack={onBack}
        onNext={onNext}
      />
      <WorkspaceView
        key={round}
        plateKey="practice"
        plate={practice.source}
        preview={preview}
        workspace={PRACTICE_WORKSPACE}
        projects={projects}
        allowance={null}
        onSent={() => undefined}
        back={null}
        watch={watch}
        className="min-h-[30rem] flex-1 wide:min-h-0"
      />
    </div>
  )
}
