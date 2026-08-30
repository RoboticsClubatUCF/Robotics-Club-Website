import { useEffect, useId, useState } from 'react'
import { Status } from '../shared/Status'
import { useSectionStatus } from '../../lib/useSectionStatus'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { fieldClass, labelClass } from '../shared/formChrome'
import { deleteJson, getJson, patchJson, postForm } from '../../lib/api/api'
import type {
  ApiProjectDetail,
  ApiProjectDocument,
  ApiProjectTeamView,
} from '../../lib/api/api'
import { fileSize, longDate } from '../../lib/format/formats'
import { MAX_PROJECT_DOCUMENTS } from '../../lib/projects/projectGallery'

/** Somebody this project can credit: a member, or the officer editing it. */
type Person = { userId: string; fullName: string }

/**
 * The `/ DOCUMENTATION` section of the project editor.
 *
 * Saves immediately, like the gallery and unlike the prose beside it, for the
 * same reason: every action here owns bytes. An upload can be refused for its
 * size or its format, a revision destroys the version it replaces, and a
 * removal does not come back — all failures worth seeing at the moment of the
 * act rather than a minute later under one SAVE.
 *
 * **Choosing a file is not the upload here, which is the one place this differs
 * from the gallery.** A picture is complete the moment it is picked; a document
 * needs a title and a credit, and uploading before those exist would mean
 * either publishing something called "Rover_FINAL_v3(2).pdf" or holding a live
 * row in an unfinished state. So this section has a real ADD button, and the
 * gallery does not.
 */
export function DocumentsEditor({
  project,
  me,
  apply,
}: {
  project: ApiProjectDetail
  /**
   * Whoever is doing the editing, for the credit to start on. Passed in rather
   * than read from the session context, so this component can be mounted by
   * anything that has a project — including a test — without dragging a
   * provider in behind it.
   */
  me?: { id: string; fullName: string }
  apply: (project: ApiProjectDetail) => void
}) {
  const id = useId()
  const { message, busy, setMessage, run } = useSectionStatus()

  const documents = project.documents
  const full = documents.length >= MAX_PROJECT_DOCUMENTS

  const [roster, setRoster] = useState<Person[]>([])
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [doomed, setDoomed] = useState<ApiProjectDocument | null>(null)

  // Only a form that is actually open needs a list of people to credit.
  const crediting = adding || editing !== null

  /**
   * The people this project can credit.
   *
   * Read here rather than taken from `project.members`, which the public detail
   * route deliberately answers without user ids — a credit is written by id, and
   * widening a public payload so an editor can have one would be paying for it
   * on every anonymous page view. This route wants a membership or an officer's
   * standing, which everybody who can see this section already has.
   *
   * Deferred until a form is open, and that is the point: most visits to the
   * editor are somebody fixing a sentence in the write-up, and none of them
   * should cost a request for a roster nobody is going to look at.
   *
   * A failure is silent on purpose. The picker still offers whoever is signed
   * in, which is the common case anyway, and a red line about a roster nobody
   * asked for would be a strange thing to meet on opening a form.
   */
  useEffect(() => {
    if (!crediting) return

    let live = true

    getJson<ApiProjectTeamView>(`/projects/${project.id}/team`)
      .then((view) => {
        if (live) {
          setRoster(
            view.members.map((member) => ({
              userId: member.userId,
              fullName: member.fullName,
            })),
          )
        }
      })
      .catch((error: unknown) => {
        console.error(error)
      })

    return () => {
      live = false
    }
  }, [project.id, crediting])

  /**
   * The roster, plus whoever is editing if they are not on it.
   *
   * That second half is the officer case: an officer may edit any project
   * without being a member of it, and the server credits them to themselves
   * happily — so leaving them out would make them the one person who cannot be
   * named as the author of the thing they just wrote.
   */
  const people: Person[] =
    me && !roster.some((person) => person.userId === me.id)
      ? [...roster, { userId: me.id, fullName: me.fullName }]
      : roster

  const write = (documents: ApiProjectDocument[]) => {
    apply({ ...project, documents })
  }

  const replaceFile = (document: ApiProjectDocument, file: File) => {
    // Checked before `run`, not inside it: a thrown `Error` would come back out
    // through `explainApiError`, which only keeps the *server's* sentences and
    // flattens everything else into "that change did not go through" — which is
    // the opposite of what this check is for.
    const wrong = wrongFormat(file)
    if (wrong) {
      setMessage(wrong)
      return
    }

    void run(async () => {
      const body = new FormData()
      body.append('file', file)

      const revised = await postForm<ApiProjectDocument>(
        `/projects/${project.id}/documents/${document.id}/file`,
        body,
      )

      write(documents.map((row) => (row.id === revised.id ? revised : row)))
      setMessage('Replaced. The page now shows an updated date.')
    })
  }

  const saveDetails = (document: ApiProjectDocument, patch: Values) =>
    run(async () => {
      const saved = await patchJson<ApiProjectDocument>(
        `/projects/${project.id}/documents/${document.id}`,
        {
          title: patch.title.trim(),
          description: patch.description.trim() || null,
          // Empty means "leave the credit alone", which is what the select's
          // first option says out loud. The route treats an absent field the
          // same way, so sending nothing is the honest way to say it.
          ...(patch.authorUserId ? { authorUserId: patch.authorUserId } : {}),
        },
      )

      write(documents.map((row) => (row.id === saved.id ? saved : row)))
      setEditing(null)
      setMessage('Saved.')
    })

  const remove = (document: ApiProjectDocument) =>
    run(async () => {
      await deleteJson(`/projects/${project.id}/documents/${document.id}`)
      write(documents.filter((row) => row.id !== document.id))
      setDoomed(null)
    })

  return (
    <section>
      <p className="text-faint mb-4 font-mono text-[13px] font-bold tracking-[0.2em]">
        / DOCUMENTATION
      </p>

      <p className="text-faint mb-4 text-[12px] leading-[1.6] text-pretty">
        PDFs and Word documents, on a page of their own, reached from the{' '}
        <span className="font-mono tracking-[0.06em]">/ RESOURCES</span> list on
        the project page. Anyone can read them.
      </p>

      {documents.length === 0 ? (
        <p className="text-faint border-rule border-t py-5 text-sm">
          Nothing published yet.
        </p>
      ) : (
        <ul className="border-rule divide-rule divide-y border">
          {documents.map((document) => (
            <li key={document.id} className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-sm font-medium">{document.title}</span>
                <span className="text-faint font-mono text-[10px] font-medium tracking-[0.14em]">
                  {fileSize(document.fileSize)}
                </span>
              </div>

              <p className="text-faint mt-1 font-mono text-[11px] leading-[1.7] tracking-[0.06em]">
                {document.authorName} · {document.fileName} · UPLOADED{' '}
                {longDate(document.uploadedAt)}
                {document.updatedAt !== document.uploadedAt && (
                  <> · UPDATED {longDate(document.updatedAt)}</>
                )}
              </p>

              {editing === document.id ? (
                <DocumentFields
                  idPrefix={`${id}-edit-${document.id}`}
                  people={people}
                  busy={busy}
                  initial={{
                    title: document.title,
                    description: document.description ?? '',
                    authorUserId: '',
                  }}
                  // The credit already on the row. Passing the *name* rather
                  // than an id is not a shortcut: the public payload carries no
                  // user ids, on purpose, so "unchanged" is the only honest
                  // starting value and this is what it is labelled with.
                  currentAuthor={document.authorName}
                  defaultAuthorId={me?.id ?? ''}
                  submitLabel="SAVE"
                  onCancel={() => {
                    setEditing(null)
                  }}
                  onSubmit={(values) => void saveDetails(document, values)}
                />
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditing(document.id)
                      setMessage('')
                    }}
                    className="text-faint hover:text-primary cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50"
                  >
                    EDIT DETAILS
                  </button>

                  <label
                    htmlFor={`${id}-replace-${document.id}`}
                    aria-disabled={busy}
                    className={`text-faint hover:text-primary cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 ${
                      busy ? 'pointer-events-none opacity-50' : ''
                    }`}
                  >
                    REPLACE THE FILE
                  </label>
                  <input
                    id={`${id}-replace-${document.id}`}
                    type="file"
                    accept={ACCEPTED}
                    disabled={busy}
                    onChange={(event) => {
                      const chosen = event.target.files?.[0]
                      // Cleared before the upload rather than after, so picking
                      // the same file again after a failure still fires.
                      event.target.value = ''
                      if (chosen) replaceFile(document, chosen)
                    }}
                    className="sr-only"
                  />

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setDoomed(document)
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
            PUBLISH A DOCUMENT
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
              // Both of these are said here rather than thrown, for the reason
              // the replacement above is: `explainApiError` keeps the server's
              // sentences and flattens everybody else's.
              if (!file) {
                setMessage('Choose the file first.')
                return
              }

              const wrong = wrongFormat(file)
              if (wrong) {
                setMessage(wrong)
                return
              }

              void run(async () => {
                const body = new FormData()
                body.append('file', file)
                body.append('title', values.title.trim())
                body.append('description', values.description.trim())
                body.append('authorUserId', values.authorUserId)

                const added = await postForm<ApiProjectDocument>(
                  `/projects/${project.id}/documents`,
                  body,
                )

                write([...documents, added])
                setAdding(false)
                setMessage('Published.')
              })
            }}
          />
        </div>
      )}

      {/* Closed until it is wanted, the way `+ ADD A LINK` is. It also keeps
          the roster read below the fold: opening this is what asks the server
          who may be credited, so somebody who came here to fix a typo in the
          write-up never pays for it. */}
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
          + PUBLISH A DOCUMENT
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
          title={`Remove “${doomed.title}”?`}
          confirmLabel="REMOVE IT"
          busy={busy}
          onConfirm={() => void remove(doomed)}
          onDismiss={() => {
            setDoomed(null)
          }}
        >
          <p>
            The file is deleted with it, and the club keeps no other copy. If
            this is a new version rather than a mistake, REPLACE THE FILE keeps
            the page and its history instead.
          </p>
        </ConfirmDialog>
      )}
    </section>
  )
}

type Values = { title: string; description: string; authorUserId: string }

/**
 * Title, blurb, credit — and, when publishing, the file.
 *
 * One component for both because a document being edited and a document being
 * written have exactly the same fields, and two copies is how the credit box
 * ends up on one of them.
 *
 * `currentAuthor` is what tells the two apart. Publishing has to choose
 * somebody, and defaults to whoever is signed in; editing starts on "leave the
 * credit alone", spelled with the existing author's name so the select is not
 * lying about what it will do. That option's value is empty, and the caller
 * reads that as "send no `authorUserId`".
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
   * Who the credit starts on when publishing — whoever is signed in. Passed
   * down rather than picked out of `people` here, because "me" is not a
   * position in that list: a lead is usually near the top of their own roster
   * and an officer is appended to the end of it.
   */
  defaultAuthorId: string
  busy: boolean
  initial: Values
  /** The credit already on the row, when there is one. Editing, not publishing. */
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
   * Editing starts on "leave it alone"; publishing starts on whoever is signed
   * in, who can always honestly be credited. Naming somebody else is one press
   * of the select either way.
   */
  const fallback = currentAuthor
    ? ''
    : defaultAuthorId || (people[0]?.userId ?? '')
  const author = values.authorUserId || fallback

  // Nothing to choose from yet — the roster read has not landed and nobody is
  // signed in, which in practice means a test. Publishing stays disabled rather
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
          {busy ? 'WORKING…' : submitLabel}
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
 * The two formats, as the file picker's filter and as a check before the
 * upload.
 *
 * Checked here as well as on the server, for the reason the print form checks
 * its own: a wrong file should say so instantly rather than after fifteen
 * megabytes have gone up the wire. The server is what actually refuses — the
 * `accept` attribute is a suggestion a person can override in the picker, and
 * an extension says nothing about the bytes.
 */
const ACCEPTED = '.pdf,.docx'

/** The complaint, or null when there is none. */
function wrongFormat(file: File): string | null {
  const name = file.name.toLowerCase()

  return name.endsWith('.pdf') || name.endsWith('.docx')
    ? null
    : 'The page takes PDF and DOCX files. That one is something else.'
}
