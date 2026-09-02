import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { DocumentsEditor } from './DocumentsEditor'
import { ImageFramer } from '../shared/ImageFramer'
import { LinkRows } from './LinkRows'
import { Status } from '../shared/Status'
import { TeamEditor } from './TeamEditor'
import { TitleSection } from './TitleSection'
import { useProjectRoster } from '../../lib/projects/useProjectRoster'
import { useSectionStatus } from '../../lib/useSectionStatus'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { fieldClass, labelClass, submitClass } from '../shared/formChrome'
import { deleteJson, patchJson, postForm, postJson } from '../../lib/api/api'
import type {
  ApiProjectDetail,
  ApiProjectImage,
  ApiProjectLink,
} from '../../lib/api/api'
import { explainApiError } from '../../lib/api/apiErrors'
import { ACCEPTED_IMAGE_TYPES, downscaleImage } from '../../lib/media/downscaleImage'
import { frameStyle, safeFraming, type Framing } from '../../lib/media/imageFraming'
import { usableLinks, type DraftLink } from '../../lib/projects/projectDraft'
import { MAX_PROJECT_IMAGES, moveItem } from '../../lib/projects/projectGallery'
import { imageSrc, isStoredUpload } from '../../lib/media/storedFiles'

/**
 * The public page, editable in place.
 *
 * It draws the same sections in the same order under the same eyebrows as the
 * read view, each one swapped for its form — so the page does not rearrange
 * itself when somebody presses EDIT PAGE, it just becomes typeable.
 *
 * **How saves dispatch is deliberately not uniform, and the split is the
 * design:**
 *
 *   - *Prose and links* wait for one SAVE. One press, at most two requests.
 *     Autosaving a textarea is how a half-written sentence becomes the
 *     published one.
 *   - *Pictures* each go immediately, because each has its own failure worth
 *     seeing at the moment it happens: an upload can be refused for its size,
 *     a removal destroys bytes that do not come back, and a reorder is a set
 *     operation the server can reject wholesale. Holding a `File` in state
 *     until a SAVE button would deliver the "too big" a minute after the
 *     choice that caused it.
 *
 * Nothing here re-reads the whole project after a write. Every write route
 * answers with the row or the list it wrote, and that is what lands in state —
 * partly because it is one round trip instead of two, and mostly because
 * `/projects/:slug` is a *cached* public route, so a read taken straight after
 * a write can honestly answer with the copy from before it.
 */
export function ProjectEditor({
  project,
  asOfficer,
  me,
  apply,
  onDone,
  onDirtyChange,
  doneLabel = 'DONE EDITING',
  writingFirst = false,
}: {
  project: ApiProjectDetail
  asOfficer: boolean
  /**
   * Whoever is doing the editing. Only the documentation section wants it —
   * a credit has to start on somebody — and it is threaded through rather than
   * read from the session there, so this component keeps working anywhere a
   * project can be handed to it.
   */
  me?: { id: string; fullName: string }
  apply: (project: ApiProjectDetail) => void
  onDone: () => void
  /**
   * Reported upward because the *other* way out of edit mode is a button in the
   * page header, outside this component — and a guard that only covered the one
   * at the bottom would be a guard somebody walks straight past.
   */
  onDirtyChange?: (dirty: boolean) => void
  doneLabel?: string
  /**
   * Which section comes first. The public page wants the gallery there, because
   * that is the order the page itself reads in. The officer desk wants the
   * writing, because the fields directly above it a moment ago were the create
   * form's — and the whole point of that panel is that nothing jumps when the
   * project comes into existence halfway down it.
   */
  writingFirst?: boolean
}) {
  /**
   * **Two deferred-save sections now, so dirtiness is two flags.**
   *
   * `ProseAndLinks` used to be the only thing on this page that waited for a
   * button, so it could report straight upward. The title section waits too, and
   * a guard that heard from only one of them is a guard somebody walks past
   * carrying an unsaved summary. Reported as the OR, which is all either exit
   * needs to know.
   */
  const [dirty, setDirty] = useState({ title: false, writing: false })

  useEffect(() => {
    onDirtyChange?.(dirty.title || dirty.writing)
  }, [dirty, onDirtyChange])

  const titleDirty = useCallback((value: boolean) => {
    setDirty((current) =>
      current.title === value ? current : { ...current, title: value },
    )
  }, [])

  const writingDirty = useCallback((value: boolean) => {
    setDirty((current) =>
      current.writing === value ? current : { ...current, writing: value },
    )
  }, [])

  /**
   * One roster read for the whole editor, rather than one per section that wants
   * it. The public payload carries no user ids on purpose, and both the credit
   * picker and the team section write by id.
   *
   * The documents section used to defer this until its own form opened, which
   * was worth doing while it was the only consumer and stopped being worth doing
   * the moment a section that cannot draw a row without it appeared beside it.
   */
  const roster = useProjectRoster(project.id)

  const titleSection = (
    <TitleSection
      key="title"
      project={project}
      apply={apply}
      onDirtyChange={titleDirty}
    />
  )
  const gallery = <GalleryEditor key="gallery" project={project} apply={apply} />
  const writing = (
    <ProseAndLinks
      key="writing"
      project={project}
      apply={apply}
      onDirtyChange={writingDirty}
    />
  )
  const documents = (
    <DocumentsEditor
      key="documents"
      project={project}
      me={me}
      roster={roster}
      apply={apply}
    />
  )
  const team = (
    <TeamEditor
      key="team"
      project={project}
      roster={roster}
      heading={project.teamHeading ?? 'THE TEAM'}
    />
  )

  return (
    <div className="space-y-10">
      {asOfficer && (
        /* An officer wandering into somebody else's project should know in
           which capacity they are about to change it. */
        <p className="text-faint border-rule bg-base-200 border px-4 py-2.5 font-mono text-[10px] font-medium tracking-[0.14em]">
          EDITING AS AN OFFICER — YOU DO NOT LEAD THIS PROJECT
        </p>
      )}

      {/* The title section is always first, because it is the top of the page
          it edits and because the two things on it — the cover and the summary —
          are the whole of what a stranger sees before deciding to open the
          project at all.

          After it, documentation still sits beside the gallery and never after
          the writing, and that ordering is load-bearing rather than taste.
          `ProseAndLinks` ends in SAVE CHANGES, and anything below it reads as
          being *covered* by that button — which is exactly wrong for documents,
          which save the moment they change. Grouping the immediate-save sections
          together leaves the deferred one holding the last button on the page.

          The team section is last because that is where the public page puts it,
          and because it is the only section about people rather than about the
          page. */}
      {writingFirst
        ? [titleSection, writing, gallery, documents, team]
        : [titleSection, gallery, documents, writing, team]}

      {/* The way out, again, at the end of the page — the header's copy is the
          one somebody remembers, this one is the one they reach by scrolling.
          Outline rather than gold: SAVE CHANGES above it is the page's one
          primary action, and two gold buttons would be neither. */}
      <div className="border-rule flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-6">
        <button
          type="button"
          onClick={onDone}
          className="btn btn-outline h-auto min-h-0 border-base-content/28 px-6 py-3 text-[12px] font-semibold tracking-[0.08em] text-base-content transition-colors duration-200 hover:border-base-content hover:bg-base-content/6 hover:text-base-content"
        >
          {doneLabel}
        </button>
        <span className="text-faint text-[12px] leading-[1.5]">
          Pictures and documents save as you change them; the writing and the
          links need SAVE.
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- the gallery

function GalleryEditor({
  project,
  apply,
}: {
  project: ApiProjectDetail
  apply: (project: ApiProjectDetail) => void
}) {
  const id = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const { message, busy, setMessage, run } = useSectionStatus()
  const [note, setNote] = useState('')
  const [url, setUrl] = useState('')
  const [doomed, setDoomed] = useState<ApiProjectImage | null>(null)
  /** Which picture's framing panel is open, if any. One at a time. */
  const [framing, setFraming] = useState<string | null>(null)

  const images = project.images
  const full = images.length >= MAX_PROJECT_IMAGES

  const setImages = (next: ApiProjectImage[]) => {
    apply({ ...project, images: next })
  }

  /**
   * The reorder is debounced, and it is the one debounce on this page that
   * earns itself: the route takes the *whole* order, so it is idempotent and a
   * lost intermediate press costs nothing, while a burst of five arrow presses
   * would otherwise be five writes against a budget of sixty.
   */
  const pending = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (pending.current !== null) window.clearTimeout(pending.current)
    },
    [],
  )

  const reorder = (next: ApiProjectImage[]) => {
    setImages(next)
    setMessage('')

    if (pending.current !== null) window.clearTimeout(pending.current)
    pending.current = window.setTimeout(() => {
      pending.current = null
      patchJson<ApiProjectImage[]>(`/projects/${project.id}/images/order`, {
        ids: next.map((image) => image.id),
      })
        .then((saved) => {
          setImages(saved)
        })
        .catch((error: unknown) => {
          setMessage(explainApiError(error))
        })
    }, 600)
  }

  const addByUrl = () =>
    run(async () => {
      const added = await postJson<ApiProjectImage>(
        `/projects/${project.id}/images`,
        { url: url.trim() },
      )
      setImages([...images, added])
      setUrl('')
      setNote('')
      // Straight into framing, same as an upload: a picture that has just
      // landed is exactly the one somebody wants to look at.
      setFraming(added.id)
    })

  /**
   * Choosing a file *is* the upload — there is no second button to press.
   *
   * A picker already ends in a deliberate act ("Open"), so a confirm step after
   * it asks the same question twice, and the answer to the second one is always
   * yes. What follows the upload is the framing panel, opened on the new row:
   * the moment a picture lands is the moment its framing is worth looking at,
   * and every photo this club takes is some shape the 16:10 frame is not.
   */
  const uploadChosen = (chosen: File) =>
    run(async () => {
      const { file, downscaled } = await downscaleImage(chosen)

      const body = new FormData()
      body.append('file', file)

      const added = await postForm<ApiProjectImage>(
        `/projects/${project.id}/images/upload`,
        body,
      )

      setImages([...images, added])
      setNote(
        downscaled
          ? `Added — resized from ${sizeOf(chosen.size)} to ${sizeOf(file.size)} on the way.`
          : 'Added.',
      )
      setFraming(added.id)
    })

  const remove = (image: ApiProjectImage) =>
    run(async () => {
      await deleteJson(`/projects/${project.id}/images/${image.id}`)
      setImages(images.filter((row) => row.id !== image.id))
      setDoomed(null)
      setNote('')
    })

  const setCaption = (image: ApiProjectImage, caption: string) => {
    setImages(
      images.map((row) =>
        row.id === image.id ? { ...row, caption: caption || null } : row,
      ),
    )
  }

  const saveCaption = (image: ApiProjectImage) =>
    run(async () => {
      await patchJson(`/projects/${project.id}/images/${image.id}`, {
        caption: image.caption?.trim() || null,
      })
    })

  /**
   * Written once, on DONE. Panning is continuous, so saving as it moved would
   * be a request per frame of a drag — and the route sends only the three
   * framing fields, so a caption typed but not yet blurred is not overwritten
   * by the picture being moved.
   */
  const saveFraming = (image: ApiProjectImage, next: Framing) =>
    run(async () => {
      const saved = await patchJson<ApiProjectImage>(
        `/projects/${project.id}/images/${image.id}`,
        next,
      )
      setImages(images.map((row) => (row.id === image.id ? saved : row)))
      setFraming(null)
      setNote('')
    })

  return (
    <section>
      <p className="mb-4 font-mono text-[13px] font-bold tracking-[0.2em] text-faint uppercase">
        / {project.galleryHeading ?? 'GALLERY'}
      </p>

      {images.length === 0 ? (
        /* Unlike the read view, the empty well *is* drawn here — it is the
           thing somebody is about to put a picture into. */
        <p className="bg-hatch border-rule text-faint flex aspect-[16/10] w-full items-center justify-center border font-mono text-[11px] font-medium tracking-[0.14em]">
          [ NO IMAGES YET ]
        </p>
      ) : (
        <ul className="space-y-2">
          {images.map((image, index) => (
            <li
              key={image.id}
              className="border-rule bg-base-200 border p-2"
            >
              <div className="flex flex-wrap items-center gap-3">
              {/* Framed, so the row shows what the page will show rather than
                  the raw file — otherwise a lead frames a picture and the list
                  they are working from still disagrees with them. */}
              <img
                src={imageSrc(image.url)}
                alt=""
                loading="lazy"
                decoding="async"
                style={frameStyle(image)}
                className="bg-hatch h-14 w-20 shrink-0"
              />

              <input
                type="text"
                value={image.caption ?? ''}
                maxLength={160}
                placeholder="Caption (optional)"
                aria-label={`Caption for image ${index + 1}`}
                disabled={busy}
                onChange={(event) => {
                  setCaption(image, event.target.value)
                }}
                onBlur={() => void saveCaption(image)}
                className="input border-rule bg-base-100 h-9 min-h-0 min-w-0 flex-1 text-[13px]"
              />

              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={`Frame image ${index + 1}`}
                  aria-expanded={framing === image.id}
                  disabled={busy}
                  onClick={() => {
                    setFraming(framing === image.id ? null : image.id)
                  }}
                  className={`cursor-pointer px-2 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50 ${
                    framing === image.id
                      ? 'text-primary'
                      : 'text-faint hover:text-primary'
                  }`}
                >
                  FRAME
                </button>
                <MoveButton
                  label={`Move image ${index + 1} earlier`}
                  glyph="‹"
                  disabled={index === 0 || busy}
                  onClick={() => {
                    reorder(moveItem(images, index, index - 1))
                  }}
                />
                <MoveButton
                  label={`Move image ${index + 1} later`}
                  glyph="›"
                  disabled={index === images.length - 1 || busy}
                  onClick={() => {
                    reorder(moveItem(images, index, index + 1))
                  }}
                />
                <button
                  type="button"
                  aria-label={`Remove image ${index + 1}`}
                  disabled={busy}
                  onClick={() => {
                    // Only an upload needs the ceremony — an external URL can
                    // be pasted back in, the bytes cannot.
                    if (isStoredUpload(image.url)) {
                      setDoomed(image)
                    } else {
                      void remove(image)
                    }
                  }}
                  className="text-faint hover:text-error flex size-11 cursor-pointer items-center justify-center text-sm transition-colors duration-200 disabled:opacity-50 wide:size-8"
                >
                  ✕
                </button>
              </span>
              </div>

              {framing === image.id && (
                <ImageFramer
                  url={image.url}
                  initial={safeFraming(image)}
                  busy={busy}
                  onCancel={() => {
                    setFraming(null)
                  }}
                  onSave={(next) => void saveFraming(image, next)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-4 wide:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor={`${id}-file`}>
            ADD FROM YOUR COMPUTER
          </label>
          <input
            id={`${id}-file`}
            ref={fileInput}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES}
            disabled={busy || full}
            onChange={(event) => {
              const chosen = event.target.files?.[0]
              // Cleared straight away, and before the upload rather than after,
              // so choosing the *same* file again still fires a change event —
              // an input whose value has not moved does not emit one, which is
              // how a retry after a failure silently does nothing.
              event.target.value = ''
              if (chosen) void uploadChosen(chosen)
            }}
            className="file-input border-rule bg-base-200 w-full text-sm"
          />
          <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
            {busy
              ? 'Adding…'
              : 'Choosing a picture adds it and opens the framing tool. Large photos are shrunk in the browser first, so the page stays quick to load.'}
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor={`${id}-url`}>
            OR ADD BY LINK
          </label>
          <input
            id={`${id}-url`}
            type="url"
            value={url}
            maxLength={500}
            placeholder="https://…"
            disabled={busy || full}
            onChange={(event) => {
              setUrl(event.target.value)
            }}
            className={fieldClass}
          />
          <button
            type="button"
            onClick={() => void addByUrl()}
            disabled={busy || full || url.trim() === ''}
            className="btn btn-outline mt-2 h-auto min-h-0 border-base-content/28 px-5 py-2.5 text-[12px] font-semibold text-base-content hover:border-base-content hover:bg-base-content/6 hover:text-base-content disabled:opacity-50"
          >
            ADD
          </button>
          <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
            Removing it here never deletes anything at the other end.
          </p>
        </div>
      </div>

      <p className="text-faint mt-3 font-mono text-[10px] font-medium tracking-[0.14em]">
        {images.length} / {MAX_PROJECT_IMAGES} IMAGES
        {full && ' — REMOVE ONE TO ADD ANOTHER'}
      </p>

      <Status message={message} />
      {message === '' && note !== '' && <Status message={note} tone="ok" />}

      {doomed && (
        <ConfirmDialog
          title="Delete this picture?"
          confirmLabel="DELETE IT"
          busy={busy}
          onConfirm={() => void remove(doomed)}
          onDismiss={() => {
            setDoomed(null)
          }}
        >
          <p>
            This one is in the club's own storage, so removing it deletes the
            file. There is no copy to put back.
          </p>
        </ConfirmDialog>
      )}
    </section>
  )
}

function MoveButton({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string
  glyph: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      /* Two buttons per row rather than drag-and-drop. Dragging needs a pointer
         *and* a keyboard alternative *and* an announcement to be honest about
         what it did, and there is no drag library here — these work with a
         thumb and with Tab on the first day. */
      className="border-rule text-dim enabled:hover:border-primary enabled:hover:text-primary flex size-11 cursor-pointer items-center justify-center border text-sm leading-none transition-colors duration-200 disabled:cursor-default disabled:opacity-30 wide:size-8"
    >
      {glyph}
    </button>
  )
}

/** Human bytes, for the "shrunk from X to Y" note. */
const sizeOf = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`

// ------------------------------------------------------- the writing and links

function ProseAndLinks({
  project,
  apply,
  onDirtyChange,
}: {
  project: ApiProjectDetail
  apply: (project: ApiProjectDetail) => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const id = useId()
  const { message, busy, run } = useSectionStatus()
  const [saved, setSaved] = useState(false)

  const [season, setSeason] = useState(project.season ?? '')
  const [competition, setCompetition] = useState(project.competition ?? '')
  const [description, setDescription] = useState(project.description ?? '')
  const [links, setLinks] = useState<DraftLink[]>(
    project.links.map((link) => ({ ...link })),
  )

  /**
   * Whether anything here would be lost by walking away.
   *
   * Compared against the project itself rather than a remembered baseline,
   * because `apply` writes the saved values back into it — so after a save the
   * two agree by construction, and there is no second copy to keep in step.
   *
   * One of the two parts of the editor that wait for a button — the title
   * section is the other. Pictures and documents save as they are changed, so
   * they can never be pending.
   */
  const dirty =
    season !== (project.season ?? '') ||
    competition !== (project.competition ?? '') ||
    description !== (project.description ?? '') ||
    links.length !== project.links.length ||
    links.some(
      (link, index) =>
        link.label !== project.links[index]?.label ||
        link.url !== project.links[index]?.url,
    )

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  const save = () =>
    run(async () => {
      setSaved(false)

      // Blank fields clear the column rather than storing an empty string —
      // `season === ''` and `season === null` would otherwise both exist and
      // render identically, which is a difference nobody can see and every
      // query has to handle.
      const patched = await patchJson<{
        season: string | null
        competition: string | null
        description: string | null
      }>(`/projects/${project.id}`, {
        season: season.trim() || null,
        competition: competition.trim() || null,
        description: description.trim() || null,
      })

      const savedLinks = await patchJson<ApiProjectLink[]>(
        `/projects/${project.id}/links`,
        { links: usableLinks(links) },
      )

      apply({
        ...project,
        season: patched.season,
        competition: patched.competition,
        description: patched.description,
        links: savedLinks,
      })
      setLinks(savedLinks.map((link) => ({ ...link })))
      setSaved(true)
    })

  return (
    <section>
      <p className="text-faint mb-4 font-mono text-[13px] font-bold tracking-[0.2em]">
        / THE WRITING
      </p>

      <div className="space-y-4">
        {/* The title and the summary used to be here and are the title
            section's now — they are what the projects list prints beside the
            cover, and the three belong together on the form for the same reason
            they belong together on the card. */}

        {/* Set when the project is created and never editable afterwards until
            now, which meant a season rolling over was a job for Prisma Studio.
            They print in the mono line under the title on the public page. */}
        <div className="grid gap-4 wide:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor={`${id}-season`}>
              SEASON
            </label>
            <input
              id={`${id}-season`}
              type="text"
              value={season}
              maxLength={40}
              placeholder="2026-2027"
              disabled={busy}
              onChange={(event) => {
                setSeason(event.target.value)
                setSaved(false)
              }}
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor={`${id}-competition`}>
              COMPETITION
            </label>
            <input
              id={`${id}-competition`}
              type="text"
              value={competition}
              maxLength={160}
              placeholder="UNIVERSITY ROVER CHALLENGE"
              disabled={busy}
              onChange={(event) => {
                setCompetition(event.target.value)
                setSaved(false)
              }}
              className={fieldClass}
            />
            {/* Said out loud because the placeholder reads as an example to
                follow rather than as one option, and plenty of what the club
                builds is not entered into anything. The column is nullable and
                both this page and the projects list drop the segment when it is
                empty, so a blank box is a finished answer rather than a gap. */}
            <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
              Optional.
            </p>
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor={`${id}-description`}>
            DESCRIPTION
          </label>
          <textarea
            id={`${id}-description`}
            value={description}
            maxLength={20_000}
            rows={10}
            disabled={busy}
            onChange={(event) => {
              setDescription(event.target.value)
              setSaved(false)
            }}
            className="textarea border-rule bg-base-200 w-full text-sm"
          />
          <p className="mt-1.5 text-[11px] leading-[1.5] text-faint">
            The long form, on this project&rsquo;s own page. Leave a blank line between
            paragraphs. No markdown yet.
          </p>
        </div>
      </div>

      <p className="mt-8 mb-4 font-mono text-[13px] font-bold tracking-[0.2em] text-faint uppercase">
        / {project.resourcesHeading ?? 'RESOURCES'}
      </p>

      {/* **There is no SOURCE CODE box here any more, and that is the point.**
          `repoUrl` was a column of its own and drew a fixed field above this
          list, so every project was asked for a repository and most of what the
          club builds does not have one — an empty box nobody could remove. It is
          an ordinary row now, and this section is genuinely blank until somebody
          adds something. */}
      <div className="space-y-4">
        {/* The same rows the create page collects links in, so the two states
            of that page cannot drift apart. */}
        <LinkRows
          links={links}
          disabled={busy}
          onChange={(next) => {
            setLinks(next)
            setSaved(false)
          }}
        />
        <p className="text-[11px] leading-[1.5] text-pretty text-faint">
          Anything this project points at — the design doc, the CAD, the rules, the
          repository. Leave it empty if there is nothing to link.
        </p>
      </div>

      <div className="mt-6">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className={submitClass}
        >
          {busy ? 'SAVING…' : dirty ? 'SAVE CHANGES' : 'SAVED'}
        </button>
      </div>

      <Status message={message} />
      {message === '' && saved && !dirty && <Status message="Saved." tone="ok" />}
      {/* Said here as well as in the dialog on the way out, so somebody who
          scrolls past can see there is something outstanding before they are
          asked about it. */}
      {message === '' && dirty && (
        <p role="status" className="text-warning mt-2 min-h-4 text-[12px]">
          Unsaved changes.
        </p>
      )}
    </section>
  )
}
