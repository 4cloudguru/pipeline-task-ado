import { beforeEach, describe, expect, it, vi } from 'vitest'

const getInput = vi.hoisted(() => vi.fn<(name: string, required?: boolean) => string | undefined>())

vi.mock('azure-pipelines-task-lib/task.js', () => ({ getInput }))

const { getBoolInputDefaultTrue } = await import('./bool-input.js')

describe('getBoolInputDefaultTrue', () => {
  beforeEach(() => getInput.mockReset())

  // The fail-closed default is the entire point: an agent that does not
  // materialize task.json defaultValues hands back undefined, and getBoolInput
  // would turn that into false — silently disabling a verification.
  it.each([undefined, '', '   '])('defaults to true when the input is %o', (raw) => {
    getInput.mockReturnValue(raw)
    expect(getBoolInputDefaultTrue('requireChecksum')).toBe(true)
  })

  it.each(['false', 'FALSE', ' False '])('is false only for an explicit %o', (raw) => {
    getInput.mockReturnValue(raw)
    expect(getBoolInputDefaultTrue('requireChecksum')).toBe(false)
  })

  // azure-pipelines-packer#331: YAML stringifies an unquoted `requireChecksum: true`
  // as 'True'. A parser comparing against the lowercase literal read that as false and
  // silently disabled checksum/GPG verification. These rows pin the capitalization
  // contract so no consumer can regress to a case-sensitive compare.
  it.each(['True', 'TRUE', 'TrUe', ' true ', '\ttrue\n'])(
    'stays true for the YAML form %o',
    (raw) => {
      getInput.mockReturnValue(raw)
      expect(getBoolInputDefaultTrue('requireChecksum')).toBe(true)
    },
  )

  it.each(['true', 'yes', '0', 'nonsense'])('stays true for %o', (raw) => {
    getInput.mockReturnValue(raw)
    expect(getBoolInputDefaultTrue('requireChecksum')).toBe(true)
  })

  // required=false, so a missing input is the caller's default rather than a throw.
  it('never marks the input required', () => {
    getInput.mockReturnValue(undefined)
    getBoolInputDefaultTrue('requireChecksum')
    expect(getInput).toHaveBeenCalledWith('requireChecksum', false)
  })
})
