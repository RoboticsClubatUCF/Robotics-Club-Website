import { InfoTip } from '../shared/InfoTip'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { fieldClass, labelClass } from '../shared/formChrome'
import { MeetingDatesPicker } from './MeetingDatesPicker'
import type { ApiTermDates } from '../../lib/api/api'
import { termBounds } from '../../lib/events/meetingDates'
import {
  MONTH_WEEKS,
  WEEKDAY_NAMES,
  WEEKDAY_SHORT,
  meetingPattern,
  meetingWhen,
  ordinal,
} from '../../lib/events/meetings'
import {
  type Hours,
  type MeetingDraft,
  commonHours,
  draftBody,
  hoursOf,
  hoursProblem,
  meetingDays,
  toggled,
} from '../../lib/events/meetingDraft'

/**
 * When a project meets, as a controlled set of fields: the pattern, the times, the place and
 * the note.
 *
 * Shared by the create desk and the manage page so the two can't drift, the way `LinkRows` is.
 * The caller owns the form, the draft, the save and the term's dates; a list of dates is picked
 * on `MeetingDatesPicker`, which greys out the days the term won't have.
 *
 * Each pattern shows only its own controls. A line under them reads the schedule back in words
 * ("Meets every other Wednesday from Oct 1 · 6:00 – 8:00 PM"), because a set of ticked chips is
 * easy to get subtly wrong and the sentence is what members will read.
 *
 * The hours are one FROM and TO for every day until a lead picks DIFFERENT BY DAY, which lists
 * each day with its own. Every day starts on the shared hours, so the lead only changes the
 * ones that differ. Going back to one set takes the hours most days had, and the line above
 * shows the result.
 */
export function MeetingScheduleFields({
  draft,
  onChange,
  disabled,
  term = null,
}: {
  draft: MeetingDraft
  onChange: (draft: MeetingDraft) => void
  disabled: boolean
  /** The project's term, for the date picker. Null while it loads, and it works without. */
  term?: ApiTermDates | null
}) {
  const id = useId()
  const from = useRef<HTMLInputElement>(null)
  /** Set when SAME is pressed on a one-day schedule, whose HOURS choice then goes away. */
  const focusFrom = useRef(false)

  const set = (patch: Partial<MeetingDraft>) => {
    onChange({ ...draft, ...patch })
  }

  // Focus would drop to the page with the radio that had it, so it lands on FROM instead,
  // the field that just took its place.
  useEffect(() => {
    if (!focusFrom.current || draft.varies) return
    focusFrom.current = false
    from.current?.focus()
  }, [draft.varies])

  const weekly = draft.repeat === 'WEEKLY'
  const monthly =
    draft.repeat === 'MONTHLY_WEEKDAY' || draft.repeat === 'MONTHLY_DAY'
  const counted = weekly && draft.interval > 1
  const body = draftBody(draft)
  const pattern = meetingPattern(body)
  // The hours join the line once every day has a whole set, so a half-typed time never
  // reads as midnight.
  const readBack = hoursProblem(draft)
    ? pattern && `Meets ${pattern}`
    : meetingWhen(body)
  const dated = draft.repeat === 'DATES'
  const meetingDayList = meetingDays(draft)
  // One day has nothing to differ from, unless the lead already said its hours vary.
  const canVary = draft.varies || meetingDayList.length > 1

  const setHours = (key: string, patch: Partial<Hours>) => {
    set({
      dayHours: { ...draft.dayHours, [key]: { ...hoursOf(draft, key), ...patch } },
    })
  }

  const place = (
    <div className="min-w-40 flex-1">
      <label htmlFor={`${id}-place`} className={labelClass}>
        PLACE
      </label>
      <input
        id={`${id}-place`}
        maxLength={160}
        value={draft.location}
        disabled={disabled}
        placeholder="Meeting location"
        onChange={(change) => {
          set({ location: change.target.value })
        }}
        className={fieldClass}
      />
    </div>
  )

  const days = (
    <fieldset>
      <legend className={labelClass}>{monthly ? 'DAY' : 'DAYS'}</legend>
      <div className="flex flex-wrap gap-1.5">
        {WEEKDAY_SHORT.map((short, index) => (
          <Chip
            key={short}
            checked={draft.weekdays.includes(index)}
            disabled={disabled}
            label={WEEKDAY_NAMES[index]}
            onChange={() => {
              set({ weekdays: toggled(draft.weekdays, index) })
            }}
          >
            {short}
          </Chip>
        ))}
      </div>
    </fieldset>
  )

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className={labelClass}>REPEATS</legend>
        <div className="flex flex-wrap gap-1.5">
          <Chip
            radio={`${id}-repeat`}
            checked={weekly}
            disabled={disabled}
            onChange={() => {
              set({ repeat: 'WEEKLY' })
            }}
          >
            WEEKLY
          </Chip>
          <Chip
            radio={`${id}-repeat`}
            checked={monthly}
            disabled={disabled}
            onChange={() => {
              // Back to whichever monthly kind was filled in, if either was.
              set({
                repeat:
                  draft.monthDays.length > 0 && draft.monthWeeks.length === 0
                    ? 'MONTHLY_DAY'
                    : 'MONTHLY_WEEKDAY',
              })
            }}
          >
            MONTHLY
          </Chip>
          <Chip
            radio={`${id}-repeat`}
            checked={draft.repeat === 'DATES'}
            disabled={disabled}
            onChange={() => {
              set({ repeat: 'DATES' })
            }}
          >
            ON CHOSEN DATES
          </Chip>
        </div>
      </fieldset>

      {weekly && (
        <>
          <div className="w-48">
            <label htmlFor={`${id}-every`} className={labelClass}>
              EVERY
            </label>
            <select
              id={`${id}-every`}
              value={draft.interval}
              disabled={disabled}
              onChange={(change) => {
                set({ interval: Number(change.target.value) })
              }}
              className="select border-rule bg-base-200 w-full text-sm"
            >
              <option value={1}>Week</option>
              <option value={2}>Other week</option>
              <option value={3}>3 weeks</option>
              <option value={4}>4 weeks</option>
            </select>
          </div>
          {days}
        </>
      )}

      {monthly && (
        <>
          <fieldset>
            <legend className={labelClass}>ON</legend>
            <div className="flex flex-wrap gap-1.5">
              <Chip
                radio={`${id}-monthly`}
                checked={draft.repeat === 'MONTHLY_WEEKDAY'}
                disabled={disabled}
                onChange={() => {
                  set({ repeat: 'MONTHLY_WEEKDAY' })
                }}
              >
                A WEEKDAY
              </Chip>
              <Chip
                radio={`${id}-monthly`}
                checked={draft.repeat === 'MONTHLY_DAY'}
                disabled={disabled}
                onChange={() => {
                  set({ repeat: 'MONTHLY_DAY' })
                }}
              >
                A DATE
              </Chip>
            </div>
          </fieldset>

          {draft.repeat === 'MONTHLY_WEEKDAY' ? (
            <>
              <fieldset>
                <legend className={labelClass}>WEEK OF THE MONTH</legend>
                <div className="flex flex-wrap gap-1.5">
                  {MONTH_WEEKS.map(([week]) => (
                    <Chip
                      key={week}
                      checked={draft.monthWeeks.includes(week)}
                      disabled={disabled}
                      label={`${week === -1 ? 'Last' : ordinal(week)} week of the month`}
                      onChange={() => {
                        set({ monthWeeks: toggled(draft.monthWeeks, week) })
                      }}
                    >
                      {week === -1 ? 'LAST' : ordinal(week).toUpperCase()}
                    </Chip>
                  ))}
                </div>
              </fieldset>
              {days}
            </>
          ) : (
            <fieldset>
              <legend className={labelClass}>DAY OF THE MONTH</legend>
              {/* Seven across like a calendar page. It stops at the 28th so no month is
                  ever skipped; LAST covers the end of every month. */}
              <div className="grid max-w-[22rem] grid-cols-7 gap-1">
                {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
                  <Chip
                    key={day}
                    compact
                    checked={draft.monthDays.includes(day)}
                    disabled={disabled}
                    label={`The ${ordinal(day)}`}
                    onChange={() => {
                      set({ monthDays: toggled(draft.monthDays, day) })
                    }}
                  >
                    {String(day)}
                  </Chip>
                ))}
              </div>
              <div className="mt-1.5 flex">
                <Chip
                  checked={draft.monthDays.includes(-1)}
                  disabled={disabled}
                  label="The last day"
                  onChange={() => {
                    set({ monthDays: toggled(draft.monthDays, -1) })
                  }}
                >
                  LAST DAY
                </Chip>
              </div>
            </fieldset>
          )}
        </>
      )}

      {draft.repeat === 'DATES' && (
        <MeetingDatesPicker
          dates={draft.dates}
          disabled={disabled}
          bounds={term ? termBounds(term) : null}
          onChange={(dates) => {
            set({ dates })
          }}
        />
      )}

      {draft.repeat !== 'DATES' && (
        <div className="w-48">
          <div className="mb-1.5 flex items-center gap-1 [&>label]:mb-0">
            <label htmlFor={`${id}-starts`} className={labelClass}>
              {counted ? 'FIRST MEETING' : 'STARTING (OPTIONAL)'}
            </label>
            <InfoTip label={counted ? 'First meeting' : 'Starting (optional)'}>
              {counted
                ? 'The weeks are counted from this date.'
                : 'Empty starts with the semester.'}
            </InfoTip>
          </div>
          <input
            id={`${id}-starts`}
            type="date"
            value={draft.startsOn}
            disabled={disabled}
            required={counted}
            onChange={(change) => {
              set({ startsOn: change.target.value })
            }}
            className={fieldClass}
          />
        </div>
      )}

      {readBack && (
        <p className="text-dim text-[13px] leading-[1.5] text-pretty">{readBack}.</p>
      )}

      {canVary && (
        <fieldset>
          <legend className={labelClass}>HOURS</legend>
          <div className="flex flex-wrap gap-1.5">
            <Chip
              radio={`${id}-hours`}
              checked={!draft.varies}
              disabled={disabled}
              onChange={() => {
                // Back to one set of hours: the ones most days had. The days' own go, so
                // DIFFERENT starts again from what's on screen.
                focusFrom.current = meetingDayList.length <= 1
                set({ varies: false, ...commonHours(draft), dayHours: {} })
              }}
            >
              {dated ? 'SAME EVERY DATE' : 'SAME EVERY DAY'}
            </Chip>
            <Chip
              radio={`${id}-hours`}
              checked={draft.varies}
              disabled={disabled}
              onChange={() => {
                set({ varies: true })
              }}
            >
              {dated ? 'DIFFERENT BY DATE' : 'DIFFERENT BY DAY'}
            </Chip>
          </div>
        </fieldset>
      )}

      {draft.varies ? (
        <>
          {meetingDayList.length === 0 ? (
            <p className="text-faint text-[13px]">
              {dated ? 'Pick the dates first.' : 'Pick the days first.'}
            </p>
          ) : (
            <ul aria-label={dated ? 'Hours by date' : 'Hours by day'} className="space-y-2">
              {meetingDayList.map(({ key, label, spoken }) => {
                const hours = hoursOf(draft, key)
                return (
                  <li
                    key={key}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1"
                  >
                    <span className="text-dim w-full text-[13px] wide:w-32">{label}</span>
                    {/* The dash reads the pair as a span, so the two inputs carry their
                        names for a screen reader instead of a label each on screen. */}
                    <div className="flex min-w-0 flex-1 items-center gap-2 wide:flex-none">
                      <div className="min-w-0 flex-1 wide:w-40 wide:flex-none">
                        <input
                          type="time"
                          aria-label={`${spoken} from`}
                          value={hours.startTime}
                          disabled={disabled}
                          onChange={(change) => {
                            setHours(key, { startTime: change.target.value })
                          }}
                          className={fieldClass}
                        />
                      </div>
                      <span aria-hidden className="text-faint">
                        –
                      </span>
                      <div className="min-w-0 flex-1 wide:w-40 wide:flex-none">
                        <input
                          type="time"
                          aria-label={`${spoken} to`}
                          value={hours.endTime}
                          disabled={disabled}
                          onChange={(change) => {
                            setHours(key, { endTime: change.target.value })
                          }}
                          className={fieldClass}
                        />
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="flex">{place}</div>
        </>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <label htmlFor={`${id}-from`} className={labelClass}>
              FROM
            </label>
            <input
              ref={from}
              id={`${id}-from`}
              type="time"
              value={draft.startTime}
              disabled={disabled}
              onChange={(change) => {
                set({ startTime: change.target.value })
              }}
              className={fieldClass}
            />
          </div>
          <div className="w-40">
            <label htmlFor={`${id}-to`} className={labelClass}>
              TO
            </label>
            <input
              id={`${id}-to`}
              type="time"
              value={draft.endTime}
              disabled={disabled}
              onChange={(change) => {
                set({ endTime: change.target.value })
              }}
              className={fieldClass}
            />
          </div>
          {place}
        </div>
      )}

      {/* The one part a schedule's columns can't hold, and genuinely optional. Left empty,
          a meeting reaches a member's calendar with no description at all; the site doesn't
          write one for the lead. */}
      <div>
        <div className="mb-1.5 flex items-center gap-1 [&>label]:mb-0">
          <label htmlFor={`${id}-note`} className={labelClass}>
            NOTE (OPTIONAL)
          </label>
          <InfoTip label="Note (optional)">Members see this on the meeting in their calendar.</InfoTip>
        </div>
        <textarea
          id={`${id}-note`}
          maxLength={400}
          rows={2}
          value={draft.note}
          disabled={disabled}
          placeholder="Meeting note"
          onChange={(change) => {
            set({ note: change.target.value })
          }}
          className="textarea border-rule bg-base-200 w-full text-sm"
        />
      </div>
    </div>
  )
}

/**
 * A checkbox or radio drawn as a mono chip, the same one the meeting days have always used.
 *
 * Really an input, visually hidden rather than absent: its accessible name is what a screen
 * reader reads and what the tests query on, and `sr-only` keeps it focusable where `hidden`
 * would not. `label` gives it a fuller name than the chip's three letters.
 */
function Chip({
  checked,
  disabled,
  onChange,
  radio,
  label,
  compact = false,
  children,
}: {
  checked: boolean
  disabled: boolean
  onChange: () => void
  /** The radio group's name; absent for a checkbox. */
  radio?: string
  label?: string
  compact?: boolean
  children: ReactNode
}) {
  return (
    <label
      className={`focus-within:outline-primary flex min-h-11 cursor-pointer items-center border font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 focus-within:outline-2 focus-within:outline-offset-2 wide:min-h-9 ${
        compact ? 'justify-center px-0' : 'px-3'
      } ${
        checked
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-rule text-dim hover:border-primary hover:text-primary'
      }`}
    >
      <input
        type={radio ? 'radio' : 'checkbox'}
        name={radio}
        className="sr-only"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={onChange}
      />
      {children}
    </label>
  )
}
