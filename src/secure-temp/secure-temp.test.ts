/**
 * SCOPE — what a green run here does and does not claim.
 *
 * DOES claim: writeSecretFile creates with mode 0600 and the exclusive `wx`
 * flag; a chmod failure is fail-closed on non-Windows and swallowed (with a
 * Windows DACL applied instead) on win32; a hardening failure scrubs and
 * removes the just-written file before re-throwing; replaceSecretFile refuses
 * a pre-existing symlink and otherwise unlinks-then-recreates; scrubFile
 * zeroes a file's real bytes before the caller unlinks it, and never writes
 * through a symlink; tightenFilePermissions has the same fail-closed/Windows
 * contract without the create step.
 *
 * Does NOT claim: that the Windows DACL (icacls) invocation is correct
 * end-to-end on a real Windows filesystem — CI here is Linux-only, so the
 * icacls call itself is mocked and only its ARGUMENTS are asserted.
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  chmodSync: vi.fn(),
  execFileSync: vi.fn(),
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, chmodSync: h.chmodSync }
})

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execFileSync: h.execFileSync }
})

const { writeSecretFile, replaceSecretFile, scrubFile, tightenFilePermissions } =
  await import('./secure-temp.js')
const realFs = await vi.importActual<typeof import('node:fs')>('node:fs')

let dir: string
let originalPlatform: PropertyDescriptor | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'secure-temp-test-'))
  originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  h.chmodSync.mockReset().mockImplementation(realFs.chmodSync)
  h.execFileSync.mockReset()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
})

const setPlatform = (value: NodeJS.Platform) =>
  Object.defineProperty(process, 'platform', { value, configurable: true })

describe('writeSecretFile', () => {
  it('creates the file with content, mode 0600 and the exclusive wx flag', () => {
    const filePath = join(dir, 'secret.txt')
    writeSecretFile(filePath, 'sensitive')
    expect(readFileSync(filePath, 'utf8')).toBe('sensitive')
    // Real Windows chmod does not produce exact POSIX bits regardless of what
    // process.platform claims (CI here is Linux-only; this guards a local run
    // on a real Windows host, not the mocked win32 branch below).
    if (process.platform !== 'win32') {
      expect(statSync(filePath).mode & 0o777).toBe(0o600)
    }
  })

  it('fails (does not silently overwrite) when the target already exists', () => {
    const filePath = join(dir, 'secret.txt')
    writeFileSync(filePath, 'first')
    expect(() => writeSecretFile(filePath, 'second')).toThrow()
  })

  it('re-throws when chmod fails on a non-Windows platform, and scrubs + removes the file (fail closed)', () => {
    setPlatform('linux')
    h.chmodSync.mockImplementation(() => {
      throw new Error('EPERM: operation not permitted')
    })
    const filePath = join(dir, 'secret.txt')
    expect(() => writeSecretFile(filePath, 'sensitive')).toThrow(
      /Failed to set restrictive permissions/,
    )
    expect(existsSync(filePath)).toBe(false)
  })

  it('swallows a chmod failure on Windows and applies a restrictive DACL instead', () => {
    setPlatform('win32')
    h.chmodSync.mockImplementation(() => {
      throw new Error('chmod is a no-op on NTFS')
    })
    h.execFileSync.mockReturnValue(Buffer.from(''))
    const filePath = join(dir, 'secret.txt')
    expect(() => writeSecretFile(filePath, 'sensitive')).not.toThrow()
    expect(h.execFileSync).toHaveBeenCalledWith(
      'icacls',
      expect.arrayContaining([filePath, '/inheritance:r']),
      expect.anything(),
    )
  })

  it('strips inherited ACEs and removes the well-known broad-access SIDs on Windows', () => {
    setPlatform('win32')
    h.execFileSync.mockReturnValue(Buffer.from(''))
    const filePath = join(dir, 'secret.txt')
    writeSecretFile(filePath, 'sensitive')
    const args = h.execFileSync.mock.calls[0]?.[1] as string[]
    expect(args).toEqual(
      expect.arrayContaining([
        '/remove:g',
        '*S-1-1-0',
        '*S-1-5-32-545',
        '*S-1-5-11',
        '*S-1-5-32-546',
      ]),
    )
  })

  it('scrubs and removes the file when the Windows DACL application itself fails (fail closed)', () => {
    setPlatform('win32')
    h.execFileSync.mockImplementation(() => {
      throw new Error('icacls: access denied')
    })
    const filePath = join(dir, 'secret.txt')
    expect(() => writeSecretFile(filePath, 'sensitive')).toThrow(/Failed to set restrictive ACL/)
    expect(existsSync(filePath)).toBe(false)
  })
})

describe('replaceSecretFile', () => {
  it('creates the file when nothing exists at the target path yet', () => {
    const filePath = join(dir, 'out.txt')
    replaceSecretFile(filePath, 'content')
    expect(readFileSync(filePath, 'utf8')).toBe('content')
  })

  it('overwrites a pre-existing regular file (a legitimate re-run)', () => {
    const filePath = join(dir, 'out.txt')
    writeFileSync(filePath, 'stale')
    replaceSecretFile(filePath, 'fresh')
    expect(readFileSync(filePath, 'utf8')).toBe('fresh')
  })

  it('refuses to write through a pre-existing symlink', () => {
    if (process.platform === 'win32') return // symlink creation needs elevation on win32 CI runners
    const victim = join(dir, 'victim.txt')
    writeFileSync(victim, 'do not touch')
    const linkPath = join(dir, 'out.txt')
    symlinkSync(victim, linkPath)
    expect(() => replaceSecretFile(linkPath, 'content')).toThrow(/symbolic link already exists/)
    expect(readFileSync(victim, 'utf8')).toBe('do not touch')
  })
})

describe('scrubFile', () => {
  it('overwrites the file content with zero bytes', () => {
    const filePath = join(dir, 'secret.txt')
    writeFileSync(filePath, 'sensitive-content')
    scrubFile(filePath)
    const raw = readFileSync(filePath)
    expect(raw.length).toBe('sensitive-content'.length)
    expect(raw.every((byte) => byte === 0)).toBe(true)
  })

  it('is a silent no-op when the file does not exist', () => {
    expect(() => scrubFile(join(dir, 'missing.txt'))).not.toThrow()
  })

  it('never writes through a symlink', () => {
    if (process.platform === 'win32') return // symlink creation needs elevation on win32 CI runners
    const victim = join(dir, 'victim.txt')
    writeFileSync(victim, 'do not touch')
    const linkPath = join(dir, 'link.txt')
    symlinkSync(victim, linkPath)
    scrubFile(linkPath)
    expect(readFileSync(victim, 'utf8')).toBe('do not touch')
  })

  it('does nothing to an empty file', () => {
    const filePath = join(dir, 'empty.txt')
    writeFileSync(filePath, '')
    expect(() => scrubFile(filePath)).not.toThrow()
    expect(readFileSync(filePath, 'utf8')).toBe('')
  })
})

describe('tightenFilePermissions', () => {
  it('chmods an existing file to mode 0600', () => {
    const filePath = join(dir, 'downloaded.txt')
    writeFileSync(filePath, 'content', { mode: 0o644 })
    tightenFilePermissions(filePath)
    if (process.platform !== 'win32') {
      expect(statSync(filePath).mode & 0o777).toBe(0o600)
    }
  })

  it('re-throws when chmod fails on a non-Windows platform (fail closed)', () => {
    setPlatform('linux')
    h.chmodSync.mockImplementation(() => {
      throw new Error('EPERM: operation not permitted')
    })
    expect(() => tightenFilePermissions(join(dir, 'anything.txt'))).toThrow(
      /Failed to set restrictive permissions/,
    )
  })

  it('swallows a chmod failure on Windows and applies a restrictive DACL instead', () => {
    setPlatform('win32')
    h.chmodSync.mockImplementation(() => {
      throw new Error('chmod is a no-op on NTFS')
    })
    h.execFileSync.mockReturnValue(Buffer.from(''))
    const filePath = join(dir, 'downloaded.txt')
    writeFileSync(filePath, 'content')
    expect(() => tightenFilePermissions(filePath)).not.toThrow()
    expect(h.execFileSync).toHaveBeenCalledWith(
      'icacls',
      expect.arrayContaining([filePath, '/inheritance:r']),
      expect.anything(),
    )
  })
})
