import { useId, useState } from 'react'
import { Status } from '../shared/Status'
import { useSectionStatus } from '../../lib/useSectionStatus'
import {
  FormEyebrow,
  FormHeading,
  fieldClass,
  labelClass,
} from '../shared/formChrome'
import { putJson } from '../../lib/api/api'
import type { ApiAboutPage } from '../../lib/api/api'
import { MAX_MILESTONES, MAX_STORY } from '../../lib/aboutPage'
import { paragraphsFromText, paragraphsToText } from '../../lib/textLines'
import { moveItem } from '../../lib/projects/projectGallery'

/**
 * `/about`, rewritten in place.
 *
 * The one editor on the site that is not a desk, and the difference is the thing being edited. A
 * desk manages a list that grows over a term — sponsors, photographs, equipment — so it lives at
 * its own address and its rows write themselves as they are touched. This is a page of prose
 * somebody sits down and rewrites, and the useful place to do that is on the page, looking at what
 * it currently says.
 *
 * So it is a form, and the whole page is its body: one SAVE that writes everything in one
 * transaction, one CANCEL that discards everything. The timeline is edited here rather than saving
 * itself per row, which is why `PUT /api/officer/about` takes it — a line that wrote itself the
 * moment it was dragged, inside a form waiting for SAVE, would mean CANCEL keeping half of what it
 * just undid.
 *
 * Nothing here is a permission decision. The button that mounts this is drawn for officers, and
 * `requireOfficer` on the route is what actually decides — dues before the role, as on every desk.
 * A lapsed officer can open this and gets the sentence about a payment when they save.
 */
export function AboutEditor({
  page,
  onSaved,
  onCancel,
}: {
  page: ApiAboutPage
  onSaved: (saved: ApiAboutPage) => void
  onCancel: () => void
}) {
  const id = useId()
  const { message, busy, setMessage, run } = useSectionStatus()

  const [heading, setHeading] = useState(page.heading)
  const [lede, setLede] = useState(page.lede)
  const [storyNotice, setStoryNotice] = useState(page.storyNotice ?? '')
  const [story, setStory] = useState(paragraphsToText(page.story))
  const [labBuilding, setLabBuilding] = useState(page.labBuilding ?? '')
  const [labStreet, setLabStreet] = useState(page.labStreet ?? '')
  const [labCity, setLabCity] = useState(page.labCity ?? '')
  const [labMapUrl, setLabMapUrl] = useState(page.labMapUrl ?? '')
  const [onlineBlurb, setOnlineBlurb] = useState(page.onlineBlurb)
  const [milestones, setMilestones] = useState<Line[]>(() =>
    page.milestones.map((row) => ({ key: nextKey(), when: row.when, what: row.what })),
  )

  const paragraphs = paragraphsFromText(story)

  const save = () =>
    run(async () => {
      // A row nobody filled in is an ADD somebody thought better of, and is
      // dropped rather than refused. A row filled in *half way* is a mistake
      // worth a sentence — the server would refuse it too, but with the field
      // path rather than with anything a person can act on.
      const written = milestones.filter(
        (line) => line.when.trim() !== '' || line.what.trim() !== '',
      )

      if (written.some((line) => line.when.trim() === '' || line.what.trim() === '')) {
        setMessage('Every line on the timeline needs a date and a sentence.')
        return
      }

      if (paragraphs.length > MAX_STORY) {
        setMessage(
          `The story holds up to ${String(MAX_STORY)} paragraphs — this has ${String(paragraphs.length)}.`,
        )
        return
      }

      const saved = await putJson<ApiAboutPage>('/officer/about', {
        heading: heading.trim(),
        lede: lede.trim(),
        storyNotice: storyNotice.trim(),
        story: paragraphs,
        labBuilding: labBuilding.trim(),
        labStreet: labStreet.trim(),
        labCity: labCity.trim(),
        labMapUrl: labMapUrl.trim(),
        onlineBlurb: onlineBlurb.trim(),
        milestones: written.map((line) => ({
          when: line.when.trim(),
          what: line.what.trim(),
        })),
      })

      onSaved(saved)
    })

  const editLine = (key: string, patch: Partial<Line>) => {
    setMilestones((held) =>
      held.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    )
  }

  return (
    <section className="px-page py-12 wide:py-18">
      <FormEyebrow>/ ABOUT · EDITING</FormEyebrow>
      <FormHeading>What this page says about the club.</FormHeading>

      <p className="text-dim mb-9 max-w-[46rem] text-sm leading-[1.7] text-pretty">
        Nothing here is live until you press SAVE, and SAVE writes the whole page
        at once — the timeline included. CANCEL leaves everything exactly as the
        page currently reads.
      </p>

      {/* Two columns at width, in the order the page itself is read: what it opens with, then the
          history, then where to find the club. The form is not a preview and does not pretend to be
          one — the page it writes is one press away, and a half-styled imitation would be a second
          thing to keep in step. */}
      <div className="grid-fluid grid items-start gap-9 [--col-min:26rem]">
        <div className="grid gap-5">
          <p className={panelLabel}>/ THE OPENING</p>

          <div>
            <label className={labelClass} htmlFor={`${id}-heading`}>
              HEADING
            </label>
            <input
              id={`${id}-heading`}
              type="text"
              value={heading}
              maxLength={120}
              disabled={busy}
              onChange={(event) => {
                setHeading(event.target.value)
              }}
              className={fieldClass}
            />
            <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
              The line at the top of the page. The founding year is part of the
              sentence rather than a number the site fills in.
            </p>
          </div>

          <div>
            <label className={labelClass} htmlFor={`${id}-lede`}>
              OPENING PARAGRAPH
            </label>
            <textarea
              id={`${id}-lede`}
              value={lede}
              rows={5}
              maxLength={800}
              disabled={busy}
              onChange={(event) => {
                setLede(event.target.value)
              }}
              className={`${fieldClass} h-auto py-2.5 leading-[1.6]`}
            />
          </div>

          <p className={`${panelLabel} mt-4`}>/ THE STORY</p>

          <div>
            <label className={labelClass} htmlFor={`${id}-notice`}>
              PLACEHOLDER WARNING
            </label>
            <textarea
              id={`${id}-notice`}
              value={storyNotice}
              rows={3}
              maxLength={400}
              disabled={busy}
              onChange={(event) => {
                setStoryNotice(event.target.value)
              }}
              className={`${fieldClass} h-auto py-2.5 leading-[1.6]`}
            />
            {/* The one field on this form worth explaining, because emptying it
                is the point of it. The page shipped with an admission that its
                history was invented, and the admission could only be retired by
                a developer — this is that ending. */}
            <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
              Printed in a gold panel above the story. Empty this box once the
              history below it is the club&rsquo;s own, and the panel goes with
              it.
            </p>
          </div>

          <div>
            <label className={labelClass} htmlFor={`${id}-story`}>
              THE STORY
            </label>
            <textarea
              id={`${id}-story`}
              value={story}
              rows={12}
              disabled={busy}
              onChange={(event) => {
                setStory(event.target.value)
              }}
              className={`${fieldClass} h-auto py-2.5 leading-[1.6]`}
            />
            <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
              Leave a blank line between paragraphs. {paragraphs.length} of{' '}
              {MAX_STORY} so far — the layout is built around three.
            </p>
          </div>
        </div>

        <div className="grid gap-5">
          <p className={panelLabel}>/ THE TIMELINE</p>

          {milestones.length === 0 ? (
            <p className="border-rule bg-base-200 text-faint border p-5 text-[13px] leading-[1.6]">
              No lines yet. A page with an empty timeline prints no timeline,
              which is a fine thing to leave it as.
            </p>
          ) : (
            <ul className="space-y-2">
              {milestones.map((line, index) => (
                <li key={line.key} className="border-rule bg-base-200 border p-2">
                  <div className="flex flex-wrap items-start gap-2">
                    <input
                      type="text"
                      value={line.when}
                      maxLength={40}
                      placeholder="1972"
                      aria-label={`Date for timeline line ${String(index + 1)}`}
                      disabled={busy}
                      onChange={(event) => {
                        editLine(line.key, { when: event.target.value })
                      }}
                      className="input border-rule bg-base-100 h-9 min-h-0 w-24 shrink-0 font-mono text-[12px]"
                    />
                    <input
                      type="text"
                      value={line.what}
                      maxLength={300}
                      placeholder="What changed"
                      aria-label={`Sentence for timeline line ${String(index + 1)}`}
                      disabled={busy}
                      onChange={(event) => {
                        editLine(line.key, { what: event.target.value })
                      }}
                      className="input border-rule bg-base-100 h-9 min-h-0 min-w-0 flex-1 text-[13px]"
                    />
                    <span className="flex shrink-0 items-center gap-1">
                      <MoveButton
                        label={`Move line ${String(index + 1)} earlier`}
                        glyph="‹"
                        disabled={index === 0 || busy}
                        onClick={() => {
                          setMilestones(moveItem(milestones, index, index - 1))
                        }}
                      />
                      <MoveButton
                        label={`Move line ${String(index + 1)} later`}
                        glyph="›"
                        disabled={index === milestones.length - 1 || busy}
                        onClick={() => {
                          setMilestones(moveItem(milestones, index, index + 1))
                        }}
                      />
                      <button
                        type="button"
                        aria-label={`Remove line ${String(index + 1)}`}
                        disabled={busy}
                        onClick={() => {
                          setMilestones(
                            milestones.filter((row) => row.key !== line.key),
                          )
                        }}
                        className="text-faint hover:text-error flex size-11 cursor-pointer items-center justify-center text-sm transition-colors duration-200 disabled:opacity-50 wide:size-8"
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div>
            <button
              type="button"
              disabled={busy || milestones.length >= MAX_MILESTONES}
              onClick={() => {
                setMilestones([
                  ...milestones,
                  { key: nextKey(), when: '', what: '' },
                ])
              }}
              className={button}
            >
              ADD A LINE
            </button>
            <p className="text-faint mt-1.5 font-mono text-[10px] font-medium tracking-[0.14em]">
              {milestones.length} / {MAX_MILESTONES} LINES
              {milestones.length >= MAX_MILESTONES && ' — REMOVE ONE TO ADD ANOTHER'}
            </p>
          </div>

          <p className={`${panelLabel} mt-4`}>/ WHERE TO FIND US</p>

          <div className="grid gap-4">
            <div>
              <label className={labelClass} htmlFor={`${id}-building`}>
                BUILDING
              </label>
              <input
                id={`${id}-building`}
                type="text"
                value={labBuilding}
                maxLength={120}
                disabled={busy}
                onChange={(event) => {
                  setLabBuilding(event.target.value)
                }}
                className={fieldClass}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor={`${id}-street`}>
                STREET
              </label>
              <input
                id={`${id}-street`}
                type="text"
                value={labStreet}
                maxLength={120}
                disabled={busy}
                onChange={(event) => {
                  setLabStreet(event.target.value)
                }}
                className={fieldClass}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor={`${id}-city`}>
                CITY, STATE AND ZIP
              </label>
              <input
                id={`${id}-city`}
                type="text"
                value={labCity}
                maxLength={120}
                disabled={busy}
                onChange={(event) => {
                  setLabCity(event.target.value)
                }}
                className={fieldClass}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor={`${id}-map`}>
                MAP LINK
              </label>
              <input
                id={`${id}-map`}
                type="url"
                value={labMapUrl}
                maxLength={500}
                placeholder="https://…"
                disabled={busy}
                onChange={(event) => {
                  setLabMapUrl(event.target.value)
                }}
                className={fieldClass}
              />
              {/* All four go together, and the page is built for their absence
                  — a club between homes prints no address rather than half of
                  one. */}
              <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
                Leave all four empty and the address panel comes off the page.
              </p>
            </div>

            <div>
              <label className={labelClass} htmlFor={`${id}-online`}>
                THE ONLINE PANEL
              </label>
              <textarea
                id={`${id}-online`}
                value={onlineBlurb}
                rows={4}
                maxLength={500}
                disabled={busy}
                onChange={(event) => {
                  setOnlineBlurb(event.target.value)
                }}
                className={`${fieldClass} h-auto py-2.5 leading-[1.6]`}
              />
              <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
                The paragraph beside the club&rsquo;s accounts. The links
                themselves are the same ones the footer prints and are not edited
                here.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-9 flex flex-wrap items-center gap-3.5">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="btn btn-primary btn-cta px-7 py-[15px] text-[13px] font-semibold disabled:opacity-60"
        >
          {busy ? 'SAVING…' : 'SAVE THE PAGE'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={button}>
          CANCEL
        </button>
      </div>

      <Status message={message} />
    </section>
  )
}

/**
 * A timeline row while it is being edited.
 *
 * `key` is the browser's, not the database's: the save writes the whole timeline as new rows, so a
 * line that has never been saved has no id at all and one that has is about to lose the one it had.
 * A counter rather than an index, because an index as a React key on a reorderable list is how a
 * row's contents end up in its neighbour.
 */
type Line = { key: string; when: string; what: string }

let keys = 0
const nextKey = () => `line-${String((keys += 1))}`

const button =
  'btn btn-outline h-auto min-h-0 border-base-content/28 px-4 py-2 text-[11px] font-semibold tracking-[0.08em] text-base-content hover:border-base-content hover:bg-base-content/6 hover:text-base-content disabled:opacity-40'

const panelLabel =
  'text-faint font-mono text-[10px] font-medium tracking-[0.16em]'

function MoveButton({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string
  glyph: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="border-rule text-dim enabled:hover:border-primary enabled:hover:text-primary flex size-11 cursor-pointer items-center justify-center border text-sm leading-none transition-colors duration-200 disabled:cursor-default disabled:opacity-30 wide:size-8"
    >
      {glyph}
    </button>
  )
}
