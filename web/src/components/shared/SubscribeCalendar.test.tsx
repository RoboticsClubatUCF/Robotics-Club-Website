import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiBaseUrl } from '../../lib/api/api'
import {
  bodyOf,
  stubFetch,
  stubFetchNetworkError,
  stubFetchPending,
  urlOf,
} from '../../test/stubFetch'
import { SubscribeCalendar } from './SubscribeCalendar'

const TOKEN = 'a'.repeat(43)
const NEW_TOKEN = 'b'.repeat(43)

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'clipboard')
})

/** jsdom has no clipboard, so each case that copies brings its own. */
const stubClipboard = (writeText: (text: string) => Promise<void>) => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
}

const open = (name = /SUBSCRIBE/) => {
  fireEvent.click(screen.getByRole('button', { name }))
}

describe('SubscribeCalendar', () => {
  it('offers the public feed without asking the server for anything', () => {
    const fetch = stubFetch({})
    vi.stubGlobal('fetch', fetch)
    render(<SubscribeCalendar feed={{ kind: 'club' }} />)

    open()

    const url = `${apiBaseUrl}/api/calendar/club.ics`
    const webcal = url.replace(/^https?:\/\//, 'webcal://')
    expect(screen.getByRole('link', { name: 'GOOGLE CALENDAR' })).toHaveAttribute(
      'href',
      `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`,
    )
    expect(screen.getByRole('link', { name: 'APPLE OR OUTLOOK' })).toHaveAttribute(
      'href',
      webcal,
    )
    expect(screen.getByRole('textbox', { name: 'Calendar link' })).toHaveValue(url)
    expect(screen.queryByRole('button', { name: 'RESET LINKS' })).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('asks for the token when a private feed opens, showing a skeleton meanwhile', () => {
    vi.stubGlobal('fetch', stubFetchPending())
    const { container } = render(
      <SubscribeCalendar feed={{ kind: 'project', slug: 'rover' }} />,
    )

    open()

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByRole('link', { name: 'GOOGLE CALENDAR' })).toBeNull()
  })

  it('builds the project link from the token', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/me/calendar': { token: TOKEN } }))
    render(<SubscribeCalendar feed={{ kind: 'project', slug: 'rover' }} />)

    open()

    expect(await screen.findByRole('textbox', { name: 'Calendar link' })).toHaveValue(
      `${apiBaseUrl}/api/calendar/${TOKEN}/projects/rover.ics`,
    )
    expect(screen.getByText(/Your private link/)).toBeInTheDocument()
  })

  it('follows the project when the page changes under it', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/me/calendar': { token: TOKEN } }))
    const { rerender } = render(
      <SubscribeCalendar feed={{ kind: 'project', slug: 'rover' }} />,
    )

    open()
    await screen.findByRole('textbox', { name: 'Calendar link' })
    rerender(<SubscribeCalendar feed={{ kind: 'project', slug: 'arm' }} />)

    expect(screen.getByRole('textbox', { name: 'Calendar link' })).toHaveValue(
      `${apiBaseUrl}/api/calendar/${TOKEN}/projects/arm.ics`,
    )
  })

  it('says so when the token cannot be had, and tries again', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())
    render(<SubscribeCalendar feed={{ kind: 'officers' }} />)

    open()
    expect(await screen.findByText('Couldn’t get your link.')).toBeInTheDocument()

    vi.stubGlobal('fetch', stubFetch({ '/me/calendar': { token: TOKEN } }))
    fireEvent.click(screen.getByRole('button', { name: 'TRY AGAIN' }))

    expect(await screen.findByRole('textbox', { name: 'Calendar link' })).toHaveValue(
      `${apiBaseUrl}/api/calendar/${TOKEN}/officers.ics`,
    )
  })

  it('copies the link', async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve())
    stubClipboard(writeText)
    vi.stubGlobal('fetch', stubFetch({}))
    render(<SubscribeCalendar feed={{ kind: 'club' }} />)

    open()
    fireEvent.click(screen.getByRole('button', { name: 'COPY LINK' }))

    expect(await screen.findByRole('button', { name: 'COPIED' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Link copied.')
    expect(writeText).toHaveBeenCalledWith(`${apiBaseUrl}/api/calendar/club.ics`)
  })

  it('selects the link when the clipboard refuses', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')))
    vi.stubGlobal('fetch', stubFetch({}))
    render(<SubscribeCalendar feed={{ kind: 'club' }} />)

    open()
    fireEvent.click(screen.getByRole('button', { name: 'COPY LINK' }))

    expect(
      await screen.findByText('Couldn’t copy. The link is selected above.'),
    ).toBeInTheDocument()
  })

  it('resets the link after confirming, and shows the new one', async () => {
    const fetch = stubFetch({
      '/me/calendar/reset': { token: NEW_TOKEN },
      '/me/calendar': { token: TOKEN },
    })
    vi.stubGlobal('fetch', fetch)
    render(<SubscribeCalendar feed={{ kind: 'project', slug: 'rover' }} />)

    open()
    fireEvent.click(await screen.findByRole('button', { name: 'RESET LINKS' }))

    const dialog = screen.getByRole('dialog', { name: 'Reset your calendar links?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'RESET LINKS' }))

    expect(await screen.findByRole('textbox', { name: 'Calendar link' })).toHaveValue(
      `${apiBaseUrl}/api/calendar/${NEW_TOKEN}/projects/rover.ics`,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('New link ready.')

    const reset = fetch.mock.calls.find(([input]) => urlOf(input).endsWith('/reset'))
    expect(reset?.[1]?.method).toBe('POST')
    expect(bodyOf(reset?.[1])).toEqual({})
  })

  it('closes on Escape', () => {
    vi.stubGlobal('fetch', stubFetch({}))
    render(<SubscribeCalendar feed={{ kind: 'club' }} />)

    open()
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('link', { name: 'GOOGLE CALENDAR' })).toBeNull()
    expect(screen.getByRole('button', { name: /SUBSCRIBE/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('closes when focus moves past it, so it never covers the next field', () => {
    vi.stubGlobal('fetch', stubFetch({}))
    render(
      <>
        <SubscribeCalendar feed={{ kind: 'club' }} />
        <input aria-label="Search events" />
      </>,
    )

    open()
    const field = screen.getByRole('textbox', { name: 'Calendar link' })
    fireEvent.blur(field, { relatedTarget: screen.getByRole('textbox', { name: 'Search events' }) })

    expect(screen.queryByRole('link', { name: 'GOOGLE CALENDAR' })).toBeNull()
  })

  it('puts focus back on the button when Escape closes it from inside', () => {
    vi.stubGlobal('fetch', stubFetch({}))
    render(<SubscribeCalendar feed={{ kind: 'club' }} />)

    open()
    screen.getByRole('button', { name: 'COPY LINK' }).focus()
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.getByRole('button', { name: /SUBSCRIBE/ })).toHaveFocus()
  })
})
