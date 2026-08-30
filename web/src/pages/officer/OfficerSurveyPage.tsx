import { Link, useOutletContext } from 'react-router'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { DuesLocked } from '../../components/dashboard/DuesLocked'
import { OfficerOnly } from '../../components/dashboard/OfficerOnly'
import { isOfficer } from '../../lib/auth/session'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  measureClass,
} from '../../components/shared/formChrome'
import { apiBaseUrl } from '../../lib/api/api'
import type { ApiSurveyQuestionTally, ApiSurveySummary } from '../../lib/api/api'
import { duesLocked } from '../../lib/dues/dues'
import { useApi } from '../../lib/api/useApi'

/**
 * `/dashboard/officer/survey` — what the club learned, as counts.
 *
 * The survey exists so somebody can order the right shirts and buy food nobody
 * has to refuse, and without a page like this the answers sit in Postgres where
 * only Prisma Studio can reach them. So this is deliberately not a table of
 * people: it is the tallies an order is actually placed from, and a CSV for the
 * cases a tally cannot answer.
 *
 * **One panel per question, whatever the questions are.** They used to be six
 * hardcoded lists with the club's own wording over them; officers write them
 * now, at the page this one links to.
 *
 * **Every option is listed, including the ones on nought.** A list that omits
 * the sizes nobody picked reads as "we need none of those" rather than as
 * "nobody has asked for one", and the difference is a box of shirts. The server
 * returns the zeroes for the same reason.
 */
export function OfficerSurveyPage() {
  const { user, membership } = useOutletContext<DashboardContext>()

  // Dues before role, the order every other desk uses: a lapsed officer is
  // still an officer, and the sentence they need is about a payment.
  if (duesLocked(membership, user.role)) {
    return <DuesLocked eyebrow="/ MANAGE · SURVEY" />
  }

  if (!isOfficer(user.role)) {
    return <OfficerOnly eyebrow="/ MANAGE · SURVEY" why="It carries members’ names, contact details and their allergies, so it is board business." />
  }

  return <Results />
}

const panelLabel =
  'text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]'

const quietLink =
  'btn btn-outline h-auto min-h-0 border-base-content/28 px-5 py-2.5 text-[12px] font-semibold tracking-[0.04em] text-base-content hover:border-base-content hover:bg-base-content/6 hover:text-base-content'

function Results() {
  const summary = useApi<ApiSurveySummary>('/officer/survey')

  if (summary.status === 'loading') {
    return (
      <div aria-busy="true">
        <FormEyebrow>/ MANAGE · SURVEY</FormEyebrow>
        <FormHeading>Counting the answers…</FormHeading>
        <div className="border-rule bg-base-200 h-64 border" />
      </div>
    )
  }

  if (summary.status === 'error') {
    return (
      <>
        <FormEyebrow>/ MANAGE · SURVEY</FormEyebrow>
        <FormHeading>We couldn&rsquo;t load that.</FormHeading>
        <p className={`${measureClass} text-dim text-sm leading-[1.7] text-pretty`}>
          The survey results did not come back. Try again in a moment.
        </p>
      </>
    )
  }

  const data = summary.data
  const asked = data.responded + data.outstanding

  return (
    <>
      <FormEyebrow>/ MANAGE · SURVEY</FormEyebrow>
      <FormHeading>What the club knows.</FormHeading>

      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <p className="text-dim max-w-[42rem] text-sm leading-[1.7] text-pretty">
          <span className="text-base-content">{data.responded}</span> answered
          {asked > 0 && (
            <>
              {' '}
              of <span className="text-base-content">{asked}</span> active members
            </>
          )}
          {data.outstanding > 0 && (
            <>
              {' '}
              &mdash; {data.outstanding} still to go, and they are locked out
              until they do.
            </>
          )}
        </p>

        <div className="flex flex-wrap gap-3">
          <Link to="/dashboard/officer/survey/questions" className={quietLink}>
            EDIT THE QUESTIONS
          </Link>

          {/*
            A plain link, not a fetch. The file is served straight off the API
            with its own `Content-Disposition`, and going through `getJson` would
            mean holding the whole CSV in memory to hand it back to the browser
            that was going to download it anyway. `apiBaseUrl` because the API is
            a different origin — a root-relative href here would ask Vite for it
            and get `index.html` back, which is the trap `storedFiles.ts` documents.
          */}
          <a
            href={`${apiBaseUrl}/api/officer/survey/export.csv`}
            className={quietLink}
          >
            DOWNLOAD CSV
          </a>
        </div>
      </div>

      {data.questions.length === 0 ? (
        <div className={measureClass}>
          <FormPanel>
            <p className="text-dim text-sm leading-[1.7] text-pretty">
              There are no questions on the survey. Put some on it and the
              answers will show up here.
            </p>
            <Link
              to="/dashboard/officer/survey/questions"
              className={`${quietLink} mt-4`}
            >
              EDIT THE QUESTIONS
            </Link>
          </FormPanel>
        </div>
      ) : (
        /* The page exists to be read across rather than down — an order is
           placed off two or three tallies at once. As many columns as fit, so a
           monitor shows the lot without scrolling. `items-start` because one
           question is a dozen rows and the next is four. */
        <div className="grid-fluid items-start gap-5 [--col-min:20rem]">
          {data.questions.map((question) => (
            <Tally
              key={question.id}
              question={question}
              total={data.responded}
            />
          ))}

          <FormPanel>
            <p className={panelLabel}>GRADUATION YEARS</p>
            {data.gradYears.length === 0 ? (
              <p className="text-faint text-[13px] leading-[1.6]">Nothing yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.gradYears.map((row) => (
                  <Row
                    key={row.value}
                    label={String(row.value)}
                    count={row.count}
                    total={data.responded}
                  />
                ))}
              </ul>
            )}
          </FormPanel>
        </div>
      )}
    </>
  )
}

function Tally({
  question,
  total,
}: {
  question: ApiSurveyQuestionTally
  total: number
}) {
  return (
    <FormPanel>
      <p className={panelLabel}>{question.prompt.toUpperCase()}</p>

      {/* A written answer has no tally to draw. What it has is a number of
          people who wrote something and a spreadsheet with the words in it,
          and saying that is better than a panel of bars on nought. */}
      {question.kind === 'SHORT_TEXT' || question.kind === 'LONG_TEXT' ? (
        <p className="text-dim text-[13px] leading-[1.6] text-pretty">
          {question.answered === 0
            ? 'Nobody has written anything yet.'
            : `${question.answered} ${question.answered === 1 ? 'person has' : 'people have'} written something. The answers are in the CSV.`}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {question.options.map((option) => (
            <Row
              key={option.id}
              label={option.label}
              /* An answer the club has stopped offering, still counted because
                 the people who gave it have not stopped meaning it. */
              note={option.archived ? 'removed' : null}
              count={option.count}
              total={total}
            />
          ))}

          {/* Its own row rather than an option, because there is no NONE
              option — an empty set of ticks is what pressing it stores. It
              would otherwise be the one answer on the survey nothing counted. */}
          {question.none !== null && (
            <Row label="None" count={question.none} total={total} />
          )}
        </ul>
      )}
    </FormPanel>
  )
}

/**
 * One line of a tally: the name, a bar, and the number.
 *
 * The bar is a proportion of the largest possible count rather than of the
 * largest actual one, so two panels side by side can be read against each
 * other. A row on nought draws no bar and greys its number, which is what keeps
 * "nobody picked this" visibly different from "this is a small number".
 */
function Row({
  label,
  note = null,
  count,
  total,
}: {
  label: string
  note?: string | null
  count: number
  total: number
}) {
  const share = total > 0 ? Math.round((count / total) * 100) : 0

  return (
    <li className="flex items-center gap-3">
      <span className="text-dim w-36 shrink-0 truncate text-[13px] leading-[1.6]">
        {label}
        {note !== null && <span className="text-faint/70 ml-1.5">({note})</span>}
      </span>

      <span className="bg-base-300 h-2 min-w-0 flex-1">
        <span
          className="bg-primary block h-full"
          style={{ width: `${share}%` }}
        />
      </span>

      <span
        className={`w-8 shrink-0 text-right font-mono text-[12px] ${
          count === 0 ? 'text-faint' : 'text-base-content'
        }`}
      >
        {count}
      </span>
    </li>
  )
}
