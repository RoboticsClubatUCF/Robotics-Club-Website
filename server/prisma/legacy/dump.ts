import { readFileSync } from 'node:fs'

/**
 * Reading a `pg_dump` file, because the old database is not running.
 *
 * The club's previous site was dumped to a `.sql` file and the server it ran on is gone, so there
 * is nothing to connect to and no second Prisma client to point at it. What there is, is 380KB of
 * `COPY … FROM stdin` blocks — a tab-separated format with a short and completely specified escape
 * scheme, cheaper to read directly than to restore a database in order to query it, and it makes
 * the import reproducible from a file in version control rather than from a machine somebody has to
 * keep alive.
 *
 * Only `COPY` is understood. `CREATE TABLE`, the `SET` preamble, sequences and constraints are
 * skipped — the destination schema already exists and nothing here is recreating the old one.
 */

/** A row, keyed by the column names the `COPY` header listed. `null` is `\N`. */
export type Row = Record<string, string | null>

export type Tables = Map<string, Row[]>

/**
 * `COPY public."Member" (id, "firstName", …) FROM stdin;`
 *
 * The table name is quoted for the mixed-case names the old Prisma schema produced and bare for
 * `_prisma_migrations`, so the quote is optional and matched either way. Column names inside the
 * parentheses are quoted individually and unevenly, which is why they are stripped one at a time
 * rather than by a regex over the whole list.
 */
const COPY_HEADER = /^COPY public\.("?)([A-Za-z_]+)\1 \(([^)]*)\) FROM stdin;$/

/**
 * The escapes `COPY … TO` writes, in the direction that undoes them.
 *
 * This is the whole set — Postgres emits exactly these, so a backslash followed by anything not
 * listed here is a literal backslash and that character. Order matters only in that `\\` has to be
 * handled inside the same pass rather than before it, or `\\n` (a literal backslash then an `n`)
 * would come back as a newline.
 */
const ESCAPES: Record<string, string> = {
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '\\': '\\',
}

function unescape(value: string): string {
  if (!value.includes('\\')) return value

  let out = ''

  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]!

    if (ch !== '\\' || i === value.length - 1) {
      out += ch
      continue
    }

    const next = value[i + 1]!
    const mapped = ESCAPES[next]

    if (mapped === undefined) {
      out += ch
      continue
    }

    out += mapped
    i += 1
  }

  return out
}

/** Every `COPY` block in a dump, keyed by table name. */
export function parseDump(path: string): Tables {
  const lines = readFileSync(path, 'utf8').split('\n')
  const tables: Tables = new Map()

  for (let i = 0; i < lines.length; i += 1) {
    const header = COPY_HEADER.exec(lines[i]!.replace(/\r$/, ''))

    if (!header) continue

    const table = header[2]!
    const columns = header[3]!.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
    const rows: Row[] = []

    i += 1

    // `\.` on a line of its own ends the block. A value containing that
    // sequence would have been escaped, so there is no ambiguity to guard.
    for (; i < lines.length; i += 1) {
      const line = lines[i]!.replace(/\r$/, '')

      if (line === '\\.') break

      const values = line.split('\t')
      const row: Row = {}

      for (let c = 0; c < columns.length; c += 1) {
        const raw = values[c]

        row[columns[c]!] = raw === undefined || raw === '\\N' ? null : unescape(raw)
      }

      rows.push(row)
    }

    tables.set(table, rows)
  }

  return tables
}

/**
 * A Postgres array literal — `{}`, `{None}`, `{"Mechanical Engineering ",Other}` — as a list of
 * strings.
 *
 * Written out rather than pulled from a library because the old survey stored five of its six
 * answers this way and the shapes are narrow: no nesting, no nulls, and quoting only where a value
 * contains a comma, a brace, a quote or leading whitespace. Values are not trimmed here — the old
 * form saved every option with a trailing space, and whether that matters is the mapping's decision
 * rather than the parser's.
 */
export function parseArray(literal: string | null): string[] {
  if (literal === null || literal === '' || literal === '{}') return []

  const inner = literal.startsWith('{') ? literal.slice(1, -1) : literal
  const out: string[] = []

  let current = ''
  let quoted = false

  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]!

    if (ch === '\\' && quoted && i + 1 < inner.length) {
      current += inner[i + 1]
      i += 1
      continue
    }

    if (ch === '"') {
      quoted = !quoted
      continue
    }

    if (ch === ',' && !quoted) {
      out.push(current)
      current = ''
      continue
    }

    current += ch
  }

  out.push(current)

  return out
}

/**
 * A `timestamp` column as a `Date`.
 *
 * The dump writes local wall-clock with no zone — `2026-05-31 00:00:00` — and the old database
 * stored UTC, so the `Z` is appended rather than left to the runtime's timezone. Without it the
 * same file imports differently on a machine in Orlando and one in London, and dues dates move by
 * five hours.
 */
export function parseTimestamp(value: string | null): Date | null {
  if (value === null || value === '') return null

  const parsed = new Date(`${value.replace(' ', 'T')}Z`)

  return Number.isNaN(parsed.getTime()) ? null : parsed
}
