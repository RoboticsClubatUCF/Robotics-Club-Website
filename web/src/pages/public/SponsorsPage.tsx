import { ContactForm } from '../../components/shared/ContactForm'
import { FormEyebrow, FormHeading } from '../../components/shared/formChrome'
import type { ApiSponsor, ApiSponsorship, SponsorTier } from '../../lib/api/api'
import { tierLabel } from '../../lib/sponsorship'
import { imageSrc } from '../../lib/media/storedFiles'
import { useApi } from '../../lib/api/useApi'

/**
 * `/sponsors` — the whole list, and the pitch.
 *
 * The front page's marquee shows the top five and links here; this is where the
 * rest of them are, and where somebody who pressed "Sponsor us" finds out what
 * that would mean. Two audiences on one page, which is why it runs in that
 * order: who already backs the club is the argument for backing it, so it goes
 * above the price list rather than under it.
 *
 * **Grouped by tier, and the server decides the ranking.** `GET /api/sponsors`
 * already orders by tier and then by name — that is why the marquee can ask for
 * "the top five" without knowing what a tier is worth — so this page groups the
 * response in the order it arrived instead of sorting it again. A ranking
 * written down twice is a ranking that ends up disagreeing with itself.
 *
 * **A tier with sponsors in it but no sheet still draws.** The two halves are
 * different tables — `sponsors`, and `sponsor_tier_offers` — so a level nobody
 * has priced yet appears in the list of sponsors and is absent from the price
 * list, which is the honest way round. A tier with a sheet and no sponsors is
 * normal and draws nothing up here.
 *
 * **Every word of the pitch is the club's now.** The tier amounts, the benefits
 * and the ways-to-help were four hardcoded objects in `content/sponsorship.ts`,
 * every one of them marked PLACEHOLDER, under a panel on the page saying so.
 * They are `GET /api/sponsorship` — written by officers at
 * `/dashboard/officer/sponsors` — and the panel is gone with them, because there
 * is no longer anything on this page the club did not write.
 *
 * **Each tier card carries its own supporters, and the roll above carries their
 * logos.** The two are deliberately not the same list. Up there the club is
 * thanking the companies that pay for the rover, at card size with artwork and a
 * sentence each; down here a name roll answers the only question the price list
 * raises — who else is at this level — and it names the empty ones out loud,
 * because a tier that simply says nothing reads as a tier that is closed.
 *
 * **Nothing published is a supported state and the page is built around it**,
 * the same way the hero is built around an empty slideshow. An unpriced page
 * says the tiers are not settled and points at the form, which is both true and
 * the thing a company reading it should do — and it is *also* where a failed
 * read lands, deliberately: "we have not published this" and "the API is down"
 * want the same sentence here, because both end in "ask an officer".
 *
 * The card is the partner section's rather than the marquee's: a fixed logo
 * well over a caption, at listing size. That is the third copy of the well
 * idiom on the site and the second deliberate one — the marquee's is 20rem wide
 * and loops, and forcing one component to be both would cost more than the
 * markup saves. See the well note in `.claude/docs/styling.md`.
 */

/** The server caps `limit` at 100, and the club has nothing like that many. */
const LIMIT = 100

const gridClass = 'bg-rule border-rule grid gap-px border wide:grid-cols-3'

export function SponsorsPage() {
  const sponsors = useApi<ApiSponsor[]>(`/sponsors?limit=${LIMIT}`)
  // The second half of the page, and a second request rather than a field on
  // the first: who backs the club and what backing it costs are different
  // questions for different readers, and the front page's marquee wants only
  // the one. Neither call blocks the other.
  const pitch = useApi<ApiSponsorship>('/sponsorship')

  const listed = sponsors.status === 'ready' ? sponsors.data : []
  // Loading, empty and failed all read as "nothing to print", which is what the
  // panels below are written for — see the note at the top of this file.
  const tiers = pitch.status === 'ready' ? pitch.data.tiers : []
  const inKind = pitch.status === 'ready' ? pitch.data.inKind : []
  const footnotes = pitch.status === 'ready' ? pitch.data.footnotes : null

  /**
   * The response, split into runs of one tier — it arrives already ordered, so
   * this is a grouping rather than a sort. A `Map` keeps insertion order, which
   * is the server's order, which is the ranking.
   */
  const byTier = listed.reduce((runs, sponsor) => {
    const run = runs.get(sponsor.tier)
    if (run) run.push(sponsor)
    else runs.set(sponsor.tier, [sponsor])
    return runs
  }, new Map<SponsorTier, ApiSponsor[]>())

  const groups = [...byTier.entries()]

  return (
    <>
      <section className="px-page py-12 wide:py-18">
        <div className="mb-9">
          <FormEyebrow>/ SPONSORS</FormEyebrow>
          <FormHeading>The people who make it possible.</FormHeading>
          <p className="text-dim max-w-[38rem] text-sm leading-[1.7] text-pretty">
            Dues cover the lab. Everything a competition actually costs —
            aluminium, motors, boards, an entry fee and a van to get there —
            comes from the companies and alumni below. If your company would like
            to be one of them, the tiers are further down and the form at the
            bottom reaches an officer.
          </p>
        </div>

        {sponsors.status === 'loading' && <SponsorsSkeleton />}

        {sponsors.status === 'error' && (
          <p className="border-rule text-faint border-t py-6.5 text-sm">
            Couldn&rsquo;t load the sponsors just now. Please try again later.
          </p>
        )}

        {sponsors.status === 'ready' &&
          (listed.length === 0 ? (
            <p className="border-rule text-faint border-t py-6.5 text-sm">
              {/* Not "the tiers below are open", which it used to say: with
                  nothing published there is nothing below to be open, and a
                  page that promises a price list it is not showing is worse
                  than one that names the way to ask. */}
              No sponsors are listed yet — which is an opening rather than a
              problem. The form at the bottom of this page reaches an officer.
            </p>
          ) : (
            <div className="space-y-9">
              {groups.map(([tier, inTier]) => (
                <div key={tier}>
                  <h2 className="text-faint mb-4 font-mono text-[13px] font-bold tracking-[0.2em]">
                    {tierLabel(tier)}
                  </h2>

                  <ul className={gridClass}>
                    {inTier.map((sponsor) => (
                      <li key={sponsor.id} className="flex">
                        <SponsorCard sponsor={sponsor} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
      </section>

      <section className="border-rule px-page border-t py-12 wide:py-18">
        <div className="mb-9">
          <h2 className="text-faint mb-5 font-mono text-[13px] font-bold tracking-[0.2em]">
            / SPONSORSHIP TIERS
          </h2>
          <p className="text-dim max-w-[38rem] text-sm leading-[1.7] text-pretty">
            Every level funds something specific. The club is a registered
            student organisation at UCF, so a sponsorship is handled through the
            university rather than paid to a group of students.
          </p>
        </div>

        {tiers.length === 0 ? (
          /* Nothing published, still loading, and a read that failed all land
             here on purpose. The three are different facts and they have one
             answer — ask an officer — and a visitor deciding whether to sponsor
             a robotics club is not owed the difference between them. */
          <p className="border-primary/35 bg-primary/5 text-dim max-w-[38rem] border p-4 text-[13px] leading-[1.6] text-pretty">
            The tiers aren&rsquo;t published here yet. Use the form at the bottom
            of this page and an officer will send you the current sheet.
          </p>
        ) : (
          <ul className="bg-rule border-rule grid gap-px border wide:grid-cols-2">
            {tiers.map((offer) => (
              <li key={offer.tier} className="bg-base-100 flex flex-col p-5">
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="text-primary font-mono text-[11px] font-medium tracking-[0.16em]">
                    {tierLabel(offer.tier)}
                  </h3>
                  <span className="text-faint font-mono text-[10px] font-medium tracking-[0.14em]">
                    {offer.amount}
                  </span>
                </div>

                {/* Most tiers have none. The club's sheet is an amount over a
                    list of what you get, so the sentence is drawn only when
                    somebody wrote one rather than left as an empty paragraph
                    holding the layout open. */}
                {offer.blurb && (
                  <p className="text-dim mt-3 text-[13px] leading-[1.55] text-pretty">
                    {offer.blurb}
                  </p>
                )}

                {/* A list, not a paragraph: what somebody is comparing across
                    the tiers is which lines each one has, and prose makes that
                    a reading exercise. Absent rather than empty when a level's
                    whole offer is its amount, which the desk allows on
                    purpose. */}
                {offer.benefits.length > 0 && (
                  <ul className="mt-4 space-y-1.5">
                    {offer.benefits.map((benefit) => (
                      <li
                        key={benefit}
                        className="text-dim grid grid-cols-[0.75rem_1fr] gap-2 text-[13px] leading-[1.5]"
                      >
                        <span
                          className="text-primary font-mono text-[11px]"
                          aria-hidden
                        >
                          +
                        </span>
                        {benefit}
                      </li>
                    ))}
                  </ul>
                )}

                {/* Pushed to the bottom of the card, so the rolls line up
                    across a row whose benefit lists are different lengths —
                    four cards with the supporters at four different heights is
                    four separate things to read rather than one comparison. */}
                <TierSupporters supporters={byTier.get(offer.tier) ?? []} />
              </li>
            ))}
          </ul>
        )}

        {/* The fine print, under the grid rather than in any one card: the same
            `*` is cited by two tiers, and the note about the sponsorship being
            tax-deductible is about all of them. `whitespace-pre-line` because
            the officer typed it as lines and the lines are the structure. */}
        {footnotes && (
          <p className="text-faint mt-6 max-w-[46rem] text-[12px] leading-[1.6] whitespace-pre-line text-pretty">
            {footnotes}
          </p>
        )}
      </section>

      {/* Drawn only when there is something in it, unlike the tiers above. That
          section answers the question a company arrived with, so it has to say
          something even when it is empty; this one is the club volunteering
          extra ways to say yes, and an empty heading over nothing is the sad
          version of that. */}
      {inKind.length > 0 && (
        <section className="border-rule px-page border-t py-12 wide:py-18">
          <div className="mb-9">
            <h2 className="text-faint mb-5 font-mono text-[13px] font-bold tracking-[0.2em]">
              / OTHER WAYS TO HELP
            </h2>
            <p className="text-dim max-w-[38rem] text-sm leading-[1.7] text-pretty">
              Not everything useful is money, and some of the best sponsorships
              the club has had never involved a cheque.
            </p>
          </div>

          <ul className="bg-rule border-rule grid gap-px border wide:grid-cols-3">
            {inKind.map((way) => (
              <li key={way.id} className="bg-base-100 p-5">
                <h3 className="text-base leading-tight font-semibold tracking-[-0.01em]">
                  {way.title}
                </h3>
                <p className="text-dim mt-2.5 text-[13px] leading-[1.55] text-pretty">
                  {way.blurb}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The site's one contact route, and its own copy already offers to talk
          about sponsoring — it was written for the FAQ, where the same form
          sits. Reused rather than reimplemented: `POST /api/contact` is rate
          limited and a second form would be a second set of field lengths to
          keep in step with `contactSchema`. */}
      <section className="border-rule px-page border-t py-12 wide:py-18">
        <div className="max-w-[34rem]">
          <ContactForm />
        </div>
      </section>
    </>
  )
}

/**
 * Who is at this level, at the foot of its card.
 *
 * **It says so when there is nobody**, which is the whole reason this is a
 * component and not an `&&`. A tier that silently prints no supporters looks
 * shut — the reader cannot tell "nobody yet" from "we stopped listing them" —
 * and "no sponsors at this tier yet" is an invitation where a blank space is a
 * closed door.
 *
 * Names only, deliberately. The roll at the top of the page is the club thanking
 * its sponsors, with logos and a line each; this answers "who else is in at
 * this price", and repeating the artwork here would make the same list twice on
 * one page rather than two lists doing different jobs. It does not link either:
 * the card above already links the ones that have a website, and a second
 * anchor to the same place is one more thing for somebody tabbing through.
 */
function TierSupporters({ supporters }: { supporters: ApiSponsor[] }) {
  return (
    <div className="border-rule mt-auto border-t pt-4">
      <p className="text-faint font-mono text-[10px] font-medium tracking-[0.16em]">
        CURRENT SUPPORTERS
      </p>

      {supporters.length === 0 ? (
        <p className="text-faint mt-2 text-[13px] leading-[1.5]">
          No sponsors at this tier yet.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {supporters.map((sponsor) => (
            <li key={sponsor.id} className="text-sm leading-[1.5] font-semibold">
              {sponsor.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * One sponsor, at listing size.
 *
 * The well is a fixed height whether or not there is artwork in it — the rule
 * every image well on this site follows — so a sponsor who sends a wordmark does
 * not make their card taller than the ones beside it. Taller than the marquee's
 * because these cards are the subject of their section rather than a passing row
 * of logos, and `object-contain` because what lands here is a wordmark and a
 * cropped logo looks like a mistake.
 */
function SponsorCard({ sponsor }: { sponsor: ApiSponsor }) {
  const body = (
    <>
      <div
        className={`border-rule flex h-28 shrink-0 items-center justify-center border-b p-5 ${
          sponsor.logoUrl ? 'bg-base-200' : 'bg-hatch'
        }`}
      >
        {sponsor.logoUrl ? (
          /* Decorative: the name is printed directly below, so announcing the
             logo too reads the sponsor out twice. */
          <img
            src={imageSrc(sponsor.logoUrl)}
            alt=""
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="text-faint font-mono text-[9px] font-medium tracking-[0.14em]">
            [ LOGO ]
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="group-hover:text-primary text-lg leading-tight font-semibold tracking-[-0.01em] transition-colors duration-200">
          {sponsor.name}
        </h3>

        {sponsor.blurb && (
          <p className="text-dim mt-2.5 text-[13px] leading-[1.55] text-pretty">
            {sponsor.blurb}
          </p>
        )}
      </div>
    </>
  )

  // A sponsor without a website is not a link — a dead anchor is worse than
  // plain text for anyone tabbing through. Same call the marquee makes.
  return sponsor.websiteUrl ? (
    <a
      href={sponsor.websiteUrl}
      target="_blank"
      rel="noreferrer noopener"
      /* Inset focus ring: the cards are flush with each other, so an outset one
         would be clipped by the neighbours on either side. */
      className="bg-base-100 hover:bg-wash focus-visible:bg-wash focus-visible:outline-primary group flex h-full w-full flex-col transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2"
    >
      {body}
    </a>
  ) : (
    <div className="bg-base-100 flex h-full w-full flex-col">{body}</div>
  )
}

/** A grid of empty cards at the real height, so the page doesn't jump. */
function SponsorsSkeleton() {
  return (
    <div aria-hidden>
      <div className="bg-base-300 mb-4 h-3.5 w-32 animate-pulse rounded-[2px]" />
      <ul className={gridClass}>
        {Array.from({ length: 3 }, (_, index) => (
          <li key={index} className="bg-base-100 flex flex-col">
            <div className="bg-base-300 h-28 w-full animate-pulse" />
            <div className="p-5">
              <div className="bg-base-300 h-5 w-36 animate-pulse rounded-[2px]" />
              <div className="bg-base-300 mt-3 h-2.5 w-full animate-pulse rounded-[2px]" />
              <div className="bg-base-300 mt-2 h-2.5 w-3/4 animate-pulse rounded-[2px]" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
