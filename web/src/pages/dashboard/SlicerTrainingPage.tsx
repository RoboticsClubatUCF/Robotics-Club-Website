import { useEffect, useEffectEvent, useState } from 'react'
import { Link, useOutletContext } from 'react-router'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { CheckStep } from '../../components/training/CheckStep'
import { CHAPTERS } from '../../components/training/chapters'
import { FinishStep } from '../../components/training/FinishStep'
import { PracticeStep } from '../../components/training/PracticeStep'
import { TrainingContents } from '../../components/training/TrainingContents'
import { smallLoudButton, smallQuietButton } from '../../components/slicer/slicerChrome'
import type { WorkspaceWatch } from '../../components/slicer/SlicerWorkspace'
import { postJson } from '../../lib/api/api'
import { webglAvailable, type CameraView } from '../../lib/slicer/scene'
import { flatten } from '../../lib/training/curriculum'
import { trackRotation, type PracticeState, type RotationProgress } from '../../lib/training/goals'
import { PRACTICE_WORKSPACE } from '../../lib/training/practiceProfiles'
import { type PartName, loadParts, modelIdOf } from '../../lib/training/practiceParts'
import { usePracticePreview } from '../../lib/training/practiceSlices'
import { readProgress, writeProgress } from '../../lib/training/progress'
import { usePracticePlate } from '../../lib/training/usePracticePlate'

const STEPS = flatten(CHAPTERS)
const BED = PRACTICE_WORKSPACE.profiles.printers[0]!.bed

type Watched = Pick<PracticeState, 'selected' | 'selectSeveral' | 'mode' | 'tab'>

/**
 * `/dashboard/profile/training`: the slicer training, reached from the profile page. Finishing it
 * opens the slicer (`requireSlicerTraining` on the server).
 *
 * It takes the whole width like the slicer does, since half its steps are the slicer: the real
 * workspace on a practice plate that never leaves the browser. The rest are short reads and
 * questions. Steps open in order; where somebody got to is kept in this browser
 * (`lib/training/progress.ts`), and once they've finished, every step stays open to look back at.
 */
export function SlicerTrainingPage() {
  const dashboard = useOutletContext<DashboardContext>()
  const { user, membership, reloadMembership } = dashboard
  const projects = dashboard.projects.status === 'ready' ? dashboard.projects.data : []
  // Finishing says so at once, whether or not the standing reloads after it.
  const [finished, setFinished] = useState(false)
  const trained = finished || (membership.status === 'ready' && membership.data.slicerTrained)

  const [progress, setProgress] = useState(() => readProgress(user.id))
  const done = new Set(progress.done)
  // A task started over was finished once, so it doesn't pull back how far somebody has got: the
  // steps they'd reached stay open. Finishing still needs it done again.
  const reached = new Set([...progress.done, ...(progress.restarted ?? [])])
  const firstOpen = STEPS.findIndex(({ step }) => !reached.has(step.id))
  const allDone = STEPS.every(({ step }) => step.kind === 'finish' || done.has(step.id))
  const open = (index: number) => {
    const id = STEPS[index]!.step.id
    return trained || firstOpen === -1 || index <= firstOpen || done.has(id) || progress.restarted?.includes(id) === true
  }
  const [index, setIndex] = useState(() => {
    const at = STEPS.findIndex(({ step }) => step.id === progress.at)
    return at >= 0 && open(at) ? at : Math.max(0, firstOpen)
  })
  const here = STEPS[index]!
  const [contents, setContents] = useState(false)

  useEffect(() => {
    writeProgress(user.id, progress)
  }, [user.id, progress])

  const markDone = (id: string) => {
    setProgress((was) => (was.done.includes(id) ? was : {
      ...was,
      done: [...was.done, id],
      restarted: was.restarted?.filter((task) => task !== id),
      total: STEPS.length,
    }))
  }

  const go = (next: number) => {
    if (next < 0 || next >= STEPS.length) return
    setUp(STEPS[next]!.step)
    setIndex(next)
    setContents(false)
    window.scrollTo(0, 0)
    setProgress((was) => ({ ...was, at: STEPS[next]!.step.id, total: STEPS.length }))
  }

  // The practice parts and plate, kept across steps so a task can carry on from the last.
  const [parts, setParts] = useState<Map<PartName, Float32Array> | 'loading' | 'failed'>('loading')
  const fetchParts = () => {
    setParts('loading')
    loadParts().then(setParts, () => {
      setParts('failed')
    })
  }
  useEffect(() => {
    let live = true
    loadParts().then(
      (loaded) => {
        if (live) setParts(loaded)
      },
      () => {
        if (live) setParts('failed')
      },
    )
    return () => {
      live = false
    }
  }, [])
  const ready = parts instanceof Map ? parts : null
  const practice = usePracticePlate(ready, here.chapter.id === 'sending')
  const sliceKey = practice.sliceState?.requestedAt ?? null
  const preview = usePracticePreview(practice.sliced?.name ?? null, practice.sliced ?? { offset: [0, 0], yaw: 0 }, sliceKey)
  const [can3d] = useState(webglAvailable)

  const [watched, setWatched] = useState<Watched>({ selected: [], selectSeveral: false, mode: 'move', tab: 'prepare' })
  const [camera, setCamera] = useState<CameraView | null>(null)
  const [rotations, setRotations] = useState<RotationProgress>({})
  // Marked with the slice they were reported for: the slider of the slice before mustn't meet a
  // goal that asks to look at this one.
  const [layers, setLayers] = useState<(NonNullable<PracticeState['layers']> & { of: string | null }) | null>(null)
  const watch: WorkspaceWatch = {
    onRotation: (change) => setRotations((before) => trackRotation(before, change)),
    onState: setWatched,
    onCamera: setCamera,
    onLayers: (reported) => {
      setLayers({ ...reported, of: sliceKey })
    },
  }

  /**
   * A task's starting plate, and a clean slate for what its goals watch. Done before the task is
   * drawn (`setUpFor`), so a goal can't be met by the last task's plate, view or slice.
   */
  const [setUpFor, setSetUpFor] = useState<string | null>(null)
  const setUp = (target: (typeof STEPS)[number]['step']) => {
    if (target.kind !== 'try') {
      setSetUpFor(null)
      return
    }
    if (target.setUp) practice.setUp(target.setUp.objects(), target.setUp.settings)
    setWatched({ selected: [], selectSeveral: false, mode: 'move', tab: 'prepare' })
    setCamera(null)
    setRotations({})
    setLayers(null)
    setSetUpFor(target.id)
  }
  // Opened straight onto a task, by a reload or from the profile page.
  const startHere = useEffectEvent(() => {
    setUp(here.step)
  })
  useEffect(() => {
    startHere()
  }, [])

  // Each step starts at its heading, for a screen reader as much as for the eye. A task's heading
  // is in its strip, drawn once the parts have loaded.
  useEffect(() => {
    document.querySelector<HTMLElement>('[data-step-heading]')?.focus({ preventScroll: true })
  }, [index, ready])

  const meshes = new Map(ready ? [...ready].map(([part, positions]) => [modelIdOf(part), positions] as const) : [])
  const state: PracticeState = {
    plate: practice.source.plate,
    ...watched,
    camera,
    layers: layers?.of === sliceKey ? layers : null,
    meshes,
    slice: practice.sliceState,
    sliced: practice.sliced,
    sent: practice.sent,
    bed: BED,
    rotations,
  }

  const { step, chapter, chapterIndex } = here
  // Somebody who has finished can look back through it without doing it all again.
  const isDone = done.has(step.id) || (trained && !progress.restarted?.includes(step.id))

  const finish = async () => {
    await postJson('/print/training', {})
    setFinished(true)
    markDone('finish')
    reloadMembership().catch(() => {
      // The rail catches up on the next page; this page already knows.
    })
  }

  return (
    // A task fills the window like the slicer, at `wide`; on a phone the page grows past the window
    // so the plate keeps a usable height. Reading scrolls the page, with the bar kept in view at
    // `wide` (a phone's nav is shorter than `--spacing-nav`, so it doesn't stick there).
    <div
      className={`flex min-h-[calc(100dvh-var(--spacing-nav))] flex-col ${
        step.kind === 'try' ? 'wide:h-[calc(100dvh-var(--spacing-nav))] wide:min-h-[32rem]' : ''
      }`}
    >
      <header className="border-rule bg-base-200 z-20 flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-1 wide:sticky wide:top-nav">
        <Link
          to="/dashboard/profile/standing"
          className="text-dim hover:text-base-content inline-flex min-h-11 items-center font-mono text-[11px] font-semibold tracking-[0.12em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary wide:min-h-9"
        >
          ‹ STANDING
        </Link>
        <p className="text-faint hidden font-mono text-[11px] font-medium tracking-[0.16em] wide:block">SLICER TRAINING</p>
        {/* Its own row on a phone, where it would otherwise be squeezed to nothing. */}
        <p className="order-last min-w-0 basis-full truncate pb-1 text-[13px] wide:order-none wide:basis-auto wide:flex-1 wide:pb-0">
          <span className="text-faint font-mono text-[11px] tracking-[0.08em]">
            {String(chapterIndex + 1).padStart(2, '0')}/{String(CHAPTERS.length).padStart(2, '0')}
          </span>{' '}
          {chapter.title}
        </p>
        <div
          role="progressbar"
          aria-label="Training progress"
          aria-valuemin={0}
          aria-valuemax={STEPS.length}
          aria-valuenow={progress.done.length}
          aria-valuetext={`${String(progress.done.length)} of ${String(STEPS.length)} steps done`}
          className="bg-base-content/15 ml-auto h-1.5 min-w-12 flex-1 wide:ml-0 wide:w-32 wide:flex-none"
        >
          <div className="bg-primary h-full" style={{ width: `${String((progress.done.length / STEPS.length) * 100)}%` }} />
        </div>
        <button
          type="button"
          aria-expanded={contents}
          onClick={() => {
            setContents(true)
          }}
          className="text-dim hover:text-base-content inline-flex min-h-11 cursor-pointer items-center font-mono text-[11px] font-semibold tracking-[0.12em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary wide:min-h-9"
        >
          CONTENTS
        </button>
      </header>

      {step.kind === 'try' ? (
        ready && setUpFor === step.id ? (
          <PracticeStep
            key={step.id}
            step={step}
            state={state}
            practice={practice}
            preview={preview}
            projects={projects}
            completed={isDone}
            can3d={can3d}
            watch={watch}
            onComplete={() => {
              markDone(step.id)
            }}
            onStartOver={() => {
              setProgress((was) => ({
                ...was,
                done: was.done.filter((id) => id !== step.id),
                restarted: [...(was.restarted ?? []).filter((id) => id !== step.id), step.id],
              }))
              setUp(step)
            }}
            onBack={() => {
              go(index - 1)
            }}
            onNext={() => {
              go(index + 1)
            }}
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6" aria-busy={parts === 'loading'}>
            {parts === 'failed' && (
              <div className="max-w-sm text-center">
                <p className="text-dim mb-4 text-[14px] leading-[1.6]">The practice parts didn&rsquo;t load.</p>
                <button type="button" onClick={fetchParts} className={smallQuietButton}>
                  TRY AGAIN
                </button>
              </div>
            )}
          </div>
        )
      ) : (
        <div key={step.id} className="flex-1">
          <article className="px-page mx-auto w-full max-w-[48rem] py-9 wide:py-12">
            <p className="text-faint mb-5 font-mono text-[13px] font-bold tracking-[0.2em]">
              / {String(chapterIndex + 1).padStart(2, '0')} · {chapter.title.toUpperCase()}
            </p>
            <h1
              data-step-heading
              tabIndex={-1}
              className="mb-6 text-[clamp(1.6rem,6vw,2.25rem)] leading-[1.1] font-bold tracking-[-0.02em] text-pretty outline-none"
            >
              {step.title}
            </h1>
            {step.kind === 'read' && step.body}
            {step.kind === 'check' && (
              <CheckStep
                question={step.question}
                picture={step.picture}
                options={step.options}
                answered={isDone}
                onRight={() => {
                  markDone(step.id)
                }}
              />
            )}
            {step.kind === 'finish' && (
              <FinishStep trained={trained} ready={allDone} onFinish={finish} />
            )}
            <nav aria-label="Steps" className="border-rule mt-10 flex items-center justify-between gap-3 border-t pt-5">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => {
                  go(index - 1)
                }}
                className={smallQuietButton}
              >
                BACK
              </button>
              {step.kind !== 'finish' && (
                <button
                  type="button"
                  disabled={step.kind === 'check' && !isDone}
                  title={step.kind === 'check' && !isDone ? 'Answer the question first.' : undefined}
                  onClick={() => {
                    if (step.kind === 'read') markDone(step.id)
                    go(index + 1)
                  }}
                  className={step.kind === 'check' && !isDone ? smallQuietButton : smallLoudButton}
                >
                  NEXT
                </button>
              )}
            </nav>
          </article>
        </div>
      )}

      {contents && (
        <TrainingContents
          steps={STEPS}
          current={index}
          done={done}
          open={open}
          onGo={go}
          onClose={() => {
            setContents(false)
          }}
        />
      )}
    </div>
  )
}
