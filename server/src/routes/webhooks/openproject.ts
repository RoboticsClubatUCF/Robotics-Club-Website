import { createHash, timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { validate } from '../../core/validate.js'
import { sendDirectMessage } from '../../discord/discord.js'

/**
 * The club's OpenProject, which knows people by email, asking about members.
 *
 *   POST /api/openproject/member   { "email" }             → { member: boolean }
 *   POST /api/openproject/notify   { "email", "content" }  → the bot DMs it
 *
 * Both take `Authorization: Bearer <OPENPROJECT_SECRET>`. POST rather than GET for the
 * lookup, so an address never lands in a URL or an access log.
 *
 * `member` gates OpenProject's sign-up: an active account with that email, which the site
 * only stores once it has been proved. `notify` answers 200 when it's final (`sent`,
 * `no_member`, `refused`); 502 (Discord didn't answer) and 503 (no bot or no secret here)
 * are worth a retry.
 */
export const openproject = new Hono()

const email = z.string().trim().min(3).max(254)

/** Hashing both first keeps the comparison constant-time whatever the lengths. */
const sameSecret = (given: string, expected: string) =>
  timingSafeEqual(
    createHash('sha256').update(given).digest(),
    createHash('sha256').update(expected).digest(),
  )

openproject.use('*', async (c, next) => {
  const secret = env.OPENPROJECT_SECRET

  if (!secret) {
    console.error('openproject: refused — OPENPROJECT_SECRET is not configured')
    return c.json({ error: 'The OpenProject connection is not configured.' }, 503)
  }

  const header = c.req.header('authorization') ?? ''
  const given = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''

  if (!given || !sameSecret(given, secret)) {
    return c.json({ error: 'not authorised' }, 401)
  }

  await next()
})

const findMember = (address: string) =>
  prisma.user.findFirst({
    where: { email: { equals: address, mode: 'insensitive' }, active: true },
    select: { id: true, discordId: true },
  })

openproject.post('/member', validate('json', z.object({ email })), async (c) => {
  const member = await findMember(c.req.valid('json').email)
  return c.json({ member: member !== null })
})

openproject.post(
  '/notify',
  validate(
    'json',
    // 2000 is Discord's limit for one message.
    z.object({ email, content: z.string().trim().min(1).max(2000) }),
  ),
  async (c) => {
    const { email: address, content } = c.req.valid('json')
    const member = await findMember(address)

    if (!member?.discordId) return c.json({ status: 'no_member' })

    const delivery = await sendDirectMessage(member.discordId, content)

    switch (delivery.status) {
      case 'sent':
        return c.json({ status: 'sent' })
      case 'refused':
        console.warn(`openproject notify: user ${member.id} refused the DM: ${delivery.reason}`)
        return c.json({ status: 'refused', reason: delivery.reason })
      case 'unavailable':
        console.warn(`openproject notify: Discord unavailable for user ${member.id}: ${delivery.reason}`)
        return c.json({ error: delivery.reason }, 502)
      case 'unchecked':
        return c.json({ error: 'The Discord bot is not configured.' }, 503)
    }
  },
)
