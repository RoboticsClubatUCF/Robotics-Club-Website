import type { ApiMilestone } from './api/api'
import { prefersReducedMotion } from './heroSlides'
import { DEFAULT_FRAMING, safeFraming, type Framing } from './media/imageFraming'
import { imageSrc } from './media/storedFiles'

/**
 * What the about page's editor may offer, mirrored off the routes that enforce it.
 *
 * The same contract as `frontPage.ts` beside this file: the real limits are `MAX_STORY`,
 * `MAX_MILESTONES` and `MAX_STATS` in `server/src/routes/officer/aboutPage.ts`, and a form that
 * offers what the route refuses is the failure the convention prevents. Change one and change the
 * other.
 */

/** How many paragraphs the story may run to. The layout is built around three. */
export const MAX_STORY = 6

/** How many lines the timeline may carry. It shipped with five. */
export const MAX_MILESTONES = 12

/** How many cells OUR IMPACT may hold. Six fit one row at desktop width. */
export const MAX_STATS = 6

/**
 * A stat's figure, split into the part that counts up and the words after it.
 *
 * "$15,000 annually" is `$` + 15000 + `` in large type, then "annually" as the unit. The figure is
 * free text because officers type it the way the club says it, so the number is found rather than
 * stored.
 *
 * Only an amount counts: a bare number, perhaps with a currency sign before it and "+", "%" or
 * "k" after. "24/7 access" would count through "12/7" and "Since 1972" would count up a year, so
 * those, and a figure with no number at all, print as written.
 */
export type Figure = {
  /** The large part exactly as typed: "$15,000", "24/7". */
  lead: string
  counts: boolean
  /** What comes before the number: "$". */
  before: string
  value: number
  /** Written with thousands commas, so the count keeps them. */
  grouped: boolean
  decimals: number
  /** Symbols stuck to the number: "+", "%", "k". */
  after: string
  /** The words after a space: "years", "active projects". */
  unit: string
}

const FIGURE = /^(\D*?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(\S*)\s*(.*)$/

export function splitFigure(figure: string): Figure {
  const typed = figure.trim()
  const match = FIGURE.exec(typed)

  if (!match) {
    return {
      lead: typed,
      counts: false,
      before: '',
      value: 0,
      grouped: false,
      decimals: 0,
      after: '',
      unit: '',
    }
  }

  const [, before = '', digits = '', fraction = '', after = '', unit = ''] = match

  return {
    lead: `${before}${digits}${fraction}${after}`,
    counts: /^[^\p{L}\p{N}\s]*$/u.test(before) && /^[+%kKmMbBx×]*$/.test(after),
    before,
    value: Number(`${digits.replaceAll(',', '')}${fraction}`),
    grouped: digits.includes(','),
    decimals: fraction === '' ? 0 : fraction.length - 1,
    after,
    unit,
  }
}

/**
 * The large part of a figure partway through its count, `progress` running 0 to 1.
 *
 * Eased out, so the digits race and then settle, and rounded to the figure's own precision so
 * "7" never reads "6.4" on the way.
 */
export function figureAt(
  { lead, counts, before, value, grouped, decimals, after }: Figure,
  progress: number,
) {
  if (!counts) return lead

  const eased = 1 - (1 - Math.min(1, Math.max(0, progress))) ** 3
  const shown = (value * eased).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: grouped,
  })

  return `${before}${shown}${after}`
}

/** How long the numbers take to count up once they're on screen. */
export const COUNT_MS = 1400

/**
 * Whether the numbers should count up at all.
 *
 * Not under reduced motion, and not where the browser can't say when they come into view: a count
 * that starts off-screen is over before anybody sees it, and one that never starts shows zeros.
 */
export const canCountUp = (): boolean =>
  typeof IntersectionObserver === 'function' &&
  typeof requestAnimationFrame === 'function' &&
  !prefersReducedMotion()

/**
 * A timeline photo while the editor is open.
 *
 * `kept` is one already on the page, sent back by its URL so the server can check it's still
 * there. `file` hasn't been uploaded: it goes up as a part of the save, and its `previewUrl` is an
 * object URL that must be handed back through `releasePhoto`.
 */
export type DraftPhoto = { caption: string; framing: Framing } & (
  | { kind: 'kept'; url: string }
  | { kind: 'file'; file: File; previewUrl: string }
)

export const photoOf = (line: ApiMilestone): DraftPhoto | null =>
  line.imageUrl
    ? {
        kind: 'kept',
        url: line.imageUrl,
        caption: line.imageCaption ?? '',
        framing: safeFraming(line),
      }
    : null

export const photoFromFile = (file: File): DraftPhoto => ({
  kind: 'file',
  file,
  previewUrl: URL.createObjectURL(file),
  caption: '',
  framing: DEFAULT_FRAMING,
})

/** What an `<img>` shows for a draft photo. */
export const photoSrc = (photo: DraftPhoto): string =>
  photo.kind === 'file' ? photo.previewUrl : imageSrc(photo.url)

export function releasePhoto(photo: DraftPhoto | null): void {
  if (photo?.kind === 'file') URL.revokeObjectURL(photo.previewUrl)
}

/**
 * The save as one multipart body: the page as JSON in `page`, and each new photo as a part the
 * line names. Kept photos go by URL. `page` is everything except the timeline, which this adds.
 */
export function aboutSaveForm(
  page: Record<string, unknown>,
  lines: { when: string; what: string; photo: DraftPhoto | null }[],
): FormData {
  const form = new FormData()

  const milestones = lines.map((line, index) => {
    const { photo } = line
    if (photo === null) return { when: line.when, what: line.what, photo: null }

    const part = `photo-${index}`
    if (photo.kind === 'file') form.append(part, photo.file)

    return {
      when: line.when,
      what: line.what,
      photo: photo.kind === 'kept' ? { keep: photo.url } : { upload: part },
      imageCaption: photo.caption.trim() || null,
      ...photo.framing,
    }
  })

  form.append('page', JSON.stringify({ ...page, milestones }))
  return form
}
