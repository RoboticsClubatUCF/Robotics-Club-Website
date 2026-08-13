import { postForm, postJson, patchJson } from './api'
import { DEFAULT_FRAMING, isDefaultFraming, type Framing } from './imageFraming'
import type { ApiProjectImage, ApiProjectLink } from './api'

/**
 * A project being filled in before it exists.
 *
 * The create page collects everything — the write-up, the links, the pictures,
 * their framing — and one press turns the lot into a project. Nothing on that
 * page is gated behind the project existing, which means nothing typed there
 * can be lost by not getting far enough.
 *
 * The write-up and the repository need no help: they are columns on the project
 * and go up in the create request itself. Links and pictures cannot, because
 * both hang off a project id — so they are held here until there is one, and
 * `publishDraft` is the sequence that lands them.
 */

/**
 * A picture in the draft. Two shapes, because they become two different
 * requests: an address is a small JSON write, a file is a multipart upload
 * against its own budget.
 *
 * `key` is a local identity for React and for the framing panel — the stored
 * row's id does not exist yet, and a file has nothing else unique about it. A
 * file also carries `previewUrl`, an object URL that **must be revoked**, which
 * is why removing a picture goes through `releaseDraftImage`.
 */
export type DraftImage = {
  key: string
  caption: string
  framing: Framing
} & ({ kind: 'url'; url: string } | { kind: 'file'; file: File; previewUrl: string })

/**
 * A link being typed. No id, on purpose: `PATCH /projects/:id/links` replaces
 * the whole set, so nothing ever refers to a stored row — which is also what
 * lets the same rows be filled in before the project exists at all.
 */
export type DraftLink = { label: string; url: string }

/** The rows worth sending: both halves filled in, both trimmed. */
export const usableLinks = (links: DraftLink[]): DraftLink[] =>
  links
    .filter((link) => link.label.trim() && link.url.trim())
    .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))

let counter = 0
export const draftKey = () => `draft-${(counter += 1)}`

export const draftFromUrl = (url: string): DraftImage => ({
  key: draftKey(),
  caption: '',
  framing: DEFAULT_FRAMING,
  kind: 'url',
  url,
})

export const draftFromFile = (file: File): DraftImage => ({
  key: draftKey(),
  caption: '',
  framing: DEFAULT_FRAMING,
  kind: 'file',
  file,
  previewUrl: URL.createObjectURL(file),
})

/** What to show for a draft picture: the object URL, or the address itself. */
export const draftSrc = (image: DraftImage): string =>
  image.kind === 'file' ? image.previewUrl : image.url

/**
 * Hands the browser back the memory behind a file preview.
 *
 * An object URL pins the whole file until it is revoked, so a dozen photos
 * chosen and removed again while filling the form would otherwise sit in memory
 * for the life of the tab.
 */
export function releaseDraftImage(image: DraftImage): void {
  if (image.kind === 'file') URL.revokeObjectURL(image.previewUrl)
}

/** What a publish attempt did, whether or not all of it worked. */
export type PublishResult = {
  images: ApiProjectImage[]
  links: ApiProjectLink[]
  /** Human sentences for the parts that did not land. Empty on a clean run. */
  failures: string[]
}

/**
 * Turns a draft into rows on a project that now exists.
 *
 * **Sequential, not parallel, and that is the whole ordering story**: each
 * picture is appended at the end of the gallery, so the order they arrive in is
 * the order they end up in. `Promise.all` would publish a gallery shuffled by
 * whichever upload finished first.
 *
 * **Nothing throws.** The project has already been created by the time this
 * runs, so an exception here would leave the caller holding a live project and
 * no idea what landed. Each step's failure is caught, named, and reported
 * alongside everything that did work — the page then drops into the ordinary
 * editor with the successful rows in place, which is where a retry belongs.
 *
 * Framing goes up **with** each picture rather than as a follow-up patch, so a
 * photo cannot arrive correctly and then be left wrongly framed by a second
 * request failing on its own.
 */
export async function publishDraft(
  projectId: string,
  draft: { links: DraftLink[]; images: DraftImage[] },
): Promise<PublishResult> {
  const failures: string[] = []
  let links: ApiProjectLink[] = []

  if (draft.links.length > 0) {
    try {
      links = await patchJson<ApiProjectLink[]>(`/projects/${projectId}/links`, {
        links: draft.links,
      })
    } catch {
      failures.push(
        `The ${draft.links.length === 1 ? 'link' : `${draft.links.length} links`} could not be saved. Add them below.`,
      )
    }
  }

  const images: ApiProjectImage[] = []

  for (const [index, image] of draft.images.entries()) {
    try {
      images.push(await sendImage(projectId, image))
    } catch {
      failures.push(`Picture ${index + 1} could not be added. Add it below.`)
    }
  }

  return { images, links, failures }
}

async function sendImage(
  projectId: string,
  image: DraftImage,
): Promise<ApiProjectImage> {
  const caption = image.caption.trim() || undefined

  if (image.kind === 'url') {
    return postJson<ApiProjectImage>(`/projects/${projectId}/images`, {
      url: image.url,
      caption,
      // Left off entirely when it was never moved, so the row takes the
      // column defaults rather than being written with the same numbers.
      ...(isDefaultFraming(image.framing) ? {} : image.framing),
    })
  }

  const body = new FormData()
  body.append('file', image.file)
  if (caption) body.append('caption', caption)
  if (!isDefaultFraming(image.framing)) {
    // Multipart carries no types; the route parses these back and ignores
    // anything it cannot read.
    body.append('focalX', String(image.framing.focalX))
    body.append('focalY', String(image.framing.focalY))
    body.append('zoom', String(image.framing.zoom))
  }

  return postForm<ApiProjectImage>(`/projects/${projectId}/images/upload`, body)
}
