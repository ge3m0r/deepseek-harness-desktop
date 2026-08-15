/**
 * Durable dynamic Plugin definitions. Runtime fibers, pending approvals, and
 * authorization decisions never enter this file.
 * @module @deepseek-ai/dsh-cordis-host-runner/persistence
 */

import { randomBytes } from 'node:crypto'
import {
  closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { z } from 'zod'
import type {
  CordisDynamicPackageId, CordisDynamicPluginId,
} from './types.ts'
import type { DynamicCordisPlugin } from './registry.ts'

const FORMAT_VERSION = 1

const packageSchema = z.object({
  packageId: z.string().regex(/^pkg-[1-9]\d*$/),
  name: z.string().trim().min(1),
  purpose: z.string().trim().min(1),
  hostCode: z.string().optional(),
  clientCode: z.string().optional(),
}).strict().refine(value => value.hostCode !== undefined || value.clientCode !== undefined, {
  message: 'a Package needs hostCode, clientCode, or both',
})

const pluginSchema = z.object({
  pluginId: z.string().regex(/^[a-z]{3,6}-[1-9]\d*$/),
  sessionId: z.string().min(1),
  packages: z.array(packageSchema).min(1),
}).strict()

const fileSchema = z.object({
  version: z.literal(FORMAT_VERSION),
  plugins: z.array(pluginSchema),
}).strict()

/**
 * Read and validate durable definitions as stopped runtime records.
 * @param filename - Registry JSON file to read.
 * @returns Validated definitions without runtime or authorization state.
 */
export function loadDefinitions(filename: string): DynamicCordisPlugin[] {
  let source: string
  try {
    source = readFileSync(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new Error(`dynamic Cordis registry: cannot read ${filename}`, { cause: error })
  }

  let decoded: z.infer<typeof fileSchema>
  try {
    decoded = fileSchema.parse(JSON.parse(source))
  } catch (error) {
    throw new Error(`dynamic Cordis registry: invalid format at ${filename}`, { cause: error })
  }

  const pluginIds = new Set<string>()
  const packageIds = new Set<string>()
  return decoded.plugins.map((stored) => {
    if (pluginIds.has(stored.pluginId)) {
      throw new Error(`dynamic Cordis registry: duplicate Plugin ID "${stored.pluginId}" at ${filename}`)
    }
    pluginIds.add(stored.pluginId)
    const packages = new Map<CordisDynamicPackageId, {
      packageId: CordisDynamicPackageId
      name: string
      purpose: string
      hostCode?: string
      clientCode?: string
    }>()
    for (const definition of stored.packages) {
      if (packageIds.has(definition.packageId)) {
        throw new Error(`dynamic Cordis registry: duplicate Package ID "${definition.packageId}" at ${filename}`)
      }
      packageIds.add(definition.packageId)
      const packageId = definition.packageId as CordisDynamicPackageId
      packages.set(packageId, {
        packageId,
        name: definition.name,
        purpose: definition.purpose,
        ...definition.hostCode === undefined ? {} : { hostCode: definition.hostCode },
        ...definition.clientCode === undefined ? {} : { clientCode: definition.clientCode },
      })
    }
    return {
      pluginId: stored.pluginId as CordisDynamicPluginId,
      sessionId: stored.sessionId as SessionId,
      packages,
      approvedClientPackages: new Set(),
      clientVersionUpdatesApproved: false,
    }
  })
}

/**
 * Atomically replace the owner-only registry while excluding runtime state.
 * @param filename - Registry JSON file to replace.
 * @param plugins - Complete ordered definition snapshot to store.
 */
export function saveDefinitions(filename: string, plugins: readonly DynamicCordisPlugin[]): void {
  const content = `${JSON.stringify({
    version: FORMAT_VERSION,
    plugins: plugins.map(plugin => ({
      pluginId: plugin.pluginId,
      sessionId: plugin.sessionId,
      packages: [...plugin.packages.values()].map(definition => ({
        packageId: definition.packageId,
        name: definition.name,
        purpose: definition.purpose,
        ...definition.hostCode === undefined ? {} : { hostCode: definition.hostCode },
        ...definition.clientCode === undefined ? {} : { clientCode: definition.clientCode },
      })),
    })),
  }, null, 2)}\n`
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 })

  const lockPath = `${filename}.lock`
  let lock: number
  try {
    lock = openSync(lockPath, 'wx', 0o600)
  } catch (error) {
    throw new Error(`dynamic Cordis registry: cannot acquire writer lock at ${lockPath}`, { cause: error })
  }

  const temporary = `${filename}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 })
    renameSync(temporary, filename)
  } catch (error) {
    throw new Error(`dynamic Cordis registry: cannot write ${filename}`, { cause: error })
  } finally {
    rmSync(temporary, { force: true })
    closeSync(lock)
    rmSync(lockPath, { force: true })
  }
}
