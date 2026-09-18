import { useId, useRef, type ReactNode } from 'react'
import { fieldClass, labelClass } from '../shared/formChrome'
import {
  MONTH_WEEKS,
  WEEKDAY_NAMES,
  WEEKDAY_SHORT,
  formatCivilDate,
  meetingPattern,
  ordinal,
  todayCivil,
} from '../../lib/events/meetings'
import {
  type MeetingDraft,
  datesOf,
  draftBody,
  toggled,
} from '../../lib/events/meetingDraft'

/**
 * When a project meets, as a controlled set of fields: the pattern, the times, the place and
 * the note.
 *
 * Shared by the create desk and the manage page so the two can't drift, the way `LinkRows` is.
 * The caller owns the form, the draft and the save; the date waiting in the picker is part of
 * the draft, so SAVE can't drop it.
 *
 * Each pattern shows only its own controls. A line under them reads the pattern back in words
 * ("Meets every other Wednesday from Oct 1"), because a set of ticked chips is easy to get
 * subtly wrong and the sentence is what members will read.
 */
export function MeetingScheduleFields({
  draft,
  onChange,
  disabled,
}: {
  draft: MeetingDraft
  onChange: (draft: MeetingDraft) => void
  disabled: boolean
}) {
  const id = useId()
  const picker = useRef<HTMLInputElement>(null)

  const set = (patch: Partial<MeetingDraft>) => {
    onChange({ ...draft, ...patch })
  }

  const weekly = draft.repeat === 'WEEKLY'
  const monthly =
    draft.repeat === 'MONTHLY_WEEKDAY' || draft.repeat === 'MONTHLY_DAY'
  const counted = weekly && draft.interval > 1
  const pattern = meetingPattern(draftBody(draft))

  const addDate = () => {
    if (!draft.pendingDate) return
    set({ dates: datesOf(draft), pendingDate: '' })
  }

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
        <fieldset>
          <legend className={labelClass}>DATES</legend>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-44">
              <input
                ref={picker}
                type="date"
                aria-label="Date to add"
                // A meeting that has already happened is nothing to schedule. The server
                // refuses dates outside the term, with the reason.
                min={todayCivil()}
                value={draft.pendingDate}
                disabled={disabled}
                onChange={(change) => {
                  set({ pendingDate: change.target.value })
                }}
                onKeyDown={(key) => {
                  // Enter adds the date rather than submitting the whole form half-filled.
                  if (key.key === 'Enter') {
                    key.preventDefault()
                    addDate()
                  }
                }}
                className={fieldClass}
              />
            </div>
            <button
              type="button"
              onClick={addDate}
              disabled={disabled || !draft.pendingDate}
              className="text-dim border-rule hover:border-primary hover:text-primary focus-visible:outline-primary flex min-h-11 cursor-pointer items-center border px-3 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default disabled:opacity-50 wide:min-h-9"
            >
              ADD DATE
            </button>
          </div>

          {draft.dates.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {draft.dates.map((date) => {
                const label = formatCivilDate(date, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })
                return (
                  <li
                    key={date}
                    className="border-rule text-dim flex items-center border pl-3 font-mono text-[10px] font-medium tracking-[0.14em] uppercase"
                  >
                    {label}
                    <button
                      type="button"
                      aria-label={`Remove ${label}`}
                      disabled={disabled}
                      onClick={() => {
                        set({ dates: draft.dates.filter((each) => each !== date) })
                        // The chip goes, and focus would go with it to the top of the page.
                        picker.current?.focus()
                      }}
                      className="text-faint hover:text-error focus-visible:outline-primary flex min-h-11 min-w-11 cursor-pointer items-center justify-center text-sm transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 wide:min-h-8 wide:min-w-8"
                    >
                      <span aria-hidden>×</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-faint mt-1.5 text-[12px]">No dates yet.</p>
          )}
        </fieldset>
      )}

      {draft.repeat !== 'DATES' && (
        <div className="w-48">
          <label htmlFor={`${id}-starts`} className={labelClass}>
            {counted ? 'FIRST MEETING' : 'STARTING (OPTIONAL)'}
          </label>
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
      {draft.repeat !== 'DATES' && (
        <p className="text-faint -mt-2.5 text-[12px] leading-[1.5] text-pretty">
          {counted
            ? 'The weeks are counted from this date.'
            : 'Empty starts with the semester.'}
        </p>
      )}

      {pattern && (
        <p className="text-dim text-[13px] leading-[1.5] text-pretty">
          Meets {pattern}.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <label htmlFor={`${id}-from`} className={labelClass}>
            FROM
          </label>
          <input
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
        <div className="min-w-40 flex-1">
          <label htmlFor={`${id}-place`} className={labelClass}>
            PLACE
          </label>
          <input
            id={`${id}-place`}
            maxLength={160}
            value={draft.location}
            disabled={disabled}
            placeholder="ENG2 Lab"
            onChange={(change) => {
              set({ location: change.target.value })
            }}
            className={fieldClass}
          />
        </div>
      </div>

      {/* The one part a schedule's columns can't hold, and genuinely optional. Left empty,
          a meeting reaches a member's calendar with no description at all; the site doesn't
          write one for the lead. */}
      <div>
        <label htmlFor={`${id}-note`} className={labelClass}>
          NOTE (OPTIONAL)
        </label>
        <textarea
          id={`${id}-note`}
          maxLength={400}
          rows={2}
          value={draft.note}
          disabled={disabled}
          placeholder="Anything the time and place don't say — bring a laptop, we skip home game days"
          onChange={(change) => {
            set({ note: change.target.value })
          }}
          className="textarea border-rule bg-base-200 w-full text-sm"
        />
        <p className="text-faint mt-1 text-[12px] leading-[1.5] text-pretty">
          Members see this on the meeting in their calendar.
        </p>
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
