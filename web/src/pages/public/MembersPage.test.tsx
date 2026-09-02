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
  profileUrl: null,
  active: true,
  officerAlumnus: false,
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
   * The card's photograph is the one thing on this page that links anywhere,
   * and only where its owner said so. The address has already been through the
   * server's allowlist, which is what makes it safe to print into an `href` on
   * a page of several hundred faces.
   */
  it('makes a photo with a profile link an anchor to it', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/members': [
          member({ profileUrl: 'https://www.linkedin.com/in/alex-chen' }),
          sam,
        ],
      }),
    )

    render()

    // Named after the person and the site: the image itself is `alt=""`, so
    // without this the link's whole accessible name would be the empty string.
    const link = await screen.findByRole('link', {
      name: 'Alex Chen on LinkedIn',
    })

    expect(link).toHaveAttribute('href', 'https://www.linkedin.com/in/alex-chen')
    // The destination is a member's choice rather than the club's, and `rel`
    // says so as well as protecting the tab it opens from.
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('rel')).toContain('nofollow')
  })

  /** Which is nearly everybody. A card with no link is the frame it always
      was, not an anchor to nowhere. */
  it('leaves a photo with no profile link unlinked', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/members': [member(), sam] }))

    render()

    expect(await screen.findByText('Alex Chen')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Alex Chen/ })).not.toBeInTheDocument()
  })

  /**
   * The distinction the whole page rests on, and it now points the other way:
   * this lists every account, so nobody reading it should take the length of it
   * for the club's paid-up membership. That number is the landing page's
   * ACTIVE MEMBERS cell and is a fraction of this.
   */
  it('says the list is every account rather than the membership', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/members': [member()] }))

    render()
    await screen.findByText('Alex Chen')

    expect(screen.getByText(/everyone with an account/i)).toBeInTheDocument()
    expect(screen.getByText(/just signed up/i)).toBeInTheDocument()
  })

  it('asks the server for officer alumni rather than filtering them out here', async () => {
    const fetchStub = stubFetch({ '/members': [member()] })
    vi.stubGlobal('fetch', fetchStub)

    render()
    await screen.findByText('Alex Chen')
    fireEvent.click(screen.getByRole('button', { name: 'OFFICER ALUMNI' }))

    // CURRENT and OFFICER ALUMNI are disjoint sets of rows — `officerAlumnus`
    // false and true — so the split has to be a request. Filtering what CURRENT
    // already returned would always be an empty list.
    await vi.waitFor(() => {
      expect(
        fetchStub.mock.calls.some(([input]) =>
          urlOf(input).includes('status=alumni'),
        ),
      ).toBe(true)
    })
  })

  /**
   * The reason `officerAlumnus` is its own column. `active: false` and
   * `officerAlumnus: true` are different people — the badge used to read the
   * first, and `active` is set back to true by every dues payment — so the
   * fixture makes them two different cards and only one may be badged.
   */
  it('badges officer alumni under EVERYONE, never a merely inactive account', async () => {
    const retired = member({ id: 'm3', fullName: 'Robin Retired', active: false })
    const past = member({ id: 'm4', fullName: 'Pat Past', officerAlumnus: true })
    vi.stubGlobal('fetch', stubFetch({ '/members': [member(), retired, past] }))

    // The chip above carries the same two words, so this asks the card rather
    // than the page.
    const cardFor = (name: string) => screen.getByText(name).closest('figure')

    render()
    await screen.findByText('Alex Chen')
    fireEvent.click(screen.getByRole('button', { name: 'EVERYONE' }))

    await vi.waitFor(() => {
      expect(cardFor('Pat Past')?.textContent).toContain('OFFICER ALUMNI')
    })
    expect(cardFor('Robin Retired')?.textContent).not.toContain('OFFICER ALUMNI')
    expect(cardFor('Alex Chen')?.textContent).not.toContain('OFFICER ALUMNI')
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

  it('says so when there are no accounts yet', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/members': [] }))

    render()

    expect(
      await screen.findByText(/nobody has an account yet/i),
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
