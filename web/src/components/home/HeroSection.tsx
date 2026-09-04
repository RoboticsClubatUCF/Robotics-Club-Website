import { Link } from 'react-router'
import outlineUrl from '../../assets/rccf-logo-outline.png'
import type { ApiFrontPage, ApiHeroSlide } from '../../lib/api/api'
import type { ApiState } from '../../lib/api/useApi'
import { useApi } from '../../lib/api/useApi'
import { HeroSlideshow } from './HeroSlideshow'
import { LabStatus } from './LabStatus'

/**
 * What the hero says when the request for it didn't land.
 *
 * Only when it failed, never while it's still out. The two states are genuinely different: an
 * answer that hasn't come back yet is a headline nobody has been told is wrong, so the hero
 * holds its shape and fills in; one that will never come back would leave a permanent pulse
 * where the largest words on the site go.
 *
 * It's a copy of what the club currently leads with, and it's allowed to go stale — the day it
 * does is a day the API is unreachable. Kept here rather than in `content/home.ts` because it
 * isn't the copy: the copy is a row that officers write, and this is what to draw when nothing
 * answered.
 */
const UNREACHABLE = {
  headline: 'Building Our Future,',
  headlineAccent: 'One Robot at a Time.',
  lede: "Ready to dive into hands-on engineering? Whether you are a master at CAD, an experienced coder, or just eager to learn how to build complex systems from the ground up, there's a place for you on our team. Get involved and start building with us today.",
}

/**
 * The headline, and the club's photographs beside it.
 *
 * The right half used to be artwork and is now content. Two rings and a wireframe trace of the
 * mark were what the hero had instead of a picture, which was the right answer while nothing
 * here could hold one; officers put photographs there now without a deploy.
 *
 * The artwork is still what shows when there are no photographs — see below for why that's a
 * state worth keeping rather than a fallback nobody meets.
 *
 * The headline moved the same way. It was two lines and a paragraph in `content/home.ts`, which
 * made changing what the club leads with a pull request; it's a row now, and `HomePage` hands it
 * down.
 */
export function HeroSection({ copy }: { copy: ApiState<ApiFrontPage> }) {
  const slides = useApi<ApiHeroSlide[]>('/hero-slides')
  const showing = slides.status === 'ready' ? slides.data : []

  /**
   * The decoration, drawn only once the answer is in and the answer is "none".
   *
   * Not while loading, which is the detail that matters: rings drawn on the way to a photograph
   * would be a visible swap on every cold load. An empty right half for the length of one
   * request is invisible; a ring dissolving into a robot is not.
   *
   * A failed request lands here too, deliberately. Every other panel degrades to a short message,
   * because "no events" and "we can't reach the server" are different things somebody may act
   * on. Here they aren't: nobody comes to the landing page to find out whether the club has
   * uploaded photographs.
   */
  const decorated = slides.status !== 'loading' && showing.length === 0

  /**
   * Three states and two answers. A request still out is drawn rather than written — `Waiting` is
   * sized in `em` of the type it stands in for, so the hero is exactly as tall before the copy
   * lands as after. That matters more here than anywhere: this is the top of the page, and
   * anything that grows pushes everything under it down while somebody is reaching for a button.
   */
  const words = copy.status === 'ready' ? copy.data : UNREACHABLE
  const waiting = copy.status === 'loading'

  return (
    <section
      id="top"
      className="px-page relative overflow-hidden pt-14 pb-12 wide:pt-24 wide:pb-19"
    >
      {decorated && (
        <>
          {/* Two concentric rings bleeding off the right edge, one static and one turning. Purely
              decorative, so hidden from assistive tech and inert to the pointer.

              Gone entirely below the breakpoint. A phone has no right half to decorate — the
              rings ran under the headline instead of beside it. */}
          <div
            aria-hidden
            className="border-primary/15 pointer-events-none absolute -top-15 -right-30 hidden size-130 rounded-full border wide:block"
          />
          <div
            aria-hidden
            className="border-primary/10 animate-orbit pointer-events-none absolute top-10 -right-10 hidden size-90 rounded-full border border-dashed wide:block"
          />

          {/* The mark as a hairline trace, sitting inside both rings. The offsets aren't
              arbitrary: both rings are centred on the same point, 140px in from the section's
              right edge and about 210px down, and these put the trace's centre there too. Move a
              ring, move this.

              Only above the breakpoint: a recognisable mark landing on the headline would look
              like a mistake. */}
          <div
            aria-hidden
            /* A background rather than an `<img>`, because a hidden `<img>` is
               still downloaded and a hidden background is not. That is 59kB a
               phone never asks for, on a decoration it will never see. */
            style={{ backgroundImage: `url(${outlineUrl})` }}
            /* `light:invert` for the same reason `BrandMark` carries one: the
               trace is white artwork on transparency, and on an off-white page a
               white trace at 20% is nothing at all. Inverting the whole element
               is safe here because the element *is* the artwork — it has no
               children and no other background. */
            className="pointer-events-none absolute top-20 right-5 hidden h-64 w-60 bg-contain bg-center bg-no-repeat opacity-20 light:invert wide:block"
          />
        </>
      )}

      {/* Two columns at `wide`, whatever the answer turns out to be, and that's a layout-shift
          decision rather than a design one. The second track is reserved before the request
          lands, so a photograph arriving fills a hole that was already there instead of pushing
          the headline sideways — and with no photograph the rings bleed through the same space.

          The track is sized off the three-quarter line. The picture is flush to the right gutter,
          so its centre sits at `viewport - gutter - width/2`; setting that equal to
          `0.75 x viewport` gives `width = 50vw - 2 x gutter` and nothing else does. Written that
          way rather than as the 872px it comes to on a 1920 screen, because it has to hold at
          every width — and through `--spacing-page` so it holds if the gutter moves.

          It's also what closes the canyon. The copy column is `1fr`, so every pixel this track
          doesn't take, it takes.

          The 56rem cap is for a monitor wide enough that the formula stops being about halves:
          past there a photograph isn't beside the headline, it is the page. */}
      <div className="animate-rise relative grid items-center gap-10 wide:grid-cols-[minmax(0,1fr)_clamp(17rem,calc(50vw_-_2_*_var(--spacing-page)),56rem)]">
        <div className="min-w-0">
          {/* Above the headline, because it is the only thing in the hero that
              changes during the day and the one thing somebody standing outside
              the building is here to check. It draws its own fixed-height row so
              the headline does not move when the answer lands. */}
          <LabStatus />

          {/* Fluid at both sizes now, and the second clamp is what pays for the column beside it.
              The two lines are fixed by the `<br>`, so each has to fit its column outright — at a
              flat 5.25rem it did across the whole page and doesn't across half of it, and a
              headline that wraps to four lines is a different design rather than a smaller one.

              4.5vw is what the half above leaves room for: the longest line measures a little
              over nine times the font size, and the column the picture leaves is `50vw - 40px`.
              It still reaches the full 5.25rem, around 1870px rather than 1680 — the price of the
              bigger picture, paid at widths nobody reads a hero on. */}
          <h1 className="mb-6.5 text-[clamp(1.75rem,7.5vw,2.75rem)] leading-[0.94] font-bold tracking-[-0.03em] text-pretty wide:text-[clamp(2.5rem,4.5vw,5.25rem)]">
            {/* One skeleton for both lines rather than one each: the `<br>`
                between them would otherwise add a line box of its own and make
                the placeholder taller than the headline it stands in for. */}
            {waiting ? (
              <Waiting width="14ch" lines={2} />
            ) : (
              <>
                {words.headline}
                <br />
                <em className="text-primary not-italic">
                  {words.headlineAccent}
                </em>
              </>
            )}
          </h1>

          <p className="text-dim mb-10 max-w-[35rem] text-base leading-[1.6] text-pretty wide:text-lg">
            {waiting ? (
              <Waiting width="100%" lines={3} tone="body" />
            ) : (
              words.lede
            )}
          </p>

          {/* The primary one is the signup route now. It pointed at the FAQ for
              as long as there was nowhere to actually sign up — that answered the
              question and then left people to work out the rest. */}
          <div className="flex flex-wrap items-center gap-3.5">
            <Link
              to="/join"
              className="btn btn-primary btn-cta px-7 py-[15px] text-[13px] font-semibold"
            >
              GET INVOLVED →
            </Link>
            <Link
              to="/projects"
              className="btn btn-outline h-auto min-h-0 border-base-content/28 px-7 py-[15px] text-[13px] font-semibold tracking-[0.04em] text-base-content transition-[border-color,background-color] duration-200 hover:border-base-content hover:bg-base-content/6 hover:text-base-content"
            >
              See the projects
            </Link>
          </div>
        </div>

        {/* Unlike the rings it replaces, this is *not* hidden on a phone. The
            decoration was hidden because a phone has no right half to decorate;
            these are the club's photographs, which are worth a screen of their
            own under the buttons. */}
        {showing.length > 0 && <HeroSlideshow slides={showing} />}
      </div>
    </section>
  )
}

/**
 * A bar the size of the words it's standing in for.
 *
 * In `em` rather than `rem` or pixels, which is what makes one component work for a headline
 * that clamps between 1.75rem and 5.25rem and for a paragraph that doesn't: it inherits the font
 * size of whatever it's inside. `aria-hidden` because there's nothing here to read out.
 */
function Waiting({
  width,
  lines = 1,
  tone = 'heading',
}: {
  width: string
  lines?: number
  /** Headings sit on their own line box; body text has room between lines. */
  tone?: 'heading' | 'body'
}) {
  return (
    <span aria-hidden className="block">
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          style={{
            width: index === lines - 1 && lines > 1 ? '70%' : width,
            maxWidth: '100%',
          }}
          className={`bg-base-300 block animate-pulse rounded-[2px] ${
            tone === 'heading' ? 'my-[0.1em] h-[0.7em]' : 'my-[0.35em] h-[0.6em]'
          }`}
        />
      ))}
    </span>
  )
}
