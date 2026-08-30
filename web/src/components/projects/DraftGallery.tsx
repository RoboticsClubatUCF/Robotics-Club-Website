import { useEffect, useId, useRef, useState } from 'react'
import { ImageFramer } from '../shared/ImageFramer'
import { fieldClass, labelClass } from '../shared/formChrome'
import { ACCEPTED_IMAGE_TYPES, downscaleImage } from '../../lib/media/downscaleImage'
import { frameStyle } from '../../lib/media/imageFraming'
import {
  draftFromFile,
  draftFromUrl,
  draftSrc,
  releaseDraftImage,
  type DraftImage,
} from '../../lib/projects/projectDraft'
import { MAX_PROJECT_IMAGES, moveItem } from '../../lib/projects/projectGallery'

/**
 * The gallery, before there is a project to attach it to.
 *
 * The same section as `GalleryEditor`, with the one difference that decides
 * everything else: **nothing here talks to the server.** Pictures are held in
 * the browser — a file as an object URL, an address as itself — and the whole
 * set is sent by `publishDraft` when the project is created.
 *
 * That makes this the simpler of the two rather than a copy of it. There is no
 * per-action status line, because nothing can fail yet; no confirm-before-
 * delete, because removing a picture that was never uploaded destroys nothing;
 * and no debounced reorder, because reordering is a state change and not a
 * write. What it does share is `ImageFramer`, so a picture is framed here
 * exactly as it is framed afterwards, and the framing travels with it.
 *
 * A file is downscaled the moment it is chosen rather than at publish time. It
 * is the same work either way, and doing it here means the size shown in the
 * row is the size that will be uploaded — and that a photo too large to send is
 * found out about while there is still a form to fix it in.
 */
export function DraftGallery({
  images,
  disabled,
  onChange,
}: {
  images: DraftImage[]
  disabled: boolean
  onChange: (images: DraftImage[]) => void
}) {
  const id = useId()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [framing, setFraming] = useState<string | null>(null)

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
      // Straight into framing, exactly as the live editor does: the moment a
      // picture lands is the moment its framing is worth looking at.
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
      <p className="text-faint mt-8 mb-4 font-mono text-[13px] font-bold tracking-[0.2em]">
        / GALLERY
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
                    the raw file — the same reason the live editor does it. */}
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
                  {/* No confirmation: nothing has been uploaded, so there are no
                      bytes to lose — which is the only reason the live editor
                      asks. */}
                  <button
                    type="button"
                    aria-label={`Remove image ${index + 1}`}
                    disabled={disabled}
                    onClick={() => {
                      remove(image)
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
              : 'Choosing a picture opens the framing tool. Large photos are shrunk in the browser first, and nothing is uploaded until the project is created.'}
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
              // This sits inside the create form, which is listening for Enter.
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
