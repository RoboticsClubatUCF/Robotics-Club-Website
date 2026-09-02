import type { ReactNode } from 'react'
import { profileSiteName } from '../../lib/format/profileLink'

/**
 * The square a face sits in, and the link out of it where there is one.
 *
 * Two pages draw a grid of photographs — the officer board and `/members` — and
 * both of them now answer the same question when somebody clicks a face: take
 * me to that person. Where the member has given a profile link the frame *is*
 * the anchor; where they have not it is a plain box, exactly as it was. Nothing
 * else about either card changes, which is why this takes the frame's classes
 * rather than owning them: the board's square and the roster's square are the
 * same square on purpose, and neither page has given up the right to say so.
 *
 * **The link needs a name and the photograph cannot give it one.** Every avatar
 * on this site is `alt=""` because the person's name is printed directly
 * underneath and announcing the image would read them out twice — which is
 * right for a picture and useless for a link, whose whole accessible name would
 * then be the empty string. So the anchor carries "Jane Doe on LinkedIn",
 * assembled here, and the image stays decorative.
 *
 * `rel` is four values and each earns its place. `noopener` and `noreferrer`
 * are the site's standing pair for anything opening in a new tab. `nofollow`
 * and `ugc` are here because this is the one link on the site whose destination
 * an ordinary member chose: they say the club is not vouching for it, which is
 * true and is the point of the allowlist behind it as well.
 */
export function ProfileFrame({
  profileUrl,
  name,
  className,
  children,
}: {
  /**
   * Where their photograph points, already through the server's allowlist. Null
   * — the ordinary case — draws the plain frame.
   */
  profileUrl: string | null
  /** Whose face it is, for the link's name. */
  name: string
  /** The frame's own classes, from whichever page is drawing it. */
  className: string
  children: ReactNode
}) {
  const site = profileUrl ? profileSiteName(profileUrl) : null

  // `site` null means the stored address would not parse, which the server
  // cannot write — a hand-edited row, then. Drawing the frame without the link
  // is the failure worth having; an anchor to an address nothing could read is
  // not.
  if (!profileUrl || !site) return <div className={className}>{children}</div>

  return (
    <a
      href={profileUrl}
      target="_blank"
      rel="noreferrer noopener nofollow ugc"
      aria-label={`${name} on ${site}`}
      className={`${className} focus-visible:outline-primary transition-opacity duration-200 hover:opacity-80 focus-visible:outline-2 focus-visible:-outline-offset-2`}
    >
      {children}
    </a>
  )
}
