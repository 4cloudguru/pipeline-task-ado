// The `.js` extensions are load-bearing: azure-pipelines-task-lib is CommonJS with
// no `exports` map, so under ESM resolution an extensionless subpath does not
// resolve at all (ERR_MODULE_NOT_FOUND). CJS is unaffected either way.
import { debug, loc } from 'azure-pipelines-task-lib/task.js'

import { maskUrlCredentialsIn, redactUrlCredentialsIn } from '../input/url-input.js'

/**
 * Reads a service connection's URL without letting an embedded credential
 * reach the build log first.
 *
 * `getEndpointUrl()` is
 *
 *     var urlval = process.env['ENDPOINT_URL_' + id]; ...; debug(id + '=' + urlval)
 *
 * The endpoint URL is NOT among the variables task-lib vaults at load (only
 * `ENDPOINT_AUTH_*` is), and unlike an endpoint's auth parameters the agent
 * does not pre-register it as a secret -- an operator who wrote the connection
 * as `https://user:token@vcenter.example.com/sdk` has a credential in a value
 * that is printed by the act of reading it (azure-pipelines-terraform#1105,
 * class sweep). This helper reads the same variable, registers every spelling
 * of any userinfo in it with the masker and the exact-match scrub, then writes
 * the same debug line `getEndpointUrl()` would have written, redacted.
 *
 * The id is used verbatim, as task-lib does (it is not upper-cased). The value
 * is not validated and not removed from the environment: the task-lib
 * accessors and the tool child process may still need it.
 */
export function readEndpointUrl(id: string, optional: true): string | undefined
export function readEndpointUrl(id: string, optional?: false): string
export function readEndpointUrl(id: string, optional = false): string | undefined {
  const url = process.env['ENDPOINT_URL_' + id]
  if (!optional && !url) {
    // task-lib's own (localized) LIB_EndpointNotExist.
    throw new Error(loc('LIB_EndpointNotExist', id))
  }
  if (url) {
    maskUrlCredentialsIn(url)
  }
  debug(`${id}=${url ? redactUrlCredentialsIn(url) : url}`)
  return url || undefined
}
