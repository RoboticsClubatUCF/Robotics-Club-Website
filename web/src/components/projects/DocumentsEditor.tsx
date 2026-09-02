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
  type DraftDocument,
} from '../../lib/projects/projectDocuments'
import { useSectionSave, type SaveRegistry } from '../../lib/projects/editorSaves'
import type { ProjectRoster } from '../../lib/projects/useProjectRoster'

/** Somebody this project can credit: a member, or the officer editing it. */
type Person = { userId: string; fullName: string }

/**
 * The `/ DOCUMENTATION` section of the project editor.
 *
 * **Nothing here is published until the page is saved**, which is the opposite
 * of what this section used to do: ADD sent the file, EDIT DETAILS wrote on the
 * spot, and REMOVE deleted bytes — none of it touched by the SAVE at the foot of
 * the page. The argument for that was that every action here owns bytes and
 * therefore owns a failure worth seeing immediately. The argument against it won:
 * a section that published a document a lead had not finished thinking about,
 * from a page whose button said SAVE, was the surprise this editor kept handing
 * people.
 *
 * What that costs is the size refusal, which now arrives at save time rather than
 * at the moment of choosing. `tooBig` and `wrongFormat` below are the answer —
 * both are checked in the browser first, so the server should have nothing left
 * to say by the time it is asked.
 *
 * **ADD still validates, and that is why nothing else has to.** A row only joins
 * the list once it has a title, a credit and a file, so every draft row is
 * sendable and the page's SAVE is never blocked on this section.
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
   * **This section used to fetch it itself, deferred until a form opened**, on
   * the grounds that most visits to the editor are somebody fixing a sentence
   * and should not pay for a roster nobody reads. That was right while this was
   * the only consumer; the team section beside it cannot draw a single row
   * without the same list, so deferring here now only means asking twice.
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
   * The roster, plus whoever is editing if they are not on it.
   *
   * That second half is the officer case: an officer may edit any project
   * without being a member of it, and the server credits them to themselves
   * happily — so leaving them out would make them the one person who cannot be
   * named as the author of the thing they just wrote.
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
                    {row.stored.authorName} · {row.stored.fileName} · UPLOADED{' '}
                    {longDate(row.stored.uploadedAt)}
                    {row.stored.updatedAt !== row.stored.uploadedAt && (
                      <> · UPDATED {longDate(row.stored.updatedAt)}</>
                    )}
                  </>
                ) : (
                  <>
                    {nameOf(people, row.authorUserId)} · {row.file?.name} · NOT
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
                    authorUserId: row.authorUserId,
                  }}
                  // The credit already on the row. Passing the *name* rather
                  // than an id is not a shortcut: the public payload carries no
                  // user ids, on purpose, so "unchanged" is the only honest
                  // starting value and this is what it is labelled with.
                  currentAuthor={row.stored?.authorName}
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
            initial={{ title: '', description: '', authorUserId: '' }}
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
                { ...blankDocument(values.authorUserId), ...values, file },
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

type Values = { title: string; description: string; authorUserId: string }

/** Whoever a draft row is credited to, for the line under an unpublished one. */
const nameOf = (people: Person[], userId: string) =>
  people.find((person) => person.userId === userId)?.fullName ?? 'Unattributed'

/**
 * Title, blurb, credit — and, when adding, the file.
 *
 * One component for both because a document being edited and a document being
 * written have exactly the same fields, and two copies is how the credit box
 * ends up on one of them.
 *
 * `currentAuthor` is what tells the two apart. A new document has to choose
 * somebody, and defaults to whoever is signed in; an existing one starts on
 * "leave the credit alone", spelled with the existing author's name so the select
 * is not lying about what it will do. That option's value is empty, and the
 * caller reads that as "send no `authorUserId`".
 */
function DocumentFields({
  idPrefix,
  people,
  defaultAuthorId,
  busy,
  initial,
  currentAuthor,
  submitLabel,
  withFile = false,
  onSubmit,
  onCancel,
}: {
  idPrefix: string
  people: Person[]
  /**
   * Who the credit starts on for a new document — whoever is signed in. Passed
   * down rather than picked out of `people` here, because "me" is not a
   * position in that list: a lead is usually near the top of their own roster
   * and an officer is appended to the end of it.
   */
  defaultAuthorId: string
  busy: boolean
  initial: Values
  /** The credit already on the row, when there is one. Editing, not adding. */
  currentAuthor?: string
  submitLabel: string
  withFile?: boolean
  onSubmit: (values: Values, file?: File) => void
  onCancel?: () => void
}) {
  const [values, setValues] = useState(initial)
  const [file, setFile] = useState<File | null>(null)

  const set = (patch: Partial<Values>) => {
    setValues((current) => ({ ...current, ...patch }))
  }

  /**
   * Editing starts on "leave it alone"; a new document starts on whoever is
   * signed in, who can always honestly be credited. Naming somebody else is one
   * press of the select either way.
   */
  const fallback = currentAuthor
    ? ''
    : defaultAuthorId || (people[0]?.userId ?? '')
  const author = values.authorUserId || fallback

  // Nothing to choose from yet — the roster read has not landed and nobody is
  // signed in, which in practice means a test. Adding stays disabled rather
  // than sending a credit nobody picked.
  const chooseable = currentAuthor !== undefined || people.length > 0

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

      <div className="grid gap-3 wide:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor={`${idPrefix}-author`}>
            WRITTEN BY
          </label>
          <select
            id={`${idPrefix}-author`}
            value={author}
            disabled={busy || !chooseable}
            onChange={(event) => {
              set({ authorUserId: event.target.value })
            }}
            className="select border-rule bg-base-200 w-full text-sm"
          >
            {currentAuthor !== undefined && (
              <option value="">{currentAuthor} — leave as is</option>
            )}
            {people.map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.fullName}
              </option>
            ))}
          </select>
        </div>

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
              className="file-input border-rule bg-base-200 w-full text-sm"
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <button
          type="button"
          disabled={busy || values.title.trim() === '' || !chooseable}
          onClick={() => {
            onSubmit({ ...values, authorUserId: author }, file ?? undefined)
          }}
          className="text-primary hover:underline cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] underline-offset-2 transition-colors duration-200 disabled:cursor-default disabled:opacity-50 disabled:hover:no-underline"
        >
          {submitLabel}
        </button>

        {onCancel && (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="text-faint hover:text-primary cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50"
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
 * Checked here as well as on the server, for the reason the print form checks
 * its own: a wrong file should say so instantly rather than after fifteen
 * megabytes have gone up the wire. The server is what actually refuses — the
 * `accept` attribute is a suggestion a person can override in the picker, and
 * an extension says nothing about the bytes.
 */
const ACCEPTED = '.pdf,.docx'

/**
 * `MAX_DOCUMENT_FILE_MB` in `server/src/core/env.ts`, which is what the route's
 * `bodyLimit` is built from. Mirrored rather than fetched because the refusal has
 * to happen at the moment of choosing: the upload itself no longer goes until the
 * page is saved, and "that one is too big" is a useless thing to learn about a
 * file chosen ten minutes and four sections ago.
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
