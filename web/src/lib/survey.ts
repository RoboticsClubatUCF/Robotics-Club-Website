import type {
  ApiSurvey,
  ApiSurveyAnswer,
  ApiSurveyQuestion,
} from './api/api'

/**
 * The member survey's rules, and the shape the form holds an answer in.
 *
 * A mirror of what `server/src/routes/member/survey.ts` enforces: the server is what
 * actually refuses, and this exists so the form doesn't offer something the route will
 * reject.
 *
 * The questions aren't here any more. They used to be five hardcoded option lists; they
 * are rows an officer edits now, and they arrive with the payload. What's left is
 * everything true of a question whatever it asks — which field its kind uses, what
 * counts as having answered it, and what to send.
 */

/**
 * One question's answer, mid-edit.
 *
 * `text` is a string rather than `string | null` because it's bound straight to an
 * input, and a controlled input whose value can be null is the React warning everybody
 * has seen. It becomes null on the way out, in `answersFor`.
 */
export type SurveyEntry = {
  optionIds: string[]
  text: string
  /**
   * The NONE box, for a tick-any question that offers one.
   *
   * There is no NONE option in the payload — an empty set of ticks is "none". This flag
   * is what lets the box exist: it makes "none" something somebody presses rather than
   * the state you're left in by not reading the question. That matters here more than on
   * most forms, because the club reads the answers before it buys food.
   */
  none: boolean
}

export type SurveyDraft = Record<string, SurveyEntry>

const empty = (): SurveyEntry => ({ optionIds: [], text: '', none: false })

const isText = (question: ApiSurveyQuestion) =>
  question.kind === 'SHORT_TEXT' || question.kind === 'LONG_TEXT'

/** Whether a question offers the box that empties its list. */
export const offersNone = (question: ApiSurveyQuestion) =>
  question.kind === 'MULTI_CHOICE' && question.allowNone

/**
 * Ticking an option in a set.
 *
 * NONE and the real options are mutually exclusive in both directions, and the two
 * callers below enforce that: pressing NONE empties the set, and pressing anything else
 * takes NONE off.
 */
export function toggle<T extends string>(picked: T[], value: T): T[] {
  return picked.includes(value)
    ? picked.filter((each) => each !== value)
    : [...picked, value]
}

/** Ticking or picking an option, with the question deciding which it is. */
export const pick = (
  question: ApiSurveyQuestion,
  entry: SurveyEntry,
  optionId: string,
): SurveyEntry => ({
  ...entry,
  optionIds:
    question.kind === 'SINGLE_CHOICE'
      ? [optionId]
      : toggle(entry.optionIds, optionId),
  none: false,
})

/** Pressing NONE, which is the answer that clears the rest. */
export const pickNone = (entry: SurveyEntry): SurveyEntry => ({
  ...entry,
  optionIds: [],
  none: !entry.none,
})

/**
 * Whether a question has been answered at all.
 *
 * The one that needs saying is the tick-any case. An empty set with NONE unticked is
 * somebody who scrolled past, and it's indistinguishable at the server from a deliberate
 * "no allergies". So the form insists on the press, and this is the check it insists
 * with.
 */
export function answered(
  question: ApiSurveyQuestion,
  entry: SurveyEntry,
): boolean {
  if (isText(question)) return entry.text.trim() !== ''

  if (offersNone(question)) return entry.none || entry.optionIds.length > 0

  return entry.optionIds.length > 0
}

/** Whether anything picked here asks for a line of its own. */
export const wantsText = (
  question: ApiSurveyQuestion,
  entry: SurveyEntry,
): boolean =>
  question.options.some(
    (option) => option.wantsText && entry.optionIds.includes(option.id),
  )

/**
 * What's still wrong with a draft, as one sentence, or null when it's ready.
 *
 * The same rules `checkAnswers` refuses with on the server, checked here so the page can
 * say so beside the field instead of round-tripping a 400.
 *
 * In question order, so the sentence somebody gets is about the first thing they missed
 * on the way down rather than the last.
 */
export function surveyProblem(
  questions: ApiSurveyQuestion[],
  draft: SurveyDraft,
): string | null {
  for (const question of questions) {
    const entry = draft[question.id] ?? empty()

    if (question.required && !answered(question, entry)) {
      if (isText(question)) return `${question.prompt} needs an answer.`

      return offersNone(question)
        ? `Tick an answer to “${question.prompt}”, or tick None.`
        : `Pick an answer to “${question.prompt}”.`
    }

    // The rule that's about safety rather than tidiness: an unexplained "other allergy"
    // is a warning the club can't act on.
    if (wantsText(question, entry) && entry.text.trim() === '') {
      return `You picked an answer to “${question.prompt}” that asks you to say which — fill that box in.`
    }
  }

  return null
}

/** A draft as the two writes want it: an entry per question actually answered. */
export function answersFor(
  questions: ApiSurveyQuestion[],
  draft: SurveyDraft,
): ApiSurveyAnswer[] {
  return questions.flatMap((question): ApiSurveyAnswer[] => {
    const entry = draft[question.id] ?? empty()

    // Nothing to send. The answer row existing is what "answered" means, so an untouched
    // optional question is an absence rather than an empty row.
    if (!answered(question, entry)) return []

    if (isText(question)) {
      return [{ questionId: question.id, optionIds: [], text: entry.text.trim() }]
    }

    return [
      {
        questionId: question.id,
        optionIds: entry.optionIds,
        // Cleared unless something picked actually asked for it — a stale "Business" left
        // behind a switch back to a listed answer is a row that contradicts itself. The
        // server does the same; this only keeps the request honest.
        text: wantsText(question, entry) ? entry.text.trim() : null,
      },
    ]
  })
}

/** An existing set of answers, as a draft the form can edit. */
export function draftFrom(
  questions: ApiSurveyQuestion[],
  survey: ApiSurvey | null,
): SurveyDraft {
  const stored = new Map(
    (survey?.answers ?? []).map((answer) => [answer.questionId, answer]),
  )

  return Object.fromEntries(
    questions.map((question) => {
      const answer = stored.get(question.id)

      if (answer === undefined) return [question.id, empty()]

      return [
        question.id,
        {
          optionIds: answer.optionIds,
          text: answer.text ?? '',
          /**
           * A stored answer with an empty list is a deliberate "none" — it couldn't have
           * been saved otherwise — so re-opening the form shows the box ticked rather
           * than making somebody answer it again.
           */
          none: offersNone(question) && answer.optionIds.length === 0,
        },
      ]
    }),
  )
}

/**
 * One stored answer as a sentence, for anywhere that prints one back.
 *
 * Null means the question wasn't answered, which the caller says in its own words — this
 * can't, because a dash on the account page and a blank cell in a spreadsheet aren't the
 * same silence.
 */
export function answerLine(
  question: ApiSurveyQuestion,
  answer: ApiSurveyAnswer | undefined,
): string | null {
  if (answer === undefined) return null

  if (isText(question)) return answer.text

  const labels = question.options
    .filter((option) => answer.optionIds.includes(option.id))
    .map((option) => option.label)

  // "None" rather than a dash. An empty list here is an answer somebody gave — the form
  // won't save one without NONE ticked — and a dash would read as a question they skipped.
  if (labels.length === 0) return offersNone(question) ? 'None' : null

  /**
   * OTHER is a placeholder for an answer rather than an answer — printing "Other" at
   * somebody who typed "Biomedical Engineering" is the site telling them it didn't keep
   * what they said. So on a pick-one question their words replace the label outright; on
   * a tick-any one they go after it, because the other ticks still have to be listed.
   */
  if (answer.text !== null && answer.text !== '') {
    return question.kind === 'SINGLE_CHOICE'
      ? answer.text
      : `${labels.join(', ')} (${answer.text})`
  }

  return labels.join(', ')
}

/**
 * The survey asks for a graduation year, and one page doesn't carry the field.
 *
 * The account page leaves it to ABOUT YOU, so a member who cleared it there is holding a
 * survey with a hole in it. `PUT /api/survey` answers 409 for exactly this, and the
 * sentence is mirrored here because nothing else would ever mention it: the SURVEY panel
 * is the one place somebody looks at the survey without being asked to fill it in.
 *
 * It names ABOUT YOU rather than the survey page, though both can fix it — that field is
 * a scroll away on the screen they're already reading.
 */
export const NO_GRAD_YEAR =
  'Your graduation year is missing, and the survey asks for it. Set it under ABOUT YOU above.'
