import { Link } from 'react-router'
import { hero } from '../../content/home'
import outlineUrl from '../../assets/rccf-logo-outline.png'

export function HeroSection() {
  return (
    <section
      id="top"
      className="px-page relative overflow-hidden pt-14 pb-12 wide:pt-24 wide:pb-19"
    >
      {/* Two concentric rings bleeding off the right edge, one static and one
          turning. Purely decorative, so they are hidden from assistive tech and
          made inert to the pointer.

          Gone entirely below the breakpoint. A phone has no right half to
          decorate — the rings ran under the headline instead of beside it, and
          an animation nobody asked for costs a battery something even where it
          reads as texture. */}
      <div
        aria-hidden
        className="border-primary/15 pointer-events-none absolute -top-15 -right-30 hidden size-130 rounded-full border wide:block"
      />
      <div
        aria-hidden
        className="border-primary/10 animate-orbit pointer-events-none absolute top-10 -right-10 hidden size-90 rounded-full border border-dashed wide:block"
      />

      {/* The mark as a hairline trace, sitting inside both rings — the headline
          is set left and this is what the right half of the hero is for. The
          offsets are not arbitrary: both rings are centred on the same point,
          140px in from the section's right edge and about 210px down, and these
          put the trace's centre there too. Move a ring, move this.

          Only above the breakpoint. The rings can bleed off a phone's right edge
          and still read as texture; a recognisable mark landing on the headline
          would just look like a mistake. */}
      <div
        aria-hidden
        /* A background rather than an `<img>`, because a hidden `<img>` is still
           downloaded and a hidden background is not. That is 59kB a phone never
           asks for, on a decoration it will never see. */
        style={{ backgroundImage: `url(${outlineUrl})` }}
        className="pointer-events-none absolute top-20 right-5 hidden h-64 w-60 bg-contain bg-center bg-no-repeat opacity-20 wide:block"
      />

      <div className="animate-rise relative max-w-[52.5rem]">
        {/* Fluid rather than a second breakpoint: the two lines are fixed by
            the `<br>`, so "Building Our Future," has to fit the viewport
            outright — at a flat 2.75rem it ran off a 360px phone, and the
            section clips rather than scrolls, so the end of the line simply
            vanished. `clamp` tracks the width down to the smallest phone and
            stops at the old size. */}
        <h1 className="mb-6.5 text-[clamp(1.75rem,7.5vw,2.75rem)] leading-[0.94] font-bold tracking-[-0.03em] text-pretty wide:text-[5.25rem]">
          Building Our Future,
          <br />
          <em className="text-primary not-italic">One Robot at a Time.</em>
        </h1>

        <p className="text-dim mb-10 max-w-[35rem] text-base leading-[1.6] text-pretty wide:text-lg">
          {hero.lede}
        </p>

        {/* The primary one is the signup route now. It pointed at the FAQ for
            as long as there was nowhere to actually sign up — that answered the
            question and then left people to work out the rest. `/projects` is
            still a route nobody has written. */}
        <div className="flex flex-wrap items-center gap-3.5">
          <Link
            to="/join"
            className="btn btn-primary btn-cta px-7 py-[15px] text-[13px] font-semibold"
          >
            GET INVOLVED →
          </Link>
          <Link
            to="/projects"
            className="btn btn-outline h-auto min-h-0 border-white/28 px-7 py-[15px] text-[13px] font-semibold tracking-[0.04em] text-white transition-[border-color,background-color] duration-200 hover:border-white hover:bg-white/6 hover:text-white"
          >
            See the projects
          </Link>
        </div>
      </div>
    </section>
  )
}
