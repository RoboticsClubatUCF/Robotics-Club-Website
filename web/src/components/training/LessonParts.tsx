import { type ReactNode, useState } from 'react'
import { duration } from '../../lib/slicer/estimate'
import type { Focus } from '../../lib/slicer/scene'
import { PRACTICE_WORKSPACE } from '../../lib/training/practiceProfiles'
import { useLessonPreview, useManifest } from '../../lib/training/practiceSlices'
import { PreviewView } from '../slicer/PreviewView'

/**
 * The pieces lessons are made of: headings, paragraphs, lists and keys in the site's type, and the
 * two that show real slicer output, a preview to switch between set-ups and a table of numbers.
 * Both read the ready-made slices (`lib/training/practiceSlices.ts`).
 */

const BED = PRACTICE_WORKSPACE.profiles.printers[0]!.bed

export function P({ children }: { children: ReactNode }) {
  return <p className="text-dim mb-4 text-[15px] leading-[1.7] text-pretty">{children}</p>
}

export function H({ children }: { children: ReactNode }) {
  return <h2 className="mt-8 mb-3 text-[17px] font-semibold tracking-[-0.01em]">{children}</h2>
}

/** A setting or control, named the way the screen names it. */
export function Name({ children }: { children: ReactNode }) {
  return <strong className="text-base-content font-semibold">{children}</strong>
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="border-rule bg-base-200 text-base-content inline-block border px-1.5 py-px font-mono text-[12px] leading-[1.4]">
      {children}
    </kbd>
  )
}

export function List({ children, ordered = false }: { children: ReactNode; ordered?: boolean }) {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag
      className={`text-dim mb-4 space-y-2 pl-5 text-[15px] leading-[1.65] text-pretty ${
        ordered ? 'list-decimal marker:font-mono marker:text-[12px]' : 'list-disc marker:text-faint'
      }`}
    >
      {children}
    </Tag>
  )
}

/** A setting and what it does, one per row. */
export function Terms({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="divide-rule border-rule mb-5 divide-y border-y">
      {items.map(([term, meaning], index) => (
        <div key={index} className="grid grid-cols-1 gap-x-5 gap-y-0.5 py-2.5 wide:grid-cols-[11rem_minmax(0,1fr)]">
          <dt className="text-base-content text-[14px] font-semibold">{term}</dt>
          <dd className="text-dim text-[14px] leading-[1.6] text-pretty">{meaning}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Something that commonly goes wrong. */
export function Careful({ children }: { children: ReactNode }) {
  return (
    <div className="border-primary/35 bg-primary/5 mb-5 border-l-2 px-4 py-3 text-[14px] leading-[1.6] text-pretty">
      {children}
    </div>
  )
}

const figures = (slice: { grams: number; seconds: number; layers: number | null }) =>
  `${slice.grams.toFixed(1)} g · ${duration(slice.seconds)}${slice.layers ? ` · ${String(slice.layers)} layers` : ''}`

/**
 * One part sliced several ways, to switch between and turn around. `focus` must be a constant:
 * the view is rebuilt when it changes.
 */
export function PreviewCompare({
  options,
  focus,
  caption,
}: {
  options: { name: string; label: string }[]
  focus: Focus
  caption: ReactNode
}) {
  const [chosen, setChosen] = useState(options[0]!.name)
  const preview = useLessonPreview(chosen)
  const manifest = useManifest()
  const slice = manifest && manifest !== 'failed' ? manifest.slices[chosen] : undefined

  return (
    <figure className="my-6">
      <div role="group" aria-label="Sliced with" className="mb-2 flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.name}
            type="button"
            aria-pressed={chosen === option.name}
            onClick={() => {
              setChosen(option.name)
            }}
            className={`min-h-11 cursor-pointer border px-3 font-mono text-[11px] font-semibold tracking-[0.08em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary wide:min-h-8 ${
              chosen === option.name
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-rule text-dim hover:text-base-content'
            }`}
          >
            {option.label.toUpperCase()}
          </button>
        ))}
      </div>
      {/* Shorter on a phone, where a drag on it turns the view instead of scrolling the page. */}
      <div className="border-rule bg-base-100 relative h-[min(24rem,55svh)] border">
        {preview.status === 'ready' ? (
          <PreviewView key={chosen} bed={BED} preview={preview.preview} grams={slice?.grams ?? null} focus={focus} legend={false} />
        ) : (
          <div className="flex h-full items-center justify-center p-6" aria-busy={preview.status === 'loading'}>
            <p className="text-dim text-[13px]">
              {preview.status === 'failed' ? `This preview didn't load. Try another, or reload the page.` : 'Loading the preview…'}
            </p>
          </div>
        )}
      </div>
      <p role="status" className="text-base-content mt-2 font-mono text-[12px] tracking-[0.06em]">
        {slice ? figures(slice) : ' '}
      </p>
      <figcaption className="text-faint mt-1 text-[12.5px] leading-[1.55] text-pretty">{caption}</figcaption>
    </figure>
  )
}

/** What Orca said for the same part sliced several ways. */
export function SliceNumbers({ rows, caption }: { rows: { name: string; label: string }[]; caption: ReactNode }) {
  const manifest = useManifest()
  return (
    <figure className="my-6">
      <table className="w-full max-w-[34rem] text-left text-[14px]">
        <thead>
          <tr className="border-rule text-faint border-b font-mono text-[10px] tracking-[0.14em]">
            <th className="py-2 pr-3 font-medium">SLICED WITH</th>
            <th className="py-2 pr-3 text-right font-medium">PLASTIC</th>
            <th className="py-2 pr-3 text-right font-medium">TIME</th>
            <th className="py-2 text-right font-medium">LAYERS</th>
          </tr>
        </thead>
        <tbody className="divide-rule divide-y">
          {rows.map((row) => {
            const slice = manifest && manifest !== 'failed' ? manifest.slices[row.name] : undefined
            return (
              <tr key={row.name}>
                <td className="text-base-content py-2 pr-3">{row.label}</td>
                <td className="text-dim py-2 pr-3 text-right font-mono tabular-nums">{slice ? `${slice.grams.toFixed(1)} g` : '—'}</td>
                <td className="text-dim py-2 pr-3 text-right font-mono tabular-nums">{slice ? duration(slice.seconds) : '—'}</td>
                <td className="text-dim py-2 text-right font-mono tabular-nums">{slice?.layers ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <figcaption className="text-faint mt-2 max-w-[34rem] text-[12.5px] leading-[1.55] text-pretty">
        {manifest === 'failed' ? `The numbers didn't load. ` : ''}
        {caption}
      </figcaption>
    </figure>
  )
}
