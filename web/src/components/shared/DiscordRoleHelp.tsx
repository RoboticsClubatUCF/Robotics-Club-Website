/**
 * How to find a Discord role id, behind an info disclosure.
 *
 * The instruction used to be one sentence tacked onto the end of the field's
 * note — "With Developer Mode on, right-click the role and Copy Role ID" —
 * which is the last step of a four-step job and assumes the setting is already
 * on. It is the only field on either form that asks for something a person has
 * to go and fetch from somewhere else, and the only one whose wrong answer is
 * an action taken on other people's accounts.
 *
 * **A native `<details>`**, the same choice `FaqSection` makes and for the same
 * reasons: the browser supplies the open state, the keyboard handling and the
 * role, and the closed content stays findable by the browser's own in-page
 * search — which a component that unmounted its answer would not be.
 *
 * Shared between the create form and the project's manage page rather than
 * written twice, the way `LinkRows` is: the two say the same thing about the
 * same field, and the copy that matters here is the half about *not* pasting a
 * club-wide role, which must not drift from what the server refuses.
 */
export function DiscordRoleHelp() {
  return (
    <details className="group mt-2">
      <summary className="text-faint hover:text-primary flex w-fit cursor-pointer list-none items-center gap-1.5 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 marker:content-none">
        {/* `aria-hidden` because the summary already says what this opens —
            announcing "info" before it would be the same word twice. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="size-3.5 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        >
          <circle cx="8" cy="8" r="6.6" />
          <path d="M8 7.2v4" strokeLinecap="round" />
          <path d="M8 4.8v.6" strokeLinecap="round" />
        </svg>
        WHERE DO I FIND THIS?
        <span aria-hidden="true" className="transition-transform duration-200 group-open:rotate-90">
          ›
        </span>
      </summary>

      <div className="border-rule text-faint mt-2 space-y-3 border-l pl-3 text-[11px] leading-[1.6]">
        <div>
          <p className="mb-1 font-medium">Turn Developer Mode on, once:</p>
          <ol className="list-decimal space-y-0.5 pl-4">
            <li>
              In Discord, open <strong>User Settings</strong> — the cog beside
              your name.
            </li>
            <li>
              Go to <strong>Advanced</strong>, and switch on{' '}
              <strong>Developer Mode</strong>.
            </li>
          </ol>
        </div>

        <div>
          <p className="mb-1 font-medium">Then copy the role&rsquo;s id:</p>
          <ol className="list-decimal space-y-0.5 pl-4">
            <li>
              Open the club&rsquo;s server, then{' '}
              <strong>Server Settings → Roles</strong>.
            </li>
            <li>
              Right-click the role you want — or press the{' '}
              <span className="font-mono">⋯</span> beside it — and choose{' '}
              <strong>Copy Role ID</strong>.
            </li>
            <li>Paste it here. It is 17 to 20 digits and nothing else.</li>
          </ol>
        </div>

        {/* The half that is not instructions. Both of these are refused by the
            server, and somebody who reads this first never meets the refusal. */}
        <div>
          <p className="mb-1 font-medium">Two roles this cannot be:</p>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>
              <strong>Not one of the club&rsquo;s own roles</strong> — Members,
              Project Lead, Team Lead, Officers, Officer Alumni. The site hands
              those out itself, and a project&rsquo;s role is added and removed
              as people join and leave it, so the first person to leave would
              lose the club-wide one. Give the project a role of its own.
            </li>
            <li>
              <strong>Not a role above the bot&rsquo;s.</strong> Discord will not
              let a bot hand out a role ranked higher than its own, so drag the
              project&rsquo;s role below the site&rsquo;s bot in{' '}
              <strong>Server Settings → Roles</strong>.
            </li>
          </ul>
        </div>
      </div>
    </details>
  )
}
