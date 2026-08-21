# Changelog

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
