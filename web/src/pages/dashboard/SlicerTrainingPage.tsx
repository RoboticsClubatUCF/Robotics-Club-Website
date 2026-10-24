import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Link, useOutletContext, useSearchParams } from 'react-router'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { CheckStep } from '../../components/training/CheckStep'
import { CHAPTERS } from '../../components/training/chapters'
import { FinishStep, type OptionalChapter } from '../../components/training/FinishStep'
import { PracticeStep } from '../../components/training/PracticeStep'
import { TrainingContents } from '../../components/training/TrainingContents'
import { smallLoudButton, smallQuietButton } from '../../components/slicer/slicerChrome'
import type { WorkspaceWatch } from '../../components/slicer/SlicerWorkspace'
import { postJson } from '../../lib/api/api'
import { webglAvailable, type CameraView } from '../../lib/slicer/scene'
import { CHAPTER_SUMMARIES, CHAPTER_TITLES, OPTIONAL_CHAPTERS } from '../../lib/slicer/trainingChapters'
import { type PlacedStep, finishedChapters, flatten, isOptional } from '../../lib/training/curriculum'
import { trackRotation, type PracticeState, type RotationProgress } from '../../lib/training/goals'
import { PRACTICE_WORKSPACE } from '../../lib/training/practiceProfiles'
import { type PartName, loadParts, modelIdOf } from '../../lib/training/practiceParts'
import { usePracticePreview } from '../../lib/training/practiceSlices'
import { useTrainingProgress } from '../../lib/training/progress'
import { usePracticePlate } from '../../lib/training/usePracticePlate'

const STEPS = flatten(CHAPTERS)
const BED = PRACTICE_WORKSPACE.profiles.printers[0]!.bed
/** The end of the required chapters, and the list of the optional ones. */
const FINISH = STEPS.findIndex(({ step }) => step.kind === 'finish')
const REQUIRED = STEPS.slice(0, FINISH)
const NUMBERED = CHAPTERS.filter((chapter) => !isOptional(chapter)).length
const finished = (done: readonly string[]) => finishedChapters(CHAPTERS, done)
const pad = (n: number) => String(n).padStart(2, '0')

type Watched = Pick<PracticeState, 'selected' | 'selectSeveral' | 'mode' | 'tab'>
type Training = ReturnType<typeof useTrainingProgress>

const backLink =
  'text-dim hover:text-base-content inline-flex min-h-11 items-center font-mono text-[11px] font-semibold tracking-[0.12em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary wide:min-h-9'

/**
 * `/dashboard/profile/training`: the slicer training, reached from the profile page. Finishing the
 * required chapters opens the slicer (`requireSlicerTraining` on the server); each optional
 * chapter after them unlocks its settings there. `?chapter=` opens on one, which is where the
 * slicer's locked settings link.
 *
 * It takes the whole width like the slicer does, since half its steps are the slicer: the real
 * workspace on a practice plate that never leaves the browser. The rest are short reads and
 * questions. Steps open in order; where somebody got to is kept on the server
 * (`lib/training/progress.ts`), and once a chapter is finished, its steps stay open to look back at.
 */
export function SlicerTrainingPage() {
  const dashboard = useOutletContext<DashboardContext>()
  const training = useTrainingProgress(dashboard.user.id, finished)

  if (training.load.status === 'ready') return <TrainingSteps dashboard={dashboard} training={training} />

  return (
    <div className="flex min-h-[calc(100dvh-var(--spacing-nav))] flex-col">
      <header className="border-rule bg-base-200 flex items-center gap-x-4 border-b px-3 py-1">
        <Link to="/dashboard/profile/standing" className={backLink}>
          ‹ STANDING
        </Link>
        <h1 className="text-faint font-mono text-[11px] font-medium tracking-[0.16em]">SLICER TRAINING</h1>
      </header>
      {training.load.status === 'loading' ? (
        <div aria-busy="true" className="px-page mx-auto w-full max-w-[48rem] py-9 wide:py-12">
          <div className="bg-base-300 mb-6 h-4 w-48 animate-pulse rounded-[2px]" />
          <div className="bg-base-300 mb-8 h-9 w-3/4 animate-pulse rounded-[2px]" />
          <div className="bg-base-300 mb-3 h-4 w-full animate-pulse rounded-[2px]" />
          <div className="bg-base-300 h-4 w-5/6 animate-pulse rounded-[2px]" />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-sm text-center">
            <p className="text-dim mb-4 text-[14px] leading-[1.6]">Your place in the training didn&rsquo;t load.</p>
            <button type="button" onClick={training.reload} className={smallQuietButton}>
              TRY AGAIN
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function TrainingSteps({ dashboard, training }: { dashboard: DashboardContext; training: Training }) {
  const { membership, reloadMembership } = dashboard
  const { progress, update } = training
  const projects = dashboard.projects.status === 'ready' ? dashboard.projects.data : []
  const [searchParams, setSearchParams] = useSearchParams()
  // Finishing says so at once, whether or not the standing reloads after it.
  const [finishedNow, setFinishedNow] = useState(false)
  const trained =
    finishedNow ||
    (training.load.status === 'ready' && training.load.trainedAt !== null) ||
    (membership.status === 'ready' && membership.data.slicerTrained)

  const done = new Set(progress.done)
  const restarted = new Set(progress.restarted)
  const chaptersDone = new Set(progress.chapters)
  // A task started over was finished once, so it doesn't pull back how far somebody has got: the
  // steps they'd reached stay open. Finishing still needs it done again.
  const reached = new Set([...progress.done, ...progress.restarted])
  const firstOpen = REQUIRED.findIndex(({ step }) => !reached.has(step.id))
  const ready = REQUIRED.every(({ step }) => done.has(step.id))
  const open = (index: number) => {
    const { step, chapter } = STEPS[index]!
    if (done.has(step.id) || restarted.has(step.id) || chaptersDone.has(chapter.id)) return true
    if (!isOptional(chapter)) return trained || firstOpen === -1 || index <= firstOpen
    if (!trained) return false
    // An optional chapter opens in order within itself.
    const first = STEPS.findIndex((placed) => placed.chapter === chapter && !reached.has(placed.step.id))
    return first === -1 || index <= first
  }
  // Somebody who has finished a chapter can look back through it without doing it all again.
  const isDone = ({ step, chapter }: PlacedStep) =>
    !restarted.has(step.id) && (done.has(step.id) || chaptersDone.has(chapter.id) || (trained && !isOptional(chapter)))
  /** Where a chapter picks up: its first step not done, or its first. */
  const startOf = (id: string) => {
    const steps = STEPS.filter((placed) => placed.chapter.id === id)
    return (steps.find((placed) => !done.has(placed.step.id) && open(placed.index)) ?? steps[0]!).index
  }

  const [index, setIndex] = useState(() => {
    const asked = searchParams.get('chapter')
    if (asked && STEPS.some((placed) => placed.chapter.id === asked) && open(startOf(asked))) return startOf(asked)
    const at = STEPS.findIndex(({ step }) => step.id === progress.at)
    if (at >= 0 && open(at)) return at
    return trained || firstOpen === -1 ? FINISH : firstOpen
  })
  const here = STEPS[index]!
  const [contents, setContents] = useState(false)
  // The optional chapter this visit has just finished, said once its end leads back to the list.
  const [justUnlocked, setJustUnlocked] = useState<string | null>(null)
  // Back at the list from an optional chapter, or sent to it (the profile's MORE SETTINGS), which
  // is where focus goes rather than the top.
  const [toList, setToList] = useState(() => searchParams.get('chapter') === 'finish')
  // SAVE AGAIN worked: said where NOT SAVED was, until the next step.
  const [savedAgain, setSavedAgain] = useState(false)

  const markDone = (id: string) => {
    if (done.has(id)) return
    const newly = finished([...progress.done, id]).find((chapter) => !chaptersDone.has(chapter))
    if (newly && OPTIONAL_CHAPTERS.includes(newly)) setJustUnlocked(newly)
    update((was) =>
      was.done.includes(id) ? was : { ...was, done: [...was.done, id], restarted: was.restarted.filter((task) => task !== id) },
    )
  }

  const go = (next: number, list = false) => {
    if (next < 0 || next >= STEPS.length) return
    const id = STEPS[next]!.step.id
    setUp(STEPS[next]!.step)
    setIndex(next)
    setContents(false)
    setToList(list)
    setSavedAgain(false)
    if (!list) setJustUnlocked(null)
    window.scrollTo(0, 0)
    update((was) => (was.at === id ? was : { ...was, at: id }))
    // A reload should open where they are, not on the chapter they were sent to.
    if (searchParams.has('chapter')) setSearchParams({}, { replace: true })
  }
  // An optional chapter's ends lead back to the list of them, not into the next one, which may be
  // locked and was never asked for.
  const ownsEnd = (from: number, to: number) => isOptional(STEPS[from]!.chapter) && STEPS[to]?.chapter !== STEPS[from]!.chapter
  const forward = () => {
    if (ownsEnd(index, index + 1)) go(FINISH, true)
    else go(index + 1)
  }
  const back = () => {
    if (ownsEnd(index, index - 1)) go(FINISH, true)
    else go(index - 1)
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
  const partsReady = parts instanceof Map ? parts : null
  const practice = usePracticePlate(partsReady, here.chapter.id === 'sending')
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
  // is in its strip, drawn once the parts have loaded. Back from an optional chapter, the list of
  // them is what's wanted, and it's below the fold on a phone.
  useEffect(() => {
    const list = toList ? document.querySelector<HTMLElement>('[data-more-settings]') : null
    if (list) {
      list.focus({ preventScroll: true })
      // The section from its heading, whichever line has focus. Instant, since the page's smooth
      // scroll would first carry the member back up from where `go` left them.
      document.getElementById('more-settings')?.scrollIntoView?.({ block: 'start', behavior: 'instant' })
    } else {
      document.querySelector<HTMLElement>('[data-step-heading]')?.focus({ preventScroll: true })
    }
  }, [index, partsReady, toList])

  const savedLine = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (savedAgain) savedLine.current?.focus()
  }, [savedAgain])

  const meshes = new Map(partsReady ? [...partsReady].map(([part, positions]) => [modelIdOf(part), positions] as const) : [])
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
  const optional = isOptional(chapter)
  const stepDone = isDone(here)
  const requiredDone = REQUIRED.filter(({ step: s }) => done.has(s.id)).length
  const unlockedCount = OPTIONAL_CHAPTERS.filter((id) => chaptersDone.has(id)).length
  const optionalChapters: OptionalChapter[] = OPTIONAL_CHAPTERS.map((id) => ({
    id,
    title: CHAPTER_TITLES[id]!,
    unlocks: CHAPTER_SUMMARIES[id]!,
    done: chaptersDone.has(id),
    started: STEPS.some((placed) => placed.chapter.id === id && reached.has(placed.step.id)),
  }))

  const finish = async () => {
    await postJson('/print/training', {})
    setFinishedNow(true)
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
        <Link to="/dashboard/profile/standing" className={backLink}>
          ‹ STANDING
        </Link>
        <p className="text-faint hidden font-mono text-[11px] font-medium tracking-[0.16em] wide:block">SLICER TRAINING</p>
        {/* Its own row on a phone, where it would otherwise be squeezed to nothing. A failed save
            says so on the same row, so the header doesn't grow a row under the member. */}
        <div className="order-last flex min-w-0 basis-full items-center gap-3 pb-1 wide:order-none wide:basis-auto wide:flex-1 wide:pb-0">
          <p className="min-w-0 flex-1 truncate text-[13px]">
            <span className="text-faint font-mono text-[11px] tracking-[0.08em]">
              {optional ? 'OPTIONAL' : `${pad(chapterIndex + 1)}/${pad(NUMBERED)}`}
            </span>{' '}
            {chapter.title}
          </p>
          {training.saveFailed ? (
            <p role="alert" className="text-error flex shrink-0 items-center gap-2 font-mono text-[11px] tracking-[0.08em]">
              NOT SAVED
              <button
                type="button"
                onClick={() => {
                  void training.retrySave().then((saved) => {
                    if (saved) setSavedAgain(true)
                  })
                }}
                className="text-base-content inline-flex min-h-11 cursor-pointer items-center underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary wide:min-h-9"
              >
                SAVE AGAIN
              </button>
            </p>
          ) : (
            savedAgain && (
              <p ref={savedLine} tabIndex={-1} className="text-success shrink-0 font-mono text-[11px] tracking-[0.08em] outline-none">
                SAVED
              </p>
            )
          )}
        </div>
        {trained ? (
          // The required part is behind them; what's left is optional, so it's counted in chapters.
          <p className="text-faint ml-auto font-mono text-[11px] tracking-[0.12em] whitespace-nowrap wide:ml-0">
            <span aria-hidden="true">
              {unlockedCount}/{OPTIONAL_CHAPTERS.length} UNLOCKED
            </span>
            <span className="sr-only">
              {unlockedCount} of {OPTIONAL_CHAPTERS.length} settings chapters unlocked
            </span>
          </p>
        ) : (
          <div
            role="progressbar"
            aria-label="Training progress"
            aria-valuemin={0}
            aria-valuemax={REQUIRED.length}
            aria-valuenow={requiredDone}
            aria-valuetext={`${String(requiredDone)} of ${String(REQUIRED.length)} steps done`}
            className="bg-base-content/15 ml-auto h-1.5 min-w-12 flex-1 wide:ml-0 wide:w-32 wide:flex-none"
          >
            <div className="bg-primary h-full" style={{ width: `${String((requiredDone / REQUIRED.length) * 100)}%` }} />
          </div>
        )}
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
        partsReady && setUpFor === step.id ? (
          <PracticeStep
            key={step.id}
            step={step}
            state={state}
            practice={practice}
            preview={preview}
            projects={projects}
            completed={stepDone}
            can3d={can3d}
            watch={watch}
            onComplete={() => {
              markDone(step.id)
            }}
            onStartOver={() => {
              update((was) => ({
                ...was,
                done: was.done.filter((id) => id !== step.id),
                restarted: [...was.restarted.filter((id) => id !== step.id), step.id],
              }))
              setUp(step)
            }}
            onBack={back}
            onNext={forward}
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
              / {optional ? 'OPTIONAL' : pad(chapterIndex + 1)} · {chapter.title.toUpperCase()}
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
                answered={stepDone}
                onRight={() => {
                  markDone(step.id)
                }}
              />
            )}
            {step.kind === 'finish' && (
              <FinishStep
                trained={trained}
                ready={ready}
                chapters={optionalChapters}
                unlockedNow={toList && justUnlocked ? CHAPTER_TITLES[justUnlocked] : undefined}
                onFinish={finish}
                onChapter={(id) => {
                  go(startOf(id))
                }}
              />
            )}
            <nav aria-label="Steps" className="border-rule mt-10 flex items-center justify-between gap-3 border-t pt-5">
              <button type="button" disabled={index === 0} onClick={back} className={smallQuietButton}>
                BACK
              </button>
              {step.kind !== 'finish' && (
                <button
                  type="button"
                  disabled={step.kind === 'check' && !stepDone}
                  title={step.kind === 'check' && !stepDone ? 'Answer the question first.' : undefined}
                  onClick={() => {
                    if (step.kind === 'read') markDone(step.id)
                    forward()
                  }}
                  className={step.kind === 'check' && !stepDone ? smallQuietButton : smallLoudButton}
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
          finished={isDone}
          unlocked={chaptersDone}
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
