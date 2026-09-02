import { useEffect, useId, useState } from 'react'
import { DocumentsEditor } from './DocumentsEditor'
import { DraftGallery } from './DraftGallery'
import { LinkRows } from './LinkRows'
import { Status } from '../shared/Status'
import { TeamEditor } from './TeamEditor'
import { TitleSection } from './TitleSection'
import { refreshProjectListing } from '../../lib/projects/projectListing'
import { useProjectRoster } from '../../lib/projects/useProjectRoster'
import { fieldClass, labelClass, secondaryClass, submitClass } from '../shared/formChrome'
import { patchJson } from '../../lib/api/api'
import type { ApiProjectDetail, ApiProjectLink } from '../../lib/api/api'
import {
  draftFromImage,
  galleryDirty,
  releaseDraftImage,
  saveGallery,
  usableLinks,
  type DraftImage,
  type DraftLink,
} from '../../lib/projects/projectDraft'
import {
  useEditorSaves,
  useSectionSave,
  type SaveRegistry,
  type SaveSection,
} from '../../lib/projects/editorSaves'

/**
 * The public page, editable in place.
 *
 * It draws the same sections in the same order under the same eyebrows as the
 * read view, each one swapped for its form — so the page does not rearrange
 * itself when somebody presses EDIT PAGE, it just becomes typeable.
 *
 * **One button, and nothing goes anywhere without it.** This page used to save
 * three different ways at once: the writing and the links waited for a SAVE at
 * the foot of it, the title and its cover waited for a *second* SAVE at the top
 * of it, and pictures, documents and member titles went up the moment they were
 * touched. Each of those had a reason — an upload owns bytes and a failure worth
 * seeing at once; a textarea autosaved is a half-written sentence published — and
 * the sum of the reasons was a page that published some of what you did while you
 * were still deciding, under a button that claimed to be the thing that saved.
 *
 * So every section keeps a draft and hands its writes up to `useEditorSaves`,
 * which runs them in order behind the one SAVE below. The costs are real and
 * accepted: a file's size is refused when it is chosen rather than when it is
 * sent (`downscaleImage`, `tooBig`), and a save is a handful of requests that can
 * fail halfway — so what landed is applied and the section that did not is named,
 * and pressing SAVE again sends only the rest.
 *
 * Nothing here re-reads the whole project afterwards. Every write route answers
 * with the row or the list it wrote, and that is what lands in state — partly
 * because it is one round trip instead of two, and mostly because
 * `/projects/:slug` is a *cached* public route, so a read taken straight after a
 * write can honestly answer with the copy from before it.
 */

/**
 * The order the writes go out in, and what the status line calls each one.
 *
 * The title goes first because it carries the cover upload, which is the write
 * most likely to be refused for its size — better to find that out before four
 * other sections have already gone. Module-level so the array's identity is
 * stable; it is a dependency of the save.
 */
const SECTIONS: readonly SaveSection[] = [
  { name: 'title', label: 'The title' },
  { name: 'writing', label: 'The writing' },
  { name: 'gallery', label: 'The gallery' },
  { name: 'documents', label: 'The documentation' },
  { name: 'team', label: 'The team' },
]

export function ProjectEditor({
  project,
  asOfficer,
  me,
  apply,
  onDone,
  onDirtyChange,
  doneLabel = 'DONE EDITING',
  writingFirst = false,
}: {
  project: ApiProjectDetail
  asOfficer: boolean
  /**
   * Whoever is doing the editing. Only the documentation section wants it —
   * a credit has to start on somebody — and it is threaded through rather than
   * read from the session there, so this component keeps working anywhere a
   * project can be handed to it.
   */
  me?: { id: string; fullName: string }
  apply: (project: ApiProjectDetail) => void
  onDone: () => void
  /**
   * Reported upward because the page around this one wants to know: leaving
   * without saving now loses pictures and documents as well as prose, which is
   * what the guard on the way out asks about.
   */
  onDirtyChange?: (dirty: boolean) => void
  doneLabel?: string
  /**
   * Which section comes first. The public page wants the gallery there, because
   * that is the order the page itself reads in. The officer desk wants the
   * writing, because the fields directly above it a moment ago were the create
   * form's — and the whole point of that panel is that nothing jumps when the
   * project comes into existence halfway down it.
   */
  writingFirst?: boolean
}) {
  const { registry, dirty, blocked, busy, saved, message, save } = useEditorSaves(
    SECTIONS,
    project,
    apply,
  )

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  /**
   * One roster read for the whole editor, rather than one per section that wants
   * it. The public payload carries no user ids on purpose, and both the credit
   * picker and the team section write by id.
   */
  const [roster, setRoster] = useProjectRoster(project.id)

  /**
   * The gallery draft, held here rather than in the section that draws it.
   *
   * The cover can be the gallery's first picture, and the title section is at the
   * top of the page while the gallery is halfway down it — one list, read by
   * both, is what stops the cover preview showing yesterday's first photo while a
   * new one sits unsaved below.
   */
  const [images, setImages] = useState<DraftImage[]>(() =>
    project.images.map(draftFromImage),
  )

  useSectionSave(registry, 'gallery', {
    dirty: galleryDirty(project.images, images),
    save: async () => {
      const written = await saveGallery(project.id, project.images, images)
      // The previews are stored rows now, and an object URL pins the whole file
      // until it is revoked. `DraftGallery` only hands them back on unmount, and
      // this component does not unmount on a save.
      images.forEach(releaseDraftImage)
      setImages(written.map(draftFromImage))
      return { images: written }
    },
  })

  const titleSection = (
    <TitleSection
      key="title"
      project={project}
      images={images}
      registry={registry}
      busy={busy}
    />
  )
  const gallery = (
    <DraftGallery
      key="gallery"
      images={images}
      disabled={busy}
      onChange={setImages}
      heading={project.galleryHeading ?? 'GALLERY'}
    />
  )
  const writing = (
    <ProseAndLinks
      key="writing"
      project={project}
      registry={registry}
      busy={busy}
    />
  )
  const documents = (
    <DocumentsEditor
      key="documents"
      project={project}
      me={me}
      roster={roster}
      registry={registry}
      busy={busy}
    />
  )
  const team = (
    <TeamEditor
      key="team"
      project={project}
      roster={roster}
      onRoster={(members) => {
        setRoster((current) => ({ ...current, members }))
      }}
      heading={project.teamHeading ?? 'THE TEAM'}
      registry={registry}
      busy={busy}
    />
  )

  return (
    <div className="space-y-10">
      {asOfficer && (
        /* An officer wandering into somebody else's project should know in
           which capacity they are about to change it. */
        <p className="text-faint border-rule bg-base-200 border px-4 py-2.5 font-mono text-[10px] font-medium tracking-[0.14em]">
          EDITING AS AN OFFICER — YOU DO NOT LEAD THIS PROJECT
        </p>
      )}

      {/* The title section is always first, because it is the top of the page
          it edits and because the two things on it — the cover and the summary —
          are the whole of what a stranger sees before deciding to open the
          project at all. The team section is last because that is where the
          public page puts it, and because it is the only section about people
          rather than about the page.

          The order in between used to be load-bearing: the writing had to come
          last because it held the only SAVE, and anything below it would have
          read as being covered by a button that did not cover it. That is over —
          one button at the foot of the page covers all five — so this is now the
          order the page reads in and nothing more. */}
      {writingFirst
        ? [titleSection, writing, gallery, documents, team]
        : [titleSection, gallery, documents, writing, team]}

      {/* The one button, and the way out directly beneath it. Gold above,
          outline below: two gold buttons would be neither one's primary action,
          and the ordering says which is the finishing move and which is the
          leaving one. */}
      <div className="border-rule space-y-3 border-t pt-6">
        <button
          type="button"
          onClick={() => {
            // The listing is warmed on the way out of a *clean* save, and only
            // then. `/projects` is a publicly cached read — sixty seconds in the
            // browser, and `stale-while-revalidate` on top of that — so the one
            // person for whom the cached copy is wrong is the one who just
            // changed it, and they are about to go and look at it.
            void save().then((clean) => {
              if (clean) void refreshProjectListing()
            })
          }}
          disabled={busy || blocked !== null}
          className={submitClass}
        >
          {busy ? 'SAVING…' : 'SAVE'}
        </button>

        <button
          type="button"
          onClick={onDone}
          disabled={busy}
          className={`${secondaryClass} w-full`}
        >
          {doneLabel}
        </button>

        <Status message={message} />
        {message === '' && blocked !== null && (
          <p role="status" className="text-warning mt-2 min-h-4 text-[12px]">
            {blocked}
          </p>
        )}
        {message === '' && blocked === null && saved && !dirty && (
          <Status message="Saved." tone="ok" />
        )}
        {message === '' && blocked === null && dirty && (
          <p role="status" className="text-warning mt-2 min-h-4 text-[12px]">
            Unsaved changes — nothing above has gone to the site yet.
          </p>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------- the writing and links

function ProseAndLinks({
  project,
  registry,
  busy,
}: {
  project: ApiProjectDetail
  registry: SaveRegistry
  busy: boolean
}) {
  const id = useId()

  const [season, setSeason] = useState(project.season ?? '')
  const [competition, setCompetition] = useState(project.competition ?? '')
  const [description, setDescription] = useState(project.description ?? '')
  const [links, setLinks] = useState<DraftLink[]>(
    project.links.map((link) => ({ ...link })),
  )

  /**
   * Compared against the project itself rather than a remembered baseline,
   * because what the save returns is written back into it — so afterwards the
   * two agree by construction, and there is no second copy to keep in step.
   */
  const dirty =
    season !== (project.season ?? '') ||
    competition !== (project.competition ?? '') ||
    description !== (project.description ?? '') ||
    links.length !== project.links.length ||
    links.some(
      (link, index) =>
        link.label !== project.links[index]?.label ||
        link.url !== project.links[index]?.url,
    )

  useSectionSave(registry, 'writing', {
    dirty,
    save: async () => {
      // Blank fields clear the column rather than storing an empty string —
      // `season === ''` and `season === null` would otherwise both exist and
      // render identically, which is a difference nobody can see and every
      // query has to handle.
      const patched = await patchJson<{
        season: string | null
        competition: string | null
        description: string | null
      }>(`/projects/${project.id}`, {
        season: season.trim() || null,
        competition: competition.trim() || null,
        description: description.trim() || null,
      })

      const savedLinks = await patchJson<ApiProjectLink[]>(
        `/projects/${project.id}/links`,
        { links: usableLinks(links) },
      )

      setLinks(savedLinks.map((link) => ({ ...link })))

      return {
        season: patched.season,
        competition: patched.competition,
        description: patched.description,
        links: savedLinks,
      }
    },
  })

  return (
    <section>
      <p className="text-faint mb-4 font-mono text-[13px] font-bold tracking-[0.2em]">
        / THE WRITING
      </p>

      <div className="space-y-4">
        {/* The title and the summary used to be here and are the title
            section's now — they are what the projects list prints beside the
            cover, and the three belong together on the form for the same reason
            they belong together on the card. */}

        {/* Set when the project is created and never editable afterwards until
            now, which meant a season rolling over was a job for Prisma Studio.
            They print in the mono line under the title on the public page. */}
        <div className="grid gap-4 wide:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor={`${id}-season`}>
              SEASON
            </label>
            <input
              id={`${id}-season`}
              type="text"
              value={season}
              maxLength={40}
              placeholder="2026-2027"
              disabled={busy}
              onChange={(event) => {
                setSeason(event.target.value)
              }}
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor={`${id}-competition`}>
              COMPETITION
            </label>
            <input
              id={`${id}-competition`}
              type="text"
              value={competition}
              maxLength={160}
              placeholder="UNIVERSITY ROVER CHALLENGE"
              disabled={busy}
              onChange={(event) => {
                setCompetition(event.target.value)
              }}
              className={fieldClass}
            />
            {/* Said out loud because the placeholder reads as an example to
                follow rather than as one option, and plenty of what the club
                builds is not entered into anything. The column is nullable and
                both this page and the projects list drop the segment when it is
                empty, so a blank box is a finished answer rather than a gap. */}
            <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
              Optional.
            </p>
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor={`${id}-description`}>
            DESCRIPTION
          </label>
          <textarea
            id={`${id}-description`}
            value={description}
            maxLength={20_000}
            rows={10}
            disabled={busy}
            onChange={(event) => {
              setDescription(event.target.value)
            }}
            className="textarea border-rule bg-base-200 w-full text-sm"
          />
          <p className="mt-1.5 text-[11px] leading-[1.5] text-faint">
            The long form, on this project&rsquo;s own page. Markdown:{' '}
            <code>#</code> for a heading, <code>-</code> for a list,{' '}
            <code>**bold**</code>, <code>[text](link)</code>. Leave a blank line
            between paragraphs.
          </p>
        </div>
      </div>

      <p className="mt-8 mb-4 font-mono text-[13px] font-bold tracking-[0.2em] text-faint uppercase">
        / {project.resourcesHeading ?? 'RESOURCES'}
      </p>

      {/* **There is no SOURCE CODE box here any more, and that is the point.**
          `repoUrl` was a column of its own and drew a fixed field above this
          list, so every project was asked for a repository and most of what the
          club builds does not have one — an empty box nobody could remove. It is
          an ordinary row now, and this section is genuinely blank until somebody
          adds something. */}
      <div className="space-y-4">
        {/* The same rows the create page collects links in, so the two states
            of that page cannot drift apart. */}
        <LinkRows
          links={links}
          disabled={busy}
          onChange={setLinks}
        />
        <p className="text-[11px] leading-[1.5] text-pretty text-faint">
          Anything this project points at — the design doc, the CAD, the rules, the
          repository. Leave it empty if there is nothing to link.
        </p>
      </div>
    </section>
  )
}
