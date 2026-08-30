import { Link, useParams, useSearchParams } from 'react-router'
import { FormEyebrow, FormHeading, FormPanel } from '../../components/shared/formChrome'
import type { ApiProjectDetail, ApiProjectDocument } from '../../lib/api/api'
import { fileSize, longDate } from '../../lib/format/formats'
import { storedFileDownloadUrl, storedFileUrl } from '../../lib/media/storedFiles'
import { useApi } from '../../lib/api/useApi'

/**
 * `/projects/:slug/docs` — everything a project has written down.
 *
 * Public, like the project page it hangs off: somebody deciding whether to join
 * the rover team should be able to read the design review, and a competition
 * judge asking for documentation should get a link rather than a Drive invite.
 * Nothing here is a permission boundary; the uploads are, and they live behind
 * `requireProjectLead` on the server.
 *
 * `useApi` rather than the bespoke loader `ProjectPage` carries. That one
 * exists to *refetch* after an edit, and nothing on this page edits anything —
 * documents are managed in the project's own editor, one route up.
 *
 * It reads the whole project rather than a documents endpoint of its own,
 * because there is no documents endpoint of its own: the list rides on
 * `GET /projects/:slug` so the project page can draw the `/ RESOURCES` row that
 * leads here without a second request. See `routes/public/content.ts`.
 */
export function ProjectDocsPage() {
  const { slug = '' } = useParams()
  const state = useApi<ApiProjectDetail>(`/projects/${slug}`)

  return (
    <section className="px-page py-14 wide:py-20">
      {/* Wider than the project page's 46rem. That one is a column of prose;
          this is an index beside a document, and a PDF squeezed into a reading
          measure is a PDF nobody reads on this page. */}
      <div className="mx-auto w-full max-w-[72rem]">
        <Link
          to={`/projects/${slug}`}
          className="text-faint hover:text-primary mb-8 inline-block font-mono text-[11px] font-medium tracking-[0.14em] transition-colors duration-200"
        >
          ‹ BACK TO THE PROJECT
        </Link>

        {state.status === 'loading' && <DocsSkeleton />}

        {state.status === 'error' && (
          <>
            <FormEyebrow>/ DOCUMENTATION</FormEyebrow>
            <FormHeading>
              {state.code === 404
                ? 'There is no project here.'
                : "We can't reach the server."}
            </FormHeading>
            <FormPanel tone={state.code === 404 ? 'plain' : 'accent'}>
              <p className="text-dim text-sm leading-[1.7] text-pretty">
                {state.code === 404
                  ? 'Either the link is wrong or the project has been taken down.'
                  : "This page couldn't load it. Try again in a moment."}
              </p>
            </FormPanel>
          </>
        )}

        {state.status === 'ready' && <Docs project={state.data} />}
      </div>
    </section>
  )
}

function Docs({ project }: { project: ApiProjectDetail }) {
  /**
   * Which document is open lives in the URL, not in state.
   *
   * A lead saying "read section 4 of the test plan" wants to send an address
   * that opens on the test plan, and this page's whole job is being that
   * address. It is the same reason the signup and dues links carry their
   * parameters rather than being reconstructed on arrival.
   */
  const [params, setParams] = useSearchParams()
  const asked = params.get('doc')

  const documents = project.documents
  // A `?doc=` naming something that has been withdrawn falls back to the first
  // rather than rendering an empty frame — the link was right when it was sent.
  const open = documents.find((document) => document.id === asked) ?? documents[0]

  return (
    <>
      <FormEyebrow>/ DOCUMENTATION</FormEyebrow>
      <FormHeading>{project.title}</FormHeading>

      {documents.length === 0 ? (
        <FormPanel>
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            This project has not published anything yet. Its leads can add
            documents from the project page.
          </p>
        </FormPanel>
      ) : (
        <div className="grid gap-8 wide:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] wide:items-start wide:gap-10">
          <div>
            <p className="text-faint mb-4 font-mono text-[13px] font-bold tracking-[0.2em]">
              / {documents.length} {documents.length === 1 ? 'DOCUMENT' : 'DOCUMENTS'}
            </p>

            <ul className="border-rule divide-rule divide-y border">
              {documents.map((document) => (
                <li key={document.id}>
                  <button
                    type="button"
                    aria-current={document.id === open?.id}
                    onClick={() => {
                      // `replace` so a reader clicking down a list of eight
                      // documents does not leave eight entries behind them in
                      // the back button.
                      setParams({ doc: document.id }, { replace: true })
                    }}
                    className={`hover:bg-wash w-full cursor-pointer px-4 py-3.5 text-left transition-colors duration-200 ${
                      document.id === open?.id ? 'bg-wash' : ''
                    }`}
                  >
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="text-sm font-medium">{document.title}</span>
                      <span className="text-faint font-mono text-[10px] font-medium tracking-[0.14em]">
                        {formatOf(document.fileName)}
                      </span>
                    </span>

                    <span className="text-faint mt-1 block font-mono text-[11px] tracking-[0.06em]">
                      {document.authorName} · {fileSize(document.fileSize)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {open && <Viewer document={open} />}
        </div>
      )}
    </>
  )
}

/**
 * One document, as far as a browser can show it.
 *
 * A PDF renders in place through the browser's own viewer — the server sends it
 * `inline` and sandboxed for exactly this. Everything else is a download, and
 * says so rather than showing an empty frame: nothing renders a Word file
 * without a converter, and adding one to serve a format Word opens perfectly
 * well is a lot of machinery for a worse result.
 *
 * **Opening and saving are two buttons, deliberately.** One link that renders a
 * PDF and downloads a DOCX is one control doing two different things depending
 * on a file extension the reader cannot see, and the failure mode is the worst
 * kind: a click that silently puts a file in somebody's downloads folder when
 * they wanted to read it. So the actions are named, and the one that saves says
 * so — see `storedFileDownloadUrl`, which is the only way to force it across
 * origins.
 */
function Viewer({ document }: { document: ApiProjectDocument }) {
  const href = storedFileUrl(document.fileId)
  const revised = document.updatedAt !== document.uploadedAt
  const pdf = isPdf(document.fileName)

  /**
   * PDF open parameters, and both of them earn their place.
   *
   * `view=FitH` fits the page to the frame's width — without it the viewer opens
   * at 100% and a letter-size page is cropped to whatever this column happens to
   * be. `navpanes=0` closes the thumbnail sidebar, which otherwise takes about
   * two fifths of an already narrow frame to show one thumbnail of one page.
   * They are hints: a viewer that does not understand them ignores them.
   */
  const framed = `${href}#view=FitH&navpanes=0`

  return (
    <div>
      <div className="border-rule border">
        <div className="border-rule border-b p-5">
          <h2 className="text-base font-semibold text-pretty">{document.title}</h2>

          {document.description && (
            <p className="text-dim mt-2 text-sm leading-[1.7] text-pretty">
              {document.description}
            </p>
          )}

          <p className="text-faint mt-3 font-mono text-[11px] leading-[1.7] tracking-[0.06em]">
            {document.authorName} · {formatOf(document.fileName)} ·{' '}
            {fileSize(document.fileSize)}
          </p>
          <p className="text-faint font-mono text-[11px] leading-[1.7] tracking-[0.06em]">
            UPLOADED {longDate(document.uploadedAt)}
            {/* Only when the file has actually been replaced. The two columns
                are equal until then, which is deliberate — see the model. */}
            {revised && <> · UPDATED {longDate(document.updatedAt)}</>}
          </p>

          <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] font-medium tracking-[0.14em]">
            {/* No "open" for a Word file: there is nothing on the other side of
                it but the same download, under a word that promises otherwise. */}
            {pdf && (
              <a
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary hover:underline underline-offset-2"
              >
                OPEN IN A NEW TAB ↗
              </a>
            )}
            <a
              href={storedFileDownloadUrl(document.fileId)}
              className="text-primary hover:underline underline-offset-2"
            >
              DOWNLOAD ↓
            </a>
          </p>
        </div>

        {pdf ? (
          <>
            {/* Tall enough to read a page of A4 at the width this column gets,
                and a fixed height rather than an aspect ratio because the useful
                thing about a PDF frame is how much of the page fits, not its
                proportions. */}
            <iframe
              src={framed}
              title={document.title}
              className="block h-[78vh] max-h-[60rem] min-h-[26rem] w-full"
            />
            {/* Some browsers are set to save PDFs rather than display them, and
                in those the frame above is simply blank. Saying where the file
                is costs one line and is the difference between "this page is
                broken" and "this browser does it differently". */}
            <p className="text-faint border-rule border-t px-5 py-3 text-[11px] leading-[1.6]">
              No preview? Some browsers are set to save PDFs instead of showing
              them — the two links above still work.
            </p>
          </>
        ) : (
          <div className="p-5">
            <p className="text-dim text-sm leading-[1.7] text-pretty">
              No browser can display a Word document, so this one has to be
              opened in Word — or whatever you write in. DOWNLOAD saves it.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

const isPdf = (fileName: string) => fileName.toLowerCase().endsWith('.pdf')

/**
 * The format chip: the extension, upper-cased, or nothing at all for a name
 * that has none. Total, because these names came out of a database and a
 * document uploaded before this page existed must not throw inside a map.
 */
function formatOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? '' : fileName.slice(dot + 1).toUpperCase()
}

/** Sized to the index and the frame, so nothing jumps when the read lands. */
function DocsSkeleton() {
  return (
    <div aria-busy="true">
      <div className="bg-base-200 mb-5 h-4 w-40" />
      <div className="bg-base-200 mb-8 h-9 w-72" />
      <div className="grid gap-8 wide:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] wide:gap-10">
        <div className="border-rule bg-base-200 h-48 border" />
        <div className="border-rule bg-base-200 h-96 border" />
      </div>
    </div>
  )
}
