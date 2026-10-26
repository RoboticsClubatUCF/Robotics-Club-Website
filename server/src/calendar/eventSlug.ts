import { randomBytes } from 'node:crypto'

/**
 * Slugs are generated, not chosen: they exist because the Event model demands
 * uniqueness for the public site's URLs, and asking a lead to invent one for
 * every weekly meeting is busywork with a 409 waiting at the end. Four random
 * bytes make "kickoff" and next term's "kickoff" coexist.
 */
export const eventSlug = (title: string) => {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'event'
  return `${base}-${randomBytes(4).toString('hex')}`
}
