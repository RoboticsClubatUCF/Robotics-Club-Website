/**
 * One always-rendered status line per section, as every form on the site has.
 *
 * Always rendered, and that is the point: it reserves its own height whether or
 * not there is anything to say, so a save that fails does not shove the buttons
 * under the cursor. Its state comes from `useSectionStatus` in
 * `lib/useSectionStatus.ts` — the hook lives apart from this file because a
 * module that exports both a hook and a component cannot be hot-swapped.
 *
 * In `shared/` because four things use it: the project editor and the documents
 * section beside it, and the front-page and sponsor desks.
 */
export function Status({
  message,
  tone = 'error',
}: {
  message: string
  tone?: 'error' | 'ok'
}) {
  return (
    <p
      role="status"
      className={`mt-2 min-h-4 text-[12px] ${tone === 'ok' ? 'text-primary' : 'text-error'}`}
    >
      {message}
    </p>
  )
}
