import { useEffect, useId, useRef, useState } from 'react'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { ImageFramer } from '../shared/ImageFramer'
import { fieldClass, labelClass } from '../shared/formChrome'
import { patchJson, postForm } from '../../lib/api/api'
import type { ApiProjectDetail } from '../../lib/api/api'
import { ACCEPTED_IMAGE_TYPES, downscaleImage } from '../../lib/media/downscaleImage'
import { frameStyle, safeFraming, type Framing } from '../../lib/media/imageFraming'
import { imageSrc, isStoredUpload } from '../../lib/media/storedFiles'
import { draftSrc, type DraftImage } from '../../lib/projects/projectDraft'
import { useSectionSave, type SaveRegistry } from '../../lib/projects/editorSaves'

/**
 * The `/ TITLE` section: what a project is called, the line the projects list prints, the picture
 * beside it, and what this project calls its own sections.
 *
 * It's first because it's the top of the page it edits, and because the cover and the summary are
 * the only two things a stranger sees before deciding whether to open the project at all.
 *
 * It used to carry a SAVE of its own and no longer does. The cover went up the moment a file was
 * chosen, the checkbox wrote as it was ticked, and the words waited for a button here while the
 * writing below waited for a different button with the same label on it. All of it waits for the
 * page's one SAVE now, so the picture in the frame below is a preview until then and says so.
 */
export function TitleSection({
  project,
  images,
  registry,
  busy,
}: {
  project: ApiProjectDetail
  /**
   * The gallery as it's being edited, not as the server holds it.
   *
   * The cover can be the gallery's first picture, and the two sections are far apart on the page —
   * so a preview drawn from `project.images` would go on showing the old first photo while a new
   * one sat unsaved at the top of the gallery below.
   */
  images: DraftImage[]
  registry: SaveRegistry
  busy: boolean
}) {
  const id = useId()
  const [framing, setFraming] = useState(false)
  const [url, setUrl] = useState('')
  const [clearing, setClearing] = useState(false)

  const [title, setTitle] = useState(project.title)
  const [summary, setSummary] = useState(project.summary ?? '')
  const [gallery, setGallery] = useState(project.galleryHeading ?? '')
  const [resources, setResources] = useState(project.resourcesHeading ?? '')
  const [team, setTeam] = useState(project.teamHeading ?? '')
  const [fromGallery, setFromGallery] = useState(project.coverFromGallery)
  const [cover, setCover] = useState<CoverDraft>(KEPT)
  const [coverFraming, setCoverFraming] = useState<Framing>(() =>
    safeFraming({
      focalX: project.coverFocalX,
      focalY: project.coverFocalY,
      zoom: project.coverZoom,
    }),
  )

  /** The object URL behind a chosen file, handed back on unmount. Read through
      a ref for the reason `DraftGallery`'s cleanup is. */
  const held = useRef(cover)
  held.current = cover
  useEffect(
    () => () => {
      releaseCover(held.current)
    },
    [],
  )

  /**
   * Compared against the project rather than a remembered baseline, because what
   * the save returns is written back into it — so afterwards the two agree by
   * construction and there is no second copy to keep in step.
   */
  const dirty =
    title !== project.title ||
    summary !== (project.summary ?? '') ||
    gallery !== (project.galleryHeading ?? '') ||
    resources !== (project.resourcesHeading ?? '') ||
    team !== (project.teamHeading ?? '') ||
    fromGallery !== project.coverFromGallery ||
    cover.kind !== 'kept' ||
    coverFraming.focalX !== project.coverFocalX ||
    coverFraming.focalY !== project.coverFocalY ||
    coverFraming.zoom !== project.coverZoom

  useSectionSave(registry, 'title', {
    dirty,
    // Refused here rather than by the server, which would answer 400 after
    // however many uploads the sections ahead of this one had already sent.
    blocked: title.trim() === '' ? 'The project needs a title.' : null,
    save: async () => {
      // The one thing in this section that cannot ride along in the PATCH: a
      // file is a multipart upload against its own budget, and the route writes
      // `coverUrl` itself. It goes first so the PATCH below answers with it.
      if (cover.kind === 'file') {
        const body = new FormData()
        body.append('file', cover.file)
        await postForm(`/projects/${project.id}/cover`, body)
      }

      const written = await patchJson<Partial<ApiProjectDetail>>(
        `/projects/${project.id}`,
        {
          title: title.trim(),
          // Blank clears the column rather than storing an empty string — two
          // spellings of "nothing here" is one too many, and every page falls
          // back to the standing heading on null.
          summary: summary.trim() || null,
          galleryHeading: gallery.trim() || null,
          resourcesHeading: resources.trim() || null,
          teamHeading: team.trim() || null,
          coverFromGallery: fromGallery,
          ...(cover.kind === 'url' ? { coverUrl: cover.url } : {}),
          ...(cover.kind === 'none' ? { coverUrl: null } : {}),
          coverFocalX: coverFraming.focalX,
          coverFocalY: coverFraming.focalY,
          coverZoom: coverFraming.zoom,
        },
      )

      // Only once the whole section has landed. A retry after a failed PATCH
      // uploads the file a second time, which the route handles by replacing —
      // the alternative is a page showing the *old* cover as though it were the
      // saved one.
      releaseCover(cover)
      setCover(KEPT)
      setUrl('')
      return written
    },
  })

  const preview = fromGallery
    ? images.length > 0
      ? { src: draftSrc(images[0]), framing: images[0].framing }
      : null
    : coverPreview(cover, project.coverUrl, coverFraming)

  const chooseFile = (chosen: File) => {
    // Downscaled here rather than at save time, exactly as the gallery does it:
    // the same work either way, and a photo too large to send is found out about
    // while there is still a form to fix it in.
    void downscaleImage(chosen).then(({ file }) => {
      releaseCover(held.current)
      setCover({ kind: 'file', file, previewUrl: URL.createObjectURL(file) })
      setCoverFraming(safeFraming(null))
      setFraming(true)
    })
  }

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
          checked={fromGallery}
          disabled={busy}
          onChange={(event) => {
            setFromGallery(event.target.checked)
            setFraming(false)
          }}
          className="checkbox mt-0.5 shrink-0 border-rule checkbox-sm"
        />
        <span className="text-[13px] leading-[1.5]">
          <span className="font-mono text-[11px] font-medium tracking-[0.14em]">
            USE THE FIRST GALLERY PICTURE
          </span>
          <span className="mt-1 block text-[11px] leading-[1.5] text-faint">
            {fromGallery
              ? 'On — reordering the gallery changes what the list shows.'
              : 'Off — the list shows the picture chosen here, whatever the gallery does.'}
          </span>
        </span>
      </label>

      <div className="mt-3">
        {preview ? (
          <img
            src={imageSrc(preview.src)}
            alt=""
            decoding="async"
            style={frameStyle(preview.framing)}
            className="aspect-[16/10] w-full max-w-[22rem] border border-rule bg-hatch"
          />
        ) : (
          /* Drawn empty here where it is never drawn on the page, for the same
             reason the gallery's well is: this is the thing somebody is about to
             put a picture into. */
          <p className="flex aspect-[16/10] w-full max-w-[22rem] items-center justify-center border border-rule bg-hatch font-mono text-[11px] font-medium tracking-[0.14em] text-faint">
            {fromGallery ? '[ NO GALLERY YET ]' : '[ NO COVER YET ]'}
          </p>
        )}
      </div>

      {fromGallery ? (
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
                  if (chosen) chooseFile(chosen)
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
                  releaseCover(held.current)
                  setCover({ kind: 'url', url: url.trim() })
                  setCoverFraming(safeFraming(null))
                  setFraming(true)
                }}
                disabled={busy || url.trim() === ''}
                className="btn mt-2 h-auto min-h-0 border-base-content/28 btn-outline px-5 py-2.5 text-[12px] font-semibold text-base-content hover:border-base-content hover:bg-base-content/6 hover:text-base-content disabled:opacity-50"
              >
                USE THIS ONE
              </button>
            </div>
          </div>

          {preview && (
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
                  // Only a picture the club is hosting needs the ceremony — an
                  // address can be pasted back in, and a file that has not gone
                  // up yet costs nothing to take back.
                  if (
                    cover.kind === 'kept' &&
                    project.coverUrl &&
                    isStoredUpload(project.coverUrl)
                  ) {
                    setClearing(true)
                  } else {
                    releaseCover(held.current)
                    setCover({ kind: 'none' })
                    setFraming(false)
                  }
                }}
                className="cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] text-faint transition-colors duration-200 hover:text-error disabled:opacity-50"
              >
                REMOVE THE COVER
              </button>
            </div>
          )}

          {framing && preview && (
            <ImageFramer
              url={preview.src}
              initial={preview.framing}
              busy={busy}
              onCancel={() => {
                setFraming(false)
              }}
              onSave={(next: Framing) => {
                setCoverFraming(next)
                setFraming(false)
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
          onChange={setGallery}
        />
        <HeadingField
          id={`${id}-resources`}
          label="RESOURCES"
          value={resources}
          disabled={busy}
          onChange={setResources}
        />
        <HeadingField
          id={`${id}-team`}
          label="THE TEAM"
          value={team}
          disabled={busy}
          onChange={setTeam}
        />
      </div>

      {clearing && (
        <ConfirmDialog
          title="Remove this cover?"
          confirmLabel="REMOVE IT"
          onConfirm={() => {
            releaseCover(held.current)
            setCover({ kind: 'none' })
            setFraming(false)
            setClearing(false)
          }}
          onDismiss={() => {
            setClearing(false)
          }}
        >
          <p>
            This one is in the club&rsquo;s own storage, so the file is deleted when this
            page is saved. There is no copy to put back.
          </p>
        </ConfirmDialog>
      )}
    </section>
  )
}

/**
 * What the cover is about to become.
 *
 * `kept` is the state this starts and ends in: whatever the project already holds, untouched. The
 * other three are the three things somebody can do to it, and each is a different write — an
 * upload is multipart, an address is a column, and clearing it is that column set to null.
 */
type CoverDraft =
  | { kind: 'kept' }
  | { kind: 'none' }
  | { kind: 'url'; url: string }
  | { kind: 'file'; file: File; previewUrl: string }

const KEPT: CoverDraft = { kind: 'kept' }

/** Hands back the memory an unsaved file preview is pinning. */
function releaseCover(cover: CoverDraft): void {
  if (cover.kind === 'file') URL.revokeObjectURL(cover.previewUrl)
}

/** The cover as the frame should draw it, or null for an empty well. */
function coverPreview(
  cover: CoverDraft,
  storedUrl: string | null,
  framing: Framing,
): { src: string; framing: Framing } | null {
  if (cover.kind === 'none') return null
  if (cover.kind === 'file') return { src: cover.previewUrl, framing }
  if (cover.kind === 'url') return cover.url ? { src: cover.url, framing } : null
  return storedUrl ? { src: storedUrl, framing } : null
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
