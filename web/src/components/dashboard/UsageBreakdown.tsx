import { useState } from 'react'
import { grams } from '../../lib/printing'
import type { BreakdownBy, BreakdownRow } from '../../lib/printUsage'
import { FilterChips } from '../shared/FilterChips'

type SortKey = 'name' | 'prints' | 'grams'

const BY = [
  { value: 'project', label: 'PROJECT' },
  { value: 'filament', label: 'FILAMENT' },
] as const

/**
 * The range's totals by project, personal prints as one row, or by filament, most grams first.
 * A heading sorts by its column and pressing it again reverses it. A row's name filters the page
 * to it. The bar under each name is that row's grams against the biggest row's.
 */
export function UsageBreakdown({
  rows,
  onPick,
}: {
  rows: Record<BreakdownBy, BreakdownRow[]>
  onPick: (by: BreakdownBy, key: string) => void
}) {
  const [by, setBy] = useState<BreakdownBy>('project')
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
    key: 'grams',
    descending: true,
  })

  const compare = (a: BreakdownRow, b: BreakdownRow) =>
    sort.key === 'name' ? a.name.localeCompare(b.name) : a[sort.key] - b[sort.key]
  const sorted = [...rows[by]].sort(
    (a, b) => (sort.descending ? -1 : 1) * compare(a, b) || a.name.localeCompare(b.name),
  )
  const top = Math.max(0, ...sorted.map((row) => row.grams))
  const cell = 'text-dim py-2 pl-2 text-right align-top font-mono whitespace-nowrap tabular-nums wide:pl-3'

  // Names read A to Z first, numbers biggest first.
  const sortBy = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, descending: !current.descending }
        : { key, descending: key !== 'name' },
    )
  }

  const heading = (key: SortKey, label: string) => (
    <th
      aria-sort={sort.key === key ? (sort.descending ? 'descending' : 'ascending') : undefined}
      className={`py-2 font-medium ${key === 'name' ? 'pr-2 wide:pr-3' : 'pl-2 text-right wide:pl-3'}`}
    >
      <button
        type="button"
        onClick={() => {
          sortBy(key)
        }}
        className={`hover:text-primary focus-visible:outline-primary min-h-11 cursor-pointer tracking-[0.14em] focus-visible:outline-2 focus-visible:outline-offset-2 wide:min-h-0 ${
          sort.key === key ? 'text-base-content' : ''
        }`}
      >
        {label}
        {sort.key === key && <span aria-hidden="true"> {sort.descending ? '↓' : '↑'}</span>}
      </button>
    </th>
  )

  return (
    <section className="mt-8 max-w-[44rem]">
      <FilterChips label="TOTALS BY" options={BY} value={by} onChange={setBy} />

      <table className="mt-3 w-full text-left text-[12px] wide:text-[13px]">
        <caption className="sr-only">Filament by {by}</caption>
        <thead>
          <tr className="border-rule text-faint border-b font-mono text-[10px]">
            {heading('name', by === 'project' ? 'PROJECT' : 'FILAMENT')}
            {heading('prints', 'PRINTS')}
            {heading('grams', 'GRAMS')}
          </tr>
        </thead>
        <tbody className="divide-rule divide-y">
          {sorted.map((row) => (
            <tr key={row.key}>
              <th scope="row" className="w-full py-2 pr-2 font-normal wide:pr-3">
                <button
                  type="button"
                  title={`Show only ${row.name}`}
                  onClick={() => {
                    onPick(by, row.key)
                  }}
                  className="text-base-content hover:text-primary focus-visible:outline-primary min-h-11 cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-2 wide:min-h-0"
                >
                  {row.name}
                </button>
                <div
                  aria-hidden="true"
                  className={`bg-primary/55 mt-1 h-1 rounded-[2px] ${row.grams > 0 ? 'min-w-0.5' : ''}`}
                  style={{ width: `${String(top > 0 ? (row.grams / top) * 100 : 0)}%` }}
                />
              </th>
              <td className={cell}>{row.prints}</td>
              <td className={`${cell} text-base-content`}>{grams(row.grams)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
