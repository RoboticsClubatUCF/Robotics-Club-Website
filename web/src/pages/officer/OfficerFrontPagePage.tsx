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
import {
  ApiError,
  deleteJson,
  getJson,
  patchJson,
  postForm,
  postJson,
  putJson,
} from '../../lib/api/api'
import type {
  ApiFaq,
  ApiFrontPage,
  ApiHeroSlide,
  ApiPartnerProgram,
} from '../../lib/api/api'
import { explainApiError } from '../../lib/api/apiErrors'
import { ACCEPTED_IMAGE_TYPES, downscaleImage } from '../../lib/media/downscaleImage'
import { duesLocked } from '../../lib/dues/dues'
import { MAX_HERO_SLIDES } from '../../lib/heroSlides'
import { MAX_FAQS, MAX_FAQ_STEPS, MAX_PARTNERS } from '../../lib/frontPage'
import { linesFromText, linesToText } from '../../lib/textLines'
import { frameStyle, safeFraming, type Framing } from '../../lib/media/imageFraming'
import { moveItem } from '../../lib/projects/projectGallery'
import { imageSrc, isStoredUpload } from '../../lib/media/storedFiles'

/**
 * `/dashboard/officer/front-page` — the landing page, as far as it is content.
 *
 * **Four sections, and they are the four things on that page nobody outside a
 * pull request could change.** The photographs beside the headline came first;
 * the headline itself, the FAQ and the partner programs followed it out of
 * `web/src/content/home.ts` for exactly the same reason. Two of the club's eight
 * questions name a price and one names a person, and the partner cards were
 * placeholder blurbs waiting on words from somebody who does not write code.
 *
 * They sit on one screen because they are one page. An officer here is working
 * top to bottom through what a first-time visitor sees, not through four tables
 * — the same call `OfficerSponsorsPage` makes about the three behind
 * `/sponsors`.
 *
 * **The photographs and the words are two reads and two routers**, which is the
 * one seam a reader will notice: `GET /api/hero-slides` and
 * `POST /api/officer/hero-slides` on one side, `GET /api/front-page` and
 * `/api/officer/front-page` on the other. Bytes with a frame around them and
 * sentences are different enough that folding them together would put the image
 * framer in the same file as the FAQ.
 *
 * **The words save differently in the two places they are edited, and the
 * difference is deliberate.** The headline is a form with a SAVE — it is two
 * boxes that read as one sentence, so a field that wrote itself on the way past
 * would put half a rewrite on the front page. The lists below blur-save per
 * field, the way the sponsor desk does, because a question and its answer are
 * independent facts and eight SAVE buttons is eight things to forget to press.
 *
 * What follows is the photographs.
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

  return <Desk />
}

/**
 * The whole screen: the eyebrow and heading, then the photographs, then the
 * words. Two components rather than one because they read from two routes and
 * neither should wait on the other — a slow answer for the FAQ must not hold up
 * an officer rearranging photographs.
 */
function Desk() {
  return (
    <>
      <FormEyebrow>/ MANAGE · FRONT PAGE</FormEyebrow>
      <FormHeading>What the front page shows, and what it says.</FormHeading>

      <Photos />
      <Words />
    </>
  )
}

const button =
  'btn btn-outline h-auto min-h-0 border-base-content/28 px-4 py-2 text-[11px] font-semibold tracking-[0.08em] text-base-content hover:border-base-content hover:bg-base-content/6 hover:text-base-content disabled:opacity-40'

const panelLabel =
  'text-faint font-mono text-[10px] font-medium tracking-[0.16em]'

function Photos() {
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

/**
 * The half of this desk that is words rather than pictures.
 *
 * One read for all three sections, because the route is one read: the headline,
 * the FAQ and the partner programs are one page's copy, and three fetches would
 * be three loading states for a screen that means nothing with any of them
 * missing. The same call the sponsor desk makes.
 *
 * Read from the **public** endpoint rather than an officer-only twin — there is
 * one landing page and it is not a secret — but read `fresh`. That route is
 * `s-maxage=300` for everybody, so without it an officer who rewrites the
 * headline and reloads can be handed the answer from before they did, which
 * looks exactly like a save that failed.
 */
function Words() {
  const [page, setPage] = useState<ApiFrontPage | null>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    getJson<ApiFrontPage>('/front-page', controller.signal, true)
      .then(setPage)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        console.error(error)
        setLoadError(
          error instanceof ApiError && error.status === 0
            ? "We couldn't reach the server."
            : "We couldn't load what the page says.",
        )
      })

    return () => {
      controller.abort()
    }
  }, [])

  if (page === null) {
    return (
      <p
        aria-busy={loadError === ''}
        className="border-rule bg-base-200 text-faint mt-6 border p-5 text-[13px]"
      >
        {loadError === '' ? 'Loading…' : loadError}
      </p>
    )
  }

  return (
    <>
      <Copy
        page={page}
        onSaved={(saved) => {
          setPage({ ...page, ...saved })
        }}
      />
      <Questions
        faqs={page.faqs}
        onChange={(faqs) => {
          setPage({ ...page, faqs })
        }}
      />
      <Partners
        partners={page.partners}
        onChange={(partners) => {
          setPage({ ...page, partners })
        }}
      />
    </>
  )
}

/** What `PUT /copy` takes, which is all of it or none of it. */
type FrontPageCopy = Pick<
  ApiFrontPage,
  'headline' | 'headlineAccent' | 'lede' | 'partnersIntro'
>

/**
 * The headline, the paragraph under it, and the line above the partner cards.
 *
 * A form with a SAVE rather than the blur-saves the lists below use, and the
 * reason is the headline: it is two boxes that read as one sentence, so a field
 * that wrote itself on the way past would put half a rewrite on the front page
 * for as long as it took to reach the second box. `PUT` takes the four together
 * for the same reason.
 */
function Copy({
  page,
  onSaved,
}: {
  page: FrontPageCopy
  onSaved: (saved: FrontPageCopy) => void
}) {
  const id = useId()
  const { message, busy, run } = useSectionStatus()

  const [headline, setHeadline] = useState(page.headline)
  const [headlineAccent, setHeadlineAccent] = useState(page.headlineAccent)
  const [lede, setLede] = useState(page.lede)
  const [partnersIntro, setPartnersIntro] = useState(page.partnersIntro)
  const [note, setNote] = useState('')

  const save = () =>
    run(async () => {
      const saved = await putJson<FrontPageCopy>('/officer/front-page/copy', {
        headline: headline.trim(),
        headlineAccent: headlineAccent.trim(),
        lede: lede.trim(),
        partnersIntro: partnersIntro.trim(),
      })

      onSaved(saved)
      setNote('Saved.')
    })

  const blank =
    headline.trim() === '' ||
    headlineAccent.trim() === '' ||
    lede.trim() === '' ||
    partnersIntro.trim() === ''

  return (
    <section className="border-rule mt-9 border-t pt-9">
      <p className={`${panelLabel} mb-4`}>/ THE HEADLINE</p>

      <div className="grid-fluid grid items-start gap-6 [--col-min:24rem]">
        <div className="grid gap-4">
          <div>
            <label className={labelClass} htmlFor={`${id}-headline`}>
              FIRST LINE
            </label>
            <input
              id={`${id}-headline`}
              type="text"
              value={headline}
              maxLength={80}
              disabled={busy}
              onChange={(event) => {
                setHeadline(event.target.value)
                setNote('')
              }}
              className={fieldClass}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor={`${id}-accent`}>
              SECOND LINE, IN GOLD
            </label>
            <input
              id={`${id}-accent`}
              type="text"
              value={headlineAccent}
              maxLength={80}
              disabled={busy}
              onChange={(event) => {
                setHeadlineAccent(event.target.value)
                setNote('')
              }}
              className={fieldClass}
            />
            {/* The break between the two lines is a `<br>` the type scale is
                tuned around, which is why it is two boxes rather than one with
                a newline in it — and why the preview beside them is worth its
                space. */}
            <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
              The headline breaks between these two, and the second one is set in
              the club&rsquo;s gold. Keep both short — the type is enormous on a
              wide screen, and a headline that wraps to four lines is a different
              design rather than a smaller one.
            </p>
          </div>

          <div>
            <label className={labelClass} htmlFor={`${id}-lede`}>
              THE PARAGRAPH UNDER IT
            </label>
            <textarea
              id={`${id}-lede`}
              value={lede}
              rows={5}
              maxLength={600}
              disabled={busy}
              onChange={(event) => {
                setLede(event.target.value)
                setNote('')
              }}
              className={`${fieldClass} h-auto py-2.5 leading-[1.6]`}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor={`${id}-partners-intro`}>
              THE LINE ABOVE THE PARTNER PROGRAMS
            </label>
            <textarea
              id={`${id}-partners-intro`}
              value={partnersIntro}
              rows={3}
              maxLength={300}
              disabled={busy}
              onChange={(event) => {
                setPartnersIntro(event.target.value)
                setNote('')
              }}
              className={`${fieldClass} h-auto py-2.5 leading-[1.6]`}
            />
            <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
              It says who those programs are for, which is the whole reason that
              section is on the page — club membership is UCF students only.
            </p>
          </div>

          <div>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || blank}
              className={button}
            >
              {busy ? 'SAVING…' : 'SAVE THE WORDS'}
            </button>
            <Status message={message} />
            {message === '' && note !== '' && <Status message={note} tone="ok" />}
          </div>
        </div>

        <div>
          <p className={`${panelLabel} mb-4`}>/ PREVIEW</p>
          {/* Not the real component, unlike the slideshow above — the hero is a
              two-column layout with a lab sign, a slideshow and two buttons in
              it, and dropping that into a desk column would be previewing the
              layout rather than the words. What is copied is the one thing the
              two boxes cannot show on their own: where the line breaks and
              which half is gold. */}
          <div className="border-rule bg-base-200 border p-5">
            <p className="text-[clamp(1.5rem,3vw,2.25rem)] leading-[0.94] font-bold tracking-[-0.03em] text-pretty">
              {headline}
              <br />
              <em className="text-primary not-italic">{headlineAccent}</em>
            </p>
            <p className="text-dim mt-4 text-[13px] leading-[1.6] text-pretty">
              {lede}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * The FAQ.
 *
 * Blur-saves per field, the idiom the sponsor desk and the captions above use: a
 * question and its answer are independent facts, an officer correcting a price
 * is changing one of them, and a SAVE button per row would be eight buttons for
 * a page somebody edits one line of. The trade is that there is nothing to
 * cancel — which is why the ✕ asks first.
 */
function Questions({
  faqs,
  onChange,
}: {
  faqs: ApiFaq[]
  onChange: (faqs: ApiFaq[]) => void
}) {
  const id = useId()
  const { message, busy, setMessage, run } = useSectionStatus()

  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [doomed, setDoomed] = useState<ApiFaq | null>(null)

  const full = faqs.length >= MAX_FAQS

  /** Debounced for the reason the slideshow's is: the route takes the *whole*
      order, so it is idempotent and five arrow presses are one write. */
  const pending = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (pending.current !== null) window.clearTimeout(pending.current)
    },
    [],
  )

  const reorder = (next: ApiFaq[]) => {
    onChange(next)
    setMessage('')

    if (pending.current !== null) window.clearTimeout(pending.current)
    pending.current = window.setTimeout(() => {
      pending.current = null
      patchJson<ApiFaq[]>('/officer/front-page/faqs/order', {
        ids: next.map((faq) => faq.id),
      })
        .then(onChange)
        .catch((error: unknown) => {
          setMessage(explainApiError(error))
        })
    }, 600)
  }

  const add = () =>
    run(async () => {
      const added = await postJson<ApiFaq>('/officer/front-page/faqs', {
        question: question.trim(),
        answer: answer.trim(),
      })
      onChange([...faqs, added])
      setQuestion('')
      setAnswer('')
    })

  const patch = (faq: ApiFaq, body: Partial<ApiFaq>) =>
    run(async () => {
      const saved = await patchJson<ApiFaq>(
        `/officer/front-page/faqs/${faq.id}`,
        body,
      )
      onChange(faqs.map((row) => (row.id === faq.id ? saved : row)))
    })

  const remove = (faq: ApiFaq) =>
    run(async () => {
      await deleteJson(`/officer/front-page/faqs/${faq.id}`)
      onChange(faqs.filter((row) => row.id !== faq.id))
      setDoomed(null)
    })

  return (
    <section className="border-rule mt-9 border-t pt-9">
      <p className={`${panelLabel} mb-4`}>/ QUESTIONS</p>

      <div className="border-rule bg-base-200 mb-4 border p-4">
        <p className="text-dim text-[13px] leading-[1.6] text-pretty">
          Every box here saves when you click out of it. The order is the order
          they are read in on the page — the arrows move a question, and the
          first two or three are the ones most people get to.
        </p>
      </div>

      {faqs.length === 0 ? (
        <p className="bg-hatch border-rule text-faint flex h-28 w-full items-center justify-center border font-mono text-[11px] font-medium tracking-[0.14em]">
          [ NO QUESTIONS YET ]
        </p>
      ) : (
        <ul className="space-y-2">
          {faqs.map((faq, index) => (
            <li key={faq.id} className="border-rule bg-base-200 border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  defaultValue={faq.question}
                  maxLength={200}
                  aria-label={`Question ${String(index + 1)}`}
                  disabled={busy}
                  onBlur={(event) => {
                    const next = event.target.value.trim()
                    if (next !== '' && next !== faq.question) {
                      void patch(faq, { question: next })
                    } else {
                      // Put the box back rather than leaving a blank one
                      // sitting there looking saved.
                      event.target.value = faq.question
                    }
                  }}
                  className="input border-rule bg-base-100 h-9 min-h-0 min-w-0 flex-1 basis-60 text-[13px]"
                />

                <span className="flex shrink-0 items-center gap-1">
                  <MoveButton
                    label={`Move question ${String(index + 1)} earlier`}
                    glyph="‹"
                    disabled={index === 0 || busy}
                    onClick={() => {
                      reorder(moveItem(faqs, index, index - 1))
                    }}
                  />
                  <MoveButton
                    label={`Move question ${String(index + 1)} later`}
                    glyph="›"
                    disabled={index === faqs.length - 1 || busy}
                    onClick={() => {
                      reorder(moveItem(faqs, index, index + 1))
                    }}
                  />
                  <button
                    type="button"
                    aria-label={`Remove question ${String(index + 1)}`}
                    disabled={busy}
                    onClick={() => {
                      setDoomed(faq)
                    }}
                    className="text-faint hover:text-error flex size-11 cursor-pointer items-center justify-center text-sm transition-colors duration-200 disabled:opacity-50 wide:size-8"
                  >
                    ✕
                  </button>
                </span>
              </div>

              <textarea
                defaultValue={faq.answer}
                rows={3}
                maxLength={2000}
                aria-label={`Answer to question ${String(index + 1)}`}
                disabled={busy}
                onBlur={(event) => {
                  const next = event.target.value.trim()
                  if (next !== '' && next !== faq.answer) {
                    void patch(faq, { answer: next })
                  } else {
                    event.target.value = faq.answer
                  }
                }}
                className="input border-rule bg-base-100 mt-2 h-auto w-full py-2 text-[13px] leading-[1.6]"
              />

              <textarea
                defaultValue={linesToText(faq.steps)}
                rows={faq.steps.length > 0 ? faq.steps.length + 1 : 2}
                aria-label={`Numbered steps for question ${String(index + 1)}`}
                placeholder="Numbered steps, one per line — optional"
                disabled={busy}
                onBlur={(event) => {
                  const next = linesFromText(event.target.value)
                  if (linesToText(next) !== linesToText(faq.steps)) {
                    void patch(faq, { steps: next })
                  }
                }}
                className="input border-rule bg-base-100 mt-2 h-auto w-full py-2 font-mono text-[12px] leading-[1.6]"
              />
              {/* The one field on a row that needs saying: an answer with steps
                  in it is numbered on the page, and an empty box is the ordinary
                  case. */}
              <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
                Up to {MAX_FAQ_STEPS}. The page numbers them under the answer;
                leave this empty for an answer that is a paragraph.
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-4">
        <div>
          <label className={labelClass} htmlFor={`${id}-question`}>
            A NEW QUESTION
          </label>
          <input
            id={`${id}-question`}
            type="text"
            value={question}
            maxLength={200}
            disabled={busy || full}
            onChange={(event) => {
              setQuestion(event.target.value)
            }}
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor={`${id}-answer`}>
            AND ITS ANSWER
          </label>
          <textarea
            id={`${id}-answer`}
            value={answer}
            rows={3}
            maxLength={2000}
            disabled={busy || full}
            onChange={(event) => {
              setAnswer(event.target.value)
            }}
            className={`${fieldClass} h-auto py-2.5 leading-[1.6]`}
          />
          <button
            type="button"
            aria-label="Add a question"
            onClick={() => void add()}
            disabled={busy || full || question.trim() === '' || answer.trim() === ''}
            className={`${button} mt-2`}
          >
            ADD
          </button>
          <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
            It lands at the bottom of the list. Steps can go on afterwards.
          </p>
        </div>
      </div>

      <p className="text-faint mt-3 font-mono text-[10px] font-medium tracking-[0.14em]">
        {faqs.length} / {MAX_FAQS} QUESTIONS
        {full && ' — REMOVE ONE TO ADD ANOTHER'}
      </p>

      <Status message={message} />

      {doomed && (
        <ConfirmDialog
          title="Delete this question?"
          confirmLabel="DELETE IT"
          busy={busy}
          onConfirm={() => void remove(doomed)}
          onDismiss={() => {
            setDoomed(null)
          }}
        >
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            “{doomed.question}” comes off the front page, and the answer under it
            goes with it. There is no undo.
          </p>
        </ConfirmDialog>
      )}
    </section>
  )
}

/**
 * The partner programs — what somebody does when they cannot join the club.
 *
 * The same blur-saves as the questions above, plus artwork, which works the way
 * a sponsor's logo does rather than the way a hero photograph does: a program is
 * a row that has a picture, so choosing a file replaces whatever was there
 * instead of the remove-then-add the slideshow uses.
 */
function Partners({
  partners,
  onChange,
}: {
  partners: ApiPartnerProgram[]
  onChange: (partners: ApiPartnerProgram[]) => void
}) {
  const id = useId()
  const { message, busy, setMessage, run } = useSectionStatus()

  const [name, setName] = useState('')
  const [href, setHref] = useState('')
  const [doomed, setDoomed] = useState<ApiPartnerProgram | null>(null)

  const full = partners.length >= MAX_PARTNERS

  const pending = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (pending.current !== null) window.clearTimeout(pending.current)
    },
    [],
  )

  const reorder = (next: ApiPartnerProgram[]) => {
    onChange(next)
    setMessage('')

    if (pending.current !== null) window.clearTimeout(pending.current)
    pending.current = window.setTimeout(() => {
      pending.current = null
      patchJson<ApiPartnerProgram[]>('/officer/front-page/partners/order', {
        ids: next.map((program) => program.id),
      })
        .then(onChange)
        .catch((error: unknown) => {
          setMessage(explainApiError(error))
        })
    }, 600)
  }

  /**
   * A new program arrives with the two things a card cannot be drawn without —
   * a name and somewhere to send the reader. The audience line, the blurb and
   * the artwork are filled in on the row afterwards, which is what stops the add
   * form being a second copy of the whole card.
   */
  const add = () =>
    run(async () => {
      const added = await postJson<ApiPartnerProgram>(
        '/officer/front-page/partners',
        {
          name: name.trim(),
          href: href.trim(),
          audience: 'WHO IT IS FOR',
          blurb: 'What this program is, and what somebody turns up to.',
          linkLabel: `Visit ${name.trim()}`,
        },
      )
      onChange([...partners, added])
      setName('')
      setHref('')
    })

  const patch = (program: ApiPartnerProgram, body: Partial<ApiPartnerProgram>) =>
    run(async () => {
      const saved = await patchJson<ApiPartnerProgram>(
        `/officer/front-page/partners/${program.id}`,
        body,
      )
      onChange(partners.map((row) => (row.id === program.id ? saved : row)))
    })

  const upload = (program: ApiPartnerProgram, chosen: File) =>
    run(async () => {
      const { file } = await downscaleImage(chosen)

      const body = new FormData()
      body.append('file', file)

      const saved = await postForm<ApiPartnerProgram>(
        `/officer/front-page/partners/${program.id}/image`,
        body,
      )
      onChange(partners.map((row) => (row.id === program.id ? saved : row)))
    })

  const dropImage = (program: ApiPartnerProgram) =>
    run(async () => {
      const saved = await deleteJson<ApiPartnerProgram>(
        `/officer/front-page/partners/${program.id}/image`,
      )
      onChange(partners.map((row) => (row.id === program.id ? saved : row)))
    })

  const remove = (program: ApiPartnerProgram) =>
    run(async () => {
      await deleteJson(`/officer/front-page/partners/${program.id}`)
      onChange(partners.filter((row) => row.id !== program.id))
      setDoomed(null)
    })

  return (
    <section className="border-rule mt-9 border-t pt-9">
      <p className={`${panelLabel} mb-4`}>/ PARTNER PROGRAMS</p>

      <div className="border-rule bg-base-200 mb-4 border p-4">
        <p className="text-dim text-[13px] leading-[1.6] text-pretty">
          These are for the people the club cannot sign up — school teams,
          mentors, students at other universities. Every box saves when you click
          out of it. <strong className="text-base-content font-semibold">Empty
          the list</strong> and the section comes off the front page altogether.
        </p>
      </div>

      {partners.length === 0 ? (
        <p className="bg-hatch border-rule text-faint flex h-28 w-full items-center justify-center border font-mono text-[11px] font-medium tracking-[0.14em]">
          [ NO PROGRAMS LISTED ]
        </p>
      ) : (
        <ul className="space-y-2">
          {partners.map((program, index) => (
            <li key={program.id} className="border-rule bg-base-200 border p-2">
              <div className="flex flex-wrap items-center gap-2">
                {/* The same well the public card draws, `object-contain` and
                    all: what lands here is usually a wordmark, and a logo
                    cropped to fill looks like a mistake in a way a letterboxed
                    one does not. */}
                <span
                  className={`border-rule flex h-12 w-20 shrink-0 items-center justify-center border p-1 ${
                    program.imageUrl === null ? 'bg-hatch' : 'bg-base-100'
                  }`}
                >
                  {program.imageUrl === null ? (
                    <span className="text-faint font-mono text-[8px] font-medium tracking-[0.14em]">
                      [ IMAGE ]
                    </span>
                  ) : (
                    <img
                      src={imageSrc(program.imageUrl)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="max-h-full max-w-full object-contain"
                    />
                  )}
                </span>

                <input
                  type="text"
                  defaultValue={program.name}
                  maxLength={80}
                  aria-label={`Name of program ${String(index + 1)}`}
                  disabled={busy}
                  onBlur={(event) => {
                    const next = event.target.value.trim()
                    if (next !== '' && next !== program.name) {
                      void patch(program, { name: next })
                    } else {
                      event.target.value = program.name
                    }
                  }}
                  className="input border-rule bg-base-100 h-9 min-h-0 min-w-0 flex-1 basis-40 text-[13px]"
                />

                <span className="flex shrink-0 items-center gap-1">
                  <MoveButton
                    label={`Move program ${String(index + 1)} earlier`}
                    glyph="‹"
                    disabled={index === 0 || busy}
                    onClick={() => {
                      reorder(moveItem(partners, index, index - 1))
                    }}
                  />
                  <MoveButton
                    label={`Move program ${String(index + 1)} later`}
                    glyph="›"
                    disabled={index === partners.length - 1 || busy}
                    onClick={() => {
                      reorder(moveItem(partners, index, index + 1))
                    }}
                  />
                  <button
                    type="button"
                    aria-label={`Remove program ${String(index + 1)}`}
                    disabled={busy}
                    onClick={() => {
                      setDoomed(program)
                    }}
                    className="text-faint hover:text-error flex size-11 cursor-pointer items-center justify-center text-sm transition-colors duration-200 disabled:opacity-50 wide:size-8"
                  >
                    ✕
                  </button>
                </span>
              </div>

              <div className="mt-2 grid gap-2 wide:grid-cols-2">
                <input
                  type="text"
                  defaultValue={program.audience}
                  maxLength={60}
                  aria-label={`Who program ${String(index + 1)} is for`}
                  disabled={busy}
                  onBlur={(event) => {
                    const next = event.target.value.trim()
                    if (next !== '' && next !== program.audience) {
                      void patch(program, { audience: next })
                    } else {
                      event.target.value = program.audience
                    }
                  }}
                  className="input border-rule bg-base-100 h-9 min-h-0 w-full font-mono text-[11px] tracking-[0.14em] uppercase"
                />

                <input
                  type="url"
                  defaultValue={program.href}
                  maxLength={500}
                  aria-label={`Web address for program ${String(index + 1)}`}
                  disabled={busy}
                  onBlur={(event) => {
                    const next = event.target.value.trim()
                    if (next !== '' && next !== program.href) {
                      void patch(program, { href: next })
                    } else {
                      event.target.value = program.href
                    }
                  }}
                  className="input border-rule bg-base-100 h-9 min-h-0 w-full text-[13px]"
                />
              </div>

              <textarea
                defaultValue={program.blurb}
                rows={3}
                maxLength={600}
                aria-label={`What program ${String(index + 1)} is`}
                disabled={busy}
                onBlur={(event) => {
                  const next = event.target.value.trim()
                  if (next !== '' && next !== program.blurb) {
                    void patch(program, { blurb: next })
                  } else {
                    event.target.value = program.blurb
                  }
                }}
                className="input border-rule bg-base-100 mt-2 h-auto w-full py-2 text-[13px] leading-[1.6]"
              />

              <div className="mt-2 flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1 basis-60">
                  <label
                    className={labelClass}
                    htmlFor={`${id}-link-${program.id}`}
                  >
                    THE LINK&rsquo;S WORDS
                  </label>
                  <input
                    id={`${id}-link-${program.id}`}
                    type="text"
                    defaultValue={program.linkLabel}
                    maxLength={60}
                    disabled={busy}
                    onBlur={(event) => {
                      const next = event.target.value.trim()
                      if (next !== '' && next !== program.linkLabel) {
                        void patch(program, { linkLabel: next })
                      } else {
                        event.target.value = program.linkLabel
                      }
                    }}
                    className="input border-rule bg-base-100 h-9 min-h-0 w-full text-[13px]"
                  />
                </div>

                <div className="min-w-0 flex-1 basis-60">
                  <label
                    className={labelClass}
                    htmlFor={`${id}-image-${program.id}`}
                  >
                    ARTWORK
                  </label>
                  <input
                    id={`${id}-image-${program.id}`}
                    type="file"
                    accept={ACCEPTED_IMAGE_TYPES}
                    disabled={busy}
                    onChange={(event) => {
                      const chosen = event.target.files?.[0]
                      // Cleared before the upload rather than after, so choosing
                      // the *same* file again still fires a change event — an
                      // input whose value has not moved does not emit one, which
                      // is how a retry after a failure silently does nothing.
                      event.target.value = ''
                      if (chosen) void upload(program, chosen)
                    }}
                    className="file-input border-rule bg-base-100 h-9 w-full text-[12px]"
                  />
                </div>

                {program.imageUrl !== null && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void dropImage(program)}
                    className={button}
                  >
                    TAKE THE ARTWORK OFF
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-4 wide:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor={`${id}-name`}>
            A NEW PROGRAM
          </label>
          <input
            id={`${id}-name`}
            type="text"
            value={name}
            maxLength={80}
            disabled={busy || full}
            onChange={(event) => {
              setName(event.target.value)
            }}
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor={`${id}-href`}>
            ITS OWN SITE
          </label>
          <input
            id={`${id}-href`}
            type="url"
            value={href}
            maxLength={500}
            placeholder="https://…"
            disabled={busy || full}
            onChange={(event) => {
              setHref(event.target.value)
            }}
            className={fieldClass}
          />
        </div>
      </div>

      <button
        type="button"
        aria-label="Add a partner program"
        onClick={() => void add()}
        disabled={busy || full || name.trim() === '' || href.trim() === ''}
        className={`${button} mt-2`}
      >
        ADD
      </button>
      <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
        It lands with a line to fill in and a blurb to rewrite — both are on the
        row, and both save when you click out of them.
      </p>

      <p className="text-faint mt-3 font-mono text-[10px] font-medium tracking-[0.14em]">
        {partners.length} / {MAX_PARTNERS} PROGRAMS
        {full && ' — REMOVE ONE TO ADD ANOTHER'}
      </p>

      <Status message={message} />

      {doomed && (
        <ConfirmDialog
          title={`Delete ${doomed.name}?`}
          confirmLabel="DELETE IT"
          busy={busy}
          onConfirm={() => void remove(doomed)}
          onDismiss={() => {
            setDoomed(null)
          }}
        >
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            {doomed.imageUrl !== null && isStoredUpload(doomed.imageUrl)
              ? 'This removes the card for good, and the artwork file with it.'
              : 'This removes the card for good.'}{' '}
            There is no undo.
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
