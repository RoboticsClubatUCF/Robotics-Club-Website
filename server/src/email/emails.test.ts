import { describe, expect, it } from 'vitest'
import { signupVerificationEmail } from './emails.js'

/**
 * The verification email.
 *
 * Nothing here checks that it looks right — only a mail client can say that, and there are forty of
 * them. What is worth pinning is the handful of ways an HTML email silently stops working: the link
 * going missing from one of the two bodies, the button being the only way through, or a query
 * string getting cut in half by an unescaped ampersand.
 */

const LINK = 'https://rccf.example.org/join?token=abc-123_XYZ'

describe('signupVerificationEmail', () => {
  it('puts the link in both bodies', () => {
    const { html, text } = signupVerificationEmail(LINK, '2 hours')

    expect(html).toContain(LINK)
    // Plain text is not a fallback nobody sees: people read mail this way on
    // purpose, and the link has to survive the trip.
    expect(text).toContain(LINK)
  })

  /**
   * Locked-down clients strip the button, and a verification email whose only
   * affordance has been removed is a dead end. So the URL appears twice: once
   * as the button, once as text somebody can copy.
   */
  it('repeats the link as copyable text, not only as a button', () => {
    const { html } = signupVerificationEmail(LINK, '2 hours')

    expect(html.split(LINK).length - 1).toBeGreaterThanOrEqual(2)
    expect(html).toContain('Copy this into your browser')
  })

  it('carries the expiry it was given rather than a hardcoded one', () => {
    expect(signupVerificationEmail(LINK, '45 minutes').html).toContain(
      '45 minutes',
    )
    expect(signupVerificationEmail(LINK, '45 minutes').text).toContain(
      '45 minutes',
    )
  })

  /**
   * Today's tokens are base64url and contain none of this. The escaping is for
   * the day a second query parameter is added, where a raw `&` truncates the
   * href at that point and every link in every email quietly stops working.
   */
  it('escapes the href so a second parameter cannot truncate it', () => {
    const { html } = signupVerificationEmail(
      'https://rccf.example.org/join?token=abc&next=%2Fprojects',
      '2 hours',
    )

    expect(html).toContain('token=abc&amp;next=%2Fprojects')
    expect(html).not.toContain('token=abc&next')
  })

  /** Clients that auto-invert have to be told the design is already dark. */
  it('declares itself a dark design', () => {
    const { html } = signupVerificationEmail(LINK, '2 hours')

    expect(html).toContain('name="color-scheme" content="dark"')
    expect(html).toContain('name="supported-color-schemes" content="dark"')
  })

  it('is themed in the club palette rather than a stock template', () => {
    const { html } = signupVerificationEmail(LINK, '2 hours')

    // UCF gold on near-black, the same two colours the site is built from.
    expect(html).toContain('#ffc904')
    expect(html).toContain('#0b0b0b')
    expect(html).toContain('OF CENTRAL FLORIDA')
  })

  /**
   * Outlook renders through Word, which ignores padding on an inline element —
   * a styled `<a>` collapses to bare underlined text. The button has to be
   * wrapped in a table cell that carries the fill.
   */
  it('builds the button from a table cell so Outlook keeps it', () => {
    const { html } = signupVerificationEmail(LINK, '2 hours')

    expect(html).toMatch(/<td bgcolor="#ffc904"/)
  })
})
