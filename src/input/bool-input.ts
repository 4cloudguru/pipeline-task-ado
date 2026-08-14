import { getInput } from 'azure-pipelines-task-lib/task'

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
