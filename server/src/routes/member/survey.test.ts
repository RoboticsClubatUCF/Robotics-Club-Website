import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import { SurveyQuestionKind, UserRole } from '../../generated/prisma/enums.js'
import { env } from '../../core/env.js'
import { createSession } from '../../auth/session.js'

/**
 * The one-time member survey, against the live database.
 *
 * Namespaced `test-survey-` and deleted by that prefix. The member rows need no clearing of their
 * own: `member_surveys` cascades from `users`.
 *
 * This suite writes `survey_questions`, which is a table it can't namespace its way out of. The
 * questions are global — they're the survey everybody is shown — so the fixtures below are real
 * questions on the club's real survey for the length of a test, the way `officerBoard.test.ts`
 * borrows real seats. Two things keep that safe: every prompt carries the prefix, and they're
 * cleared in `beforeEach` as well as `afterAll`.
 *
 * The club's own questions are left alone and answered along with them. `buildAnswers` reads
 * whatever `GET /api/survey` offers and fills all of it in, which is why nothing here asserts on
 * a particular shirt size.
 *
 * Nothing here mocks Discord, which is the exception worth stating rather than an omission: this
 * router touches nothing that syncs a role.
 */

const PREFIX = 'test-survey-'
const email = (name: string) => `${PREFIX}${name}@ucf.edu`

/** Answered, for the fixtures that are meant to be past the gate already. */
const SURVEYED = new Date('2035-09-01T00:00:00')

const PICK_ONE = `${PREFIX}pick one`
const TICK_ANY = `${PREFIX}tick any`
const WRITE_IT = `${PREFIX}write it`
const OPTIONAL_NOTE = `${PREFIX}optional note`

const clearWindows = () =>
  prisma.rateLimit.deleteMany({ where: { key: { startsWith: 'survey:' } } })

/**
 * People first, then questions.
 *
 * `survey_answer_options.option_id` restricts rather than cascades — deliberate, so deleting an
 * option somebody picked fails loudly instead of quietly losing their answer — which means a
 * question can't be deleted while any answer still names one of its options.
 */
const clearRows = async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
  await prisma.surveyQuestion.deleteMany({
    where: { prompt: { startsWith: PREFIX } },
  })
}

let newcomer = ''
let newcomerCookie = ''
let answered = ''
let answeredCookie = ''

const cookieFor = async (userId: string) =>
  `${env.SESSION_COOKIE_NAME}=${(await createSession(userId)).token}`

beforeEach(async () => {
  await clearWindows()
  await clearRows()

  // Appended after the club's own, so nothing here moves a real question.
  const last = await prisma.surveyQuestion.aggregate({ _max: { position: true } })
  const at = (offset: number) => (last._max.position ?? -1) + offset

  await prisma.surveyQuestion.create({
    data: {
      prompt: PICK_ONE,
      kind: SurveyQuestionKind.SINGLE_CHOICE,
      required: true,
      position: at(1),
      maxLength: 40,
      options: {
        create: [
          { label: 'Alpha', position: 0 },
          { label: 'Beta', position: 1 },
          { label: 'Other', wantsText: true, position: 2 },
        ],
      },
    },
  })

  await prisma.surveyQuestion.create({
    data: {
      prompt: TICK_ANY,
      kind: SurveyQuestionKind.MULTI_CHOICE,
      required: true,
      allowNone: true,
      position: at(2),
      options: {
        create: [
          { label: 'One', position: 0 },
          { label: 'Two', position: 1 },
        ],
      },
    },
  })

  await prisma.surveyQuestion.create({
    data: {
      prompt: WRITE_IT,
      kind: SurveyQuestionKind.SHORT_TEXT,
      required: true,
      maxLength: 20,
      position: at(3),
    },
  })

  await prisma.surveyQuestion.create({
    data: {
      prompt: OPTIONAL_NOTE,
      kind: SurveyQuestionKind.LONG_TEXT,
      required: false,
      position: at(4),
    },
  })

  const [fresh, veteran] = await Promise.all([
    prisma.user.create({
      data: {
        fullName: 'Survey Newcomer',
        email: email('newcomer'),
        role: UserRole.MEMBER,
      },
    }),
    prisma.user.create({
      data: {
        fullName: 'Survey Answered',
        email: email('answered'),
        role: UserRole.MEMBER,
        gradYear: 2026,
        surveyCompletedAt: SURVEYED,
        memberSurvey: { create: {} },
      },
    }),
  ])

  newcomer = fresh.id
  newcomerCookie = await cookieFor(fresh.id)
  answered = veteran.id
  answeredCookie = await cookieFor(veteran.id)
})

afterAll(async () => {
  await clearWindows()
  await clearRows()
  await prisma.$disconnect()
})

// ---------------------------------------------------------------- the wire

type WireQuestion = {
  id: string
  prompt: string
  help: string | null
  kind: SurveyQuestionKind
  required: boolean
  allowNone: boolean
  maxLength: number
  options: { id: string; label: string; wantsText: boolean; retired: boolean }[]
}

type WireAnswer = { questionId: string; text: string | null; optionIds: string[] }

type State = {
  questions: WireQuestion[]
  survey: { submittedAt: string; updatedAt: string; answers: WireAnswer[] } | null
  gradYear: number | null
}

const send = (method: string, cookie: string, body?: unknown) =>
  app.request('/api/survey', {
    method,
    headers: {
      cookie,
      origin: env.SITE_URL,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const read = async (cookie: string): Promise<State> => {
  const response = await send('GET', cookie)

  expect(response.status).toBe(200)

  return (await response.json()) as State
}

const find = (state: State, prompt: string): WireQuestion => {
  const question = state.questions.find((each) => each.prompt === prompt)

  if (question === undefined) throw new Error(`no question “${prompt}”`)

  return question
}

/**
 * A valid answer to everything currently being asked, the club's own questions included.
 *
 * Built from the payload rather than written out, because what the survey asks is a row an
 * officer edits — a hardcoded body would go stale the first time somebody added a question, and
 * would go stale as a refusal rather than an obvious mismatch.
 */
const buildAnswers = (state: State): WireAnswer[] =>
  state.questions.flatMap((question): WireAnswer[] => {
    if (
      question.kind === SurveyQuestionKind.SHORT_TEXT ||
      question.kind === SurveyQuestionKind.LONG_TEXT
    ) {
      // The optional ones are left out, which is what a member skipping them
      // looks like — and is the case worth having in the happy path.
      return question.required
        ? [{ questionId: question.id, text: 'Yes', optionIds: [] }]
        : []
    }

    if (question.kind === SurveyQuestionKind.MULTI_CHOICE && question.allowNone) {
      // An entry with nothing ticked: NONE, pressed. The entry existing is the
      // answer, which is the property the whole food question leans on.
      return [{ questionId: question.id, text: null, optionIds: [] }]
    }

    const plain = question.options.find((option) => !option.wantsText)

    if (plain === undefined) return [{ questionId: question.id, text: null, optionIds: [] }]

    return [{ questionId: question.id, text: null, optionIds: [plain.id] }]
  })

/** The same, with one question's answer replaced. */
const replacing = (
  answers: WireAnswer[],
  questionId: string,
  answer: WireAnswer | null,
): WireAnswer[] => [
  ...answers.filter((each) => each.questionId !== questionId),
  ...(answer === null ? [] : [answer]),
]

const post = async (cookie: string, answers: WireAnswer[], gradYear = 2028) =>
  send('POST', cookie, { answers, gradYear })

const put = async (cookie: string, answers: WireAnswer[], gradYear?: number) =>
  send('PUT', cookie, { answers, ...(gradYear === undefined ? {} : { gradYear }) })

const detailOf = async (response: Response): Promise<string> => {
  const body = (await response.json()) as { error?: string; message?: string }

  return body.error ?? body.message ?? ''
}

const answerFor = (state: State, questionId: string): WireAnswer | undefined =>
  state.survey?.answers.find((answer) => answer.questionId === questionId)

// -------------------------------------------------------------------- read

describe('reading it', () => {
  it('answers null for somebody who has not filled it in', async () => {
    const state = await read(newcomerCookie)

    expect(state.survey).toBeNull()
    expect(state.gradYear).toBeNull()
  })

  it('hands back the questions whether or not they have been answered', async () => {
    const state = await read(newcomerCookie)

    const pick = find(state, PICK_ONE)

    expect(pick.kind).toBe('SINGLE_CHOICE')
    expect(pick.required).toBe(true)
    expect(pick.options.map((option) => option.label)).toEqual([
      'Alpha',
      'Beta',
      'Other',
    ])
    expect(pick.options.at(-1)?.wantsText).toBe(true)
  })

  /** The cap the form puts on its input is the cap the server applies. */
  it('resolves a question without its own cap to a default rather than null', async () => {
    const state = await read(newcomerCookie)

    expect(find(state, WRITE_IT).maxLength).toBe(20)
    expect(find(state, OPTIONAL_NOTE).maxLength).toBeGreaterThan(0)
  })

  it('never offers a question the club has stopped asking', async () => {
    await prisma.surveyQuestion.updateMany({
      where: { prompt: WRITE_IT },
      data: { archivedAt: new Date() },
    })

    const state = await read(newcomerCookie)

    expect(state.questions.some((each) => each.prompt === WRITE_IT)).toBe(false)
  })
})

// ------------------------------------------------------------------ answer

describe('answering it', () => {
  it('stores the answers, stamps the gate and takes the graduation year', async () => {
    const state = await read(newcomerCookie)
    const pick = find(state, PICK_ONE)

    const response = await post(
      newcomerCookie,
      replacing(buildAnswers(state), pick.id, {
        questionId: pick.id,
        text: null,
        optionIds: [pick.options[1].id],
      }),
    )

    expect(response.status).toBe(201)

    const after = await read(newcomerCookie)

    expect(answerFor(after, pick.id)?.optionIds).toEqual([pick.options[1].id])
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: newcomer } })).surveyCompletedAt,
    ).not.toBeNull()
    expect(after.gradYear).toBe(2028)
  })

  /**
   * An empty answer is an answer, and the row existing is the only thing that says so. The form
   * presses NONE and sends an entry with nothing in it; without the row nothing could tell that
   * from a question somebody scrolled past, which on the allergy question is the difference
   * between "safe to feed anything" and "we don't know".
   */
  it('keeps an empty tick-any answer as a real answer', async () => {
    const state = await read(newcomerCookie)
    const tick = find(state, TICK_ANY)

    expect((await post(newcomerCookie, buildAnswers(state))).status).toBe(201)

    const after = await read(newcomerCookie)

    expect(answerFor(after, tick.id)).toEqual({
      questionId: tick.id,
      text: null,
      optionIds: [],
    })
  })

  it('refuses a required question that was left out entirely', async () => {
    const state = await read(newcomerCookie)
    const tick = find(state, TICK_ANY)

    const response = await post(
      newcomerCookie,
      replacing(buildAnswers(state), tick.id, null),
    )

    expect(response.status).toBe(400)
    expect(await detailOf(response)).toContain(TICK_ANY)
  })

  it('lets an optional question be left out', async () => {
    const state = await read(newcomerCookie)

    expect((await post(newcomerCookie, buildAnswers(state))).status).toBe(201)

    expect(answerFor(await read(newcomerCookie), find(state, OPTIONAL_NOTE).id)).toBeUndefined()
  })

  it('refuses more than one answer to a pick-one question', async () => {
    const state = await read(newcomerCookie)
    const pick = find(state, PICK_ONE)

    const response = await post(
      newcomerCookie,
      replacing(buildAnswers(state), pick.id, {
        questionId: pick.id,
        text: null,
        optionIds: [pick.options[0].id, pick.options[1].id],
      }),
    )

    expect(response.status).toBe(400)
  })

  it('refuses an option belonging to another question', async () => {
    const state = await read(newcomerCookie)
    const pick = find(state, PICK_ONE)
    const tick = find(state, TICK_ANY)

    const response = await post(
      newcomerCookie,
      replacing(buildAnswers(state), pick.id, {
        questionId: pick.id,
        text: null,
        optionIds: [tick.options[0].id],
      }),
    )

    expect(response.status).toBe(400)
  })

  /** The rule that is about safety rather than tidiness. */
  it('refuses an Other with nothing written beside it', async () => {
    const state = await read(newcomerCookie)
    const pick = find(state, PICK_ONE)
    const other = pick.options.find((option) => option.wantsText)

    const response = await post(
      newcomerCookie,
      replacing(buildAnswers(state), pick.id, {
        questionId: pick.id,
        text: null,
        optionIds: [other?.id ?? ''],
      }),
    )

    expect(response.status).toBe(400)
  })

  /**
   * A stale "Business" left behind a switch back to a listed answer is a row
   * that contradicts itself, so the text is cleared rather than ignored.
   */
  it('drops text sent against an answer that never asked for any', async () => {
    const state = await read(newcomerCookie)
    const pick = find(state, PICK_ONE)

    await post(
      newcomerCookie,
      replacing(buildAnswers(state), pick.id, {
        questionId: pick.id,
        text: 'Left over from Other',
        optionIds: [pick.options[0].id],
      }),
    )

    expect(answerFor(await read(newcomerCookie), pick.id)?.text).toBeNull()
  })

  it('refuses a written answer that is longer than its question allows', async () => {
    const state = await read(newcomerCookie)
    const write = find(state, WRITE_IT)

    const response = await post(
      newcomerCookie,
      replacing(buildAnswers(state), write.id, {
        questionId: write.id,
        text: 'x'.repeat(write.maxLength + 1),
        optionIds: [],
      }),
    )

    expect(response.status).toBe(400)
  })

  it('refuses ticks against a question that wants a sentence', async () => {
    const state = await read(newcomerCookie)
    const write = find(state, WRITE_IT)
    const tick = find(state, TICK_ANY)

    const response = await post(
      newcomerCookie,
      replacing(buildAnswers(state), write.id, {
        questionId: write.id,
        text: 'Yes',
        optionIds: [tick.options[0].id],
      }),
    )

    expect(response.status).toBe(400)
  })

  it('refuses the same question answered twice', async () => {
    const state = await read(newcomerCookie)
    const answers = buildAnswers(state)

    const response = await post(newcomerCookie, [...answers, answers[0]])

    expect(response.status).toBe(400)
  })

  /**
   * A form loaded before an officer edited the survey. Refused rather than
   * half-applied: dropping the answers this server does not recognise would
   * save somebody a survey they never filled in.
   */
  it('refuses an answer to a question that is not on the survey', async () => {
    const state = await read(newcomerCookie)

    const response = await post(newcomerCookie, [
      ...buildAnswers(state),
      {
        questionId: '00000000-0000-7000-8000-000000000000',
        text: null,
        optionIds: [],
      },
    ])

    expect(response.status).toBe(400)
  })

  it('refuses a second submission', async () => {
    const state = await read(answeredCookie)

    expect((await post(answeredCookie, buildAnswers(state))).status).toBe(409)
  })

  it('refuses a signed-out caller', async () => {
    expect((await send('POST', '', { answers: [], gradYear: 2028 })).status).toBe(401)
  })
})

// ----------------------------------------------------------------- correct

describe('correcting it', () => {
  it('replaces the answers without moving the gate or the first date', async () => {
    const before = await read(answeredCookie)
    const pick = find(before, PICK_ONE)

    const response = await put(
      answeredCookie,
      replacing(buildAnswers(before), pick.id, {
        questionId: pick.id,
        text: null,
        optionIds: [pick.options[0].id],
      }),
      2030,
    )

    expect(response.status).toBe(200)

    const after = await read(answeredCookie)

    expect(answerFor(after, pick.id)?.optionIds).toEqual([pick.options[0].id])
    expect(after.gradYear).toBe(2030)
    expect(after.survey?.submittedAt).toBe(before.survey?.submittedAt)
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: answered } })).surveyCompletedAt,
    ).toEqual(SURVEYED)
  })

  it('moves updatedAt even though only the answers changed', async () => {
    const before = await read(answeredCookie)

    await put(answeredCookie, buildAnswers(before), 2030)

    const after = await read(answeredCookie)

    expect(new Date(after.survey?.updatedAt ?? 0).getTime()).toBeGreaterThan(
      new Date(before.survey?.updatedAt ?? 0).getTime(),
    )
  })

  /**
   * The account page's SURVEY panel owns none of the graduation year — ABOUT
   * YOU above it does — so a request from there sends no year, and that has to
   * mean "leave it alone" rather than "clear it".
   */
  it('leaves the graduation year alone when none was sent', async () => {
    const before = await read(answeredCookie)

    await put(answeredCookie, buildAnswers(before))

    expect((await read(answeredCookie)).gradYear).toBe(2026)
  })

  /** ...but "leave it alone" is only an answer when there is one to leave. */
  it('refuses when no year was sent and the account has none', async () => {
    await prisma.user.update({ where: { id: answered }, data: { gradYear: null } })

    const before = await read(answeredCookie)

    expect((await put(answeredCookie, buildAnswers(before))).status).toBe(409)
  })

  it('refuses somebody who has not answered it yet', async () => {
    const state = await read(newcomerCookie)

    expect((await put(newcomerCookie, buildAnswers(state), 2028)).status).toBe(404)
  })

  /**
   * A new question doesn't lock anybody out. Being asked once is the promise the gate keeps, so
   * adding one leaves `surveyCompletedAt` where it was — it's asked for the next time the member
   * opens the form.
   */
  it('does not put somebody back behind the gate when a question is added', async () => {
    await prisma.surveyQuestion.create({
      data: {
        prompt: `${PREFIX}added later`,
        kind: SurveyQuestionKind.SHORT_TEXT,
        required: true,
        position: 900,
      },
    })

    const user = await prisma.user.findUniqueOrThrow({ where: { id: answered } })

    expect(user.surveyCompletedAt).toEqual(SURVEYED)
    expect(
      (await read(answeredCookie)).questions.some(
        (question) => question.prompt === `${PREFIX}added later`,
      ),
    ).toBe(true)
  })

  /**
   * An officer removing an option means "stop offering this". It doesn't mean the people holding
   * it lose their answer the next time they fix a shirt size — a write replaces the whole set, so
   * an option the form couldn't draw would be dropped on the way past.
   */
  it('goes on offering a retired option to the one member holding it', async () => {
    const before = await read(answeredCookie)
    const tick = find(before, TICK_ANY)

    await put(
      answeredCookie,
      replacing(buildAnswers(before), tick.id, {
        questionId: tick.id,
        text: null,
        optionIds: [tick.options[0].id],
      }),
      2030,
    )

    await prisma.surveyOption.update({
      where: { id: tick.options[0].id },
      data: { archivedAt: new Date() },
    })

    const mine = find(await read(answeredCookie), TICK_ANY)
    const theirs = find(await read(newcomerCookie), TICK_ANY)

    expect(mine.options.map((option) => option.id)).toContain(tick.options[0].id)
    expect(mine.options.find((option) => option.id === tick.options[0].id)?.retired).toBe(
      true,
    )
    // ...and to nobody else.
    expect(theirs.options.map((option) => option.id)).not.toContain(
      tick.options[0].id,
    )
  })
})

// ----------------------------------------------------------------- dismiss

/**
 * "Don't ask me again."
 *
 * The survey stopped being a gate, so the only thing left asking is the prompt over the
 * dashboard, and this is its checkbox. Two properties are worth pinning, both about the column
 * staying honest: a second press must not move the timestamp, and answering the survey afterwards
 * must clear it — a row saying both "declined" and "answered" is one the officer desk's count
 * guesses wrong about.
 */
describe('dismissing the prompt', () => {
  const dismiss = (cookie: string) =>
    app.request('/api/survey/dismiss', {
      method: 'POST',
      headers: { cookie, origin: env.SITE_URL },
    })

  const dismissedAt = async (id: string) =>
    (
      await prisma.user.findUniqueOrThrow({
        where: { id },
        select: { surveyPromptDismissedAt: true },
      })
    ).surveyPromptDismissedAt

  it('records it', async () => {
    expect((await dismiss(newcomerCookie)).status).toBe(200)

    expect(await dismissedAt(newcomer)).not.toBeNull()
  })

  /** Idempotent, and the first press is the one the column keeps. */
  it('leaves the first timestamp alone on a second press', async () => {
    await dismiss(newcomerCookie)
    const first = await dismissedAt(newcomer)

    await dismiss(newcomerCookie)

    expect(await dismissedAt(newcomer)).toEqual(first)
  })

  /** Nothing is refused for it — the survey is still there to be filled in. */
  it('is cleared by answering the survey anyway', async () => {
    await dismiss(newcomerCookie)

    const state = await read(newcomerCookie)

    expect((await post(newcomerCookie, buildAnswers(state))).status).toBe(201)
    expect(await dismissedAt(newcomer)).toBeNull()
  })

  /** Same origin rule as every other write on this router. */
  it('refuses a cross-origin press', async () => {
    const response = await app.request('/api/survey/dismiss', {
      method: 'POST',
      headers: { cookie: newcomerCookie, origin: 'https://elsewhere.example' },
    })

    expect(response.status).toBe(403)
  })
})
