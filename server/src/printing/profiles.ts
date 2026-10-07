import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { PrintMaterial, PrintPreset } from '../generated/prisma/enums.js'

/**
 * The approved Orca profiles in `orca/profiles/`, built by `orca/resolve-profiles.ts`.
 *
 * The API reads the manifest to tell the workspace what the presets are and how big the bed is.
 * The worker also checks every file's hash before it will slice, so a hand-edited profile can't
 * reach the printer.
 */

export const profilesDir = fileURLToPath(new URL('../../orca/profiles/', import.meta.url))

const fileEntry = z.object({ file: z.string(), preset: z.string(), sha256: z.string() })

const manifestPreset = fileEntry.extend({
  label: z.string(),
  description: z.string(),
  values: z.record(z.string(), z.union([z.number(), z.boolean(), z.string()])),
})

const manifestSchema = z.object({
  orcaVersion: z.string(),
  profileSetHash: z.string(),
  printer: fileEntry.extend({
    model: z.string(),
    nozzle: z.number(),
    bedType: z.string(),
    bed: z.object({
      width: z.number(),
      depth: z.number(),
      height: z.number(),
      exclude: z
        .object({ minX: z.number(), minY: z.number(), maxX: z.number(), maxY: z.number() })
        .nullable(),
    }),
    layerHeight: z.object({ min: z.number(), max: z.number() }),
  }),
  presets: z.object({ STANDARD: manifestPreset, Q: manifestPreset, QS: manifestPreset }),
  materials: z.object({ PLA: fileEntry, PETG: fileEntry }),
})

export type SliceManifest = z.infer<typeof manifestSchema>

let cached: SliceManifest | null | undefined

/** The manifest, or null when it's missing or unreadable, which turns slicing off. */
export function sliceManifest(): SliceManifest | null {
  if (cached !== undefined) return cached
  try {
    cached = manifestSchema.parse(
      JSON.parse(readFileSync(`${profilesDir}manifest.json`, 'utf8')),
    )
  } catch (error) {
    console.error('slicer: the approved profiles manifest could not be read', error)
    cached = null
  }
  return cached
}

/** Checked with line endings folded, so a CRLF checkout on Windows still matches. */
export const profileHash = (text: string): string =>
  createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex')

export interface ApprovedProfiles {
  manifest: SliceManifest
  printer: string
  presets: Record<PrintPreset, string>
  materials: Record<Extract<PrintMaterial, 'PLA' | 'PETG'>, string>
}

/** Every profile's text, each checked against its hash. Throws on the first mismatch. */
export function loadApprovedProfiles(manifest: SliceManifest): ApprovedProfiles {
  const read = (entry: { file: string; sha256: string }) => {
    const text = readFileSync(`${profilesDir}${entry.file}`, 'utf8')
    if (profileHash(text) !== entry.sha256) {
      throw new Error(`${entry.file} doesn't match the approved profiles manifest`)
    }
    return text
  }
  return {
    manifest,
    printer: read(manifest.printer),
    presets: {
      STANDARD: read(manifest.presets.STANDARD),
      Q: read(manifest.presets.Q),
      QS: read(manifest.presets.QS),
    },
    materials: { PLA: read(manifest.materials.PLA), PETG: read(manifest.materials.PETG) },
  }
}

/** What the workspace is told: names and numbers, never file names or hashes. */
export function workspaceProfiles(manifest: SliceManifest) {
  const preset = (key: PrintPreset) => ({
    key,
    label: manifest.presets[key].label,
    name: manifest.presets[key].preset,
    description: manifest.presets[key].description,
    values: manifest.presets[key].values,
  })
  return {
    printer: {
      name: manifest.printer.preset,
      model: manifest.printer.model,
      nozzle: manifest.printer.nozzle,
      bedType: manifest.printer.bedType,
    },
    bed: manifest.printer.bed,
    layerHeight: manifest.printer.layerHeight,
    presets: [preset('STANDARD'), preset('Q'), preset('QS')],
    materials: [
      { key: 'PLA' as const, name: manifest.materials.PLA.preset },
      { key: 'PETG' as const, name: manifest.materials.PETG.preset },
    ],
  }
}
