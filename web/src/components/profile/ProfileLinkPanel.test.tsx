import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProfileLinkPanel } from './ProfileLinkPanel'
import type { ApiAccount } from '../../lib/api/api'
import { bodyOf, urlOf } from '../../test/stubFetch'

/**
 * The profile link — where a member's photograph points on the public pages.
 *
 * Three properties, and all three are about the panel not having an opinion of
 * its own about what a valid address is. The allowlist lives on the server
 * because that is the only place it can be enforced, so this has to **send what
 * was typed**, **adopt what came back** rather than what was sent, and **print
 * the server's refusal verbatim** — a friendlier local message would be the
 * frontend inventing a rule it does not own.
 */

const account: ApiAccount = {
  id: 'u1',
  fullName: 'Rowan Test',
  email: 'rowan@ucf.edu',
  slug: null,
  role: 'MEMBER',
  discordUsername: 'rowan',
  photoUrl: null,
  photoFocalX: 50,
  photoFocalY: 50,
  photoZoom: 1,
  profileUrl: null,
  bio: null,
  gradYear: null,
  acknowledgementAcceptedAt: null,
  passwordSet: true,
  pendingEmail: null,
}

const linked: ApiAccount = {
  ...account,
  profileUrl: 'https://www.linkedin.com/in/rowan',
}

function stubApi(answer: unknown, status = 200) {
  const stub = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify(answer), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )

  vi.stubGlobal('fetch', stub)
  return stub
}

const draw = (data: ApiAccount = account, onSaved = vi.fn()) => {
  render(<ProfileLinkPanel account={data} onSaved={onSaved} />)
  return onSaved
}

const save = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'SAVE' }))
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ProfileLinkPanel', () => {
  it('sends what was typed and adopts what came back', async () => {
    const stub = stubApi({ profileUrl: 'https://linkedin.com/in/rowan' })
    const onSaved = draw()

    const field = screen.getByLabelText('YOUR LINK')
    fireEvent.change(field, { target: { value: 'linkedin.com/in/rowan' } })
    await save()

    const [input, init] = stub.mock.calls[0] ?? []
    expect(urlOf(input as string)).toContain('/api/account/profile-link')
    // Unaltered: adding the scheme is the server's job, and a browser that did
    // it first would be a second answer to what a valid address is.
    expect(bodyOf(init)).toEqual({ profileUrl: 'linkedin.com/in/rowan' })

    // And the box now shows what was *stored*, not what was typed — otherwise
    // it disagrees with the row behind it until the page is reloaded.
    expect(field).toHaveValue('https://linkedin.com/in/rowan')
    expect(onSaved).toHaveBeenCalledWith({
      profileUrl: 'https://linkedin.com/in/rowan',
    })
    expect(screen.getByRole('status')).toHaveTextContent('Saved.')
  })

  /** An empty box is "I have not given one" rather than an address, which is
      what makes clearing the field work without a second control. */
  it('sends null for an empty box', async () => {
    const stub = stubApi({ profileUrl: null })
    draw(linked)

    fireEvent.change(screen.getByLabelText('YOUR LINK'), {
      target: { value: '   ' },
    })
    await save()

    expect(bodyOf(stub.mock.calls[0]?.[1])).toEqual({ profileUrl: null })
    expect(screen.getByRole('status')).toHaveTextContent('Removed.')
  })

  it('clears it from the REMOVE button', async () => {
    const stub = stubApi({ profileUrl: null })
    draw(linked)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'REMOVE' }))
    })

    expect(bodyOf(stub.mock.calls[0]?.[1])).toEqual({ profileUrl: null })
    expect(screen.getByLabelText('YOUR LINK')).toHaveValue('')
  })

  /** Nothing to remove, so nothing offering to. */
  it('offers no REMOVE until there is one stored', () => {
    draw()

    expect(screen.queryByRole('button', { name: 'REMOVE' })).not.toBeInTheDocument()
  })

  /**
   * The server's own sentence, not a local paraphrase. It is the only thing
   * that knows what the allowlist holds, and "that change did not go through"
   * in place of it is how somebody concludes the page is broken.
   */
  it('prints the refusal the server sent', async () => {
    stubApi(
      { error: 'profileUrl: link to a profile on LinkedIn, GitHub or another' },
      400,
    )
    draw()

    fireEvent.change(screen.getByLabelText('YOUR LINK'), {
      target: { value: 'free-robux.example/claim' },
    })
    await save()

    expect(screen.getByRole('status')).toHaveTextContent(/LinkedIn, GitHub/)
  })

  it('says so when the API cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    draw()

    fireEvent.change(screen.getByLabelText('YOUR LINK'), {
      target: { value: 'github.com/rowan' },
    })
    await save()

    expect(screen.getByRole('status')).toHaveTextContent(/couldn't reach the server/i)
  })

  /** Named, so the panel answers "is that the right link" without the reader
      having to parse a URL. */
  it('names the site a stored link goes to', () => {
    draw(linked)

    expect(screen.getByText(/goes to LinkedIn/)).toBeInTheDocument()
  })
})
