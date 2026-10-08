import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from '../core/env.js'
import { ArchiveError, readSlicedProject } from './sliceArchive.js'
import { PreviewError, buildPreview } from './gcodePreview.js'
import { type ProjectHeader, readProjectHeader, writeProject } from './orcaProject.js'
import { type FitProblem, fitProblem, placementAffine } from './plateTransform.js'
import { type ApprovedProfiles, profilesDir } from './profiles.js'
import { MATERIAL_FILES, orcaOverrides } from './processSettings.js'
import { runProcess } from './runProcess.js'
import type { ClaimedSlice, SliceOutput } from './sliceJobs.js'
import { triangleCount, writeBinaryStl } from './stl.js'

/**
 * Running OrcaSlicer 2.4.2's command line for one plate.
 *
 * Two runs. The first loads the approved profiles plus the member's settings onto a small cube
 * and exports a project without slicing: Orca won't slice a project with no settings in it, and
 * given a project and presets together it merges them by its own rules. That project's settings
 * go into the plate's project, which the second run slices with arranging and orienting off, so
 * every copy stays exactly where the member put it.
 *
 * Every message a member can see is written here. Orca's own output goes to the worker's log.
 */

export interface SliceFailure {
  failure: string
  retryable: boolean
  /** Orca crashed rather than refused; worth one more go. */
  transient?: boolean
  detail?: string
}

export const FAILURES = {
  offPlate: 'Part of the plate hangs off the bed. Move it back on.',
  tooTall: 'Something on the plate is taller than the printer can print.',
  noGo: "Something sits in the bed's back corner, where the printer purges. Move it out.",
  doesntFit:
    "Orca couldn't fit everything on one plate. Spread the copies out or remove some.",
  tooDetailed: 'The plate is too detailed to slice. Use fewer copies or a simpler model.',
  tooSlow: 'Slicing took too long. Use fewer copies or a simpler model.',
  needsSupports: 'Part of the model starts in mid-air. Turn supports on or lay it flat.',
  unreadable: "Orca couldn't read one of the models.",
  vase: 'Vase mode prints one object at a time. Remove the other copies or turn it off.',
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

  constructor(
    private readonly profiles: ApprovedProfiles,
    private readonly scratchRoot: string,
    readonly version: string,
  ) {}

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

  private async header(
    spec: ClaimedSlice['spec'],
    dirs: Awaited<ReturnType<OrcaRunner['jobDir']>>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<ProjectHeader | SliceFailure> {
    const overrides = orcaOverrides(spec.overrides)
    const key = JSON.stringify([spec.material, spec.preset, overrides])
    const cached = this.headers.get(key)
    if (cached) return cached

    const processProfile = {
      ...(JSON.parse(this.profiles.presets[spec.preset]) as object),
      ...overrides,
    }
    const processFile = join(dirs.header, 'process.json')
    const cubeFile = join(dirs.header, 'cube.stl')
    await writeFile(processFile, JSON.stringify(processProfile))
    await writeFile(cubeFile, cube())

    const run = await runProcess(
      env.ORCA_BINARY,
      [
        '--datadir',
        dirs.data,
        '--load-settings',
        `${processFile};${join(profilesDir, this.profiles.manifest.printer.file)}`,
        '--load-filaments',
        join(profilesDir, MATERIAL_FILES[spec.material]),
        '--outputdir',
        dirs.header,
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
    const result = await this.orcaResult(dirs.header)
    if (run.code !== 0 || !result || result.code !== 0) {
      return {
        failure: run.timedOut ? FAILURES.tooSlow : FAILURES.setup,
        retryable: true,
        transient: !result && !run.timedOut,
        detail: `settings run: exit ${String(run.code)}, ${JSON.stringify(result)}\n${run.stderr.slice(-2000)}`,
      }
    }
    const header = readProjectHeader(
      new Uint8Array(await readFile(join(dirs.header, 'header.3mf'))),
    )
    if (this.headers.size > 64) this.headers.clear()
    this.headers.set(key, header)
    return header
  }

  async slice(
    job: ClaimedSlice,
    meshes: Map<string, Float32Array>,
    deadline: number,
    signal?: AbortSignal,
  ): Promise<SliceOutput | SliceFailure> {
    const { spec } = job
    const bed = this.profiles.manifest.printer.bed

    if (spec.overrides['spiral_mode'] === true && spec.objects.length > 1) {
      return { failure: FAILURES.vase, retryable: false }
    }

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
      const header = await this.header(spec, dirs, left(), signal)
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
          this.profiles.manifest.presets[spec.preset].values['enable_support']) === true
      if (run.timedOut) return { failure: FAILURES.tooSlow, retryable: false }
      if (!result) {
        return {
          failure: FAILURES.failed,
          retryable: true,
          transient: true,
          detail: `slice run crashed: exit ${String(run.code)}\n${run.stderr.slice(-2000)}`,
        }
      }
      if (run.code !== 0 || result.code !== 0) {
        return {
          ...orcaFailure(result.code, supportsOn),
          detail: `slice run: exit ${String(run.code)}, ${JSON.stringify(result)}`,
        }
      }

      const output = new Uint8Array(await readFile(join(dirs.out, 'rccf.3mf')))
      const manifest = this.profiles.manifest
      let summary
      try {
        summary = readSlicedProject(output, {
          objects: placed.length,
          meshes: modelOrder.length,
          printer: manifest.printer.preset,
          process: manifest.presets[spec.preset].preset,
          filament: manifest.materials[spec.material].preset,
          bedType: manifest.printer.bedType,
          overrides: orcaOverrides(spec.overrides),
        })
      } catch (error) {
        if (!(error instanceof ArchiveError)) throw error
        return error.reason === 'doesntFit'
          ? { failure: FAILURES.doesntFit, retryable: false, detail: error.message }
          : { failure: FAILURES.setup, retryable: true, detail: error.message }
      }

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
