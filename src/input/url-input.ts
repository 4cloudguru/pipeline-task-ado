// The `.js` extensions are load-bearing: azure-pipelines-task-lib is CommonJS with
// no `exports` map, so under ESM resolution an extensionless subpath does not
// resolve at all (ERR_MODULE_NOT_FOUND). CJS is unaffected either way.
import { debug, loc } from 'azure-pipelines-task-lib/task.js'
import * as im from 'azure-pipelines-task-lib/internal.js'
import { extractUrlUserInfoSecrets, redactUrlUserInfo } from '@4cloudguru/pipeline-task-core'

import { maskSecretLines } from '../endpoint/endpoint-data-secret.js'
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
 * A single-line value that is a URL as a WHOLE, or is `user:password@host...`
 * with the scheme left off (a vSphere connection written as
 * `svc:pw@vcenter.example.com/sdk`; a ServiceNow instance typed the same way).
 * The embedded scan cannot be trusted for these: it stops at a quote, a space
 * or an angle bracket, so a password containing one is cut off before the `@`
 * and never registered, and a scheme-less value is not a URL to it at all.
 * The whole value is therefore also handed to the parser -- with `https://`
 * prepended when it has no scheme -- and every spelling it finds is registered
 * too. Multi-line values are excluded: the parser's userinfo does not stop at a
 * line break, and would register the tail of the next line as the password.
 * The user part excludes `:` so it cannot also match the optional password
 * group: with both able to consume a colon, a long value with no `@` in it
 * backtracks polynomially (CodeQL js/polynomial-redos). A colon is the
 * separator here, never part of the user.
 */
const SCHEME_LESS_USERINFO = /^[^\s/?#@:]+(?::[^\s/?#@]*)?@[^\s/?#@]/

function isSingleLine(text: string): boolean {
  return !/[\r\n]/.test(text)
}

/** `text` as the parser should see it, and whether a scheme was invented for it. */
function asWholeUrl(text: string): { url: string; prefixed: boolean } {
  if (EMBEDDED_URL.test(text)) {
    EMBEDDED_URL.lastIndex = 0
    return { url: text, prefixed: false }
  }
  EMBEDDED_URL.lastIndex = 0
  return SCHEME_LESS_USERINFO.test(text)
    ? { url: 'https://' + text, prefixed: true }
    : { url: text, prefixed: false }
}

/**
 * A `key=value` assignment whose key names a credential. Matches the shapes a
 * variables block, an environment block, an argument string or a backend
 * config block use (`TF_VAR_db_password=...`, `-var client_secret=...`,
 * `password = "..."`, `access_token='...'`). A key that names a FILE, PATH,
 * ID or similar is excluded so a `token_file=/agent/x` does not register a
 * path as a secret. The value stops at whitespace, `,` or `;` unless quoted.
 */
const SECRET_ASSIGNMENT =
  /(^|[\s,;('"])([A-Za-z0-9_.-]*(?:pass(?:word|wd|phrase)?|pwd|secret|token|credential|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth)(?![A-Za-z0-9_.-]*[_-](?:file|path|dir|name|id|url|uri|type|ttl|scope|audience|issuer|region|profile|version|arn|method|header|count)\s*=)[A-Za-z0-9_.-]*)\s*=\s*("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi

/** Strips one layer of surrounding quotes. */
function unquote(value: string): string {
  return /^(["']).*\1$/s.test(value) ? value.slice(1, -1) : value
}

/**
 * Registers `secret` with the masker and the exact-match scrub. A spelling that
 * decodes to more than one line (a `%0A` in a URL password) is registered
 * line-wise: `setSecret` refuses a value containing CR/LF.
 */
function registerSpelling(secret: string): void {
  if (/[\r\n]/.test(secret)) {
    maskSecretLines(secret)
  } else {
    EnvironmentVariableHelper.registerSecret(secret)
  }
}

/**
 * Registers every spelling of any `user:password@` found in `text` -- as a
 * whole URL (with or without its scheme), or embedded in a larger value --
 * with the masker and the exact-match scrub. Idempotent; a value with no
 * userinfo registers nothing.
 */
export function maskUrlCredentialsIn(text: string): void {
  const candidates: string[] = text.match(EMBEDDED_URL) ?? []
  if (isSingleLine(text)) {
    candidates.push(asWholeUrl(text).url)
  }
  for (const candidate of candidates) {
    for (const secret of extractUrlUserInfoSecrets(candidate)) {
      registerSpelling(secret)
    }
  }
}

/**
 * Registers the value of every credential-named `key=value` assignment in a
 * free-form `text` (a variables block, an environment block, an argument
 * string) with the masker and the exact-match scrub. A value that is itself a
 * URL is left to `maskUrlCredentialsIn`, which registers only its userinfo.
 */
export function maskSecretAssignmentsIn(text: string): void {
  for (const match of text.matchAll(SECRET_ASSIGNMENT)) {
    const value = unquote(match[3] ?? '')
    if (value && !/^[A-Za-z][A-Za-z0-9+.-]{0,63}:\/\//.test(value)) {
      registerSpelling(value)
    }
  }
}

/**
 * `text` with the userinfo of every URL in it redacted -- embedded, whole, or
 * scheme-less -- and the value of every credential-named assignment replaced by
 * `***`; for the debug line. A multi-line value with neither is returned as it
 * is: task-lib's command escaping turns its line breaks into `%0A`, which is
 * the diagnostic `getInput` wrote.
 */
export function redactUrlCredentialsIn(text: string): string {
  let out = text.replace(EMBEDDED_URL, (url) => redactUrlUserInfo(url))
  if (isSingleLine(text)) {
    const whole = asWholeUrl(out)
    if (SCHEME_LESS_USERINFO.test(out) || /^[A-Za-z][A-Za-z0-9+.-]{0,63}:\/\//.test(out)) {
      const redacted = redactUrlUserInfo(whole.url)
      out =
        whole.prefixed && redacted.startsWith('https://')
          ? redacted.slice('https://'.length)
          : redacted
    }
  }
  return out.replace(SECRET_ASSIGNMENT, (whole, lead: string, key: string, value: string) =>
    /^[A-Za-z][A-Za-z0-9+.-]{0,63}:\/\//.test(unquote(value)) ? whole : `${lead}${key}=***`,
  )
}

/**
 * Reads a task input that may hold a credential an operator has put into a
 * value that is not itself a secret: a URL with userinfo
 * (`https://user:token@host/...`, with or without the scheme) -- as the whole
 * value, or embedded in a free-form value such as a variables block, a proxy
 * setting or an argument string -- or a credential-named assignment inside such
 * a free-form value (`TF_VAR_db_password=...`, `-var client_secret=...`) --
 * without letting that credential reach the build log first.
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
 *      in every URL the value contains, and in the whole value with or without
 *      a scheme) and the value of every credential-named assignment with the
 *      masker AND the exact-match scrub, before returning;
 *   3. then writes the same debug line `getInput()` would have written, with
 *      those credentials redacted, so the diagnostic is kept.
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
    maskSecretAssignmentsIn(raw)
  }
  debug(`${name}=${raw ? redactUrlCredentialsIn(raw) : raw}`)
  return raw || undefined
}
