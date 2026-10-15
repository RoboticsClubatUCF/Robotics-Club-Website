import { roundGrams } from '../printing'
import { ROLES, type Role } from './preview'

/** Orca's print time, the way the workspace and the queue say it: "2 h 14 min", "9 min". */
export function duration(seconds: number | null): string {
  if (seconds === null) return '?'
  const minutes = Math.max(1, Math.round(seconds / 60))
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${String(hours)} h ${String(minutes % 60)} min` : `${String(minutes)} min`
}

/** What MARK DONE charges by default: the estimate to the hundredth of a gram. */
export const chargedGrams = (estimate: number): number => roundGrams(estimate)

/**
 * Orca's estimate shared out by the filament each kind of path extrudes in the G-code, so the
 * parts add up to the plate's figure. Null when either side is missing.
 */
export function gramsByRole(filament: Record<Role, number> | null, grams: number | null): Record<Role, number> | null {
  if (!filament || grams === null) return null
  const total = ROLES.reduce((sum, role) => sum + filament[role], 0)
  if (!(total > 0)) return null
  return Object.fromEntries(ROLES.map((role) => [role, (grams * filament[role]) / total])) as Record<Role, number>
}

/** A share of the estimate to a tenth of a gram, without calling a sliver nothing. */
export const roleGrams = (value: number): string => (value > 0 && value < 0.05 ? '<0.1 g' : `${value.toFixed(1)} g`)
