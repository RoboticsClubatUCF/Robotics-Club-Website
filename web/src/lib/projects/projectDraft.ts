import { deleteJson, postForm, postJson, patchJson } from '../api/api'
import {
  DEFAULT_FRAMING,
  isDefaultFraming,
  safeFraming,
  type Framing,
} from '../media/imageFraming'
import type { ApiProjectImage, ApiProjectLink } from '../api/api'

/**
 * A project's gallery while somebody is working on it, whether or not the
 * project exists yet.
 *
 * This started as the create page's problem — everything typed there has to
 * survive until one press turns it into a project — and it is now the *editor's*
 * as well. The editor used to upload a picture the moment it was chosen, delete
 * one the moment the ✕ was pressed, and write a caption on blur; a page that
 * saves some of itself as you touch it and the rest when you press a button is a
 * page nobody can predict. **Nothing in either gallery reaches the server until
 * a save**, so a draft picture and a stored one are the same thing here and the
 * one component draws both.
 */

/**
 * A picture in the draft. Three shapes, because they become three different
 * requests: an address is a small JSON write, a file is a multipart upload
 * against its own budget, and a stored row is already up and needs at most a
 * patch.
 *
 * `key` is a local identity for React and for the framing panel — a new
 * picture's stored id does not exist yet, and a file has nothing else unique
 * about it. A stored row uses its own id, which is stable across a save.
 */
type DraftImageBase = {
  key: string
  caption: string
  framing: Framing
}

/**
 * One that is not on the server yet. A file also carries `previewUrl`, an object
 * URL that **must be revoked**, which is why removing a picture goes through
 * `releaseDraftImage`.
 */
export type NewImage = DraftImageBase &
  ({ kind: 'url'; url: string } | { kind: 'file'; file: File; previewUrl: string })

/** One that is already a `ProjectImage` row. Only the editor has these. */
export type StoredImage = DraftImageBase & { kind: 'stored'; id: string; url: string }

export type DraftImage = NewImage | StoredImage

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

export const draftFromUrl = (url: string): NewImage => ({
  key: draftKey(),
  caption: '',
  framing: DEFAULT_FRAMING,
  kind: 'url',
  url,
})

export const draftFromFile = (file: File): NewImage => ({
  key: draftKey(),
  caption: '',
  framing: DEFAULT_FRAMING,
  kind: 'file',
  file,
  previewUrl: URL.createObjectURL(file),
})

/**
 * A stored row as a draft one. Keyed on its own id rather than a counter, so a
 * re-render after a save does not remount every row in the gallery — and so the
 * framing panel stays open on the picture it was opened on.
 */
export const draftFromImage = (image: ApiProjectImage): StoredImage => ({
  key: image.id,
  caption: image.caption ?? '',
  framing: safeFraming(image),
  kind: 'stored',
  id: image.id,
  url: image.url,
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
 * `saveGallery` below is the editor's version of this, and it is the opposite on
 * exactly that point: there the project already exists, so a failure can be
 * thrown at one status line and retried by pressing SAVE again.
 *
 * Framing goes up **with** each picture rather than as a follow-up patch, so a
 * photo cannot arrive correctly and then be left wrongly framed by a second
 * request failing on its own.
 */
export async function publishDraft(
  projectId: string,
  draft: { links: DraftLink[]; images: NewImage[] },
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

/**
 * The gallery of a project that already exists, brought level with its draft.
 *
 * Four kinds of write, in the one order that is safe. **Removals first**, so a
 * gallery swapped picture-for-picture at the twelve-image cap does not hit it
 * halfway through. **Then each row in draft order**, which is what makes the
 * appended ones arrive in the order they are shown in. **Then the order**, and
 * only when the draft disagrees with what the server would already hold — the
 * server keeps existing rows where they were and puts new ones at the end, which
 * is very often exactly what was wanted.
 *
 * **This throws, and the caller must not swallow it.** Every step before the
 * failure has already landed on the server, so the editor applies what came back
 * and reports the rest: pressing SAVE again then retries only what is still
 * outstanding rather than uploading the first four photos a second time.
 */
export async function saveGallery(
  projectId: string,
  stored: ApiProjectImage[],
  draft: DraftImage[],
): Promise<ApiProjectImage[]> {
  const kept = new Set(
    draft.filter((image) => image.kind === 'stored').map((image) => image.id),
  )

  for (const row of stored) {
    if (!kept.has(row.id)) {
      await deleteJson(`/projects/${projectId}/images/${row.id}`)
    }
  }

  const byId = new Map(stored.map((row) => [row.id, row]))
  const saved: ApiProjectImage[] = []
  const added: string[] = []

  for (const image of draft) {
    if (image.kind !== 'stored') {
      const row = await sendImage(projectId, image)
      saved.push(row)
      added.push(row.id)
      continue
    }

    const row = byId.get(image.id)
    const caption = image.caption.trim() || null

    // Untouched rows are skipped rather than re-sent. A gallery of twelve is
    // twelve writes against a budget of sixty, and all a lead did was reword one
    // caption.
    if (row && caption === row.caption && sameFraming(row, image.framing)) {
      saved.push(row)
      continue
    }

    saved.push(
      await patchJson<ApiProjectImage>(
        `/projects/${projectId}/images/${image.id}`,
        { caption, ...image.framing },
      ),
    )
  }

  const asHeld = [
    ...stored.filter((row) => kept.has(row.id)).map((row) => row.id),
    ...added,
  ].join()

  if (saved.length > 0 && saved.map((row) => row.id).join() !== asHeld) {
    return patchJson<ApiProjectImage[]>(`/projects/${projectId}/images/order`, {
      ids: saved.map((row) => row.id),
    })
  }

  return saved
}

/**
 * Whether the gallery holds anything the server does not.
 *
 * Positional rather than set-based, because a reorder is a change: the draft is
 * clean only when it is the stored list, in the stored order, with the same
 * captions and the same framing.
 */
export const galleryDirty = (
  stored: ApiProjectImage[],
  draft: DraftImage[],
): boolean =>
  stored.length !== draft.length ||
  draft.some((image, index) => {
    const row = stored[index]

    return (
      image.kind !== 'stored' ||
      row === undefined ||
      row.id !== image.id ||
      (image.caption.trim() || null) !== row.caption ||
      !sameFraming(row, image.framing)
    )
  })

/** Whether a stored row is already framed the way the draft says. */
const sameFraming = (row: ApiProjectImage, framing: Framing) =>
  row.focalX === framing.focalX &&
  row.focalY === framing.focalY &&
  row.zoom === framing.zoom

async function sendImage(
  projectId: string,
  image: NewImage,
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
