import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from '../core/env.js'
import { ArchiveError, readSlicedProject } from './sliceArchive.js'
import { PreviewError, buildPreview } from './gcodePreview.js'
import { type ProjectHeader, readProjectHeader, writeProject } from './orcaProject.js'
import { type FitProblem, fitProblem, placementAffine } from './plateTransform.js'
import { orcaOverrides, vaseRefusal } from './processSettings.js'
import type { ProfileKind, StockProfiles } from './profileResolve.js'
import { markChangedSettings, stockParent } from './projectChanges.js'
import type { SliceProfiles } from './profiles.js'
import { runProcess } from './runProcess.js'
import type { ClaimedSlice, SliceOutput } from './sliceJobs.js'
import { triangleCount, writeBinaryStl } from './stl.js'

/**
 * Running OrcaSlicer 2.4.2's command line for one plate.
 *
 * Two runs. The first loads the plate's profiles plus the member's settings onto a small cube
 * and exports a project without slicing: Orca won't slice a project with no settings in it, and
 * given a project and presets together it merges them by its own rules. That project's settings
 * go into the plate's project, which the second run slices with arranging and orienting off, so
 * every copy stays exactly where the member put it. The result then gets the list of changed
 * settings desktop Orca needs to open it as sliced (`projectChanges.ts`).
 *
 * Every message a member can see is written here, except vase mode's, which the workspace and the
 * SLICE route give first (`vaseRefusal` in `processSettings.ts`). Orca's own output goes to the
 * worker's log.
 */

export interface SliceFailure {
  failure: string
  retryable: boolean
  /** Orca crashed rather than refused; worth one more go. */
  transient?: boolean
  detail?: string
  /** Orca's own error, for an officer testing a profile. Never shown to a member. */
  orca?: string
}

export const FAILURES = {
  offPlate: 'Part of the plate hangs off the bed. Move it back on.',
  tooTall: 'Something on the plate is taller than the printer can print.',
  noGo: 'Something sits where the printer keeps the bed clear. Move it out.',
  doesntFit:
    "Orca couldn't fit everything on one plate. Spread the copies out or remove some.",
  tooDetailed: 'The plate is too detailed to slice. Use fewer copies or a simpler model.',
  tooSlow: 'Slicing took too long. Use fewer copies or a simpler model.',
  needsSupports: 'Part of the model starts in mid-air. Turn supports on or lay it flat.',
  unreadable: "Orca couldn't read one of the models.",
  failed: 'Orca refused to slice this plate. Try different settings, or ask an officer.',
  setup: "The slicer isn't set up right. An officer has to look at it.",
} as const

const FIT: Record<FitProblem, string> = {
  offPlate: FAILURES.offPlate,
  tooTall: FAILURES.tooTall,
  noGo: FAILURES.noGo,
}

function orcaFailure(code: number, supportsOn: boolean): SliceFailure {
  switch (code) {
    case -6:
      return { failure: FAILURES.unreadable, retryable: false }
    case -21:
    case -50:
    case -52:
      return { failure: FAILURES.doesntFit, retryable: false }
    case -14:
    case -59:
      return { failure: FAILURES.tooDetailed, retryable: false }
    case -58:
      return { failure: FAILURES.tooSlow, retryable: false }
    case -100:
      // With supports off this is nearly always parts in mid-air ("empty layer between …").
      return supportsOn
        ? { failure: FAILURES.failed, retryable: false }
        : { failure: FAILURES.needsSupports, retryable: false }
    case -51:
    case -63:
    case -64:
    case -65:
    case -101:
    case -102:
      return { failure: FAILURES.failed, retryable: false }
    default:
      return { failure: FAILURES.setup, retryable: true }
  }
}

/** A 10 mm cube for the settings run. Orca needs something to load. */
function cube(): Uint8Array {
  const s = 10
  const v = [
    [0, 0, 0],
    [s, 0, 0],
    [s, s, 0],
    [0, s, 0],
    [0, 0, s],
    [s, 0, s],
    [s, s, s],
    [0, s, s],
  ] as const
  const faces = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ] as const
  return writeBinaryStl(
    Float32Array.from(faces.flatMap((face) => face.flatMap((i) => [...v[i]]))),
  )
}

export class OrcaRunner {
  private headers = new Map<string, ProjectHeader>()
  private parents = new Map<string, Promise<Record<string, unknown> | null>>()
  private stockHeaders = new Map<string, Record<string, unknown>>()

  constructor(
    private readonly scratchRoot: string,
    readonly version: string,
    private readonly stock: StockProfiles,
  ) {}

  /** A club profile, parsed, with the stock preset it was made from. */
  private async withParent(kind: ProfileKind, text: string) {
    const own = JSON.parse(text) as Record<string, unknown>
    const name = typeof own['inherits'] === 'string' ? own['inherits'] : ''
    const key = `${kind}:${name}`
    let parent = this.parents.get(key)
    if (!parent) {
      parent = stockParent(this.stock, kind, name)
      this.parents.set(key, parent)
    }
    return { own, parent: await parent }
  }

  /** The isolated environment each run gets: its own home, temp and data folders. */
  private async jobDir(name: string) {
    const root = join(this.scratchRoot, name)
    await rm(root, { recursive: true, force: true })
    const dirs = {
      root,
      in: join(root, 'in'),
      out: join(root, 'out'),
      header: join(root, 'header'),
      data: join(root, 'data'),
      home: join(root, 'home'),
      tmp: join(root, 'tmp'),
      xdg: join(root, 'xdg'),
    }
    for (const dir of Object.values(dirs))
      await mkdir(dir, { recursive: true, mode: 0o700 })
    return dirs
  }

  private orcaEnv(dirs: Awaited<ReturnType<OrcaRunner['jobDir']>>): NodeJS.ProcessEnv {
    return {
      PATH: process.env['PATH'] ?? '/usr/bin:/bin',
      LC_ALL: 'C',
      HOME: dirs.home,
      TMPDIR: dirs.tmp,
      XDG_RUNTIME_DIR: dirs.xdg,
    }
  }

  /** Orca's result file: both it and the exit code have to say 0. */
  private async orcaResult(
    outDir: string,
  ): Promise<{ code: number; message: string } | null> {
    try {
      const parsed = JSON.parse(await readFile(join(outDir, 'result.json'), 'utf8')) as {
        return_code?: number
        error_string?: string
      }
      return {
        code: Number(parsed.return_code ?? -1),
        message: String(parsed.error_string ?? ''),
      }
    } catch {
      return null
    }
  }

  /**
   * Orca's own project for a process, printer and filament, sliced onto nothing: every setting
   * written the way Orca writes it. Null with the run's details when Orca refused.
   */
  private async exportSettings(
    texts: { process: string; printer: string; filament: string },
    outDir: string,
    dirs: Awaited<ReturnType<OrcaRunner['jobDir']>>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<ProjectHeader | { run: Awaited<ReturnType<typeof runProcess>>; result: { code: number; message: string } | null }> {
    await mkdir(outDir, { recursive: true, mode: 0o700 })
    const processFile = join(outDir, 'process.json')
    const printerFile = join(outDir, 'printer.json')
    const filamentFile = join(outDir, 'filament.json')
    const cubeFile = join(outDir, 'cube.stl')
    await writeFile(processFile, texts.process)
    await writeFile(printerFile, texts.printer)
    await writeFile(filamentFile, texts.filament)
    await writeFile(cubeFile, cube())

    const run = await runProcess(
      env.ORCA_BINARY,
      [
        '--datadir',
        dirs.data,
        '--load-settings',
        `${processFile};${printerFile}`,
        '--load-filaments',
        filamentFile,
        '--outputdir',
        outDir,
        '--arrange',
        '1',
        '--orient',
        '0',
        '--export-3mf',
        'header.3mf',
        cubeFile,
      ],
      { cwd: dirs.root, env: this.orcaEnv(dirs), timeoutMs, signal },
    )
    const result = await this.orcaResult(outDir)
    if (run.code !== 0 || !result || result.code !== 0) return { run, result }
    return readProjectHeader(new Uint8Array(await readFile(join(outDir, 'header.3mf'))))
  }

  private async header(
    spec: ClaimedSlice['spec'],
    profiles: SliceProfiles,
    dirs: Awaited<ReturnType<OrcaRunner['jobDir']>>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<ProjectHeader | SliceFailure> {
    const overrides = orcaOverrides(spec.overrides)
    const key = JSON.stringify([
      spec.profiles.printer.sha256,
      spec.profiles.process.sha256,
      spec.profiles.filament.sha256,
      overrides,
    ])
    const cached = this.headers.get(key)
    if (cached) return cached

    const processText = JSON.stringify({
      ...(JSON.parse(profiles.process.text) as object),
      ...overrides,
    })
    const header = await this.exportSettings(
      { process: processText, printer: profiles.printer.text, filament: profiles.filament.text },
      dirs.header,
      dirs,
      timeoutMs,
      signal,
    )
    if ('run' in header) {
      const { run, result } = header
      return {
        failure: run.timedOut ? FAILURES.tooSlow : FAILURES.setup,
        retryable: true,
        transient: !result && !run.timedOut,
        detail: `settings run: exit ${String(run.code)}, ${JSON.stringify(result)}
${run.stderr.slice(-2000)}`,
        orca: result?.message,
      }
    }
    if (this.headers.size > 64) this.headers.clear()
    this.headers.set(key, header)
    return header
  }

  /**
   * What desktop Orca compares a project against: the stock presets the club's were made from,
   * every key filled in and written by Orca itself, so a setting Orca stores differently from the
   * stock file (a one-value list it keeps as two) doesn't read as changed. When Orca won't export
   * the stock presets, the stock files themselves, which only ever name too much.
   */
  private async stockSettings(
    parents: Record<'process' | 'printer' | 'filament', Record<string, unknown> | null>,
    bedType: string,
    dirs: Awaited<ReturnType<OrcaRunner['jobDir']>>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown> | null> {
    const { process, printer, filament } = parents
    if (!process || !printer || !filament) return null
    const key = JSON.stringify([process['inherits'], printer['inherits'], filament['inherits'], bedType])
    const cached = this.stockHeaders.get(key)
    if (cached) return cached

    const named = (profile: Record<string, unknown>) => ({ ...profile, name: profile['inherits'] })
    const header = await this.exportSettings(
      {
        process: JSON.stringify({ ...named(process), curr_bed_type: bedType }),
        printer: JSON.stringify(named(printer)),
        filament: JSON.stringify(named(filament)),
      },
      join(dirs.root, 'stock'),
      dirs,
      timeoutMs,
      signal,
    )
    if ('run' in header) {
      console.warn(`slicer: stock settings run failed: ${JSON.stringify(header.result)}`)
      return null
    }
    const settings = JSON.parse(header.settings) as Record<string, unknown>
    if (this.stockHeaders.size > 64) this.stockHeaders.clear()
    this.stockHeaders.set(key, settings)
    return settings
  }

  async slice(
    job: ClaimedSlice,
    profiles: SliceProfiles,
    meshes: Map<string, Float32Array>,
    deadline: number,
    signal?: AbortSignal,
  ): Promise<SliceOutput | SliceFailure> {
    const { spec } = job
    const bed = profiles.printer.info.bed

    // Orca would refuse it as a broken setup, or slice something other than what was asked.
    const vase = vaseRefusal(profiles.process.info.values, spec.overrides, spec.objects.length)
    if (vase) return { failure: vase, retryable: false }

    let triangles = 0
    const placed = []
    for (const [index, object] of spec.objects.entries()) {
      const positions = meshes.get(object.modelId)
      if (!positions) return { failure: FAILURES.unreadable, retryable: false }
      const affine = placementAffine(positions, object)
      const problem = fitProblem(positions, affine, bed)
      if (problem) return { failure: FIT[problem], retryable: false }
      triangles += triangleCount(positions)
      placed.push({
        name: `${object.name} #${String(index + 1)}`,
        modelId: object.modelId,
        affine,
      })
    }
    if (triangles > env.PRINT_PLATE_MAX_TRIANGLES) {
      return { failure: FAILURES.tooDetailed, retryable: false }
    }

    const dirs = await this.jobDir(`job-${job.id}-${job.leaseToken}`)
    try {
      const left = () => Math.max(1_000, deadline - Date.now())
      const header = await this.header(spec, profiles, dirs, left(), signal)
      if ('failure' in header) return header

      const modelOrder = [...new Set(placed.map((object) => object.modelId))]
      await writeProject(join(dirs.in, 'plate.3mf'), {
        meshes: modelOrder.map((id) => ({ positions: meshes.get(id)! })),
        objects: placed.map((object) => ({
          name: object.name,
          mesh: modelOrder.indexOf(object.modelId),
          affine: object.affine,
        })),
        header,
      })

      const run = await runProcess(
        env.ORCA_BINARY,
        [
          '--datadir',
          dirs.data,
          '--outputdir',
          dirs.out,
          '--arrange',
          '0',
          // The bare flag only turns rotation on; arranging off still needs it said.
          '--allow-rotations=0',
          '--orient',
          '0',
          '--mstpp',
          String(Math.max(10, Math.floor(left() / 1000))),
          '--slice',
          '0',
          '--export-3mf',
          'rccf.3mf',
          join(dirs.in, 'plate.3mf'),
        ],
        { cwd: dirs.root, env: this.orcaEnv(dirs), timeoutMs: left(), signal },
      )
      const result = await this.orcaResult(dirs.out)
      const supportsOn =
        (spec.overrides['enable_support'] ??
          profiles.process.info.values['enable_support']) === true
      if (run.timedOut) return { failure: FAILURES.tooSlow, retryable: false }
      if (!result) {
        return {
          failure: FAILURES.failed,
          retryable: true,
          transient: true,
          detail: `slice run crashed: exit ${String(run.code)}\n${run.stderr.slice(-2000)}`,
          // A bad setting usually crashes Orca rather than being refused, and says which here.
          orca: /what\(\):\s*(.+)/.exec(run.stderr)?.[1]?.trim(),
        }
      }
      if (run.code !== 0 || result.code !== 0) {
        return {
          ...orcaFailure(result.code, supportsOn),
          detail: `slice run: exit ${String(run.code)}, ${JSON.stringify(result)}`,
          orca: result.message,
        }
      }

      let output = new Uint8Array(await readFile(join(dirs.out, 'rccf.3mf')))
      let summary
      try {
        summary = readSlicedProject(output, {
          objects: placed.length,
          meshes: modelOrder.length,
          printer: profiles.printer.name,
          process: profiles.process.name,
          filament: profiles.filament.name,
          bedType: profiles.printer.info.bedType,
          overrides: orcaOverrides(spec.overrides),
        })
      } catch (error) {
        if (!(error instanceof ArchiveError)) throw error
        return error.reason === 'doesntFit'
          ? { failure: FAILURES.doesntFit, retryable: false, detail: error.message }
          : { failure: FAILURES.setup, retryable: true, detail: error.message, orca: error.message }
      }

      const processPreset = await this.withParent('PROCESS', profiles.process.text)
      const filament = await this.withParent('FILAMENT', profiles.filament.text)
      const printer = await this.withParent('PRINTER', profiles.printer.text)
      const stockSettings = await this.stockSettings(
        { process: processPreset.parent, printer: printer.parent, filament: filament.parent },
        profiles.printer.info.bedType,
        dirs,
        left(),
        signal,
      )
      output = markChangedSettings(output, {
        process: { ...processPreset, extra: Object.keys(orcaOverrides(spec.overrides)) },
        filament,
        printer,
        stock: stockSettings,
      })

      let preview: Uint8Array | null = null
      let previewFailure: string | null = null
      let layerCount: number | null = null
      try {
        const built = buildPreview(summary.gcode, bed, {
          maxSegments: 4_000_000,
          maxBytes: env.PRINT_PREVIEW_MAX_MB * 1024 * 1024,
        })
        preview = built.bytes
        layerCount = built.layers
      } catch (error) {
        if (!(error instanceof PreviewError)) throw error
        previewFailure = error.message
      }

      return {
        output,
        outputName: 'plate.3mf',
        preview,
        previewFailure,
        layerCount,
        grams: summary.grams,
        seconds: summary.seconds,
        meters: summary.meters,
        orcaVersion: this.version,
      }
    } finally {
      await rm(dirs.root, { recursive: true, force: true })
    }
  }
}

/** The version Orca reports, from `--help`'s first line. */
export async function orcaVersion(
  binary: string,
  scratch: string,
): Promise<string | null> {
  const home = join(scratch, 'version-check')
  await mkdir(home, { recursive: true, mode: 0o700 })
  try {
    const run = await runProcess(binary, ['--help'], {
      cwd: home,
      env: {
        PATH: process.env['PATH'] ?? '/usr/bin:/bin',
        LC_ALL: 'C',
        HOME: home,
        TMPDIR: home,
      },
      timeoutMs: 30_000,
    })
    return /^OrcaSlicer-([\w.]+):/m.exec(run.stdout)?.[1] ?? null
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}
