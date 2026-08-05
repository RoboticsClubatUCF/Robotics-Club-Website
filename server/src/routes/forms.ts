import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { prisma } from '../db.js'
import { sendContactNotification } from '../mail.js'
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
    const contact = c.req.valid('json')

    const { id } = await prisma.contactMessage.create({
      data: contact,
      select: { id: true },
    })

    // Notify after the write and never instead of it. The row is the record: a
    // message that was stored and then failed to send must still be there for
    // someone to find, and the sender must not be told it failed once it is
    // safely in the table.
    //
    // Deliberately not awaited. Postmark is a network call to somebody else's
    // service, and the sender should not wait on it — or see an error because
    // of it. An unhandled rejection would take the process down, hence the
    // explicit catch; the log is the thing to grep when a reply never arrives.
    void sendContactNotification({ id, ...contact }).catch((error: unknown) => {
      console.error(`contact ${id}: notification failed`, error)
    })

    return c.json({ id, status: 'received' }, 201)
  },
)
