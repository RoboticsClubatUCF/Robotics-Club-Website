import { ServerClient } from 'postmark'
import { env } from './env.js'

/**
 * Outbound email. Two messages: the contact form notification, and the signup
 * verification link.
 *
 * Configuration is optional, and unconfigured is a supported state rather than
 * a broken one — the club can take messages before it has a Postmark account,
 * because the row in `contact_messages` is the record and the email is a
 * notification on top of it. `env.ts` enforces all-or-nothing so there is no
 * half-configured middle where mail silently goes nowhere.
 *
 * The two messages are unconfigured in different ways, and that difference is
 * the whole reason to read this file. A contact message with no mailer is still
 * a contact message. A verification link that is never sent is a signup nobody
 * can finish, so `sendSignupVerification` reports whether it actually sent and
 * the route decides what that means — see `routes/signup.ts`.
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

/**
 * Email somebody the link that proves they can read the address they gave.
 *
 * Returns whether anything was actually sent. Unlike the contact notification
 * this is not a nicety on top of a stored record — it *is* the flow, and a
 * caller that treats "no mailer" as success would leave people waiting on an
 * email that was never going to arrive.
 *
 * The link points at the frontend rather than at this API, which buys one thing
 * worth having: the token is spent by a POST the join page makes, not by the
 * GET that opens it. Corporate mail scanners and link previewers follow every
 * URL in an incoming message, and against a plain GET endpoint that means the
 * verification is used up before the student ever clicks it.
 */
export async function sendSignupVerification(
  email: string,
  token: string,
): Promise<boolean> {
  if (!mailer) return false

  const link = `${env.SIGNUP_VERIFY_URL}?token=${encodeURIComponent(token)}`
  const hours = env.SIGNUP_TOKEN_TTL_MINUTES / 60
  const expiry =
    env.SIGNUP_TOKEN_TTL_MINUTES < 60
      ? `${env.SIGNUP_TOKEN_TTL_MINUTES} minutes`
      : `${hours % 1 === 0 ? hours : hours.toFixed(1)} hours`

  await mailer.client.sendEmail({
    From: mailer.from,
    To: email,
    // Replies go to the officers, not into the void. Someone whose link has
    // expired twice will answer this email rather than try a third time.
    ReplyTo: mailer.to,
    Subject: 'Confirm your email — Robotics Club of Central Florida',
    TextBody: [
      'Welcome to the Robotics Club of Central Florida.',
      '',
      'Confirm this address to finish setting up your account:',
      link,
      '',
      `The link is good for ${expiry}. If it expires, start again from the join page and we'll send a new one.`,
      '',
      "If you didn't sign up, ignore this email — no account is created until the link is followed.",
    ].join('\n'),
    MessageStream: env.POSTMARK_MESSAGE_STREAM,
  })

  return true
}
