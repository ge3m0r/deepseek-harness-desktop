import { mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureSidebarFallback, extractReadyUrl, profileIncludesSidebar, resolveBackendArgs,
} from '../src/backend.ts'

const fixtures: string[] = []

function fixture(): string {
  const path = mkdtempSync(join(tmpdir(), 'dsh-desktop-sidebar-'))
  fixtures.push(path)
  return path
}

afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('desktop backend readiness', () => {
  it('extracts the loopback URL from the complete readiness line', () => {
    expect(extractReadyUrl('log before\ndsh web: http://127.0.0.1:43123/\n'))
      .toBe('http://127.0.0.1:43123/')
  })

  it('waits for a complete URL and rejects non-loopback announcements', () => {
    expect(extractReadyUrl('dsh web: http://127.0.0.1:')).toBeUndefined()
    expect(extractReadyUrl('dsh web: http://192.168.1.8:43123/\n')).toBeUndefined()
    expect(extractReadyUrl('dsh web: https://127.0.0.1:43123/\n')).toBeUndefined()
  })

  it('accepts the readiness line when a LAN display address follows it', () => {
    expect(extractReadyUrl('dsh web: http://127.0.0.1:43123 (LAN: http://192.168.1.8:43123)\n'))
      .toBe('http://127.0.0.1:43123/')
  })
})

describe('desktop sidebar composition', () => {
  it('recognizes a mounted bundle', () => {
    const home = fixture()
    mkdirSync(join(home, 'profiles/web'), { recursive: true })
    writeFileSync(join(home, 'profiles/web/package.json'), JSON.stringify({
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-better-sidebar'] } },
    }))
    expect(profileIncludesSidebar(home)).toBe(true)
  })

  it('recognizes a legacy manual mount', () => {
    const home = fixture()
    mkdirSync(join(home, 'profiles/web'), { recursive: true })
    writeFileSync(join(home, 'profiles/web/cordis.patch.yml'), "- insert:\n    - name: 'dsh-better-sidebar'\n")
    expect(profileIncludesSidebar(home)).toBe(true)
  })

  it('requests the bundled patch for an unmodified profile', () => {
    const home = fixture()
    expect(profileIncludesSidebar(home)).toBe(false)
    const args = resolveBackendArgs(home)
    expect(args.indexOf('--patch')).toBeGreaterThan(args.indexOf('web'))
    expect(args.indexOf('--patch')).toBeLessThan(args.indexOf('--host'))
  })

  it('maintains a profile fallback to the bundled package', () => {
    const home = fixture()
    ensureSidebarFallback(home)
    const link = join(home, 'profiles/node_modules/dsh-better-sidebar')
    expect(readlinkSync(link)).toContain('dsh-better-sidebar')
    expect(() => { ensureSidebarFallback(home) }).not.toThrow()
  })
})
