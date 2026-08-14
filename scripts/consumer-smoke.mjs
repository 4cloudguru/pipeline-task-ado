#!/usr/bin/env node
/**
 * Consumer smoke test — build a throwaway project that consumes this package the
 * way the Azure DevOps task extensions actually do, and prove it compiles.
 *
 * WHY THIS EXISTS. The Build job checks `./dist/index.cjs` by PATH. A consumer
 * never writes a path — it writes `@4cloudguru/pipeline-task-ado` and lets the
 * `exports` map resolve it. Everything in that gap is otherwise untested, and a
 * real bug lived there in the sibling package: a subpath's types were
 * unresolvable under TypeScript's classic `moduleResolution: "node"`, which is
 * what every ADO task build uses. `tsc` failed with TS2307 while every check in
 * that repo stayed green, because nothing there compiles as a consumer.
 *
 * Fidelity is the whole point, so:
 *   - it installs the packed TARBALL, not a workspace link, so anything missing
 *     from `files` is missing here too;
 *   - the tsconfig mirrors a real task's (commonjs, no explicit
 *     moduleResolution so classic `node` applies, skipLibCheck true);
 *   - azure-pipelines-task-lib is installed ALONGSIDE, because it is a peer:
 *     that is the arrangement on a real agent, and installing it as a nested
 *     dependency would hide a peer range that no longer matches.
 *
 * What it does NOT catch: semantic regressions. A parameter that quietly became
 * optional compiles perfectly. Those need the consumer's own tests.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const PKG = '@4cloudguru/pipeline-task-ado'

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...opts })

// npm is a .cmd on Windows, so it needs a shell; node does not, and running it
// through one re-splits an executable path containing spaces.
const npm = (args, opts = {}) => run('npm', args, { shell: process.platform === 'win32', ...opts })

const step = (message) => console.log(`  ${message}`)

// Copied from a real task's tsconfig. `moduleResolution` is deliberately absent:
// `module: commonjs` makes TypeScript default to classic `node` resolution,
// which ignores `exports` entirely. That default IS the condition under test.
const CONSUMER_TSCONFIG = {
  compilerOptions: {
    target: 'ES6',
    module: 'commonjs',
    skipLibCheck: true,
    strict: true,
    noImplicitReturns: true,
    noFallthroughCasesInSwitch: true,
    noEmit: true,
  },
  include: ['index.ts'],
}

// USES what it imports — an unused import can be elided before resolution and
// would prove nothing.
const CONSUMER_SOURCE = `
import { getBoolInputDefaultTrue } from '${PKG}';

export function use(): boolean {
    return getBoolInputDefaultTrue('requireChecksum');
}
`

let workdir
let failed = false
try {
  console.log('Consumer smoke test')

  step('building')
  npm(['run', 'build'], { cwd: ROOT })

  step('packing the tarball (respects "files", so an omitted dist file fails here)')
  workdir = mkdtempSync(join(tmpdir(), 'pta-smoke-'))
  npm(['pack', '--pack-destination', workdir], { cwd: ROOT })
  const tarball = readdirSync(workdir).find((f) => f.endsWith('.tgz'))
  if (!tarball) throw new Error('npm pack produced no tarball')

  const consumer = join(workdir, 'consumer')
  mkdirSync(consumer)
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'consumer-smoke', version: '0.0.0', private: true }, null, 2),
  )
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify(CONSUMER_TSCONFIG, null, 2))
  writeFileSync(join(consumer, 'index.ts'), CONSUMER_SOURCE)

  // The peer goes in explicitly. On an agent the task vendors its own copy and
  // this package resolves up to it; installing it here reproduces that shape,
  // and a peer range that stopped matching fails at this step.
  step('installing the tarball plus its peer, as a real task is laid out')
  npm(
    [
      'install',
      join(workdir, tarball),
      'azure-pipelines-task-lib',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
    ],
    { cwd: consumer },
  )

  step(`type-checking against "${PKG}" with classic resolution`)
  run(process.execPath, [
    join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--project',
    consumer,
  ])

  // A real install, resolved by package name through `exports` — not by dist path.
  step('requiring the entry point from the install')
  run(
    process.execPath,
    [
      '-e',
      `const c = require('${PKG}');
     if (typeof c.getBoolInputDefaultTrue !== 'function') throw new Error('entry point did not export getBoolInputDefaultTrue');`,
    ],
    { cwd: consumer },
  )

  // The peer must resolve to the CONSUMER's copy, not a nested one. A nested
  // second task-lib still type-checks and still runs, but it is a different
  // module instance from the one the agent configured, so this asserts the
  // arrangement rather than trusting `external` in tsup.config.ts.
  step('asserting the task lib resolves to the consumer copy, not a nested one')
  run(
    process.execPath,
    [
      '-e',
      `const path = require('path');
     const resolved = require.resolve('azure-pipelines-task-lib/task');
     const nested = path.join('node_modules', '${PKG}', 'node_modules');
     if (resolved.includes(nested)) throw new Error('task-lib resolved to a nested copy: ' + resolved);`,
    ],
    { cwd: consumer },
  )

  console.log('\nOK: the package installs, resolves and type-checks as an ADO task consumes it.')
} catch (error) {
  failed = true
  console.error('\nFAIL: a consumer could not use this package.\n')
  console.error(error.stdout?.toString() || '')
  console.error(error.stderr?.toString() || error.message)
} finally {
  if (workdir) rmSync(workdir, { recursive: true, force: true })
}

process.exit(failed ? 1 : 0)
