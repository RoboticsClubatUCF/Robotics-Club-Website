import { useEffect, useId, useRef, useState } from 'react'
import {
  deleteJson,
  patchJson,
  postForm,
  type ApiAccount,
  type ApiAccountUser,
} from '../../lib/api/api'
import { explainApiError } from '../../lib/api/apiErrors'
import { ACCEPTED_IMAGE_TYPES, downscaleImage } from '../../lib/media/downscaleImage'
import {
  DEFAULT_FRAMING,
  isDefaultFraming,
  type Framing,
} from '../../lib/media/imageFraming'
import { useSession } from '../../lib/auth/session'
import { Avatar } from '../shared/Avatar'
import { ImageFramer } from '../shared/ImageFramer'
import { labelClass } from '../shared/formChrome'
import {
  PanelStatus,
  ProfilePanel,
  noteClass,
  panelQuietClass,
  type PanelMessage,
} from './profileChrome'

/**
 * The profile photo, framed before it is sent.
 *
 * **This deliberately does not follow the project editor's "choosing the file
 * *is* the upload" rule, and the difference is what makes it the right call
 * here.** A gallery upload appends a picture to a list, so a mis-picked file
 * costs one press to remove. An avatar *replaces* — the old photo's bytes are
 * deleted the moment the new one lands — so an accidental pick is destructive
 * before anybody has looked at it.
 *
 * So this is `DraftGallery`'s flow instead, which is the same shape for the
 * same reason: the file is held in the browser as an object URL, framed against
 * the square it will actually appear in, and only sent when somebody says so.
 * The framing travels **with** the picture in the multipart body rather than as
 * a second request, so a photo cannot arrive correctly and then be left cropped
 * by a follow-up that failed on its own.
 *
 * An existing photo can be re-framed without sending anything, which is the
 * other half of framing being metadata rather than a crop baked into the bytes.
 */
export function ProfilePhotoPanel({
  account,
  onSaved,
}: {
  account: ApiAccount
  onSaved: (account: Partial<ApiAccount>) => void
}) {
  const { adopt } = useSession()
  const id = useId()
  const input = useRef<HTMLInputElement>(null)

  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<PanelMessage>(null)
  /** A file chosen and not yet sent: the object URL is what the framer shows. */
  const [chosen, setChosen] = useState<{ file: File; previewUrl: string } | null>(
    null,
  )
  /** Whether the framer is open on the photo already stored. */
  const [adjusting, setAdjusting] = useState(false)

  const stored: Framing = {
    focalX: account.photoFocalX,
    focalY: account.photoFocalY,
    zoom: account.photoZoom,
  }

  /**
   * Hand the browser back the memory behind a preview.
   *
   * An object URL pins the whole file until it is revoked, so half a dozen
   * photos tried and abandoned would otherwise sit in memory for the life of
   * the tab. Read through a ref so the cleanup does not re-run — and revoke the
   * preview still on screen — every time anything else on the panel changes.
   */
  const held = useRef(chosen)
  held.current = chosen

  useEffect(
    () => () => {
      if (held.current) URL.revokeObjectURL(held.current.previewUrl)
    },
    [],
  )

  const discard = () => {
    if (chosen) URL.revokeObjectURL(chosen.previewUrl)
    setChosen(null)
  }

  const settle = ({ user }: ApiAccountUser, text: string) => {
    // The nav and the rail draw this. Adopting is what makes them agree with
    // the panel without a reload.
    adopt(user)
    onSaved({
      photoUrl: user.photoUrl,
      photoFocalX: user.photoFocalX,
      photoFocalY: user.photoFocalY,
      photoZoom: user.photoZoom,
    })
    setMessage({ tone: 'ok', text })
  }

  const failed = (error: unknown) => {
    console.error(error)
    setMessage({ tone: 'error', text: explainApiError(error) })
  }

  /**
   * Shrink the moment a file is picked rather than at upload time.
   *
   * It is the same work either way, and doing it here means the picture being
   * framed is the picture that will be sent — a photo too large to send is
   * found out about while there is still a form to fix it in, and the framer is
   * never showing a source the upload will not match.
   */
  const choose = async (picked: File) => {
    setBusy(true)
    setMessage(null)

    try {
      const { file } = await downscaleImage(picked)
      discard()
      setChosen({ file, previewUrl: URL.createObjectURL(file) })
      setAdjusting(false)
    } catch (error) {
      failed(error)
    } finally {
      setBusy(false)
      // Or choosing the same file again fires no change event at all and the
      // panel looks frozen.
      if (input.current) input.current.value = ''
    }
  }

  /** The confirming press: the picture and its framing, in one request. */
  const upload = (framing: Framing) => {
    if (!chosen) return

    setBusy(true)
    setMessage(null)

    const body = new FormData()
    body.append('file', chosen.file)

    if (!isDefaultFraming(framing)) {
      // Multipart carries no types; the route reads these back out of strings
      // and ignores anything it cannot parse. Left off entirely when nobody
      // moved anything, so the row takes the column defaults.
      body.append('focalX', String(framing.focalX))
      body.append('focalY', String(framing.focalY))
      body.append('zoom', String(framing.zoom))
    }

    postForm<ApiAccountUser>('/account/photo', body)
      .then((answer) => {
        discard()
        settle(answer, 'Saved.')
      })
      .catch(failed)
      .finally(() => {
        setBusy(false)
      })
  }

  /** Re-framing what is already stored — no bytes go anywhere. */
  const reframe = (framing: Framing) => {
    setBusy(true)
    setMessage(null)

    patchJson<ApiAccountUser>('/account/photo', framing)
      .then((answer) => {
        setAdjusting(false)
        settle(answer, 'Framing saved.')
      })
      .catch(failed)
      .finally(() => {
        setBusy(false)
      })
  }

  const remove = () => {
    setBusy(true)
    setMessage(null)

    deleteJson<ApiAccountUser>('/account/photo')
      .then((answer) => {
        setAdjusting(false)
        settle(answer, 'Photo removed.')
      })
      .catch(failed)
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <ProfilePanel label="PHOTO">
      <div className="flex flex-wrap items-center gap-5">
        <Avatar
          fullName={account.fullName}
          photoUrl={account.photoUrl}
          framing={stored}
          tone="outline"
          className="size-20 text-xl"
        />

        <div className="min-w-0 flex-1">
          {/* The picker is the control, so the label is what says so and the
              input itself is hidden — a bare file input cannot be styled and
              prints a filename nobody asked for. */}
          <label htmlFor={`${id}-photo`} className={labelClass}>
            {account.photoUrl ? 'REPLACE IT' : 'ADD A PHOTO'}
          </label>

          <div className="flex flex-wrap items-center gap-2.5">
            <label
              htmlFor={`${id}-photo`}
              aria-disabled={busy}
              className={`${panelQuietClass} ${busy ? 'pointer-events-none opacity-50' : ''}`}
            >
              {busy && !chosen ? 'WORKING…' : 'CHOOSE A FILE'}
            </label>
            <input
              ref={input}
              id={`${id}-photo`}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES}
              disabled={busy}
              onChange={(event) => {
                const picked = event.target.files?.[0]
                if (picked) void choose(picked)
              }}
              className="sr-only"
            />

            {/* Only for a photo that is already stored. There is no separate
                adjust step for one being chosen — the framer is already open on
                it, and a second way in would be a button that does nothing. */}
            {account.photoUrl && !chosen && (
              <button
                type="button"
                disabled={busy}
                aria-expanded={adjusting}
                onClick={() => {
                  setAdjusting(!adjusting)
                }}
                className={panelQuietClass}
              >
                {adjusting ? 'CLOSE' : 'ADJUST THE CROP'}
              </button>
            )}

            {account.photoUrl && !chosen && (
              <button
                type="button"
                disabled={busy}
                onClick={remove}
                className={panelQuietClass}
              >
                REMOVE
              </button>
            )}
          </div>

          <p className={`${noteClass} mt-2`}>
            PNG, JPEG, GIF or WebP.
          </p>
        </div>
      </div>

      {/* Choosing a file opens the framer on it, and nothing has been sent yet
          — the note under the buttons says so, because a picture on screen
          looks saved. */}
      {chosen && (
        <div className="mt-4">
          <p className={`${noteClass} mb-2`}>
            Drag to choose what shows. Nothing is uploaded until you press{' '}
            <span className="text-base-content">USE THIS PHOTO</span>.
          </p>
          <ImageFramer
            url={chosen.previewUrl}
            initial={DEFAULT_FRAMING}
            frame="square"
            busy={busy}
            confirmLabel="USE THIS PHOTO"
            onSave={upload}
            onCancel={discard}
          />
        </div>
      )}

      {adjusting && account.photoUrl && !chosen && (
        <div className="mt-4">
          <ImageFramer
            url={account.photoUrl}
            initial={stored}
            frame="square"
            busy={busy}
            onSave={reframe}
            onCancel={() => {
              setAdjusting(false)
            }}
          />
        </div>
      )}

      <PanelStatus message={message} />
    </ProfilePanel>
  )
}
