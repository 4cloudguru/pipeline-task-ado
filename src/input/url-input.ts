// The `.js` extensions are load-bearing: azure-pipelines-task-lib is CommonJS with
// no `exports` map, so under ESM resolution an extensionless subpath does not
// resolve at all (ERR_MODULE_NOT_FOUND). CJS is unaffected either way.
import { debug, loc } from 'azure-pipelines-task-lib/task.js'
import * as im from 'azure-pipelines-task-lib/internal.js'
import { extractUrlUserInfoSecrets, redactUrlUserInfo } from '@4cloudguru/pipeline-task-core'

import { EnvironmentVariableHelper } from '../environment-variables/environment-variables.js'

/**
 * Every absolute URL in a free-form value: `scheme://...` up to whitespace or a
 * quote. A whole-URL input matches once; a `key=value` blob, an argument
 * string or a multi-line variables input matches wherever a URL is embedded
 * (`HTTPS_PROXY=https://user:token@proxy.corp/`,
 * `module_source=git::https://user:pat@host/repo`).
 * The scheme is bounded (no registered scheme is longer than a few dozen
 * characters) so a scan of a long value with no `://` in it stays linear:
 * an unbounded `[A-Za-z0-9+.-]*` re-reads the same run of letters from every
 * start position (CodeQL js/polynomial-redos).
 */
const EMBEDDED_URL = /[A-Za-z][A-Za-z0-9+.-]{0,63}:\/\/[^\s'"`<>]+/g

/**
 * Registers every spelling of any `user:password@` found in `text` -- as a
 * whole URL or embedded in a larger value -- with the masker and the
 * exact-match scrub. Idempotent; a value with no userinfo registers nothing.
 */
export function maskUrlCredentialsIn(text: string): void {
  const candidates = text.match(EMBEDDED_URL) ?? [text]
  for (const candidate of candidates) {
    for (const secret of extractUrlUserInfoSecrets(candidate)) {
      EnvironmentVariableHelper.registerSecret(secret)
    }
  }
}

/** `text` with the userinfo of every embedded URL redacted; for the debug line. */
export function redactUrlCredentialsIn(text: string): string {
  if (!EMBEDDED_URL.test(text)) {
    return redactUrlUserInfo(text)
  }
  return text.replace(EMBEDDED_URL, (url) => redactUrlUserInfo(url))
}

/**
 * Reads a task input that may hold a URL an operator has put a credential
 * into (`https://user:token@host/...`) -- as the whole value, or embedded in a
 * free-form value such as a variables block, a proxy setting or an argument
 * string -- without letting that credential reach the build log first.
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
 *   2. registers every spelling of any userinfo in it (raw and percent-decoded,
 *      in every URL the value contains) with the masker AND the exact-match
 *      scrub, before returning;
 *   3. then writes the same debug line `getInput()` would have written, with
 *      the userinfo redacted, so the diagnostic is kept.
 *
 * It does NOT validate the value: callers still pass it through
 * `assertPlainUrlBase` (or their own validator), which decides whether userinfo
 * is acceptable at all for that input. For an input that IS a credential (a
 * `password`-typed API key or token) use `readSecretInput`, which registers
 * the whole value.
 */
export function readUrlInput(name: string, required: true): string
export function readUrlInput(name: string, required?: boolean): string | undefined
export function readUrlInput(name: string, required = false): string | undefined {
  const raw = im._vault.retrieveSecret('INPUT_' + im._getVariableKey(name)) as string | undefined
  if (required && !raw) {
    // task-lib's own (localized) LIB_InputRequired, so a missing URL input
    // reads the same as any other missing input on every agent culture.
    throw new Error(loc('LIB_InputRequired', name))
  }
  if (raw) {
    maskUrlCredentialsIn(raw)
  }
  debug(`${name}=${raw ? redactUrlCredentialsIn(raw) : raw}`)
  return raw || undefined
}
