// The `.js` extensions are load-bearing: azure-pipelines-task-lib is CommonJS with
// no `exports` map, so under ESM resolution an extensionless subpath does not
// resolve at all (ERR_MODULE_NOT_FOUND). CJS is unaffected either way.
import { debug, loc } from 'azure-pipelines-task-lib/task.js'
import * as im from 'azure-pipelines-task-lib/internal.js'

import { maskSecretLines } from '../endpoint/endpoint-data-secret.js'

/**
 * Reads a task input that IS a credential -- a `password`-typed input such as an
 * API key, a PAT, an OAuth client secret, a pre-authenticated-request URL --
 * without letting its value reach the build log first.
 *
 * `getInput()` ends with `debug(name + '=' + inval)`, so the raw value is
 * emitted as a `##vso[task.debug]` line at READ time. The agent masks that line
 * only when the value was already registered: a value that arrived through a
 * secret pipeline variable is, a value typed into the input as a literal is
 * not. Every task here registers the value with `setSecret` a few lines after
 * reading it, which is a few lines too late for the debug line (see
 * `readUrlInput` for the URL-shaped case that surfaced this, and
 * `readSecretEndpointDataParameter` for the service-connection case).
 *
 * This helper retrieves the value from task-lib's vault exactly as `getInput()`
 * does, registers it line-wise with the masker and the exact-match scrub BEFORE
 * returning (line-wise because `setSecret` throws on CR/LF, and a PEM pasted
 * into a password box is one "line" that starts with `-----BEGIN`), and writes
 * the debug line with the value replaced by `***`.
 */
export function readSecretInput(name: string, required: true): string
export function readSecretInput(name: string, required?: boolean): string | undefined
export function readSecretInput(name: string, required = false): string | undefined {
  const raw = im._vault.retrieveSecret('INPUT_' + im._getVariableKey(name)) as string | undefined
  if (required && !raw) {
    // task-lib's own (localized) LIB_InputRequired.
    throw new Error(loc('LIB_InputRequired', name))
  }
  if (raw) {
    maskSecretLines(raw)
  }
  debug(`${name}=${raw ? '***' : raw}`)
  return raw || undefined
}
