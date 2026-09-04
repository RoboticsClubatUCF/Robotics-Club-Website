import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamEditor } from './TeamEditor'
import type { ApiProjectDetail } from '../../lib/api/api'
import type { ProjectRoster } from '../../lib/projects/useProjectRoster'
import { SectionHarness } from '../../test/sectionHarness'
import { urlOf } from '../../test/stubFetch'

const project = (): ApiProjectDetail => ({
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
})

const roster = (over: Partial<ProjectRoster> = {}): ProjectRoster => ({
  ready: true,
  teams: [{ id: 't1', name: 'Chassis', description: null }],
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
      rank: 'TEAM_LEAD',
      teamId: 't1',
    },
    {
      userId: 'u3',
      fullName: 'Rowan Chen',
      photoUrl: null,
      title: 'Software Lead',
      rank: 'MEMBER',
      teamId: null,
    },
  ],
  ...over,
})

/**
 * The roster is held in state here for the reason `ProjectEditor` holds it in state: this section's
 * baseline for "has this box changed" is the roster itself, so the save has to move it. Building a
 * fresh one on every render would also re-seed the boxes on every render, which is a loop rather
 * than a test.
 */
function Show({
  over = {},
  heading = 'THE TEAM',
}: {
  over?: Partial<ProjectRoster>
  heading?: string
}) {
  const [current, setCurrent] = useState<ProjectRoster>(() => roster(over))

  return (
    <SectionHarness initial={project()}>
      {({ project: currentProject, registry, busy }) => (
        <TeamEditor
          project={currentProject}
          roster={current}
          onRoster={(members) => {
            setCurrent((held) => ({ ...held, members }))
          }}
          heading={heading}
          registry={registry}
          busy={busy}
        />
      )}
    </SectionHarness>
  )
}

const show = (over: Partial<ProjectRoster> = {}) => render(<Show over={over} />)

const saveIt = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'SAVE' }))
  })
}

const ok = () =>
  Promise.resolve(
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TeamEditor', () => {
  /** Rank is shown and not edited: appointing a project lead is the roles desk's
      and a team lead's is the manage page's, and the route behind this section
      refuses `PROJECT_LEAD` in its own schema. */
  it('prints each rank, and a team lead with their team', () => {
    vi.stubGlobal('fetch', vi.fn())
    show()

    expect(screen.getByText('PROJECT LEAD')).toBeInTheDocument()
    expect(screen.getByText('TEAM LEAD — Chassis')).toBeInTheDocument()
  })

  /** The typed title belongs in the box, not in the rank line — otherwise a
      member who typed one would read as holding a rank they do not have. */
  it('puts a typed title in the field rather than in the rank line', () => {
    vi.stubGlobal('fetch', vi.fn())
    show()

    expect(screen.getByLabelText('Title for Rowan Chen')).toHaveValue('Software Lead')
    expect(screen.queryByText('Software Lead')).toBeNull()
  })

  /**
   * `ProjectMember.title` has had a route since the model existed and no page had ever sent one, so
   * the column was empty everywhere and the public roster printed the club-wide title instead. This
   * is the write that fills it in — under the page's SAVE now rather than on blur, because a page
   * where one field writes as you leave it and four sections around it wait for a button is a page
   * nobody can predict.
   */
  it('holds a title until the page is saved, then writes it by user id', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, _init?: RequestInit) => ok())
    vi.stubGlobal('fetch', fetchMock)

    show()

    const field = screen.getByLabelText('Title for Grace Hopper')
    fireEvent.change(field, { target: { value: 'Chief Engineer' } })

    await act(async () => {
      fireEvent.blur(field)
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText('UNSAVED')).toBeInTheDocument()

    await saveIt()

    expect(urlOf(fetchMock.mock.calls[0][0])).toContain('/projects/p1/members/u1')
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      title: 'Chief Engineer',
    })
    // The roster moved with the save, so the box stops reporting itself unsaved.
    expect(screen.getByText('SAVED')).toBeInTheDocument()
  })

  /** Only the rows that changed. Three members and one edit is one request, not
      three — this section shares a budget with four others under one press. */
  it('writes only the rows that changed', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, _init?: RequestInit) => ok())
    vi.stubGlobal('fetch', fetchMock)

    show()

    fireEvent.change(screen.getByLabelText('Title for Ada Lovelace'), {
      target: { value: 'Frame' },
    })
    await saveIt()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(urlOf(fetchMock.mock.calls[0][0])).toContain('/members/u2')
  })

  /** One spelling of "nothing typed", so the public page has one thing to
      check rather than two that render identically. */
  it('clears a blank title to null', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, _init?: RequestInit) => ok())
    vi.stubGlobal('fetch', fetchMock)

    show()

    fireEvent.change(screen.getByLabelText('Title for Rowan Chen'), {
      target: { value: '   ' },
    })
    await saveIt()

    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      title: null,
    })
  })

  /** "Nobody is on this project" and "the list has not arrived" are different
      answers, and only one of them is worth printing as a fact. */
  it('tells a pending roster from an empty one', () => {
    vi.stubGlobal('fetch', vi.fn())

    const { unmount } = show({ members: [], ready: false })
    expect(screen.getByText('Loading the roster…')).toBeInTheDocument()

    unmount()
    show({ members: [], ready: true })
    expect(screen.getByText(/Nobody is on this project yet/)).toBeInTheDocument()
  })

  it('takes its heading from the project', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<Show heading="WHO IS ON IT" />)

    expect(screen.getByText('/ WHO IS ON IT')).toBeInTheDocument()
  })
})
