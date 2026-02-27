# Changelog

All notable changes to this project will be documented in this file. See
[Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [1.3.2](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.3.1...v1.3.2) (2026-02-27)

### Bug Fixes

* persist cleared WebSocket token to disk to prevent stale 403 loop ([47be06a](https://github.com/BitWise-0x/homebridge-smartrent/commit/47be06a89cad02b4851cd916c5cab78c7f321861))

## [1.3.1](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.3.0...v1.3.1) (2026-02-27)

### Bug Fixes

* resolve concurrent session race condition and slow characteristic handlers ([54a213d](https://github.com/BitWise-0x/homebridge-smartrent/commit/54a213d83056b08444ddcd544c998955b1a5eb19))

## [1.3.0](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.2.0...v1.3.0) (2026-02-27)

### Features

* add 5 user-configurable options to plugin settings ([669883d](https://github.com/BitWise-0x/homebridge-smartrent/commit/669883d3d1615aaf3b405cf3a1c17d994db8fe48))

## [1.2.0](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.1.10...v1.2.0) (2026-02-27)

### Features

* MAJOR ENHANCEMENTS — 7 new features, 14 bug fixes ([6183a44](https://github.com/BitWise-0x/homebridge-smartrent/commit/6183a4405bdc9792665643704b32100fd79e8613))

## [1.1.10](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.1.9...v1.1.10) (2026-02-18)

### Bug Fixes

* **ws:** wait for WebSocket connection before subscribing devices ([580c7c2](https://github.com/BitWise-0x/homebridge-smartrent/commit/580c7c2aabc38df412f66bd9c96876a53c80fbeb))

## [1.1.9](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.1.8...v1.1.9) (2026-02-18)

### Bug Fixes

* **release:** correct semantic-release branches config key ([ffaa2f3](https://github.com/BitWise-0x/homebridge-smartrent/commit/ffaa2f3ea18c93f64613ef04f863a4b9ba961203))

## [1.1.8](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.1.7...v1.1.8) (2026-02-18)

### Bug Fixes

* **ci:** require dependency-group for grouped PR auto-merge ([e5d2fa3](https://github.com/BitWise-0x/homebridge-smartrent/commit/e5d2fa3cfdde9e36aeb9e42c7830c99eb38cf545))

## [1.1.7](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.1.6...v1.1.7) (2026-02-17)

### Bug Fixes

* **websocket:** prevent permanent device subscription loss after reconnect ([629a830](https://github.com/BitWise-0x/homebridge-smartrent/commit/629a8309762be8b5c0319e8492e5bb737a308436))

## [1.1.6](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.1.5...v1.1.6) (2025-12-15)

### Bug Fixes

* **package:** use ASCII character in author field ([9dd44d6](https://github.com/BitWise-0x/homebridge-smartrent/commit/9dd44d637a8446146da115fb994be181bc592eb3))

## [1.1.5](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.1.4...v1.1.5) (2025-12-15)

### Bug Fixes

* **schema:** use valid JSON Schema required syntax ([1583590](https://github.com/BitWise-0x/homebridge-smartrent/commit/158359037e14df22b70d1a057dff040e0cc384cf))

## [1.1.4](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.1.3...v1.1.4) (2025-12-15)

### Bug Fixes

* **engines:** add Node.js 24 support ([2f476bf](https://github.com/BitWise-0x/homebridge-smartrent/commit/2f476bf638451ea14050434e3c832c3009b68fcb))

## [1.1.3](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.1.2...v1.1.3) (2025-12-15)

### Bug Fixes

* **deps:** update dependencies ([1031e6b](https://github.com/BitWise-0x/homebridge-smartrent/commit/1031e6b195d41187f0ccecb5deb11b4e9b050cce))

## [1.1.2](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.1.1...v1.1.2) (2025-10-09)

### Bug Fixes

* **thermostat:** correct API attribute names for temperature setpoints ([02af840](https://github.com/BitWise-0x/homebridge-smartrent/commit/02af8402ae52d34e8505e137f2c0d3201434b4b3))

## [1.1.1](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.1.0...v1.1.1) (2025-09-09)

### Bug Fixes

* **auth:** improve session handling for empty or corrupted session files ([3a32ac3](https://github.com/BitWise-0x/homebridge-smartrent/commit/3a32ac3a2e8e02ca349a9dbe9b58adba85bf3ae8))

## [1.1.0](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.0.10...v1.1.0) (2025-08-31)

### Features

* **verified:** plugin is now homebridge verified! ([e56bf9a](https://github.com/BitWise-0x/homebridge-smartrent/commit/e56bf9a1b220ca08a22cf0d99c35d93650f92d29))

## [1.0.10](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.0.9...v1.0.10) (2025-08-31)

### Bug Fixes

* **websocket:** handle undefined access token and improve error logging ([2131ae0](https://github.com/BitWise-0x/homebridge-smartrent/commit/2131ae0cfa0beb687e7361248a7c780242ba680e))

## [1.0.9](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.0.8...v1.0.9) (2025-08-30)

### Bug Fixes

* **api:** handle missing access token for API requests and WebSocket connections ([449d880](https://github.com/BitWise-0x/homebridge-smartrent/commit/449d8800b9153dc0c4ff00f6f21126499a0d97ec))

## [1.0.8](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.0.7...v1.0.8) (2025-08-09)

### Bug Fixes

* **logging:** improve logging descriptiveness and reduce verbosity ([90779b2](https://github.com/BitWise-0x/homebridge-smartrent/commit/90779b23ebcb4a9914669bee549d7479137e2f59))

## [1.0.7](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.0.6...v1.0.7) (2025-08-09)

### Bug Fixes

* **bug:** bug ([55d9065](https://github.com/BitWise-0x/homebridge-smartrent/commit/55d9065bdd35e29167ce335065572ce0a065c86d))

## [1.0.6](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.0.5...v1.0.6) (2025-08-06)

### Bug Fixes

* **bug:** bug/ update README badge syntax ([a01d0cc](https://github.com/BitWise-0x/homebridge-smartrent/commit/a01d0cc2880815c097f9883fe0d68a995e3491c0))

## [1.0.5](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.0.4...v1.0.5) (2025-08-06)

### Bug Fixes

* **bug:** fixed more API issues with temp ([c674d2a](https://github.com/BitWise-0x/homebridge-smartrent/commit/c674d2aa19fe73959d371437a27d38a4f740d7b9))

## [1.0.4](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.0.3...v1.0.4) (2025-08-06)

### Bug Fixes

* **bug:** fixed more temperature handling bugs ([2daf7af](https://github.com/BitWise-0x/homebridge-smartrent/commit/2daf7af03183a4318fe34ac9f6f1b92a52dd6902))

## [1.0.3](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.0.2...v1.0.3) (2025-08-06)

### Bug Fixes

* **bug:** refactored temperature calculations in thermostat handling ([a4437fd](https://github.com/BitWise-0x/homebridge-smartrent/commit/a4437fd8283b7f8e3fbf5a92a1b37690e6602043))

## [1.0.2](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.0.1...v1.0.2) (2025-08-06)

### Bug Fixes

* **bug:** major refactored temperature & thermostat handling ([45bdff4](https://github.com/BitWise-0x/homebridge-smartrent/commit/45bdff478a8f5b225a8e10b0d3605d6aa6f6e178))

## [1.0.1](https://github.com/BitWise-0x/homebridge-smartrent/compare/v1.0.0...v1.0.1) (2025-08-06)

### Bug Fixes

* **bug:** resolve README pretty issue ([505187f](https://github.com/BitWise-0x/homebridge-smartrent/commit/505187faa142d1f4306c7e5c286ec75283b462aa))

## 1.0.0 (2025-08-06)

### Bug Fixes

* **bug:** resolve module resolution issues ([c9262e6](https://github.com/BitWise-0x/homebridge-smartrent/commit/c9262e65dd4949cfea4a2aea86f2f4c68d6e97b6))

## 1.0.0 (2025-08-02)


### Initial Commit

* initial commit ([1f6fe46](https://github.com/BitWise-0x/homebridge-smartrent/commit/1f6fe46cad9607f37153fe3908ef8cbd8ef93118))
