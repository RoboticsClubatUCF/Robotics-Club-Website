import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GoogleCalendarPanel } from './GoogleCalendarPanel'
import type { ApiGoogleCalendar } from '../../lib/api/api'
import { bodyOf, urlOf } from '../../test/stubFetch'

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

const calendar = (over: Partial<ApiGoogleCalendar> = {}): ApiGoogleCalendar => ({
  id: 'c1',
  name: 'RCCF General',
  calendar: 'general@group.calendar.google.com',
  published: true,
  syncedAt: null,
  syncError: null,
  ...over,
})

const ADDRESS = 'https://calendar.google.com/calendar/ical/x/private-y/basic.ics'

/** Answers the list with `list` and every write through `write`. */
function stub(
  list: ApiGoogleCalendar[] | 'fail',
  write: (method: string, url: string, init?: RequestInit) => Promise<Response> = () =>
    json({ calendars: list, report: { created: 0, updated: 0, removed: 0 } }),
) {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') return write(method, urlOf(input), init)
    return list === 'fail' ? Promise.reject(new TypeError('Failed to fetch')) : json(list)
  })
}

const renderPanel = (onImported = vi.fn(() => Promise.resolve())) => {
  render(<GoogleCalendarPanel basePath="/officer/google-calendars" onImported={onImported} />)
  return onImported
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GoogleCalendarPanel', () => {
  it('asks for an address when nothing is connected', async () => {
    vi.stubGlobal('fetch', stub([]))
    renderPanel()

    expect(await screen.findByLabelText('SECRET ADDRESS IN ICAL FORMAT')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'IMPORT NOW' })).toBeNull()
  })

  it('lists each calendar with its state, and offers another', async () => {
    vi.stubGlobal(
      'fetch',
      stub([
        calendar(),
        calendar({
          id: 'c2',
          name: null,
          calendar: 'robotics@gmail.com',
          syncError: 'Google Calendar answered 404.',
        }),
      ]),
    )
    renderPanel()

    expect(await screen.findByText('RCCF General')).toBeInTheDocument()
    expect(screen.getByText('general@group.calendar.google.com')).toBeInTheDocument()
    expect(screen.getByText('NOT IMPORTED YET')).toBeInTheDocument()
    // No name read yet, so the calendar's address stands in.
    expect(screen.getByText('robotics@gmail.com')).toBeInTheDocument()
    expect(screen.getByText('Last import failed. Google Calendar answered 404.')).toBeInTheDocument()
    expect(screen.getByLabelText('ADD ANOTHER CALENDAR')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'IMPORT NOW' })).toBeInTheDocument()
  })

  it('connects a calendar and reloads the events', async () => {
    const fetchStub = stub([], (method) =>
      method === 'POST'
        ? json(
            { calendars: [calendar()], report: { created: 3, updated: 0, removed: 0 } },
            201,
          )
        : Promise.reject(new Error('unexpected')),
    )
    vi.stubGlobal('fetch', fetchStub)
    const onImported = renderPanel()

    const field = await screen.findByLabelText('SECRET ADDRESS IN ICAL FORMAT')
    fireEvent.change(field, { target: { value: ADDRESS } })
    fireEvent.submit(field.closest('form')!)

    expect(await screen.findByText('Connected. 3 added, 0 updated, 0 removed.')).toBeInTheDocument()
    expect(screen.getByText('RCCF General')).toBeInTheDocument()
    expect(onImported).toHaveBeenCalled()
    const post = fetchStub.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(urlOf(post![0])).toContain('/officer/google-calendars')
    expect(bodyOf(post![1])).toEqual({ url: ADDRESS })
  })

  it("shows the server's refusal", async () => {
    vi.stubGlobal(
      'fetch',
      stub([], () => json({ error: 'That calendar is already connected.' }, 409)),
    )
    renderPanel()

    const field = await screen.findByLabelText('SECRET ADDRESS IN ICAL FORMAT')
    fireEvent.change(field, { target: { value: ADDRESS } })
    fireEvent.submit(field.closest('form')!)

    expect(await screen.findByText(/already connected/)).toBeInTheDocument()
  })

  it('disconnects one calendar after asking', async () => {
    const fetchStub = stub([calendar()], (method, url) =>
      method === 'DELETE' && url.endsWith('/officer/google-calendars/c1')
        ? json({ calendars: [], released: 4 })
        : Promise.reject(new Error('unexpected')),
    )
    vi.stubGlobal('fetch', fetchStub)
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect RCCF General' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'DISCONNECT' }))

    expect(await screen.findByText('RCCF General disconnected.')).toBeInTheDocument()
    expect(fetchStub.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true)
  })

  it('replaces an address in place', async () => {
    const fetchStub = stub([calendar()], (method) =>
      method === 'PUT'
        ? json({ calendars: [calendar()], report: { created: 0, updated: 0, removed: 0 } })
        : Promise.reject(new Error('unexpected')),
    )
    vi.stubGlobal('fetch', fetchStub)
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Change address of RCCF General' }))
    const field = screen.getByLabelText('NEW SECRET ADDRESS')
    fireEvent.change(field, { target: { value: ADDRESS } })
    fireEvent.submit(field.closest('form')!)

    expect(await screen.findByText('Address changed. Up to date.')).toBeInTheDocument()
    const put = fetchStub.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(urlOf(put![0])).toContain('/officer/google-calendars/c1')
  })

  it('stops offering more at the limit', async () => {
    vi.stubGlobal(
      'fetch',
      stub(Array.from({ length: 10 }, (_, index) => calendar({ id: `c${String(index)}` }))),
    )
    renderPanel()

    expect(await screen.findAllByText('RCCF General')).toHaveLength(10)
    expect(screen.queryByLabelText('ADD ANOTHER CALENDAR')).toBeNull()
  })

  it('says so when it cannot load', async () => {
    vi.stubGlobal('fetch', stub('fail'))
    renderPanel()

    expect(await screen.findByText(/couldn.t load this just now/)).toBeInTheDocument()
  })
})

describe("GoogleCalendarPanel for a project", () => {
  const BASE = '/projects/p1/google-calendars'

  it('asks whether a new calendar goes on the main calendar, off by default', async () => {
    const fetchStub = stub([], () =>
      json({ calendars: [calendar({ published: true })], report: { created: 1, updated: 0, removed: 0 } }, 201),
    )
    vi.stubGlobal('fetch', fetchStub)
    render(<GoogleCalendarPanel basePath={BASE} project />)

    const field = await screen.findByLabelText('SECRET ADDRESS IN ICAL FORMAT')
    const box = screen.getByRole('checkbox', { name: 'Show on the main calendar' })
    expect(box).not.toBeChecked()
    fireEvent.click(box)
    fireEvent.change(field, { target: { value: ADDRESS } })
    fireEvent.submit(field.closest('form')!)

    await screen.findByText(/Connected\./)
    const post = fetchStub.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(urlOf(post![0])).toContain(BASE)
    expect(bodyOf(post![1])).toEqual({ url: ADDRESS, published: true })
  })

  it('switches a calendar between the main calendar and the project only', async () => {
    const fetchStub = stub([calendar({ published: true })], (method) =>
      method === 'PATCH'
        ? json({ calendars: [calendar({ published: false })] })
        : Promise.reject(new Error('unexpected')),
    )
    vi.stubGlobal('fetch', fetchStub)
    render(<GoogleCalendarPanel basePath={BASE} project />)

    const row = (await screen.findByText('RCCF General')).closest('li')!
    const box = within(row).getByRole('checkbox', { name: 'Show on the main calendar' })
    expect(box).toBeChecked()
    fireEvent.click(box)

    expect(
      await screen.findByText('RCCF General is on the project calendar only.'),
    ).toBeInTheDocument()
    expect(within(row).getByRole('checkbox', { name: 'Show on the main calendar' })).not.toBeChecked()
    const patch = fetchStub.mock.calls.find(([, init]) => init?.method === 'PATCH')
    expect(urlOf(patch![0])).toContain(`${BASE}/c1`)
    expect(bodyOf(patch![1])).toEqual({ published: false })
  })

  it('has no such switch for the club', async () => {
    vi.stubGlobal('fetch', stub([calendar()]))
    renderPanel()

    await screen.findByText('RCCF General')
    expect(screen.queryByRole('checkbox', { name: 'Show on the main calendar' })).toBeNull()
  })
})
