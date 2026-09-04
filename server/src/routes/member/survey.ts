import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { validate } from '../../core/validate.js'
import { prisma } from '../../core/db.js'
import { SurveyQuestionKind } from '../../generated/prisma/enums.js'
import { rateLimit } from '../../core/rateLimit.js'
import { type AuthEnv, originGuard, requireAuth } from '../../auth/session.js'
import { gradYearField } from '../account/account.js'

/**
 * The one-time member survey.
 *
 *   GET  /api/survey          -> the questions, this member's answers, or null
 *   POST /api/survey          -> answer it, once
 *   PUT  /api/survey          -> correct the answers afterwards
 *   POST /api/survey/dismiss  -> stop asking
 *
 * It used to be the first gate on the site — `requireSurvey` refused everything
 * until it had been answered, dues page included. It's an invitation now: the
 * dashboard asks once with a *don't ask me again* beside it, and `dismiss` is that
 * checkbox. Nothing anywhere refuses an unanswered survey.
 *
 * The questions are rows, not columns. What's asked lives in `SurveyQuestion` and
 * `SurveyOption`, written by officers from `routes/officer/surveyAdmin.ts`, so this
 * file knows nothing about shirts or allergies — it checks an answer against the
 * kind of question it answers. None of those rules can be a database constraint,
 * which is why they're all in one function.
 *
 * Nothing here is gated, and that isn't an oversight: it reads and writes one
 * person's own answers, and the club would rather have a shirt size from somebody
 * who has stopped paying than not.
 *
 * Expected graduation year is not a question — it's `User.gradYear`, already on the
 * profile page and the public roster. A question would be two answers to one
 * question, so both writes reach across into `users` in the same transaction.
 *
 * `POST` is the one-time act and `PUT` is not. Being asked once is the promise:
 * `User.surveyCompletedAt` is stamped by `POST`, never moved by `PUT` and never
 * cleared, so nobody is prompted twice — including when an officer adds a question.
 * A shirt size that couldn't be corrected afterwards would just mean the club orders
 * the wrong shirt.
 */
export const survey = new Hono<AuthEnv>()

/**
 * One scope, a small budget. A form somebody fills in once, so the only bulk traffic
 * is somebody hammering it — but ten rather than five, because a validation refusal,
 * a correction and a re-submit are three requests from one member doing nothing wrong.
 */
const writes = rateLimit('survey', 10)

/**
 * How long a text answer may be when its question doesn't say.
 *
 * A question carries its own `maxLength` — "which major" wants one line, "tell us
 * about your allergy" wants a paragraph — and these are what a question that never
 * bothered gets. The hard ceiling is in `answerBody`, so a caller can't post a novel
 * at a question whose cap somebody left blank.
 */
const DEFAULT_MAX = { long: 2_000, short: 200 } as const

const capOf = (question: { kind: SurveyQuestionKind; maxLength: number | null }) =>
  question.maxLength ??
  (question.kind === SurveyQuestionKind.LONG_TEXT
    ? DEFAULT_MAX.long
    : DEFAULT_MAX.short)

const isText = (kind: SurveyQuestionKind) =>
  kind === SurveyQuestionKind.SHORT_TEXT || kind === SurveyQuestionKind.LONG_TEXT

// -------------------------------------------------------------- the questions

/**
 * What the form is drawn from.
 *
 * Options are ordered rather than sorted afterwards, because their order is the
 * club's — smallest shirt first, the catch-all majors last — and a list re-sorted
 * alphabetically reads wrong.
 */
const questionSelect = {
  id: true,
  prompt: true,
  help: true,
  kind: true,
  required: true,
  allowNone: true,
  maxLength: true,
  archivedAt: true,
  options: {
    orderBy: { position: 'asc' },
    select: { id: true, label: true, wantsText: true, archivedAt: true },
  },
} as const

type LoadedQuestion = {
  id: string
  prompt: string
  help: string | null
  kind: SurveyQuestionKind
  required: boolean
  allowNone: boolean
  maxLength: number | null
  archivedAt: Date | null
  options: {
    id: string
    label: string
    wantsText: boolean
    archivedAt: Date | null
  }[]
}

/**
 * The live questions, plus whatever this member already picked.
 *
 * The second half is the part worth explaining. An officer who removes an option
 * means "stop offering this", and the option is archived rather than deleted so the
 * people who picked it keep their answer. If the form drew only live options, the
 * first correction anybody made would silently drop their allergy along the way,
 * because a write replaces the whole set. So an archived option stays on the form
 * for the one person holding it.
 *
 * That doesn't extend to an archived question: its answers are kept, but it's off
 * the form entirely — the club has stopped asking.
 */
async function questionsFor(userId: string): Promise<LoadedQuestion[]> {
  const [questions, mine] = await Promise.all([
    prisma.surveyQuestion.findMany({
      where: { archivedAt: null },
      orderBy: { position: 'asc' },
      select: questionSelect,
    }),
    prisma.surveyAnswerOption.findMany({
      where: { answer: { survey: { userId } } },
      select: { optionId: true },
    }),
  ])

  const held = new Set(mine.map((pick) => pick.optionId))

  return questions.map((question) => ({
    ...question,
    options: question.options.filter(
      (option) => option.archivedAt === null || held.has(option.id),
    ),
  }))
}

const wireQuestion = (question: LoadedQuestion) => ({
  id: question.id,
  prompt: question.prompt,
  help: question.help,
  kind: question.kind,
  required: question.required,
  allowNone: question.allowNone,
  /** Resolved here so the form's `maxLength` and the server's cap are one number. */
  maxLength: capOf(question),
  options: question.options.map((option) => ({
    id: option.id,
    label: option.label,
    wantsText: option.wantsText,
    /** True only for something this member picked before it was retired. */
    retired: option.archivedAt !== null,
  })),
})

// ---------------------------------------------------------------- the answers

/**
 * One answer, before anything knows what it is answering.
 *
 * Uniform across all four kinds — a set of ticks and a line of text — because the
 * alternative is a discriminated union keyed on a `kind` the client would send and
 * the server would distrust anyway. What each kind may put in these two fields is
 * `checkAnswers`, which reads the question rather than the request.
 */
const answerBody = z.object({
  questionId: z.uuid(),
  optionIds: z.array(z.uuid()).max(100),
  text: z
    .string()
    .trim()
    // The ceiling over every per-question cap, so a question saved without one is
    // still not an upload slot. `checkAnswers` applies the real number.
    .max(5_000)
    .nullable()
    .optional()
    .transform((value) => value || null),
})

type AnswerBody = z.infer<typeof answerBody>

/** What a checked answer becomes: exactly what the two writes insert. */
type CheckedAnswer = { questionId: string; text: string | null; optionIds: string[] }

const answers = z.array(answerBody).max(100)

/**
 * Answering it for the first time. The graduation year is required here, where the
 * profile page allows null: the survey is the club asking, and "when do you
 * graduate" with no answer isn't worth a row.
 */
const surveyBody = z.object({ answers, gradYear: gradYearField })

/**
 * Correcting it afterwards, where the graduation year is optional — the one
 * difference between the two schemas.
 *
 * The survey is edited from two places and only one owns that field. On
 * `/dashboard/survey` it's part of the form; on the account page it belongs to the
 * ABOUT YOU panel, which writes it through `PATCH /api/account/profile`. Two controls
 * for one column on one screen is the doubled-label bug `dashboard.md` warns about,
 * so the panel doesn't send it — and omitting it here has to mean "leave it alone"
 * rather than "clear it".
 *
 * It also closes a hole: that panel allows a null graduation year, so somebody could
 * clear it and then be unable to save a survey correction at all.
 */
const surveyEdit = z.object({ answers, gradYear: gradYearField.optional() })

const refuse = (message: string): never => {
  throw new HTTPException(400, { message })
}

/**
 * Every rule the questions imply, in one pass, against the questions as they are now.
 *
 * The only place that knows what a kind means, and hand-written rather than a zod
 * schema on purpose: the shape a body must take depends on rows in the database, so
 * a static schema could only express the loose half. Sentences rather than a zod
 * report, because these can reach a member.
 *
 * Returns the answers in a form the writes can insert directly: an answer for a
 * question the member left blank and was allowed to is simply absent, since the row
 * existing is what "answered" means.
 */
function checkAnswers(
  questions: LoadedQuestion[],
  sent: AnswerBody[],
): CheckedAnswer[] {
  const byQuestion = new Map<string, AnswerBody>()

  for (const answer of sent) {
    if (byQuestion.has(answer.questionId)) {
      refuse('That answered the same question twice.')
    }

    byQuestion.set(answer.questionId, answer)
  }

  // A question the club has stopped asking, or one that never existed. Refused rather
  // than ignored: a form posting against questions this server doesn't recognise is
  // one somebody loaded before an officer edited the survey, and quietly dropping half
  // of it would save them a survey they never filled in.
  for (const questionId of byQuestion.keys()) {
    if (!questions.some((question) => question.id === questionId)) {
      refuse(
        'The survey changed while you were filling it in. Reload the page and it will ask you again.',
      )
    }
  }

  const checked: CheckedAnswer[] = []

  for (const question of questions) {
    const answer = byQuestion.get(question.id)

    /**
     * Sending an entry at all is what "answered" means, and it's the only thing that
     * can mean it. A multi-choice question with a NONE box is answered by an empty set
     * of ticks — that's how "no allergies" is stored — so the server can't tell an
     * empty answer from a skipped one by looking at it.
     *
     * The form draws that line: it sends nothing for a question nobody has touched,
     * and refuses to submit until a required one has something ticked or NONE pressed.
     */
    if (answer === undefined) {
      if (question.required) refuse(`“${question.prompt}” needs an answer.`)
      continue
    }

    const { optionIds, text } = answer

    if (new Set(optionIds).size !== optionIds.length) {
      refuse(`“${question.prompt}” has the same answer in it twice.`)
    }

    const picked = optionIds.map((optionId) => {
      const option = question.options.find((each) => each.id === optionId)

      // Either an option belonging to a different question, or one retired before this
      // member ever held it. Both are a client sending something the form couldn't
      // have offered.
      if (option === undefined) {
        return refuse(`That is not one of the answers to “${question.prompt}”.`)
      }

      return option
    })

    if (isText(question.kind)) {
      if (picked.length > 0) {
        refuse(`“${question.prompt}” is a written answer, not a choice.`)
      }

      if (text === null) {
        if (question.required) refuse(`“${question.prompt}” needs an answer.`)
        // An entry with nothing in it isn't an answer to a written question — there's
        // no NONE here for an empty one to mean. The form sends one per question
        // either way, so this is ordinary rather than a client misbehaving.
        continue
      }

      if (text.length > capOf(question)) {
        refuse(`Your answer to “${question.prompt}” is too long.`)
      }

      checked.push({ questionId: question.id, text, optionIds: [] })
      continue
    }

    if (question.kind === SurveyQuestionKind.SINGLE_CHOICE && picked.length > 1) {
      refuse(`“${question.prompt}” takes one answer.`)
    }

    /**
     * The one rule about a question's shape rather than what was ticked: an empty set
     * is a real answer only where there's a NONE box for somebody to have pressed.
     */
    const emptyIsAnswer =
      question.kind === SurveyQuestionKind.MULTI_CHOICE && question.allowNone

    if (picked.length === 0 && !emptyIsAnswer) {
      if (question.required) refuse(`“${question.prompt}” needs an answer.`)
      continue
    }

    const wantsText = picked.some((option) => option.wantsText)

    // The one that's about safety rather than tidiness: an unexplained "other allergy"
    // is a warning the club can't act on.
    if (wantsText && text === null) {
      refuse(
        `You picked an answer to “${question.prompt}” that asks you to say which — fill that box in.`,
      )
    }

    if (wantsText && text !== null && text.length > capOf(question)) {
      refuse(`Your answer to “${question.prompt}” is too long.`)
    }

    checked.push({
      questionId: question.id,
      // A stale "Business" left behind a switch back to a listed major is a row that
      // contradicts itself, so the text is cleared rather than ignored.
      text: wantsText ? text : null,
      optionIds,
    })
  }

  return checked
}

/** The nested create both writes hand Prisma, from a checked answer list. */
const rowsFor = (checked: CheckedAnswer[]) =>
  checked.map((answer) => ({
    questionId: answer.questionId,
    text: answer.text,
    picked: { create: answer.optionIds.map((optionId) => ({ optionId })) },
  }))

// ------------------------------------------------------------- what goes back

/**
 * What goes back over the wire. The member's own id is deliberately absent: the
 * caller is the only person who can read this, so it would say nothing they don't
 * already know.
 */
const surveySelect = {
  submittedAt: true,
  updatedAt: true,
  answers: {
    select: {
      questionId: true,
      text: true,
      picked: { select: { optionId: true } },
    },
  },
} as const

type StoredSurvey = {
  submittedAt: Date
  updatedAt: Date
  answers: { questionId: string; text: string | null; picked: { optionId: string }[] }[]
}

/** Dates go over the wire as ISO strings, like everything else here. */
const wireSurvey = (row: StoredSurvey) => ({
  submittedAt: row.submittedAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  answers: row.answers.map((answer) => ({
    questionId: answer.questionId,
    text: answer.text,
    optionIds: answer.picked.map((pick) => pick.optionId),
  })),
})

const ALREADY = 'You have already filled this in. Edit your answers instead.'

/**
 * The gap between the two editors, said out loud.
 *
 * The survey asks for a graduation year and the account page's ABOUT YOU panel lets
 * somebody clear one — right for people who never answered the survey, and it leaves
 * anybody who did holding an answer the club asked for and no longer has. Nothing
 * used to notice: the year simply went missing.
 *
 * Only reachable from a caller that sends no year, which by construction is the
 * account page's SURVEY panel.
 */
const NO_GRAD_YEAR =
  'Your graduation year is missing, and the survey asks for it. Set it under ABOUT YOU on your profile, then save these again.'

// -------------------------------------------------------------------- read

survey.get('/', requireAuth, async (c) => {
  const user = c.get('user')

  const [questions, answered, account] = await Promise.all([
    questionsFor(user.id),
    prisma.memberSurvey.findUnique({
      where: { userId: user.id },
      select: surveySelect,
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { gradYear: true },
    }),
  ])

  return c.json({
    questions: questions.map(wireQuestion),
    survey: answered ? wireSurvey(answered) : null,
    /**
     * Beside the answers rather than inside them, because it lives on another table
     * and the profile page writes it back through a different route.
     */
    gradYear: account.gradYear,
  })
})

// ------------------------------------------------------------------ answer

survey.post(
  '/',
  originGuard,
  requireAuth,
  writes,
  validate('json', surveyBody),
  async (c) => {
    const user = c.get('user')
    const { gradYear, answers: sent } = c.req.valid('json')

    if (user.surveyCompletedAt !== null) {
      throw new HTTPException(409, { message: ALREADY })
    }

    const checked = checkAnswers(await questionsFor(user.id), sent)

    const created = await prisma.$transaction(async (tx) => {
      /**
       * The claim, and the reason this is an `updateMany` filtered on the null rather
       * than trusting the guard above: two submissions racing both pass that guard, and
       * one would insert a second row. Only one of these can match, and the unique
       * index on `user_id` is the backstop under that.
       */
      const claimed = await tx.user.updateMany({
        where: { id: user.id, surveyCompletedAt: null },
        // The dismissal goes with it. Somebody who ticked *don't ask me again* in
        // September and filled it in anyway in March hasn't declined a survey, and a
        // row saying both is one a future reader has to guess at.
        data: {
          surveyCompletedAt: new Date(),
          surveyPromptDismissedAt: null,
          gradYear,
        },
      })

      if (claimed.count === 0) {
        throw new HTTPException(409, { message: ALREADY })
      }

      return tx.memberSurvey.create({
        data: { userId: user.id, answers: { create: rowsFor(checked) } },
        select: surveySelect,
      })
    })

    return c.json({ survey: wireSurvey(created), gradYear }, 201)
  },
)

// ----------------------------------------------------------------- correct

survey.put(
  '/',
  originGuard,
  requireAuth,
  writes,
  validate('json', surveyEdit),
  async (c) => {
    const user = c.get('user')
    const { gradYear, answers: sent } = c.req.valid('json')

    if (user.surveyCompletedAt === null) {
      throw new HTTPException(404, {
        message: 'You have not filled the survey in yet.',
      })
    }

    const checked = checkAnswers(await questionsFor(user.id), sent)

    const updated = await prisma.$transaction(async (tx) => {
      // Only when it was sent. The account page's ABOUT YOU panel owns this field and
      // deliberately doesn't send it, so an absent one means "leave it alone". Writing
      // `undefined` would do the same; saying it out loud stops somebody later
      // "tidying" it into a null.
      if (gradYear !== undefined) {
        await tx.user.update({ where: { id: user.id }, data: { gradYear } })
      } else {
        /**
         * ...but "leave it alone" is only an answer when there's something to leave. A
         * caller that sends no year, for an account that has none, is saving a survey
         * with a hole in it.
         *
         * 409 rather than 400: nothing is wrong with the request, the account is simply
         * in a state where it doesn't make sense.
         */
        const { gradYear: onFile } = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
          select: { gradYear: true },
        })

        if (onFile === null) {
          throw new HTTPException(409, { message: NO_GRAD_YEAR })
        }
      }

      // `findUnique` and a throw rather than an `upsert`: no row here would mean the
      // gate column and this table disagree, and creating one would write the answers
      // without stamping the gate — an account locked out for good while holding a
      // completed survey.
      const existing = await tx.memberSurvey.findUniqueOrThrow({
        where: { userId: user.id },
        select: { id: true },
      })

      /**
       * Replaced wholesale rather than reconciled, and the cascade to
       * `survey_answer_options` is what makes that cheap. Every write takes every
       * answer — both forms hold the lot, so both send the lot — which is the
       * deliberate dodge of the `.partial()` trap this codebase has paid for once.
       */
      await tx.surveyAnswer.deleteMany({ where: { surveyId: existing.id } })

      return tx.memberSurvey.update({
        where: { id: existing.id },
        // Named rather than left to `@updatedAt`, which Prisma only stamps for a scalar
        // it is already writing — and the only thing changing here is a nested create.
        data: { updatedAt: new Date(), answers: { create: rowsFor(checked) } },
        select: surveySelect,
      })
    })

    // Read back rather than echoed from the request, so a caller that sent no year
    // still gets the one on file.
    const { gradYear: onFile } = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { gradYear: true },
    })

    return c.json({ survey: wireSurvey(updated), gradYear: onFile })
  },
)

// ----------------------------------------------------------------- dismiss

/**
 * "Don't ask me again", from the checkbox on the dashboard's survey prompt.
 *
 * It silences the prompt and nothing else. The survey stays on the overview's panel
 * and the account page's, because a promise not to nag isn't a promise to hide the
 * form from somebody who changes their mind.
 *
 * Idempotent, and deliberately not a toggle. Pressing it twice is the same press, and
 * there's no route back: un-dismissing is answering the survey, which clears the
 * column in `POST` above.
 *
 * It answers with nothing worth reading — the one thing a caller might want back
 * comes from `/dues/status`, which it refetches anyway. A body rather than a 204 all
 * the same: the browser's `sendJson` parses every response, and an empty one throws.
 */
survey.post('/dismiss', originGuard, requireAuth, writes, async (c) => {
  const user = c.get('user')

  // Filtered on the null rather than written flat, so a second press isn't a second
  // timestamp. When it happened is the only thing this column says, and it should say
  // the first time.
  await prisma.user.updateMany({
    where: { id: user.id, surveyPromptDismissedAt: null },
    data: { surveyPromptDismissedAt: new Date() },
  })

  return c.json({ dismissed: true })
})
