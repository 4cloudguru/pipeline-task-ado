import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The REAL task-lib: the module exists because of what getInput() writes.
import * as im from 'azure-pipelines-task-lib/internal.js'
import { getInput } from 'azure-pipelines-task-lib/task.js'

import { EnvironmentVariableHelper } from '../environment-variables/environment-variables.js'
import { readSecretInput } from './secret-input.js'

const NAME = 'apiKey'
const ENV = 'INPUT_APIKEY'
const SECRET = 'tfr-api-key-s3cr3t-value'
const PEM = [
  '-----BEGIN PRIVATE KEY-----',
  'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEA',
  '-----END PRIVATE KEY-----',
].join('\n')

function vault(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
  im._loadData()
}

function captureVisible(): { lines: () => string[]; restore: () => void } {
  const chunks: string[] = []
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    chunks.push(String(chunk))
    return true
  }) as typeof process.stdout.write)
  return {
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((l) => !l.includes('task.setsecret')),
    restore: () => spy.mockRestore(),
  }
}

describe('readSecretInput', () => {
  beforeEach(() => EnvironmentVariableHelper.clearTrackedVariables())
  afterEach(() => {
    vault(ENV, undefined)
    im._vault.storeSecret(ENV, '')
    EnvironmentVariableHelper.clearTrackedVariables()
  })

  it('premise: task-lib getInput() writes a literal secret input to the debug stream', () => {
    vault(ENV, SECRET)
    const out = captureVisible()
    try {
      expect(getInput(NAME, true)).toBe(SECRET)
    } finally {
      out.restore()
    }
    expect(out.lines().some((l) => l.includes('task.debug') && l.includes(SECRET))).toBe(true)
  })

  it('returns the vaulted value, registers it, and writes only a masked debug line', () => {
    vault(ENV, SECRET)
    const out = captureVisible()
    let value: string | undefined
    try {
      value = readSecretInput(NAME, true)
    } finally {
      out.restore()
    }
    expect(value).toBe(SECRET)
    expect(out.lines().join('\n')).not.toContain(SECRET)
    expect(out.lines().find((l) => l.includes(`${NAME}=`))).toContain(`${NAME}=***`)
    expect(EnvironmentVariableHelper.getTrackedSecretValues()).toContain(SECRET)
  })

  it('registers a multi-line value line by line, never as one CR/LF-bearing call', () => {
    vault(ENV, PEM)
    expect(readSecretInput(NAME, true)).toBe(PEM)
    const tracked = EnvironmentVariableHelper.getTrackedSecretValues()
    for (const line of PEM.split('\n')) {
      expect(tracked).toContain(line)
    }
    expect(tracked.some((v) => /[\r\n]/.test(v))).toBe(false)
  })

  it('throws the task-lib required-input message when a required input is absent or empty', () => {
    vault(ENV, undefined)
    expect(() => readSecretInput(NAME, true)).toThrow(`Input required: ${NAME}`)
    vault(ENV, '')
    expect(() => readSecretInput(NAME, true)).toThrow(`Input required: ${NAME}`)
  })

  it('returns undefined for an absent optional input and registers nothing', () => {
    vault(ENV, undefined)
    expect(readSecretInput(NAME)).toBeUndefined()
    expect(EnvironmentVariableHelper.getTrackedSecretValues()).toEqual([])
  })
})
