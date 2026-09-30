import { useEffect, useRef, useState } from 'react'
import { ImageFramer } from '../shared/ImageFramer'
import {
  photoFromFile,
  photoSrc,
  releasePhoto,
  type DraftPhoto,
} from '../../lib/aboutPage'
import { ACCEPTED_IMAGE_TYPES, downscaleImage } from '../../lib/media/downscaleImage'
import { frameStyle } from '../../lib/media/imageFraming'

/**
 * The photo under one timeline line in the about editor.
 *
 * Nothing here talks to the server. A chosen file is shrunk, held as an object URL and sent with
 * the rest of the page on SAVE, so CANCEL really does leave the page as it was. For the same
 * reason REMOVE asks nothing: the stored file is only deleted once a save takes the photo off the
 * timeline, and CANCEL puts it back.
 *
 * The picker is a real button that clicks a hidden input, so it takes focus and reads as a button.
 * Choosing a file opens the framer straight away, because the timeline's frame is 16:10 and almost
 * no photo is. Whether the framer is open belongs to the editor, which refuses to SAVE while one
 * is: `ImageFramer` only hands its framing over on DONE.
 *
 * Every press here unmounts the button pressed, so focus is put somewhere on purpose afterwards
 * rather than left to fall to the page.
 */
export function TimelinePhotoField({
  photo,
  line,
  disabled,
  framing,
  onFraming,
  onChange,
}: {
  photo: DraftPhoto | null
  /** 1-based, for the controls' names. */
  line: number
  disabled: boolean
  framing: boolean
  onFraming: (open: boolean) => void
  onChange: (photo: DraftPhoto | null) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const frameButton = useRef<HTMLButtonElement>(null)
  const framer = useRef<HTMLDivElement>(null)
  const [preparing, setPreparing] = useState(false)

  /** Where focus goes after the next render, once the element it names exists. */
  const focusNext = useRef<'add' | 'frame' | 'framer' | null>(null)
  useEffect(() => {
    const next = focusNext.current
    if (next === null) return
    focusNext.current = null

    if (next === 'add') addButton.current?.focus()
    if (next === 'frame') frameButton.current?.focus()
    // The framer's drag area, which also takes the arrow keys.
    if (next === 'framer') framer.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus()
  })

  const choose = (chosen: File) => {
    setPreparing(true)
    void downscaleImage(chosen).then(({ file }) => {
      releasePhoto(photo)
      // A replacement keeps the caption somebody wrote; the framing starts over,
      // since it was for the old picture's shape.
      onChange({ ...photoFromFile(file), caption: photo?.caption ?? '' })
      onFraming(true)
      focusNext.current = 'framer'
      setPreparing(false)
    })
  }

  const closeFramer = () => {
    onFraming(false)
    focusNext.current = 'frame'
  }

  return (
    <div className="mt-2">
      <input
        ref={input}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        hidden
        onChange={(event) => {
          const chosen = event.target.files?.[0]
          // Cleared first, so choosing the same file again still fires.
          event.target.value = ''
          if (chosen) choose(chosen)
        }}
      />

      {photo === null ? (
        <button
          ref={addButton}
          type="button"
          disabled={disabled || preparing}
          aria-label={`Add a photo to line ${line}`}
          onClick={() => input.current?.click()}
          className={`${quiet} text-faint enabled:hover:text-primary`}
        >
          {preparing ? 'PREPARING…' : '+ ADD A PHOTO'}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {/* Framed, so the row shows what the page will show. The wrapper
              clips the zoom. */}
          <div className="bg-hatch h-14 w-20 shrink-0 overflow-hidden">
            <img
              src={photoSrc(photo)}
              alt=""
              decoding="async"
              style={frameStyle(photo.framing)}
              className="h-full w-full"
            />
          </div>

          <input
            type="text"
            value={photo.caption}
            maxLength={160}
            placeholder="Caption (optional)"
            aria-label={`Caption for the photo on line ${line}`}
            disabled={disabled}
            onChange={(event) => {
              onChange({ ...photo, caption: event.target.value })
            }}
            className="input border-rule bg-base-100 h-9 min-h-0 min-w-0 flex-1 basis-40 text-[13px]"
          />

          <span className="flex shrink-0 items-center">
            <button
              ref={frameButton}
              type="button"
              aria-expanded={framing}
              aria-label={`Frame the photo on line ${line}`}
              disabled={disabled}
              onClick={() => {
                if (framing) {
                  closeFramer()
                } else {
                  onFraming(true)
                }
              }}
              className={`${quiet} ${
                framing ? 'text-primary' : 'text-faint enabled:hover:text-primary'
              }`}
            >
              FRAME
            </button>
            <button
              type="button"
              aria-label={`Replace the photo on line ${line}`}
              disabled={disabled || preparing}
              onClick={() => input.current?.click()}
              className={`${quiet} text-faint enabled:hover:text-primary`}
            >
              {preparing ? 'PREPARING…' : 'REPLACE'}
            </button>
            <button
              type="button"
              aria-label={`Remove the photo from line ${line}`}
              disabled={disabled}
              onClick={() => {
                releasePhoto(photo)
                if (framing) onFraming(false)
                onChange(null)
                focusNext.current = 'add'
              }}
              className={`${quiet} text-faint enabled:hover:text-error`}
            >
              REMOVE
            </button>
          </span>
        </div>
      )}

      {photo !== null && framing && (
        <div ref={framer}>
          <ImageFramer
            url={photo.kind === 'file' ? photo.previewUrl : photo.url}
            initial={photo.framing}
            busy={disabled}
            onCancel={closeFramer}
            onSave={(next) => {
              onChange({ ...photo, framing: next })
              closeFramer()
            }}
          />
        </div>
      )}
    </div>
  )
}

/** Small mono controls, 44px tall on a phone. Colour is set per button. */
const quiet =
  'focus-visible:outline-primary focus-visible:outline-2 focus-visible:outline-offset-2 flex min-h-11 cursor-pointer items-center px-2 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:cursor-default disabled:opacity-50 wide:min-h-8'
