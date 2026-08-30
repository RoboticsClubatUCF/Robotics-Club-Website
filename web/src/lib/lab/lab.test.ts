import { describe, expect, it } from 'vitest'
import { CLOSES_AT, OPENS_AT } from './lab'

/**
 * The two labels against the two numbers they claim to describe.
 *
 * These packages cannot import from one another, so the server's
 * `BUILDING_OPENS_AT` / `BUILDING_CLOSES_AT` are restated here as the plain
 * hours and compared to the words the pages print. It is the same arrangement
 * as every hand-mirrored type in `lib/api/api.ts` — nothing enforces it, so
 * something has to check it.
 *
 * A sentence reading "shut between 10pm and 8am" while the server refuses from
 * nine is worse than no sentence at all: it is the site telling somebody they
 * have an hour they do not have. Changing the hours means changing this file
 * too, which is the point — the failure is what sends whoever moved them here.
 */

/** `BUILDING_OPENS_AT` and `BUILDING_CLOSES_AT` in `server/src/lab/labStatus.ts`. */
const SERVER_OPENS_AT = 8
const SERVER_CLOSES_AT = 22

/** The server's `hourLabel`, restated. */
const label = (hour: number) =>
  `${((hour + 11) % 12) + 1}${hour < 12 ? 'am' : 'pm'}`

describe('the building hours the pages print', () => {
  it('names the hour the server opens at', () => {
    expect(OPENS_AT).toBe(label(SERVER_OPENS_AT))
  })

  it('names the hour the server closes at', () => {
    expect(CLOSES_AT).toBe(label(SERVER_CLOSES_AT))
  })
})
