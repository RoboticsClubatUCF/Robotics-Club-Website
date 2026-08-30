import { describe, expect, it } from 'vitest'
import {
  answerLine,
  answered,
  answersFor,
  draftFrom,
  pick,
  pickNone,
  surveyProblem,
  toggle,
} from './survey'
import type { SurveyDraft } from './survey'
import type { ApiSurvey, ApiSurveyQuestion } from './api/api'

/**
 * The rules the survey form obeys, and the reason they are worth a test.
 *
 * The big one is that **there is no NONE option** — an empty set of ticks *is*
 * "none". That is the right shape for the database, because a value that must
 * never co-occur with any other is a constraint Postgres cannot express, and it
 * leaves the form holding the difference between somebody who has no allergies
 * and somebody who scrolled past the question. The club reads that list before
 * it buys food, so the difference is worth being careful about.
 *
 * The rest is here because the questions are rows an officer edits: nothing in
 * `web/` knows what the survey asks, so what these assert is what is true of a
 * question *whatever it asks*.
 */

const option = (id: string, label: string, wantsText = false) => ({
  id,
  label,
  wantsText,
  retired: false,
})

const PICK: ApiSurveyQuestion = {
  id: 'q-pick',
  prompt: 'Major',
  help: null,
  kind: 'SINGLE_CHOICE',
  required: true,
  allowNone: false,
  maxLength: 100,
  options: [option('o-cs', 'Computer Science'), option('o-other', 'Other', true)],
}

const TICK: ApiSurveyQuestion = {
  id: 'q-tick',
  prompt: 'Allergies',
  help: 'We ask because the club buys food.',
  kind: 'MULTI_CHOICE',
  required: true,
  allowNone: true,
  maxLength: 200,
  options: [option('o-nuts', 'Nuts'), option('o-soy', 'Soy')],
}

const NOTE: ApiSurveyQuestion = {
  id: 'q-note',
  prompt: 'Anything else about food',
  help: null,
  kind: 'LONG_TEXT',
  required: false,
  allowNone: false,
  maxLength: 1_000,
  options: [],
}

const NAME: ApiSurveyQuestion = {
  id: 'q-name',
  prompt: 'What should we call you',
  help: null,
  kind: 'SHORT_TEXT',
  required: true,
  allowNone: false,
  maxLength: 60,
  options: [],
}

const QUESTIONS = [PICK, TICK, NOTE, NAME]

const entry = (over: Partial<SurveyDraft[string]> = {}) => ({
  optionIds: [],
  text: '',
  none: false,
  ...over,
})

/** Everything answered, so each test can spoil exactly one thing. */
const complete = (over: SurveyDraft = {}): SurveyDraft => ({
  [PICK.id]: entry({ optionIds: ['o-cs'] }),
  [TICK.id]: entry({ none: true }),
  [NAME.id]: entry({ text: 'Rowan' }),
  ...over,
})

describe('toggle', () => {
  it('adds and removes', () => {
    expect(toggle<string>([], 'o-nuts')).toEqual(['o-nuts'])
    expect(toggle(['o-nuts', 'o-soy'], 'o-nuts')).toEqual(['o-soy'])
  })
})

describe('picking', () => {
  it('replaces the answer on a pick-one question and adds to a tick-any one', () => {
    expect(pick(PICK, entry({ optionIds: ['o-cs'] }), 'o-other').optionIds).toEqual([
      'o-other',
    ])
    expect(pick(TICK, entry({ optionIds: ['o-nuts'] }), 'o-soy').optionIds).toEqual([
      'o-nuts',
      'o-soy',
    ])
  })

  /** Mutually exclusive in both directions, which is what makes NONE an act. */
  it('unticks None when something is picked, and empties the set when None is', () => {
    expect(pick(TICK, entry({ none: true }), 'o-nuts')).toMatchObject({
      optionIds: ['o-nuts'],
      none: false,
    })
    expect(pickNone(entry({ optionIds: ['o-nuts'] }))).toMatchObject({
      optionIds: [],
      none: true,
    })
  })
})

describe('answered', () => {
  /**
   * The one that is about safety rather than tidiness. An empty tick list with
   * None unticked is somebody who did not read the question, and it is
   * indistinguishable from a deliberate "none" once it reaches the server — the
   * answer row either exists or it does not. So the press is insisted on here.
   */
  it('counts an empty set as answered only when None is ticked', () => {
    expect(answered(TICK, entry())).toBe(false)
    expect(answered(TICK, entry({ none: true }))).toBe(true)
    expect(answered(TICK, entry({ optionIds: ['o-nuts'] }))).toBe(true)
  })

  it('counts a written answer only when something is written', () => {
    expect(answered(NAME, entry())).toBe(false)
    expect(answered(NAME, entry({ text: '   ' }))).toBe(false)
    expect(answered(NAME, entry({ text: 'Rowan' }))).toBe(true)
  })

  /** No NONE box, so an empty set is silence rather than an answer. */
  it('never counts an empty set on a question with no None box', () => {
    const plain = { ...TICK, allowNone: false }

    expect(answered(plain, entry({ none: true }))).toBe(false)
  })
})

describe('surveyProblem', () => {
  it('is null for a complete draft', () => {
    expect(surveyProblem(QUESTIONS, complete())).toBeNull()
  })

  it('will not accept an untouched tick-any question', () => {
    expect(
      surveyProblem(QUESTIONS, complete({ [TICK.id]: entry() })),
    ).toMatch(/Allergies/)
  })

  it('will not accept an untouched pick-one question', () => {
    expect(surveyProblem(QUESTIONS, complete({ [PICK.id]: entry() }))).toMatch(
      /Major/,
    )
  })

  it('will not accept an untouched written question', () => {
    expect(surveyProblem(QUESTIONS, complete({ [NAME.id]: entry() }))).toMatch(
      /call you/,
    )
  })

  it('lets an optional question go unanswered', () => {
    expect(surveyProblem(QUESTIONS, complete({ [NOTE.id]: entry() }))).toBeNull()
  })

  it('wants the line beside an answer that asks for one', () => {
    expect(
      surveyProblem(QUESTIONS, complete({ [PICK.id]: entry({ optionIds: ['o-other'] }) })),
    ).toMatch(/Major/)
  })

  /** Whitespace is not an answer, here or on the server, which trims first. */
  it('does not accept a space as that line', () => {
    expect(
      surveyProblem(
        QUESTIONS,
        complete({ [PICK.id]: entry({ optionIds: ['o-other'], text: '   ' }) }),
      ),
    ).toMatch(/Major/)
  })

  it('takes the line as the answer', () => {
    expect(
      surveyProblem(
        QUESTIONS,
        complete({
          [PICK.id]: entry({ optionIds: ['o-other'], text: 'Biomedical' }),
        }),
      ),
    ).toBeNull()
  })
})

describe('answersFor', () => {
  it('sends nothing for a question nobody touched', () => {
    const sent = answersFor(QUESTIONS, complete({ [NOTE.id]: entry() }))

    expect(sent.some((answer) => answer.questionId === NOTE.id)).toBe(false)
  })

  /** The row existing is what "none" means, so an entry has to go. */
  it('sends an empty answer for a pressed None', () => {
    const sent = answersFor(QUESTIONS, complete())

    expect(sent.find((answer) => answer.questionId === TICK.id)).toEqual({
      questionId: TICK.id,
      optionIds: [],
      text: null,
    })
  })

  /**
   * A stale "Biomedical" left behind a switch back to a listed answer is a row
   * that contradicts itself.
   */
  it('drops text left behind by an answer that no longer asks for it', () => {
    const sent = answersFor(
      QUESTIONS,
      complete({ [PICK.id]: entry({ optionIds: ['o-cs'], text: 'Biomedical' }) }),
    )

    expect(sent.find((answer) => answer.questionId === PICK.id)?.text).toBeNull()
  })

  it('trims a written answer', () => {
    const sent = answersFor(QUESTIONS, complete({ [NAME.id]: entry({ text: '  Rowan ' }) }))

    expect(sent.find((answer) => answer.questionId === NAME.id)?.text).toBe('Rowan')
  })
})

describe('draftFrom', () => {
  const stored: ApiSurvey = {
    submittedAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    answers: [
      { questionId: PICK.id, optionIds: ['o-cs'], text: null },
      { questionId: TICK.id, optionIds: [], text: null },
      { questionId: NAME.id, optionIds: [], text: 'Rowan' },
    ],
  }

  it('starts empty for somebody who has not answered', () => {
    const fresh = draftFrom(QUESTIONS, null)

    expect(fresh[PICK.id].optionIds).toEqual([])
    // Not ticked, so the form insists on an answer rather than defaulting to
    // "no allergies" for a question nobody has read yet.
    expect(fresh[TICK.id].none).toBe(false)
  })

  /**
   * The other direction, and the reason the None boxes are derived rather than
   * stored. An empty list on a saved answer can only have got there by somebody
   * ticking None — the form refuses to submit otherwise — so re-opening it
   * shows the box ticked instead of asking again.
   */
  it('ticks None for a stored empty answer', () => {
    expect(draftFrom(QUESTIONS, stored)[TICK.id].none).toBe(true)
  })

  it('leaves a question added after the answer unanswered rather than absent', () => {
    const later: ApiSurveyQuestion = { ...NAME, id: 'q-later', prompt: 'New one' }

    expect(draftFrom([...QUESTIONS, later], stored)['q-later']).toEqual(entry())
  })

  it('round-trips a saved set of answers back into a valid draft', () => {
    expect(surveyProblem(QUESTIONS, draftFrom(QUESTIONS, stored))).toBeNull()
  })
})

describe('answerLine', () => {
  it('says None out loud rather than leaving a dash', () => {
    expect(answerLine(TICK, { questionId: TICK.id, optionIds: [], text: null })).toBe(
      'None',
    )
  })

  /**
   * OTHER is a placeholder for an answer rather than an answer — printing
   * "Other" at somebody who typed "Biomedical Engineering" is the site telling
   * them it did not keep what they said.
   */
  it('prints what they wrote instead of Other on a pick-one question', () => {
    expect(
      answerLine(PICK, {
        questionId: PICK.id,
        optionIds: ['o-other'],
        text: 'Biomedical',
      }),
    ).toBe('Biomedical')
  })

  it('prints it beside the ticks on a tick-any question', () => {
    const other = { ...TICK, options: [...TICK.options, option('o-x', 'Other', true)] }

    expect(
      answerLine(other, {
        questionId: TICK.id,
        optionIds: ['o-nuts', 'o-x'],
        text: 'Mustard',
      }),
    ).toBe('Nuts, Other (Mustard)')
  })

  /** A question answered before it existed. The caller says so in its words. */
  it('is null for a question with no answer', () => {
    expect(answerLine(PICK, undefined)).toBeNull()
  })
})
