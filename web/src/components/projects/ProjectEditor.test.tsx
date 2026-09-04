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
 * The editor makes reads of its own that no test here is about: the roster, once per mount,
 * because the team section can't draw a row without it; and both `/projects` listings after a
 * clean save, to replace the cached copies the lead is about to look at.
 *
 * `isRoster` answers the first so the tests aren't full of caught errors, and `writesOf` keeps
 * every call-counting assertion about what was actually sent — by method rather than by path, so
 * a read added later can't quietly start counting as a write.
 */
const isRoster = (input: string | URL | Request) => urlOf(input).includes('/team')

const writesOf = (mock: { mock: { calls: [string | URL | Request, RequestInit?][] } }) =>
  mock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET')

const emptyRoster = () => json({ project: {}, teams: [], members: [] })

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

/**
 * The editor is controlled: it never holds the project, it hands every change back through
 * `apply` and re-renders from what its parent passes down. So the harness has to hold that state,
 * or nothing the editor does appears — which is exactly how a stateless harness quietly tests
 * half a component.
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

/** The page's one button. */
const saveIt = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'SAVE' }))
  })
}

const chooseFile = async (name = 'rover.png') => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText('ADD FROM YOUR COMPUTER'), {
      target: {
        files: [
          new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, {
            type: 'image/png',
          }),
        ],
      },
    })
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('ProjectEditor', () => {
  /**
   * The complaint this whole shape answers: two buttons reading SAVE — one at
   * the top for the title, one at the foot for the writing — plus a DONE EDITING
   * here and a second one in the page header above it.
   */
  it('has one save, with the way out directly beneath it', () => {
    renderEditor()

    expect(screen.getAllByRole('button', { name: 'SAVE' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'DONE EDITING' })).toHaveLength(1)

    const buttons = screen.getAllByRole('button')
    const save = buttons.indexOf(screen.getByRole('button', { name: 'SAVE' }))
    const done = buttons.indexOf(screen.getByRole('button', { name: 'DONE EDITING' }))
    expect(done).toBe(save + 1)
  })

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
   * Choosing a file used to be the upload. It's a row in the draft now, and the page's SAVE is
   * what sends it — which is the point of the change: a photo dropped into the gallery while
   * somebody is still deciding isn't on the public site until they say so.
   *
   * The jsdom trap is unchanged and still worth the assertion: `new FormData(form)` can't see a
   * file input's file, yielding one with an empty name and zero size.
   */
  it('holds a chosen file until the page is saved, then uploads it', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, _init?: RequestInit) =>
      isRoster(input)
        ? emptyRoster()
        : urlOf(input).includes('/images/upload')
          ? json(image('new', '/api/files/new'), 201)
          : Promise.reject(new Error(`no stub for ${urlOf(input)}`)),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderEditor()
    await chooseFile()

    // On the page, and nowhere else yet.
    expect(screen.getByLabelText('Caption for image 1')).toBeInTheDocument()
    expect(writesOf(fetchMock)).toHaveLength(0)

    await saveIt()

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

  /** The point of having no second button: framing is where a new picture lands. */
  it('opens the framing tool on the picture it just added', async () => {
    renderEditor()
    await chooseFile()

    expect(
      screen.getByRole('application', {
        name: 'Drag to choose what this picture shows',
      }),
    ).toBeInTheDocument()
  })

  it('opens it for a picture added by link too', () => {
    renderEditor()

    fireEvent.change(screen.getByLabelText('OR ADD BY LINK'), {
      target: { value: 'https://example.test/new.png' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ADD' }))

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
    renderEditor()
    const input = screen.getByLabelText('ADD FROM YOUR COMPUTER') as HTMLInputElement

    await chooseFile()

    expect(input.value).toBe('')
  })

  /**
   * Reordering used to be a debounced write per burst. It is state now, and the
   * whole order goes up once — and only when the draft disagrees with the order
   * the server already holds, which is what keeps a caption edit from costing a
   * reorder.
   */
  it('sends one reorder for a burst of moves, on save', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, _init?: RequestInit) =>
      isRoster(input) ? emptyRoster() : json([image('b'), image('c'), image('a')]),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderEditor({ images: [image('a'), image('b'), image('c')] })

    // Three presses that land somewhere other than where they started — two
    // would put the same picture back and the gallery would be clean, which is
    // now a save that correctly does nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Move image 1 later' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move image 2 later' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move image 1 later' }))
    expect(writesOf(fetchMock)).toHaveLength(0)

    await saveIt()

    expect(writesOf(fetchMock)).toHaveLength(1)
    expect(urlOf(writesOf(fetchMock)[0][0])).toContain('/images/order')
  })

  /** Nothing changed, nothing sent. Five sections share one rate-limit budget
      under one press, so an untouched gallery has to cost nothing. */
  it('sends nothing at all when nothing was touched', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, _init?: RequestInit) =>
      isRoster(input) ? emptyRoster() : json({}),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderEditor({ images: [image('a')] })
    await saveIt()

    expect(writesOf(fetchMock)).toHaveLength(0)
  })

  /**
   * The ✕ is a promise to delete bytes rather than the deletion itself, and that
   * is still worth being sure about — an external URL is a paste away from being
   * undone, and asking about that would be ceremony people learn to click
   * through.
   */
  it('confirms before dropping an upload, but not an external picture', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, _init?: RequestInit) =>
      isRoster(input) ? emptyRoster() : json({ deleted: true }),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderEditor({
      images: [image('a'), image('b', 'https://example.test/b.png')],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Remove image 1' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(
      screen.getByText(/the file is deleted when this page is saved/),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'GO BACK' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Remove image 2' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    // Gone from the page, still on the server until the page is saved.
    expect(screen.getByText(/1 \/ 12 IMAGES/)).toBeInTheDocument()
    expect(writesOf(fetchMock)).toHaveLength(0)

    await saveIt()
    expect(
      writesOf(fetchMock).some(([, init]) => init?.method === 'DELETE'),
    ).toBe(true)
  })

  /**
   * **The title and the summary are not in this patch.** They are the title
   * section's, and go up in a patch of their own under the same press — which is
   * why the count below is two writes and not one.
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

    await saveIt()

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
   * The editor is controlled and never re-reads the project — `/projects/:slug` is publicly
   * cached, so a read straight after a write can answer with the copy from before it. That makes
   * what the save returns the only thing between the response and the page, and any column the
   * response leaves out lands as `undefined`.
   *
   * `description` was exactly that column, and the damage wasn't the missing paragraph: `dirty`
   * compares the typed text against the project, so a project whose write-up came back blank
   * stayed dirty after a save that worked.
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
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument()

    await saveIt()

    const [, projectInit] = writesOf(fetchMock)[0]
    expect(JSON.parse(projectInit?.body as string)).toMatchObject({
      competition: null,
      description: written,
    })

    expect(screen.getByLabelText('DESCRIPTION')).toHaveValue(written)
    expect(screen.queryByText(/Unsaved changes/)).toBeNull()
    expect(screen.getByText('Saved.')).toBeInTheDocument()
  })

  /**
   * The server's own sentence reaches the reader, not a generic apology — and
   * with five sections behind one button it is named, because "that change did
   * not go through" is unanswerable when five things were being changed.
   */
  it('names the section and prints what the server said when a write is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, _init?: RequestInit) =>
        isRoster(input)
          ? emptyRoster()
          : json(
              {
                error:
                  'A project shows up to 12 images. Remove one before adding another.',
              },
              409,
            ),
      ),
    )

    renderEditor()

    fireEvent.change(screen.getByLabelText('OR ADD BY LINK'), {
      target: { value: 'https://example.test/a.png' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ADD' }))

    await saveIt()

    expect(screen.getByText(/A project shows up to 12 images/)).toBeInTheDocument()
    expect(screen.getByText(/^The gallery:/)).toBeInTheDocument()
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
   * Framing is state until the page is saved, so the row's patch carries the caption alongside it
   * — the draft is where both live and there's nothing left to overwrite. It used to send the
   * three framing fields alone, precisely because a caption typed and not yet blurred would have
   * been clobbered by the picture being moved.
   */
  it('sends the framing with the caption, in one patch per changed picture', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, _init?: RequestInit) =>
      isRoster(input) ? emptyRoster() : json({ ...image('a'), zoom: 2 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderEditor({ images: [image('a')] })

    fireEvent.click(screen.getByRole('button', { name: 'Frame image 1' }))
    fireEvent.change(screen.getByLabelText('ZOOM'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'DONE' }))

    // The panel closes on DONE, so the row shows the framing it will publish.
    expect(
      screen.queryByRole('application', {
        name: 'Drag to choose what this picture shows',
      }),
    ).toBeNull()

    await saveIt()

    expect(writesOf(fetchMock)).toHaveLength(1)
    const [url, init] = writesOf(fetchMock)[0]
    expect(urlOf(url)).toContain('/images/a')
    expect(JSON.parse(init?.body as string)).toEqual({
      caption: null,
      focalX: 50,
      focalY: 50,
      zoom: 2,
    })
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
