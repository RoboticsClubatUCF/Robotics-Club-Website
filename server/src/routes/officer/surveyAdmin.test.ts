import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { SurveyQuestionKind, UserRole } from '../../generated/prisma/enums.js'
import { clearCalendarCache } from '../../membership/semester.js'
import { createSession } from '../../auth/session.js'

/**
 * The survey desk: what the club asks, and what it learned.
 *
 * **This suite writes the survey itself**, which is a table nothing can
 * namespace its way out of — the questions are global, because they are the one
 * form every member is shown. So it borrows rather than owns, the same shape as
 * `officerBoard.test.ts` parking real officer seats and `lab.test.ts` borrowing
 * the one lab row:
 *
 * - every prompt it writes carries `test-sq-`, and those rows are cleared in
 *   `beforeEach` as well as `afterAll`, so a run that dies half way leaves
 *   nothing behind that the next run does not sweep up;
 * - the reorder case rewrites `position` on **every** live question, the club's
 *   own included, so the original order is read before each test and put back
 *   in `afterEach`. A suite that left the survey shuffled is a suite that
 *   reordered a real form.
 *
 * The tallies are asserted as *deltas over this suite's own fixtures* — "the
 * count for this option went up by one" — never as absolute numbers. The desk
 * reads every row in `member_surveys` and the development database has real
 * members in it.
 */

// Nothing here should reach the club's guild. These routes do not push roles,
// but `requireOfficer` sits in front of them and the dev `.env` carries a live
// bot token; the rule in `.claude/docs/testing.md` is that anything that *can*
// reach `pushRoles` mocks this module.
vi.mock('../../discord/discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../discord/discord.js')>()),
  officerSyncConfigured: false,
  officerRoleId: null,
  memberRoleId: null,
  projectLeadRoleId: null,
  teamLeadRoleId: null,
  addGuildRole: vi.fn(() => Promise.resolve({ status: 'done' as const })),
  removeGuildRole: vi.fn(() => Promise.resolve({ status: 'done' as const })),
  guildRoster: vi.fn(() => Promise.resolve({ status: 'unchecked' as const })),
  guildRoles: vi.fn(() => Promise.resolve({ status: 'unchecked' as const })),
}))

const PREFIX = 'test-sq-'
const email = (name: string) => `${PREFIX}${name}@ucf.edu`

/** Paid through, because every officer route ends in `requireCurrentDues`. */
const PAID_THROUGH = new Date(2099, 11, 31)
/** The gate in front of that one. A fixture missing it is refused for the
    wrong reason, and the refusal reads exactly like a missing payment. */
const SURVEYED = new Date('2035-09-01T00:00:00')

const clearWindows = () =>
  prisma.rateLimit.deleteMany({ where: { key: { startsWith: 'officer:' } } })

/**
 * Members first, then questions. `survey_answer_options.option_id` restricts
 * rather than cascades — so that deleting an option somebody picked fails
 * loudly instead of quietly losing their answer — which means a question cannot
 * go while an answer still names one of its options.
 */
const clearRows = async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
  await prisma.surveyQuestion.deleteMany({
    where: { prompt: { startsWith: PREFIX } },
  })
}

let officerCookie = ''
let memberCookie = ''
let memberId = ''

const cookieFor = async (userId: string) =>
  `${env.SESSION_COOKIE_NAME}=${(await createSession(userId)).token}`

/** The order the survey was in before this suite touched it. */
let order: { id: string; position: number }[] = []

beforeEach(async () => {
  await clearWindows()
  await clearRows()
  clearCalendarCache()

  order = await prisma.surveyQuestion.findMany({
    select: { id: true, position: true },
  })

  const [officer, member] = await Promise.all([
    prisma.user.create({
      data: {
        fullName: 'Survey Officer',
        email: email('officer'),
        role: UserRole.OFFICER,
        duesPaidThrough: PAID_THROUGH,
        surveyCompletedAt: SURVEYED,
      },
    }),
    prisma.user.create({
      data: {
        fullName: 'Survey Member',
        email: email('member'),
        role: UserRole.MEMBER,
        duesPaidThrough: PAID_THROUGH,
        surveyCompletedAt: SURVEYED,
      },
    }),
  ])

  officerCookie = await cookieFor(officer.id)
  memberCookie = await cookieFor(member.id)
  memberId = member.id
})

afterEach(async () => {
  // Whatever the reorder case did, undone. Only rows that still exist: this
  // suite's own were deleted by the time a later `beforeEach` runs, and a
  // question the club deleted in Studio mid-run is not this suite's to recreate.
  for (const question of order) {
    await prisma.surveyQuestion.updateMany({
      where: { id: question.id },
      data: { position: question.position },
    })
  }
})

afterAll(async () => {
  await clearWindows()
  await clearRows()
  await prisma.$disconnect()
})

// ---------------------------------------------------------------- the wire

type WireOption = {
  id: string
  label: string
  wantsText: boolean
  archived: boolean
  picked: number
}

type WireQuestion = {
  id: string
  prompt: string
  help: string | null
  kind: SurveyQuestionKind
  required: boolean
  allowNone: boolean
  maxLength: number | null
  position: number
  archived: boolean
  answered: number
  options: WireOption[]
}

const send = (method: string, path: string, cookie: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: {
      cookie,
      origin: env.SITE_URL,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const list = async (cookie = officerCookie): Promise<WireQuestion[]> => {
  const response = await send('GET', '/api/officer/survey/questions', cookie)

  expect(response.status).toBe(200)

  return ((await response.json()) as { questions: WireQuestion[] }).questions
}

const mine = async (prompt: string): Promise<WireQuestion> => {
  const found = (await list()).find((question) => question.prompt === prompt)

  if (found === undefined) throw new Error(`no question “${prompt}”`)

  return found
}

/** A pick-one question with three answers, the last of which asks for a line. */
const askable = (prompt: string) => ({
  prompt,
  help: 'Because the club has to know.',
  kind: 'SINGLE_CHOICE' as const,
  required: true,
  allowNone: false,
  maxLength: 60,
  options: [
    { label: 'Alpha', wantsText: false },
    { label: 'Beta', wantsText: false },
    { label: 'Other', wantsText: true },
  ],
})

const create = (body: unknown, cookie = officerCookie) =>
  send('POST', '/api/officer/survey/questions', cookie, body)

const edit = (id: string, body: unknown, cookie = officerCookie) =>
  send('PUT', `/api/officer/survey/questions/${id}`, cookie, body)

const remove = (id: string, cookie = officerCookie) =>
  send('DELETE', `/api/officer/survey/questions/${id}`, cookie)

/** One answer to one question, written straight into the table. The route that
    writes these is `routes/member/survey.ts`, and it is tested there. */
const answerWith = async (questionId: string, optionIds: string[], text?: string) => {
  const survey = await prisma.memberSurvey.upsert({
    where: { userId: memberId },
    create: { userId: memberId },
    update: {},
    select: { id: true },
  })

  await prisma.surveyAnswer.create({
    data: {
      surveyId: survey.id,
      questionId,
      text: text ?? null,
      picked: { create: optionIds.map((optionId) => ({ optionId })) },
    },
  })
}

// ------------------------------------------------------------ asking things

describe('adding a question', () => {
  it('appends it to the end of the survey', async () => {
    const before = await list()

    expect((await create(askable(`${PREFIX}new`))).status).toBe(201)

    const added = await mine(`${PREFIX}new`)

    expect(added.options.map((option) => option.label)).toEqual([
      'Alpha',
      'Beta',
      'Other',
    ])
    expect(added.position).toBeGreaterThan(
      Math.max(...before.map((question) => question.position), -1),
    )
  })

  /**
   * A pick-one question with a single answer is a question whose answer is
   * already known, and the tally it makes says nothing.
   */
  it('refuses a pick-one question with one answer to pick', async () => {
    const response = await create({
      ...askable(`${PREFIX}thin`),
      options: [{ label: 'Only', wantsText: false }],
    })

    expect(response.status).toBe(400)
  })

  it('refuses answers on a question that wants a sentence', async () => {
    const response = await create({
      ...askable(`${PREFIX}written`),
      kind: 'LONG_TEXT',
    })

    expect(response.status).toBe(400)
  })

  it('refuses a None box on anything but a tick-any question', async () => {
    const response = await create({ ...askable(`${PREFIX}noneish`), allowNone: true })

    expect(response.status).toBe(400)
  })

  it('refuses two answers reading the same thing', async () => {
    const response = await create({
      ...askable(`${PREFIX}twice`),
      options: [
        { label: 'Same', wantsText: false },
        { label: 'same', wantsText: false },
      ],
    })

    expect(response.status).toBe(400)
  })

  /** One box per question, not one per answer. */
  it('refuses two answers that each ask for a written reply', async () => {
    const response = await create({
      ...askable(`${PREFIX}others`),
      options: [
        { label: 'One', wantsText: true },
        { label: 'Two', wantsText: true },
      ],
    })

    expect(response.status).toBe(400)
  })

  it('is officer business', async () => {
    expect((await create(askable(`${PREFIX}nope`), memberCookie)).status).toBe(403)
    expect((await list(memberCookie).catch(() => 'refused')).valueOf()).toBe('refused')
  })
})

describe('editing a question', () => {
  it('rewords it and keeps the answers already given against its options', async () => {
    await create(askable(`${PREFIX}edit`))
    const before = await mine(`${PREFIX}edit`)

    await answerWith(before.id, [before.options[0].id])

    const response = await edit(before.id, {
      ...askable(`${PREFIX}edit reworded`),
      options: before.options.map((option) => ({
        id: option.id,
        label: option.label,
        wantsText: option.wantsText,
      })),
    })

    expect(response.status).toBe(200)

    const after = await mine(`${PREFIX}edit reworded`)

    expect(after.id).toBe(before.id)
    expect(after.options[0].id).toBe(before.options[0].id)
    expect(after.options[0].picked).toBe(1)
  })

  it('deletes an option nobody picked and retires one somebody did', async () => {
    await create(askable(`${PREFIX}drop`))
    const before = await mine(`${PREFIX}drop`)

    await answerWith(before.id, [before.options[0].id])

    // Both dropped from the list: the picked one and the untouched one.
    await edit(before.id, {
      ...askable(`${PREFIX}drop`),
      options: [
        { id: before.options[0].id, label: 'Alpha', wantsText: false },
        { label: 'Gamma', wantsText: false },
      ],
    })

    const after = await mine(`${PREFIX}drop`)
    const labels = after.options.map((option) => option.label)

    expect(labels).toEqual(['Alpha', 'Gamma'])
    // Beta had no answers, so it went. Other had none either.
    expect(
      await prisma.surveyOption.count({
        where: { questionId: before.id, label: 'Beta' },
      }),
    ).toBe(0)
  })

  it('retires a picked option rather than losing the answer with it', async () => {
    await create(askable(`${PREFIX}retire`))
    const before = await mine(`${PREFIX}retire`)

    await answerWith(before.id, [before.options[1].id])

    await edit(before.id, {
      ...askable(`${PREFIX}retire`),
      options: [
        { id: before.options[0].id, label: 'Alpha', wantsText: false },
        { id: before.options[2].id, label: 'Other', wantsText: true },
      ],
    })

    const retired = (await mine(`${PREFIX}retire`)).options.find(
      (option) => option.id === before.options[1].id,
    )

    expect(retired?.archived).toBe(true)
    expect(retired?.picked).toBe(1)
  })

  /** Putting its id back in the list is the whole of "restore an option". */
  it('brings a retired option back when its id is listed again', async () => {
    await create(askable(`${PREFIX}back`))
    const before = await mine(`${PREFIX}back`)

    await answerWith(before.id, [before.options[1].id])

    const keep = (option: WireOption) => ({
      id: option.id,
      label: option.label,
      wantsText: option.wantsText,
    })

    await edit(before.id, {
      ...askable(`${PREFIX}back`),
      options: [keep(before.options[0]), keep(before.options[2])],
    })

    await edit(before.id, {
      ...askable(`${PREFIX}back`),
      options: before.options.map(keep),
    })

    expect(
      (await mine(`${PREFIX}back`)).options.every((option) => !option.archived),
    ).toBe(true)
  })

  it('refuses an option belonging to another question', async () => {
    await create(askable(`${PREFIX}one`))
    await create(askable(`${PREFIX}two`))

    const one = await mine(`${PREFIX}one`)
    const two = await mine(`${PREFIX}two`)

    const response = await edit(one.id, {
      ...askable(`${PREFIX}one`),
      options: [
        { id: two.options[0].id, label: 'Stolen', wantsText: false },
        { label: 'Beta', wantsText: false },
      ],
    })

    expect(response.status).toBe(400)
  })

  /**
   * Forty ticks against a question that now wants a sentence are forty rows
   * nothing can render, and there is no honest way to convert them.
   */
  it('refuses a change of kind once anybody has answered', async () => {
    await create(askable(`${PREFIX}locked`))
    const question = await mine(`${PREFIX}locked`)

    await answerWith(question.id, [question.options[0].id])

    const response = await edit(question.id, {
      ...askable(`${PREFIX}locked`),
      kind: 'LONG_TEXT',
      options: [],
    })

    expect(response.status).toBe(409)
  })

  it('allows a change of kind while nobody has', async () => {
    await create(askable(`${PREFIX}open`))
    const question = await mine(`${PREFIX}open`)

    const response = await edit(question.id, {
      ...askable(`${PREFIX}open`),
      kind: 'LONG_TEXT',
      options: [],
    })

    expect(response.status).toBe(200)
    expect((await mine(`${PREFIX}open`)).kind).toBe('LONG_TEXT')
  })
})

describe('removing a question', () => {
  it('deletes one nobody has answered', async () => {
    await create(askable(`${PREFIX}gone`))
    const question = await mine(`${PREFIX}gone`)

    const response = await remove(question.id)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ removed: 'deleted' })
    expect(
      await prisma.surveyQuestion.count({ where: { id: question.id } }),
    ).toBe(0)
  })

  /**
   * REMOVE means "stop asking this". It does not mean "throw away what forty
   * people told us", and there is nothing at the button that could tell the two
   * apart.
   */
  it('retires one that has answers, and stops offering it', async () => {
    await create(askable(`${PREFIX}kept`))
    const question = await mine(`${PREFIX}kept`)

    await answerWith(question.id, [question.options[0].id])

    expect(await (await remove(question.id)).json()).toEqual({ removed: 'archived' })

    expect((await mine(`${PREFIX}kept`)).archived).toBe(true)
    // Gone from the form, and from the desk's tallies.
    const asked = (await (
      await send('GET', '/api/survey', memberCookie)
    ).json()) as { questions: { prompt: string }[] }

    expect(asked.questions.some((each) => each.prompt === `${PREFIX}kept`)).toBe(
      false,
    )
  })

  it('asks it again on restore, at the end of the survey', async () => {
    await create(askable(`${PREFIX}again`))
    const question = await mine(`${PREFIX}again`)

    await answerWith(question.id, [question.options[0].id])
    await remove(question.id)

    const response = await send(
      'POST',
      `/api/officer/survey/questions/${question.id}/restore`,
      officerCookie,
    )

    expect(response.status).toBe(200)

    const restored = await mine(`${PREFIX}again`)

    expect(restored.archived).toBe(false)
    expect(restored.answered).toBe(1)
  })

  it('is officer business', async () => {
    await create(askable(`${PREFIX}guarded`))

    expect((await remove((await mine(`${PREFIX}guarded`)).id, memberCookie)).status).toBe(
      403,
    )
  })
})

describe('rearranging the survey', () => {
  const reorder = (ids: string[], cookie = officerCookie) =>
    send('POST', '/api/officer/survey/reorder', cookie, { ids })

  it('writes the order it was given', async () => {
    await create(askable(`${PREFIX}first`))
    await create(askable(`${PREFIX}second`))

    const live = (await list()).filter((question) => !question.archived)
    const reversed = [...live].reverse().map((question) => question.id)

    expect((await reorder(reversed)).status).toBe(200)

    const after = (await list())
      .filter((question) => !question.archived)
      .sort((a, b) => a.position - b.position)
      .map((question) => question.id)

    expect(after).toEqual(reversed)
  })

  /**
   * Two officers editing at once. A partial list would leave the questions it
   * omits holding positions that collide with the ones it names, so it is
   * refused rather than half-applied.
   */
  it('refuses a list that is not the whole survey', async () => {
    await create(askable(`${PREFIX}partial`))

    const live = (await list()).filter((question) => !question.archived)

    expect((await reorder([live[0].id])).status).toBe(409)
  })
})

// --------------------------------------------------------- what it learned

describe('the tallies', () => {
  type Summary = {
    responded: number
    outstanding: number
    questions: {
      id: string
      prompt: string
      answered: number
      none: number | null
      options: { id: string; label: string; archived: boolean; count: number }[]
    }[]
    gradYears: { value: number; count: number }[]
  }

  const summary = async (cookie = officerCookie): Promise<Summary> => {
    const response = await send('GET', '/api/officer/survey', cookie)

    expect(response.status).toBe(200)

    return (await response.json()) as Summary
  }

  const rowFor = (data: Summary, prompt: string) => {
    const found = data.questions.find((question) => question.prompt === prompt)

    if (found === undefined) throw new Error(`no tally for “${prompt}”`)

    return found
  }

  it('counts a pick into its option and leaves the rest on nought', async () => {
    await create(askable(`${PREFIX}counted`))
    const question = await mine(`${PREFIX}counted`)

    await answerWith(question.id, [question.options[1].id])

    const row = rowFor(await summary(), `${PREFIX}counted`)

    expect(row.answered).toBe(1)
    /**
     * **The zeroes are the point.** A list that omits the sizes nobody picked
     * reads to whoever is placing the shirt order as "we need none of those"
     * rather than as "nobody has asked".
     */
    expect(row.options.map((option) => option.count)).toEqual([0, 1, 0])
  })

  it('counts a None as its own number rather than as an option', async () => {
    const response = await create({
      prompt: `${PREFIX}nones`,
      kind: 'MULTI_CHOICE',
      required: true,
      allowNone: true,
      options: [
        { label: 'One', wantsText: false },
        { label: 'Two', wantsText: false },
      ],
    })

    expect(response.status).toBe(201)

    const question = await mine(`${PREFIX}nones`)

    await answerWith(question.id, [])

    const row = rowFor(await summary(), `${PREFIX}nones`)

    expect(row.none).toBe(1)
    expect(row.answered).toBe(1)
    expect(row.options.every((option) => option.count === 0)).toBe(true)
  })

  /**
   * A count that quietly drops the people who picked something since retired is
   * a count that does not add up to the number who answered. A retired option
   * nobody picked is a row about a question nobody is being asked, and goes.
   */
  it('keeps a retired option that people picked, and drops one nobody did', async () => {
    await create(askable(`${PREFIX}retired tally`))
    const question = await mine(`${PREFIX}retired tally`)

    await answerWith(question.id, [question.options[0].id])

    await prisma.surveyOption.updateMany({
      where: { id: { in: [question.options[0].id, question.options[1].id] } },
      data: { archivedAt: new Date() },
    })

    const row = rowFor(await summary(), `${PREFIX}retired tally`)
    const labels = row.options.map((option) => option.label)

    expect(labels).toContain('Alpha')
    expect(labels).not.toContain('Beta')
    expect(row.options.find((option) => option.label === 'Alpha')?.archived).toBe(true)
  })

  it('counts who still owes one', async () => {
    const before = await summary()

    await prisma.user.update({
      where: { id: memberId },
      data: { surveyCompletedAt: null },
    })

    expect((await summary()).outstanding).toBe(before.outstanding + 1)
  })

  it('is officer business', async () => {
    expect((await send('GET', '/api/officer/survey', memberCookie)).status).toBe(403)
  })
})

describe('the spreadsheet', () => {
  const csv = async (cookie = officerCookie) => {
    const response = await send('GET', '/api/officer/survey/export.csv', cookie)

    return { response, text: await response.text() }
  }

  it('comes back as a download rather than a page', async () => {
    const { response } = await csv()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/text\/csv/)
    expect(response.headers.get('content-disposition')).toMatch(/attachment/)
    // Members' names and allergies: never in a shared cache.
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('gives each question a column and attaches the answers to a person', async () => {
    await create(askable(`${PREFIX}column`))
    const question = await mine(`${PREFIX}column`)

    await answerWith(question.id, [question.options[2].id], 'Biomedical')

    const { text } = await csv()

    expect(text).toContain(`${PREFIX}column`)
    expect(text).toContain('Survey Member')
    // The free-text half of an OTHER, in brackets after the answer that asked
    // for it, rather than in a second column empty for everybody else.
    expect(text).toContain('Other (Biomedical)')
  })

  /**
   * The one that is not obvious. Several of these columns are free text a
   * member typed, and this file gets opened in Excel — where a cell starting
   * `=` is a formula, not a string. The apostrophe is the standard defence.
   */
  it('defangs a free-text answer that looks like a formula', async () => {
    const response = await create({
      prompt: `${PREFIX}formula`,
      kind: 'SHORT_TEXT',
      required: false,
      allowNone: false,
      options: [],
    })

    expect(response.status).toBe(201)

    await answerWith((await mine(`${PREFIX}formula`)).id, [], '=1+1')

    const { text } = await csv()

    expect(text).toContain('"\'=1+1"')
    expect(text).not.toContain('"=1+1"')
  })

  it('is officer business too', async () => {
    expect((await csv(memberCookie)).response.status).toBe(403)
  })
})
