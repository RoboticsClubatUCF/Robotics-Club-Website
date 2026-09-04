import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EquipmentPage } from './EquipmentPage'
import type { ApiEquipment, ApiLoan } from '../../lib/api/api'
import { addDays, endOfDay, startOfDay, today } from '../../lib/equipment/borrowing'
import {
  bodyOf,
  stubFetch,
  stubFetchNetworkError,
  urlOf,
} from '../../test/stubFetch'

/**
 * The page's job is to be honest about what is free before anybody asks.
 *
 * An item with nothing left is shown and disabled, not hidden — "the drill is all out" answers the
 * question a member came with, and a missing card just looks like the club has no drill. The same
 * goes for something they already have: the card says so rather than letting them ask twice into a
 * 409.
 */

const item = (over: Partial<ApiEquipment> = {}): ApiEquipment => ({
  id: 'e1',
  name: 'Cordless drill',
  description: 'Battery and charger in the case.',
  quantity: 2,
  available: 2,
  maxLoanDays: 7,
  ...over,
})

const loan = (over: Partial<ApiLoan> = {}): ApiLoan => ({
  id: 'l1',
  status: 'REQUESTED',
  note: null,
  officerNote: null,
  dueAt: null,
  startAt: null,
  requestedDueAt: null,
  requestedAt: '2026-08-01T12:00:00.000Z',
  decidedAt: null,
  checkedOutAt: null,
  returnedAt: null,
  equipment: { id: 'e1', name: 'Cordless drill' },
  ...over,
})

/** The radio behind a card, which is what carries its disabled state. */
const cardFor = (name: string) =>
  screen.getByRole('radio', { name: new RegExp(name, 'i') })

const ask = () => {
  const button = screen.getByRole('button', { name: /ask to borrow/i })
  fireEvent.submit(button.closest('form')!)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('EquipmentPage', () => {
  it('lists what there is with a live count of what is free', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/equipment': [item(), item({ id: 'e2', name: 'Heat gun', quantity: 1, available: 1 })],
        '/me/loans': [],
      }),
    )

    render(<EquipmentPage />)

    expect(await screen.findByText('Cordless drill')).toBeInTheDocument()
    expect(screen.getByText('2 OF 2 FREE')).toBeInTheDocument()
    expect(screen.getByText('1 OF 1 FREE')).toBeInTheDocument()
  })

  it('shows an item with none left, disabled rather than hidden', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/equipment': [item({ available: 0 })], '/me/loans': [] }),
    )

    render(<EquipmentPage />)

    expect(await screen.findByText('Cordless drill')).toBeInTheDocument()
    expect(screen.getByText('ALL OUT')).toBeInTheDocument()
    expect(cardFor('cordless drill')).toBeDisabled()
  })

  it('says so when you already have one on the go', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/equipment': [item()],
        '/me/loans': [loan({ status: 'CHECKED_OUT' })],
      }),
    )

    render(<EquipmentPage />)

    expect(await screen.findByText('YOU HAVE ONE')).toBeInTheDocument()
    // Free units left, and still refused: one each is the rule.
    expect(cardFor('cordless drill')).toBeDisabled()
  })

  /**
   * The card carries the member's own state before the shelf's, and the three
   * are different sentences. YOU HAVE ONE over something nobody has approved
   * yet tells somebody they are holding a drill that is still on the shelf.
   */
  it('says REQUESTED while an ask is waiting, not that you have it', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/equipment': [item()], '/me/loans': [loan()] }),
    )

    render(<EquipmentPage />)

    expect(await screen.findByText('REQUESTED')).toBeInTheDocument()
    expect(screen.queryByText('YOU HAVE ONE')).not.toBeInTheDocument()
    expect(cardFor('cordless drill')).toBeDisabled()
  })

  it('says it is ready once an officer has set it aside', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/equipment': [item()],
        '/me/loans': [loan({ status: 'APPROVED' })],
      }),
    )

    render(<EquipmentPage />)

    // On the card and on the row below it, which is why this is `getAllBy`.
    expect(
      (await screen.findAllByText('READY TO COLLECT')).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByText('YOU HAVE ONE')).not.toBeInTheDocument()
  })

  it('shows five at a time, and the rest when asked', async () => {
    const shelf = ['Anvil', 'Bandsaw', 'Calipers', 'Drill', 'Extruder', 'Files'].map(
      (name, index) => item({ id: `e${index + 1}`, name, description: null }),
    )
    vi.stubGlobal('fetch', stubFetch({ '/equipment': shelf, '/me/loans': [] }))

    render(<EquipmentPage />)
    await screen.findByText('Anvil')

    expect(screen.getByText('Extruder')).toBeInTheDocument()
    expect(screen.queryByText('Files')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /show all — 1 more/i }))
    expect(screen.getByText('Files')).toBeInTheDocument()

    // And a search reaches past the cut, which is the other half of the deal.
    fireEvent.click(screen.getByRole('button', { name: /show fewer/i }))
    fireEvent.change(screen.getByLabelText(/search the lending list/i), {
      target: { value: 'files' },
    })
    expect(screen.getByText('Files')).toBeInTheDocument()
    expect(screen.queryByText('Anvil')).not.toBeInTheDocument()
  })

  it('frees the card again once the thing is back', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/equipment': [item()],
        '/me/loans': [loan({ status: 'RETURNED' })],
      }),
    )

    render(<EquipmentPage />)

    expect(await screen.findByText('2 OF 2 FREE')).toBeInTheDocument()
    expect(cardFor('cordless drill')).not.toBeDisabled()
  })

  it('refuses to send without a pick rather than guessing one', async () => {
    const fetchStub = stubFetch({ '/equipment': [item()], '/me/loans': [] })
    vi.stubGlobal('fetch', fetchStub)

    render(<EquipmentPage />)
    await screen.findByText('Cordless drill')

    const before = fetchStub.mock.calls.length
    ask()

    expect(await screen.findByText(/pick what you need first/i)).toBeInTheDocument()
    expect(fetchStub.mock.calls).toHaveLength(before)
  })

  it('sends the ask against the chosen item, with the note and the dates', async () => {
    const fetchStub = stubFetch({
      '/equipment': [item()],
      '/me/loans': [],
      '/equipment/e1/loans': loan(),
    })
    vi.stubGlobal('fetch', fetchStub)

    render(<EquipmentPage />)
    await screen.findByText('Cordless drill')

    fireEvent.click(cardFor('cordless drill'))
    fireEvent.change(screen.getByLabelText(/what you need it for/i), {
      target: { value: 'Mounting the chassis' },
    })
    ask()

    expect(await screen.findByText(/watch for it below/i)).toBeInTheDocument()

    const post = fetchStub.mock.calls.find((call) => call[1]?.method === 'POST')!
    expect(urlOf(post[0])).toContain('/equipment/e1/loans')

    // Null rather than absent: no start date means "now", which is the
    // ordinary case of somebody standing in the lab.
    const body = bodyOf(post[1]) as Record<string, unknown>
    expect(body).toMatchObject({ note: 'Mounting the chassis', startAt: null })
    // A week out by default, because that is the item's own cap.
    expect(body.requestedDueAt).toBe(endOfDay(addDays(today(), 7)))
  })

  /**
   * The date box is filled in on picking rather than left empty. A required
   * field somebody has to notice is a required field somebody bounces off.
   */
  it('offers the item’s own cap as the return date, and says what it is', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/equipment': [item({ maxLoanDays: 3 })],
        '/me/loans': [],
      }),
    )

    render(<EquipmentPage />)
    await screen.findByText('Cordless drill')

    expect(screen.getByText(/up to 3 days at a time/i)).toBeInTheDocument()

    fireEvent.click(cardFor('cordless drill'))

    expect(screen.getByLabelText(/bringing it back by/i)).toHaveValue(
      addDays(today(), 3),
    )
  })

  it('refuses a window longer than the item allows, before the server has to', async () => {
    const fetchStub = stubFetch({
      '/equipment': [item({ maxLoanDays: 3 })],
      '/me/loans': [],
    })
    vi.stubGlobal('fetch', fetchStub)

    render(<EquipmentPage />)
    await screen.findByText('Cordless drill')
    fireEvent.click(cardFor('cordless drill'))

    fireEvent.change(screen.getByLabelText(/bringing it back by/i), {
      target: { value: addDays(today(), 9) },
    })

    expect(await screen.findByText(/longer than 3 days/i)).toBeInTheDocument()

    const before = fetchStub.mock.calls.length
    ask()

    expect(fetchStub.mock.calls).toHaveLength(before)
  })

  /**
   * The regression. A date box takes a year of four or more digits, so a slipped keystroke gives
   * `12345-08-14` — which `new Date` cannot parse, so the day count came out `NaN`,
   * `NaN > maxLoanDays` was false, and the cap check waved a three-hundred-millennium loan through.
   * The submit that followed threw a `RangeError` out of the click handler.
   */
  it('refuses a year with too many digits in it, in both boxes', async () => {
    const fetchStub = stubFetch({
      '/equipment': [item({ maxLoanDays: 3 })],
      '/me/loans': [],
    })
    vi.stubGlobal('fetch', fetchStub)

    render(<EquipmentPage />)
    await screen.findByText('Cordless drill')
    fireEvent.click(cardFor('cordless drill'))

    fireEvent.change(screen.getByLabelText(/bringing it back by/i), {
      target: { value: '12345-08-14' },
    })

    expect(
      await screen.findByText(/return date isn't a date — check the year/i),
    ).toBeInTheDocument()

    const before = fetchStub.mock.calls.length
    ask()
    expect(fetchStub.mock.calls).toHaveLength(before)

    // And the same in the start box, which is the one that used to make the
    // whole thing throw rather than merely pass.
    fireEvent.click(screen.getByRole('radio', { name: /reserve it for later/i }))
    fireEvent.change(screen.getByLabelText(/taking it from/i), {
      target: { value: '99999-01-01' },
    })

    expect(
      await screen.findByText(/start date isn't a date — check the year/i),
    ).toBeInTheDocument()

    ask()
    expect(fetchStub.mock.calls).toHaveLength(before)
  })

  it('bounds the boxes so the picker cannot reach past the cap', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/equipment': [item({ maxLoanDays: 3 })], '/me/loans': [] }),
    )

    render(<EquipmentPage />)
    await screen.findByText('Cordless drill')
    fireEvent.click(cardFor('cordless drill'))

    const due = screen.getByLabelText(/bringing it back by/i)
    expect(due).toHaveAttribute('min', today())
    expect(due).toHaveAttribute('max', addDays(today(), 3))

    fireEvent.click(screen.getByRole('radio', { name: /reserve it for later/i }))
    expect(screen.getByLabelText(/taking it from/i)).toHaveAttribute(
      'max',
      addDays(today(), 180),
    )
  })

  it('books a start date when the ask is for later', async () => {
    const fetchStub = stubFetch({
      '/equipment': [item()],
      '/me/loans': [],
      '/equipment/e1/loans': loan(),
    })
    vi.stubGlobal('fetch', fetchStub)

    render(<EquipmentPage />)
    await screen.findByText('Cordless drill')
    fireEvent.click(cardFor('cordless drill'))

    // No start box at all until it is a booking: somebody collecting it now
    // has no second date to give.
    expect(screen.queryByLabelText(/taking it from/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: /reserve it for later/i }))
    const start = addDays(today(), 10)
    fireEvent.change(screen.getByLabelText(/taking it from/i), {
      target: { value: start },
    })
    fireEvent.change(screen.getByLabelText(/bringing it back by/i), {
      target: { value: addDays(start, 4) },
    })
    ask()

    expect(await screen.findByText(/watch for it below/i)).toBeInTheDocument()

    const post = fetchStub.mock.calls.find((call) => call[1]?.method === 'POST')!
    expect(bodyOf(post[1])).toMatchObject({
      startAt: startOfDay(start),
      requestedDueAt: endOfDay(addDays(start, 4)),
    })
  })

  it('narrows the list to what was searched for', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/equipment': [
          item(),
          item({ id: 'e2', name: 'Heat gun', description: null }),
        ],
        '/me/loans': [],
      }),
    )

    render(<EquipmentPage />)
    await screen.findByText('Cordless drill')

    fireEvent.change(screen.getByLabelText(/search the lending list/i), {
      target: { value: 'heat' },
    })

    expect(screen.queryByText('Cordless drill')).not.toBeInTheDocument()
    expect(screen.getByText('Heat gun')).toBeInTheDocument()

    // The description is searched too — "the thing with the charger in it" is
    // how people remember a tool whose name they never learned.
    fireEvent.change(screen.getByLabelText(/search the lending list/i), {
      target: { value: 'charger' },
    })
    expect(screen.getByText('Cordless drill')).toBeInTheDocument()
    expect(screen.queryByText('Heat gun')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/search the lending list/i), {
      target: { value: 'submarine' },
    })
    expect(screen.getByText(/nothing on the list matches/i)).toBeInTheDocument()
  })

  it('lists my borrowing with where each one has got to', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/equipment': [item()],
        '/me/loans': [
          loan({ status: 'CHECKED_OUT', dueAt: '2026-08-20T23:59:00.000Z' }),
          loan({
            id: 'l2',
            status: 'DENIED',
            officerNote: 'It is in for repair.',
          }),
        ],
      }),
    )

    render(<EquipmentPage />)

    expect(await screen.findByText('WITH YOU')).toBeInTheDocument()
    expect(screen.getByText('DECLINED')).toBeInTheDocument()
    expect(screen.getByText(/in for repair/i)).toBeInTheDocument()
  })

  it('offers cancel only while an ask is undecided', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/equipment': [item()],
        '/me/loans': [loan({ status: 'CHECKED_OUT' })],
      }),
    )

    render(<EquipmentPage />)
    await screen.findByText('WITH YOU')

    expect(
      screen.queryByRole('button', { name: /cancel this request/i }),
    ).not.toBeInTheDocument()
  })

  it('names an unreachable API rather than showing an empty shelf', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<EquipmentPage />)

    await waitFor(() => {
      expect(
        screen.getByText(/couldn't load the equipment list/i),
      ).toBeInTheDocument()
    })
    // Crucially not "nothing is on the lending list yet" — that would read as
    // a fact about the club rather than a failure to ask.
    expect(screen.queryByText(/nothing is on the lending list/i)).not.toBeInTheDocument()
    consoleError.mockRestore()
  })
})
