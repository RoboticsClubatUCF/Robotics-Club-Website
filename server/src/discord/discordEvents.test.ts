import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../core/db.js'
import type { ScheduledEventBody } from './discord.js'

/**
 * The Discord copy of the public calendar. Discord itself is mocked: unmocked, this would put
 * fixtures on the club's real server.
 *
 * Fixtures and the clock are in 2035, so no real event is in the window, and Discord ids are
 * prefixed so the rows can be found and cleared. The suite refuses to run over a table holding
 * rows it didn't write, since a pass acts on every row.
 */

vi.mock('./discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./discord.js')>()),
  writeScheduledEvent: vi.fn(),
  deleteScheduledEvent: vi.fn(),
}))

const { deleteScheduledEvent, writeScheduledEvent } = await import('./discord.js')
const { forgetRefusedCreates, syncDiscordEvents, WRITE_BUDGET } = await import(
  './discordEvents.js'
)

const PREFIX = 'test-dsync-'
const NOW = new Date('2035-06-01T12:00:00Z')
const HOUR_MS = 60 * 60 * 1000
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR_MS)

let created = 0

const clearRows = async () => {
  await prisma.discordScheduledEvent.deleteMany({
    where: { discordEventId: { startsWith: PREFIX } },
  })
  await prisma.event.deleteMany({ where: { slug: { startsWith: PREFIX } } })
}

const event = (slug: string, data: Record<string, unknown> = {}) =>
  prisma.event.create({
    data: {
      slug: `${PREFIX}${slug}`,
      title: `Sync ${slug}`,
      startsAt: at(48),
      published: true,
      ...data,
    },
  })

const write = vi.mocked(writeScheduledEvent)
const remove = vi.mocked(deleteScheduledEvent)

const rowFor = (eventId: string) =>
  prisma.discordScheduledEvent.findUnique({ where: { eventId } })

beforeAll(async () => {
  const foreign = await prisma.discordScheduledEvent.count({
    where: { NOT: { discordEventId: { startsWith: PREFIX } } },
  })
  if (foreign > 0) {
    throw new Error(
      `discord_scheduled_events holds ${String(foreign)} real row(s); run this suite against a database without them`,
    )
  }
})

beforeEach(async () => {
  await clearRows()
  forgetRefusedCreates()
  created = 0
  write.mockReset()
  remove.mockReset()
  write.mockImplementation((id) => {
    if (id) return Promise.resolve({ status: 'done', id })
    created += 1
    return Promise.resolve({ status: 'done', id: `${PREFIX}${String(created)}` })
  })
  remove.mockResolvedValue({ status: 'done', id: '' })
})

afterAll(async () => {
  await clearRows()
  await prisma.$disconnect()
})

describe('syncDiscordEvents', () => {
  it('creates a scheduled event for each upcoming published event', async () => {
    const open = await event('open', { location: 'Engineering II', description: 'Come by' })
    await event('private', { published: false })
    await event('started', { startsAt: at(-1), endsAt: at(2) })

    const report = await syncDiscordEvents(NOW)

    expect(report).toMatchObject({ created: 1, stopped: null })
    expect(write).toHaveBeenCalledTimes(1)
    const [id, body] = write.mock.calls[0]!
    expect(id).toBeNull()
    expect(body).toEqual<ScheduledEventBody>({
      name: 'Sync open',
      description: 'Come by',
      scheduled_start_time: at(48).toISOString(),
      // No end on the row, so Discord gets an hour.
      scheduled_end_time: at(49).toISOString(),
      privacy_level: 2,
      entity_type: 3,
      entity_metadata: { location: 'Engineering II' },
    })
    expect(await rowFor(open.id)).toMatchObject({ discordEventId: `${PREFIX}1` })
  })

  it('writes nothing when nothing changed', async () => {
    await event('open')
    await syncDiscordEvents(NOW)
    write.mockClear()

    expect(await syncDiscordEvents(NOW)).toMatchObject({ created: 0, updated: 0 })
    expect(write).not.toHaveBeenCalled()
  })

  it('edits the Discord copy when the event changes', async () => {
    const open = await event('open')
    await syncDiscordEvents(NOW)
    await prisma.event.update({ where: { id: open.id }, data: { title: 'Sync renamed' } })

    expect(await syncDiscordEvents(NOW)).toMatchObject({ updated: 1 })
    expect(write).toHaveBeenLastCalledWith(
      `${PREFIX}1`,
      expect.objectContaining({ name: 'Sync renamed', entity_metadata: { location: 'TBA' } }),
    )
  })

  it('deletes the copy when the event is unpublished or deleted', async () => {
    const one = await event('one')
    const two = await event('two', { startsAt: at(72) })
    await syncDiscordEvents(NOW)

    await prisma.event.update({ where: { id: one.id }, data: { published: false } })
    await prisma.event.delete({ where: { id: two.id } })

    expect(await syncDiscordEvents(NOW)).toMatchObject({ deleted: 2 })
    expect(remove).toHaveBeenCalledWith(`${PREFIX}1`)
    expect(remove).toHaveBeenCalledWith(`${PREFIX}2`)
    expect(await rowFor(one.id)).toBeNull()
    expect(await rowFor(two.id)).toBeNull()
  })

  it('lets go of a finished event without asking Discord, which ended it', async () => {
    const open = await event('open', { endsAt: at(50) })
    await syncDiscordEvents(NOW)

    expect(await syncDiscordEvents(at(51))).toMatchObject({ dropped: 1, deleted: 0 })
    expect(remove).not.toHaveBeenCalled()
    expect(await rowFor(open.id)).toBeNull()
  })

  it('puts back a copy somebody deleted in Discord', async () => {
    const open = await event('open')
    await syncDiscordEvents(NOW)
    await prisma.event.update({ where: { id: open.id }, data: { title: 'Sync renamed' } })
    write.mockResolvedValueOnce({ status: 'gone' })

    expect(await syncDiscordEvents(NOW)).toMatchObject({ created: 1 })
    expect(await rowFor(open.id)).toMatchObject({ discordEventId: `${PREFIX}2` })
  })

  it('stops the pass without a row when Discord refuses the permission', async () => {
    const open = await event('open')
    await event('later', { startsAt: at(72) })
    write.mockResolvedValue({ status: 'refused', code: 403, reason: 'Missing Permissions' })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await syncDiscordEvents(NOW)).toMatchObject({ created: 0, stopped: 'refused' })
    expect(write).toHaveBeenCalledTimes(1)
    expect(await rowFor(open.id)).toBeNull()
  })

  it('asks once about a body Discord rejects, until the event changes', async () => {
    const open = await event('open')
    write.mockResolvedValue({ status: 'refused', code: 400, reason: 'Invalid Form Body' })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await syncDiscordEvents(NOW)
    await syncDiscordEvents(NOW)
    expect(write).toHaveBeenCalledTimes(1)

    await prisma.event.update({ where: { id: open.id }, data: { title: 'Sync fixed' } })
    await syncDiscordEvents(NOW)
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('spends at most its budget per pass and finishes on the next', async () => {
    for (let index = 0; index < WRITE_BUDGET + 2; index += 1) {
      await event(`e${String(index)}`, { startsAt: at(48 + index) })
    }

    expect(await syncDiscordEvents(NOW)).toMatchObject({
      created: WRITE_BUDGET,
      stopped: 'budget',
    })
    expect(await syncDiscordEvents(NOW)).toMatchObject({ created: 2, stopped: null })
  })
})
