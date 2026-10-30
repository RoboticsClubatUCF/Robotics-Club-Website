import { beforeEach, describe, expect, it, vi } from 'vitest'
import { postChannelMessage, sendDirectMessage } from './discord.js'
import { notifyPrintChannel, notifyPrintOwner } from './printNotify.js'
import { PrintRequestStatus } from '../generated/prisma/enums.js'

const crew = vi.hoisted(() => ({ role: null as string | null }))

// Nothing here may reach Discord: the channel default is the club's real print channel.
vi.mock('./discord.js', () => ({
  discordConfigured: true,
  get printCrewRoleId() {
    return crew.role
  },
  postChannelMessage: vi.fn(() => Promise.resolve({ status: 'sent', messageId: '1' })),
  sendDirectMessage: vi.fn(() => Promise.resolve({ status: 'sent' })),
  checkDiscordHandle: vi.fn(),
}))

const post = vi.mocked(postChannelMessage)
const dm = vi.mocked(sendDirectMessage)

const owner = {
  id: 'u1',
  fullName: 'Ada Lovelace',
  discordId: '123456789012345678',
  discordUsername: 'ada',
}

const print = (status: PrintRequestStatus, startedAt: Date | null = null) => ({
  fileName: 'bracket.stl',
  status,
  startedAt,
  officerNote: null,
})

beforeEach(() => {
  crew.role = null
  post.mockClear()
  dm.mockClear()
})

describe('notifyPrintChannel', () => {
  it('posts into the print channel and DMs nobody', async () => {
    await notifyPrintChannel('new print')

    expect(post).toHaveBeenCalledWith('1204281218406027334', 'new print')
    expect(dm).not.toHaveBeenCalled()
  })

  it('mentions Print Crew when the role is set, and lets only that role ping', async () => {
    crew.role = '900000000000000008'

    await notifyPrintChannel('new print')

    expect(post).toHaveBeenCalledWith(
      '1204281218406027334',
      '<@&900000000000000008> new print',
      { mentionRoles: ['900000000000000008'] },
    )
  })
})

describe('notifyPrintOwner', () => {
  it('DMs the member who sent it', async () => {
    await notifyPrintOwner(owner, { ...print(PrintRequestStatus.DONE), officerNote: 'Shelf B' })

    expect(dm).toHaveBeenCalledTimes(1)
    const [to, content] = dm.mock.calls[0]!
    expect(to).toBe(owner.discordId)
    expect(content).toContain('Hi Ada')
    expect(content).toContain('bracket.stl is done')
    expect(content).toContain('Officer note: Shelf B')
  })

  it('tells a cancellation from a decline', async () => {
    await notifyPrintOwner(owner, print(PrintRequestStatus.REJECTED))
    await notifyPrintOwner(owner, print(PrintRequestStatus.REJECTED, new Date()))

    expect(dm.mock.calls[0]![1]).toContain('was declined')
    expect(dm.mock.calls[1]![1]).toContain('was cancelled')
  })

  it('sends nothing for a move back to the queue', async () => {
    await notifyPrintOwner(owner, print(PrintRequestStatus.PENDING))

    expect(dm).not.toHaveBeenCalled()
  })

  it('sends nothing to a member with no Discord on file', async () => {
    await notifyPrintOwner({ ...owner, discordId: null, discordUsername: null }, print(PrintRequestStatus.DONE))

    expect(dm).not.toHaveBeenCalled()
  })
})
