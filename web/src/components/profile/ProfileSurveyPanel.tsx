import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { getJson, type ApiSurveyState } from '../../lib/api/api'
import { NO_GRAD_YEAR, answerLine } from '../../lib/survey'
import {
  PanelFact,
  ProfilePanel,
  noteClass,
  panelQuietClass,
} from './profileChrome'

/**
 * The member survey on the account page: what you answered, and the way back to the form.
 *
 * The answers go stale and the page they were given on doesn't invite you back.
 * `/dashboard/survey` asks once and then drops out of the rail, which is right for a thing
 * you do once and wrong for a shirt size — people change size, change major and put their
 * graduation back a year. The account page is where somebody already goes to change facts
 * about themselves.
 *
 * It's also one of the two places that still offer the survey to somebody who never
 * answered it. That matters more than it used to: the survey is optional now and the
 * prompt carries a *don't ask me again*, so for anybody who ticks it these two panels are
 * the whole of what's left.
 *
 * It reads them; it doesn't edit them. This panel used to carry the whole form, and on a
 * page of one- and two-field panels a survey was several times the height of anything
 * around it. The editor it held was `/dashboard/survey`'s anyway, so the fix was to stop
 * keeping a second copy rather than fold this one behind a disclosure.
 *
 * The graduation year isn't among the facts, though the survey asks for it. ABOUT YOU above
 * owns that field, and printing it here as well would put one column on one screen twice.
 *
 * The gap that leaves is an error rather than a silence: ABOUT YOU allows a null year, so
 * somebody who did answer can clear it and end up holding a survey with a hole in it.
 * `PUT /api/survey` answers 409 and nothing else would ever mention it.
 */
export function ProfileSurveyPanel({
  gradYear,
}: {
  /**
   * Read from the page rather than this panel's own fetch, which is the whole reason it's a
   * prop. `ProfilePage` keeps it current through `merge`, so filling the year in under ABOUT
   * YOU clears the warning here on the same press.
   */
  gradYear: number | null
}) {
  /**
   * This panel does its own read, and it's the one on the page that does.
   *
   * The page's "one read" is `GET /api/account`, and the survey isn't on that resource.
   * Rather than widen the account payload for one panel, this asks for what it needs. It's
   * also why the panel renders nothing until the answer lands: a panel appearing a beat
   * after the ones above it would push the column down under somebody's pointer.
   */
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; data: ApiSurveyState }
  >({ status: 'loading' })

  const load = useCallback(async () => {
    try {
      const data = await getJson<ApiSurveyState>('/survey')
      setState({ status: 'ready', data })
    } catch (error) {
      console.error(error)
      setState({ status: 'error' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Nothing at all while it's in flight, rather than a skeleton: the panels above have
  // already landed, and a box that appears under a pointer already resting somewhere is the
  // whole column moving.
  if (state.status === 'loading') return null

  if (state.status === 'error') {
    return (
      <ProfilePanel label="MEMBER SURVEY">
        <p className={noteClass}>
          We couldn&rsquo;t load your answers just now.{' '}
          <button
            type="button"
            onClick={() => void load()}
            className="text-primary cursor-pointer underline underline-offset-2"
          >
            Try again
          </button>
          .
        </p>
      </ProfilePanel>
    )
  }

  const { survey } = state.data
  /**
   * Defaulted rather than read straight off, for the reason the `!survey` check below is
   * falsy rather than `=== null`: everything under here iterates it, and a payload that
   * arrived without it would take the whole account page down — including the way out of
   * the account, which is the last page that should ever white-screen.
   */
  const questions = state.data.questions ?? []

  // Never answered, so there's nothing to print back. A different situation from an answer
  // this panel couldn't read, and it gets different words: the account page is one of the
  // two the prompt deliberately stays off, so somebody who hasn't answered does land here —
  // and so does somebody who told the prompt to stop, which is why this offer stays.
  //
  // Falsy rather than `=== null`: everything below reads fields off this object, and a
  // payload that arrived without one would take the whole account page down with it.
  if (!survey) {
    return (
      <ProfilePanel label="MEMBER SURVEY">
        <p className={noteClass}>
          You haven&rsquo;t filled it in yet. Nothing on the site waits on it
          &mdash; it takes about two minutes, and it is how the club knows what
          size shirts to order and what it can safely feed people.
        </p>
        <Link to="/dashboard/survey" className={`${panelQuietClass} mt-4`}>
          FILL IT IN
        </Link>
      </ProfilePanel>
    )
  }

  return (
    <ProfilePanel label="MEMBER SURVEY">
      <p className={`${noteClass} mb-3`}>
        What the club uses to order shirts and to feed people safely. You
        won&rsquo;t be asked again &mdash; change any of it whenever it changes.
      </p>

      {/* The rows YOUR STANDING is drawn from, deliberately: both panels are facts about the
          account that are changed somewhere other than where they're read.

          Drawn from the questions rather than written out, because they're rows an officer
          edits. That's also why a question with no answer is printed rather than skipped: a
          member who answered before the club added a question is holding a gap, and a panel
          that silently omitted it would leave them with no way to know. */}
      <dl className="divide-rule divide-y">
        {questions.map((question) => (
          <PanelFact
            key={question.id}
            label={question.prompt.toUpperCase()}
            value={answerLine(
              question,
              (survey.answers ?? []).find(
                (answer) => answer.questionId === question.id,
              ),
            )}
          />
        ))}
      </dl>

      {/* Standing, and the only thing on this panel that's a problem rather than a fact — so
          it's the one line here with a colour. */}
      {gradYear === null && (
        <p className="text-error mt-4 text-[13px] leading-[1.6] text-pretty">
          {NO_GRAD_YEAR}
        </p>
      )}

      <Link to="/dashboard/survey" className={`${panelQuietClass} mt-4`}>
        CHANGE MY ANSWERS
      </Link>
    </ProfilePanel>
  )
}
