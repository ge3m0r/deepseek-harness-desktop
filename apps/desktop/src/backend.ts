/** Managed `dsh web` child process used by the desktop application. */

import { spawn, type ChildProcessByStdio } from 'node:child_process'
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Readable } from 'node:stream'

/** Maximum time allowed for the Web profile to publish its readiness URL. */
export const BACKEND_START_TIMEOUT_MS = 30_000
/** Grace after SIGTERM before the desktop host force-terminates the child. */
export const BACKEND_STOP_TIMEOUT_MS = 7_000

const READY_PREFIX = 'dsh web: '

/** Resolve the installed dsh CLI entry from the desktop app's dependency tree. */
export function resolveCliBin(anchor: string = import.meta.url): string {
  const require = createRequire(anchor)
  const manifest = require.resolve('@deepseek-ai/dsh/package.json')
  return join(dirname(manifest), 'lib', 'bin.js')
}

/** Resolve the bundled better-sidebar patch from the desktop dependency tree. */
export function resolveSidebarPatch(anchor: string = import.meta.url): string {
  const require = createRequire(anchor)
  const manifest = require.resolve('dsh-better-sidebar/package.json')
  return join(dirname(manifest), 'cordis.patch.yml')
}

/** Maintain the profile-level module fallback for the desktop-owned plugin. */
export function ensureSidebarFallback(
  home: string = process.env.DSH_HOME ?? join(homedir(), '.dsh'),
  anchor: string = import.meta.url,
): void {
  const target = dirname(createRequire(anchor).resolve('dsh-better-sidebar/package.json'))
  const link = join(home, 'profiles', 'node_modules', 'dsh-better-sidebar')
  mkdirSync(dirname(link), { recursive: true })
  if (existsSync(link) || lstatOrUndefined(link)?.isSymbolicLink() === true) {
    const info = lstatSync(link)
    if (!info.isSymbolicLink()) throw new Error(`desktop sidebar fallback is not a symbolic link: ${link}`)
    if (readlinkSync(link) === target) return
    unlinkSync(link)
  }
  symlinkSync(target, link, 'junction')
}

function lstatOrUndefined(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

/** Return whether the Web profile already mounts better-sidebar itself. */
export function profileIncludesSidebar(home: string = process.env.DSH_HOME ?? join(homedir(), '.dsh')): boolean {
  const profileDir = join(home, 'profiles', 'web')
  const manifestPath = join(profileDir, 'package.json')
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dsh?: { profile?: { bundles?: unknown } } }
    const bundles = manifest.dsh?.profile?.bundles
    if (Array.isArray(bundles) && bundles.includes('dsh-better-sidebar')) return true
  }
  const patchPath = join(profileDir, 'cordis.patch.yml')
  if (!existsSync(patchPath)) return false
  return /^\s*(?:-\s*)?name:\s*(['"]?)dsh-better-sidebar\1\s*(?:#.*)?$/mu.test(readFileSync(patchPath, 'utf8'))
}

/** Build Electron-as-Node arguments with launcher options before Web server options. */
export function resolveBackendArgs(
  home: string = process.env.DSH_HOME ?? join(homedir(), '.dsh'),
  anchor: string = import.meta.url,
): string[] {
  const args = ['--expose-internals', resolveCliBin(anchor), 'web']
  if (!profileIncludesSidebar(home)) args.push('--patch', resolveSidebarPatch(anchor))
  args.push('--host', '127.0.0.1', '--port', '0')
  return args
}

/**
 * Extract the loopback readiness URL from accumulated dsh output.
 * @param output - UTF-8 stdout accumulated across arbitrary stream chunks.
 * @returns The published loopback URL, or `undefined` before the complete line arrives.
 */
export function extractReadyUrl(output: string): string | undefined {
  const lines = output.split(/\r?\n/u)
  if (!/\r?\n$/u.test(output)) lines.pop()
  for (const line of lines) {
    if (!line.startsWith(READY_PREFIX)) continue
    const candidate = line.slice(READY_PREFIX.length).split(/\s/u, 1)[0]
    if (candidate === undefined) continue
    let url: URL
    try {
      url = new URL(candidate)
    } catch {
      continue
    }
    if (url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port !== '') return url.href
  }
  return undefined
}

/** Own one dsh Web child from spawn through quiescent shutdown. */
export class DesktopBackend {
  private child: ChildProcessByStdio<null, Readable, Readable> | undefined
  private stopping: Promise<void> | undefined

  /**
   * Start the loopback Web profile and wait for its readiness line.
   * @returns The exact local URL published by the Web application.
   */
  async start(): Promise<string> {
    if (this.child !== undefined) throw new Error('desktop backend already started')
    ensureSidebarFallback()
    const child = spawn(process.execPath, resolveBackendArgs(), {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    child.stderr.pipe(process.stderr)

    return await new Promise<string>((resolve, reject) => {
      let output = ''
      let settled = false
      const finish = (result: { url: string } | { error: Error }): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        child.off('error', onError)
        child.off('exit', onExit)
        child.stdout.off('data', onData)
        if ('url' in result) resolve(result.url)
        else reject(result.error)
      }
      const onData = (chunk: Buffer): void => {
        process.stdout.write(chunk)
        output = (output + chunk.toString('utf8')).slice(-16_384)
        const url = extractReadyUrl(output)
        if (url !== undefined) finish({ url })
      }
      const onError = (error: Error): void => { finish({ error }) }
      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        const cause = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${String(code)}`
        finish({ error: new Error(`DeepSeek Harness backend exited before readiness (${cause})`) })
      }
      const timeout = setTimeout(() => {
        finish({ error: new Error(`DeepSeek Harness backend did not become ready within ${String(BACKEND_START_TIMEOUT_MS / 1000)} seconds`) })
      }, BACKEND_START_TIMEOUT_MS)
      child.stdout.on('data', onData)
      child.once('error', onError)
      child.once('exit', onExit)
    })
  }

  /**
   * Request graceful shutdown and wait for the child to exit; force termination
   * after the bounded grace. Concurrent calls join the same stop operation.
   */
  stop(): Promise<void> {
    if (this.stopping !== undefined) return this.stopping
    const child = this.child
    if (child === undefined || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
    this.stopping = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => { child.kill('SIGKILL') }, BACKEND_STOP_TIMEOUT_MS)
      child.once('exit', () => {
        clearTimeout(timeout)
        this.child = undefined
        resolve()
      })
      if (!child.kill('SIGTERM')) {
        clearTimeout(timeout)
        this.child = undefined
        resolve()
      }
    })
    return this.stopping
  }
}
