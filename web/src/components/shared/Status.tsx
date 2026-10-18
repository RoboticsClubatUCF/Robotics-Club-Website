/** A section's feedback, shown only when there is something to report. */
export function Status({
  message,
  tone = 'error',
}: {
  message: string
  tone?: 'error' | 'ok'
}) {
  if (!message) return null

  return (
    <p
      role="status"
      className={`mt-2 text-[12px] ${tone === 'ok' ? 'text-primary' : 'text-error'}`}
    >
      {message}
    </p>
  )
}
