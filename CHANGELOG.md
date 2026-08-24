# Changelog

## [0.5.2](https://github.com/4cloudguru/pipeline-task-ado/compare/v0.5.1...v0.5.2) (2026-08-24)


### Bug Fixes

* **ci:** make zizmor fail the build instead of filing a report ([#40](https://github.com/4cloudguru/pipeline-task-ado/issues/40)) ([9d34aca](https://github.com/4cloudguru/pipeline-task-ado/commit/9d34aca9d2e685041bef5e70daefa71d6dc04de2))

## [0.5.1](https://github.com/4cloudguru/pipeline-task-ado/compare/v0.5.0...v0.5.1) (2026-08-24)


### Chores

* release the pipeline-task-core dependency floor bump ([#35](https://github.com/4cloudguru/pipeline-task-ado/issues/35)) ([f9979d8](https://github.com/4cloudguru/pipeline-task-ado/commit/f9979d84bf9397c0e1dd7116272a12267566fac2))

## [0.5.0](https://github.com/4cloudguru/pipeline-task-ado/compare/v0.4.4...v0.5.0) (2026-08-24)


### Features

* add secure-temp, environment-variables, id-token-generator ([#31](https://github.com/4cloudguru/pipeline-task-ado/issues/31)) ([c0a5e03](https://github.com/4cloudguru/pipeline-task-ado/commit/c0a5e032ccbc044fac5fde47c1f216119f4fef80))

## [0.4.4](https://github.com/4cloudguru/pipeline-task-ado/compare/v0.4.3...v0.4.4) (2026-08-23)


### Documentation

* add secure-temp, environment-variables, id-token-generator to scope ([#29](https://github.com/4cloudguru/pipeline-task-ado/issues/29)) ([029e892](https://github.com/4cloudguru/pipeline-task-ado/commit/029e892d15a531eade268d2bd9ebb9bad55732a7))

## [0.4.3](https://github.com/4cloudguru/pipeline-task-ado/compare/v0.4.2...v0.4.3) (2026-08-21)


### Dependencies

* bump the github-actions-dependencies group with 3 updates ([#27](https://github.com/4cloudguru/pipeline-task-ado/issues/27)) ([07c1c70](https://github.com/4cloudguru/pipeline-task-ado/commit/07c1c70ea8f48048b7208dacd9e8c1d1a854ae40))

## [0.4.2](https://github.com/4cloudguru/pipeline-task-ado/compare/v0.4.1...v0.4.2) (2026-08-20)


### Documentation

* **security:** record the shared-workflow trust relationship, and fix what it invalidated ([#25](https://github.com/4cloudguru/pipeline-task-ado/issues/25)) ([3adbc7d](https://github.com/4cloudguru/pipeline-task-ado/commit/3adbc7d37431343dac655dbaf9875bfcd80c15a1))

## [0.4.1](https://github.com/4cloudguru/pipeline-task-ado/compare/v0.4.0...v0.4.1) (2026-08-20)


### Bug Fixes

* **ci:** refuse to run signature-replay when Dependabot edited the workflow ([#17](https://github.com/4cloudguru/pipeline-task-ado/issues/17)) ([1bc1134](https://github.com/4cloudguru/pipeline-task-ado/commit/1bc113400868ce619f1ab6a267ed0146d32a7b7c))

## [0.4.0](https://github.com/4cloudguru/pipeline-task-ado/compare/v0.3.0...v0.4.0) (2026-08-16)


### Features

* track pipeline-task-core 0.6.0 ([#13](https://github.com/4cloudguru/pipeline-task-ado/issues/13)) ([997129f](https://github.com/4cloudguru/pipeline-task-ado/commit/997129f6f7413a82e668bafbf22b08b963677669))


### Bug Fixes

* forward the hop url so a bypassed destination is not proxied ([#11](https://github.com/4cloudguru/pipeline-task-ado/issues/11)) ([a8c8d7d](https://github.com/4cloudguru/pipeline-task-ado/commit/a8c8d7ddbc47ad070e42caf4771c372adcf602fe))

## [0.3.0](https://github.com/4cloudguru/pipeline-task-ado/compare/v0.2.0...v0.3.0) (2026-08-15)


### Features

* track pipeline-task-core 0.5.x ([#9](https://github.com/4cloudguru/pipeline-task-ado/issues/9)) ([ca1f072](https://github.com/4cloudguru/pipeline-task-ado/commit/ca1f0721f886c3ef817a42f8ac36656af8557546))

## [0.2.0](https://github.com/4cloudguru/pipeline-task-ado/compare/v0.1.1...v0.2.0) (2026-08-14)


### Features

* add the proxy-aware ADO HTTP client ([#6](https://github.com/4cloudguru/pipeline-task-ado/issues/6)) ([9f95138](https://github.com/4cloudguru/pipeline-task-ado/commit/9f951382cacf3e1e9992fb9fd89ab5759dd7207e))


### Dependencies

* bump undici in the dev-dependencies group across 1 directory ([#1](https://github.com/4cloudguru/pipeline-task-ado/issues/1)) ([c46a02c](https://github.com/4cloudguru/pipeline-task-ado/commit/c46a02cd2ffd7bee4160eab7046356c5297d838a))

## [0.1.1](https://github.com/4cloudguru/pipeline-task-ado/compare/v0.1.0...v0.1.1) (2026-08-14)


### Bug Fixes

* **ci:** give the first publish a token to bootstrap trusted publishing ([#4](https://github.com/4cloudguru/pipeline-task-ado/issues/4)) ([ccc3415](https://github.com/4cloudguru/pipeline-task-ado/commit/ccc34151ea07170a5657da78f0909f6c561a0350))

## 0.1.0 (2026-08-14)


### Features

* scaffold the shared Azure DevOps task package ([0e79e3a](https://github.com/4cloudguru/pipeline-task-ado/commit/0e79e3a5769267eb0fc4a1feacb25669037c7112))


### Bug Fixes

* **ci:** check out every SIGNATURE_SCOPE repo ([#3](https://github.com/4cloudguru/pipeline-task-ado/issues/3)) ([a518c31](https://github.com/4cloudguru/pipeline-task-ado/commit/a518c310ff5f6724b64ce978874134f67210f7da))
* resolve the task lib peer under ESM and de-duplicate the workflow name ([1bdd91c](https://github.com/4cloudguru/pipeline-task-ado/commit/1bdd91c61a1fd0b1850a164c35efb084f4ff1e80))
