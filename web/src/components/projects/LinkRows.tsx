import { useId } from 'react'
import { fieldClass, labelClass } from '../shared/formChrome'
import type { DraftLink } from '../../lib/projects/projectDraft'
import { MAX_PROJECT_LINKS } from '../../lib/projects/projectGallery'

/**
 * The `/ RESOURCES` link list, as a controlled field.
 *
 * Extracted because it is used in two states of the same page and has to look
 * identical in both: the create form collects links before there is a project
 * to hang them on, and the editor edits them afterwards. One component means
 * the labels, the cap and the remove control cannot drift between the two.
 */
export function LinkRows({
  links,
  disabled,
  onChange,
}: {
  links: DraftLink[]
  disabled: boolean
  onChange: (links: DraftLink[]) => void
}) {
  const id = useId()

  const setLink = (index: number, patch: Partial<DraftLink>) => {
    onChange(links.map((link, at) => (at === index ? { ...link, ...patch } : link)))
  }

  return (
    <>
      {links.map((link, index) => (
        // Keyed by position because there is nothing else to key by — a draft
        // link has no id, and the list is only ever appended to or spliced.
        <div key={index} className="flex flex-wrap items-end gap-2">
          <div className="min-w-[9rem] flex-1">
            <label className={labelClass} htmlFor={`${id}-label-${index}`}>
              LABEL
            </label>
            <input
              id={`${id}-label-${index}`}
              type="text"
              value={link.label}
              maxLength={60}
              placeholder="Design doc"
              disabled={disabled}
              onChange={(event) => {
                setLink(index, { label: event.target.value })
              }}
              className={fieldClass}
            />
          </div>
          <div className="min-w-[12rem] flex-[2]">
            <label className={labelClass} htmlFor={`${id}-url-${index}`}>
              LINK
            </label>
            <input
              id={`${id}-url-${index}`}
              type="url"
              value={link.url}
              maxLength={500}
              placeholder="https://…"
              disabled={disabled}
              onChange={(event) => {
                setLink(index, { url: event.target.value })
              }}
              className={fieldClass}
            />
          </div>
          <button
            type="button"
            aria-label={`Remove link ${index + 1}`}
            disabled={disabled}
            onClick={() => {
              onChange(links.filter((_, at) => at !== index))
            }}
            className="text-faint hover:text-error flex size-11 cursor-pointer items-center justify-center text-sm transition-colors duration-200 disabled:opacity-50 wide:size-10"
          >
            ✕
          </button>
        </div>
      ))}

      <button
        type="button"
        disabled={disabled || links.length >= MAX_PROJECT_LINKS}
        onClick={() => {
          onChange([...links, { label: '', url: '' }])
        }}
        className="text-faint hover:text-primary cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50"
      >
        + ADD A LINK
        {links.length >= MAX_PROJECT_LINKS && ` — ${MAX_PROJECT_LINKS} IS THE LIMIT`}
      </button>
    </>
  )
}
