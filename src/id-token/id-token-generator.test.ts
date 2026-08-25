/**
 * SCOPE — what a green run here does and does not claim.
 *
 * DOES claim: the token exchange rejects a missing/non-https/host-disallowed
 * SYSTEM_OIDCREQUESTURI before any network call; a *.visualstudio.com host is
 * only trusted when the job's own collection URI names the SAME org; the
 * request is routed through the agent proxy via buildAdoFetchOptions; a 5xx or
 * 429 response is retried and a deterministic 4xx is not; both the agent
 * access token and the returned OIDC token are registered as secrets.
 *
 * Does NOT claim: end-to-end behavior against a real Azure DevOps OIDC
 * endpoint — fetch is stubbed throughout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  debug: vi.fn(),
  getEndpointAuthorizationParameter: vi.fn<(...args: unknown[]) => string | undefined>(),
  setSecret: vi.fn(),
  buildAdoFetchOptions: vi.fn<(url?: string) => RequestInit>(),
}))

vi.mock('azure-pipelines-task-lib/task.js', () => ({
  debug: h.debug,
  getEndpointAuthorizationParameter: h.getEndpointAuthorizationParameter,
  setSecret: h.setSecret,
}))

vi.mock('../http/ado-http.js', () => ({
  buildAdoFetchOptions: h.buildAdoFetchOptions,
}))

const { generateIdToken } = await import('./id-token-generator.js')

let originalFetch: typeof globalThis.fetch
let originalEnv: Record<string, string | undefined>

beforeEach(() => {
  originalFetch = globalThis.fetch
  originalEnv = { ...process.env }
  h.debug.mockReset()
  h.setSecret.mockReset()
  h.buildAdoFetchOptions.mockReset().mockReturnValue({})
  h.getEndpointAuthorizationParameter.mockReset().mockReturnValue('agent-access-token')
  process.env['SYSTEM_OIDCREQUESTURI'] = 'https://vstoken.dev.azure.com/oidc'
})

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key]
  }
  Object.assign(process.env, originalEnv)
})

function stubFetchOk(oidcToken = 'federated-token') {
  const inits: RequestInit[] = []
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    inits.push(init)
    return new Response(JSON.stringify({ oidcToken }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof globalThis.fetch
  return inits
}

describe('SYSTEM_OIDCREQUESTURI validation (before any network call)', () => {
  it('rejects when unset', async () => {
    delete process.env['SYSTEM_OIDCREQUESTURI']
    await expect(generateIdToken('sc-id')).rejects.toThrow('SYSTEM_OIDCREQUESTURI is not set')
  })

  it('rejects a non-URL value', async () => {
    process.env['SYSTEM_OIDCREQUESTURI'] = 'not a url'
    await expect(generateIdToken('sc-id')).rejects.toThrow('is not a valid URL')
  })

  it('rejects a non-https scheme', async () => {
    process.env['SYSTEM_OIDCREQUESTURI'] = 'http://vstoken.dev.azure.com/oidc'
    await expect(generateIdToken('sc-id')).rejects.toThrow('must be an https:// URL')
  })

  it.each([['dev.azure.com'], ['vstoken.dev.azure.com'], ['myorg.dev.azure.com']])(
    'accepts the cloud host %s',
    async (host) => {
      process.env['SYSTEM_OIDCREQUESTURI'] = `https://${host}/oidc`
      stubFetchOk()
      await expect(generateIdToken('sc-id')).resolves.toBe('federated-token')
    },
  )

  it('rejects an arbitrary host', async () => {
    process.env['SYSTEM_OIDCREQUESTURI'] = 'https://attacker.example.com/oidc'
    const err = (await generateIdToken('sc-id').catch((e: unknown) => e)) as Error
    expect(err.message).toContain('not a recognized Azure DevOps OIDC endpoint')
    // The allowed hosts and the reason are what make this actionable.
    expect(err.message).toContain('vstoken.dev.azure.com')
    expect(err.message).toContain('*.visualstudio.com')
    expect(err.message).toContain('refusing to send the job access token to it')
  })

  it('trusts a *.visualstudio.com host when the collection URI names the SAME org', async () => {
    process.env['SYSTEM_OIDCREQUESTURI'] = 'https://myorg.visualstudio.com/oidc'
    process.env['SYSTEM_COLLECTIONURI'] = 'https://myorg.visualstudio.com/'
    stubFetchOk()
    await expect(generateIdToken('sc-id')).resolves.toBe('federated-token')
  })

  it('rejects a *.visualstudio.com host for a DIFFERENT org than the collection URI', async () => {
    process.env['SYSTEM_OIDCREQUESTURI'] = 'https://attacker-org.visualstudio.com/oidc'
    process.env['SYSTEM_COLLECTIONURI'] = 'https://myorg.visualstudio.com/'
    const err = (await generateIdToken('sc-id').catch((e: unknown) => e)) as Error
    expect(err.message).toContain('not a recognized Azure DevOps OIDC endpoint')
    // The host does match the *.visualstudio.com entry the message lists, so
    // the message has to say it was the org that failed.
    expect(err.message).toContain("System.CollectionUri names 'myorg'")
  })

  it('rejects a *.visualstudio.com host when no collection URI is available to vouch for it', async () => {
    process.env['SYSTEM_OIDCREQUESTURI'] = 'https://myorg.visualstudio.com/oidc'
    delete process.env['SYSTEM_COLLECTIONURI']
    delete process.env['SYSTEM_TEAMFOUNDATIONCOLLECTIONURI']
    const err = (await generateIdToken('sc-id').catch((e: unknown) => e)) as Error
    expect(err.message).toContain('not a recognized Azure DevOps OIDC endpoint')
    expect(err.message).toContain('unset, unparseable, or uses the dev.azure.com form')
  })

  it('trusts an on-prem host equal to the collection URI host', async () => {
    process.env['SYSTEM_OIDCREQUESTURI'] = 'https://ado.internal.example.com/oidc'
    process.env['SYSTEM_COLLECTIONURI'] = 'https://ado.internal.example.com/collection'
    stubFetchOk()
    await expect(generateIdToken('sc-id')).resolves.toBe('federated-token')
  })
})

describe('proxy routing', () => {
  it('spreads buildAdoFetchOptions into the request', async () => {
    h.buildAdoFetchOptions.mockReturnValue({
      dispatcher: 'proxy-dispatcher',
    } as unknown as RequestInit)
    const inits = stubFetchOk()
    await generateIdToken('sc-id')
    expect((inits[0] as unknown as { dispatcher: string }).dispatcher).toBe('proxy-dispatcher')
  })

  it('keeps redirect:"error" and an abort signal even with a proxy configured', async () => {
    h.buildAdoFetchOptions.mockReturnValue({
      dispatcher: 'proxy-dispatcher',
    } as unknown as RequestInit)
    const inits = stubFetchOk()
    await generateIdToken('sc-id')
    expect(inits[0]?.redirect).toBe('error')
    expect(inits[0]?.signal).toBeTruthy()
  })
})

describe('secret registration', () => {
  it('registers the agent access token and the returned OIDC token', async () => {
    stubFetchOk('the-oidc-token')
    await generateIdToken('sc-id')
    expect(h.setSecret).toHaveBeenCalledWith('agent-access-token')
    expect(h.setSecret).toHaveBeenCalledWith('the-oidc-token')
  })

  it('fails when the agent access token is unavailable', async () => {
    h.getEndpointAuthorizationParameter.mockReturnValue(undefined)
    await expect(generateIdToken('sc-id')).rejects.toThrow('AccessToken is not available')
  })
})

describe('network and abort failures', () => {
  it('wraps a fetch network failure with a distinguishing message', async () => {
    globalThis.fetch = (async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    }) as unknown as typeof globalThis.fetch
    await expect(generateIdToken('sc-id')).rejects.toThrow('Failed to acquire federated token from')
  })

  it('reports a fetch abort as a timeout', async () => {
    globalThis.fetch = (async () => {
      const err = new Error('This operation was aborted')
      err.name = 'AbortError'
      throw err
    }) as unknown as typeof globalThis.fetch
    await expect(generateIdToken('sc-id')).rejects.toThrow('Timed out acquiring federated token')
  })

  it('propagates a body-parse failure that is not an abort', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => {
          throw new Error('Unexpected token in JSON')
        },
      }) as unknown as Response) as unknown as typeof globalThis.fetch
    await expect(generateIdToken('sc-id')).rejects.toThrow('Unexpected token in JSON')
  })

  it('reports a body-read abort as a timeout', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => {
          const err = new Error('This operation was aborted')
          err.name = 'AbortError'
          throw err
        },
      }) as unknown as Response) as unknown as typeof globalThis.fetch
    await expect(generateIdToken('sc-id')).rejects.toThrow('Timed out acquiring federated token')
  })
})

describe('retry behavior', () => {
  it('retries a 503 and succeeds on the next attempt', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      if (calls === 1) return new Response('', { status: 503 })
      return new Response(JSON.stringify({ oidcToken: 'federated-token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof globalThis.fetch
    await expect(generateIdToken('sc-id')).resolves.toBe('federated-token')
    expect(calls).toBe(2)
  })

  it('does not retry a deterministic 401', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return new Response('', { status: 401 })
    }) as unknown as typeof globalThis.fetch
    await expect(generateIdToken('sc-id')).rejects.toThrow('HTTP 401')
    expect(calls).toBe(1)
  })

  it('fails after exhausting retries on repeated 5xx', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return new Response('', { status: 503 })
    }) as unknown as typeof globalThis.fetch
    await expect(generateIdToken('sc-id')).rejects.toThrow('HTTP 503')
    expect(calls).toBe(3)
  })
})

describe('malformed responses', () => {
  it('fails when the response has no oidcToken field', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof globalThis.fetch
    await expect(generateIdToken('sc-id')).rejects.toThrow(
      'Failed to acquire a federated (OIDC) ID token for the service connection',
    )
  })
})
