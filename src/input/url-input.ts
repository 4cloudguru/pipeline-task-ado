// The `.js` extensions are load-bearing: azure-pipelines-task-lib is CommonJS with
// no `exports` map, so under ESM resolution an extensionless subpath does not
// resolve at all (ERR_MODULE_NOT_FOUND). CJS is unaffected either way.
import { debug } from 'azure-pipelines-task-lib/task.js'
import * as im from 'azure-pipelines-task-lib/internal.js'
import { extractUrlUserInfoSecrets, redactUrlUserInfo } from '@4cloudguru/pipeline-task-core'

import { EnvironmentVariableHelper } from '../environment-variables/environment-variables.js'

/**
 * Reads a task input that holds a URL an operator may have put a credential
 * into (`https://user:token@host/...`), without letting that credential reach
 * the build log first.
 *
 * `getInput()` cannot be used for such a value. task-lib's implementation ends
 * with
 *
 *     debug(name + '=' + inval)
 *
 * so the raw input is emitted as a `##vso[task.debug]` line at READ time —
 * strictly before the caller has any opportunity to mask it, and the agent's
 * masker only redacts values that were registered before the line was written.
 * With `System.Debug` on, a PAT embedded in a registry, mirror or clone URL is
 * therefore printed by the act of reading the input, whatever the task does
 * next (azure-pipelines-terraform#1105 finding 1, found by a test that asserted
 * the credential never appears in the run output).
 *
 * task-lib vaults every `INPUT_*` variable at load and deletes it from
 * `process.env`, so the only silent path is the vault itself. This helper:
 *   1. retrieves the value from the vault exactly as `getInput()` does, minus
 *      the debug line;
 *   2. registers every spelling of any userinfo in it (raw and percent-decoded)
 *      with the masker AND the exact-match scrub, before returning;
 *   3. then writes the same debug line `getInput()` would have written, with
 *      the userinfo redacted, so the diagnostic is kept.
 *
 * It does NOT validate the value: callers still pass it through
 * `assertPlainUrlBase` (or their own validator), which decides whether userinfo
 * is acceptable at all for that input.
 */
export function readUrlInput(name: string, required: true): string
export function readUrlInput(name: string, required?: boolean): string | undefined
export function readUrlInput(name: string, required = false): string | undefined {
  const raw = im._vault.retrieveSecret('INPUT_' + im._getVariableKey(name)) as string | undefined
  if (required && !raw) {
    // task-lib's own LIB_InputRequired text, so a missing URL input reads the
    // same as any other missing input.
    throw new Error(`Input required: ${name}`)
  }
  if (raw) {
    for (const secret of extractUrlUserInfoSecrets(raw)) {
      EnvironmentVariableHelper.registerSecret(secret)
    }
  }
  debug(`${name}=${raw ? redactUrlUserInfo(raw) : raw}`)
  return raw || undefined
}
