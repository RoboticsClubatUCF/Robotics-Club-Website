import { describe, expect, it } from 'vitest'
import type { ApiMyProject, ProjectMemberRank } from '../api/api'
import {
  canEditProject,
  editingAsOfficer,
  rankOn,
} from './projectEditing'

const on = (projectId: string, rank: ProjectMemberRank): ApiMyProject =>
  ({
    rank,
    title: null,
    team: null,
    project: { id: projectId },
  }) as ApiMyProject

describe('canEditProject', () => {
  it('lets the project lead of this project edit it', () => {
    expect(canEditProject('MEMBER', [on('p1', 'PROJECT_LEAD')], 'p1')).toBe(true)
  })

  /**
   * The two rows the server's matrix calls the point, mirrored. Leading one
   * project grants nothing on the next, and a team lead is not a project lead.
   */
  it('refuses the lead of a different project', () => {
    expect(canEditProject('MEMBER', [on('p2', 'PROJECT_LEAD')], 'p1')).toBe(false)
  })

  it('refuses a team lead of this project', () => {
    expect(canEditProject('MEMBER', [on('p1', 'TEAM_LEAD')], 'p1')).toBe(false)
  })

  it('refuses a plain member', () => {
    expect(canEditProject('MEMBER', [on('p1', 'MEMBER')], 'p1')).toBe(false)
  })

  /**
   * This used to pass `'PROJECT_LEAD'` and `'TEAM_LEAD'` as *club* roles — a
   * roster label spelled exactly like the rank that grants everything, and
   * granting nothing. They are not roles any more, so the trap cannot be set;
   * what is left is the stronger version, which is that being a club member in
   * good standing buys nothing on a project you are not on.
   */
  it('refuses a club member who is on no project at all', () => {
    expect(canEditProject('MEMBER', [], 'p1')).toBe(false)
    expect(canEditProject('GUEST', [], 'p1')).toBe(false)
  })

  it('lets officers and admins edit a project they are not on', () => {
    expect(canEditProject('OFFICER', [], 'p1')).toBe(true)
    expect(canEditProject('ADMIN', [], 'p1')).toBe(true)
    expect(canEditProject('OFFICER', null, 'p1')).toBe(true)
  })

  /** Nothing is granted while the membership list is still on the wire. */
  it('refuses everybody else until the list has landed', () => {
    expect(canEditProject('MEMBER', null, 'p1')).toBe(false)
  })
})

describe('editingAsOfficer', () => {
  it('is true for an officer with no lead rank here', () => {
    expect(editingAsOfficer('OFFICER', [], 'p1')).toBe(true)
    expect(editingAsOfficer('OFFICER', [on('p1', 'MEMBER')], 'p1')).toBe(true)
  })

  /** An officer who genuinely leads this project is acting as its lead. */
  it('is false for an officer who leads this project', () => {
    expect(editingAsOfficer('OFFICER', [on('p1', 'PROJECT_LEAD')], 'p1')).toBe(false)
  })

  it('is false for anybody who is not an officer', () => {
    expect(editingAsOfficer('MEMBER', [on('p1', 'PROJECT_LEAD')], 'p1')).toBe(false)
  })
})

describe('rankOn', () => {
  it('finds the rank held on one project, and only that one', () => {
    const mine = [on('p1', 'TEAM_LEAD'), on('p2', 'PROJECT_LEAD')]
    expect(rankOn(mine, 'p1')).toBe('TEAM_LEAD')
    expect(rankOn(mine, 'p2')).toBe('PROJECT_LEAD')
    expect(rankOn(mine, 'p3')).toBeNull()
    expect(rankOn(null, 'p1')).toBeNull()
  })
})
