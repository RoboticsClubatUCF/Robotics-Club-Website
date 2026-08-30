import { fireEvent, render as renderBare, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MembersPage } from './MembersPage'
import type { ApiMember } from '../../lib/api/api'
import { stubFetch, stubFetchNetworkError, urlOf } from '../../test/stubFetch'

/** The page reads `?subteam=` and writes it back, so every render needs a real
    location as well as a router. */
const render = (at = '/members', ui: ReactNode = <MembersPage />) =>
  renderBare(<MemoryRouter initialEntries={[at]}>{ui}</MemoryRouter>)

const member = (over: Partial<ApiMember> = {}): ApiMember => ({
  id: 'm1',
  slug: 'alex-chen',
  fullName: 'Alex Chen',
  role: 'MEMBER',
  title: 'Team Captain',
  gradYear: 2027,
  bio: null,
  photoUrl: null,
  active: true,
  subteam: { slug: 'software', name: 'Software', color: '#4f8cff' },
  ...over,
})

const sam = member({
  id: 'm2',
  slug: 'sam-okafor',
  fullName: 'Sam Okafor',
  title: 'Mechanical Lead',
  gradYear: 2026,
  subteam: { slug: 'mechanical', name: 'Mechanical', color: '#ff8a4f' },
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MembersPage', () => {
  it('draws the roster the API sends', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/members': [member(), sam] }))

    render()

    expect(await screen.findByText('Alex Chen')).toBeInTheDocument()
    expect(screen.getByText('Sam Okafor')).toBeInTheDocument()
    expect(screen.getByText('CLASS OF 2027')).toBeInTheDocument()
  })

  /**
   * The distinction the whole page rests on: nobody reading this should think
   * it lists everybody who has paid dues.
   */
  it('says the list is the public roster rather than the membership', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/members': [member()] }))

    render()
    await screen.findByText('Alex Chen')

    expect(screen.getByText(/public roster/i)).toBeInTheDocument()
  })

  it('asks the server for alumni rather than filtering them out here', async () => {
    const fetchStub = stubFetch({ '/members': [member()] })
    vi.stubGlobal('fetch', fetchStub)

    render()
    await screen.findByText('Alex Chen')
    fireEvent.click(screen.getByRole('button', { name: 'ALUMNI' }))

    // `active` is the only column marking an alumnus, so the split has to be a
    // request — filtering the current roster in the browser would always be an
    // empty list.
    await vi.waitFor(() => {
      expect(
        fetchStub.mock.calls.some(([input]) =>
          urlOf(input).includes('status=alumni'),
        ),
      ).toBe(true)
    })
  })

  /** `/about` links a subteam's member count straight here, and the number a
      reader just saw has to be the list they land on. */
  it('arrives narrowed when the URL names a subteam', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/members': [member(), sam] }))

    render('/members?subteam=mechanical')

    expect(await screen.findByText('Sam Okafor')).toBeInTheDocument()
    expect(screen.queryByText('Alex Chen')).not.toBeInTheDocument()
  })

  /**
   * A link that went out of date must not produce a page that looks broken —
   * an unknown slug falls back to the whole roster rather than to nothing.
   */
  it('ignores a subteam nobody is in', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/members': [member(), sam] }))

    render('/members?subteam=underwater-basket-weaving')

    expect(await screen.findByText('Alex Chen')).toBeInTheDocument()
    expect(screen.getByText('Sam Okafor')).toBeInTheDocument()
  })

  it('narrows to a search without asking the server again', async () => {
    const fetchStub = stubFetch({ '/members': [member(), sam] })
    vi.stubGlobal('fetch', fetchStub)

    render()
    await screen.findByText('Alex Chen')
    const before = fetchStub.mock.calls.length

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'okafor' } })

    expect(screen.getByText('Sam Okafor')).toBeInTheDocument()
    expect(screen.queryByText('Alex Chen')).not.toBeInTheDocument()
    expect(fetchStub.mock.calls).toHaveLength(before)
  })

  it('says so when nobody is on the roster yet', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/members': [] }))

    render()

    expect(
      await screen.findByText(/nobody is on the public roster yet/i),
    ).toBeInTheDocument()
  })

  it('degrades to a message when the API is unreachable', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render()

    expect(await screen.findByText(/couldn’t load the roster/i)).toBeInTheDocument()
    consoleError.mockRestore()
  })
})
