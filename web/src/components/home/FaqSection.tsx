import type { ApiFrontPage } from '../../lib/api/api'
import type { ApiState } from '../../lib/api/useApi'
import { ContactForm } from '../shared/ContactForm'

/**
 * The FAQ, as a stack of native `<details>` disclosures, with the contact form
 * beside it.
 *
 * The two share a row on purpose. The FAQ answers what is already written down
 * and the form covers what isn't, so anyone who reads to the bottom without
 * finding their question has somewhere to put it — and the answers are set to a
 * reading measure, which left half the section empty at width.
 *
 * `<details>` rather than a hand-rolled accordion because the browser already
 * supplies the open state, the keyboard handling and the role — and because the
 * closed content stays findable by the browser's own in-page search, which a
 * component that unmounts its answers would not be. DaisyUI's `collapse`
 * classes are built to sit on exactly this markup.
 *
 * **The answers were copy and are data now.** They were an array in
 * `src/content/home.ts` under a note calling them the strongest candidate for
 * the first content table, since dues, lab hours and staff change more often
 * than the site deploys — two of the eight name a price and one names a person.
 * Officers write them at `/dashboard/officer/front-page`; `HomePage` fetches
 * them with the rest of the page's words and hands them down.
 *
 * **The contact form is drawn in every state**, including the one where the
 * questions could not be loaded. It is the half of this section that does not
 * need the API to be useful to somebody, and a visitor whose question is not
 * answered is exactly who it is for.
 */
export function FaqSection({ copy }: { copy: ApiState<ApiFrontPage> }) {
  const faqs = copy.status === 'ready' ? copy.data.faqs : []

  return (
    <section
      id="faq"
      className="border-rule px-page scroll-mt-20 border-t py-12 wide:py-18"
    >
      {/* One column below the breakpoint, with the form under the answers. The
          form's track is fixed: a text input that grows to a thousand pixels on
          a wide monitor looks like a mistake, and the disclosure rows are happy
          to take whatever is left — a full-width rule with the question at one
          end and the marker at the other is the same row the schedule and the
          stat strip use. */}
      <div className="grid gap-12 wide:grid-cols-[1fr_22rem] wide:gap-14">
        <div>
          <h2 className="text-faint mb-9 font-mono text-[13px] font-bold tracking-[0.2em]">
            / FREQUENTLY ASKED QUESTIONS
          </h2>

          {copy.status === 'loading' && <QuestionsSkeleton />}

          {copy.status === 'error' && (
            <p className="border-rule text-faint border-t py-6.5 text-sm">
              Couldn&rsquo;t load the questions just now. The form beside this
              still works.
            </p>
          )}

          {copy.status === 'ready' && faqs.length === 0 && (
            <p className="border-rule text-faint border-t py-6.5 text-sm">
              No questions are up yet. Ask one with the form.
            </p>
          )}

          {faqs.map((faq) => (
            <details
              key={faq.id}
              /* `group` so the marker below can rotate off the open state
                 without a second class on the summary. */
              className="group border-rule border-t last:border-b"
            >
              <summary className="hover:text-primary flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-base font-medium transition-colors duration-200 marker:content-none">
                {faq.question}
                {/* Purely a state indicator — the disclosure already announces
                    itself, so this is hidden rather than read out twice. */}
                <span
                  aria-hidden
                  className="text-primary shrink-0 text-xl leading-none transition-transform duration-200 group-open:rotate-45"
                >
                  +
                </span>
              </summary>

              {/* `group-open:` is what makes this a one-shot on open rather than
                  a permanent class: the animation only exists while the details
                  is open, so closing and reopening replays it. Height is left
                  alone — `auto` is not interpolable, and the fade plus the short
                  slide is enough to stop the answer appearing from nowhere.
                  `prefers-reduced-motion` neutralises it globally. */}
              <div className="group-open:animate-reveal max-w-[46rem] pb-6">
                <p className="text-dim text-sm leading-[1.7] text-pretty">{faq.answer}</p>

                {faq.steps.length > 0 && (
                  <ol className="text-dim mt-3 space-y-2 text-sm leading-[1.7]">
                    {faq.steps.map((step, index) => (
                      <li key={step} className="flex gap-3">
                        <span className="text-primary shrink-0 pt-px font-mono text-[11px] font-medium">
                          {index + 1}.
                        </span>
                        <span className="text-pretty">{step}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </details>
          ))}
        </div>

        <ContactForm />
      </div>
    </section>
  )
}

/**
 * Closed disclosure rows at the height they actually are, so the footer does not
 * jump when the answers land. Five rather than the club's eight: the section is
 * well below the fold and the guess only has to be close enough that the page
 * does not visibly settle.
 */
function QuestionsSkeleton() {
  return (
    <div aria-hidden>
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className="border-rule flex items-center border-t py-5 last:border-b"
        >
          <span
            style={{ width: `${String(11 + ((index * 5) % 9))}rem` }}
            className="bg-base-300 h-3.5 max-w-full animate-pulse rounded-[2px]"
          />
        </div>
      ))}
    </div>
  )
}
