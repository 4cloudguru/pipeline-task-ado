import { debug, getEndpointAuthorizationParameter } from 'azure-pipelines-task-lib/task.js'
import { parseRetryAfterMs, retryAsync } from '@4cloudguru/pipeline-task-core'
import { buildAdoFetchOptions } from '../http/ado-http.js'
import { EnvironmentVariableHelper } from '../environment-variables/environment-variables.js'

export async function generateIdToken(serviceConnectionID: string): Promise<string> {
  const tokenGenerator = new TokenGenerator()
  return tokenGenerator.generate(serviceConnectionID)
}

/**
 * Carries whether a federated-token fetch failure is worth retrying (transient
 * 5xx / 429) vs deterministic (other 4xx), plus the capped Retry-After delay
 * when a retryable response supplied one.
 */
class FederatedTokenError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'FederatedTokenError'
  }
}

/** Exact hosts that identify a genuine Azure DevOps (cloud) OIDC token endpoint. */
const ADO_OIDC_HOSTS = ['dev.azure.com', 'vstoken.dev.azure.com']
/** Host suffixes that identify a genuine Azure DevOps (cloud) OIDC token endpoint. */
const ADO_OIDC_HOST_SUFFIXES = ['.dev.azure.com', '.visualstudio.com']

/**
 * The org label of the job's own collection URI when it is a legacy
 * *.visualstudio.com URL (e.g. 'myorg' for https://myorg.visualstudio.com/),
 * or undefined when neither collection variable exposes a comparable org --
 * the dev.azure.com form carries its org in the URL path, not the host, so no
 * host-label comparison is possible for it.
 */
function collectionVisualStudioOrgLabel(): string | undefined {
  for (const envName of ['SYSTEM_COLLECTIONURI', 'SYSTEM_TEAMFOUNDATIONCOLLECTIONURI']) {
    const collectionUri = process.env[envName]
    if (!collectionUri) continue
    try {
      const collectionHost = new URL(collectionUri).hostname.toLowerCase()
      if (
        collectionHost.endsWith('.visualstudio.com') &&
        collectionHost.length > '.visualstudio.com'.length
      ) {
        return collectionHost.split('.')[0]
      }
    } catch {
      // Unparseable collection URI -- it cannot vouch for any org.
    }
  }
  return undefined
}

/**
 * Why a host was rejected, phrased for the pipeline author who has to fix it.
 * The expected-host list is derived from the allowlists above so it cannot
 * drift away from what is actually enforced.
 */
function describeDisallowedOidcHost(hostname: string): string {
  const expected = [...ADO_OIDC_HOSTS, ...ADO_OIDC_HOST_SUFFIXES.map((s) => `*${s}`)].join(', ')
  const base =
    `SYSTEM_OIDCREQUESTURI's host '${hostname}' is not a recognized Azure DevOps OIDC endpoint ` +
    `(expected ${expected}, or the host of System.CollectionUri); ` +
    `refusing to send the job access token to it.`
  if (!hostname.toLowerCase().endsWith('.visualstudio.com')) {
    return base
  }
  // Without this the rejection looks arbitrary: the host does match the
  // *.visualstudio.com entry listed above, and only the org check failed.
  const collectionOrg = collectionVisualStudioOrgLabel()
  return collectionOrg === undefined
    ? `${base} A *.visualstudio.com endpoint is trusted only for the job's own org, which is read ` +
        `from System.CollectionUri -- that variable is unset, unparseable, or uses the ` +
        `dev.azure.com form that carries the org in the path rather than the host.`
    : `${base} A *.visualstudio.com endpoint is trusted only for the job's own org, and ` +
        `System.CollectionUri names '${collectionOrg}'.`
}

/**
 * The job's SystemVssConnection AccessToken is sent as a Bearer header to
 * SYSTEM_OIDCREQUESTURI, so in addition to the https assertion the host is
 * pinned to Azure DevOps endpoints. On-prem Azure DevOps Server hosts the
 * OIDC endpoint on the collection host itself, so a host equal to the host of
 * System.CollectionUri / System.TeamFoundationCollectionUri is also allowed.
 */
function isAllowedOidcRequestHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (ADO_OIDC_HOSTS.includes(host)) {
    return true
  }
  for (const suffix of ADO_OIDC_HOST_SUFFIXES) {
    if (!host.endsWith(suffix) || host.length <= suffix.length) {
      continue
    }
    // A *.visualstudio.com host carries a tenant org as its first label, so a
    // bare suffix match would admit ANY tenant's org. Fail closed: trust the
    // host ONLY when the job's own collection URI is also a *.visualstudio.com
    // URL for the SAME org. When no comparable org label is available -- the
    // dev.azure.com collection form (org in the path, not the host), or the
    // collection variables are unset/unparseable -- a dev.azure.com-era org
    // never legitimately mints tokens at *.visualstudio.com, so reject rather
    // than fall through to the broad suffix. The org-less standard cloud
    // endpoint (vstoken.dev.azure.com) is exact-matched above and never
    // reaches this check.
    if (suffix === '.visualstudio.com') {
      const collectionOrg = collectionVisualStudioOrgLabel()
      if (collectionOrg === undefined || host.split('.')[0] !== collectionOrg) {
        continue
      }
    }
    return true
  }
  for (const envName of ['SYSTEM_COLLECTIONURI', 'SYSTEM_TEAMFOUNDATIONCOLLECTIONURI']) {
    const collectionUri = process.env[envName]
    if (!collectionUri) continue
    try {
      if (new URL(collectionUri).hostname.toLowerCase() === host) {
        return true
      }
    } catch {
      // Unparseable collection URI -- it cannot vouch for any host.
    }
  }
  return false
}

export class TokenGenerator {
  private static readonly MAX_RETRIES = 3
  private static readonly INITIAL_BACKOFF_MS = 200

  public async generate(serviceConnectionID: string): Promise<string> {
    const oidcRequestUri = process.env['SYSTEM_OIDCREQUESTURI']
    if (!oidcRequestUri) {
      throw new Error(
        'SYSTEM_OIDCREQUESTURI is not set. Ensure the pipeline is running on an agent that supports OIDC token generation.',
      )
    }
    // SYSTEM_OIDCREQUESTURI carries the job's System.AccessToken as a Bearer
    // header; assert https:// and an Azure DevOps host before that token is
    // ever sent anywhere.
    let parsedUri: URL
    try {
      parsedUri = new URL(oidcRequestUri)
    } catch {
      throw new Error(`SYSTEM_OIDCREQUESTURI is not a valid URL: ${oidcRequestUri}`)
    }
    if (parsedUri.protocol !== 'https:') {
      throw new Error(`SYSTEM_OIDCREQUESTURI must be an https:// URL, got '${oidcRequestUri}'.`)
    }
    if (!isAllowedOidcRequestHost(parsedUri.hostname)) {
      throw new Error(describeDisallowedOidcHost(parsedUri.hostname))
    }

    // The federated token is requested with only the service-connection id; no
    // custom audience/aud is set, because ADO OFFERS NO WAY TO SET ONE -- the
    // endpoint accepts `api-version` and `serviceConnectionId` and nothing else,
    // with no request body, verified against Microsoft's REST reference for
    // distributedtask/oidctoken/create at api-version 7.1 AND 7.2 (#52).
    //
    // So this is a constraint, not a preference: every cloud gets an assertion of
    // the same shape carrying ADO's default audience, differing only in `sub`, and
    // one minted for AWS is structurally acceptable to any relying party federated
    // to the same subject. The compensating control is on the relying-party side
    // and cannot be implemented here -- each trust policy must pin the issuer, the
    // audience EXACTLY, and `sub` to the exact service connection rather than a
    // prefix. SECURITY.md carries the full statement and the consumer-side links.
    //
    // If ADO ever exposes per-exchange audience selection, THIS is the call site
    // to use it: one requester serves all four clouds, so the gap has one fix.
    const url =
      oidcRequestUri +
      '?api-version=7.1&serviceConnectionId=' +
      encodeURIComponent(serviceConnectionID)

    // Bounded exponential-backoff retry via the shared retry helper.
    // MAX_RETRIES is the TOTAL attempt count, so retries = MAX_RETRIES - 1.
    return retryAsync(() => this.fetchToken(url, oidcRequestUri), {
      retries: TokenGenerator.MAX_RETRIES - 1,
      baseDelayMs: TokenGenerator.INITIAL_BACKOFF_MS,
      // A non-FederatedTokenError is a network/DNS/abort failure -- treat as
      // transient. A deterministic 4xx (bad/expired access token,
      // misconfigured service connection) is non-retryable and skips the
      // remaining attempts and their backoff delay; only a transient 5xx or
      // rate-limiting 429 FederatedTokenError is retried.
      retryError: (error) => !(error instanceof FederatedTokenError) || error.retryable,
      // Honor a capped Retry-After from a retryable response (429/5xx) over
      // the default exponential backoff.
      delayMs: (_attempt, backoffMs, outcome) =>
        outcome.kind === 'error' &&
        outcome.error instanceof FederatedTokenError &&
        outcome.error.retryAfterMs !== undefined
          ? outcome.error.retryAfterMs
          : backoffMs,
      onRetry: (attempt, delayMs, outcome) => {
        const message =
          outcome.kind === 'error'
            ? outcome.error instanceof Error
              ? outcome.error.message
              : String(outcome.error)
            : ''
        debug(
          `OIDC token request attempt ${attempt + 1} failed: ${message}. Retrying in ${delayMs}ms...`,
        )
      },
    })
  }

  private async fetchToken(url: string, oidcRequestUri: string): Promise<string> {
    const accessToken = getEndpointAuthorizationParameter(
      'SystemVssConnection',
      'AccessToken',
      false,
    )
    if (!accessToken) {
      throw new Error(
        'SystemVssConnection AccessToken is not available. ' +
          "Ensure the pipeline has 'Allow scripts to access the OAuth token' enabled and OIDC is configured for the service connection.",
      )
    }
    // The agent OAuth token is a bearer credential. Register it as a secret
    // in-module so masking does not depend on the agent's implicit
    // System.AccessToken registration, matching the token-refresh path.
    EnvironmentVariableHelper.registerSecret(accessToken)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)
    let oidcObject: { oidcToken: string }
    try {
      let response: Response
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + accessToken,
          },
          signal: controller.signal,
          // This token exchange has no legitimate redirect.
          redirect: 'error',
          ...buildAdoFetchOptions(oidcRequestUri),
        })
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error(
            `Timed out acquiring federated token from ${oidcRequestUri} (30s timeout).`,
          )
        }
        throw new Error(
          `Failed to acquire federated token from ${oidcRequestUri}: ${error instanceof Error ? error.message : error}`,
        )
      }

      if (!response.ok) {
        // Retry only on transient failures -- 5xx, or a 429 from the ADO OIDC
        // endpoint's rate limiting; a deterministic other 4xx (bad/expired
        // token, misconfigured service connection) will not change on retry.
        // A Retry-After header on a retryable response is honored (capped)
        // over the default backoff.
        const retryable = response.status >= 500 || response.status === 429
        throw new FederatedTokenError(
          `Failed to acquire federated token: HTTP ${response.status} ${response.statusText}`,
          retryable,
          retryable ? parseRetryAfterMs(response.headers.get('retry-after')) : undefined,
        )
      }

      // Read the body while the abort signal is still armed, so a stalled
      // body stream is bounded by the same 30s timeout as the connection.
      try {
        oidcObject = (await response.json()) as { oidcToken: string }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error(
            `Timed out acquiring federated token from ${oidcRequestUri} (30s timeout).`,
          )
        }
        throw error
      }
    } finally {
      // Runs on every path (success, network error, non-OK, body-parse
      // failure) -- a bare try/catch previously left the timer armed on every
      // failure, keeping the event loop alive for up to 30s/attempt.
      clearTimeout(timeoutId)
    }

    if (!oidcObject?.oidcToken) {
      throw new Error(
        'Failed to acquire a federated (OIDC) ID token for the service connection: Azure DevOps ' +
          'returned a response with no token. Verify the service connection is configured for ' +
          'Workload Identity Federation and that the pipeline is authorized to use it.',
      )
    }

    const oidcToken = oidcObject.oidcToken
    EnvironmentVariableHelper.registerSecret(oidcToken)
    return oidcToken
  }
}
