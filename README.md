# @4cloudguru/pipeline-task-ado

Azure DevOps-specific task primitives shared by the Azure Pipelines task
extensions ([azure-pipelines-terraform][tf], [azure-pipelines-packer][pk]).

## Why this exists separately from `pipeline-task-core`

`@4cloudguru/pipeline-task-core` is deliberately **platform-agnostic**: it
imports neither `azure-pipelines-task-lib` nor `undici`, which is what lets it
be audited and reused without dragging in an ADO runtime. That property is worth
keeping.

But a real task needs code that *is* ADO-specific — reading inputs, registering
secrets with the agent, routing HTTP through the agent's proxy, emitting
localized messages. That code was being copy-pasted between tasks and between
the two extension repos, byte-identical and enforced by each repo's
`scripts/check-shared-modules.js`. This package is its home.

The split is the point:

| | `pipeline-task-core` | `pipeline-task-ado` (this) |
| --- | --- | --- |
| Depends on the ADO task lib | never | yes (as a peer) |
| Example | `assertEgressHostAllowed`, `redactUrl`, `VerificationFailure` | `getBoolInputDefaultTrue`, the proxy-aware HTTP client |

Keeping them as two specifiers is also what preserves the extensions' test
seams: a task can mock this package's HTTP surface while the security guards it
asserts keep resolving from `-core` and stay real. Collapsing them into one
module would let a single `registerMock` blank the guard a test exists to
verify — green, and checking nothing.

## Peer dependencies, not dependencies

`azure-pipelines-task-lib` is a **peer**. A task already vendors its own copy,
and the agent configures *that* instance. Bundling a second one would ship in
every `.vsix` and could answer differently about inputs and secrets. `undici` is
an optional peer, needed only by the proxy-aware HTTP surface.

## Scope

Modules move here one family at a time, smallest first, so the migration pattern
is proven on something harmless before anything security-bearing moves:

- [x] `getBoolInputDefaultTrue` — fail-closed boolean input
- [x] `http-client` — proxy-aware, HTTPS-pinned client wiring over `-core`
- [ ] `registry-version-resolver`
- [ ] `https-client`

## A warning to anyone moving a module here

Several consumer gates scan **in-repo source** — `check-proxy-parity.js`,
`check-artifact-trust.js`, `check-egress-authorization.js`, and
`PreMaskingClassL0`'s source-level rows. When a module moves into this package,
those gates stop finding it **and keep exiting 0**. That is not hypothetical:
[azure-pipelines-terraform#949][949] shipped a proxy gate reporting zero call
sites and a green build.

So each migration must, in the same change:

1. **move the gate with the code** into this repo's own suite;
2. **replace the consumer's shape-gate with a version floor** — assert the task
   depends on `@4cloudguru/pipeline-task-ado >= X` (provenance, not shape);
3. **keep one behavioural test in the consumer** proving the wiring still holds
   end to end, so the consumer proves something rather than trusting a version.

## Development

```bash
npm ci
npm test            # vitest
npm run typecheck
npm run build       # tsup, dual CJS/ESM
npm run smoke       # packs the tarball and consumes it as a real task does
```

Commits follow Conventional Commits; releases are automated by release-please
and published to npm with provenance.

[tf]: https://github.com/sethbacon/azure-pipelines-terraform
[pk]: https://github.com/sethbacon/azure-pipelines-packer
[949]: https://github.com/sethbacon/azure-pipelines-terraform/pull/949
