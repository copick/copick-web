# Changelog

## [1.0.0-alpha.4](https://github.com/copick/copick-web/compare/client-v1.0.0-alpha.3...client-v1.0.0-alpha.4) (2026-10-27)


### Features

* embeddable read-only app factory, and ?session= to show one session's layers ([#102](https://github.com/copick/copick-web/issues/102)) ([82e71cd](https://github.com/copick/copick-web/commit/82e71cdd6b4984d79d6190f70b0ecd705d2757c1))

## [1.0.0-alpha.3](https://github.com/copick/copick-web/compare/client-v1.0.0-alpha.2...client-v1.0.0-alpha.3) (2026-10-26)


### Features

* draw segmentations as isosurface meshes in the 3D view (Zarr v3) ([#95](https://github.com/copick/copick-web/issues/95)) ([4310c00](https://github.com/copick/copick-web/commit/4310c0039b512f95b4ea4583f9105f6c9b172b5b))
* show copick meshes in the 3D view ([#93](https://github.com/copick/copick-web/issues/93)) ([a93a554](https://github.com/copick/copick-web/commit/a93a55481fe4f597cd0b41cbbe9d64fb18c87584))


### Bug Fixes

* **deps:** upgrade @idetik/core from 0.49 to 0.51 ([#91](https://github.com/copick/copick-web/issues/91)) ([7ab3568](https://github.com/copick/copick-web/commit/7ab35683190df846bdd81767cbfb7fbf74a0672a))

## [1.0.0-alpha.2](https://github.com/copick/copick-web/compare/client-v1.0.0-alpha.1...client-v1.0.0-alpha.2) (2026-10-26)


### Features

* multi-tenant with embrella integration (Zarr v3) ([#41](https://github.com/copick/copick-web/issues/41)) ([ac16090](https://github.com/copick/copick-web/commit/ac16090007ac232d1e7f3e8b0eedafaf928af499))


### Bug Fixes

* **deps:** catch up all remaining updates; Vite 8, ESLint 10, React Router 7 (Zarr v3) ([#85](https://github.com/copick/copick-web/issues/85)) ([4612cf9](https://github.com/copick/copick-web/commit/4612cf90e9ae8a1467ef80229558d54c9404ec74))
* **deps:** consolidate Dependabot updates; React 19, MUI 9, Tailwind 4 (Zarr v3) ([#68](https://github.com/copick/copick-web/issues/68)) ([3d3324c](https://github.com/copick/copick-web/commit/3d3324c27fc5d067e29dcc88f6f12594bfbb1f2d))
* **deps:** upgrade the viewer engine @idetik/core from 0.35 to 0.49 (Zarr v3) ([#87](https://github.com/copick/copick-web/issues/87)) ([97c2dbf](https://github.com/copick/copick-web/commit/97c2dbf05b1cd6a246db8cf81e561d7892bc852c))


### Build System

* move the v2.0 line to Node 24 ([#42](https://github.com/copick/copick-web/issues/42)) ([0648cff](https://github.com/copick/copick-web/commit/0648cff6bca05aa79b85227a08df905db7762762))

## [1.0.0-alpha.1](https://github.com/copick/copick-web/compare/client-v1.0.0-alpha...client-v1.0.0-alpha.1) (2026-10-15)


### Features

* reveal the open tomogram in the run tree ([#32](https://github.com/copick/copick-web/issues/32)) ([563553a](https://github.com/copick/copick-web/commit/563553ae9ff2489bdb4cff9c2cffae8d791c34ec))
* show what is displayed, and which tomogram is open ([#33](https://github.com/copick/copick-web/issues/33)) ([63848ec](https://github.com/copick/copick-web/commit/63848eca270f7ce65a2a1a1f1c64f33f7c610548))


### Bug Fixes

* keep the 3D volume in place when changing its level; add keybinding help ([#34](https://github.com/copick/copick-web/issues/34)) ([0e8cdaf](https://github.com/copick/copick-web/commit/0e8cdaf5c03a73e6ea03ff97dc6712bb819fcd7b))

## [1.0.0-alpha](https://github.com/copick/copick-web/compare/client-v0.1.2...client-v1.0.0-alpha) (2026-10-08)


### ⚠ BREAKING CHANGES

* support OME-Zarr 0.5 and Zarr v3 ([#19](https://github.com/copick/copick-web/issues/19))

### Features

* multi-panel viewer, filaments, instance and panoptic segmentations (Zarr v3) ([#21](https://github.com/copick/copick-web/issues/21)) ([4f6b2ee](https://github.com/copick/copick-web/commit/4f6b2eeadfba0ae52feb3b0a27cf510c8629798c))
* reload the project from the sidebar ([#23](https://github.com/copick/copick-web/issues/23)) ([8e8c6aa](https://github.com/copick/copick-web/commit/8e8c6aa4848c03e0a8f08992c0a74f87acf98494))
* selectable slice orientations ([0f3bb06](https://github.com/copick/copick-web/commit/0f3bb06fc945922ecc3e2ebea9521759efcac1f2))
* selectable slice orientations ([f4b9a34](https://github.com/copick/copick-web/commit/f4b9a34f28c7b50bb948d978609fc27ffc220165))
* serve under any URL prefix, set at runtime ([#27](https://github.com/copick/copick-web/issues/27)) ([55fb631](https://github.com/copick/copick-web/commit/55fb6311e8453ca3690544f0c98548b68262221e))
* support OME-Zarr 0.5 and Zarr v3 ([#19](https://github.com/copick/copick-web/issues/19)) ([9a21984](https://github.com/copick/copick-web/commit/9a21984b3064cd0b8a83582b658ed875bb45d6a8))

## [0.1.2](https://github.com/copick/copick-web/compare/client-v0.1.1...client-v0.1.2) (2026-07-24)


### Features

* containerize app ([#4](https://github.com/copick/copick-web/issues/4)) ([1b57cb4](https://github.com/copick/copick-web/commit/1b57cb40e51ce6553f47ea896802725e31e850bc))
* migrate to idetik core ([14d5a23](https://github.com/copick/copick-web/commit/14d5a2346fad7919ee2fd2f32e5a382c1bad0705))
* migrate to idetik core ([a5b93e7](https://github.com/copick/copick-web/commit/a5b93e7d3fd3427a8b6f98ca5ed3c921a231ba26))


### Bug Fixes

* Update deps in lockfile and fix CI ([9918de3](https://github.com/copick/copick-web/commit/9918de30097a1fc6fdafab5094ab485240e76008))

## [0.1.1](https://github.com/copick/copick-web/compare/client-v0.1.0...client-v0.1.1) (2026-02-25)


### Features

* Particle picking! ([26113f8](https://github.com/copick/copick-web/commit/26113f8257592c57df5f01444e4b6064c2f0ae13))


### Bug Fixes

* add missing files for particle picking. ([821f7aa](https://github.com/copick/copick-web/commit/821f7aa6f43cfea4aa2e7db111d5ff5098b76ff9))
