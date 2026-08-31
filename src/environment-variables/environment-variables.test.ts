/**
 * SCOPE — what a green run here does and does not claim.
 *
 * DOES claim: setEnvironmentVariable sets/masks/tracks a variable and skips an
 * empty name or value with a diagnostic instead of throwing (unless `required`
 * is true, in which case an empty value throws instead of warning);
 * registerSecret masks a value and records it for the exact-match tracked-secret
 * set; clearTrackedVariables removes every variable this helper set (and only
 * those) and clears the tracked-secret set too.
 *
 * Does NOT claim: that every secret-bearing value in the process actually
 * flows through registerSecret — only that values which do are tracked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  debug: vi.fn(),
  warning: vi.fn(),
  setSecret: vi.fn(),
}))

vi.mock('azure-pipelines-task-lib/task.js', () => ({
  debug: h.debug,
  warning: h.warning,
  setSecret: h.setSecret,
}))

const { EnvironmentVariableHelper } = await import('./environment-variables.js')

beforeEach(() => {
  h.debug.mockReset()
  h.warning.mockReset()
  h.setSecret.mockReset()
  EnvironmentVariableHelper.clearTrackedVariables()
})

describe('setEnvironmentVariable', () => {
  it('sets the process env var and tracks its name', () => {
    EnvironmentVariableHelper.setEnvironmentVariable('MY_VAR', 'value')
    expect(process.env['MY_VAR']).toBe('value')
    EnvironmentVariableHelper.clearTrackedVariables()
    expect(process.env['MY_VAR']).toBeUndefined()
  })

  it('masks and tracks the value as a secret when isSecret is true', () => {
    EnvironmentVariableHelper.setEnvironmentVariable('MY_SECRET', 's3cr3t', true)
    expect(h.setSecret).toHaveBeenCalledWith('s3cr3t')
    expect(EnvironmentVariableHelper.getTrackedSecretValues()).toContain('s3cr3t')
  })

  it('does not mask a non-secret value', () => {
    EnvironmentVariableHelper.setEnvironmentVariable('MY_VAR', 'value')
    expect(h.setSecret).not.toHaveBeenCalled()
  })

  it('skips an empty name without throwing', () => {
    expect(() => EnvironmentVariableHelper.setEnvironmentVariable('', 'value')).not.toThrow()
    expect(h.debug).toHaveBeenCalled()
  })

  it('warns and skips an empty value without throwing', () => {
    expect(() => EnvironmentVariableHelper.setEnvironmentVariable('MY_VAR', '')).not.toThrow()
    expect(h.warning).toHaveBeenCalled()
    expect(process.env['MY_VAR']).toBeUndefined()
  })

  it('throws on an empty value when required is true, instead of warning (#1029)', () => {
    expect(() => EnvironmentVariableHelper.setEnvironmentVariable('MY_VAR', '', false, true)).toThrow(
      /MY_VAR/,
    )
    expect(h.warning).not.toHaveBeenCalled()
    expect(process.env['MY_VAR']).toBeUndefined()
  })

  it('still skips an empty NAME with required true, rather than throwing on a blank name', () => {
    expect(() => EnvironmentVariableHelper.setEnvironmentVariable('', 'value', false, true)).not.toThrow()
    expect(h.debug).toHaveBeenCalled()
  })
})

describe('registerSecret', () => {
  it('masks the value and records it for the tracked-secret set', () => {
    EnvironmentVariableHelper.registerSecret('federated-token')
    expect(h.setSecret).toHaveBeenCalledWith('federated-token')
    expect(EnvironmentVariableHelper.getTrackedSecretValues()).toContain('federated-token')
  })

  it('is a no-op for undefined, null, or empty values', () => {
    EnvironmentVariableHelper.registerSecret(undefined)
    EnvironmentVariableHelper.registerSecret(null)
    EnvironmentVariableHelper.registerSecret('')
    expect(h.setSecret).not.toHaveBeenCalled()
  })
})

describe('clearTrackedVariables', () => {
  it('removes every variable this helper set', () => {
    EnvironmentVariableHelper.setEnvironmentVariable('A', '1')
    EnvironmentVariableHelper.setEnvironmentVariable('B', '2')
    EnvironmentVariableHelper.clearTrackedVariables()
    expect(process.env['A']).toBeUndefined()
    expect(process.env['B']).toBeUndefined()
  })

  it('clears the tracked-secret set too', () => {
    EnvironmentVariableHelper.registerSecret('a-secret')
    EnvironmentVariableHelper.clearTrackedVariables()
    expect(EnvironmentVariableHelper.getTrackedSecretValues()).toEqual([])
  })

  it('does not disturb an untracked environment variable', () => {
    process.env['UNTRACKED_VAR'] = 'stays'
    EnvironmentVariableHelper.setEnvironmentVariable('TRACKED_VAR', 'goes')
    EnvironmentVariableHelper.clearTrackedVariables()
    expect(process.env['UNTRACKED_VAR']).toBe('stays')
    delete process.env['UNTRACKED_VAR']
  })
})
