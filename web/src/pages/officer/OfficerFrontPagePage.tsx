import { useEffect, useId, useRef, useState } from 'react'
import { useOutletContext } from 'react-router'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { DuesLocked } from '../../components/dashboard/DuesLocked'
import { OfficerOnly } from '../../components/dashboard/OfficerOnly'
import { isOfficer } from '../../lib/auth/session'
import { HeroSlideshow } from '../../components/home/HeroSlideshow'
// Across folders rather than copied a fourth time. It has outgrown
// `components/projects/` and belongs in `shared/`; moving it is its own change.
import { Status } from '../../components/shared/Status'
import { useSectionStatus } from '../../lib/useSectionStatus'
import { ConfirmDialog } from '../../components/shared/ConfirmDialog'
import { ImageFramer } from '../../components/shared/ImageFramer'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  fieldClass,
  labelClass,
} from '../../components/shared/formChrome'
import { ApiError, deleteJson, getJson, patchJson, postForm, postJson } from '../../lib/api/api'
import type { ApiHeroSlide } from '../../lib/api/api'
import { explainApiError } from '../../lib/api/apiErrors'
import { ACCEPTED_IMAGE_TYPES, downscaleImage } from '../../lib/media/downscaleImage'
import { duesLocked } from '../../lib/dues/dues'
import { MAX_HERO_SLIDES } from '../../lib/heroSlides'
import { frameStyle, safeFraming, type Framing } from '../../lib/media/imageFraming'
import { moveItem } from '../../lib/projects/projectGallery'
import { imageSrc, isStoredUpload } from '../../lib/media/storedFiles'

/**
 * `/dashboard/officer/front-page` — the photographs beside the landing page's
 * headline.
 *
 * **The right half of the hero used to be a commit.** It was two rings and a
 * wireframe trace of the club mark, drawn from an asset in the bundle, and the
 * answer to "can we put the rover on the front page" was a pull request. This is
 * that answer becoming yes: officers add, reorder, caption, frame and remove the
 * photographs, and the site shows them in this order.
 *
 * **Removing every photograph is a supported thing to do**, and the page says so
 * — the artwork comes back rather than the hero developing a hole. That matters
 * because it is the difference between an officer deleting a bad picture and an
 * officer not daring to.
 *
 * The editor is deliberately *not* the project gallery's, though it is plainly
 * the same shape. That one lives inside a larger form, is gated per project, and
 * carries its section's own save semantics; folding the two together means one
 * component that has to know which of two feature's rules it is under. When a
 * third slideshow appears, extract then — with two, the duplication is the
 * cheaper of the two mistakes.
 */
export function OfficerFrontPagePage() {
  const { user, membership } = useOutletContext<DashboardContext>()

  // Dues before role, the order every other desk uses: a lapsed officer is
  // still an officer, and the sentence they need is about a payment.
  if (duesLocked(membership, user.role)) {
    return <DuesLocked eyebrow="/ MANAGE · FRONT PAGE" />
  }

  if (!isOfficer(user.role)) {
    return <OfficerOnly eyebrow="/ MANAGE · FRONT PAGE" why="What the club leads with is board business." />
  }

  return <Editor />
}

const button =
  'btn btn-outline h-auto min-h-0 border-base-content/28 px-4 py-2 text-[11px] font-semibold tracking-[0.08em] text-base-content hover:border-base-content hover:bg-base-content/6 hover:text-base-content disabled:opacity-40'

const panelLabel =
  'text-faint font-mono text-[10px] font-medium tracking-[0.16em]'

function Editor() {
  const id = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const { message, busy, setMessage, run } = useSectionStatus()

  const [slides, setSlides] = useState<ApiHeroSlide[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [note, setNote] = useState('')
  const [url, setUrl] = useState('')
  const [doomed, setDoomed] = useState<ApiHeroSlide | null>(null)
  /** Which photograph's framing panel is open, if any. One at a time. */
  const [framing, setFraming] = useState<string | null>(null)

  /**
   * Read from the public endpoint rather than a second officer-only one — there
   * is one list and it is not a secret — but read **fresh**. That route is
   * `s-maxage=300` for everybody, so without `no-store` an officer who adds a
   * photograph and reloads this page can be handed the answer from before they
   * did, which looks exactly like a save that failed. The same trap
   * `projects.md` records for the project editor.
   */
  useEffect(() => {
    const controller = new AbortController()

    getJson<ApiHeroSlide[]>('/hero-slides', controller.signal, true)
      .then(setSlides)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        console.error(error)
        setLoadError(
          error instanceof ApiError && error.status === 0
            ? "We couldn't reach the server."
            : "We couldn't load the photos.",
        )
      })

    return () => {
      controller.abort()
    }
  }, [])

  const held = slides ?? []
  const full = held.length >= MAX_HERO_SLIDES

  /**
   * The reorder is debounced, and it is the one debounce here that earns itself:
   * the route takes the *whole* order, so it is idempotent and a lost
   * intermediate press costs nothing, while five arrow presses in a row would
   * otherwise be five writes.
   */
  const pending = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (pending.current !== null) window.clearTimeout(pending.current)
    },
    [],
  )

  const reorder = (next: ApiHeroSlide[]) => {
    setSlides(next)
    setMessage('')

    if (pending.current !== null) window.clearTimeout(pending.current)
    pending.current = window.setTimeout(() => {
      pending.current = null
      patchJson<ApiHeroSlide[]>('/officer/hero-slides/order', {
        ids: next.map((slide) => slide.id),
      })
        .then(setSlides)
        .catch((error: unknown) => {
          setMessage(explainApiError(error))
        })
    }, 600)
  }

  const addByUrl = () =>
    run(async () => {
      const added = await postJson<ApiHeroSlide>('/officer/hero-slides', {
        url: url.trim(),
      })
      setSlides([...held, added])
      setUrl('')
      setNote('')
      // Straight into framing: the moment a picture lands is the moment its
      // framing is worth looking at, and the hero's frame is wider than almost
      // any photograph that arrives.
      setFraming(added.id)
    })

  /**
   * Choosing a file *is* the upload — there is no second button to press. A
   * picker already ends in a deliberate act ("Open"), and a confirm step after
   * it asks the same question twice.
   */
  const uploadChosen = (chosen: File) =>
    run(async () => {
      const { file, downscaled } = await downscaleImage(chosen)

      const body = new FormData()
      body.append('file', file)

      const added = await postForm<ApiHeroSlide>(
        '/officer/hero-slides/upload',
        body,
      )

      setSlides([...held, added])
      setNote(
        downscaled
          ? `Added — resized from ${sizeOf(chosen.size)} to ${sizeOf(file.size)} on the way.`
          : 'Added.',
      )
      setFraming(added.id)
    })

  const remove = (slide: ApiHeroSlide) =>
    run(async () => {
      await deleteJson(`/officer/hero-slides/${slide.id}`)
      setSlides(held.filter((row) => row.id !== slide.id))
      setDoomed(null)
      setNote('')
    })

  const setCaption = (slide: ApiHeroSlide, caption: string) => {
    setSlides(
      held.map((row) =>
        row.id === slide.id ? { ...row, caption: caption || null } : row,
      ),
    )
  }

  const saveCaption = (slide: ApiHeroSlide) =>
    run(async () => {
      await patchJson(`/officer/hero-slides/${slide.id}`, {
        caption: slide.caption?.trim() || null,
      })
    })

  /**
   * Written once, on DONE. Panning is continuous, so saving as it moved would be
   * a request per frame of a drag — and the route sends only the three framing
   * fields, so a caption typed but not yet blurred is not overwritten by the
   * picture being moved.
   */
  const saveFraming = (slide: ApiHeroSlide, next: Framing) =>
    run(async () => {
      const saved = await patchJson<ApiHeroSlide>(
        `/officer/hero-slides/${slide.id}`,
        next,
      )
      setSlides(held.map((row) => (row.id === slide.id ? saved : row)))
      setFraming(null)
      setNote('')
    })

  return (
    <>
      <FormEyebrow>/ MANAGE · FRONT PAGE</FormEyebrow>
      <FormHeading>The photos beside the headline.</FormHeading>

      <div className="grid-fluid mb-6 grid items-start gap-6 [--col-min:24rem]">
        <section>
          <p className={`${panelLabel} mb-4`}>/ PHOTOS</p>

          {slides === null ? (
            <p
              aria-busy={loadError === ''}
              className="border-rule bg-base-200 text-faint border p-5 text-[13px]"
            >
              {loadError === '' ? 'Loading…' : loadError}
            </p>
          ) : held.length === 0 ? (
            /* The empty well is drawn here and not on the front page, which is
               the difference between the two: this is the thing somebody is
               about to put a picture into, and out there it is a hero that has
               its artwork back. */
            <p className="bg-hatch border-rule text-faint flex aspect-[16/10] w-full items-center justify-center border font-mono text-[11px] font-medium tracking-[0.14em]">
              [ NO PHOTOS YET ]
            </p>
          ) : (
            <ul className="space-y-2">
              {held.map((slide, index) => (
                <li key={slide.id} className="border-rule bg-base-200 border p-2">
                  <div className="flex flex-wrap items-center gap-3">
                    {/* Framed, so the row shows what the front page will show
                        rather than the raw file — otherwise an officer frames a
                        picture and the list they are working from disagrees with
                        them. */}
                    <img
                      src={imageSrc(slide.url)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      style={frameStyle(slide)}
                      className="bg-hatch h-14 w-20 shrink-0"
                    />

                    <input
                      type="text"
                      value={slide.caption ?? ''}
                      maxLength={160}
                      placeholder="Caption (optional)"
                      aria-label={`Caption for photo ${index + 1}`}
                      disabled={busy}
                      onChange={(event) => {
                        setCaption(slide, event.target.value)
                      }}
                      onBlur={() => void saveCaption(slide)}
                      className="input border-rule bg-base-100 h-9 min-h-0 min-w-0 flex-1 text-[13px]"
                    />

                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Frame photo ${index + 1}`}
                        aria-expanded={framing === slide.id}
                        disabled={busy}
                        onClick={() => {
                          setFraming(framing === slide.id ? null : slide.id)
                        }}
                        className={`cursor-pointer px-2 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50 ${
                          framing === slide.id
                            ? 'text-primary'
                            : 'text-faint hover:text-primary'
                        }`}
                      >
                        FRAME
                      </button>
                      <MoveButton
                        label={`Move photo ${index + 1} earlier`}
                        glyph="‹"
                        disabled={index === 0 || busy}
                        onClick={() => {
                          reorder(moveItem(held, index, index - 1))
                        }}
                      />
                      <MoveButton
                        label={`Move photo ${index + 1} later`}
                        glyph="›"
                        disabled={index === held.length - 1 || busy}
                        onClick={() => {
                          reorder(moveItem(held, index, index + 1))
                        }}
                      />
                      <button
                        type="button"
                        aria-label={`Remove photo ${index + 1}`}
                        disabled={busy}
                        onClick={() => {
                          // Only an upload needs the ceremony — a linked picture
                          // can be pasted back in, the bytes cannot.
                          if (isStoredUpload(slide.url)) {
                            setDoomed(slide)
                          } else {
                            void remove(slide)
                          }
                        }}
                        className="text-faint hover:text-error flex size-11 cursor-pointer items-center justify-center text-sm transition-colors duration-200 disabled:opacity-50 wide:size-8"
                      >
                        ✕
                      </button>
                    </span>
                  </div>

                  {framing === slide.id && (
                    <ImageFramer
                      url={slide.url}
                      initial={safeFraming(slide)}
                      busy={busy}
                      onCancel={() => {
                        setFraming(null)
                      }}
                      onSave={(next) => void saveFraming(slide, next)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 grid gap-4">
            <div>
              <label className={labelClass} htmlFor={`${id}-file`}>
                ADD FROM YOUR COMPUTER
              </label>
              <input
                id={`${id}-file`}
                ref={fileInput}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES}
                disabled={busy || full || slides === null}
                onChange={(event) => {
                  const chosen = event.target.files?.[0]
                  // Cleared straight away, and before the upload rather than
                  // after, so choosing the *same* file again still fires a
                  // change event — an input whose value has not moved does not
                  // emit one, which is how a retry after a failure silently does
                  // nothing.
                  event.target.value = ''
                  if (chosen) void uploadChosen(chosen)
                }}
                className="file-input border-rule bg-base-200 w-full text-sm"
              />
              <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
                {busy
                  ? 'Adding…'
                  : 'Choosing a photo adds it and opens the framing tool. Large pictures are shrunk in the browser first, so the front page stays quick to load.'}
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
                disabled={busy || full || slides === null}
                onChange={(event) => {
                  setUrl(event.target.value)
                }}
                className={fieldClass}
              />
              <button
                type="button"
                onClick={() => void addByUrl()}
                disabled={busy || full || slides === null || url.trim() === ''}
                className={`${button} mt-2`}
              >
                ADD
              </button>
              <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
                Removing it here never deletes anything at the other end.
              </p>
            </div>
          </div>

          <p className="text-faint mt-3 font-mono text-[10px] font-medium tracking-[0.14em]">
            {held.length} / {MAX_HERO_SLIDES} PHOTOS
            {full && ' — REMOVE ONE TO ADD ANOTHER'}
          </p>

          <Status message={message} />
          {message === '' && note !== '' && <Status message={note} tone="ok" />}
        </section>

        <section>
          <p className={`${panelLabel} mb-4`}>/ PREVIEW</p>

          {held.length > 0 ? (
            /* The real component, not a picture of it. Anything hand-drawn here
               would be a second thing to keep in step with the front page, and
               the first time it drifted this desk would be lying about what
               visitors see. It rotates here exactly as it does out there —
               pausing under the pointer, which is where an officer's is. */
            <HeroSlideshow slides={held} />
          ) : (
            <FormPanel>
              <p className="text-dim text-sm leading-[1.7] text-pretty">
                With no photos here, the front page shows the rings and the
                wireframe mark it has always had. That is a fine thing to leave
                it as — nothing breaks, and there is no gap where a picture
                should be.
              </p>
            </FormPanel>
          )}

          <div className="mt-6">
            <FormPanel>
              <p className="mb-1.5 text-sm font-semibold">
                These sit next to the headline on the front page.
              </p>
              <p className="text-dim text-sm leading-[1.7] text-pretty">
                The first one is what most people see, because the slideshow
                starts there and stops the moment anybody touches it. Captions
                are optional, and they are also what a screen reader says about a
                photo — worth writing for the ones that show something specific.
              </p>
            </FormPanel>
          </div>
        </section>
      </div>

      {doomed && (
        <ConfirmDialog
          title="Delete this photo?"
          confirmLabel="DELETE IT"
          busy={busy}
          onConfirm={() => void remove(doomed)}
          onDismiss={() => {
            setDoomed(null)
          }}
        >
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            It was uploaded to the site, so removing it here deletes the file.
            There is no undo, and a link cannot bring it back.
          </p>
        </ConfirmDialog>
      )}
    </>
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

/** Whole KB and MB, because the difference this reports is measured in them. */
const sizeOf = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`
