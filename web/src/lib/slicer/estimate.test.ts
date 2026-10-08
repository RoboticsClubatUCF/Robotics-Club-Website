import { describe, expect, it } from 'vitest'
import { gramsByRole, roleGrams } from './estimate'

const filament = { outerWall: 200, innerWall: 300, sparseInfill: 400, solidInfill: 100, support: 0, other: 0 }

describe('gramsByRole', () => {
  it('shares the estimate out by the filament each kind of path extrudes', () => {
    const shares = gramsByRole(filament, 30)!
    expect(shares.outerWall).toBeCloseTo(6)
    expect(shares.sparseInfill).toBeCloseTo(12)
    expect(shares.support).toBe(0)
    expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBeCloseTo(30)
  })

  it('gives nothing without an estimate, without counts, or with no filament at all', () => {
    expect(gramsByRole(filament, null)).toBeNull()
    expect(gramsByRole(null, 30)).toBeNull()
    expect(gramsByRole({ ...filament, outerWall: 0, innerWall: 0, sparseInfill: 0, solidInfill: 0 }, 30)).toBeNull()
  })
})

describe('roleGrams', () => {
  it('says a share to a tenth of a gram, and a sliver as under one', () => {
    expect(roleGrams(12.34)).toBe('12.3 g')
    expect(roleGrams(0.04)).toBe('<0.1 g')
    expect(roleGrams(0)).toBe('0.0 g')
  })
})
