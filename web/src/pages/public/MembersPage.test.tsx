import { fireEvent, render as renderBare, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MembersPage } from './MembersPage'
import type { ApiMember } from '../../lib/api/api'
import { stubFetch, stubFetchNetworkError, urlOf } from '../../test/stubFetch'

/** Nothing on this page is in the address bar any more, but the lede links to
    the front page, so a router is still what makes it renderable. */
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
  ...over,
})

const sam = member({
  id: 'm2',
  slug: 'sam-okafor',
  fullName: 'Sam Okafor',
  title: 'Mechanical Lead',
  gradYear: 2026,
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
   * The distinction the whole page rests on, and it has pointed both ways. The
   * default list is the club's paid-up membership — the landing page's ACTIVE
   * MEMBERS cell, which is the same number — and the lede has to say that
   * rather than describe the table, because everybody else is behind a chip.
   */
  it('says the default list is the membership, not the whole table', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/members': [member()] }))

    render()
    await screen.findByText('Alex Chen')

    expect(screen.getByText(/paid-up membership/i)).toBeInTheDocument()
    expect(screen.getByText(/are a chip away/i)).toBeInTheDocument()
  })

  /** And it opens on that chip. The cell on the front page counts this list, so
      a different default would make that number wrong on arrival. */
  it('opens on the active membership', async () => {
    const fetchStub = stubFetch({ '/members': [member()] })
    vi.stubGlobal('fetch', fetchStub)

    render()
    await screen.findByText('Alex Chen')

    expect(
      fetchStub.mock.calls.some(([input]) => urlOf(input).includes('status=active')),
    ).toBe(true)
  })

  it('asks the server for officer alumni rather than filtering them out here', async () => {
    const fetchStub = stubFetch({ '/members': [member()] })
    vi.stubGlobal('fetch', fetchStub)

    render()
    await screen.findByText('Alex Chen')
    fireEvent.click(screen.getByRole('button', { name: 'OFFICER ALUMNI' }))

    // The two chips overlap but neither contains the other: a past president
    // who stopped paying dues is on the alumni list and not on the default one,
    // so filtering what ACTIVE MEMBERS returned would silently lose them.
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

  /**
   * And on the default list too, which is new. A past president who still pays
   * dues is on it, and the badge is the only thing that says so — the chip
   * above used to imply it by excluding them, which is what `markAlumni` leant
   * on.
   */
  it('badges an officer alumnus on the active list as well', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/members': [member({ officerAlumnus: true }), sam] }),
    )

    render()
    await screen.findByText('Alex Chen')

    // Scoped to the card: the chip row above carries the same two words.
    expect(screen.getByText('Alex Chen').closest('figure')?.textContent).toContain(
      'OFFICER ALUMNI',
    )
    expect(screen.getByText('Sam Okafor').closest('figure')?.textContent).not.toContain(
      'OFFICER ALUMNI',
    )
  })

  /**
   * A `?subteam=` used to narrow this page and is gone with the club divisions it named. A stale
   * link has to land on the roster rather than on nothing — which it does by the parameter being
   * read by nobody. Worth a test because the failure it prevents is a bookmark that opens an empty
   * page.
   */
  it('ignores a stale filter left in the URL', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/members': [member(), sam] }))

    render('/members?subteam=mechanical')

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

  /**
   * Per chip, because the default one is a filter. "Nobody has an account yet" in answer to an
   * empty membership would be a claim about the whole table made by a query that never looked at it
   * — and a club with three hundred signups and nobody paid up is a real state at the start of a
   * term.
   */
  it('says which list is empty, not that the club is', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/members': [] }))

    render()

    expect(await screen.findByText(/no active members yet/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'EVERYONE' }))

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
