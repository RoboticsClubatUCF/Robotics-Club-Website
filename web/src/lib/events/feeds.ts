import { apiBaseUrl } from '../api/api'

/**
 * Calendar subscription links, served by `server/src/routes/public/calendarFeeds.ts`.
 *
 * A subscription is the opposite of ADD TO CALENDAR's one-off copy: the app keeps re-reading
 * the feed, so a moved meeting or a cancellation reaches the person's phone without them doing
 * anything. The private feeds carry the person's token in the path because a calendar app
 * can't sign in.
 */
export type Feed =
  | { kind: 'club' }
  | { kind: 'project'; slug: string }
  | { kind: 'officers' }

export const isPrivateFeed = (feed: Feed) => feed.kind !== 'club'

/** The feed's https address. `token` is required for the private ones. */
export function feedUrl(feed: Feed, token = ''): string {
  const base = `${apiBaseUrl}/api/calendar`
  switch (feed.kind) {
    case 'club':
      return `${base}/club.ics`
    case 'project':
      return `${base}/${token}/projects/${encodeURIComponent(feed.slug)}.ics`
    case 'officers':
      return `${base}/${token}/officers.ics`
  }
}

/** `webcal://`, which Apple Calendar and desktop Outlook open as a subscription. */
export const webcalUrl = (url: string) => url.replace(/^https?:\/\//, 'webcal://')

/**
 * Google's subscribe prompt. Not documented by Google, and it only works for an https feed,
 * which the live site is.
 */
export const googleSubscribeUrl = (url: string) =>
  `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl(url))}`
