import { Models, ServerClient } from 'postmark'
import { signupVerificationEmail } from './emails.js'
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

  const link = `${env.signupVerifyUrl}?token=${encodeURIComponent(token)}`
  const { html, text } = signupVerificationEmail(link, readableExpiry())

  await mailer.client.sendEmail({
    From: mailer.from,
    To: email,
    // Replies go to the officers, not into the void. Someone whose link has
    // expired twice will answer this email rather than try a third time.
    ReplyTo: mailer.to,
    Subject: 'Confirm your email — Robotics Club of Central Florida',
    HtmlBody: html,
    TextBody: text,
    MessageStream: env.POSTMARK_MESSAGE_STREAM,
    // Off, explicitly, whatever the server's default is set to. Link tracking
    // rewrites every href to a postmarkapp.com redirect, and this href carries
    // a credential — it would put the token in a third party's logs, hand the
    // student a URL that looks nothing like the club's site on the one email
    // where they are being asked to trust it, and replace the copyable
    // fallback URL with an opaque tracking link.
    TrackLinks: Models.LinkTrackingOptions.None,
    // A verification email is not a campaign. Nobody needs to know whether it
    // was opened, and the pixel is one more thing for a filter to dislike.
    TrackOpens: false,
  })

  return true
}

/** "120 minutes" is a configuration value; "2 hours" is an answer. */
function readableExpiry(): string {
  const minutes = env.SIGNUP_TOKEN_TTL_MINUTES
  if (minutes < 60) return `${minutes} minutes`

  const hours = minutes / 60
  return hours === 1 ? 'an hour' : `${Number(hours.toFixed(1))} hours`
}
