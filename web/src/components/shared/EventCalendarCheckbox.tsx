/** The same opt-in for the events desk and a project's event form. */
export function EventCalendarCheckbox({
  published = false,
  disabled = false,
}: {
  published?: boolean
  disabled?: boolean
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        name="published"
        defaultChecked={published}
        disabled={disabled}
        className="checkbox checkbox-sm border-rule mt-0.5"
      />
      <span className="text-dim text-[13px] leading-[1.5] text-pretty">
        Show on the main calendar
        <span className="text-faint block text-[12px]">
          Visible to everyone on the public website.
        </span>
      </span>
    </label>
  )
}
