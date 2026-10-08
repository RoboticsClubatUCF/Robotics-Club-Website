import { spawn } from 'node:child_process'

export interface RunResult {
  /** Null when it was killed. */
  code: number | null
  timedOut: boolean
  stdout: string
  stderr: string
}

/** What's kept of each stream: enough to log, not enough to fill memory with Orca's chatter. */
const TAIL = 64 * 1024

/**
 * Run a program with no shell, a deadline and a clean environment.
 *
 * The child leads its own process group so a timeout kills everything it started; Orca spawns
 * helpers, and killing only the parent leaves them holding the CPU. The group is killed again
 * after the child exits, for the same reason.
 */
export function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    timeoutMs: number
    signal?: AbortSignal
  },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    const keep = (current: string, chunk: Buffer) =>
      (current + chunk.toString()).slice(-TAIL)
    child.stdout.on('data', (chunk: Buffer) => (stdout = keep(stdout, chunk)))
    child.stderr.on('data', (chunk: Buffer) => (stderr = keep(stderr, chunk)))

    const killGroup = () => {
      if (child.pid === undefined) return
      try {
        if (process.platform === 'win32') child.kill('SIGKILL')
        else process.kill(-child.pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }

    const timer = setTimeout(() => {
      timedOut = true
      killGroup()
    }, options.timeoutMs)
    const onAbort = () => killGroup()
    options.signal?.addEventListener('abort', onAbort, { once: true })

    child.on('error', (error) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      killGroup()
      resolve({ code, timedOut, stdout, stderr })
    })
  })
}
