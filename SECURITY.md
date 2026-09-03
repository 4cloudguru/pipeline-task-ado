# Security Policy

## Reporting a vulnerability

Report privately via [GitHub Security Advisories](https://github.com/4cloudguru/pipeline-task-ado/security/advisories/new).
Please do not open a public issue for a suspected vulnerability.

Include the affected version, a description of the impact, and reproduction steps.
You will get an acknowledgement within 7 days.

## Supported versions

Until `1.0.0`, only the latest published minor receives fixes.

## Scope

This package wires Azure DevOps task primitives — input parsing whose defaults
are fail-closed, secret registration with the agent, and proxy-aware HTTP
transport — on top of `@4cloudguru/pipeline-task-core`. A defect that causes a
credential to reach a build log unmasked, or a verification default to silently
become permissive, is a security issue rather than an ordinary defect.

Out of scope: vulnerabilities in consuming extensions that arise from misuse of
this package's API. Report those against the consuming repository.

## Trust roots

This package bundles **no** signing key and **no** trust root. It also does not
vendor `azure-pipelines-task-lib`: that is a peer dependency, so the instance
that registers secrets is the consumer's own, configured by the agent. A report
that this package embeds a key, or ships a second task lib, is therefore always
a bug.

## The federated token this package mints is not audience-scoped

`generateIdToken()` requests an Azure DevOps OIDC assertion for a service connection and returns it. **It sets no audience, because Azure DevOps offers no way to set one.** The token endpoint accepts exactly these parameters:

| | |
|---|---|
| path | `organization`, `scopeIdentifier`, `hubName`, `planId`, `jobId` |
| query | `api-version` (required), `serviceConnectionId` (optional) |
| body | none |

Verified against Microsoft's REST reference for `distributedtask/oidctoken/create` at `api-version` **7.1** and **7.2** — neither accepts an `audience`/`aud` parameter, and the response is a bare `{ oidcToken }`.

**What that means for a relying party.** Every cloud this package serves — Azure, AWS, GCP, OCI — receives an assertion of the same shape, carrying Azure DevOps' default audience and differing only in `sub` (which encodes the specific organization, project and service connection). An assertion minted for one cloud is therefore structurally acceptable to any other relying party federated to the **same** subject.

**So the trust policy is the security boundary, not the token.** Every relying party configured against this package's tokens must pin **both**:

- the **issuer**, and the **audience** exactly — never accept any audience; and
- the **subject** (`sub`) to the exact service connection, not a prefix or wildcard.

Pinning `sub` alone is not sufficient, and pinning `aud` alone is not sufficient. A trust policy that wildcards either one accepts assertions minted for a *different* purpose in the same Azure DevOps organization. This is the compensating control for the absent audience parameter, and it lives on the relying-party side because that is the only side that can enforce it.

Consumers document the concrete per-cloud configuration: `azure-pipelines-terraform` and `azure-pipelines-packer` each carry WIF setup guides showing the issuer/audience/subject conditions for AWS, GCP and OCI, and `azure-pipelines-terraform` gates their agreement with `scripts/check-wif-audience-parity.js`.

**If Azure DevOps ever exposes per-exchange audience selection, this is the place to use it** — a single requester serving four clouds is the reason the gap has one fix rather than four.

## Shared CI workflows

Part of this repository's CI is **defined in another repository** — [`4cloudguru/shared-workflows`](https://github.com/4cloudguru/shared-workflows) — and called from `.github/workflows/`. That is a real supply-chain relationship, and it is recorded here so an audit of this repository does not stop at this repository's own tree.

**What runs, and where it is pinned.** Each caller in `.github/workflows/` names the shared workflow on its `uses:` line, pinned to a full 40-hex commit SHA with a trailing comment naming the release that SHA is. The tag is a label; the SHA is what runs. An unlabelled SHA is rejected by the workflow-hardening gate, because a bare 40-hex ref cannot be reviewed or updated deliberately.

**Why the pins have to agree across repositories.** A shared definition drifts differently from a duplicated file: every repository looks like it is using "the shared one" while sitting on different commits, which is *harder* to see than divergent files, not easier. A signature in `security-orchestration` (`shared-workflow-pin-parity`) reports **disagreement** between callers of the same shared workflow — it reports disagreement rather than staleness, because a repository deliberately held back is a decision while N repositories disagreeing without anyone deciding is drift.

**What the shared repository is itself protected by.** Its `main` requires its own zizmor and actionlint checks with `enforce_admins` enabled, restricts which third-party actions may run to an explicit allowlist, issues a read-only default `GITHUB_TOKEN`, and runs the workflow-hardening gate against itself.

**What this repository still controls.** Triggers, concurrency, and the secrets it passes. Secrets are passed **by name** — never `secrets: inherit`, which would forward every secret in this repository to a workflow owned by someone else. Any `vars.*` a shared workflow reads resolve against **this** repository, so credentials and their installation scope do not move.
