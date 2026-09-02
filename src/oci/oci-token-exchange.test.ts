/**
 * SCOPE — what a green run here does and does not claim.
 *
 * DOES claim: the identity-domain URL is validated BEFORE any network call (an
 * invalid host means fetch is never reached, so the federated JWT never
 * leaves); only Oracle-owned realms with a well-formed `idcs-<32 hex>` first
 * label are accepted, and a look-alike suffix is rejected; the request is
 * routed through the agent proxy via buildAdoFetchOptions and refuses to
 * follow redirects; a 5xx/429 is retried and a deterministic 4xx is not; a
 * Retry-After is honored over the default backoff; a reflected OIDC token in
 * an error body is scrubbed before it reaches the thrown message; a non-JSON
 * 200 surfaces as a clear error rather than a raw SyntaxError.
 *
 * Does NOT claim: end-to-end behavior against a real OCI Identity Domains
 * endpoint — fetch is stubbed throughout.
 */
import { generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  debug: vi.fn(),
  buildAdoFetchOptions: vi.fn<(url?: string) => RequestInit>(),
}))

vi.mock('azure-pipelines-task-lib/task.js', () => ({
  debug: h.debug,
}))

vi.mock('../http/ado-http.js', () => ({
  buildAdoFetchOptions: h.buildAdoFetchOptions,
}))

const { exchangeOidcForUpst, OciTokenExchangeError, validateIdentityDomainUrl } =
  await import('./oci-token-exchange.js')

/** A real RSA public key, so publicKeyToBase64Der runs for real rather than being stubbed. */
const { publicKey: PUBLIC_KEY_PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

/** 32 lowercase hex characters — the shape a real identity-domain first label has. */
const VALID_DOMAIN = 'https://idcs-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.identity.oraclecloud.com'

let originalFetch: typeof globalThis.fetch

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

beforeEach(() => {
  originalFetch = globalThis.fetch
  h.debug.mockReset()
  h.buildAdoFetchOptions.mockReset().mockReturnValue({})
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('validateIdentityDomainUrl', () => {
  it('accepts each Oracle realm suffix with a well-formed first label', () => {
    for (const suffix of [
      'identity.oraclecloud.com',
      'identity.oraclegovcloud.com',
      'identity.oraclegovcloud.uk',
      'identity.oraclecloud.eu',
    ]) {
      const url = `https://idcs-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.${suffix}`
      expect(validateIdentityDomainUrl(url).hostname).toBe(
        `idcs-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.${suffix}`,
      )
    }
  })

  it('accepts a mixed-case first label (host comparison is lowercased)', () => {
    expect(() =>
      validateIdentityDomainUrl(
        'https://IDCS-CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC.identity.oraclecloud.com',
      ),
    ).not.toThrow()
  })

  it('accepts a path-bearing URL (deliberately supported configuration)', () => {
    expect(validateIdentityDomainUrl(`${VALID_DOMAIN}/some/base`).pathname).toBe('/some/base')
  })

  it('rejects a non-HTTPS scheme', () => {
    expect(() => validateIdentityDomainUrl(VALID_DOMAIN.replace('https:', 'http:'))).toThrow(
      /must use HTTPS scheme/,
    )
  })

  it('rejects a value that is not a URL at all', () => {
    expect(() => validateIdentityDomainUrl('not a url')).toThrow(/is not a valid URL/)
  })

  it('rejects a host outside the Oracle realms', () => {
    expect(() => validateIdentityDomainUrl('https://evil.example.com')).toThrow(
      /is not an OCI Identity Domains endpoint/,
    )
  })

  it('rejects a look-alike suffix that merely contains a realm', () => {
    // The endsWith + length check is what stops this: the realm appears in the
    // host, but not as its suffix.
    expect(() =>
      validateIdentityDomainUrl('https://identity.oraclecloud.com.evil.example'),
    ).toThrow(/is not an OCI Identity Domains endpoint/)
  })

  it('rejects a bare realm host with no domain label', () => {
    // Passes the suffix check (endsWith is true, length is greater), and is
    // caught by the first-label shape check instead.
    expect(() => validateIdentityDomainUrl('https://www.identity.oraclecloud.com')).toThrow(
      /does not match the OCI Identity Domains\s+hostname shape/,
    )
  })

  it('rejects a first label that is too short or non-hex', () => {
    for (const label of ['idcs-abc123', 'idcs-gggggggggggggggggggggggggggggggg', 'notidcs-x']) {
      expect(() => validateIdentityDomainUrl(`https://${label}.identity.oraclecloud.com`)).toThrow(
        /hostname shape/,
      )
    }
  })
})

describe('exchangeOidcForUpst', () => {
  it('never calls fetch when the identity domain is invalid — the JWT must not leave', async () => {
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return jsonResponse({ access_token: 'nope' })
    }) as unknown as typeof globalThis.fetch

    await expect(
      exchangeOidcForUpst('oidc-jwt', 'https://evil.example.com', 'client', PUBLIC_KEY_PEM),
    ).rejects.toThrow(/is not an OCI Identity Domains endpoint/)
    expect(called).toBe(false)
  })

  it('POSTs to the token endpoint with redirect:manual and the proxy options', async () => {
    let seenUrl: string | undefined
    let seenInit: RequestInit | undefined
    h.buildAdoFetchOptions.mockReturnValue({ keepalive: true } as RequestInit)
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seenUrl = url
      seenInit = init
      return jsonResponse({ access_token: 'the-upst' })
    }) as unknown as typeof globalThis.fetch

    const upst = await exchangeOidcForUpst('oidc-jwt', VALID_DOMAIN, 'client-id', PUBLIC_KEY_PEM)

    expect(upst).toBe('the-upst')
    expect(seenUrl).toBe(`${VALID_DOMAIN}/oauth2/v1/token`)
    expect(seenInit?.redirect).toBe('manual')
    expect(seenInit?.method).toBe('POST')
    expect((seenInit as { keepalive?: boolean }).keepalive).toBe(true)
    expect(h.buildAdoFetchOptions).toHaveBeenCalledWith(`${VALID_DOMAIN}/oauth2/v1/token`)

    const body = new URLSearchParams(seenInit?.body as string)
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:token-exchange')
    expect(body.get('requested_token_type')).toBe('urn:oci:token-type:oci-upst')
    expect(body.get('subject_token')).toBe('oidc-jwt')
    expect(body.get('client_id')).toBe('client-id')
    // Base64 SPKI DER — armor and line breaks removed.
    expect(body.get('public_key')).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })

  it('strips a trailing slash before appending the endpoint path', async () => {
    let seenUrl: string | undefined
    globalThis.fetch = (async (url: string) => {
      seenUrl = url
      return jsonResponse({ access_token: 'x' })
    }) as unknown as typeof globalThis.fetch

    await exchangeOidcForUpst('jwt', `${VALID_DOMAIN}/`, 'client', PUBLIC_KEY_PEM)
    expect(seenUrl).toBe(`${VALID_DOMAIN}/oauth2/v1/token`)
  })

  it('accepts `token` as a fallback for `access_token`', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ token: 'fallback-upst' })) as unknown as typeof globalThis.fetch

    await expect(exchangeOidcForUpst('jwt', VALID_DOMAIN, 'client', PUBLIC_KEY_PEM)).resolves.toBe(
      'fallback-upst',
    )
  })

  it('throws when the response carries neither token field', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ nothing: 'here' })) as unknown as typeof globalThis.fetch

    await expect(
      exchangeOidcForUpst('jwt', VALID_DOMAIN, 'client', PUBLIC_KEY_PEM),
    ).rejects.toThrow(/missing access_token\/token field/)
  })

  it('surfaces a non-JSON 200 as a clear error, not a raw SyntaxError', async () => {
    globalThis.fetch = (async () =>
      new Response('<html>captive portal</html>', {
        status: 200,
      })) as unknown as typeof globalThis.fetch

    const err = await exchangeOidcForUpst('jwt', VALID_DOMAIN, 'client', PUBLIC_KEY_PEM).catch(
      (e: unknown) => e,
    )

    expect(err).toBeInstanceOf(OciTokenExchangeError)
    expect((err as Error).message).toMatch(/non-JSON response/)
    expect((err as Error).name).not.toBe('SyntaxError')
  })

  it('refuses an opaqueredirect without following it', async () => {
    globalThis.fetch = (async () => {
      // A real opaqueredirect has status 0, but the Response constructor
      // refuses anything outside 200-599 — so build a valid one and override
      // both properties to reproduce the shape fetch actually surfaces.
      const r = new Response(null, { status: 204 })
      Object.defineProperty(r, 'type', { value: 'opaqueredirect' })
      Object.defineProperty(r, 'status', { value: 0 })
      return r
    }) as unknown as typeof globalThis.fetch

    await expect(
      exchangeOidcForUpst('jwt', VALID_DOMAIN, 'client', PUBLIC_KEY_PEM),
    ).rejects.toThrow(/returned a redirect/)
  })

  it('refuses a raw 3xx without following it', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return new Response(null, { status: 302, headers: { location: 'https://evil.example' } })
    }) as unknown as typeof globalThis.fetch

    await expect(
      exchangeOidcForUpst('jwt', VALID_DOMAIN, 'client', PUBLIC_KEY_PEM),
    ).rejects.toThrow(/refusing to forward the OIDC token/)
    // A redirect will not resolve to a token on repeat — it must not be retried.
    expect(calls).toBe(1)
  })

  it('scrubs a reflected OIDC token out of an error body while keeping diagnostics', async () => {
    const secretJwt = 'header.payload-that-is-long-enough.signature'
    globalThis.fetch = (async () =>
      new Response(`invalid subject_token: ${secretJwt}`, {
        status: 400,
        statusText: 'Bad Request',
      })) as unknown as typeof globalThis.fetch

    let err: unknown
    try {
      await exchangeOidcForUpst(secretJwt, VALID_DOMAIN, 'client', PUBLIC_KEY_PEM)
    } catch (e: unknown) {
      err = e
    }

    expect(err).toBeInstanceOf(Error)
    const message = (err as Error).message
    expect(message).not.toContain(secretJwt)
    expect(message).toContain('***')
    // The status is diagnostics, not a secret — it must survive the scrub.
    expect(message).toMatch(/HTTP 400/)
  })

  it('retries a 5xx and succeeds on a later attempt', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      if (calls === 1) return new Response('upstream boom', { status: 503 })
      return jsonResponse({ access_token: 'recovered' })
    }) as unknown as typeof globalThis.fetch

    await expect(exchangeOidcForUpst('jwt', VALID_DOMAIN, 'client', PUBLIC_KEY_PEM)).resolves.toBe(
      'recovered',
    )
    expect(calls).toBe(2)
  })

  it('retries a transient network error', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      if (calls === 1) throw new Error('ECONNRESET')
      return jsonResponse({ access_token: 'recovered' })
    }) as unknown as typeof globalThis.fetch

    await expect(exchangeOidcForUpst('jwt', VALID_DOMAIN, 'client', PUBLIC_KEY_PEM)).resolves.toBe(
      'recovered',
    )
    expect(calls).toBe(2)
  })

  it('does NOT retry a deterministic 4xx', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return new Response('nope', { status: 401, statusText: 'Unauthorized' })
    }) as unknown as typeof globalThis.fetch

    await expect(
      exchangeOidcForUpst('jwt', VALID_DOMAIN, 'client', PUBLIC_KEY_PEM),
    ).rejects.toThrow(/HTTP 401/)
    expect(calls).toBe(1)
  })

  it('gives up after the bounded attempt count on a persistent 5xx', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return new Response('still down', { status: 503 })
    }) as unknown as typeof globalThis.fetch

    await expect(
      exchangeOidcForUpst('jwt', VALID_DOMAIN, 'client', PUBLIC_KEY_PEM),
    ).rejects.toThrow(/HTTP 503/)
    expect(calls).toBe(3)
  })

  it('retries a 429 and honors Retry-After over the default backoff', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      if (calls === 1) {
        return new Response('slow down', { status: 429, headers: { 'retry-after': '1' } })
      }
      return jsonResponse({ access_token: 'after-wait' })
    }) as unknown as typeof globalThis.fetch

    const started = Date.now()
    await expect(exchangeOidcForUpst('jwt', VALID_DOMAIN, 'client', PUBLIC_KEY_PEM)).resolves.toBe(
      'after-wait',
    )
    // 1s from Retry-After, not the 200ms default backoff.
    expect(Date.now() - started).toBeGreaterThanOrEqual(900)
    expect(calls).toBe(2)
  }, 10000)

  it('reports an aborted attempt as a timeout', async () => {
    globalThis.fetch = (async () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    }) as unknown as typeof globalThis.fetch

    await expect(
      exchangeOidcForUpst('jwt', VALID_DOMAIN, 'client', PUBLIC_KEY_PEM),
    ).rejects.toThrow(/Timed out/)
  }, 10000)
})
