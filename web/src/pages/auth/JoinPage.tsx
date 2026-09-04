import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ApiError, postJson, type ApiSignupVerified } from '../../lib/api/api'
import { SignupStart } from '../../components/join/SignupStart'
import { SignupFinish } from '../../components/join/SignupFinish'
import { Confetti } from '../../components/shared/Confetti'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
} from '../../components/shared/formChrome'

/**
 * Signing up, which is how someone joins the club.
 *
 * One route, four screens, and which one you get is decided by whether the URL carries a token:
 *
 *   /join              the requirement, then an address to send a link to
 *   /join?token=…      the link was followed — the rest of the form
 *   …then              the account exists, and what happens next
 *
 * The token in the URL is the whole reason this needs to be a real route rather than a step in a
 * wizard: the link is opened from an email, often on a different device from the one the form was
 * started on, so nothing about the second half may depend on state the first half left in a tab.
 *
 * The token is spent by a POST this page makes, never by opening the URL. Corporate mail scanners
 * follow every link in an incoming message, and against a GET endpoint that would use the
 * verification up before the student ever clicked it.
 */

type VerifyState =
  | { status: 'checking' }
  | { status: 'verified'; email: string }
  | { status: 'invalid'; message: string }

function explain(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) {
      return "Couldn't reach the server to check that link. Check your connection and try again."
    }
    if (error.status === 429) {
      return 'That link has been opened a few too many times at once. Wait a little while and try it again.'
    }
    if (error.detail) return error.detail
  }

  return "We couldn't check that link. Try opening it again from your email."
}

export function JoinPage() {
  const [params] = useSearchParams()
  const token = params.get('token')

  const [verify, setVerify] = useState<VerifyState>({ status: 'checking' })
  const [created, setCreated] = useState(false)

  useEffect(() => {
    if (!token) return

    // Aborting on cleanup is what makes StrictMode's double-invoke in
    // development harmless. Verifying twice is safe on the server anyway — it
    // keeps the first confirmation time — but a response landing after this
    // page has moved on is not.
    const controller = new AbortController()
    setVerify({ status: 'checking' })

    postJson<ApiSignupVerified>('/signup/verify', { token }, controller.signal)
      .then((confirmed) => {
        setVerify({ status: 'verified', email: confirmed.email })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        console.error(error)
        setVerify({ status: 'invalid', message: explain(error) })
      })

    return () => {
      controller.abort()
    }
  }, [token])

  return (
    <section className="px-page py-14 wide:py-20">
      {/* Centred and narrow. This is the one page on the site that is a task
          rather than something to read, and a form stretched across a wide
          monitor is a form nobody can follow down. */}
      <div className="mx-auto w-full max-w-[34rem]">
        {created ? (
          <AccountCreated />
        ) : !token ? (
          <SignupStart />
        ) : verify.status === 'checking' ? (
          <CheckingLink />
        ) : verify.status === 'invalid' ? (
          <BadLink message={verify.message} />
        ) : (
          <SignupFinish
            email={verify.email}
            token={token}
            onCreated={() => {
              setCreated(true)
            }}
          />
        )}
      </div>
    </section>
  )
}

/**
 * Sized to roughly what replaces it, for the same reason the landing page's
 * skeletons are: the answer usually arrives in well under a second, and a
 * layout that jumps when it does is worse than one that waits.
 */
function CheckingLink() {
  return (
    <div aria-busy="true">
      <FormEyebrow>/ ONE MOMENT</FormEyebrow>
      <FormHeading>Checking your link…</FormHeading>
      <div className="border-rule bg-base-200 h-40 border" />
    </div>
  )
}

function BadLink({ message }: { message: string }) {
  return (
    <>
      <FormEyebrow>/ THAT LINK DIDN'T WORK</FormEyebrow>
      <FormHeading>We can send you another.</FormHeading>

      <FormPanel tone="accent">
        <p className="text-dim text-sm leading-[1.7] text-pretty">{message}</p>
      </FormPanel>

      <Link
        to="/join"
        /* A full load rather than a route change: this page is looking at the
           token in the URL, and dropping it is the entire point of the link. */
        reloadDocument
        className="btn btn-primary btn-cta mt-7 w-full px-6 py-3.5 text-[13px] font-semibold"
      >
        START AGAIN
      </Link>
    </>
  )
}

/**
 * The one screen on the site that celebrates rather than informs, hence the confetti — it is the
 * end of a form somebody just filled in twice over.
 *
 * It still has to say what happens next. An account is not membership, and a page that says "you're
 * in" and stops is how somebody ends up waiting to be told what to do: the two remaining steps are
 * the club's own, in the club's order, and neither happens here.
 */
function AccountCreated() {
  return (
    <>
      <Confetti />

      <FormEyebrow>/ YOU'RE SIGNED UP</FormEyebrow>
      <FormHeading>Welcome to RCCF.</FormHeading>

      <p className="text-dim mb-7 text-sm leading-[1.7] text-pretty">
        Your account is created and your Discord username is connected to it.
      </p>

      <FormPanel>
        <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
          STILL TO DO
        </p>

        <ol className="text-dim space-y-4 text-sm leading-[1.7]">
          <li className="flex gap-3">
            <span className="text-primary shrink-0 pt-px font-mono text-[11px] font-medium">
              1.
            </span>
            <span className="text-pretty">
              Pay your dues — $25 a semester, $50 for the year.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-primary shrink-0 pt-px font-mono text-[11px] font-medium">
              2.
            </span>
            <span className="text-pretty">
              Come to a general body meeting — times are in the Discord.
            </span>
          </li>
        </ol>
      </FormPanel>

      <div className="mt-7 flex flex-wrap items-center gap-3.5">
        <Link
          to="/dashboard"
          className="btn btn-primary btn-cta px-7 py-[15px] text-[13px] font-semibold"
        >
          GO TO MY DASHBOARD
        </Link>
        <Link
          to="/projects"
          className="btn btn-outline h-auto min-h-0 border-base-content/28 px-7 py-[15px] text-[13px] font-semibold tracking-[0.04em] text-base-content transition-[border-color,background-color] duration-200 hover:border-base-content hover:bg-base-content/6 hover:text-base-content"
        >
          See the projects
        </Link>
      </div>
    </>
  )
}
