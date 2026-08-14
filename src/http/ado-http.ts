import { debug, getHttpProxyConfiguration, setSecret } from 'azure-pipelines-task-lib/task.js'
import { ProxyAgent } from 'undici'
import {
  createHttpClient,
  resolveProxy,
  type HttpClient,
  type HttpMessages,
  type RedirectPolicy,
} from '@4cloudguru/pipeline-task-core'

/**
 * Per-attempt fetch init carrying the agent's proxy.
 *
 * The ordering is the security property, not an implementation detail: the
 * agent's masker matches registered literals rather than derivations of them,
 * and resolveProxy returns every spelling of the credential it produced —
 * including the percent-encoded form the dispatcher URL actually embeds, and
 * any userinfo already inside Agent.ProxyUrl. All of them must be registered
 * BEFORE proxyUrl is handed to a dispatcher or interpolated into a message.
 * resolveProxy cannot do it itself; the package it lives in does not import
 * the task lib. That obligation is the reason this function exists here.
 */
export function buildAdoFetchOptions(): RequestInit {
  const resolved = resolveProxy(getHttpProxyConfiguration())
  if (!resolved) return {}

  for (const secret of resolved.secrets) {
    setSecret(secret)
  }

  return {
    // @ts-expect-error Node's fetch accepts an undici dispatcher at runtime.
    dispatcher: new ProxyAgent(resolved.proxyUrl),
  }
}

export interface AdoHttpClientOptions {
  /**
   * Failure text. Kept a parameter because it is the one genuinely per-task
   * part: the strings come from each task's own resource file via tasks.loc,
   * and "registry request failed" is wrong on a releases.hashicorp.com fetch.
   */
  messages: HttpMessages
  /**
   * Defaults to the core client's own same-host rule. Pass
   * anyRedirectPolicy(sameHostOnly, githubAssetRedirects) only for callers that
   * really do fetch GitHub release assets — enabling it estate-wide widens the
   * redirect surface for callers that never need it.
   */
  redirectPolicy?: RedirectPolicy
}

/** An HTTPS-pinned client wired to this agent's proxy, debug channel and text. */
export function createAdoHttpClient(options: AdoHttpClientOptions): HttpClient {
  return createHttpClient({
    // Re-evaluated per attempt, so a proxy change between retries is picked up.
    fetchOptions: buildAdoFetchOptions,
    // Passed by reference rather than wrapped: a forwarding lambda would be an
    // extra function no test can meaningfully reach, and task-lib's debug does
    // not close over `this`.
    debug,
    messages: options.messages,
    ...(options.redirectPolicy ? { redirectPolicy: options.redirectPolicy } : {}),
  })
}
