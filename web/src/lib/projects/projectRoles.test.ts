import { describe, expect, it } from 'vitest'
import { memberLabel } from './projectRoles'

describe('memberLabel', () => {
  it('names the project lead', () => {
    expect(memberLabel({ rank: 'PROJECT_LEAD', title: null, team: null })).toBe(
      'PROJECT LEAD',
    )
  })

  /** A team lead with no team named says almost nothing, and a `TEAM_LEAD`
      always has one — the server refuses the rank against a member without. */
  it('names a team lead with their team', () => {
    expect(
      memberLabel({
        rank: 'TEAM_LEAD',
        title: null,
        team: { name: 'Chassis' },
      }),
    ).toBe('TEAM LEAD — Chassis')
  })

  it('falls back to the bare rank when no team came through', () => {
    expect(memberLabel({ rank: 'TEAM_LEAD', title: null, team: null })).toBe('TEAM LEAD')
  })

  /**
   * Rank beats the typed title, and that is the point of the order. `rank` is the column every
   * permission on the project is decided by; `title` is free text that grants nothing. A member who
   * types "Software Lead" against their own name must not read as the project's lead beside
   * somebody who is.
   */
  it('prefers the rank over anything typed', () => {
    expect(
      memberLabel({ rank: 'PROJECT_LEAD', title: 'Software Lead', team: null }),
    ).toBe('PROJECT LEAD')
  })

  it('gives a plain member whatever they were called on this project', () => {
    expect(memberLabel({ rank: 'MEMBER', title: 'Software Lead', team: null })).toBe(
      'Software Lead',
    )
  })

  /** Null rather than "Member", so the row draws nothing instead of ending in
      the same word fifteen times down a roster. */
  it('says nothing about a plain member with no title', () => {
    expect(memberLabel({ rank: 'MEMBER', title: null, team: null })).toBeNull()
  })
})
