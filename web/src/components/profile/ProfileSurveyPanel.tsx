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
 * The member survey on the account page: what you answered, and the way back
 * to the form.
 *
 * **The answers go stale and the page they were given on does not invite you
 * back.** `/dashboard/survey` asks once and then drops out of the rail, which
 * is right for a thing you do once and wrong for a shirt size — people change
 * size, change major and put their graduation back a year. The account page is
 * where somebody already goes to change facts about themselves, so this is
 * where the answers live afterwards.
 *
 * It is also one of the two places that still offer the survey to somebody who
 * never answered it — the overview's panel is the other. That matters more than
 * it used to: the survey is optional now and the prompt carries a *don't ask me
 * again*, so for anybody who ticks it these two panels are the whole of what is
 * left.
 *
 * **It reads them; it does not edit them.** This panel used to carry the whole
 * form, and on a page of one- and two-field panels a survey was several times
 * the height of anything around it — a column that scrolled for most of a
 * screen before reaching the next panel. The editor it held was
 * `/dashboard/survey`'s editor anyway, and that page stays mounted and `PUT`s
 * once the survey is answered, so the fix was to stop keeping a second copy of
 * it here rather than to fold this one up behind a disclosure. Whichever
 * question somebody came to check, the answer is on screen without a press;
 * changing one is a press away.
 *
 * **The graduation year is not among the facts**, though the survey asks for
 * it. ABOUT YOU above owns that field, and printing it here as well would put
 * one column on one screen twice — `dashboard.md`'s doubled-label bug, which a
 * read-only copy is no more excused from than a second input would be.
 *
 * **The gap that leaves is an error rather than a silence.** ABOUT YOU allows a
 * null year — correct for the people who never answered the survey — so
 * somebody who *did* answer can clear it and end up holding a survey with a
 * hole in it. `PUT /api/survey` answers 409 and nothing else on the site would
 * ever mention it, so this says so where the rest of the answers are.
 */
export function ProfileSurveyPanel({
  gradYear,
}: {
  /**
   * Read from the page rather than from this panel's own fetch, and that is the
   * whole reason it is a prop. `ProfilePage` keeps it current through `merge`,
   * so filling the year in under ABOUT YOU clears the warning here on the same
   * press — where a copy taken at mount would go on complaining until a reload.
   */
  gradYear: number | null
}) {
  /**
   * This panel does its own read, and it is the one on the page that does.
   *
   * The page's "one read" is `GET /api/account`, and the survey is not on that
   * resource — it is another table with its own route. Rather than widen the
   * account payload for one panel, this asks for what it needs. It is also why
   * the panel renders nothing at all until the answer lands: a panel that
   * appeared a beat after the ones above it would push the whole column down
   * under somebody's pointer.
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

  // Nothing at all while it is in flight, rather than a skeleton: the panels
  // above have already landed, and a box that appears under a pointer already
  // resting somewhere is the whole column moving.
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
   * Defaulted rather than read straight off, for the reason the `!survey` check
   * below is falsy rather than `=== null`: everything under here iterates it,
   * and a payload that arrived without it would take the whole account page
   * down — including the way out of the account, which is the last page that
   * should ever white-screen.
   */
  const questions = state.data.questions ?? []

  // Never answered, so there is nothing to print back. A different situation
  // from an answer this panel could not read, and it gets different words: the
  // account page is one of the two the survey prompt deliberately stays off, so
  // somebody who has not answered does land here — and so does somebody who
  // told the prompt to stop, which is the reason this offer stays.
  //
  // Falsy rather than `=== null`, which is all the type allows for: everything
  // below reads fields off this object, and a payload that arrived without one
  // would take the whole account page down with it — including the way out of
  // the account, which is the last page that should ever white-screen.
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

      {/* The rows YOUR STANDING is drawn from, deliberately: both panels are
          facts about the account that are changed somewhere other than where
          they are read.

          Drawn from the questions rather than written out, because they are
          rows an officer edits. That is also why a question with no answer is
          printed at all rather than skipped: a member who answered the survey
          before the club added a question is holding a gap, and a panel that
          silently omitted it would leave them with no way to know. */}
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

      {/* Standing, and the only thing on this panel that is a problem rather
          than a fact — so it is the one line here with a colour. */}
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
