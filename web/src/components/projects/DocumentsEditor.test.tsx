import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentsEditor } from './DocumentsEditor'
import type { ApiProjectDetail, ApiProjectDocument } from '../../lib/api/api'
import type { ProjectRoster } from '../../lib/projects/useProjectRoster'
import { bodyOf, urlOf } from '../../test/stubFetch'

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
  // Equal to `uploadedAt` until a revision lands, which is what the row reads
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

/** The lead doing the editing, and the first name on the project's roster. */
const me = { id: 'u1', fullName: 'Grace Hopper' }

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

/** Every call the component makes, so a test can assert on what did not happen. */
type Watcher = (url: string, init?: RequestInit) => void

/** Only the writes now. **The roster is a prop rather than a fetch**: it is read
    once by `ProjectEditor` and shared with the team section beside this one, so
    this component no longer asks for anything on its own. */
function stub(extra: Record<string, unknown> = {}, spy?: Watcher) {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input)
    spy?.(url, init)

    const match = Object.keys(extra).find((path) => url.includes(path))
    if (match) return json(extra[match])

    return Promise.reject(new Error(`no stub for ${url}`))
  })
}

/** The roster as `useProjectRoster` hands it over, landed. */
const ROSTER: ProjectRoster = {
  teams: [],
  ready: true,
  members: [
    {
      userId: 'u1',
      fullName: 'Grace Hopper',
      photoUrl: null,
      title: null,
      rank: 'PROJECT_LEAD',
      teamId: null,
    },
    {
      userId: 'u2',
      fullName: 'Ada Lovelace',
      photoUrl: null,
      title: null,
      rank: 'MEMBER',
      teamId: null,
    },
  ],
}

/** Holds the project in state, the way the editor's parent does. */
function Harness({ initial }: { initial: ApiProjectDetail }) {
  const [current, setCurrent] = useState(initial)
  return <DocumentsEditor project={current} me={me} roster={ROSTER} apply={setCurrent} />
}

const show = (documents: ApiProjectDocument[] = []) =>
  render(<Harness initial={project(documents)} />)

const openAddForm = async () => {
  fireEvent.click(screen.getByRole('button', { name: '+ PUBLISH A DOCUMENT' }))
  await screen.findByLabelText('TITLE')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DocumentsEditor', () => {
  it('lists what is published, with the credit and one date', () => {
    vi.stubGlobal('fetch', stub())

    show([document()])

    expect(screen.getByText('Design review')).toBeInTheDocument()
    expect(
      screen.getByText(/Ada Lovelace · design-review\.pdf · UPLOADED/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/UPDATED/)).toBeNull()
  })

  it('says so when there is nothing yet', () => {
    vi.stubGlobal('fetch', stub())

    show()

    expect(screen.getByText('Nothing published yet.')).toBeInTheDocument()
  })

  /**
   * This section used to fetch the roster itself, deferred until a form opened,
   * so that somebody fixing a typo did not pay for a list nobody read. The team
   * section beside it cannot draw a row without the same list, so the read moved
   * up to `ProjectEditor` and happens once — which leaves this component asking
   * for nothing at all until somebody actually publishes something.
   */
  it('asks for nothing until something is published', async () => {
    const seen = vi.fn<Watcher>()
    vi.stubGlobal('fetch', stub({}, seen))

    show([document()])
    await openAddForm()

    expect(seen).not.toHaveBeenCalled()
  })

  it('offers the project roster as the credit, defaulting to me', async () => {
    vi.stubGlobal('fetch', stub())

    show()
    await openAddForm()

    const author = screen.getByLabelText('WRITTEN BY')
    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: 'Ada Lovelace' }),
      ).toBeInTheDocument()
    })
    // Not merely "somebody on the roster": crediting the wrong person silently
    // is the failure worth pinning, and this caught it once already.
    expect((author as HTMLSelectElement).value).toBe('u1')
  })

  it('refuses the wrong kind of file before sending anything', async () => {
    const seen = vi.fn<Watcher>()
    vi.stubGlobal('fetch', stub({}, seen))

    show()
    await openAddForm()

    fireEvent.change(screen.getByLabelText('TITLE'), {
      target: { value: 'Notes' },
    })

    // jsdom cannot put a file on an input, so the picker is driven directly.
    const picker = screen.getByLabelText('THE FILE — PDF OR DOCX')
    Object.defineProperty(picker, 'files', {
      value: [new File(['x'], 'notes.txt', { type: 'text/plain' })],
    })
    fireEvent.change(picker)

    fireEvent.click(screen.getByRole('button', { name: 'ADD' }))

    expect(await screen.findByText(/takes PDF and DOCX files/)).toBeInTheDocument()
    // The whole point of checking in the browser: nothing went up the wire.
    expect(
      seen.mock.calls.some(([url]) => String(url).includes('/documents')),
    ).toBe(false)
  })

  it('publishes to the project’s documents route', async () => {
    const seen = vi.fn<Watcher>()
    vi.stubGlobal(
      'fetch',
      stub({ '/projects/p1/documents': document({ title: 'Test plan' }) }, seen),
    )

    show()
    await openAddForm()

    fireEvent.change(screen.getByLabelText('TITLE'), {
      target: { value: 'Test plan' },
    })

    const picker = screen.getByLabelText('THE FILE — PDF OR DOCX')
    Object.defineProperty(picker, 'files', {
      value: [
        new File(['%PDF-1.7'], 'test-plan.pdf', { type: 'application/pdf' }),
      ],
    })
    fireEvent.change(picker)

    fireEvent.click(screen.getByRole('button', { name: 'ADD' }))

    await waitFor(() => {
      expect(screen.getByText('Published.')).toBeInTheDocument()
    })

    const post = seen.mock.calls.find(
      ([url, init]) =>
        String(url).includes('/projects/p1/documents') && init?.method === 'POST',
    )
    expect(post).toBeDefined()
    // The body is `FormData`, which jsdom will not let a test read a file back
    // out of — that the request was made, to this path, is the assertion worth
    // making here. The server suite covers what it does with it.
  })

  it('keeps the existing credit unless the select is changed', async () => {
    const seen = vi.fn<Watcher>()
    vi.stubGlobal(
      'fetch',
      stub({ '/documents/d1': document({ title: 'Design review' }) }, seen),
    )

    show([document()])

    fireEvent.click(screen.getByRole('button', { name: 'EDIT DETAILS' }))

    // The first option says whose credit it is and that leaving it alone does
    // nothing, which is what an empty value means to the patch below.
    expect(
      await screen.findByRole('option', { name: 'Ada Lovelace — leave as is' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'SAVE' }))

    await waitFor(() => {
      expect(screen.getByText('Saved.')).toBeInTheDocument()
    })

    const patch = seen.mock.calls.find(([, init]) => init?.method === 'PATCH')
    const body = bodyOf(patch?.[1]) as Record<string, unknown>

    expect(body['title']).toBe('Design review')
    expect(body).not.toHaveProperty('authorUserId')
  })

  it('warns that removing destroys the file, and only then removes it', async () => {
    vi.stubGlobal('fetch', stub({ '/documents/d1': { deleted: true } }))

    show([document()])

    fireEvent.click(screen.getByRole('button', { name: 'REMOVE' }))

    expect(screen.getByText(/the club keeps no other copy/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'REMOVE IT' }))

    await waitFor(() => {
      expect(screen.getByText('Nothing published yet.')).toBeInTheDocument()
    })
  })
})
