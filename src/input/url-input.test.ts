import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The REAL task-lib, deliberately: this module exists because of what task-lib's
// own getInput() does, and a mock of getInput would prove nothing about that.
import * as im from 'azure-pipelines-task-lib/internal.js'
import { getInput } from 'azure-pipelines-task-lib/task.js'

import { EnvironmentVariableHelper } from '../environment-variables/environment-variables.js'
import { readUrlInput } from './url-input.js'

const NAME = 'policyRepoUrl'
const ENV = 'INPUT_POLICYREPOURL'
// No '%' in this one: task-lib's command escaping rewrites '%' as '%AZP25' on
// the way to the log, which would hide a substring match without hiding the
// secret. The percent-encoded case gets its own test below.
const PASSWORD = 'PAT-s3cr3t-value'
const WITH_CREDS = `https://svc:${PASSWORD}@git.example.com/org/policies`

function vault(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
  // Re-run task-lib's own loader so the value lands in the vault (and is deleted
  // from process.env) exactly as it would at task start.
  im._loadData()
}

// `##vso[task.setsecret]` lines are how a value is REGISTERED with the masker:
// the agent consumes them and they never reach the log, so they are excluded
// from every "did the credential get written" check below. Everything else the
// task writes is log-visible.
function captureStdout(): { lines: () => string[]; restore: () => void } {
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

describe('readUrlInput', () => {
  beforeEach(() => {
    EnvironmentVariableHelper.clearTrackedVariables()
  })

  afterEach(() => {
    vault(ENV, undefined)
    im._vault.storeSecret(ENV, '')
    EnvironmentVariableHelper.clearTrackedVariables()
  })

  // The premise. If task-lib ever stops debug-logging inputs, this test fails
  // and the helper's reason for existing should be re-examined — but the
  // masking it does would still be worth keeping.
  it('premise: task-lib getInput() writes the raw credential to the debug stream', () => {
    vault(ENV, WITH_CREDS)
    const out = captureStdout()
    try {
      expect(getInput(NAME, true)).toBe(WITH_CREDS)
    } finally {
      out.restore()
    }
    expect(out.lines().some((l) => l.includes('task.debug') && l.includes(PASSWORD))).toBe(true)
  })

  it('returns the vaulted value without writing the credential anywhere', () => {
    vault(ENV, WITH_CREDS)
    const out = captureStdout()
    let value: string | undefined
    try {
      value = readUrlInput(NAME, true)
    } finally {
      out.restore()
    }
    expect(value).toBe(WITH_CREDS)
    expect(out.lines().join('\n')).not.toContain(PASSWORD)
    expect(out.lines().join('\n')).not.toContain('svc:')
  })

  it('still writes the diagnostic debug line, with the userinfo redacted', () => {
    vault(ENV, WITH_CREDS)
    const out = captureStdout()
    try {
      readUrlInput(NAME, true)
    } finally {
      out.restore()
    }
    const line = out.lines().find((l) => l.includes(`${NAME}=`))
    expect(line).toBeDefined()
    expect(line).toContain('git.example.com/org/policies')
    expect(line).not.toContain(PASSWORD)
  })

  it('registers the userinfo for the masker and the exact-match scrub before returning', () => {
    vault(ENV, WITH_CREDS)
    readUrlInput(NAME, true)
    expect(EnvironmentVariableHelper.getTrackedSecretValues()).toContain(PASSWORD)
  })

  it('registers the percent-decoded spelling too, since the URL parser hands %21 back as !', () => {
    vault(ENV, 'https://svc:PAT-s3cr3t%21@git.example.com/org/policies')
    readUrlInput(NAME, true)
    const tracked = EnvironmentVariableHelper.getTrackedSecretValues()
    expect(tracked).toContain('PAT-s3cr3t%21')
    expect(tracked).toContain('PAT-s3cr3t!')
  })

  it('registers nothing for a URL with no userinfo, and returns it unchanged', () => {
    vault(ENV, 'https://git.example.com/org/policies?x=1#frag')
    expect(readUrlInput(NAME, true)).toBe('https://git.example.com/org/policies?x=1#frag')
    expect(EnvironmentVariableHelper.getTrackedSecretValues()).toEqual([])
  })

  it('throws the task-lib required-input message when a required input is absent or empty', () => {
    vault(ENV, undefined)
    expect(() => readUrlInput(NAME, true)).toThrow(`Input required: ${NAME}`)
    vault(ENV, '')
    expect(() => readUrlInput(NAME, true)).toThrow(`Input required: ${NAME}`)
  })

  it('returns undefined for an absent optional input', () => {
    vault(ENV, undefined)
    expect(readUrlInput(NAME)).toBeUndefined()
    expect(readUrlInput(NAME, false)).toBeUndefined()
  })

  it('derives the vault key exactly as task-lib does (dots and spaces to underscores, upper-case)', () => {
    process.env['INPUT_SOME_NESTED_URL'] = 'https://h.example/p'
    im._loadData()
    try {
      expect(readUrlInput('some.nested url', true)).toBe('https://h.example/p')
    } finally {
      im._vault.storeSecret('INPUT_SOME_NESTED_URL', '')
    }
  })
})

// The spellings the first cut of the reader did not see (found by the M1
// correctness and class-coverage reviews): a whole-value URL whose password
// holds a character the embedded-URL scan stops at, a value with the scheme
// left off, a password that decodes to more than one line, and a credential
// typed into a free-form block as `key=value` rather than inside a URL.
describe('readUrlInput: every spelling a free-form value can carry', () => {
  beforeEach(() => {
    EnvironmentVariableHelper.clearTrackedVariables()
  })
  afterEach(() => {
    vault(ENV, undefined)
    im._vault.storeSecret(ENV, '')
    EnvironmentVariableHelper.clearTrackedVariables()
  })

  it("registers a whole-value password containing a quote or a space, which the embedded scan cuts off before the '@'", () => {
    const out = captureStdout()
    try {
      vault(ENV, "https://svc:ab'cd s3cr3t@git.example.com/org/policies")
      readUrlInput(NAME)
    } finally {
      out.restore()
    }
    const tracked = EnvironmentVariableHelper.getTrackedSecretValues()
    expect(tracked.some((v) => v.includes("ab'cd s3cr3t") || v.includes("ab'cd%20s3cr3t"))).toBe(
      true,
    )
    expect(out.lines().some((l) => l.includes("ab'cd"))).toBe(false)
    const line = out.lines().find((l) => l.includes(`${NAME}=`)) ?? ''
    expect(line).not.toContain('s3cr3t')
    expect(line).toContain('git.example.com/org/policies')
  })

  it('registers and redacts a scheme-less user:password@host value without inventing a scheme in the diagnostic', () => {
    const out = captureStdout()
    try {
      vault(ENV, `svc:${PASSWORD}@vcenter.example.com/sdk`)
      readUrlInput(NAME)
    } finally {
      out.restore()
    }
    expect(EnvironmentVariableHelper.getTrackedSecretValues()).toContain(PASSWORD)
    const line = out.lines().find((l) => l.includes(`${NAME}=`))
    expect(line).toBeDefined()
    expect(line).not.toContain(PASSWORD)
    expect(line).toContain('vcenter.example.com/sdk')
    expect(line).not.toContain('https://')
  })

  it('does not treat a multi-line value as one URL, and leaves a multi-line value with no credential in it unchanged', () => {
    const out = captureStdout()
    try {
      vault(ENV, 'A=https://host.example.com\nB=x@y')
      readUrlInput(NAME)
    } finally {
      out.restore()
    }
    expect(EnvironmentVariableHelper.getTrackedSecretValues()).toEqual([])
    // task-lib escapes the line break as %0A on the way to the log; the value
    // itself must be what getInput would have written.
    expect(out.lines().find((l) => l.includes(`${NAME}=`))).toContain(
      'A=https://host.example.com%0AB=x@y',
    )
  })

  it('does not throw on a password whose percent-decoding contains a line break (registers it line-wise)', () => {
    const out = captureStdout()
    try {
      vault(ENV, 'https://svc:top%0As3cr3t@git.example.com/x')
      expect(() => readUrlInput(NAME)).not.toThrow()
    } finally {
      out.restore()
    }
    expect(EnvironmentVariableHelper.getTrackedSecretValues()).toContain('top%0As3cr3t')
    expect(out.lines().some((l) => l.includes('top%0As3cr3t') || l.includes('s3cr3t'))).toBe(false)
  })

  it('registers the value of a credential-named key=value assignment in a variables or environment block and writes it as ***', () => {
    const out = captureStdout()
    try {
      vault(
        ENV,
        'PKR_VAR_admin_password=hunter2-s3cr3t\nHTTPS_PROXY=https://proxy.example.com:3128\nTF_VAR_region=us-east-1',
      )
      readUrlInput(NAME)
    } finally {
      out.restore()
    }
    expect(EnvironmentVariableHelper.getTrackedSecretValues()).toContain('hunter2-s3cr3t')
    expect(EnvironmentVariableHelper.getTrackedSecretValues()).not.toContain('us-east-1')
    const line = out.lines().find((l) => l.includes(`${NAME}=`)) ?? ''
    expect(line).not.toContain('hunter2-s3cr3t')
    expect(line).toContain('PKR_VAR_admin_password=***')
    expect(line).toContain('HTTPS_PROXY=https://proxy.example.com:3128')
    expect(line).toContain('TF_VAR_region=us-east-1')
  })

  it('handles the argument-string and backend-config shapes, quoted or not, and leaves file/path-named keys alone', () => {
    const out = captureStdout()
    try {
      vault(
        ENV,
        `-var client_secret=top-s3cr3t -var 'access_token="tok-s3cr3t"' -var-file=x.pkrvars.hcl token_file=/agent/tok password = "pw-s3cr3t"`,
      )
      readUrlInput(NAME)
    } finally {
      out.restore()
    }
    const tracked = EnvironmentVariableHelper.getTrackedSecretValues()
    expect(tracked).toContain('top-s3cr3t')
    expect(tracked).toContain('pw-s3cr3t')
    expect(tracked.some((v) => v.includes('tok-s3cr3t'))).toBe(true)
    expect(tracked).not.toContain('/agent/tok')
    expect(tracked).not.toContain('x.pkrvars.hcl')
    const line = out.lines().find((l) => l.includes(`${NAME}=`)) ?? ''
    expect(line).not.toContain('s3cr3t')
    expect(line).toContain('-var-file=x.pkrvars.hcl')
    expect(line).toContain('token_file=/agent/tok')
  })
})
