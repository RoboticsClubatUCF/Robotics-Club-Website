import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectEditor } from './ProjectEditor'
import type { ApiProjectDetail, ApiProjectImage } from '../../lib/api/api'
import { DEFAULT_FRAMING } from '../../lib/media/imageFraming'
import { urlOf } from '../../test/stubFetch'

const image = (id: string, url = `/api/files/${id}`): ApiProjectImage => ({
  id,
  url,
  caption: null,
  ...DEFAULT_FRAMING,
})

const project = (over: Partial<ApiProjectDetail> = {}): ApiProjectDetail => ({
  id: 'p1',
  slug: 'project-storm',
  title: 'Project S.T.O.R.M.',
  summary: null,
  description: null,
  season: null,
  // Every project carries the term it is built for, and the dashboard
  // splits on it. Pinned rather than left to today's date.
  termYear: 2035,
  termSeason: 'FALL',
  competition: null,
  status: 'IN_PROGRESS',
  coverUrl: null,
  coverFromGallery: true,
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
  documents: [],
  ...over,
})

/**
 * Every mount of the editor reads the project's roster once — the team section
 * cannot draw a row without it, and the credit picker shares the same read.
 *
 * It is answered here rather than left to fail so the tests are not full of
 * caught errors, and `writesOf` is what keeps the call-counting assertions about
 * the thing each test is actually asserting on.
 */
const isRoster = (input: string | URL | Request) => urlOf(input).includes('/team')

const writesOf = (mock: { mock: { calls: [string | URL | Request, RequestInit?][] } }) =>
  mock.mock.calls.filter(([input]) => !isRoster(input))

const emptyRoster = () => json({ project: {}, teams: [], members: [] })

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

/**
 * The editor is controlled: it never holds the project, it hands every change
 * back through `apply` and re-renders from what its parent then passes down.
 * So the harness has to hold that state, or nothing the editor does appears —
 * which is exactly how a stateless harness quietly tests half a component.
 */
function Harness({ initial }: { initial: ApiProjectDetail }) {
  const [current, setCurrent] = useState(initial)

  return (
    <ProjectEditor
      project={current}
      asOfficer={false}
      apply={setCurrent}
      onDone={() => {}}
    />
  )
}

function renderEditor(over: Partial<ApiProjectDetail> = {}) {
  render(<Harness initial={project(over)} />)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('ProjectEditor', () => {
  it('draws the empty well as the thing to add a picture to', () => {
    renderEditor()
    expect(screen.getByText('[ NO IMAGES YET ]')).toBeInTheDocument()
  })

  it('says how much of the gallery is used, and stops at the cap', () => {
    renderEditor({
      images: Array.from({ length: 12 }, (_, index) => image(`i${index}`)),
    })

    expect(screen.getByText(/12 \/ 12 IMAGES/)).toBeInTheDocument()
    expect(screen.getByText(/REMOVE ONE TO ADD ANOTHER/)).toBeInTheDocument()
    // The picker itself is the control now, so it is the thing that closes.
    expect(screen.getByLabelText('ADD FROM YOUR COMPUTER')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'ADD' })).toBeDisabled()
  })

  /**
   * Choosing the file *is* the upload — there is no second button, because a
   * picker already ended in a deliberate act and confirming it asks the same
   * question twice.
   *
   * Also the jsdom trap: `new FormData(form)` cannot see a file input's file,
   * yielding one with an empty name and zero size. The editor takes the file
   * off the change event and builds the body by hand, and this is what would
   * catch a refactor back to the obvious thing.
   */
  it('uploads the moment a file is chosen, with no second press', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, _init?: RequestInit) =>
      isRoster(input)
        ? emptyRoster()
        : urlOf(input).includes('/images/upload')
          ? json(image('new', '/api/files/new'), 201)
          : Promise.reject(new Error(`no stub for ${urlOf(input)}`)),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderEditor()

    expect(screen.queryByRole('button', { name: 'UPLOAD' })).toBeNull()

    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'rover.png', {
      type: 'image/png',
    })

    await act(async () => {
      fireEvent.change(screen.getByLabelText('ADD FROM YOUR COMPUTER'), {
        target: { files: [file] },
      })
    })

    expect(writesOf(fetchMock)).toHaveLength(1)
    const [, init] = writesOf(fetchMock)[0]
    const body = init?.body
    // Asserted rather than cast through: if the body is missing, "no file was
    // sent" is the finding, and a cast would report it as a null dereference
    // somewhere further down instead.
    expect(body).toBeInstanceOf(FormData)
    const sent = (body as FormData).get('file') as File

    expect(sent.name).toBe('rover.png')
    expect(sent.size).toBeGreaterThan(0)
  })

  /** The point of removing the button: framing is where a new picture lands. */
  it('opens the framing tool on the picture it just added', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
        json(image('new', '/api/files/new'), 201),
      ),
    )

    renderEditor()

    await act(async () => {
      fireEvent.change(screen.getByLabelText('ADD FROM YOUR COMPUTER'), {
        target: {
          files: [new File([new Uint8Array([1])], 'rover.png', { type: 'image/png' })],
        },
      })
    })

    expect(
      screen.getByRole('application', {
        name: 'Drag to choose what this picture shows',
      }),
    ).toBeInTheDocument()
  })

  it('opens it for a picture added by link too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
        json(image('new', 'https://example.test/new.png'), 201),
      ),
    )

    renderEditor()

    fireEvent.change(screen.getByLabelText('OR ADD BY LINK'), {
      target: { value: 'https://example.test/new.png' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ADD' }))
    })

    expect(
      screen.getByRole('application', {
        name: 'Drag to choose what this picture shows',
      }),
    ).toBeInTheDocument()
  })

  /**
   * An input whose value has not changed emits no change event, so without the
   * reset a retry after a failure would silently do nothing at all.
   */
  it('clears the picker so the same file can be chosen again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
        json(image('new', '/api/files/new'), 201),
      ),
    )

    renderEditor()

    const input = screen.getByLabelText('ADD FROM YOUR COMPUTER') as HTMLInputElement

    await act(async () => {
      fireEvent.change(input, {
        target: {
          files: [new File([new Uint8Array([1])], 'rover.png', { type: 'image/png' })],
        },
      })
    })

    expect(input.value).toBe('')
  })

  /**
   * The reorder is debounced, so a burst of presses is one write. Fake timers
   * advanced inside `act` — never `findBy*` or `waitFor` under them.
   */
  it('sends one reorder for a burst of moves', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    const fetchMock = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
      json([image('a'), image('b'), image('c')]),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderEditor({ images: [image('a'), image('b'), image('c')] })

    fireEvent.click(screen.getByRole('button', { name: 'Move image 1 later' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move image 1 later' }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })

    expect(writesOf(fetchMock)).toHaveLength(1)
    expect(urlOf(writesOf(fetchMock)[0][0])).toContain('/images/order')
  })

  /**
   * Deleting an upload destroys bytes that do not come back, so it asks first.
   * An external URL is a paste away from being undone, and asking about that
   * would be ceremony people learn to click through.
   */
  it('confirms before deleting an upload, but not an external picture', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
      json({ deleted: true }),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderEditor({
      images: [image('a'), image('b', 'https://example.test/b.png')],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Remove image 1' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/removing it deletes the file/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'GO BACK' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(writesOf(fetchMock)).toHaveLength(0)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove image 2' }))
    })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(writesOf(fetchMock)).toHaveLength(1)
  })

  /**
   * **The title and the summary are not in this patch any more.** They moved to
   * the title section, which carries its own SAVE — a button at the foot of the
   * page cannot honestly cover fields at the top of it. What is left here is the
   * writing proper and the links, in two requests under one press.
   */
  it('saves the writing and the links together, and clears blanks to null', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, _init?: RequestInit) =>
      isRoster(input)
        ? emptyRoster()
        : urlOf(input).endsWith('/links')
          ? json([])
          : json({
              season: '2026-2027',
              competition: null,
              description: null,
            }),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderEditor()

    // Season and competition were create-only fields until the desk needed
    // them editable — they go up in the same patch as the rest of the writing.
    fireEvent.change(screen.getByLabelText('SEASON'), {
      target: { value: '2026-2027' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'SAVE CHANGES' }))
    })

    expect(writesOf(fetchMock)).toHaveLength(2)

    const [, projectInit] = writesOf(fetchMock)[0]
    expect(JSON.parse(projectInit?.body as string)).toEqual({
      season: '2026-2027',
      competition: null,
      description: null,
    })

    expect(screen.getByText('Saved.')).toBeInTheDocument()
  })

  /**
   * The editor is controlled and never re-reads the project — `/projects/:slug`
   * is publicly cached, so a read straight after a write can answer with the
   * copy from before it. That makes `apply` the only thing standing between the
   * response and the page, and any column the response leaves out lands as
   * `undefined`.
   *
   * `description` was exactly that column, and the damage was not the missing
   * paragraph: `dirty` compares the typed text against the project, so a project
   * whose write-up came back blank stayed dirty *after a save that worked* —
   * SAVE CHANGES that never became SAVED, "Unsaved changes." that would not go
   * away, and the leave-the-page dialog on top. The route's answer now carries
   * it; this is the half of that contract living in the browser.
   */
  it('keeps the write-up and settles to SAVED after a save', async () => {
    const written = 'Two years of chassis work.'
    const fetchMock = vi.fn((input: string | URL | Request, _init?: RequestInit) =>
      isRoster(input)
        ? emptyRoster()
        : urlOf(input).endsWith('/links')
          ? json([])
          : json({ season: null, competition: null, description: written }),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderEditor({ description: written, competition: 'UNIVERSITY ROVER CHALLENGE' })

    // Clearing the competition is the change under test: not every project is
    // built for one, and emptying the box has to be a save like any other.
    fireEvent.change(screen.getByLabelText('COMPETITION'), {
      target: { value: '' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'SAVE CHANGES' }))
    })

    const [, projectInit] = writesOf(fetchMock)[0]
    expect(JSON.parse(projectInit?.body as string)).toMatchObject({
      competition: null,
      description: written,
    })

    expect(screen.getByLabelText('DESCRIPTION')).toHaveValue(written)
    expect(screen.queryByText('Unsaved changes.')).toBeNull()
    expect(screen.getByRole('button', { name: 'SAVED' })).toBeInTheDocument()
    expect(screen.getByText('Saved.')).toBeInTheDocument()
  })

  /** The server's own sentence reaches the reader, not a generic apology. */
  it('prints what the server said when a write is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
        json(
          { error: 'A project shows up to 12 images. Remove one before adding another.' },
          409,
        ),
      ),
    )

    renderEditor()

    fireEvent.change(screen.getByLabelText('OR ADD BY LINK'), {
      target: { value: 'https://example.test/a.png' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ADD' }))
    })

    expect(screen.getByText(/A project shows up to 12 images/)).toBeInTheDocument()
  })

  it('opens one framing panel at a time, and only on request', () => {
    renderEditor({ images: [image('a'), image('b')] })

    const framer = () =>
      screen.queryByRole('application', {
        name: 'Drag to choose what this picture shows',
      })

    expect(framer()).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Frame image 1' }))
    expect(framer()).toBeInTheDocument()

    // A second FRAME closes the first rather than stacking two previews.
    fireEvent.click(screen.getByRole('button', { name: 'Frame image 2' }))
    expect(
      screen.getAllByRole('application', {
        name: 'Drag to choose what this picture shows',
      }),
    ).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Frame image 2' }))
    expect(framer()).toBeNull()
  })

  /**
   * The framing patch carries only the three framing fields. Sending a caption
   * alongside would overwrite one that had been typed but not yet blurred, and
   * the server leaves absent fields alone precisely so it does not have to.
   */
  it('saves framing on its own, without touching the caption', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
      json({ ...image('a'), focalX: 50, focalY: 50, zoom: 2 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderEditor({ images: [image('a')] })

    fireEvent.click(screen.getByRole('button', { name: 'Frame image 1' }))
    fireEvent.change(screen.getByLabelText('ZOOM'), { target: { value: '2' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'DONE' }))
    })

    expect(writesOf(fetchMock)).toHaveLength(1)
    const [, init] = writesOf(fetchMock)[0]
    expect(JSON.parse(init?.body as string)).toEqual({
      focalX: 50,
      focalY: 50,
      zoom: 2,
    })

    // And the panel closes on success, so the row shows the saved framing.
    expect(
      screen.queryByRole('application', {
        name: 'Drag to choose what this picture shows',
      }),
    ).toBeNull()
  })

  it('shows each row at the framing it will be published with', () => {
    renderEditor({
      images: [{ ...image('a'), focalX: 10, focalY: 90, zoom: 2 }],
    })

    const thumb = screen.getByRole('list').querySelector('img')
    expect(thumb?.style.objectPosition).toBe('10% 90%')
    expect(thumb?.style.transform).toBe('scale(2)')
  })

  it('names the capacity when an officer is editing somebody else’s project', () => {
    render(
      <ProjectEditor
        project={project()}
        asOfficer
        apply={() => {}}
        onDone={() => {}}
      />,
    )

    expect(screen.getByText(/EDITING AS AN OFFICER/)).toBeInTheDocument()
  })
})
