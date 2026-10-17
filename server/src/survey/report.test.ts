import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../core/db.js'
import { getTerm } from '../membership/semester.js'
import { reportQuery, surveyReport } from './report.js'

vi.mock('../membership/semester.js', async (original) => ({
  ...(await original<typeof import('../membership/semester.js')>()),
  currentTerm: vi.fn(async () => ({
    year: 2035,
    season: 'FALL',
    startsAt: new Date(2035, 8, 1),
    endsAt: new Date(2035, 11, 20, 23, 59, 59, 999),
    fromCalendar: true,
  })),
  getTerm: vi.fn(async () => ({
    year: 2035,
    season: 'SUMMER',
    startsAt: new Date(2035, 4, 10),
    endsAt: new Date(2035, 7, 20, 23, 59, 59, 999),
    fromCalendar: true,
  })),
}))

const PREFIX = 'test-survey-report-'
const NOW = new Date('2035-10-17T16:00:00Z')
let choiceId = ''
let textId = ''
let multiId = ''
let alphaId = ''
let retiredId = ''
let multiOptionId = ''
let ids: string[] = []

const clear = async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
  await prisma.surveyQuestion.deleteMany({ where: { prompt: { startsWith: PREFIX } } })
}

beforeEach(async () => {
  await clear()
  const choice = await prisma.surveyQuestion.create({
    data: {
      prompt: `${PREFIX}choice`,
      kind: 'SINGLE_CHOICE',
      position: 99990,
      options: {
        create: [
          { label: `${PREFIX}Alpha`, position: 0 },
          { label: `${PREFIX}Beta`, position: 1 },
          { label: `${PREFIX}Retired`, position: 2, archivedAt: NOW },
        ],
      },
    },
    include: { options: { orderBy: { position: 'asc' } } },
  })
  choiceId = choice.id
  alphaId = choice.options[0].id
  retiredId = choice.options[2].id
  textId = (
    await prisma.surveyQuestion.create({
      data: { prompt: `${PREFIX}text`, kind: 'LONG_TEXT', position: 99991 },
    })
  ).id
  const multi = await prisma.surveyQuestion.create({
    data: {
      prompt: `${PREFIX}multi`,
      kind: 'MULTI_CHOICE',
      allowNone: true,
      position: 99992,
      options: { create: [{ label: 'One', position: 0 }] },
    },
    include: { options: true },
  })
  multiId = multi.id
  multiOptionId = multi.options[0].id
  ids = []
  const submitted = [
    '2035-09-01T04:00:00Z',
    '2035-07-01T04:00:00Z',
    '2034-12-31T05:00:00Z',
  ]
  const updated = ['2035-10-17T05:00:00Z', '2035-10-17T15:00:00Z', '2035-01-01T05:00:00Z']
  for (const [index, name] of ['Alice', 'Bob', 'Casey'].entries()) {
    const user = await prisma.user.create({
      data: {
        fullName: `${PREFIX}${name}`,
        email: `${PREFIX}${name.toLowerCase()}@ucf.edu`,
        active: index !== 1,
        gradYear: index === 2 ? null : 2036 + index,
        role: 'MEMBER',
        surveyCompletedAt: new Date(submitted[index]),
      },
    })
    const survey = await prisma.memberSurvey.create({
      data: {
        userId: user.id,
        submittedAt: new Date(submitted[index]),
        updatedAt: new Date(updated[index]),
        answers: {
          create:
            index === 2
              ? []
              : [
                  {
                    questionId: choiceId,
                    picked: { create: [{ optionId: index === 0 ? alphaId : retiredId }] },
                  },
                  {
                    questionId: multiId,
                    picked: { create: index === 0 ? [] : [{ optionId: multiOptionId }] },
                  },
                  ...(index === 0
                    ? [{ questionId: textId, text: `${PREFIX}ingredient note` }]
                    : []),
                ],
        },
      },
    })
    ids.push(survey.id)
  }
})

afterAll(async () => {
  await clear()
  await prisma.$disconnect()
})

const report = (query: Record<string, string> = {}, now = NOW) =>
  surveyReport(reportQuery.parse({ q: PREFIX, ...query }), now)

describe('survey report cohorts', () => {
  it('keeps zero counts and selected retired choices in the filtered tallies', async () => {
    const data = await report()
    expect(data.responded).toBe(3)
    expect(
      data.questions
        .find((question) => question.id === choiceId)
        ?.options.map((option) => option.count),
    ).toEqual([1, 0, 1])
    expect(data.questions.find((question) => question.id === choiceId)?.answered).toBe(2)
    expect(data.questions.find((question) => question.id === multiId)?.none).toBe(1)
    expect(data.gradYears).toEqual([
      { value: 2036, count: 1 },
      { value: 2037, count: 1 },
    ])
  })

  it('uses semester dates for the current and previous semester, including summer', async () => {
    const current = await report({ period: 'current_term' })
    expect(current.responses.map((row) => row.id)).toEqual([ids[0]])
    expect(current.range.from).toEqual(new Date('2035-09-01T04:00:00Z'))
    expect(current.range.to).toEqual(new Date('2035-12-21T04:59:59.999Z'))
    const previous = await report({ period: 'previous_term' })
    expect(previous.responses.map((row) => row.id)).toEqual([ids[1]])
    expect(getTerm).toHaveBeenCalledWith(2035, 'SUMMER')
  })

  it('distinguishes the first submission date from the last edit date', async () => {
    expect(
      (await report({ period: 'current_term', dateField: 'updated' })).responses.map(
        (row) => row.id,
      ),
    ).toEqual([ids[1], ids[0]])
    expect((await report({ period: 'last30', dateField: 'submitted' })).responded).toBe(0)
    expect((await report({ period: 'last30', dateField: 'updated' })).responded).toBe(2)
  })

  it('uses the campus calendar year even when UTC has entered the next year', async () => {
    const data = await report({ period: 'year' }, new Date('2036-01-01T02:00:00Z'))
    expect(data.range.label).toBe('2035')
    expect(data.range.from).toEqual(new Date('2035-01-01T05:00:00Z'))
    expect(data.range.to).toEqual(new Date('2036-01-01T04:59:59.999Z'))
    expect(data.responses.map((row) => row.id)).toEqual([ids[1], ids[0]])
  })

  it('includes the whole custom campus day across daylight saving time', async () => {
    await prisma.memberSurvey.update({
      where: { id: ids[0] },
      data: { submittedAt: new Date('2026-03-08T05:00:00Z') },
    })
    await prisma.memberSurvey.update({
      where: { id: ids[1] },
      data: { submittedAt: new Date('2026-03-09T03:59:59.999Z') },
    })
    await prisma.memberSurvey.update({
      where: { id: ids[2] },
      data: { submittedAt: new Date('2026-03-09T04:00:00Z') },
    })
    const data = await report({ period: 'custom', from: '2026-03-08', to: '2026-03-08' })
    expect(data.responses.map((row) => row.id).sort()).toEqual([ids[0], ids[1]].sort())
    await prisma.memberSurvey.update({
      where: { id: ids[1] },
      data: { submittedAt: new Date('2026-03-08T04:59:59.999Z') },
    })
    expect(
      (await report({ period: 'custom', from: '2026-03-08', to: '2026-03-08' }))
        .responded,
    ).toBe(1)
  })

  it('combines membership, graduation-year and answer filters without changing the global facets', async () => {
    const data = await report({
      population: 'active',
      gradYear: '2036',
      questionId: choiceId,
      answer: alphaId,
    })
    expect(data.responses.map((row) => row.id)).toEqual([ids[0]])
    expect(
      data.questions
        .find((question) => question.id === choiceId)
        ?.options.map((option) => option.count),
    ).toEqual([1, 0])
    expect(
      data.facets.questions.find((question) => question.id === choiceId)?.options,
    ).toHaveLength(3)
    expect(data.facets.gradYears).toEqual(expect.arrayContaining([2036, 2037]))
    expect(
      (await report({ population: 'inactive' })).responses.map((row) => row.id),
    ).toEqual([ids[1]])
    expect(
      (await report({ gradYear: 'unknown' })).responses.map((row) => row.id),
    ).toEqual([ids[2]])
  })

  it('searches written answers, selected choices and member names', async () => {
    expect(
      (await report({ q: `${PREFIX}ingredient` })).responses.map((row) => row.id),
    ).toEqual([ids[0]])
    expect(
      (await report({ q: `${PREFIX}Retired` })).responses.map((row) => row.id),
    ).toEqual([ids[1]])
    expect(
      (await report({ q: `${PREFIX}Casey` })).responses.map((row) => row.id),
    ).toEqual([ids[2]])
  })

  it('keeps None separate from an unanswered question', async () => {
    expect(
      (await report({ questionId: multiId, answer: 'none' })).responses.map(
        (row) => row.id,
      ),
    ).toEqual([ids[0]])
    expect(
      (await report({ questionId: multiId, answer: 'unanswered' })).responses.map(
        (row) => row.id,
      ),
    ).toEqual([ids[2]])
    expect((await report({ questionId: multiId, answer: 'answered' })).responded).toBe(2)
    await expect(report({ questionId: choiceId, answer: 'none' })).rejects.toThrow(
      'does not offer None',
    )
    await expect(report({ questionId: choiceId, answer: multiOptionId })).rejects.toThrow(
      'does not belong',
    )
  })

  it('sorts responses by dates, name and graduation year, keeping missing years last', async () => {
    expect((await report({ sort: 'name_desc' })).responses.map((row) => row.id)).toEqual([
      ids[2],
      ids[1],
      ids[0],
    ])
    expect(
      (await report({ sort: 'submitted_asc' })).responses.map((row) => row.id),
    ).toEqual([ids[2], ids[1], ids[0]])
    expect(
      (await report({ sort: 'updated_desc' })).responses.map((row) => row.id),
    ).toEqual([ids[1], ids[0], ids[2]])
    expect((await report({ sort: 'grad_desc' })).responses.map((row) => row.id)).toEqual([
      ids[1],
      ids[0],
      ids[2],
    ])
  })

  it.each([
    { period: 'custom' },
    { period: 'custom', from: '2026-02-30' },
    { period: 'custom', from: '2026-10-20', to: '2026-10-01' },
    { answer: 'none' },
    { sort: 'not-a-sort' },
    { period: 'year', from: '2026-01-01' },
  ])('refuses invalid filters: %j', (query) => {
    expect(reportQuery.safeParse(query).success).toBe(false)
  })
})
