import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { prisma } from '../core/db.js'
import type {
  MemberSurveyOrderByWithRelationInput,
  MemberSurveyWhereInput,
} from '../generated/prisma/models.js'
import { SurveyQuestionKind, UserRole } from '../generated/prisma/enums.js'
import { currentTerm, getTerm, termBefore } from '../membership/semester.js'
import { campusDate, startOfCampusDay } from '../projects/meetings.js'

export const reportQuery = z
  .object({
    period: z
      .enum(['all', 'current_term', 'previous_term', 'year', 'last30', 'custom'])
      .default('all'),
    dateField: z.enum(['submitted', 'updated']).default('submitted'),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    gradYear: z
      .union([z.literal('unknown'), z.coerce.number().int().min(1000).max(9999)])
      .optional(),
    population: z.enum(['all', 'active', 'inactive']).default('all'),
    q: z.string().trim().max(120).default(''),
    questionId: z.uuid().optional(),
    answer: z.union([z.enum(['answered', 'unanswered', 'none']), z.uuid()]).optional(),
    sort: z
      .enum([
        'updated_desc',
        'updated_asc',
        'submitted_desc',
        'submitted_asc',
        'name_asc',
        'name_desc',
        'grad_asc',
        'grad_desc',
      ])
      .default('updated_desc'),
  })
  .superRefine((query, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (query.period === 'custom' && !query.from && !query.to)
      issue('Choose a start or end date.')
    if (query.period !== 'custom' && (query.from || query.to))
      issue('Custom dates require the custom date range.')
    if (query.from && query.to && query.from > query.to)
      issue('The end date must be on or after the start date.')
    if (query.answer && !query.questionId)
      issue('Choose a question before filtering its answers.')
  })

type Query = z.infer<typeof reportQuery>
const DAY = 86_400_000
// Semester dates are normalized with local setters by getTerm. Interpret those
// calendar days in Orlando, even when the API host's own timezone is UTC.
const termDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const midnight = (day: string) => startOfCampusDay(new Date(`${day}T12:00:00Z`))
const dayAfter = (day: string) =>
  startOfCampusDay(new Date(new Date(`${day}T12:00:00Z`).getTime() + DAY))

async function dateRange(query: Query, now: Date) {
  let from: Date | null = null
  let to: Date | null = null
  let label = 'All time'
  let estimated = false
  if (query.period === 'current_term' || query.period === 'previous_term') {
    let term = await currentTerm(now)
    if (query.period === 'previous_term') {
      const previous = termBefore(term)
      term = await getTerm(previous.year, previous.season)
    }
    from = midnight(termDay(term.startsAt))
    to = new Date(dayAfter(termDay(term.endsAt)).getTime() - 1)
    label = `${term.season[0]}${term.season.slice(1).toLowerCase()} ${term.year}`
    estimated = !term.fromCalendar
  } else if (query.period === 'year') {
    const year = campusDate(now).slice(0, 4)
    from = midnight(`${year}-01-01`)
    to = new Date(dayAfter(`${year}-12-31`).getTime() - 1)
    label = year
  } else if (query.period === 'last30') {
    const today = campusDate(now)
    from = midnight(
      campusDate(new Date(new Date(`${today}T12:00:00Z`).getTime() - 29 * DAY)),
    )
    to = new Date(dayAfter(today).getTime() - 1)
    label = 'Last 30 days'
  } else if (query.period === 'custom') {
    from = query.from ? midnight(query.from) : null
    to = query.to ? new Date(dayAfter(query.to).getTime() - 1) : null
    label = 'Custom dates'
  }
  return { label, from, to, estimated, dateField: query.dateField }
}

const ordering = (sort: Query['sort']): MemberSurveyOrderByWithRelationInput[] => {
  const [field, direction] = sort.split('_') as [string, 'asc' | 'desc']
  const first: MemberSurveyOrderByWithRelationInput =
    field === 'name'
      ? { user: { fullName: direction } }
      : field === 'grad'
        ? { user: { gradYear: { sort: direction, nulls: 'last' } } }
        : field === 'submitted'
          ? { submittedAt: direction }
          : { updatedAt: direction }
  return [first, { user: { fullName: 'asc' } }, { id: 'asc' }]
}

/** One cohort drives the tallies, individual responses and the exported spreadsheet. */
export async function surveyReport(query: Query, now = new Date()) {
  const [range, questions] = await Promise.all([
    dateRange(query, now),
    prisma.surveyQuestion.findMany({
      where: { archivedAt: null },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        prompt: true,
        kind: true,
        allowNone: true,
        options: {
          orderBy: { position: 'asc' },
          select: { id: true, label: true, archivedAt: true },
        },
      },
    }),
  ])
  const where: MemberSurveyWhereInput = {
    user: {
      ...(query.population === 'all' ? {} : { active: query.population === 'active' }),
      ...(query.gradYear === undefined
        ? {}
        : { gradYear: query.gradYear === 'unknown' ? null : query.gradYear }),
    },
  }
  if (range.from || range.to) {
    where[query.dateField === 'submitted' ? 'submittedAt' : 'updatedAt'] = {
      ...(range.from ? { gte: range.from } : {}),
      ...(range.to ? { lte: range.to } : {}),
    }
  }
  if (query.q) {
    const contains = { contains: query.q, mode: 'insensitive' as const }
    where.OR = [
      { user: { fullName: contains } },
      { user: { email: contains } },
      { user: { discordUsername: contains } },
      {
        answers: {
          some: {
            question: { archivedAt: null },
            OR: [
              { text: contains },
              { picked: { some: { option: { label: contains } } } },
            ],
          },
        },
      },
    ]
  }
  if (query.questionId) {
    const question = questions.find((each) => each.id === query.questionId)
    if (!question)
      throw new HTTPException(400, {
        message: 'That question is no longer on the survey. Clear the answer filter.',
      })
    const answer = query.answer ?? 'answered'
    if (answer === 'unanswered') where.answers = { none: { questionId: question.id } }
    else if (answer === 'answered') where.answers = { some: { questionId: question.id } }
    else if (answer === 'none') {
      if (!question.allowNone || question.kind !== SurveyQuestionKind.MULTI_CHOICE) {
        throw new HTTPException(400, { message: 'This question does not offer None.' })
      }
      where.answers = { some: { questionId: question.id, picked: { none: {} } } }
    } else {
      if (!question.options.some((option) => option.id === answer)) {
        throw new HTTPException(400, {
          message: 'That answer does not belong to this question.',
        })
      }
      where.answers = {
        some: { questionId: question.id, picked: { some: { optionId: answer } } },
      }
    }
  }
  const [rows, allYears, outstanding] = await Promise.all([
    prisma.memberSurvey.findMany({
      where,
      orderBy: ordering(query.sort),
      select: {
        id: true,
        submittedAt: true,
        updatedAt: true,
        user: {
          select: {
            fullName: true,
            email: true,
            discordUsername: true,
            gradYear: true,
            active: true,
          },
        },
        answers: {
          where: { question: { archivedAt: null } },
          select: {
            questionId: true,
            text: true,
            picked: { select: { optionId: true } },
          },
        },
      },
    }),
    prisma.memberSurvey.findMany({ select: { user: { select: { gradYear: true } } } }),
    prisma.user.count({
      where: {
        active: true,
        surveyCompletedAt: null,
        role: { notIn: [UserRole.GUEST, UserRole.ADMIN] },
      },
    }),
  ])
  const picks = new Map<string, number>()
  const answered = new Map<string, number>()
  const nones = new Map<string, number>()
  const years = new Map<number, number>()
  for (const row of rows) {
    if (row.user.gradYear !== null)
      years.set(row.user.gradYear, (years.get(row.user.gradYear) ?? 0) + 1)
    for (const answer of row.answers) {
      answered.set(answer.questionId, (answered.get(answer.questionId) ?? 0) + 1)
      if (answer.picked.length === 0)
        nones.set(answer.questionId, (nones.get(answer.questionId) ?? 0) + 1)
      for (const pick of answer.picked)
        picks.set(pick.optionId, (picks.get(pick.optionId) ?? 0) + 1)
    }
  }
  return {
    responded: rows.length,
    totalResponded: allYears.length,
    outstanding,
    range,
    facets: {
      gradYears: [
        ...new Set(
          allYears.flatMap((row) =>
            row.user.gradYear === null ? [] : [row.user.gradYear],
          ),
        ),
      ].sort((a, b) => a - b),
      questions: questions.map((question) => ({
        ...question,
        options: question.options.map((option) => ({
          id: option.id,
          label: option.label,
          archived: option.archivedAt !== null,
        })),
      })),
    },
    questions: questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      kind: question.kind,
      answered: answered.get(question.id) ?? 0,
      none: question.allowNone ? (nones.get(question.id) ?? 0) : null,
      options: question.options
        .map((option) => ({
          id: option.id,
          label: option.label,
          archived: option.archivedAt !== null,
          count: picks.get(option.id) ?? 0,
        }))
        .filter((option) => !option.archived || option.count > 0),
    })),
    gradYears: [...years.entries()]
      .sort(([a], [b]) => a - b)
      .map(([value, count]) => ({ value, count })),
    responses: rows.map((row) => ({
      id: row.id,
      user: row.user,
      submittedAt: row.submittedAt,
      updatedAt: row.updatedAt,
      answers: row.answers.map((answer) => ({
        questionId: answer.questionId,
        text: answer.text,
        optionIds: answer.picked.map((pick) => pick.optionId),
      })),
    })),
  }
}

export function reportAnswer(
  question: { allowNone?: boolean; options: { id: string; label: string }[] },
  answer: { text: string | null; optionIds: string[] } | undefined,
) {
  if (!answer) return ''
  const labels = question.options
    .filter((option) => answer.optionIds.includes(option.id))
    .map((option) => option.label)
  if (labels.length === 0) return question.allowNone ? 'None' : (answer.text ?? '')
  return answer.text === null
    ? labels.join(', ')
    : `${labels.join(', ')} (${answer.text})`
}
