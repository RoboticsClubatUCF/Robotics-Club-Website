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
 * **It used to be the first gate on the site.** `requireSurvey` refused
 * everything until it had been answered — the tools, the officer desks and the
 * dues page alike — because the club needs its members' shirt sizes, majors
 * and, at a meeting with food at it, their allergies, and had no other way to
 * make anybody sit down and say. It is an invitation now: the dashboard asks
 * once with a *don't ask me again* beside it, and `dismiss` at the bottom of
 * this file is that checkbox. Nothing anywhere refuses an unanswered survey.
 *
 * **The questions are rows now, not columns.** What is asked lives in
 * `SurveyQuestion` and `SurveyOption`, which officers write from
 * `/dashboard/officer/survey/questions` — see `routes/officer/surveyAdmin.ts`. So this
 * file knows nothing about shirts or allergies: it reads whatever the club is
 * currently asking, and checks an answer against the *kind* of question it
 * answers. Every rule below is one of those, and none of them can be a database
 * constraint, which is why they are all in one function.
 *
 * **Nothing in this file is gated**, and that is not an oversight. It reads and
 * writes one person's own answers, so there is nothing here a lapsed member
 * should be refused — and the club would rather have a shirt size from
 * somebody who has stopped paying than not.
 *
 * **Expected graduation year is not a question.** It is `User.gradYear`, which
 * already existed, is already editable on the profile page and already prints on
 * the public roster. A question would be two answers to one question, and the
 * roster would eventually show the stale one — so both writes below reach across
 * into `users` in the same transaction, and `GET` hands the current value back
 * so the form can pre-fill it.
 *
 * **`POST` is the one-time act and `PUT` is not.** Being *asked* once is the
 * promise: `User.surveyCompletedAt` is stamped by `POST`, never moved by `PUT`
 * and never cleared, so nobody is ever prompted twice — **including when an
 * officer adds a question**. A new question appears on this form the next time
 * its owner opens it; it does not put the club back to asking. A shirt size
 * that could not be corrected afterwards would just mean the club orders the
 * wrong shirt, which is the thing this whole feature exists to stop.
 */
export const survey = new Hono<AuthEnv>()

/**
 * One scope, a small budget. This is a form somebody fills in once, so the only
 * traffic that ever reaches it in bulk is somebody hammering it — but ten rather
 * than the site default of five, because a validation refusal, a correction and
 * a re-submit are three requests from one member doing nothing wrong.
 */
const writes = rateLimit('survey', 10)

/**
 * How long a text answer may be when its question does not say.
 *
 * A question carries its own `maxLength` — the officer who wrote "which major"
 * wants one line and the one who wrote "tell us about your allergy" wants a
 * paragraph — and these are what a question that never bothered gets. The hard
 * ceiling below them is in `answerBody`, so a caller cannot post a novel at a
 * question whose cap somebody left blank.
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
 * club's — smallest shirt first, the two catch-all majors last — and a list
 * re-sorted alphabetically in the browser is a list that reads wrong.
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
 * The second half is the part worth explaining. An officer who removes an
 * option means "stop offering this", and the option is archived rather than
 * deleted so the people who picked it keep their answer. If the form then drew
 * only live options, the first correction anybody made — a shirt size, a
 * graduation year — would silently drop their allergy along the way, because a
 * write replaces the whole set. So an archived option stays on the form for the
 * one person holding it: they can untick it, and nobody else is offered it.
 *
 * The same reasoning does not extend to an archived *question*. Its answers are
 * kept, but it is off the form entirely — the club has stopped asking, and there
 * is nothing for the member to keep in step.
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
 * Uniform across all four kinds — a set of ticks and a line of text — because
 * the alternative is a discriminated union keyed on a `kind` the client would
 * have to send and the server would have to distrust anyway. What each kind is
 * allowed to put in these two fields is `checkAnswers`, below, which reads the
 * question rather than the request.
 */
const answerBody = z.object({
  questionId: z.uuid(),
  optionIds: z.array(z.uuid()).max(100),
  text: z
    .string()
    .trim()
    // The ceiling over every per-question cap, so a question saved without one
    // is still not an upload slot. `checkAnswers` applies the real number.
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
 * Answering it for the first time. The graduation year is **required** here,
 * where the profile page allows null: the survey is the club asking, and "when
 * do you graduate" with no answer is not worth a row.
 */
const surveyBody = z.object({ answers, gradYear: gradYearField })

/**
 * Correcting it afterwards, where the graduation year is **optional** — and
 * that is the one difference between the two schemas.
 *
 * The survey can be edited from two places now, and only one of them owns that
 * field. On `/dashboard/survey` it is part of the form; on the account page it
 * belongs to the ABOUT YOU panel, which has had it all along and writes it
 * through `PATCH /api/account/profile`. Two controls for one column on one
 * screen is the doubled-label bug `dashboard.md` warns about, so the panel does
 * not send it — and omitting it here has to mean "leave it alone" rather than
 * "clear it".
 *
 * It also closes a hole the required version left open: that panel allows a
 * null graduation year, so somebody could clear it and then be unable to save a
 * survey correction at all.
 */
const surveyEdit = z.object({ answers, gradYear: gradYearField.optional() })

const refuse = (message: string): never => {
  throw new HTTPException(400, { message })
}

/**
 * Every rule the questions imply, in one pass, against the questions as they
 * are right now.
 *
 * **This is the only place that knows what a kind means**, and it is a hand
 * -written check rather than a zod schema on purpose: the shape a body must
 * take depends on rows in the database, so a static schema could only ever
 * express the loose half of it. Sentences rather than a zod report, because
 * these can reach a member — `lib/api/api.ts` notes why a raw 400 body must not.
 *
 * Returns the answers in a form the writes can insert directly: an answer for a
 * question the member left blank and was allowed to is simply absent, since the
 * row existing is what "answered" means.
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

  // A question the club has stopped asking, or one that never existed. Refused
  // rather than ignored: a form posting against questions this server does not
  // recognise is a form somebody loaded before an officer edited the survey,
  // and quietly dropping half of it would save them a survey they never filled
  // in.
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
     * **Sending an entry at all is what "answered" means**, and it is the only
     * thing that can mean it. A multi-choice question with a NONE box is
     * answered by an *empty* set of ticks — that is how "no allergies" is
     * stored, and the reasoning is on `SurveyQuestion.allowNone` — so the
     * server cannot tell an empty answer from a skipped one by looking at it.
     *
     * The form is what draws that line: it sends nothing for a question nobody
     * has touched, and refuses to submit until a required one has either
     * something ticked or NONE pressed. `answered()` in `web/src/lib/survey.ts`
     * is that check, and this is the half of the same rule the server can
     * actually enforce.
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

      // Either an option belonging to a different question, or one retired
      // before this member ever held it. Both are a client sending something
      // the form could not have offered.
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
        // An entry with nothing in it is not an answer to a written question —
        // there is no NONE here for an empty one to mean. The form sends one
        // per question either way, so this is the ordinary case rather than a
        // client misbehaving.
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
     * The one rule that is about a question's *shape* rather than about what
     * was ticked: an empty set is a real answer only where there is a NONE box
     * for somebody to have pressed.
     */
    const emptyIsAnswer =
      question.kind === SurveyQuestionKind.MULTI_CHOICE && question.allowNone

    if (picked.length === 0 && !emptyIsAnswer) {
      if (question.required) refuse(`“${question.prompt}” needs an answer.`)
      continue
    }

    const wantsText = picked.some((option) => option.wantsText)

    // The one that is about safety rather than tidiness: an unexplained "other
    // allergy" is a warning the club cannot act on.
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
      // A stale "Business" left behind a switch back to a listed major is a row
      // that contradicts itself, so the text is cleared rather than ignored.
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
 * caller is the only person who can read this, so it would say nothing they do
 * not already know.
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
 * The survey asks for a graduation year and the account page's ABOUT YOU panel
 * lets somebody clear one — which is right for the people who never answered
 * the survey, and leaves anybody who did holding an answer the club asked for
 * and no longer has. Nothing used to notice: the year simply went missing.
 *
 * Only reachable from a caller that sends no year, which by construction is the
 * account page's SURVEY panel. `/dashboard/survey` carries the field itself and
 * cannot get here.
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
     * Beside the answers rather than inside them, because it lives on another
     * table and the profile page writes it back through a different route.
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
       * The claim, and the reason this is an `updateMany` filtered on the null
       * rather than trusting the guard above.
       *
       * Two submissions racing — a double-tapped button, a retried request —
       * both pass that guard, and one of them would then insert a second row.
       * Only one of these can match, so only one gets as far as the insert, and
       * the unique index on `user_id` is the backstop under that.
       */
      const claimed = await tx.user.updateMany({
        where: { id: user.id, surveyCompletedAt: null },
        // The dismissal goes with it. Somebody who ticked *don't ask me again*
        // in September and filled it in anyway in March has not declined a
        // survey, and a row that says both is one a future reader has to guess
        // at. There is nothing left to silence once this lands.
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
      // Only when it was sent. The account page's ABOUT YOU panel owns this
      // field and deliberately does not send it, so an absent one means "leave
      // it alone". Writing `undefined` would do the same thing; saying it out
      // loud is what stops somebody later "tidying" it into a null.
      if (gradYear !== undefined) {
        await tx.user.update({ where: { id: user.id }, data: { gradYear } })
      } else {
        /**
         * ...but "leave it alone" is only an answer when there is something to
         * leave. A caller that sends no year, for an account that has none, is
         * saving a survey with a hole in it — so this refuses rather than
         * letting the club quietly lose the answer.
         *
         * 409 rather than 400: nothing is wrong with the request, the account
         * is simply in a state where it does not make sense. Same reasoning as
         * the lab's "the building is shut" refusal.
         */
        const { gradYear: onFile } = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
          select: { gradYear: true },
        })

        if (onFile === null) {
          throw new HTTPException(409, { message: NO_GRAD_YEAR })
        }
      }

      // `findUnique` and a throw rather than an `upsert`: no row here would mean
      // the gate column and this table disagree, and creating one would write
      // the answers without ever stamping the gate — an account locked out for
      // good while holding a completed survey. Better to fail loudly.
      const existing = await tx.memberSurvey.findUniqueOrThrow({
        where: { userId: user.id },
        select: { id: true },
      })

      /**
       * Replaced wholesale rather than reconciled, and the cascade to
       * `survey_answer_options` is what makes that cheap. Every write takes
       * every answer — both forms hold the lot, so both send the lot — which is
       * the deliberate dodge of the `.partial()` trap this codebase has already
       * paid for once; see `equipmentPatch` in `routes/officer/officer.ts`.
       */
      await tx.surveyAnswer.deleteMany({ where: { surveyId: existing.id } })

      return tx.memberSurvey.update({
        where: { id: existing.id },
        // Named rather than left to `@updatedAt`, which Prisma only stamps for
        // a scalar it is already writing — and the only thing changing here is
        // a nested create.
        data: { updatedAt: new Date(), answers: { create: rowsFor(checked) } },
        select: surveySelect,
      })
    })

    // Read back rather than echoed from the request, so a caller that sent no
    // year still gets the one on file.
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
 * **It silences the prompt and nothing else.** The survey stays on the rail's
 * MEMBER SURVEY row's old ground — the overview's panel and the account
 * page's — because a promise not to nag is not a promise to hide the form
 * from somebody who changes their mind, and the whole reason this exists is
 * that the club would still like the answers.
 *
 * Idempotent, and deliberately not a toggle. Pressing it twice is the same
 * press, and there is no route back: un-dismissing is answering the survey,
 * which clears the column in `POST` above. A member who wants to be reminded
 * again is a member who was about to fill it in.
 *
 * It answers with nothing worth reading. The caller already knows what it asked
 * for, and the one thing it might want back — the membership object the rail
 * reads — comes from `/dues/status`, which it refetches anyway. A body rather
 * than a 204 all the same: the browser's `sendJson` parses every response, and
 * an empty one throws on the way back through it. Same note as the deletes in
 * `routes/officer/officer.ts`.
 */
survey.post('/dismiss', originGuard, requireAuth, writes, async (c) => {
  const user = c.get('user')

  // Filtered on the null rather than written flat, so a second press is not a
  // second timestamp. When it happened is the only thing this column says, and
  // it should say the first time.
  await prisma.user.updateMany({
    where: { id: user.id, surveyPromptDismissedAt: null },
    data: { surveyPromptDismissedAt: new Date() },
  })

  return c.json({ dismissed: true })
})
