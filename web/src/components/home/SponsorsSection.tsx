import type { CSSProperties } from 'react'
import type { ApiSponsor, SponsorTier } from '../../lib/api'
import { useApi } from '../../lib/useApi'

/**
 * The club's top sponsors, on a strip that scrolls itself.
 *
 * "Top" is not computed here: `GET /api/sponsors` already orders by tier, so
 * asking for five rows is asking for the five highest. Keeping that on the
 * server means the ordering can change — a `sortOrder` column, a pinned
 * sponsor — without this component learning what a tier is worth. The full list
 * belongs on `/sponsors`, which is what the link in the header is for.
 */
const LIMIT = 5

/**
 * Cards on the track, at least. The loop works by translating the track back by
 * exactly one copy of the list, which is seamless only while the copies that
 * remain still cover the viewport — one copy of five cards is 1600px, and a wide
 * monitor is wider than that. Three copies clear roughly 3200px; a club with two
 * sponsors gets proportionally more of them.
 */
const MIN_CARDS = 15

const cardClass =
  'bg-base-100 hover:bg-wash group flex h-full w-full flex-col justify-between p-5 transition-colors duration-200'

/**
 * A hairline per card, on the card — not a `gap-px` over a `bg-rule` track like
 * the grids elsewhere. A gap between the copies would make the track a hair
 * wider than a whole number of cards, and the loop's translation would drift by
 * that half-pixel on every pass.
 *
 * The width caps at 20rem but gives way on a phone: a card exactly as wide as
 * the screen leaves nothing of its neighbour showing, and a strip that appears
 * to hold one card doesn't look like it moves. 82vw keeps the next one's edge in
 * frame. Every copy is still the same width, which is all the loop needs.
 */
const itemClass = 'border-rule flex w-[min(20rem,82vw)] shrink-0 border-r'

/** The wire format is the enum name; nobody wants to read the underscore. */
const tierLabel = (tier: SponsorTier) => tier.replace(/_/g, ' ')

export function SponsorsSection() {
  const sponsors = useApi<ApiSponsor[]>(`/sponsors?limit=${LIMIT}`)

  return (
    <section
      id="sponsors"
      /* No `border-t`: this is the first section under the stat strip, which
         draws its own bottom rule. */
      className="px-page scroll-mt-20 py-12 wide:py-18"
    >
      <div className="mb-9 flex items-baseline justify-between">
        <h2 className="text-faint font-mono text-[13px] font-bold tracking-[0.2em]">
          / OUR SPONSORS
        </h2>
        <a
          href="/sponsors"
          className="text-primary border-primary/40 hover:border-primary border-b pb-0.5 text-xs font-medium transition-colors duration-200"
        >
          Sponsor us
        </a>
      </div>

      {sponsors.status === 'loading' && <SponsorsSkeleton />}

      {sponsors.status === 'error' && (
        <p className="border-rule text-faint border-t py-6.5 text-sm">
          Couldn't load the sponsors just now. Please try again later.
        </p>
      )}

      {sponsors.status === 'ready' &&
        (sponsors.data.length === 0 ? (
          <p className="border-rule text-faint border-t py-6.5 text-sm">
            No sponsors are listed yet.
          </p>
        ) : (
          <SponsorMarquee sponsors={sponsors.data} />
        ))}
    </section>
  )
}

/**
 * The list, repeated until it is longer than any screen, sliding left by exactly
 * one copy and starting over. Because every copy is identical, the restart lands
 * on a frame identical to the one before it and the seam is invisible.
 *
 * It stops while the pointer is on it and while anything inside it has focus —
 * a card you are trying to read or click should not be moving. Under
 * `prefers-reduced-motion` it stops being a marquee at all: the animation is
 * off, the duplicate copies are dropped from the layout, and the strip becomes
 * an ordinary horizontal scroller, so the sponsors past the fold are still
 * reachable rather than lost with the movement.
 */
function SponsorMarquee({ sponsors }: { sponsors: ApiSponsor[] }) {
  const copies = Math.max(3, Math.ceil(MIN_CARDS / sponsors.length))

  return (
    <div className="border-rule overflow-hidden border motion-reduce:overflow-x-auto">
      <div
        className="animate-marquee flex w-max hover:[animation-play-state:paused] focus-within:[animation-play-state:paused] motion-reduce:animate-none"
        /* One copy's share of the whole track. The keyframe can't know how many
           copies it took to fill the screen, so the component tells it. */
        style={{ '--marquee-shift': `-${100 / copies}%` } as CSSProperties}
      >
        {Array.from({ length: copies }, (_, copy) => (
          <ul
            key={copy}
            className={copy === 0 ? 'flex' : 'flex motion-reduce:hidden'}
            aria-hidden={copy > 0 || undefined}
          >
            {sponsors.map((sponsor) => (
              <li key={sponsor.id} className={itemClass}>
                {/* The repeats render as plain cards. An `aria-hidden` subtree
                    holding tabbable links is the one thing worse than no
                    duplicate at all — focus would land somewhere a screen
                    reader has been told does not exist. */}
                <SponsorCard sponsor={sponsor} repeat={copy > 0} />
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  )
}

function SponsorCard({ sponsor, repeat }: { sponsor: ApiSponsor; repeat?: boolean }) {
  const body = (
    <>
      <div>
        {/* The logo well is a fixed height whether or not there is a logo in it,
            so a sponsor who sends artwork does not make their card taller than
            the ones beside it. The hatch is the two off-black surface tones —
            the same "nothing here yet" language the build-night photo used —
            rather than a broken-image icon. */}
        <div
          className={`border-rule flex h-20 items-center justify-center border p-2.5 ${
            sponsor.logoUrl ? 'bg-base-200' : 'bg-hatch'
          }`}
        >
          {sponsor.logoUrl ? (
            /* Decorative: the name is printed directly below, so announcing the
               logo too would read the sponsor out twice. */
            <img
              src={sponsor.logoUrl}
              alt=""
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="text-faint font-mono text-[9px] font-medium tracking-[0.14em]">
              [ LOGO ]
            </span>
          )}
        </div>

        <div className="text-faint mt-4 font-mono text-[9px] font-medium tracking-[0.16em]">
          {tierLabel(sponsor.tier)}
        </div>
        <div className="group-hover:text-primary mt-2 text-lg leading-tight font-semibold tracking-[-0.01em] transition-colors duration-200">
          {sponsor.name}
        </div>
      </div>

      {sponsor.blurb && (
        <p className="text-dim mt-4 text-[13px] leading-[1.55] text-pretty">
          {sponsor.blurb}
        </p>
      )}
    </>
  )

  // A sponsor without a website is not a link — a dead anchor is worse than
  // plain text for anyone tabbing through.
  return sponsor.websiteUrl && !repeat ? (
    <a
      href={sponsor.websiteUrl}
      target="_blank"
      rel="noreferrer noopener"
      /* Inset focus ring: the cards are flush with each other, so an outset one
         would be clipped by the neighbours on either side. */
      className={`${cardClass} focus-visible:bg-wash focus-visible:outline-primary focus-visible:outline-2 focus-visible:-outline-offset-2`}
    >
      {body}
    </a>
  ) : (
    <div className={cardClass}>{body}</div>
  )
}

/** A still strip at the real height, so the section doesn't jump when it lands. */
function SponsorsSkeleton() {
  return (
    <div className="border-rule overflow-hidden border" aria-hidden>
      <div className="flex w-max">
        {Array.from({ length: LIMIT }, (_, index) => (
          <div key={index} className={itemClass}>
            <div className={cardClass}>
              <div>
                <div className="bg-base-300 h-20 w-full animate-pulse rounded-[2px]" />
                <div className="bg-base-300 mt-4 h-2 w-14 animate-pulse rounded-[2px]" />
                <div className="bg-base-300 mt-2 h-5 w-32 animate-pulse rounded-[2px]" />
              </div>
              <div className="mt-4 space-y-2">
                <div className="bg-base-300 h-2.5 w-full animate-pulse rounded-[2px]" />
                <div className="bg-base-300 h-2.5 w-3/4 animate-pulse rounded-[2px]" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
