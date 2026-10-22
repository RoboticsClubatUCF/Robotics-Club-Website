import type { ApiDeskProfile, ApiSlicerDesk, SlicerProfileKind } from '../api/api'
import type { StatusTone } from '../format/formats'

/**
 * What the profiles desk says about a profile. The worker fills in `info` once a profile is READY
 * (`server/src/printing/profileResolve.ts`), and its shape depends on the kind, so these read it
 * defensively and say nothing rather than something wrong.
 */

export const NOUN: Record<SlicerProfileKind, string> = {
  PRINTER: 'printer',
  PROCESS: 'process',
  FILAMENT: 'filament',
}

export function profileState(profile: ApiDeskProfile): { text: string; tone: StatusTone } {
  if (profile.state === 'QUEUED' || profile.state === 'RUNNING') return { text: 'CHECKING', tone: 'progress' }
  if (profile.state === 'FAILED') return { text: 'REFUSED', tone: 'bad' }
  return profile.offered ? { text: 'OFFERED', tone: 'good' } : { text: 'HIDDEN', tone: 'neutral' }
}

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)
const number = (value: unknown): number | null => (typeof value === 'number' ? value : null)

/** One line of facts: "Elegoo Centauri Carbon · 0.4 mm nozzle · 256 × 256 × 256 mm · Textured PEI Plate". */
export function profileFacts(profile: ApiDeskProfile): string {
  const info = profile.info ?? {}
  if (profile.kind === 'PRINTER') {
    const bed = (info['bed'] ?? {}) as Record<string, unknown>
    const [w, d, h] = [number(bed['width']), number(bed['depth']), number(bed['height'])]
    return [
      text(info['model']),
      number(info['nozzle']) === null ? null : `${String(info['nozzle'])} mm nozzle`,
      w && d && h ? `${String(w)} × ${String(d)} × ${String(h)} mm` : null,
      text(info['bedType']),
    ]
      .filter(Boolean)
      .join(' · ')
  }
  if (profile.kind === 'PROCESS') return text(info['summary']) ?? ''
  return [text(info['type']), text(info['vendor'])].filter(Boolean).join(' · ')
}

/** Why a READY, offered profile still isn't something a member can pick, or null. */
export function unreachable(profile: ApiDeskProfile, desk: ApiSlicerDesk): string | null {
  if (profile.state !== 'READY' || !profile.offered) return null
  if (profile.kind === 'PRINTER') {
    const printer = desk.printers.find((p) => p.id === profile.id)
    const usable = (list: ApiDeskProfile[] | undefined) => list?.some((p) => p.state === 'READY' && p.offered)
    if (!usable(printer?.processes)) return 'Members can’t pick it until one of its processes is offered.'
    if (!usable(printer?.filaments)) return 'Members can’t pick it until one of its filaments is offered.'
  }
  return null
}

/** Whether anything on the desk is still with the worker, so the page keeps asking. */
export const checking = (desk: ApiSlicerDesk): boolean =>
  desk.printers.flatMap((p) => [p, ...p.processes, ...p.filaments]).some(
    (profile) => profile.state === 'QUEUED' || profile.state === 'RUNNING',
  )

/** "3 drafts and 1 waiting request", or null for nothing. */
export function usesLine(uses: ApiDeskProfile['uses']): string | null {
  const parts = [
    uses.drafts > 0 ? `${String(uses.drafts)} ${uses.drafts === 1 ? 'draft' : 'drafts'}` : null,
    uses.sent > 0 ? `${String(uses.sent)} ${uses.sent === 1 ? 'request in the queue' : 'requests in the queue'}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' and ') : null
}
