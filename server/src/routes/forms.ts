import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { prisma } from '../db.js'
import { rateLimit } from '../rateLimit.js'

/**
 * Public write endpoints. These are unauthenticated, so they are the only way
 * an outsider can put rows in the database — hence the length caps and the
 * shared rate limit.
 *
 * Joining the club is not one of these: that is account signup, which will
 * create a User at the default GUEST role once auth exists.
 */
export const forms = new Hono()

const limit = rateLimit('forms')

const contactSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(200),
  subject: z.string().trim().max(200).optional(),
  message: z.string().trim().min(1).max(5000),
})

forms.post(
  '/contact',
  limit,
  zValidator('json', contactSchema),
  async (c) => {
    const { id } = await prisma.contactMessage.create({
      data: c.req.valid('json'),
      select: { id: true },
    })

    return c.json({ id, status: 'received' }, 201)
  },
)
