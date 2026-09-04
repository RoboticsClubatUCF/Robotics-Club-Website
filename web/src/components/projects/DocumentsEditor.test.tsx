import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentsEditor } from './DocumentsEditor'
import type { ApiProjectDetail, ApiProjectDocument } from '../../lib/api/api'
import type { ProjectRoster } from '../../lib/projects/useProjectRoster'
import { SectionHarness } from '../../test/sectionHarness'
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

/** Only the writes. **The roster is a prop rather than a fetch**: it is read once
    by `ProjectEditor` and shared with the team section beside this one, so this
    component never asks for anything on its own. */
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

const show = (documents: ApiProjectDocument[] = []) =>
  render(
    <SectionHarness initial={project(documents)}>
      {({ project: current, registry, busy }) => (
        <DocumentsEditor
          project={current}
          me={me}
          roster={ROSTER}
          registry={registry}
          busy={busy}
        />
      )}
    </SectionHarness>,
  )

const openAddForm = async () => {
  fireEvent.click(screen.getByRole('button', { name: '+ ADD A DOCUMENT' }))
  await screen.findByLabelText('TITLE')
}

const saveIt = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'SAVE' }))
  })
}

/** jsdom will not let a test put a file on an input, so the picker is driven
    directly. */
const choose = (label: string, file: File) => {
  const picker = screen.getByLabelText(label)
  Object.defineProperty(picker, 'files', { value: [file], configurable: true })
  fireEvent.change(picker)
}

const pdf = (name = 'test-plan.pdf', size = 1000) =>
  new File([new Uint8Array(size)], name, { type: 'application/pdf' })

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

  it('refuses the wrong kind of file before it joins the list', async () => {
    vi.stubGlobal('fetch', stub())

    show()
    await openAddForm()

    fireEvent.change(screen.getByLabelText('TITLE'), {
      target: { value: 'Notes' },
    })
    choose(
      'THE FILE — PDF OR DOCX',
      new File(['x'], 'notes.txt', { type: 'text/plain' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'ADD' }))

    expect(await screen.findByText(/takes PDF and DOCX files/)).toBeInTheDocument()
    expect(screen.getByText('Nothing published yet.')).toBeInTheDocument()
  })

  /**
   * The one thing deferring the upload costs: the server's size refusal arrives
   * at save time, which is minutes and four sections after the choice that
   * caused it. So the browser refuses it at the moment of choosing instead.
   */
  it('refuses a file over the cap at the moment it is chosen', async () => {
    vi.stubGlobal('fetch', stub())

    show()
    await openAddForm()

    fireEvent.change(screen.getByLabelText('TITLE'), {
      target: { value: 'Everything' },
    })
    choose('THE FILE — PDF OR DOCX', pdf('huge.pdf', 16 * 1024 * 1024))
    fireEvent.click(screen.getByRole('button', { name: 'ADD' }))

    expect(await screen.findByText(/the cap is 15 MB/)).toBeInTheDocument()
    expect(screen.getByText('Nothing published yet.')).toBeInTheDocument()
  })

  /**
   * ADD used to be the publish: the file went up, the row appeared on a public page, and the SAVE
   * at the foot of the editor had nothing to do with it. It adds a row to the list now, and the
   * page's save is what publishes.
   */
  it('adds to the list without sending anything, and publishes on save', async () => {
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
    choose('THE FILE — PDF OR DOCX', pdf())
    fireEvent.click(screen.getByRole('button', { name: 'ADD' }))

    expect(screen.getByText('Test plan')).toBeInTheDocument()
    expect(screen.getByText(/NOT PUBLISHED YET/)).toBeInTheDocument()
    expect(seen).not.toHaveBeenCalled()

    await saveIt()

    const post = seen.mock.calls.find(
      ([url, init]) =>
        url.includes('/projects/p1/documents') && init?.method === 'POST',
    )
    expect(post).toBeDefined()
    // The body is `FormData`, which jsdom will not let a test read a file back
    // out of — that the request was made, to this path, is the assertion worth
    // making here. The server suite covers what it does with it.
    expect(screen.queryByText(/NOT PUBLISHED YET/)).toBeNull()
  })

  it('keeps the existing credit unless the select is changed', async () => {
    const seen = vi.fn<Watcher>()
    vi.stubGlobal(
      'fetch',
      stub({ '/documents/d1': document({ title: 'Renamed' }) }, seen),
    )

    show([document()])

    fireEvent.click(screen.getByRole('button', { name: 'EDIT DETAILS' }))

    // The first option says whose credit it is and that leaving it alone does
    // nothing, which is what an empty value means to the patch below.
    expect(
      await screen.findByRole('option', { name: 'Ada Lovelace — leave as is' }),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('TITLE'), {
      target: { value: 'Renamed' },
    })
    // DONE closes the row. It does not write — the page's SAVE does.
    fireEvent.click(screen.getByRole('button', { name: 'DONE' }))
    expect(seen).not.toHaveBeenCalled()

    await saveIt()

    const patch = seen.mock.calls.find(([, init]) => init?.method === 'PATCH')
    const body = bodyOf(patch?.[1]) as Record<string, unknown>

    expect(body['title']).toBe('Renamed')
    expect(body).not.toHaveProperty('authorUserId')
  })

  /** Untouched rows are not re-sent. This section shares a rate-limit budget
      with four others under one press. */
  it('sends nothing for a document nobody edited', async () => {
    const seen = vi.fn<Watcher>()
    vi.stubGlobal('fetch', stub({}, seen))

    show([document()])
    await saveIt()

    expect(seen).not.toHaveBeenCalled()
  })

  it('warns that removing destroys the file, and does it on save', async () => {
    const seen = vi.fn<Watcher>()
    vi.stubGlobal('fetch', stub({ '/documents/d1': { deleted: true } }, seen))

    show([document()])

    fireEvent.click(screen.getByRole('button', { name: 'REMOVE' }))
    expect(screen.getByText(/the club keeps no other copy/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'REMOVE IT' }))
    expect(screen.getByText('Nothing published yet.')).toBeInTheDocument()
    expect(seen).not.toHaveBeenCalled()

    await saveIt()

    expect(
      seen.mock.calls.some(([, init]) => init?.method === 'DELETE'),
    ).toBe(true)
  })
})
