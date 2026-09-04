import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeaveProjectButton } from './LeaveProjectButton'
import type { ProjectMemberRank } from '../../lib/api/api'

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

function renderButton(
  over: { rank?: ProjectMemberRank; teamName?: string | null } = {},
) {
  const onLeft = vi.fn()

  render(
    <LeaveProjectButton
      projectId="p1"
      projectTitle="Mars Rover"
      rank={over.rank ?? 'MEMBER'}
      teamName={over.teamName ?? null}
      onLeft={onLeft}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'LEAVE THIS PROJECT' }))
  return { onLeft }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LeaveProjectButton', () => {
  it('asks before doing anything', () => {
    const fetchMock = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
      json({ left: true }),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderButton()

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /** A plain member is not giving up a rank, so the dialog does not invent one. */
  it('tells a plain member their standing does not change', () => {
    renderButton({ rank: 'MEMBER' })

    expect(screen.getByText('Leave Mars Rover?')).toBeInTheDocument()
    expect(screen.getByText(/standing in the club doesn't change/)).toBeInTheDocument()
    expect(screen.queryByText(/roster label/)).toBeNull()
  })

  /**
   * The dialog used to say what leaving cost the person — walking out of a last lead seat rewrote
   * their club-wide roster label, so three sentences worked out whether they would land on MEMBER
   * or GUEST. Nothing about a project writes that column now, so what is left to warn about is the
   * cost to the project: it is about to have nobody running it.
   */
  it('warns a project lead that the project would be left with no lead', () => {
    renderButton({ rank: 'PROJECT_LEAD' })

    expect(
      screen.getByText('Leave Mars Rover as its project lead?'),
    ).toBeInTheDocument()
    expect(screen.getByText(/would be left with/)).toBeInTheDocument()
    expect(screen.getByText(/only an officer could run it/)).toBeInTheDocument()
    // The label sentences are gone, and must not come back.
    expect(screen.queryByText(/roster label/)).toBeNull()
    expect(screen.queryByText(/listed as/)).toBeNull()
  })

  /** A team lead is not the last of anything — their team seat is the cost. */
  it('names the team a team lead is giving up, and says nothing about a lead', () => {
    renderButton({ rank: 'TEAM_LEAD', teamName: 'Chassis' })

    expect(
      screen.getByText('Leave Mars Rover as its team lead?'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Your seat on Chassis goes with it/)).toBeInTheDocument()
    expect(screen.queryByText(/left with/)).toBeNull()
  })

  it('leaves on confirmation, and tells its caller', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
      json({ left: true, role: 'MEMBER' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { onLeft } = renderButton({ rank: 'PROJECT_LEAD' })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'LEAVE THE PROJECT' }))
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onLeft).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  /**
   * The sole-lead refusal needs no branch in the dialog — the server has a
   * better sentence than this component could write, and it arrives on
   * `ApiError.detail`.
   */
  it("prints the server's own refusal for the only lead", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
        json(
          {
            error:
              'You are the only lead. Ask an officer to appoint another before you leave.',
          },
          409,
        ),
      ),
    )

    renderButton({ rank: 'PROJECT_LEAD' })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'LEAVE THE PROJECT' }))
    })

    expect(screen.getByText(/only lead/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Ask an officer')
  })
})
