import { hero } from '../content/home'

export function HeroSection() {
  return (
    <section
      id="top"
      className="px-page relative overflow-hidden pt-14 pb-12 wide:pt-24 wide:pb-19"
    >
      {/* Two concentric rings bleeding off the right edge, one static and one
          turning. Purely decorative, so they are hidden from assistive tech and
          made inert to the pointer — otherwise they would swallow clicks on the
          headline at narrow widths. */}
      <div
        aria-hidden
        className="border-primary/15 pointer-events-none absolute -top-15 -right-30 size-130 rounded-full border"
      />
      <div
        aria-hidden
        className="border-primary/10 animate-orbit pointer-events-none absolute top-10 -right-10 size-90 rounded-full border border-dashed"
      />

      <div className="animate-rise relative max-w-[52.5rem]">
        <h1 className="mb-6.5 text-[2.75rem] leading-[0.94] font-bold tracking-[-0.03em] text-pretty wide:text-[5.25rem]">
          Building Our Future,
          <br />
          <em className="text-primary not-italic">One Robot at a Time.</em>
        </h1>

        <p className="text-dim mb-10 max-w-[35rem] text-base leading-[1.6] text-pretty wide:text-lg">
          {hero.lede}
        </p>

        <div className="flex flex-wrap items-center gap-3.5">
          <a
            href="#join"
            className="btn btn-primary btn-cta px-7 py-[15px] text-[13px] font-semibold"
          >
            GET INVOLVED →
          </a>
          <a
            href="#projects"
            className="btn btn-outline h-auto min-h-0 border-white/28 px-7 py-[15px] text-[13px] font-semibold tracking-[0.04em] text-white transition-[border-color,background-color] duration-200 hover:border-white hover:bg-white/6 hover:text-white"
          >
            See the projects
          </a>
        </div>
      </div>
    </section>
  )
}
