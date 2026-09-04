import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TitleSection } from './TitleSection'
import type { ApiProjectDetail } from '../../lib/api/api'
import { DEFAULT_FRAMING } from '../../lib/media/imageFraming'
import { draftFromImage, type DraftImage } from '../../lib/projects/projectDraft'
import { SectionHarness } from '../../test/sectionHarness'
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

/**
 * The section, under the machinery that stands behind the page's one SAVE.
 *
 * `images` is the draft gallery rather than the project's stored one, because that is what the
 * cover preview reads — the two sections are far apart on the page and a preview drawn from the
 * server's copy would show yesterday's first photo while a new one sat unsaved below.
 */
const show = (over: Partial<ApiProjectDetail> = {}, images: DraftImage[] = []) =>
  render(
    <SectionHarness initial={project(over)}>
      {({ project: current, registry, busy }) => (
        <TitleSection
          project={current}
          images={images}
          registry={registry}
          busy={busy}
        />
      )}
    </SectionHarness>,
  )

const saveIt = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'SAVE' }))
  })
}

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
   * This section used to carry a SAVE of its own, and the writing section lower
   * down carried a second one — two buttons with the same word on them, neither
   * covering what somebody had just changed. There is one now, and it is the
   * page's.
   */
  it('has no save button of its own', () => {
    vi.stubGlobal('fetch', vi.fn())
    show()

    expect(screen.queryByRole('button', { name: /SAVE THE TITLE/ })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'SAVE' })).toHaveLength(1)
  })

  it('sends the words and the cover settings under the page’s save', async () => {
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

    expect(fetchMock).not.toHaveBeenCalled()
    await saveIt()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bodyOf(fetchMock.mock.calls[0][1])).toEqual({
      title: 'Renamed',
      summary: 'A rover.',
      galleryHeading: 'THE BUILD',
      // Blank clears the column, so there is one spelling of "no heading" and
      // the pages fall back to the standing word.
      resourcesHeading: null,
      teamHeading: null,
      coverFromGallery: false,
      coverFocalX: 50,
      coverFocalY: 50,
      coverZoom: 1,
    })
  })

  /**
   * The checkbox used to write the moment it was pressed, on the grounds that it
   * changes what the public list shows. So does everything else on this page, and
   * a control that publishes while the words beside it wait is the surprise the
   * one SAVE exists to remove.
   */
  it('holds the cover switch until the page is saved', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
      json({ coverFromGallery: true }),
    )
    vi.stubGlobal('fetch', fetchMock)

    show()

    fireEvent.click(screen.getByLabelText(/USE THE FIRST GALLERY PICTURE/))
    expect(fetchMock).not.toHaveBeenCalled()

    // The panel still redraws on the press, which is the half of it that was
    // always right: the controls below it are about to mean something else.
    expect(screen.queryByLabelText('UPLOAD A COVER')).toBeNull()

    await saveIt()
    expect(bodyOf(fetchMock.mock.calls[0][1])).toMatchObject({
      coverFromGallery: true,
    })
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

  /** From the draft list, not from the project: a photo added to the gallery and
      not yet saved is the one the list is about to show. */
  it('shows the gallery picture it will use', () => {
    vi.stubGlobal('fetch', vi.fn())
    const { container } = show({ coverFromGallery: true }, [
      draftFromImage({
        id: 'i1',
        url: '/api/files/i1',
        caption: null,
        ...DEFAULT_FRAMING,
      }),
    ])

    const preview = container.querySelector('img')
    expect(preview).toHaveAttribute('src', expect.stringContaining('/api/files/i1'))
  })

  it('takes a cover by link, frames it, and sends both on save', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
      json({ coverUrl: 'https://example.test/rover.png' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    show()

    fireEvent.change(screen.getByLabelText('OR LINK TO ONE'), {
      target: { value: 'https://example.test/rover.png' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'USE THIS ONE' }))

    // The moment a picture lands is the moment its framing is worth looking at.
    expect(
      screen.getByLabelText('Drag to choose what this picture shows'),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'DONE' }))
    await saveIt()

    expect(urlOf(fetchMock.mock.calls[0][0])).toContain('/projects/p1')
    expect(bodyOf(fetchMock.mock.calls[0][1])).toMatchObject({
      coverUrl: 'https://example.test/rover.png',
    })
  })

  /** A pasted address can be pasted back; the bytes cannot. Only a picture the
      club is hosting gets the ceremony, which is the rule the gallery follows. */
  it('confirms before dropping an uploaded cover, but not a linked one', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
      json({ coverUrl: null }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { unmount } = show({ coverUrl: 'https://example.test/rover.png' })

    fireEvent.click(screen.getByRole('button', { name: 'REMOVE THE COVER' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('[ NO COVER YET ]')).toBeInTheDocument()

    unmount()
    show({ coverUrl: '/api/files/f1' })

    fireEvent.click(screen.getByRole('button', { name: 'REMOVE THE COVER' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'REMOVE IT' }))
    })
    // Still nothing sent — the dialog is about what saving will do, not about
    // what has happened.
    expect(fetchMock).not.toHaveBeenCalled()

    await saveIt()
    expect(bodyOf(fetchMock.mock.calls[0][1])).toMatchObject({ coverUrl: null })
  })

  /**
   * Refused here rather than by the server, which would answer 400 after however
   * many uploads the sections ahead of this one had already sent.
   */
  it('blocks the page’s save while the title is blank', () => {
    vi.stubGlobal('fetch', vi.fn())
    show()

    fireEvent.change(screen.getByLabelText('TITLE'), { target: { value: '  ' } })

    expect(screen.getByRole('button', { name: 'SAVE' })).toBeDisabled()
    expect(screen.getByText('The project needs a title.')).toBeInTheDocument()
  })
})
