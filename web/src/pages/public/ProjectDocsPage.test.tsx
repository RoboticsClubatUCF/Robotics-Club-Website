import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectDocsPage } from './ProjectDocsPage'
import type { ApiProjectDetail, ApiProjectDocument } from '../../lib/api/api'
import { stubFetch, stubFetchStatus } from '../../test/stubFetch'

const document = (
  over: Partial<ApiProjectDocument> = {},
): ApiProjectDocument => ({
  id: 'd1',
  title: 'Design review',
  description: null,
  authorName: 'Ada Lovelace',
  fileId: 'f1',
  fileName: 'design-review.pdf',
  fileSize: 240_000,
  uploadedAt: '2035-09-01T00:00:00.000Z',
  // Equal to `uploadedAt` until a revision lands, which is what the page reads
  // to decide whether there are two dates worth printing.
  updatedAt: '2035-09-01T00:00:00.000Z',
  ...over,
})

const project = (documents: ApiProjectDocument[]): ApiProjectDetail => ({
  id: 'p1',
  slug: 'project-storm',
  title: 'Project S.T.O.R.M.',
  summary: null,
  description: null,
  season: null,
  termYear: 2035,
  termSeason: 'FALL',
  competition: null,
  status: 'IN_PROGRESS',
  coverUrl: null,
  coverFromGallery: false,
  coverFocalX: 50,
  coverFocalY: 50,
  coverZoom: 1,
  galleryHeading: null,
  resourcesHeading: null,
  teamHeading: null,
  featured: false,
  startedAt: null,
  completedAt: null,
  members: [],
  images: [],
  links: [],
  documents,
})

/** The page under its real route, so `useParams` and `?doc=` both work. */
function show(at = '/projects/project-storm/docs') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/projects/:slug/docs" element={<ProjectDocsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ProjectDocsPage', () => {
  it('lists the documents and opens the first one', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/projects/project-storm': project([
          document(),
          document({ id: 'd2', title: 'Test plan', fileName: 'test-plan.pdf' }),
        ]),
      }),
    )

    show()

    expect(await screen.findByText('2 DOCUMENTS', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Test plan')).toBeInTheDocument()

    // The viewer heading, not the index button — both carry the same words, so
    // the frame is what proves one of them is open.
    expect(
      screen.getByTitle('Design review').tagName.toLowerCase(),
    ).toBe('iframe')
  })

  it('opens the document named in the query string', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/projects/project-storm': project([
          document(),
          document({ id: 'd2', title: 'Test plan', fileName: 'test-plan.pdf' }),
        ]),
      }),
    )

    show('/projects/project-storm/docs?doc=d2')

    // The address is the whole reason the selection lives in the URL: a lead
    // sends a link to one document and it opens on that document.
    expect(await screen.findByTitle('Test plan')).toBeInTheDocument()
  })

  it('falls back to the first when the query names something withdrawn', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/projects/project-storm': project([document()]) }),
    )

    show('/projects/project-storm/docs?doc=gone')

    expect(await screen.findByTitle('Design review')).toBeInTheDocument()
  })

  it('switches documents when one is picked', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/projects/project-storm': project([
          document(),
          document({ id: 'd2', title: 'Test plan', fileName: 'test-plan.pdf' }),
        ]),
      }),
    )

    show()
    await screen.findByTitle('Design review')

    fireEvent.click(screen.getByRole('button', { name: /Test plan/ }))

    await waitFor(() => {
      expect(screen.getByTitle('Test plan')).toBeInTheDocument()
    })
  })

  it('offers a Word document as a download rather than a frame', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/projects/project-storm': project([
          document({ title: 'Handover', fileName: 'handover.docx' }),
        ]),
      }),
    )

    show()

    expect(
      await screen.findByText(/No browser can display a Word document/),
    ).toBeInTheDocument()
    expect(screen.queryByTitle('Handover')).not.toBeInTheDocument()
    // No "open" for a Word file: there is nothing behind it but the same
    // download, under a word that promises otherwise.
    expect(screen.queryByRole('link', { name: /OPEN IN A NEW TAB/ })).toBeNull()
    expect(screen.getByRole('link', { name: /DOWNLOAD/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/api/files/f1?download=1'),
    )
  })

  /**
   * Opening and saving were one link once, and which one it did depended on a
   * file extension the reader could not see. Both are named now, and the one
   * that saves has to carry `?download=1` — `<a download>` is ignored across
   * origins, and the API is always a different origin.
   */
  it('separates opening from saving, and asks the server for the download', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/projects/project-storm': project([document()]) }),
    )

    show()

    const open = await screen.findByRole('link', { name: /OPEN IN A NEW TAB/ })
    expect(open).toHaveAttribute('href', expect.stringContaining('/api/files/f1'))
    expect(open.getAttribute('href')).not.toContain('download=1')
    expect(open).toHaveAttribute('target', '_blank')

    const save = screen.getByRole('link', { name: /DOWNLOAD/ })
    expect(save).toHaveAttribute(
      'href',
      expect.stringContaining('/api/files/f1?download=1'),
    )
    // Deliberately not `target="_blank"`: a download is not a page, and a tab
    // that opens and immediately closes itself is a flicker with no purpose.
    expect(save).not.toHaveAttribute('target')
  })

  it('asks the viewer to fit the page to the frame', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/projects/project-storm': project([document()]) }),
    )

    show()

    // Without these the viewer opens at 100% behind an expanded thumbnail
    // sidebar, and a letter-size page is cropped to whatever this column is.
    const frame = await screen.findByTitle('Design review')
    expect(frame.getAttribute('src')).toContain('#view=FitH&navpanes=0')
  })

  it('says where the file is when a browser will not preview it', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/projects/project-storm': project([document()]) }),
    )

    show()

    expect(await screen.findByText(/No preview\?/)).toBeInTheDocument()
  })

  it('prints one date until the file has actually been replaced', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/projects/project-storm': project([document()]) }),
    )

    show()

    expect(await screen.findByText(/UPLOADED/)).toBeInTheDocument()
    expect(screen.queryByText(/UPDATED/)).not.toBeInTheDocument()
  })

  it('prints both once it has', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/projects/project-storm': project([
          document({ updatedAt: '2035-11-02T00:00:00.000Z' }),
        ]),
      }),
    )

    show()

    expect(await screen.findByText(/UPDATED/)).toBeInTheDocument()
  })

  it('says so when a project has published nothing', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/projects/project-storm': project([]) }),
    )

    show()

    expect(
      await screen.findByText(/has not published anything yet/),
    ).toBeInTheDocument()
  })

  it('tells a wrong link apart from a broken server', async () => {
    vi.stubGlobal('fetch', stubFetchStatus(404, { error: 'Not found' }))

    show()

    expect(await screen.findByText('There is no project here.')).toBeInTheDocument()
  })
})
