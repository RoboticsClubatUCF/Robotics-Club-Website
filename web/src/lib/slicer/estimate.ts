/** Orca's print time, the way the workspace and the queue say it: "2 h 14 min", "9 min". */
export function duration(seconds: number | null): string {
  if (seconds === null) return '?'
  const minutes = Math.max(1, Math.round(seconds / 60))
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${String(hours)} h ${String(minutes % 60)} min` : `${String(minutes)} min`
}

/** What MARK DONE charges by default: the estimate in whole grams, rounded up. */
export const chargedGrams = (estimate: number): number => Math.ceil(estimate)
