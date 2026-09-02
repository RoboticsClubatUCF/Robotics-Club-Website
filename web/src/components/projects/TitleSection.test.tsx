import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TitleSection } from './TitleSection'
import type { ApiProjectDetail } from '../../lib/api/api'
import { DEFAULT_FRAMING } from '../../lib/media/imageFraming'
import { urlOf } from '../../test/stubFetch'

const project = (over: Partial<ApiProjectDetail> = {}): ApiProjectDetail => ({
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
  documents: [],
  ...over,
})

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

/** The section is controlled, like the rest of the editor: it hands every change
    back through `apply` and re-renders from what the parent passes down. */
function Harness({ initial }: { initial: ApiProjectDetail }) {
  const [current, setCurrent] = useState(initial)
  return <TitleSection project={current} apply={setCurrent} onDirtyChange={() => {}} />
}

const show = (over: Partial<ApiProjectDetail> = {}) =>
  render(<Harness initial={project(over)} />)

const bodyOf = (init?: RequestInit) =>
  JSON.parse(init?.body as string) as Record<string, unknown>

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TitleSection', () => {
  it('says what the summary is for, in the words of the page it feeds', () => {
    vi.stubGlobal('fetch', vi.fn())
    show()

    expect(screen.getByLabelText('SUMMARY')).toBeInTheDocument()
    expect(screen.getByText('What shows in the projects list.')).toBeInTheDocument()
  })

  /**
   * The title, the summary and the headings go up under one press. They are
   * prose, and autosaving a textarea is how a half-written sentence becomes the
   * published one — the rule the writing section below already follows.
   */
  it('saves the title, the summary and the headings together', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
      json({ title: 'Renamed', summary: 'A rover.' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    show()

    fireEvent.change(screen.getByLabelText('TITLE'), {
      target: { value: 'Renamed' },
    })
    fireEvent.change(screen.getByLabelText('SUMMARY'), {
      target: { value: 'A rover.' },
    })
    fireEvent.change(screen.getByLabelText('GALLERY'), {
      target: { value: 'THE BUILD' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'SAVE THE TITLE' }))
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bodyOf(fetchMock.mock.calls[0][1])).toEqual({
      title: 'Renamed',
      summary: 'A rover.',
      galleryHeading: 'THE BUILD',
      // Blank clears the column, so there is one spelling of "no heading" and
      // the pages fall back to the standing word.
      resourcesHeading: null,
      teamHeading: null,
    })
  })

  /**
   * The checkbox changes what the public list shows and the panel under it
   * redraws on the answer, so a version of it waiting for SAVE would be a
   * control that appears not to work.
   */
  it('sends the cover switch the moment it is pressed', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
      json({ coverFromGallery: true }),
    )
    vi.stubGlobal('fetch', fetchMock)

    show()

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/USE THE FIRST GALLERY PICTURE/))
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bodyOf(fetchMock.mock.calls[0][1])).toEqual({ coverFromGallery: true })
  })

  /** Ticked, the cover is the gallery's and there is nothing here to choose —
      offering an upload box that the list would ignore is a lie. */
  it('hides the cover controls while the gallery is the cover', () => {
    vi.stubGlobal('fetch', vi.fn())
    show({ coverFromGallery: true })

    expect(screen.queryByLabelText('UPLOAD A COVER')).toBeNull()
    expect(screen.queryByLabelText('OR LINK TO ONE')).toBeNull()
    expect(screen.getByText('[ NO GALLERY YET ]')).toBeInTheDocument()
  })

  it('shows the gallery picture it will use', () => {
    vi.stubGlobal('fetch', vi.fn())
    const { container } = show({
      coverFromGallery: true,
      images: [{ id: 'i1', url: '/api/files/i1', caption: null, ...DEFAULT_FRAMING }],
    })

    const preview = container.querySelector('img')
    expect(preview).toHaveAttribute('src', expect.stringContaining('/api/files/i1'))
  })

  it('sets a cover by link, and opens the framing tool on it', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
      json({ coverUrl: 'https://example.test/rover.png' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    show()

    fireEvent.change(screen.getByLabelText('OR LINK TO ONE'), {
      target: { value: 'https://example.test/rover.png' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ADD' }))
    })

    expect(bodyOf(fetchMock.mock.calls[0][1])).toEqual({
      coverUrl: 'https://example.test/rover.png',
    })
    // The moment a picture lands is the moment its framing is worth looking at.
    expect(
      screen.getByLabelText('Drag to choose what this picture shows'),
    ).toBeInTheDocument()
  })

  /** Only the three framing fields, so a summary typed but not yet saved is not
      overwritten by the picture being moved. */
  it('saves the cover framing on its own', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
      json({ coverFocalX: 50 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    show({ coverUrl: 'https://example.test/rover.png' })

    fireEvent.click(screen.getByRole('button', { name: 'FRAME THE COVER' }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'DONE' }))
    })

    expect(Object.keys(bodyOf(fetchMock.mock.calls[0][1])).sort()).toEqual([
      'coverFocalX',
      'coverFocalY',
      'coverZoom',
    ])
  })

  /** A pasted address can be pasted back; the bytes cannot. Only an upload gets
      the ceremony, which is the rule the gallery already follows. */
  it('confirms before deleting an uploaded cover, but not a linked one', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
      json({ coverUrl: null }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { unmount } = show({ coverUrl: 'https://example.test/rover.png' })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'REMOVE THE COVER' }))
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    unmount()
    show({ coverUrl: '/api/files/f1' })

    fireEvent.click(screen.getByRole('button', { name: 'REMOVE THE COVER' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  /**
   * A button says what pressing it does, so the resting label is SAVE rather
   * than a report of what happened last — "Saved." below it is the status line
   * that reports.
   *
   * It names this section once there is something to save, because the writing
   * section lower down has its own button and the dirty state is when it matters
   * which of the two is being pressed.
   */
  it('offers to save, and names the section once there is something to', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
      json({ title: 'Renamed' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    show()
    expect(screen.getByRole('button', { name: 'SAVE' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('TITLE'), {
      target: { value: 'Renamed' },
    })
    expect(screen.getByRole('button', { name: 'SAVE THE TITLE' })).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'SAVE THE TITLE' }))
    })
    expect(urlOf(fetchMock.mock.calls[0][0])).toContain('/projects/p1')
  })
})
