import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { validate } from '../../core/validate.js'
import { requireOfficer } from '../../auth/authz.js'
import { prisma } from '../../core/db.js'
import { SurveyQuestionKind } from '../../generated/prisma/enums.js'
import { rateLimit } from '../../core/rateLimit.js'
import { reportAnswer, reportQuery, surveyReport } from '../../survey/report.js'
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
 * Its own file rather than a sixth section of `officer.ts`, because half of this is the
 * editor for `routes/member/survey.ts` — the two are one feature read from either end,
 * and the rules one enforces on the way in are the rules the other must not let an
 * officer write.
 *
 * Everything is behind `requireOfficer`, reads included: this desk carries members'
 * names, contact details and their allergies.
 *
 * Nothing here can lock anybody out, and that's worth keeping.
 * `User.surveyCompletedAt` is stamped once and never moves, so adding a required
 * question doesn't put the club back behind the gate. Anything added here that cleared
 * that column would turn a typo into a lockout for the whole club.
 */
export const surveyAdmin = new Hono<AuthEnv>()

/** The officer desk's own budget, shared with the rest of it. */
const writes = rateLimit('officer', 60)

// -------------------------------------------------------------- what it asks

/**
 * The questions as an officer sees them: archived ones included, and with the counts
 * that decide what REMOVE is going to do.
 *
 * A question nobody has answered is deleted outright and one with answers is archived,
 * so the editor has to say which before the press rather than report it afterwards.
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

const optionLabelKey = (label: string) => label.trim().toLowerCase()

const optionInput = z.object({
  /**
   * Absent on a new one. Present means "this row", which keeps the answers already
   * given against it attached — an option edited by id keeps its tally, where a
   * delete-and-recreate would silently reset it to nought.
   */
  id: z.uuid().optional(),
  label: z.string().trim().min(1).max(120),
  /** "Other", and its box. */
  wantsText: z.boolean(),
})

/**
 * A whole question, options and all, in one body.
 *
 * Not a `PATCH` of separate fields and not separate endpoints for the options: a
 * question and its answers are one thing an officer edits on one screen and saves with
 * one press, and the cross-field rules below can only be checked against the whole of
 * it. It's also the deliberate dodge of the `.partial()` trap this codebase has already
 * paid for once.
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
     * Two, not one. A pick-one question with a single answer is a question whose answer
     * is already known. A tick-any question with one answer is a yes/no and perfectly
     * reasonable.
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

    // Two rows reading "Other" make a tally nobody can read and a form nobody can
    // answer, and neither failure says which of the two it came from.
    const labels = body.options.map((option) => optionLabelKey(option.label))

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
  validate('json', questionInput),
  async (c) => {
    const body = c.req.valid('json')

    // Appended rather than inserted. Where it belongs is the reorder route's question,
    // and a new question landing in the middle of a form somebody is halfway through
    // answering is worse than one landing at the end.
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
  validate('param', idParam),
  validate('json', questionInput),
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
     * The one edit that's refused outright.
     *
     * Everything else about a question can change under answers already given — the
     * wording, the help, whether it's required — because none of that makes an existing
     * answer wrong. Changing the kind does: forty ticks against a question that now
     * wants a sentence are forty rows nothing can render. 409 rather than 400: the
     * request is fine, the question simply isn't in a state where it makes sense.
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
      // An id from another question, or one already deleted. Refused rather than created
      // under this question, which is how an option ends up with a tally belonging to a
      // different one.
      if (!known.has(optionId)) {
        throw new HTTPException(400, {
          message: 'One of those answers does not belong to this question.',
        })
      }
    }

    for (const option of body.options) {
      const label = optionLabelKey(option.label)
      const previous = option.id === undefined ? undefined : known.get(option.id)

      // Existing duplicates may predate this check. Keeping an answer's own label
      // must remain possible; creating or renaming another copy must not.
      if (previous && optionLabelKey(previous.label) === label) continue

      const match = existing.options.find(
        (saved) => !sent.has(saved.id) && optionLabelKey(saved.label) === label,
      )

      if (match) {
        throw new HTTPException(409, {
          message: `“${match.label}” was offered before. Restore the existing answer to keep its responses.`,
        })
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      /**
       * What the officer left out.
       *
       * Deleted when nobody picked it, archived when somebody did — the same rule as a
       * question: REMOVE means "stop offering this", never "throw away what people told
       * us". Putting its id back in the list is how it comes back.
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

      // In list order, because the list is the order: the officer dragged them into it
      // and the form draws them the same way.
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
            // Listed is live. This is the whole of "restore an option" — putting it back
            // in the list is exactly what an officer means by it.
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
  validate('param', idParam),
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
     * Archived when anybody answered it, deleted when nobody did, and the answer goes
     * back so the desk can say which happened. An officer pressing REMOVE means "stop
     * asking this", not "throw away what forty people told us".
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
  validate('param', idParam),
  async (c) => {
    const { id } = c.req.valid('param')

    const existing = await prisma.surveyQuestion.findUnique({
      where: { id },
      select: { id: true },
    })

    if (existing === null) {
      throw new HTTPException(404, { message: 'No such question.' })
    }

    // Back at the end rather than where it used to sit. Its old position was vacated
    // the moment anything else moved, and a question reappearing in the middle of a form
    // is the same surprise a new one landing there would be.
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
  validate('json', z.object({ ids: z.array(z.uuid()).max(100) })),
  async (c) => {
    const { ids } = c.req.valid('json')

    const live = await prisma.surveyQuestion.findMany({
      where: { archivedAt: null },
      select: { id: true },
    })

    /**
     * The whole live set or nothing.
     *
     * A partial list would leave the questions it omits holding positions that now
     * collide with the ones it names. The realistic way to send one is two officers
     * editing at once, which is exactly the case worth refusing rather than
     * half-applying — 409, because the request is well-formed and the survey simply
     * isn't what the sender thought it was.
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
 * One filtered set of responses supplies the tallies, individual answers and CSV.
 * The report helper owns date boundaries, member and answer filters, and ordering.
 * Live options remain visible on zero, so missing data cannot look like a missing
 * shirt size when somebody places an order.
 */
surveyAdmin.get(
  '/',
  requireAuth,
  requireOfficer,
  validate('query', reportQuery),
  async (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json(await surveyReport(c.req.valid('query')))
  },
)

/**
 * A cell of CSV, quoted and — the part that isn't obvious — defanged.
 *
 * Some of these columns are free text a member typed, and this file is opened in Excel
 * or Sheets by whoever is ordering the shirts. A cell beginning `=`, `+`, `-` or `@` is
 * a formula to both, so an allergy note reading `=cmd|...` is a live thing rather than
 * a string. Prefixing with an apostrophe is the standard defence.
 */
const cell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value)

  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text

  return `"${safe.replace(/"/g, '""')}"`
}

/**
 * The raw answers, one row per member, for the person doing the ordering.
 *
 * Names and contact details are on it deliberately: the job this exists for is "who
 * hasn't picked a size" and "who do I ask about the nut allergy". It's the one route on
 * the site that hands out a file of members' personal details, so it stays a download
 * an officer asks for, never something linked from a page anybody else can reach.
 *
 * One column per question, named by the question — which is why it's built from the
 * questions rather than the rows: a member who answered before a question existed has
 * nothing in that column, and a column that appeared only once somebody had answered
 * would shift the header under the reader.
 */
surveyAdmin.get(
  '/export.csv',
  requireAuth,
  requireOfficer,
  validate('query', reportQuery),
  async (c) => {
    const data = await surveyReport(c.req.valid('query'))
    const questions = data.facets.questions
    const header = [
      'Name',
      'Email',
      'Discord',
      'Graduation year',
      ...questions.map((question) => question.prompt),
      'Submitted',
      'Updated',
    ]
    const body = data.responses.map((row) => {
      const byQuestion = new Map(row.answers.map((answer) => [answer.questionId, answer]))
      return [
        row.user.fullName,
        row.user.email,
        row.user.discordUsername,
        row.user.gradYear,
        ...questions.map((question) =>
          reportAnswer(question, byQuestion.get(question.id)),
        ),
        row.submittedAt.toISOString(),
        row.updatedAt.toISOString(),
      ].map(cell)
    })
    const csv = [header.map(cell), ...body].map((line) => line.join(',')).join('\r\n')
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', 'attachment; filename="rccf-member-survey.csv"')
    c.header('Cache-Control', 'no-store')
    return c.body(csv)
  },
)
