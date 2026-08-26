import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const setSecret = vi.hoisted(() => vi.fn<(value: string) => void>())

vi.mock('azure-pipelines-task-lib/task.js', () => ({
  setSecret,
  setVariable: vi.fn(),
  debug: vi.fn(),
}))

const { EnvironmentVariableHelper } =
  await import('../environment-variables/environment-variables.js')
const { maskSecretLines, readSecretEndpointDataParameter } =
  await import('./endpoint-data-secret.js')

const SERVICE = 'OCI'
const ENV_NAME = `ENDPOINT_DATA_${SERVICE}_PRIVATEKEY`

const MULTILINE_PEM = [
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIEowIBAAKCAQEAx7Vn0Kk1zQ9mEXAMPLEBODYLINEONEaaaaaaaaaaaaaaaaaa',
  'ZmFrZWJvZHlsaW5ldHdvEXAMPLEBODYLINETWObbbbbbbbbbbbbbbbbbbbbbbbbb',
  '-----END RSA PRIVATE KEY-----',
].join('\n')

describe('readSecretEndpointDataParameter', () => {
  beforeEach(() => {
    setSecret.mockReset()
    EnvironmentVariableHelper.clearTrackedVariables()
    delete process.env[ENV_NAME]
  })

  afterEach(() => {
    delete process.env[ENV_NAME]
    EnvironmentVariableHelper.clearTrackedVariables()
  })

  // The whole point of not using tasks.getEndpointDataParameter(): its
  // implementation ends with debug(id + ' data ' + key + ' = ' + value), which
  // fires at READ time, strictly before any caller could mask the value.
  it('reads the value without going through task-lib', () => {
    process.env[ENV_NAME] = MULTILINE_PEM
    expect(readSecretEndpointDataParameter(SERVICE, 'privateKey')).toBe(MULTILINE_PEM)
  })

  // task-lib uses the service id VERBATIM and upper-cases only the key.
  it('derives the variable name exactly as task-lib does', () => {
    process.env['ENDPOINT_DATA_MixedCase_PRIVATEKEY'] = 'value'
    try {
      expect(readSecretEndpointDataParameter('MixedCase', 'privateKey')).toBe('value')
    } finally {
      delete process.env['ENDPOINT_DATA_MixedCase_PRIVATEKEY']
    }
  })

  it('masks every body line before returning, never the whole value at once', () => {
    process.env[ENV_NAME] = MULTILINE_PEM
    readSecretEndpointDataParameter(SERVICE, 'privateKey')

    // setSecret throws LIB_MultilineSecret on CR/LF: handing it the whole PEM
    // would register NOTHING at all.
    for (const call of setSecret.mock.calls) {
      expect(call[0]).not.toMatch(/[\r\n]/)
    }
    for (const line of MULTILINE_PEM.split('\n')) {
      expect(setSecret).toHaveBeenCalledWith(line)
    }
  })

  it('records each line for the exact-match scrub, not only the masker', () => {
    process.env[ENV_NAME] = MULTILINE_PEM
    readSecretEndpointDataParameter(SERVICE, 'privateKey')

    // Build attachments are not passed through the agent's masker, so a value
    // that was only setSecret()'d is protected there by entropy heuristics alone.
    const tracked = EnvironmentVariableHelper.getTrackedSecretValues()
    for (const line of MULTILINE_PEM.split('\n')) {
      expect(tracked).toContain(line)
    }
  })

  it('deletes the variable so the tool child process cannot inherit it', () => {
    process.env[ENV_NAME] = MULTILINE_PEM
    readSecretEndpointDataParameter(SERVICE, 'privateKey')
    expect(process.env[ENV_NAME]).toBeUndefined()
  })

  it.each([undefined, ''])('returns undefined for %o and masks nothing', (raw) => {
    if (raw === undefined) delete process.env[ENV_NAME]
    else process.env[ENV_NAME] = raw

    expect(readSecretEndpointDataParameter(SERVICE, 'privateKey')).toBeUndefined()
    expect(setSecret).not.toHaveBeenCalled()
  })
})

describe('maskSecretLines', () => {
  beforeEach(() => {
    setSecret.mockReset()
    EnvironmentVariableHelper.clearTrackedVariables()
  })

  // The UI passwordbox flattens a PEM onto one line, so that single "line" IS
  // the credential and the boundary markers must not be dropped.
  it('keeps the BEGIN/END boundary lines', () => {
    maskSecretLines(MULTILINE_PEM)
    expect(setSecret).toHaveBeenCalledWith('-----BEGIN RSA PRIVATE KEY-----')
    expect(setSecret).toHaveBeenCalledWith('-----END RSA PRIVATE KEY-----')
  })

  it('skips blank and whitespace-only lines', () => {
    maskSecretLines('alpha\n\n   \nbeta\n')
    expect(setSecret.mock.calls.map((c) => c[0])).toEqual(['alpha', 'beta'])
  })

  it('trims surrounding whitespace so the registered form matches the log form', () => {
    maskSecretLines('  padded  ')
    expect(setSecret).toHaveBeenCalledWith('padded')
  })
})
