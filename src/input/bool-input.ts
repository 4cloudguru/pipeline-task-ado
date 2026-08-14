// The `.js` extension is load-bearing: azure-pipelines-task-lib is CommonJS with
// no `exports` map, so under ESM resolution the extensionless subpath does not
// resolve at all (ERR_MODULE_NOT_FOUND). CJS is unaffected either way.
import { getInput } from 'azure-pipelines-task-lib/task.js'

/**
 * Reads a boolean input whose intended default is TRUE (fail-closed). It reads the
 * raw input rather than getBoolInput(name, false) so the default still holds on an
 * agent that does not materialize task.json defaultValues into the input env var
 * (where getBoolInput would silently return false): unset/empty -> true; any value
 * other than "false" (case-insensitive) -> true.
 */
export function getBoolInputDefaultTrue(name: string): boolean {
  const raw = getInput(name, false)
  return raw === undefined || raw.trim() === '' ? true : raw.trim().toLowerCase() !== 'false'
}
