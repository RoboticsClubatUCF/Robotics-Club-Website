import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { requireOfficer } from '../../auth/authz.js'
import { prisma } from '../../core/db.js'
import { SurveyQuestionKind, UserRole } from '../../generated/prisma/enums.js'
import { rateLimit } from '../../core/rateLimit.js'
import { type AuthEnv, originGuard, requireAuth } from '../../auth/session.js'

/**
 * The survey desk: what the club learned, and what it asks.
 *
 *   GET    /api/officer/survey                     -> the answers, as counts
 *   GET    /api/officer/survey/export.csv          -> the raw answers, per member
 *   GET    /api/officer/survey/questions           -> the questions, editable
 *   POST   /api/officer/survey/questions           -> ask something new
 *   PUT    /api/officer/survey/questions/:id       -> reword it, or change its options
 *   DELETE /api/officer/survey/questions/:id       -> stop asking it
 *   POST   /api/officer/survey/questions/:id/restore -> ask it again
 *   POST   /api/officer/survey/reorder             -> the order they appear in
 *
 * **Its own file rather than a sixth section of `officer.ts`**, which is
 * already the longest router here. What decided it is that half of this is the
 * *editor* for `routes/member/survey.ts` — the two files are one feature read from
 * either end, and the rules one enforces on the way in are the rules the other
 * has to be careful not to let an officer write.
 *
 * Everything is behind `requireOfficer`. That includes the reads: this desk
 * carries members' names, contact details and their allergies.
 *
 * **Nothing here can lock anybody out, and that is a property worth keeping.**
 * `User.surveyCompletedAt` is stamped once and never moves, so adding a
 * required question does not put the club back behind the gate — it asks the
 * people who have not answered it the next time they open the form. Anything
 * added to this file that clears that column would turn a typo into a lockout
 * for the whole club.
 */
export const surveyAdmin = new Hono<AuthEnv>()

/** The officer desk's own budget, shared with the rest of it. */
const writes = rateLimit('officer', 60)

// -------------------------------------------------------------- what it asks

/**
 * The questions as an officer sees them: archived ones included, and with the
 * counts that decide what REMOVE is going to do.
 *
 * A question nobody has answered is deleted outright and one with answers on it
 * is archived — see `SurveyQuestion.archivedAt` — so the editor has to be able
 * to say which before the press, rather than reporting it afterwards.
 */
const editorSelect = {
  id: true,
  prompt: true,
  help: true,
  kind: true,
  required: true,
  allowNone: true,
  maxLength: true,
  position: true,
  archivedAt: true,
  _count: { select: { answers: true } },
  options: {
    orderBy: { position: 'asc' },
    select: {
      id: true,
      label: true,
      wantsText: true,
      archivedAt: true,
      _count: { select: { picks: true } },
    },
  },
} as const

type EditorQuestion = {
  id: string
  prompt: string
  help: string | null
  kind: SurveyQuestionKind
  required: boolean
  allowNone: boolean
  maxLength: number | null
  position: number
  archivedAt: Date | null
  _count: { answers: number }
  options: {
    id: string
    label: string
    wantsText: boolean
    archivedAt: Date | null
    _count: { picks: number }
  }[]
}

const wireEditorQuestion = (question: EditorQuestion) => ({
  id: question.id,
  prompt: question.prompt,
  help: question.help,
  kind: question.kind,
  required: question.required,
  allowNone: question.allowNone,
  maxLength: question.maxLength,
  position: question.position,
  archived: question.archivedAt !== null,
  /** How many members have answered it, which is what REMOVE turns on. */
  answered: question._count.answers,
  options: question.options.map((option) => ({
    id: option.id,
    label: option.label,
    wantsText: option.wantsText,
    archived: option.archivedAt !== null,
    picked: option._count.picks,
  })),
})

const editorList = async () =>
  (
    await prisma.surveyQuestion.findMany({
      orderBy: [{ archivedAt: 'asc' }, { position: 'asc' }],
      select: editorSelect,
    })
  ).map(wireEditorQuestion)

surveyAdmin.get('/questions', requireAuth, requireOfficer, async (c) =>
  c.json({ questions: await editorList() }),
)

// ------------------------------------------------------------- writing one

const TOO_MANY_OTHERS =
  'Only one answer on a question can ask for a written reply — there is one box for it, not one per answer.'

const optionInput = z.object({
  /**
   * Absent on a new one. Present means "this row", which is what keeps the
   * answers already given against it attached — an option edited by id keeps
   * its tally, where a delete-and-recreate would silently reset it to nought.
   */
  id: z.uuid().optional(),
  label: z.string().trim().min(1).max(120),
  /** "Other", and its box. */
  wantsText: z.boolean(),
})

/**
 * A whole question, options and all, in one body.
 *
 * **Not a `PATCH` of separate fields, and not separate endpoints for the
 * options.** A question and its answers are one thing an officer edits on one
 * screen and saves with one press, and the cross-field rules below — a
 * single-choice question needs at least two answers, only one of them may ask
 * for a written reply — can only be checked against the whole of it. It is also
 * the deliberate dodge of the `.partial()` trap this codebase has already paid
 * for once; see `equipmentPatch` in `routes/officer/officer.ts`.
 */
const questionInput = z
  .object({
    prompt: z.string().trim().min(1).max(200),
    help: z
      .string()
      .trim()
      .max(500)
      .nullable()
      .optional()
      .transform((value) => value || null),
    kind: z.enum(SurveyQuestionKind),
    required: z.boolean(),
    allowNone: z.boolean(),
    maxLength: z.number().int().min(1).max(5_000).nullable().optional(),
    options: z.array(optionInput).max(50),
  })
  .superRefine((body, ctx) => {
    const choice =
      body.kind === SurveyQuestionKind.SINGLE_CHOICE ||
      body.kind === SurveyQuestionKind.MULTI_CHOICE

    if (!choice) {
      if (body.options.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'A written answer does not have answers to pick from.',
        })
      }

      // A NONE box on a text question is a box that clears nothing.
      if (body.allowNone) {
        ctx.addIssue({
          code: 'custom',
          path: ['allowNone'],
          message: 'Only a tick-any-that-apply question can offer None.',
        })
      }

      return
    }

    if (body.allowNone && body.kind !== SurveyQuestionKind.MULTI_CHOICE) {
      ctx.addIssue({
        code: 'custom',
        path: ['allowNone'],
        message: 'Only a tick-any-that-apply question can offer None.',
      })
    }

    /**
     * Two, not one. A pick-one question with a single answer is a question
     * whose answer is already known, and the tally it produces says nothing.
     * A tick-any question with one answer is a yes/no and perfectly reasonable.
     */
    const least = body.kind === SurveyQuestionKind.SINGLE_CHOICE ? 2 : 1

    if (body.options.length < least) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message:
          least === 2
            ? 'A pick-one question needs at least two answers.'
            : 'Give it at least one answer to tick.',
      })
    }

    // Two rows reading "Other" make a tally nobody can read and a form nobody
    // can answer, and neither failure says which of the two it came from.
    const labels = body.options.map((option) => option.label.toLowerCase())

    if (new Set(labels).size !== labels.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Two of those answers are the same.',
      })
    }

    // One box per question, not one per answer — the reasoning is on
    // `SurveyOption.wantsText`.
    if (body.options.filter((option) => option.wantsText).length > 1) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: TOO_MANY_OTHERS })
    }
  })

const idParam = z.object({ id: z.uuid() })

surveyAdmin.post(
  '/questions',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  zValidator('json', questionInput),
  async (c) => {
    const body = c.req.valid('json')

    // Appended rather than inserted. Where it belongs is the reorder route's
    // question, and a new question landing in the middle of a form somebody is
    // halfway through answering is worse than one landing at the end.
    const last = await prisma.surveyQuestion.aggregate({
      _max: { position: true },
    })

    const created = await prisma.surveyQuestion.create({
      data: {
        prompt: body.prompt,
        help: body.help,
        kind: body.kind,
        required: body.required,
        allowNone: body.allowNone,
        maxLength: body.maxLength ?? null,
        position: (last._max.position ?? -1) + 1,
        options: {
          create: body.options.map((option, index) => ({
            label: option.label,
            wantsText: option.wantsText,
            position: index,
          })),
        },
      },
      select: editorSelect,
    })

    return c.json({ question: wireEditorQuestion(created) }, 201)
  },
)

const KIND_LOCKED =
  'People have already answered this one, so what it asks for cannot change — a written answer is not a tick. Remove it and ask a new question instead.'

surveyAdmin.put(
  '/questions/:id',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  zValidator('param', idParam),
  zValidator('json', questionInput),
  async (c) => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')

    const existing = await prisma.surveyQuestion.findUnique({
      where: { id },
      select: editorSelect,
    })

    if (existing === null) {
      throw new HTTPException(404, { message: 'No such question.' })
    }

    /**
     * The one edit that is refused outright.
     *
     * Everything else about a question can change under answers already given —
     * the wording, the help, whether it is required — because none of that makes
     * an existing answer *wrong*. Changing the kind does: forty ticks against a
     * question that now wants a sentence are forty rows nothing can render, and
     * there is no honest way to convert them. 409 rather than 400: the request
     * is fine, the question is simply not in a state where it makes sense.
     */
    if (body.kind !== existing.kind && existing._count.answers > 0) {
      throw new HTTPException(409, { message: KIND_LOCKED })
    }

    const known = new Map(existing.options.map((option) => [option.id, option]))
    const sent = new Set(
      body.options
        .map((option) => option.id)
        .filter((optionId): optionId is string => optionId !== undefined),
    )

    for (const optionId of sent) {
      // An id from another question, or one already deleted. Refused rather
      // than created under this question, which is how an option ends up with a
      // tally belonging to a different question.
      if (!known.has(optionId)) {
        throw new HTTPException(400, {
          message: 'One of those answers does not belong to this question.',
        })
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      /**
       * What the officer left out.
       *
       * Deleted when nobody picked it, archived when somebody did — the same
       * rule as a question, for the same reason: REMOVE means "stop offering
       * this", never "throw away what people told us". An option that is
       * already archived and still left out stays archived, and putting its id
       * back in the list is how it comes back.
       */
      const dropped = existing.options.filter((option) => !sent.has(option.id))

      const retire = dropped.filter(
        (option) => option._count.picks > 0 && option.archivedAt === null,
      )

      const remove = dropped.filter((option) => option._count.picks === 0)

      if (retire.length > 0) {
        await tx.surveyOption.updateMany({
          where: { id: { in: retire.map((option) => option.id) } },
          data: { archivedAt: new Date() },
        })
      }

      if (remove.length > 0) {
        await tx.surveyOption.deleteMany({
          where: { id: { in: remove.map((option) => option.id) } },
        })
      }

      // In list order, because the list *is* the order: the officer dragged
      // them into it and the form draws them the same way.
      for (const [index, option] of body.options.entries()) {
        if (option.id === undefined) {
          await tx.surveyOption.create({
            data: {
              questionId: id,
              label: option.label,
              wantsText: option.wantsText,
              position: index,
            },
          })
          continue
        }

        await tx.surveyOption.update({
          where: { id: option.id },
          data: {
            label: option.label,
            wantsText: option.wantsText,
            position: index,
            // Listed is live. This is the whole of "restore an option": there
            // is no separate verb for it, because putting it back in the list
            // is exactly what an officer means by it.
            archivedAt: null,
          },
        })
      }

      return tx.surveyQuestion.update({
        where: { id },
        data: {
          prompt: body.prompt,
          help: body.help,
          kind: body.kind,
          required: body.required,
          allowNone: body.allowNone,
          maxLength: body.maxLength ?? null,
        },
        select: editorSelect,
      })
    })

    return c.json({ question: wireEditorQuestion(updated) })
  },
)

surveyAdmin.delete(
  '/questions/:id',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  zValidator('param', idParam),
  async (c) => {
    const { id } = c.req.valid('param')

    const existing = await prisma.surveyQuestion.findUnique({
      where: { id },
      select: { id: true, archivedAt: true, _count: { select: { answers: true } } },
    })

    if (existing === null) {
      throw new HTTPException(404, { message: 'No such question.' })
    }

    /**
     * Archived when anybody answered it, deleted when nobody did, and the
     * answer goes back so the desk can say which happened. An officer pressing
     * REMOVE means "stop asking this" — they do not mean "throw away what forty
     * people told us", and there is nothing at the button that could tell the
     * two apart.
     */
    if (existing._count.answers > 0) {
      await prisma.surveyQuestion.update({
        where: { id },
        data: { archivedAt: existing.archivedAt ?? new Date() },
      })

      return c.json({ removed: 'archived' as const })
    }

    await prisma.surveyQuestion.delete({ where: { id } })

    return c.json({ removed: 'deleted' as const })
  },
)

surveyAdmin.post(
  '/questions/:id/restore',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  zValidator('param', idParam),
  async (c) => {
    const { id } = c.req.valid('param')

    const existing = await prisma.surveyQuestion.findUnique({
      where: { id },
      select: { id: true },
    })

    if (existing === null) {
      throw new HTTPException(404, { message: 'No such question.' })
    }

    // Back at the end rather than where it used to sit. Its old position was
    // vacated the moment anything else moved, and a question reappearing in the
    // middle of a form is the same surprise a new one landing there would be.
    const last = await prisma.surveyQuestion.aggregate({
      _max: { position: true },
      where: { archivedAt: null },
    })

    const restored = await prisma.surveyQuestion.update({
      where: { id },
      data: { archivedAt: null, position: (last._max.position ?? -1) + 1 },
      select: editorSelect,
    })

    return c.json({ question: wireEditorQuestion(restored) })
  },
)

surveyAdmin.post(
  '/reorder',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  zValidator('json', z.object({ ids: z.array(z.uuid()).max(100) })),
  async (c) => {
    const { ids } = c.req.valid('json')

    const live = await prisma.surveyQuestion.findMany({
      where: { archivedAt: null },
      select: { id: true },
    })

    /**
     * The whole live set or nothing.
     *
     * A partial list would leave the questions it omits holding positions that
     * now collide with the ones it names, and the form would draw them in an
     * order nobody chose. The realistic way to send one is two officers editing
     * at once, which is exactly the case worth refusing rather than half-
     * applying — 409, because the request is well-formed and the survey simply
     * is not what the sender thought it was.
     */
    const sent = new Set(ids)
    const agrees =
      sent.size === ids.length &&
      sent.size === live.length &&
      live.every((question) => sent.has(question.id))

    if (!agrees) {
      throw new HTTPException(409, {
        message:
          'The survey changed while you were rearranging it. Reload the page and try again.',
      })
    }

    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.surveyQuestion.update({ where: { id }, data: { position: index } }),
      ),
    )

    return c.json({ questions: await editorList() })
  },
)

// ------------------------------------------------------------ what it learned

/**
 * What the club learned from the survey, as counts.
 *
 * **Tallied here in JavaScript rather than in SQL**, and that is a deliberate
 * choice about size rather than laziness. Counting ticks in Postgres means
 * grouping a join table and stitching the zeroes back on by hand, to aggregate
 * a few thousand rows belonging to a club with a few hundred members. Two
 * `findMany`s and a loop are the same answer for the same cost, in code the
 * next person can read.
 *
 * Every list is returned **whole, including the zeroes**, in the order the
 * officer put the options in. A tally that omits the sizes nobody picked is a
 * tally somebody reads as "we do not need any XS" rather than "nobody has asked
 * for XS", and the difference matters when the numbers are being turned into a
 * shirt order.
 */
surveyAdmin.get('/', requireAuth, requireOfficer, async (c) => {
  const [questions, answers, responded, outstanding, years] = await Promise.all([
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
    prisma.surveyAnswer.findMany({
      where: { question: { archivedAt: null } },
      select: {
        questionId: true,
        text: true,
        picked: { select: { optionId: true } },
      },
    }),
    prisma.memberSurvey.count(),
    /**
     * Who still owes one, counted rather than listed.
     *
     * `active` and not `GUEST`, which is the same population the roster query
     * uses — somebody who signed up and never came back is not a gap in the
     * club's data. Admins are excluded because they are exempt from the gate,
     * so counting them would put a number on this page that can never reach
     * zero.
     */
    prisma.user.count({
      where: {
        active: true,
        surveyCompletedAt: null,
        role: { notIn: [UserRole.GUEST, UserRole.ADMIN] },
      },
    }),
    prisma.user.findMany({
      where: { memberSurvey: { isNot: null }, gradYear: { not: null } },
      select: { gradYear: true },
    }),
  ])

  const picks = new Map<string, number>()
  const answered = new Map<string, number>()
  const nones = new Map<string, number>()

  for (const answer of answers) {
    answered.set(answer.questionId, (answered.get(answer.questionId) ?? 0) + 1)

    if (answer.picked.length === 0) {
      nones.set(answer.questionId, (nones.get(answer.questionId) ?? 0) + 1)
    }

    for (const pick of answer.picked) {
      picks.set(pick.optionId, (picks.get(pick.optionId) ?? 0) + 1)
    }
  }

  return c.json({
    responded,
    outstanding,
    questions: questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      kind: question.kind,
      answered: answered.get(question.id) ?? 0,
      /**
       * How many pressed NONE, or null where there is no NONE to press. It is a
       * count in its own right rather than an option row, because there is no
       * NONE option — an empty set of ticks is what "none" is stored as, and
       * the reasoning is on `SurveyQuestion.allowNone`.
       */
      none: question.allowNone ? (nones.get(question.id) ?? 0) : null,
      options: question.options
        .map((option) => ({
          id: option.id,
          label: option.label,
          archived: option.archivedAt !== null,
          count: picks.get(option.id) ?? 0,
        }))
        /**
         * A retired option is still counted **when anybody picked it**. Every
         * live one is listed including the zeroes, for the reason above; a
         * retired one on nought is a row about a question nobody is being
         * asked, and dropping the ones people did pick would leave a column
         * that does not add up to the number who answered.
         */
        .filter((option) => !option.archived || option.count > 0),
    })),
    /**
     * Graduation years as a sparse list rather than a fixed range, because the
     * range is whatever the club's members typed and a fixed one would either
     * clip the mature student or print fifteen empty rows.
     */
    gradYears: [
      ...years
        .reduce((seen, row) => {
          const year = row.gradYear
          if (year !== null) seen.set(year, (seen.get(year) ?? 0) + 1)
          return seen
        }, new Map<number, number>())
        .entries(),
    ]
      .sort(([a], [b]) => a - b)
      .map(([value, count]) => ({ value, count })),
  })
})

/**
 * A cell of CSV, quoted and — the part that is not obvious — defanged.
 *
 * Some of these columns are free text a member typed, and this file is opened
 * in Excel or Sheets by whoever is ordering the shirts. A cell beginning `=`,
 * `+`, `-` or `@` is a *formula* to both of them, so an allergy note reading
 * `=cmd|...` is a live thing rather than a string. Prefixing with an apostrophe
 * is the standard defence: the spreadsheet shows the text and runs nothing.
 */
const cell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value)

  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text

  return `"${safe.replace(/"/g, '""')}"`
}

/**
 * The raw answers, one row per member, for the person doing the ordering.
 *
 * Names and contact details are on it deliberately: the job this exists for is
 * "who has not picked a size" and "who do I ask about the nut allergy", and a
 * spreadsheet of anonymous sizes answers neither. It is behind `requireOfficer`
 * like every other desk, and it is the one route on the site that hands out a
 * file of members' personal details — so it stays a download an officer asks
 * for, never something linked from a page anybody else can reach.
 *
 * **One column per question**, named by the question. Which is why it is built
 * from the questions rather than from the rows: a member who answered before a
 * question existed has nothing in that column, and a column that appeared only
 * once somebody had answered would shift the header under the reader.
 */
surveyAdmin.get('/export.csv', requireAuth, requireOfficer, async (c) => {
  const [questions, rows] = await Promise.all([
    prisma.surveyQuestion.findMany({
      where: { archivedAt: null },
      orderBy: { position: 'asc' },
      select: { id: true, prompt: true, kind: true, allowNone: true },
    }),
    prisma.memberSurvey.findMany({
      orderBy: { user: { fullName: 'asc' } },
      select: {
        submittedAt: true,
        user: {
          select: {
            fullName: true,
            email: true,
            discordUsername: true,
            gradYear: true,
          },
        },
        answers: {
          select: {
            questionId: true,
            text: true,
            picked: {
              select: { option: { select: { label: true, position: true } } },
            },
          },
        },
      },
    }),
  ])

  const header = [
    'Name',
    'Email',
    'Discord',
    'Graduation year',
    ...questions.map((question) => question.prompt),
    'Answered',
  ]

  const body = rows.map((row) => {
    const byQuestion = new Map(
      row.answers.map((answer) => [answer.questionId, answer]),
    )

    return [
      row.user.fullName,
      row.user.email,
      row.user.discordUsername,
      row.user.gradYear,
      ...questions.map((question) => {
        const answer = byQuestion.get(question.id)

        // No row at all: this member was never asked, or was not required to
        // answer and did not. Blank either way, which is the honest cell.
        if (answer === undefined) return ''

        const labels = [...answer.picked]
          .sort((a, b) => a.option.position - b.option.position)
          .map((pick) => pick.option.label)

        // "None" rather than an empty cell, because an empty set here is an
        // answer somebody gave — the form will not save one without NONE
        // pressed — and a blank would read as a question they skipped.
        if (labels.length === 0) {
          return question.allowNone ? 'None' : (answer.text ?? '')
        }

        // The free-text half of an OTHER, in brackets after the answer that
        // asked for it. One cell, because a spreadsheet with a second column
        // per question that is empty for everybody but three people is a
        // spreadsheet nobody scrolls to the end of.
        return answer.text === null
          ? labels.join(', ')
          : `${labels.join(', ')} (${answer.text})`
      }),
      row.submittedAt.toISOString(),
    ].map(cell)
  })

  // CRLF, because that is what RFC 4180 says and what Excel wants; a lone \n
  // is read as one enormous cell by some versions of it.
  const csv = [header.map(cell), ...body].map((line) => line.join(',')).join('\r\n')

  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header(
    'Content-Disposition',
    'attachment; filename="rccf-member-survey.csv"',
  )
  // Members' names and allergies. Never anywhere but this officer's browser.
  c.header('Cache-Control', 'no-store')

  return c.body(csv)
})
