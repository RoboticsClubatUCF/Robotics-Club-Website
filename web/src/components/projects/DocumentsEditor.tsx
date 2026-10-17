import { useId, useState } from 'react'
import { Status } from '../shared/Status'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { fieldClass, labelClass } from '../shared/formChrome'
import type { ApiProjectDetail } from '../../lib/api/api'
import { fileSize, longDate } from '../../lib/format/formats'
import { MAX_PROJECT_DOCUMENTS } from '../../lib/projects/projectGallery'
import {
  blankDocument,
  documentsDirty,
  draftFromDocument,
  saveDocuments,
  type DocumentAuthorDraft,
  type DraftDocument,
} from '../../lib/projects/projectDocuments'
import { draftKey } from '../../lib/projects/projectDraft'
import { useSectionSave, type SaveRegistry } from '../../lib/projects/editorSaves'
import type { ProjectRoster } from '../../lib/projects/useProjectRoster'

/** Somebody this project can credit: a member, or the officer editing it. */
type Person = { userId: string; fullName: string }

/**
 * The `/ DOCUMENTATION` section of the project editor.
 *
 * Nothing here is published until the page is saved, which is the opposite of what this section
 * used to do: ADD sent the file, EDIT DETAILS wrote on the spot, and REMOVE deleted bytes — none
 * of it touched by the SAVE at the foot of the page. The argument for that was that every action
 * owns bytes and therefore a failure worth seeing immediately. The argument against won: a
 * section that published a document a lead hadn't finished thinking about, from a page whose
 * button said SAVE, was the surprise this editor kept handing people.
 *
 * What that costs is the size refusal, which now arrives at save time rather than at the moment
 * of choosing. `tooBig` and `wrongFormat` are the answer — both checked in the browser first.
 *
 * ADD still validates, and that's why nothing else has to: a row only joins the list once it has
 * a title, a credit and a file, so every draft row is sendable.
 */
export function DocumentsEditor({
  project,
  me,
  roster,
  registry,
  busy,
}: {
  project: ApiProjectDetail
  /**
   * Whoever is doing the editing, for the credit to start on. Passed in rather
   * than read from the session context, so this component can be mounted by
   * anything that has a project — including a test — without dragging a
   * provider in behind it.
   */
  me?: { id: string; fullName: string }
  /**
   * Who this project can credit, read once by `ProjectEditor` and handed down.
   *
   * This section used to fetch it itself, deferred until a form opened, on the grounds that most
   * visits are somebody fixing a sentence. That was right while this was the only consumer; the
   * team section beside it can't draw a single row without the same list, so deferring here now
   * only means asking twice.
   */
  roster: ProjectRoster
  registry: SaveRegistry
  busy: boolean
}) {
  const id = useId()
  const [message, setMessage] = useState('')
  const [documents, setDocuments] = useState<DraftDocument[]>(() =>
    project.documents.map(draftFromDocument),
  )
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [doomed, setDoomed] = useState<DraftDocument | null>(null)

  const full = documents.length >= MAX_PROJECT_DOCUMENTS

  useSectionSave(registry, 'documents', {
    dirty: documentsDirty(project.documents, documents),
    save: async () => {
      const saved = await saveDocuments(project.id, project.documents, documents)
      setDocuments(saved.map(draftFromDocument))
      return { documents: saved }
    },
  })

  /**
   * The roster, plus whoever is editing if they aren't on it.
   *
   * That second half is the officer case: an officer may edit any project without being a member
   * of it, and the server credits them to themselves happily — so leaving them out would make
   * them the one person who can't be named as the author of the thing they just wrote.
   */
  const people: Person[] = (() => {
    const listed = roster.members.map((member) => ({
      userId: member.userId,
      fullName: member.fullName,
    }))

    return me && !listed.some((person) => person.userId === me.id)
      ? [...listed, { userId: me.id, fullName: me.fullName }]
      : listed
  })()

  const patch = (row: DraftDocument, change: Partial<DraftDocument>) => {
    setDocuments(
      documents.map((current) =>
        current.key === row.key ? { ...current, ...change } : current,
      ),
    )
  }

  const remove = (row: DraftDocument) => {
    setDocuments(documents.filter((current) => current.key !== row.key))
    setDoomed(null)
    setMessage('')
  }

  const chooseFile = (row: DraftDocument, file: File) => {
    const wrong = wrongFormat(file) ?? tooBig(file)
    if (wrong) {
      setMessage(wrong)
      return
    }

    patch(row, { file })
    setMessage('')
  }

  return (
    <section>
      <p className="text-faint mb-4 font-mono text-[13px] font-bold tracking-[0.2em]">
        / DOCUMENTATION
      </p>

      {/* The section it points at can be renamed per project now, so this
          sentence stops naming it — a blurb that says "/ RESOURCES" on a page
          whose heading reads "/ FILES" is worse than one that says neither. */}
      <p className="mb-4 text-[12px] leading-[1.6] text-pretty text-faint">
        PDFs and Word documents, on a page of their own, reached from the resources list
        on the project page. Anyone can read them.
      </p>

      {documents.length === 0 ? (
        <p className="text-faint border-rule border-t py-5 text-sm">
          Nothing published yet.
        </p>
      ) : (
        <ul className="border-rule divide-rule divide-y border">
          {documents.map((row) => (
            <li key={row.key} className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-sm font-medium">
                  {row.title.trim() || 'Untitled'}
                </span>
                <span className="text-faint font-mono text-[10px] font-medium tracking-[0.14em]">
                  {fileSize(row.file?.size ?? row.stored?.fileSize ?? 0)}
                </span>
              </div>

              <p className="text-faint mt-1 font-mono text-[11px] leading-[1.7] tracking-[0.06em]">
                {row.stored ? (
                  <>
                    {namesOf(people, row.authors)} · {row.stored.fileName} · UPLOADED{' '}
                    {longDate(row.stored.uploadedAt)}
                    {row.stored.updatedAt !== row.stored.uploadedAt && (
                      <> · UPDATED {longDate(row.stored.updatedAt)}</>
                    )}
                  </>
                ) : (
                  <>
                    {namesOf(people, row.authors)} · {row.file?.name} · NOT
                    PUBLISHED YET
                  </>
                )}
              </p>

              {/* Said on the row rather than only at the bottom of the page: a
                  replacement is the one change here whose effect is invisible
                  until it has happened. */}
              {row.stored && row.file && (
                <p className="text-primary mt-1 font-mono text-[10px] font-medium tracking-[0.14em]">
                  REPLACING WITH {row.file.name} ON SAVE
                </p>
              )}

              {editing === row.key ? (
                <DocumentFields
                  idPrefix={`${id}-edit-${row.key}`}
                  people={people}
                  busy={busy}
                  initial={{
                    title: row.title,
                    description: row.description,
                    authors: row.authors,
                  }}
                  defaultAuthorId={me?.id ?? ''}
                  submitLabel="DONE"
                  onCancel={() => {
                    setEditing(null)
                  }}
                  onSubmit={(values) => {
                    patch(row, values)
                    setEditing(null)
                  }}
                />
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditing(row.key)
                      setMessage('')
                    }}
                    className="text-faint hover:text-primary cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50"
                  >
                    EDIT DETAILS
                  </button>

                  <label
                    htmlFor={`${id}-replace-${row.key}`}
                    aria-disabled={busy}
                    className={`cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] text-faint transition-colors duration-200 hover:text-primary ${
                      busy ? 'pointer-events-none opacity-50' : ''
                    }`}
                  >
                    {row.stored ? 'REPLACE THE FILE' : 'CHOOSE A DIFFERENT FILE'}
                  </label>
                  <input
                    id={`${id}-replace-${row.key}`}
                    type="file"
                    accept={ACCEPTED}
                    disabled={busy}
                    onChange={(event) => {
                      const chosen = event.target.files?.[0]
                      // Cleared before, not after, so picking the same file
                      // again after a refusal still fires.
                      event.target.value = ''
                      if (chosen) chooseFile(row, chosen)
                    }}
                    className="sr-only"
                  />

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      // Nothing is destroyed by dropping a row that was never
                      // published, so only the other kind is asked about.
                      if (row.stored) {
                        setDoomed(row)
                      } else {
                        remove(row)
                      }
                    }}
                    className="text-faint hover:text-error cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50"
                  >
                    REMOVE
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && !full && (
        <div className="border-rule mt-4 border p-4">
          <p className="text-faint mb-3 font-mono text-[10px] font-medium tracking-[0.16em]">
            ADD A DOCUMENT
          </p>
          <DocumentFields
            idPrefix={`${id}-new`}
            people={people}
            defaultAuthorId={me?.id ?? ''}
            busy={busy}
            withFile
            initial={{ title: '', description: '', authors: [] }}
            submitLabel="ADD"
            onCancel={() => {
              setAdding(false)
              setMessage('')
            }}
            onSubmit={(values, file) => {
              // Said here rather than thrown: this is the browser disagreeing
              // with a choice, and `explainApiError` keeps only the *server's*
              // sentences and flattens everybody else's.
              if (!file) {
                setMessage('Choose the file first.')
                return
              }

              const wrong = wrongFormat(file) ?? tooBig(file)
              if (wrong) {
                setMessage(wrong)
                return
              }

              setDocuments([
                ...documents,
                { ...blankDocument(values.authors), ...values, file },
              ])
              setAdding(false)
              setMessage('')
            }}
          />
        </div>
      )}

      {/* Closed until it is wanted, the way `+ ADD A LINK` is. */}
      {!adding && !full && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setAdding(true)
            setMessage('')
          }}
          className="text-faint hover:text-primary mt-4 cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50"
        >
          + ADD A DOCUMENT
        </button>
      )}

      {full && (
        <p className="text-faint mt-4 font-mono text-[10px] font-medium tracking-[0.14em]">
          {MAX_PROJECT_DOCUMENTS} IS THE LIMIT — REMOVE ONE TO ADD ANOTHER
        </p>
      )}

      <Status message={message} />

      {doomed && (
        <ConfirmDialog
          title={`Remove “${doomed.title.trim() || 'this document'}”?`}
          confirmLabel="REMOVE IT"
          onConfirm={() => {
            remove(doomed)
          }}
          onDismiss={() => {
            setDoomed(null)
          }}
        >
          <p>
            The file is deleted when this page is saved, and the club keeps no
            other copy. If this is a new version rather than a mistake, REPLACE
            THE FILE keeps the page and its history instead.
          </p>
        </ConfirmDialog>
      )}
    </section>
  )
}

type Values = { title: string; description: string; authors: DocumentAuthorDraft[] }

/** Whoever a draft row is credited to, for the line under an unpublished one. */
const namesOf = (people: Person[], authors: DocumentAuthorDraft[]) =>
  authors
    .map((author) =>
      'userId' in author
        ? (people.find((person) => person.userId === author.userId)?.fullName ??
          'Unattributed')
        : author.name,
    )
    .join(', ')

/**
 * Title, blurb, credit — and, when adding, the file.
 *
 * One component for both because a document being edited and one being written have exactly the
 * same fields, and two copies is how the credit box ends up on one of them.
 *
 * Existing credits are retained by credit id, so authors who left the project or
 * deleted their account can stay on the document while another author is added.
 */
function DocumentFields({
  idPrefix,
  people,
  defaultAuthorId,
  busy,
  initial,
  submitLabel,
  withFile = false,
  onSubmit,
  onCancel,
}: {
  idPrefix: string
  people: Person[]
  /**
   * Who the credit starts on for a new document — whoever is signed in. Passed down rather than
   * picked out of `people` here, because "me" isn't a position in that list: a lead is usually
   * near the top of their own roster and an officer is appended to the end of it.
   */
  defaultAuthorId: string
  busy: boolean
  initial: Values
  submitLabel: string
  withFile?: boolean
  onSubmit: (values: Values, file?: File) => void
  onCancel?: () => void
}) {
  const [values, setValues] = useState(initial)
  const [file, setFile] = useState<File | null>(null)
  const [authors, setAuthors] = useState(() => {
    const first = defaultAuthorId || people[0]?.userId
    const starting: DocumentAuthorDraft[] =
      initial.authors.length > 0
        ? initial.authors
        : [first ? { userId: first } : { name: '' }]
    return starting.map((author) => ({ key: draftKey(), author }))
  })
  const savedAuthors = initial.authors.filter((author) => 'id' in author)

  const set = (patch: Partial<Values>) => {
    setValues((current) => ({ ...current, ...patch }))
  }

  const setAuthor = (key: string, author: DocumentAuthorDraft) => {
    setAuthors((current) =>
      current.map((row) => (row.key === key ? { ...row, author } : row)),
    )
  }
  const identities = authors.map(({ author }) =>
    'id' in author
      ? `saved:${author.id}`
      : 'userId' in author
        ? `user:${author.userId}`
        : `name:${author.name.trim().toLowerCase()}`,
  )
  const authorProblem = authors.some(({ author }) =>
    'userId' in author ? author.userId === '' : author.name.trim() === '',
  )
    ? 'Choose each author, or enter their name.'
    : new Set(identities).size !== identities.length
      ? 'List each author only once.'
      : null

  return (
    <div className="mt-3 space-y-3">
      <div>
        <label className={labelClass} htmlFor={`${idPrefix}-title`}>
          TITLE
        </label>
        <input
          id={`${idPrefix}-title`}
          type="text"
          value={values.title}
          maxLength={120}
          placeholder="Design review"
          disabled={busy}
          onChange={(event) => {
            set({ title: event.target.value })
          }}
          className={fieldClass}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`${idPrefix}-description`}>
          WHAT IT IS
        </label>
        <input
          id={`${idPrefix}-description`}
          type="text"
          value={values.description}
          maxLength={500}
          placeholder="Optional — one line under the title."
          disabled={busy}
          onChange={(event) => {
            set({ description: event.target.value })
          }}
          className={fieldClass}
        />
      </div>

      <fieldset className="space-y-3">
        <legend className={labelClass}>AUTHORS</legend>
        <p className="text-[12px] leading-[1.6] text-faint">
          Add each author. Choose a project member or enter a name for a former member.
        </p>
        {authors.map(({ key, author }, index) => {
          const selection =
            'id' in author
              ? `saved:${author.id}`
              : 'userId' in author
                ? author.userId
                : 'name'
          return (
            <div key={key} className="flex flex-wrap items-end gap-2">
              <div className="min-w-40 flex-1">
                <label className={labelClass} htmlFor={`${idPrefix}-author-${key}`}>
                  {index === 0 ? 'WRITTEN BY' : `AUTHOR ${index + 1}`}
                </label>
                <select
                  id={`${idPrefix}-author-${key}`}
                  value={selection}
                  disabled={busy}
                  onChange={(event) => {
                    const value = event.target.value
                    const saved = savedAuthors.find(
                      (each) => `saved:${each.id}` === value,
                    )
                    setAuthor(
                      key,
                      saved ?? (value === 'name' ? { name: '' } : { userId: value }),
                    )
                  }}
                  className="select w-full border-rule bg-base-200 text-sm"
                >
                  <option value="" disabled>
                    Choose an author
                  </option>
                  {savedAuthors.map((saved) => (
                    <option key={saved.id} value={`saved:${saved.id}`}>
                      {saved.name} — leave as is
                    </option>
                  ))}
                  {people.map((person) => (
                    <option key={person.userId} value={person.userId}>
                      {person.fullName}
                    </option>
                  ))}
                  <option value="name">Enter a name (former member)</option>
                </select>
              </div>
              {!('userId' in author) && !('id' in author) && (
                <div className="min-w-40 flex-1">
                  <label
                    className={labelClass}
                    htmlFor={`${idPrefix}-author-name-${key}`}
                  >
                    AUTHOR NAME {index + 1}
                  </label>
                  <input
                    id={`${idPrefix}-author-name-${key}`}
                    type="text"
                    maxLength={120}
                    value={author.name}
                    disabled={busy}
                    onChange={(event) => setAuthor(key, { name: event.target.value })}
                    className={fieldClass}
                  />
                </div>
              )}
              <button
                type="button"
                aria-label={`Remove author ${index + 1}`}
                disabled={busy || authors.length === 1}
                onClick={() =>
                  setAuthors((current) => current.filter((row) => row.key !== key))
                }
                className="btn btn-outline btn-sm"
              >
                REMOVE
              </button>
            </div>
          )
        })}
        <button
          type="button"
          disabled={busy || authors.length >= 20}
          onClick={() =>
            setAuthors((current) => [
              ...current,
              { key: draftKey(), author: { userId: '' } },
            ])
          }
          className="cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] text-faint hover:text-primary disabled:opacity-50"
        >
          + ADD ANOTHER AUTHOR
        </button>
        {authorProblem && (
          <p role="status" className="text-[12px] text-error">
            {authorProblem}
          </p>
        )}
      </fieldset>

      {withFile && (
        <div>
          <label className={labelClass} htmlFor={`${idPrefix}-file`}>
            THE FILE — PDF OR DOCX
          </label>
          <input
            id={`${idPrefix}-file`}
            type="file"
            accept={ACCEPTED}
            disabled={busy}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null)
            }}
            className="file-input w-full border-rule bg-base-200 text-sm"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <button
          type="button"
          disabled={busy || values.title.trim() === '' || authorProblem !== null}
          onClick={() => {
            onSubmit(
              { ...values, authors: authors.map((row) => row.author) },
              file ?? undefined,
            )
          }}
          className="cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] text-primary underline-offset-2 transition-colors duration-200 hover:underline disabled:cursor-default disabled:opacity-50 disabled:hover:no-underline"
        >
          {submitLabel}
        </button>

        {onCancel && (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] text-faint transition-colors duration-200 hover:text-primary disabled:opacity-50"
          >
            CANCEL
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * The two formats, as the file picker's filter and as a check before the save.
 *
 * Checked here as well as on the server, for the reason the print form checks its own: a wrong
 * file should say so instantly rather than after fifteen megabytes have gone up the wire. The
 * server is what actually refuses — the `accept` attribute is a suggestion a person can override.
 */
const ACCEPTED = '.pdf,.docx'

/**
 * `MAX_DOCUMENT_FILE_MB` in `server/src/core/env.ts`, which is what the route's `bodyLimit` is
 * built from. Mirrored rather than fetched because the refusal has to happen at the moment of
 * choosing: "that one is too big" is a useless thing to learn about a file chosen ten minutes and
 * four sections ago.
 */
const MAX_FILE_MB = 15

/** The complaint about the format, or null when there is none. */
function wrongFormat(file: File): string | null {
  const name = file.name.toLowerCase()

  return name.endsWith('.pdf') || name.endsWith('.docx')
    ? null
    : 'The page takes PDF and DOCX files. That one is something else.'
}

/** The complaint about the size, or null when there is none. */
function tooBig(file: File): string | null {
  return file.size > MAX_FILE_MB * 1024 * 1024
    ? `That one is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the cap is ${MAX_FILE_MB} MB.`
    : null
}
