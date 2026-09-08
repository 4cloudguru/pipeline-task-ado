import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The REAL task-lib: the module exists because of what getEndpointUrl() writes.
import { getEndpointUrl } from 'azure-pipelines-task-lib/task.js'

import { EnvironmentVariableHelper } from '../environment-variables/environment-variables.js'
import { readEndpointUrl } from './endpoint-url.js'

const ID = 'vSphereConn'
const ENV = `ENDPOINT_URL_${ID}`
const PASSWORD = 'vc-s3cr3t-pw'
const WITH_CREDS = `https://svc:${PASSWORD}@vcenter.example.com/sdk`

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

describe('readEndpointUrl', () => {
  beforeEach(() => {
    EnvironmentVariableHelper.clearTrackedVariables()
    delete process.env[ENV]
  })
  afterEach(() => {
    delete process.env[ENV]
    EnvironmentVariableHelper.clearTrackedVariables()
  })

  it('premise: task-lib getEndpointUrl() writes the raw connection URL to the debug stream', () => {
    process.env[ENV] = WITH_CREDS
    const out = captureVisible()
    try {
      expect(getEndpointUrl(ID, false)).toBe(WITH_CREDS)
    } finally {
      out.restore()
    }
    expect(out.lines().some((l) => l.includes('task.debug') && l.includes(PASSWORD))).toBe(true)
  })

  it('returns the URL, registers its userinfo first, and writes the debug line redacted', () => {
    process.env[ENV] = WITH_CREDS
    const out = captureVisible()
    let value: string | undefined
    try {
      value = readEndpointUrl(ID)
    } finally {
      out.restore()
    }
    expect(value).toBe(WITH_CREDS)
    expect(out.lines().join('\n')).not.toContain(PASSWORD)
    expect(out.lines().find((l) => l.includes(`${ID}=`))).toContain('vcenter.example.com/sdk')
    expect(EnvironmentVariableHelper.getTrackedSecretValues()).toContain(PASSWORD)
  })

  it('uses the id verbatim, as task-lib does', () => {
    process.env['ENDPOINT_URL_MixedCase'] = 'https://h.example/p'
    try {
      expect(readEndpointUrl('MixedCase')).toBe('https://h.example/p')
    } finally {
      delete process.env['ENDPOINT_URL_MixedCase']
    }
  })

  it('throws the task-lib endpoint message when required and absent, and returns undefined when optional', () => {
    expect(() => readEndpointUrl(ID)).toThrow(`Endpoint not present: ${ID}`)
    expect(() => readEndpointUrl(ID, false)).toThrow(`Endpoint not present: ${ID}`)
    expect(readEndpointUrl(ID, true)).toBeUndefined()
  })

  it('leaves the variable in place for task-lib and the child process', () => {
    process.env[ENV] = WITH_CREDS
    readEndpointUrl(ID)
    expect(process.env[ENV]).toBe(WITH_CREDS)
  })
})

describe('readEndpointUrl: a connection URL written without its scheme', () => {
  afterEach(() => {
    delete process.env[ENV]
    EnvironmentVariableHelper.clearTrackedVariables()
  })

  it('registers the userinfo of svc:password@host and redacts the debug line, exactly as for https://', () => {
    process.env[ENV] = `svc:${PASSWORD}@vcenter.example.com/sdk`
    const out = captureVisible()
    try {
      expect(readEndpointUrl(ID)).toBe(`svc:${PASSWORD}@vcenter.example.com/sdk`)
    } finally {
      out.restore()
    }
    expect(EnvironmentVariableHelper.getTrackedSecretValues()).toContain(PASSWORD)
    expect(out.lines().some((l) => l.includes(PASSWORD))).toBe(false)
    expect(out.lines().find((l) => l.includes(`${ID}=`))).toContain('vcenter.example.com/sdk')
  })
})
