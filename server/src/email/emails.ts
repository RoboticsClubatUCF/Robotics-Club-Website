/**
 * The HTML the club actually sends.
 *
 * Email isn't the web and none of the site's tooling survives the trip: no Tailwind, no
 * stylesheet, no `@font-face`, and no `flex` or `grid` worth relying on. Outlook still renders
 * through Word. So this is tables, inline styles and hex literals — the one place in the codebase
 * where the rule about colour never appearing as a literal can't hold, because there's nowhere to
 * declare a token.
 *
 * The palette is `web/src/index.css` translated, with the two text tiers flattened against the
 * page colour. Alpha itself isn't safe here — several clients drop `rgba()` and land on black text
 * on a black background.
 */

const PAGE = '#0b0b0b'
const SURFACE = '#101010'
const RULE = '#232323'
const GOLD = '#ffc904'
const ON_GOLD = '#111111'
const WHITE = '#ffffff'
const DIM = '#9d9d9d'
const FAINT = '#717171'

/**
 * Space Grotesk and IBM Plex Mono are self-hosted for the site and cannot be
 * loaded here, so both stacks fall through to whatever the reader has. Naming
 * them first costs nothing and pays off for anyone who happens to have them.
 */
const SANS =
  "'Space Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const MONO =
  "'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"

/**
 * The token is base64url and cannot contain any of these, so this never
 * actually fires today. It is here because the day somebody adds a second query
 * parameter, an unescaped `&` silently truncates the link for every reader.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface VerificationEmail {
  html: string
  text: string
}

/**
 * One link email, in both renderings.
 *
 * The three messages this file sends — confirm your address, set a new password, confirm your new
 * address — are the same page with different words in it, so they share one builder rather than
 * three copies of a table layout that would drift the first time anybody adjusted the padding.
 *
 * Both bodies are built together and say the same thing, because they're two renderings of one
 * message rather than a real one and a fallback — plenty of people read mail as plain text on
 * purpose.
 *
 * The URL appears twice in the HTML on purpose: once as the button, once as copyable text
 * underneath. Buttons are the first thing a locked-down mail client strips.
 */
interface LinkEmail {
  /** The inbox preview line. Without one, clients pull the first text in the
      document, which is whatever the masthead happens to say. */
  preview: string
  /** The `/ EYEBROW`, matching the section headings on the site. */
  eyebrow: string
  heading: string
  /** The paragraph above the button. One sentence, two at most. */
  body: string
  button: string
  /** What happens if they wait too long, and where to ask for another. */
  expiryNote: string
  /**
   * The "if this was not you" line, and it is different in every message on
   * purpose. Ignoring a signup costs nothing because no account exists yet;
   * ignoring a password reset is a claim about somebody's live account, and
   * has to say outright that ignoring it changes nothing.
   */
  ignoreNote: string
}

function linkEmail(link: string, message: LinkEmail): VerificationEmail {
  const href = escapeHtml(link)

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<!-- Says the design is already dark, so the clients that auto-invert leave it
     alone instead of bleaching the gold to something illegible. -->
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(message.heading)}</title>
</head>
<body style="margin:0;padding:0;width:100%;background-color:${PAGE};">
<!-- The preview line in the inbox list. Without one, clients pull the first
     text in the document, which is whatever the masthead happens to say. -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;color:transparent;">${escapeHtml(message.preview)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAGE};">
<tr>
<td align="center" style="padding:32px 16px;">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:100%;max-width:560px;">

<tr>
<td style="padding-bottom:24px;">
<div style="font-family:${SANS};font-size:15px;font-weight:700;letter-spacing:0.06em;color:${WHITE};">ROBOTICS CLUB</div>
<div style="font-family:${MONO};font-size:10px;font-weight:500;letter-spacing:0.22em;color:${GOLD};padding-top:5px;">OF CENTRAL FLORIDA</div>
</td>
</tr>

<tr>
<td style="background-color:${SURFACE};border:1px solid ${RULE};padding:32px 28px;">

<div style="font-family:${MONO};font-size:11px;font-weight:600;letter-spacing:0.2em;color:${FAINT};padding-bottom:14px;">/ ${escapeHtml(message.eyebrow)}</div>

<h1 style="margin:0 0 14px;font-family:${SANS};font-size:26px;line-height:1.15;font-weight:700;letter-spacing:-0.02em;color:${WHITE};">${escapeHtml(message.heading)}</h1>

<p style="margin:0 0 26px;font-family:${SANS};font-size:15px;line-height:1.7;color:${DIM};">${escapeHtml(message.body)}</p>

<!-- Table-wrapped rather than a styled anchor: Outlook renders through Word,
     which ignores padding on an inline element and collapses the button to
     bare underlined text. -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
<td bgcolor="${GOLD}" style="border-radius:2px;">
<a href="${href}" style="display:inline-block;padding:15px 30px;font-family:${SANS};font-size:13px;font-weight:700;letter-spacing:0.04em;color:${ON_GOLD};text-decoration:none;">${escapeHtml(message.button)} &rarr;</a>
</td>
</tr>
</table>

<p style="margin:26px 0 8px;font-family:${SANS};font-size:13px;line-height:1.6;color:${FAINT};">Button not working? Copy this into your browser:</p>

<!-- break-all, or a 43-character token runs off the side of a phone and the
     half that is visible is the half nobody can use. -->
<p style="margin:0;font-family:${MONO};font-size:12px;line-height:1.6;color:${DIM};word-break:break-all;"><a href="${href}" style="color:${GOLD};text-decoration:underline;">${href}</a></p>

</td>
</tr>

<tr>
<td style="padding-top:22px;">
<p style="margin:0 0 14px;font-family:${SANS};font-size:13px;line-height:1.6;color:${FAINT};">${escapeHtml(message.expiryNote)}</p>
<p style="margin:0 0 20px;font-family:${SANS};font-size:13px;line-height:1.6;color:${FAINT};">${escapeHtml(message.ignoreNote)}</p>
<p style="margin:0;padding-top:18px;border-top:1px solid ${RULE};font-family:${MONO};font-size:10px;font-weight:500;letter-spacing:0.14em;color:${FAINT};">RCCF &middot; UNIVERSITY OF CENTRAL FLORIDA &middot; ORLANDO, FL</p>
</td>
</tr>

</table>

</td>
</tr>
</table>
</body>
</html>`

  const text = [
    'ROBOTICS CLUB OF CENTRAL FLORIDA',
    '',
    message.heading,
    '',
    message.body,
    '',
    link,
    '',
    message.expiryNote,
    '',
    message.ignoreNote,
  ].join('\n')

  return { html, text }
}

/** Confirm the address somebody has just signed up with. */
export function signupVerificationEmail(
  link: string,
  expiry: string,
): VerificationEmail {
  return linkEmail(link, {
    preview:
      'Confirm your address to finish setting up your Robotics Club account.',
    eyebrow: 'CONFIRM YOUR EMAIL',
    heading: 'One more step.',
    body: 'Confirm this address and you can finish setting up your account — your name, a password, and the Discord username we will add you under.',
    button: 'CONFIRM MY EMAIL',
    expiryNote: `The link is good for ${expiry}. If it expires, start again from the join page and we will send a new one.`,
    ignoreNote:
      'If you did not sign up, ignore this email — no account is created until the link is followed.',
  })
}

/**
 * Set a new password.
 *
 * Unlike the signup link, this one arrives at an account that already exists, so the ignore line
 * has to do real work: the reflex on receiving one unprompted is to click it and see what it does,
 * and the answer has to be that doing nothing is safe.
 */
export function passwordResetEmail(
  link: string,
  expiry: string,
): VerificationEmail {
  return linkEmail(link, {
    preview: 'Set a new password for your Robotics Club account.',
    eyebrow: 'RESET YOUR PASSWORD',
    heading: 'Set a new password.',
    body: 'Somebody asked to reset the password on the Robotics Club account for this address. Follow the link and you can choose a new one.',
    button: 'SET A NEW PASSWORD',
    expiryNote: `The link is good for ${expiry}. If it expires, ask for another from the sign-in page.`,
    ignoreNote:
      'If this was not you, ignore this email. Your password has not changed, and nobody can change it without following this link.',
  })
}

/**
 * Confirm a new address before it becomes the one somebody signs in with.
 *
 * Sent to the *new* address, which is the entire point of the flow: proving
 * somebody can read it is the only thing standing between a typo and an account
 * its owner can never sign into again.
 */
export function emailChangeEmail(
  link: string,
  expiry: string,
): VerificationEmail {
  return linkEmail(link, {
    preview:
      'Confirm this address to finish moving your Robotics Club account to it.',
    eyebrow: 'CONFIRM YOUR NEW EMAIL',
    heading: 'Confirm your new address.',
    body: 'This address was given as the new email for a Robotics Club account. Follow the link to confirm it — until you do, the account keeps the address it already had.',
    button: 'CONFIRM THIS ADDRESS',
    expiryNote: `The link is good for ${expiry}. If it expires, ask again from your profile page.`,
    ignoreNote:
      'If you were not expecting this, ignore this email. Nothing changes on any account unless the link is followed.',
  })
}
