import { beforeEach, describe, expect, it, vi } from 'vitest'

// One shared, hoisted event log so both mock factories write to it and the
// ordering assertion below is a real observation rather than an inference.
const h = vi.hoisted(() => {
  const spies: { createHttpClient?: ReturnType<typeof vi.fn> } = {}
  return {
    events: [] as string[],
    proxyAgentUrls: [] as string[],
    getHttpProxyConfiguration: vi.fn<(url?: string) => unknown>(),
    setSecret: vi.fn<(value: string) => void>(),
    debug: vi.fn<(message: string) => void>(),
    createHttpClient: (real: (...args: never[]) => unknown) => {
      spies.createHttpClient = vi.fn(real as (...args: unknown[]) => unknown)
      return spies.createHttpClient
    },
    spies,
  }
})

vi.mock('azure-pipelines-task-lib/task.js', () => ({
  getHttpProxyConfiguration: h.getHttpProxyConfiguration,
  setSecret: h.setSecret,
  debug: h.debug,
}))

vi.mock('undici', () => ({
  ProxyAgent: class {
    constructor(url: string) {
      h.events.push('dispatcher')
      h.proxyAgentUrls.push(url)
    }
  },
}))

// Partial mock: createHttpClient is spied so the options this module passes are
// observable, while resolveProxy stays REAL — the property under test above is
// that whatever spellings it produces are all registered, and a stub would let
// that pass while the real percent-encoding went unmasked.
vi.mock('@4cloudguru/pipeline-task-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@4cloudguru/pipeline-task-core')>()
  return { ...actual, createHttpClient: h.createHttpClient(actual.createHttpClient) }
})

// resolveProxy is deliberately NOT mocked: the property under test is that
// whatever spellings it produces are all registered, and a stub would let this
// pass while the real percent-encoding went unmasked.
const { buildAdoFetchOptions, createAdoHttpClient } = await import('./ado-http.js')

const withProxy = (proxyPassword: string, proxyUsername = 'user') =>
  h.getHttpProxyConfiguration.mockReturnValue({
    proxyUrl: 'http://proxy.example.com:8080',
    proxyUsername,
    proxyPassword,
  })

beforeEach(() => {
  h.events.length = 0
  h.proxyAgentUrls.length = 0
  h.getHttpProxyConfiguration.mockReset()
  h.debug.mockReset()
  h.setSecret.mockReset().mockImplementation((value: string) => {
    h.events.push(`secret:${value}`)
  })
})

describe('buildAdoFetchOptions', () => {
  it('returns an empty init when no proxy is configured, registering nothing', () => {
    h.getHttpProxyConfiguration.mockReturnValue(null)
    expect(buildAdoFetchOptions()).toEqual({})
    expect(h.setSecret).not.toHaveBeenCalled()
    expect(h.proxyAgentUrls).toHaveLength(0)
  })

  it('builds the dispatcher from the resolved proxy url', () => {
    withProxy('p4ss')
    expect(buildAdoFetchOptions()).toHaveProperty('dispatcher')
    expect(h.proxyAgentUrls).toHaveLength(1)
    expect(h.proxyAgentUrls[0]).toContain('proxy.example.com:8080')
  })

  // Half the ADO proxy contract is a per-destination decision: task-lib only
  // consults Agent.ProxyBypassList when it is handed the URL, and returns null
  // for a bypassed host. A zero-arity builder is assignable to core's
  // (url: string) => ... signature, so nothing but this test catches the drop.
  it('forwards the hop url so a bypassed destination is not proxied', () => {
    h.getHttpProxyConfiguration.mockImplementation((url?: string) =>
      url === 'https://internal.example.com/x'
        ? null
        : { proxyUrl: 'http://proxy.example.com:8080', proxyUsername: '', proxyPassword: '' },
    )

    expect(buildAdoFetchOptions('https://internal.example.com/x')).toEqual({})
    expect(h.proxyAgentUrls).toHaveLength(0)

    expect(buildAdoFetchOptions('https://elsewhere.example.com/x')).toHaveProperty('dispatcher')
    expect(h.getHttpProxyConfiguration).toHaveBeenLastCalledWith('https://elsewhere.example.com/x')
  })

  // The defect this guards: the WHATWG URL setter percent-encodes the password,
  // so the string the dispatcher embeds is byte-different from the raw value.
  // Registering only the raw one leaves the encoded form loggable.
  it('registers the percent-encoded password as well as the raw one', () => {
    const password = 'p@ss w:rd/#?'
    withProxy(password)

    buildAdoFetchOptions()

    const registered = h.setSecret.mock.calls.map(([v]) => v)
    const embedded = new URL(h.proxyAgentUrls[0] as string).password
    expect(embedded).not.toBe(password)
    expect(registered).toContain(password)
    expect(registered).toContain(embedded)
  })

  // Registering AFTER the dispatcher is built still calls setSecret, so every
  // other assertion here would keep passing while the URL had already escaped.
  // Only the relative order catches that, which is why both events share a log.
  it('registers every secret BEFORE the dispatcher is constructed', () => {
    withProxy('p@ss w:rd')

    buildAdoFetchOptions()

    const dispatcherAt = h.events.indexOf('dispatcher')
    const lastSecretAt = h.events.map((e) => e.startsWith('secret:')).lastIndexOf(true)

    expect(dispatcherAt).toBeGreaterThan(-1)
    expect(lastSecretAt).toBeGreaterThan(-1)
    expect(lastSecretAt).toBeLessThan(dispatcherAt)
  })

  it('masks userinfo embedded directly in Agent.ProxyUrl', () => {
    h.getHttpProxyConfiguration.mockReturnValue({
      proxyUrl: 'http://embedded:s3cret@proxy.example.com:8080',
    })

    buildAdoFetchOptions()

    expect(h.setSecret.mock.calls.map(([v]) => v)).toContain('s3cret')
  })
})

describe('createAdoHttpClient', () => {
  const messages = {
    insecureUrl: (url: string) => `insecure ${url}`,
    requestFailed: (url: string, status: number) => `failed ${url} ${status}`,
  }

  it('returns a client exposing the transport surface tasks consume', () => {
    h.getHttpProxyConfiguration.mockReturnValue(null)

    const client = createAdoHttpClient({ messages })

    for (const method of [
      'fetchWithTimeout',
      'fetchText',
      'fetchTextAllow404',
      'fetchBuffer',
      'fetchBufferAllow404',
      'fetchJson',
      'downloadToFile',
    ] as const) {
      expect(typeof client[method]).toBe('function')
    }
  })

  // The GitHub release-asset exception is opt-in here precisely so a caller that
  // only ever talks to releases.hashicorp.com does not inherit a wider redirect
  // surface. Passing it through unchanged is what makes that opt-in real.
  it('forwards an explicit redirect policy', () => {
    h.getHttpProxyConfiguration.mockReturnValue(null)
    const redirectPolicy = () => true

    createAdoHttpClient({ messages, redirectPolicy })

    const passed = h.spies.createHttpClient?.mock.calls.at(-1)?.[0] as {
      redirectPolicy?: unknown
    }
    expect(passed.redirectPolicy).toBe(redirectPolicy)
  })

  // Omitted rather than passed as undefined: the core client applies its own
  // same-host default, and an explicit undefined could override it.
  it('omits redirectPolicy entirely when none is given', () => {
    h.getHttpProxyConfiguration.mockReturnValue(null)

    createAdoHttpClient({ messages })

    const passed = h.spies.createHttpClient?.mock.calls.at(-1)?.[0] as object
    expect(Object.hasOwn(passed, 'redirectPolicy')).toBe(false)
  })
})
