import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AGENT_A, setup } from './helpers.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function registryPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cordis-persistence-'))
  roots.push(root)
  const directory = join(root, 'dynamic-cordis')
  await mkdir(directory)
  return join(directory, 'registry.json')
}

describe('dynamic Plugin definition persistence', () => {
  it('restores source and identity without running code or retaining approval', async () => {
    const persistencePath = await registryPath()
    const first = await setup({ persistencePath })
    const v1 = first.runner.define({
      sessionId: AGENT_A.id,
      plugin: { kind: 'new', idPrefix: 'clock' },
      name: 'clock v1',
      purpose: 'show time',
      code: { host: 'return { apply() {} }', client: 'return () => {}' },
    })
    const v2 = first.runner.define({
      sessionId: AGENT_A.id,
      plugin: { kind: 'existing', pluginId: v1.pluginId },
      name: 'clock v2',
      purpose: 'show local time',
      code: { client: 'return () => {}' },
    })
    await first.ctx.fiber.dispose()

    const second = await setup({ persistencePath })
    expect(second.runner.inventory()).toEqual([{
      pluginId: v1.pluginId,
      agentId: AGENT_A.id,
      packages: [
        { packageId: v1.packageId, name: 'clock v1', purpose: 'show time', hasHostHalf: true, hasClientHalf: true },
        { packageId: v2.packageId, name: 'clock v2', purpose: 'show local time', hasHostHalf: false, hasClientHalf: true },
      ],
    }])
    expect(second.runner.inspectPackage(AGENT_A, v1.pluginId, v1.packageId).code).toEqual({
      host: 'return { apply() {} }',
      client: 'return () => {}',
    })

    const next = second.runner.define({
      sessionId: AGENT_A.id,
      plugin: { kind: 'new', idPrefix: 'panel' },
      name: 'panel',
      purpose: 'show a panel',
      code: { client: 'return () => {}' },
    })
    expect(next).toMatchObject({ pluginId: 'panel-2', packageId: 'pkg-3' })
    await second.ctx.fiber.dispose()

    expect((await stat(persistencePath)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(persistencePath, 'utf8'))).toMatchObject({ version: 1 })
  })

  it('removes an undefined Plugin from the durable registry', async () => {
    const persistencePath = await registryPath()
    const first = await setup({ persistencePath })
    const defined = first.runner.define({
      sessionId: AGENT_A.id,
      plugin: { kind: 'new', idPrefix: 'panel' },
      name: 'panel',
      purpose: 'show a panel',
      code: { client: 'return () => {}' },
    })
    await expect(first.runner.undefine(AGENT_A, defined.pluginId)).resolves.toEqual({ ok: true, wasRunning: false })
    await first.ctx.fiber.dispose()

    const second = await setup({ persistencePath })
    expect(second.runner.inventory()).toEqual([])
    await second.ctx.fiber.dispose()
  })

  it('rejects malformed durable data instead of starting with a partial registry', async () => {
    const persistencePath = await registryPath()
    await writeFile(persistencePath, '{"version":0,"plugins":[]}', 'utf8')
    await expect(setup({ persistencePath })).rejects.toThrow(`invalid format at ${persistencePath}`)
  })

  it('does not publish a definition when the atomic writer lock is unavailable', async () => {
    const persistencePath = await registryPath()
    const harness = await setup({ persistencePath })
    await writeFile(`${persistencePath}.lock`, 'another host\n', 'utf8')
    expect(() => harness.runner.define({
      sessionId: AGENT_A.id,
      plugin: { kind: 'new', idPrefix: 'panel' },
      name: 'panel',
      purpose: 'show a panel',
      code: { client: 'return () => {}' },
    })).toThrow('cannot acquire writer lock')
    expect(harness.runner.inventory()).toEqual([])
    await harness.ctx.fiber.dispose()
  })
})
