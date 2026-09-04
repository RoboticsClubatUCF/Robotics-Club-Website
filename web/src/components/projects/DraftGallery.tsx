import { useEffect, useId, useRef, useState } from 'react'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { ImageFramer } from '../shared/ImageFramer'
import { fieldClass, labelClass } from '../shared/formChrome'
import { ACCEPTED_IMAGE_TYPES, downscaleImage } from '../../lib/media/downscaleImage'
import { frameStyle } from '../../lib/media/imageFraming'
import { isStoredUpload } from '../../lib/media/storedFiles'
import {
  draftFromFile,
  draftFromUrl,
  draftSrc,
  releaseDraftImage,
  type DraftImage,
} from '../../lib/projects/projectDraft'
import { MAX_PROJECT_IMAGES, moveItem } from '../../lib/projects/projectGallery'

/**
 * The gallery section, for a project that exists and for one that does not yet.
 *
 * Nothing here talks to the server, which is what lets it be one component rather than two. A
 * picture is held in the browser — a file as an object URL, an address as itself, a picture already
 * on the project as the row it came from — and the whole set is sent when the page is saved: by
 * `saveGallery` in the editor, by `publishDraft` on the create page.
 *
 * There was a second, near-identical copy of this that wrote as it went: it uploaded on choosing a
 * file, deleted on the ✕, and saved a caption on blur. It is gone, and the parts of it that only
 * made sense because it wrote immediately went with it — the per-action status line, the debounced
 * reorder. The one part that did not is kept below: removing a picture the club is hosting still
 * asks first, because the ✕ is now a promise to delete bytes rather than the deletion itself.
 *
 * A file is downscaled the moment it is chosen rather than at save time. Same work either way, and
 * doing it here means the size shown in the row is the size that will be uploaded, and a photo too
 * large to send is found out about while there is still a form to fix it in.
 */
export function DraftGallery({
  images,
  disabled,
  onChange,
  heading = 'GALLERY',
}: {
  images: DraftImage[]
  disabled: boolean
  onChange: (images: DraftImage[]) => void
  /** What this project calls the section. The `/ ` and the capitals are the
      page's; this is the word after it. */
  heading?: string
}) {
  const id = useId()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [framing, setFraming] = useState<string | null>(null)
  const [doomed, setDoomed] = useState<DraftImage | null>(null)

  const full = images.length >= MAX_PROJECT_IMAGES

  /**
   * Every object URL still held when this unmounts, handed back.
   *
   * Read through a ref so the cleanup does not re-run on every change to the
   * list — an effect depending on `images` would revoke the previews of the
   * pictures still on screen the moment another was added.
   */
  const held = useRef(images)
  held.current = images
  useEffect(
    () => () => {
      held.current.forEach(releaseDraftImage)
    },
    [],
  )

  const addFile = (chosen: File) => {
    setBusy(true)
    setNote('')

    void downscaleImage(chosen).then(({ file, downscaled }) => {
      const added = draftFromFile(file)
      onChange([...images, added])
      setNote(
        downscaled
          ? `Ready — resized from ${sizeOf(chosen.size)} to ${sizeOf(file.size)} on the way.`
          : 'Ready.',
      )
      // Straight into framing: the moment a picture lands is the moment its
      // framing is worth looking at, and every photo this club takes is some
      // shape the 16:10 frame is not.
      setFraming(added.key)
      setBusy(false)
    })
  }

  const addUrl = () => {
    const added = draftFromUrl(url.trim())
    onChange([...images, added])
    setUrl('')
    setNote('')
    setFraming(added.key)
  }

  const remove = (image: DraftImage) => {
    releaseDraftImage(image)
    onChange(images.filter((row) => row.key !== image.key))
    if (framing === image.key) setFraming(null)
    setDoomed(null)
  }

  const patch = (image: DraftImage, change: Partial<DraftImage>) => {
    onChange(
      images.map((row) =>
        row.key === image.key ? ({ ...row, ...change } as DraftImage) : row,
      ),
    )
  }

  return (
    <section>
      <p className="text-faint mb-4 font-mono text-[13px] font-bold tracking-[0.2em] uppercase">
        / {heading}
      </p>

      {images.length === 0 ? (
        <p className="bg-hatch border-rule text-faint flex aspect-[16/10] w-full items-center justify-center border font-mono text-[11px] font-medium tracking-[0.14em]">
          [ NO IMAGES YET ]
        </p>
      ) : (
        <ul className="space-y-2">
          {images.map((image, index) => (
            <li key={image.key} className="border-rule bg-base-200 border p-2">
              <div className="flex flex-wrap items-center gap-3">
                {/* Framed, so the row shows what the page will show rather than
                    the raw file — otherwise a lead frames a picture and the list
                    they are working from still disagrees with them. */}
                <img
                  src={draftSrc(image)}
                  alt=""
                  decoding="async"
                  style={frameStyle(image.framing)}
                  className="bg-hatch h-14 w-20 shrink-0"
                />

                <input
                  type="text"
                  value={image.caption}
                  maxLength={160}
                  placeholder="Caption (optional)"
                  aria-label={`Caption for image ${index + 1}`}
                  disabled={disabled}
                  onChange={(event) => {
                    patch(image, { caption: event.target.value })
                  }}
                  className="input border-rule bg-base-100 h-9 min-h-0 min-w-0 flex-1 text-[13px]"
                />

                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Frame image ${index + 1}`}
                    aria-expanded={framing === image.key}
                    disabled={disabled}
                    onClick={() => {
                      setFraming(framing === image.key ? null : image.key)
                    }}
                    className={`cursor-pointer px-2 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50 ${
                      framing === image.key
                        ? 'text-primary'
                        : 'text-faint hover:text-primary'
                    }`}
                  >
                    FRAME
                  </button>
                  <MoveButton
                    label={`Move image ${index + 1} earlier`}
                    glyph="‹"
                    disabled={index === 0 || disabled}
                    onClick={() => {
                      onChange(moveItem(images, index, index - 1))
                    }}
                  />
                  <MoveButton
                    label={`Move image ${index + 1} later`}
                    glyph="›"
                    disabled={index === images.length - 1 || disabled}
                    onClick={() => {
                      onChange(moveItem(images, index, index + 1))
                    }}
                  />
                  <button
                    type="button"
                    aria-label={`Remove image ${index + 1}`}
                    disabled={disabled}
                    onClick={() => {
                      // Only a picture the club is hosting needs the ceremony.
                      // One that was never uploaded costs nothing to take back,
                      // and an address can be pasted in again — the bytes cannot.
                      if (image.kind === 'stored' && isStoredUpload(image.url)) {
                        setDoomed(image)
                      } else {
                        remove(image)
                      }
                    }}
                    className="text-faint hover:text-error flex size-11 cursor-pointer items-center justify-center text-sm transition-colors duration-200 disabled:opacity-50 wide:size-8"
                  >
                    ✕
                  </button>
                </span>
              </div>

              {framing === image.key && (
                <ImageFramer
                  url={draftSrc(image)}
                  initial={image.framing}
                  busy={disabled}
                  onCancel={() => {
                    setFraming(null)
                  }}
                  onSave={(next) => {
                    patch(image, { framing: next })
                    setFraming(null)
                  }}
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
            type="file"
            accept={ACCEPTED_IMAGE_TYPES}
            disabled={disabled || busy || full}
            onChange={(event) => {
              const chosen = event.target.files?.[0]
              // Cleared before, not after, so choosing the *same* file again
              // still fires a change event.
              event.target.value = ''
              if (chosen) addFile(chosen)
            }}
            className="file-input border-rule bg-base-200 w-full text-sm"
          />
          <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
            {busy
              ? 'Preparing…'
              : 'Choosing a picture opens the framing tool. Large photos are shrunk in the browser first, and nothing is uploaded until this page is saved.'}
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
            disabled={disabled || full}
            onChange={(event) => {
              setUrl(event.target.value)
            }}
            onKeyDown={(event) => {
              // This also sits inside the create form, which is listening for
              // Enter.
              if (event.key !== 'Enter') return
              event.preventDefault()
              if (url.trim()) addUrl()
            }}
            className={fieldClass}
          />
          <button
            type="button"
            onClick={addUrl}
            disabled={disabled || full || url.trim() === ''}
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

      <p role="status" className="text-primary mt-2 min-h-4 text-[12px]">
        {note}
      </p>

      {doomed && (
        <ConfirmDialog
          title="Remove this picture?"
          confirmLabel="REMOVE IT"
          onConfirm={() => {
            remove(doomed)
          }}
          onDismiss={() => {
            setDoomed(null)
          }}
        >
          <p>
            This one is in the club's own storage, so the file is deleted when
            this page is saved. There is no copy to put back.
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
