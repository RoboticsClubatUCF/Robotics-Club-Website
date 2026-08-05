import { ServerClient } from 'postmark'
import { env } from './env.js'

/**
 * Outbound email. One message so far: the contact form notification.
 *
 * Configuration is optional, and unconfigured is a supported state rather than
 * a broken one — the club can take messages before it has a Postmark account,
 * because the row in `contact_messages` is the record and the email is a
 * notification on top of it. `env.ts` enforces all-or-nothing so there is no
 * half-configured middle where mail silently goes nowhere.
 */

const { POSTMARK_TOKEN, CONTACT_FROM_EMAIL, CONTACT_TO_EMAIL } = env

const mailer =
  POSTMARK_TOKEN && CONTACT_FROM_EMAIL && CONTACT_TO_EMAIL
    ? {
        client: new ServerClient(POSTMARK_TOKEN),
        from: CONTACT_FROM_EMAIL,
        to: CONTACT_TO_EMAIL,
      }
    : null

/** Whether anything will actually be sent. Logged at startup so it is visible. */
export const mailConfigured = mailer !== null

/**
 * Strip anything that would break out of a header.
 *
 * `name` and `subject` are user input and land in `ReplyTo` and `Subject`.
 * Postmark takes JSON rather than raw SMTP, so this is not the classic header
 * injection, but a subject containing newlines is still malformed mail and a
 * name containing angle brackets still corrupts an address. Cheap to prevent,
 * and the stored row keeps whatever was actually typed.
 */
const headerSafe = (value: string) => value.replace(/[\r\n<>]+/g, ' ').trim()

export interface ContactNotification {
  id: string
  name: string
  email: string
  subject?: string | null
  message: string
}

export async function sendContactNotification(
  contact: ContactNotification,
): Promise<void> {
  if (!mailer) return

  const name = headerSafe(contact.name)
  const subject = contact.subject ? headerSafe(contact.subject) : ''

  await mailer.client.sendEmail({
    From: mailer.from,
    To: mailer.to,
    // Replying goes to whoever wrote in, not back to the site's own address.
    // Without this, answering means copying the address out of the body.
    ReplyTo: contact.email,
    Subject: subject
      ? `[RCCF contact] ${subject}`
      : `[RCCF contact] Message from ${name}`,
    TextBody: [
      `From: ${name} <${contact.email}>`,
      subject ? `Subject: ${subject}` : null,
      '',
      contact.message,
      '',
      // The id is what turns "someone emailed us" into a row you can find.
      `— contact_messages.id ${contact.id}`,
    ]
      .filter((line) => line !== null)
      .join('\n'),
    MessageStream: env.POSTMARK_MESSAGE_STREAM,
  })
}
