import { useEffect, useId, useState } from 'react'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { ImageFramer } from '../shared/ImageFramer'
import { Status } from '../shared/Status'
import { fieldClass, labelClass, submitClass } from '../shared/formChrome'
import { patchJson, postForm } from '../../lib/api/api'
import type { ApiProjectDetail } from '../../lib/api/api'
import { ACCEPTED_IMAGE_TYPES, downscaleImage } from '../../lib/media/downscaleImage'
import { frameStyle, safeFraming, type Framing } from '../../lib/media/imageFraming'
import { imageSrc, isStoredUpload } from '../../lib/media/storedFiles'
import { coverOf } from '../../lib/projects/projectCover'
import { useSectionStatus } from '../../lib/useSectionStatus'

/**
 * The `/ TITLE` section: what a project is called, the line the projects list
 * prints, the picture beside it, and what this project calls its own sections.
 *
 * **It is first because it is the top of the page it edits**, and because the
 * cover and the summary are the only two things a stranger sees before deciding
 * whether to open the project at all — everything below this section is read by
 * somebody who has already decided.
 *
 * **It carries its own SAVE, and that is not a copy of the writing section's.**
 * The editor's rule is that prose waits for a button and pictures do not, and
 * the reason the writing's button sits at the foot of the page is that nothing
 * below it waits. A section at the *top* of the page cannot be covered by a
 * button at the bottom: somebody who types a summary here, scrolls past three
 * sections and presses SAVE CHANGES has no way to know which of the things they
 * typed that button meant. So the words here get a button here, and the picture
 * saves as it changes like every other picture in this editor.
 */
export function TitleSection({
  project,
  apply,
  onDirtyChange,
}: {
  project: ApiProjectDetail
  apply: (project: ApiProjectDetail) => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const id = useId()
  const { message, busy, setMessage, run } = useSectionStatus()
  const [saved, setSaved] = useState(false)
  const [framing, setFraming] = useState(false)
  const [url, setUrl] = useState('')
  const [clearing, setClearing] = useState(false)

  const [title, setTitle] = useState(project.title)
  const [summary, setSummary] = useState(project.summary ?? '')
  const [gallery, setGallery] = useState(project.galleryHeading ?? '')
  const [resources, setResources] = useState(project.resourcesHeading ?? '')
  const [team, setTeam] = useState(project.teamHeading ?? '')

  /**
   * Compared against the project rather than a remembered baseline, because
   * `apply` writes the saved values back into it — so after a save the two agree
   * by construction and there is no second copy to keep in step. The same rule
   * `ProseAndLinks` follows.
   */
  const dirty =
    title !== project.title ||
    summary !== (project.summary ?? '') ||
    gallery !== (project.galleryHeading ?? '') ||
    resources !== (project.resourcesHeading ?? '') ||
    team !== (project.teamHeading ?? '')

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  const cover = coverOf(project)

  /** Every cover write is a PATCH of the project, and they all land the same
      way — the route answers with what it wrote, so nothing is re-read. */
  const patchProject = async (body: Record<string, unknown>) => {
    const written = await patchJson<Partial<ApiProjectDetail>>(
      `/projects/${project.id}`,
      body,
    )
    apply({ ...project, ...written })
  }

  const save = () =>
    run(async () => {
      setSaved(false)
      // Blank clears the column rather than storing an empty string — two
      // spellings of "nothing here" is one too many, and every page falls back
      // to the standing heading on null.
      await patchProject({
        title: title.trim(),
        summary: summary.trim() || null,
        galleryHeading: gallery.trim() || null,
        resourcesHeading: resources.trim() || null,
        teamHeading: team.trim() || null,
      })
      setSaved(true)
    })

  const uploadChosen = (chosen: File) =>
    run(async () => {
      const { file } = await downscaleImage(chosen)
      const body = new FormData()
      body.append('file', file)

      const written = await postForm<Partial<ApiProjectDetail>>(
        `/projects/${project.id}/cover`,
        body,
      )
      apply({ ...project, ...written })
      // Straight into framing, the same as the gallery: the moment a picture
      // lands is the moment its framing is worth looking at, and every photo the
      // club takes is some shape the 16:10 card is not.
      setFraming(true)
    })

  return (
    <section>
      <p className="mb-4 font-mono text-[13px] font-bold tracking-[0.2em] text-faint">
        / TITLE
      </p>

      <div className="space-y-4">
        <div>
          <label className={labelClass} htmlFor={`${id}-title`}>
            TITLE
          </label>
          <input
            id={`${id}-title`}
            type="text"
            value={title}
            maxLength={160}
            disabled={busy}
            onChange={(event) => {
              setTitle(event.target.value)
              setSaved(false)
            }}
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor={`${id}-summary`}>
            SUMMARY
          </label>
          <textarea
            id={`${id}-summary`}
            value={summary}
            maxLength={500}
            rows={2}
            disabled={busy}
            onChange={(event) => {
              setSummary(event.target.value)
              setSaved(false)
            }}
            className="textarea w-full border-rule bg-base-200 text-sm"
          />
          <p className="mt-1.5 text-[11px] leading-[1.5] text-faint">
            What shows in the projects list.
          </p>
        </div>
      </div>

      {/* --------------------------------------------------------- the cover */}

      <p className={`${labelClass} mt-7`}>COVER IMAGE</p>
      <p className="mb-3 text-[11px] leading-[1.5] text-pretty text-faint">
        The one picture beside this project on the projects list. The gallery is what its
        own page shows.
      </p>

      {/* A real checkbox with the label wrapped round it, so the whole line is
          the hit area and the accessible name is what a screen reader announces
          — the shape the meeting-days fieldset uses. */}
      <label className="flex cursor-pointer items-start gap-3 border border-rule bg-base-200 p-3">
        <input
          type="checkbox"
          checked={project.coverFromGallery}
          disabled={busy}
          onChange={(event) => {
            // Immediately, not under SAVE: it changes what the public list shows
            // and the panel below redraws on the answer, so a pending version of
            // this would be a control that appears not to work.
            const on = event.target.checked
            void run(async () => {
              await patchProject({ coverFromGallery: on })
              setFraming(false)
            })
          }}
          className="checkbox mt-0.5 shrink-0 border-rule checkbox-sm"
        />
        <span className="text-[13px] leading-[1.5]">
          <span className="font-mono text-[11px] font-medium tracking-[0.14em]">
            USE THE FIRST GALLERY PICTURE
          </span>
          <span className="mt-1 block text-[11px] leading-[1.5] text-faint">
            {project.coverFromGallery
              ? 'On — reordering the gallery changes what the list shows.'
              : 'Off — the list shows the picture chosen here, whatever the gallery does.'}
          </span>
        </span>
      </label>

      <div className="mt-3">
        {cover ? (
          <img
            src={imageSrc(cover.url)}
            alt=""
            decoding="async"
            style={frameStyle(cover)}
            className="aspect-[16/10] w-full max-w-[22rem] border border-rule bg-hatch"
          />
        ) : (
          /* Drawn empty here where it is never drawn on the page, for the same
             reason the gallery's well is: this is the thing somebody is about to
             put a picture into. */
          <p className="flex aspect-[16/10] w-full max-w-[22rem] items-center justify-center border border-rule bg-hatch font-mono text-[11px] font-medium tracking-[0.14em] text-faint">
            {project.coverFromGallery ? '[ NO GALLERY YET ]' : '[ NO COVER YET ]'}
          </p>
        )}
      </div>

      {project.coverFromGallery ? (
        <p className="mt-2 text-[11px] leading-[1.5] text-faint">
          Taken from the gallery below. Frame it there, or untick the box to give the list
          a picture of its own.
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-4 wide:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor={`${id}-cover-file`}>
                UPLOAD A COVER
              </label>
              <input
                id={`${id}-cover-file`}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES}
                disabled={busy}
                onChange={(event) => {
                  const chosen = event.target.files?.[0]
                  // Cleared before the upload rather than after, so choosing the
                  // same file again still fires a change event — an input whose
                  // value has not moved does not emit one, which is how a retry
                  // after a failure silently does nothing.
                  event.target.value = ''
                  if (chosen) void uploadChosen(chosen)
                }}
                className="file-input w-full border-rule bg-base-200 text-sm"
              />
            </div>

            <div>
              <label className={labelClass} htmlFor={`${id}-cover-url`}>
                OR LINK TO ONE
              </label>
              <input
                id={`${id}-cover-url`}
                type="url"
                value={url}
                maxLength={500}
                placeholder="https://…"
                disabled={busy}
                onChange={(event) => {
                  setUrl(event.target.value)
                }}
                className={fieldClass}
              />
              <button
                type="button"
                onClick={() => {
                  void run(async () => {
                    await patchProject({ coverUrl: url.trim() })
                    setUrl('')
                    setFraming(true)
                  })
                }}
                disabled={busy || url.trim() === ''}
                className="btn mt-2 h-auto min-h-0 border-base-content/28 btn-outline px-5 py-2.5 text-[12px] font-semibold text-base-content hover:border-base-content hover:bg-base-content/6 hover:text-base-content disabled:opacity-50"
              >
                ADD
              </button>
            </div>
          </div>

          {cover && (
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
              <button
                type="button"
                aria-expanded={framing}
                disabled={busy}
                onClick={() => {
                  setFraming(!framing)
                }}
                className={`cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50 ${
                  framing ? 'text-primary' : 'text-faint hover:text-primary'
                }`}
              >
                FRAME THE COVER
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  // Only an upload needs the ceremony — a pasted address can be
                  // pasted back, the bytes cannot.
                  if (project.coverUrl && isStoredUpload(project.coverUrl)) {
                    setClearing(true)
                  } else {
                    void run(async () => {
                      await patchProject({ coverUrl: null })
                    })
                  }
                }}
                className="cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] text-faint transition-colors duration-200 hover:text-error disabled:opacity-50"
              >
                REMOVE THE COVER
              </button>
            </div>
          )}

          {framing && cover && (
            <ImageFramer
              url={cover.url}
              initial={safeFraming(cover)}
              busy={busy}
              onCancel={() => {
                setFraming(false)
              }}
              onSave={(next: Framing) => {
                void run(async () => {
                  await patchProject({
                    coverFocalX: next.focalX,
                    coverFocalY: next.focalY,
                    coverZoom: next.zoom,
                  })
                  setFraming(false)
                })
              }}
            />
          )}
        </>
      )}

      {/* --------------------------------------------------- section headings */}

      <p className={`${labelClass} mt-7`}>SECTION HEADINGS</p>
      <p className="mb-3 text-[11px] leading-[1.5] text-pretty text-faint">
        What this project calls the three sections of its page. Leave one blank for the
        usual word.
      </p>

      <div className="grid gap-4 wide:grid-cols-3">
        <HeadingField
          id={`${id}-gallery`}
          label="GALLERY"
          value={gallery}
          disabled={busy}
          onChange={(next) => {
            setGallery(next)
            setSaved(false)
          }}
        />
        <HeadingField
          id={`${id}-resources`}
          label="RESOURCES"
          value={resources}
          disabled={busy}
          onChange={(next) => {
            setResources(next)
            setSaved(false)
          }}
        />
        <HeadingField
          id={`${id}-team`}
          label="THE TEAM"
          value={team}
          disabled={busy}
          onChange={(next) => {
            setTeam(next)
            setSaved(false)
          }}
        />
      </div>

      <div className="mt-6">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || title.trim() === ''}
          className={submitClass}
        >
          {/* A button says what pressing it does, so the resting state is SAVE
              rather than a report of what happened last. "Saved." below is the
              status line, which is where that belongs.

              Named for this section while there is something to save, because
              the writing section lower down has its own button — two controls
              reading the same word are two a screen reader cannot tell apart,
              and the dirty state is when it matters which one is being pressed. */}
          {busy ? 'SAVING…' : dirty ? 'SAVE THE TITLE' : 'SAVE'}
        </button>
      </div>

      <Status message={message} />
      {message === '' && saved && !dirty && <Status message="Saved." tone="ok" />}
      {/* Said here as well as in the dialog on the way out, so somebody who
          scrolls past can see there is something outstanding before they are
          asked about it. */}
      {message === '' && dirty && (
        <p role="status" className="mt-2 min-h-4 text-[12px] text-warning">
          Unsaved changes.
        </p>
      )}

      {clearing && (
        <ConfirmDialog
          title="Remove this cover?"
          confirmLabel="REMOVE IT"
          busy={busy}
          onConfirm={() => {
            void run(async () => {
              await patchProject({ coverUrl: null })
              setClearing(false)
              setMessage('')
            })
          }}
          onDismiss={() => {
            setClearing(false)
          }}
        >
          <p>
            This one is in the club&rsquo;s own storage, so removing it deletes the file.
            There is no copy to put back.
          </p>
        </ConfirmDialog>
      )}
    </section>
  )
}

/** One heading box. The `/ ` and the capitals belong to the page, so the label
    is the standing word and the placeholder is what leaving it blank gets. */
function HeadingField({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string
  label: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <div>
      <label className={labelClass} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={40}
        placeholder={label}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className={fieldClass}
      />
    </div>
  )
}
