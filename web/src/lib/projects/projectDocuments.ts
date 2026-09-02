import { deleteJson, patchJson, postForm } from '../api/api'
import type { ApiProjectDocument } from '../api/api'
import { draftKey } from './projectDraft'

/**
 * The documentation section while somebody is working on it.
 *
 * The same move the gallery made, for a stronger reason: the button here used to
 * read PUBLISH A DOCUMENT and meant it — the file went up, the row appeared on a
 * public page, and the SAVE at the foot of the editor had nothing to do with any
 * of it. **Now nothing is published until the page is saved**, so a document
 * half-titled and thought better of is a draft that never existed rather than
 * something to go and delete.
 *
 * The trade is that a file's size is refused at save time rather than at the
 * moment it was chosen, which is why `DocumentsEditor` checks the format and the
 * size in the browser first — the server is still what actually refuses, but by
 * then it should have nothing left to say.
 */
export type DraftDocument = {
  /** Local identity. A stored row uses its own id, so it survives a save. */
  key: string
  /** The published row this stands for, or null for one not published yet. */
  stored: ApiProjectDocument | null
  title: string
  description: string
  /**
   * Who to credit.
   *
   * Empty means two different things and both are correct: on a stored row it is
   * "leave the credit alone", which is what the select's first option says out
   * loud; on a new one it is "nobody chosen yet", and the form will not let it
   * be saved that way.
   */
  authorUserId: string
  /**
   * A file chosen and not yet sent — the document itself when this is new, a
   * revision of it when it is not.
   */
  file: File | null
}

export const draftFromDocument = (document: ApiProjectDocument): DraftDocument => ({
  key: document.id,
  stored: document,
  title: document.title,
  description: document.description ?? '',
  authorUserId: '',
  file: null,
})

export const blankDocument = (authorUserId: string): DraftDocument => ({
  key: draftKey(),
  stored: null,
  title: '',
  description: '',
  authorUserId,
  file: null,
})

/** Whether this row would send anything. */
export const documentChanged = (draft: DraftDocument): boolean =>
  draft.stored === null ||
  draft.file !== null ||
  draft.authorUserId !== '' ||
  draft.title.trim() !== draft.stored.title ||
  draft.description.trim() !== (draft.stored.description ?? '')

/** Whether the section as a whole would. Removals count, and are why the stored
    list is needed rather than just the draft. */
export const documentsDirty = (
  stored: ApiProjectDocument[],
  draft: DraftDocument[],
): boolean =>
  stored.length !== draft.filter((row) => row.stored !== null).length ||
  draft.some(documentChanged)

/**
 * Brings the published documents level with the draft.
 *
 * Removals first, so a section swapped document-for-document at the cap does not
 * meet it halfway through — the same ordering `saveGallery` uses and for the same
 * reason. Then each row in order: a new one is a multipart publish, a changed one
 * is a patch, and a replaced file is a second request *after* the patch so the
 * row that comes back carries both changes rather than only whichever went last.
 *
 * Throws on the first failure, with everything before it already landed. The
 * editor applies what came back and names the section, so pressing SAVE again
 * retries the rest rather than publishing the first document twice.
 */
export async function saveDocuments(
  projectId: string,
  stored: ApiProjectDocument[],
  draft: DraftDocument[],
): Promise<ApiProjectDocument[]> {
  const kept = new Set(
    draft.map((row) => row.stored?.id).filter((id): id is string => id !== undefined),
  )

  for (const row of stored) {
    if (!kept.has(row.id)) {
      await deleteJson(`/projects/${projectId}/documents/${row.id}`)
    }
  }

  const saved: ApiProjectDocument[] = []

  for (const row of draft) {
    if (row.stored === null) {
      // Guarded by the form, which will not offer a save without one — said
      // again here because this function is also the thing a test calls.
      if (!row.file) continue

      const body = new FormData()
      body.append('file', row.file)
      body.append('title', row.title.trim())
      body.append('description', row.description.trim())
      body.append('authorUserId', row.authorUserId)

      saved.push(
        await postForm<ApiProjectDocument>(
          `/projects/${projectId}/documents`,
          body,
        ),
      )
      continue
    }

    let current = row.stored
    const title = row.title.trim()
    const description = row.description.trim()

    if (
      title !== current.title ||
      description !== (current.description ?? '') ||
      row.authorUserId !== ''
    ) {
      current = await patchJson<ApiProjectDocument>(
        `/projects/${projectId}/documents/${current.id}`,
        {
          title,
          description: description || null,
          // Absent means "leave the credit alone", which is how the route reads
          // it too — so sending nothing is the honest way to say it.
          ...(row.authorUserId ? { authorUserId: row.authorUserId } : {}),
        },
      )
    }

    if (row.file) {
      const body = new FormData()
      body.append('file', row.file)
      current = await postForm<ApiProjectDocument>(
        `/projects/${projectId}/documents/${current.id}/file`,
        body,
      )
    }

    saved.push(current)
  }

  return saved
}
