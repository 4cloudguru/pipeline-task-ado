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
