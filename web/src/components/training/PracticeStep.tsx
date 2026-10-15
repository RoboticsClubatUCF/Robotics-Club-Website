import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { ApiMyProject } from '../../lib/api/api'
import type { Step } from '../../lib/training/curriculum'
import type { Memory, PracticeState } from '../../lib/training/goals'
import { PRACTICE_WORKSPACE } from '../../lib/training/practiceProfiles'
import type { PracticePlate } from '../../lib/training/usePracticePlate'
import type { PreviewLoad } from '../../lib/slicer/usePreview'
import { WorkspaceView, type WorkspaceWatch } from '../slicer/SlicerWorkspace'
import { GoalCallout } from './GoalCallout'
import { SliceLog } from './SliceLog'
import { TaskStrip } from './TaskStrip'

/**
 * A practice task: the real workspace on the practice plate, with the task over it and the next
 * goal pointing at what to use. Goals are checked in order as the plate, the view and the preview
 * change, and stay met once they are. Where the browser can't draw 3D, goals that need the view
 * count as met.
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
    setAnnounce(index === -1 ? 'Task done. Press NEXT.' : `Done. Next: ${step.goals[index]!.text}`)
    if (index === -1) onComplete()
  })
  useEffect(() => {
    check()
  }, [state])

  const next = achieved.findIndex((done) => !done)
  const goal = next === -1 ? null : step.goals[next]!
  // Done after several slices, the strip says so beside DONE instead of a callout under NEXT, which
  // would cover YOUR SLICES just when there's something to compare, or over the plate, which would
  // cover the preview's PATHS.
  const compare = goal === null && practice.log.slices.length > 1
  const aims = goal ? (typeof goal.aim === 'function' ? goal.aim(state) : (goal.aim ?? [])) : [{ at: 'next' }]

  return (
    // The task above the workspace rather than inside it, so on a phone, where the page grows, the
    // workspace's minimum height is the plate's and the task can't squeeze it.
    <div className="relative flex min-h-0 flex-1 flex-col">
      <TaskStrip
        title={step.title}
        brief={step.brief}
        hint={step.hint}
        complete={goal === null}
        doneNote={compare ? 'Compare your slices, then press NEXT.' : undefined}
        announce={announce}
        onStartOver={() => {
          onStartOver()
          memory.current = {}
          setAchieved(step.goals.map((goal) => !can3d && goal.needs3d === true))
          setAnnounce('')
          setRound(round + 1)
        }}
        onBack={onBack}
        onNext={onNext}
      >
        <SliceLog log={practice.log} />
      </TaskStrip>
      {!compare && (
        <GoalCallout
          key={`${String(round)}-${String(next)}`}
          label={goal ? `STEP ${String(next + 1)} OF ${String(step.goals.length)}` : 'DONE'}
          text={goal ? goal.text : 'Press NEXT to carry on.'}
          aims={aims}
          state={state}
        />
      )}
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
        previewFocus={practice.sliced?.focus}
        className="min-h-[30rem] flex-1 wide:min-h-0"
      />
    </div>
  )
}
