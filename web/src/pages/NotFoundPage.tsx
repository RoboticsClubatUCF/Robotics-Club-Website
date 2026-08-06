import { Link } from 'react-router'

/**
 * Where an unmatched path lands.
 *
 * Most of what reaches this is not a typo but a page that has genuinely not
 * been built — the stat strip, the nav and three section headers all point at
 * routes that are still empty files in `src/pages/`. Before the router these
 * URLs quietly served the landing page, which looked like the link worked and
 * left people hunting for content that was never there. Saying so is worse
 * looking and considerably more useful.
 */
export function NotFoundPage() {
  return (
    <section className="px-page py-20 wide:py-32">
      <div className="max-w-[34rem]">
        <p className="text-primary mb-5 font-mono text-[13px] font-bold tracking-[0.2em]">
          / 404
        </p>

        <h1 className="mb-6 text-[clamp(1.75rem,7.5vw,2.75rem)] leading-[1.05] font-bold tracking-[-0.03em] text-pretty wide:text-5xl">
          There is nothing here yet.
        </h1>

        <p className="text-dim mb-9 text-base leading-[1.7] text-pretty">
          Either that link is wrong, or it points at part of the site we have
          not finished building. Most of it is on the front page for now.
        </p>

        <div className="flex flex-wrap items-center gap-3.5">
          <Link
            to="/"
            className="btn btn-primary btn-cta px-7 py-[15px] text-[13px] font-semibold"
          >
            BACK TO THE FRONT PAGE
          </Link>
          <Link
            to="/join"
            className="btn btn-outline h-auto min-h-0 border-white/28 px-7 py-[15px] text-[13px] font-semibold tracking-[0.04em] text-white transition-[border-color,background-color] duration-200 hover:border-white hover:bg-white/6 hover:text-white"
          >
            Join the club
          </Link>
        </div>
      </div>
    </section>
  )
}
