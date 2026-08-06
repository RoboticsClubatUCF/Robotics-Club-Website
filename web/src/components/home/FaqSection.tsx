import { faqs } from '../../content/home'
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
 * The answers are copy, not data: they live in `src/content/home.ts`. They are
 * the strongest candidate for the first content table, though — dues and lab
 * hours change more often than the site deploys.
 */
export function FaqSection() {
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

          {faqs.map((faq) => (
            <details
              key={faq.question}
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

                {faq.steps && (
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
