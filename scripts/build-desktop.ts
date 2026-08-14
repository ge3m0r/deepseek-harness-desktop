/** Build a symlink-free production closure and package the Electron desktop app. */

import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { spawn } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const desktopPackage = '@deepseek-ai/dsh-desktop'
const electronBuilder = join(root, 'apps', 'desktop', 'node_modules', '.bin', 'electron-builder')

interface PackageManifest {
  build?: { directories?: { output?: string } }
}

function run(command: string, args: string[], cwd = root): Promise<void> {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env: { ...process.env, CI: 'true' } })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} failed with ${code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${String(code)}`}`))
    })
  })
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { 'skip-build': { type: 'boolean', default: false } },
  })
  if (!values['skip-build']) await run('npm', ['run', 'build'])

  const staging = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
  try {
    await run('pnpm', [
      '--filter', desktopPackage,
      'deploy', '--legacy', '--prod',
      '--config.node-linker=hoisted',
      '--config.auto-install-peers=false',
      '--config.link-workspace-packages=true',
      staging,
    ])

    const required = [
      join(staging, 'lib', 'main.js'),
      join(staging, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      join(staging, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html'),
    ]
    const missing = required.filter(path => !existsSync(path))
    if (missing.length > 0) throw new Error(`desktop deploy is missing required artifacts:\n${missing.join('\n')}`)

    const manifestPath = join(staging, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PackageManifest
    if (manifest.build === undefined) throw new Error('desktop deploy manifest has no build configuration')
    manifest.build.directories = { ...manifest.build.directories, output: join(root, 'dist-desktop') }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    await run(electronBuilder, ['--publish', 'never'], staging)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

await main()
