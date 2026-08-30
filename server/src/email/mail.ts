import { Models, ServerClient } from 'postmark'
import {
  emailChangeEmail,
  passwordResetEmail,
  signupVerificationEmail,
} from './emails.js'
import { env } from '../core/env.js'

/**
 * Outbound email. Four messages: the contact form notification, the signup
 * verification link, the password reset link, and the confirmation of a new
 * address.
 *
 * Configuration is optional, and unconfigured is a supported state rather than
 * a broken one — the club can take messages before it has a Postmark account,
 * because the row in `contact_messages` is the record and the email is a
 * notification on top of it. `env.ts` enforces all-or-nothing so there is no
 * half-configured middle where mail silently goes nowhere.
 *
 * The messages are unconfigured in different ways, and that difference is the
 * whole reason to read this file. A contact message with no mailer is still a
 * contact message. A link that is never sent is a flow nobody can finish, so
 * the three senders that carry one report whether they actually sent and let
 * the route decide what that means — see `routes/account/signup.ts`, which is where
 * that asymmetry is argued, and `routes/account/account.ts`, which copies it.
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
  const { html, text } = signupVerificationEmail(
    link,
    readableExpiry(env.SIGNUP_TOKEN_TTL_MINUTES),
  )

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

/**
 * Email somebody a link that sets a new password on their account.
 *
 * Reports whether anything was sent, exactly as the signup verification does
 * and for the same reason: this is not a courtesy on top of a stored record,
 * it *is* the flow, and a caller treating "no mailer" as success leaves
 * somebody waiting on an email that was never going to arrive.
 *
 * `ReplyTo` is the officers, because the person most likely to answer this
 * email is one whose second link has also not turned up.
 */
export async function sendPasswordReset(
  email: string,
  token: string,
): Promise<boolean> {
  if (!mailer) return false

  const link = `${env.passwordResetUrl}?token=${encodeURIComponent(token)}`
  const { html, text } = passwordResetEmail(
    link,
    readableExpiry(env.ACCOUNT_TOKEN_TTL_MINUTES),
  )

  await mailer.client.sendEmail({
    From: mailer.from,
    To: email,
    ReplyTo: mailer.to,
    Subject: 'Set a new password — Robotics Club of Central Florida',
    HtmlBody: html,
    TextBody: text,
    MessageStream: env.POSTMARK_MESSAGE_STREAM,
    // Off for the same reason signup's is: this href carries a credential, and
    // link tracking would rewrite it to a postmarkapp.com redirect — putting
    // the token in a third party's logs and showing a URL that looks nothing
    // like the club's on an email asking somebody to trust it.
    TrackLinks: Models.LinkTrackingOptions.None,
    TrackOpens: false,
  })

  return true
}

/**
 * Email the *new* address the link that makes it the account's address.
 *
 * To the new one, never the old: the whole job of this message is proving that
 * somebody can read the address they typed, and a confirmation sent anywhere
 * else proves nothing about it.
 */
export async function sendEmailChange(
  email: string,
  token: string,
): Promise<boolean> {
  if (!mailer) return false

  const link = `${env.emailChangeUrl}?emailToken=${encodeURIComponent(token)}`
  const { html, text } = emailChangeEmail(
    link,
    readableExpiry(env.ACCOUNT_TOKEN_TTL_MINUTES),
  )

  await mailer.client.sendEmail({
    From: mailer.from,
    To: email,
    ReplyTo: mailer.to,
    Subject: 'Confirm your new email — Robotics Club of Central Florida',
    HtmlBody: html,
    TextBody: text,
    MessageStream: env.POSTMARK_MESSAGE_STREAM,
    TrackLinks: Models.LinkTrackingOptions.None,
    TrackOpens: false,
  })

  return true
}

/**
 * "120 minutes" is a configuration value; "2 hours" is an answer.
 *
 * Takes the minutes rather than reading one setting, because there are two now
 * — signup links live longer than the two that take over an existing account.
 */
function readableExpiry(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`

  const hours = minutes / 60
  return hours === 1 ? 'an hour' : `${Number(hours.toFixed(1))} hours`
}
