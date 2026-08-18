# OME-Zarr 0.5 and Zarr v3 compatibility

The copick-web 2.0 line consumes the public storage contract introduced by
copick 2.0. It reads both existing OME-Zarr 0.4 / Zarr v2 datasets and newly
created OME-Zarr 0.5 / Zarr v3 datasets in the same application build.

## Runtime support

- Server: Python 3.11, 3.12, 3.13, and 3.14.
- Client development and CI: Node.js 20.19 or Node.js 22.
- Core: `copick>=2.0.0a1,<2.1`.
- Store API: `zarr>=3.1.6,<4` asynchronous `Store` contract.
- Browser reader: the locked `@idetik/core` 0.35 / Zarrita 0.7 line.

Behavioral fixtures cover legacy unsharded integer arrays and canonical
copick-produced sharded integer and shuffled floating-point arrays. The client
tests decode exact values and confirm that shard access uses size probes plus
bounded byte ranges.

## HTTP proxy contract

The tomogram and segmentation resource URLs are unchanged. Both implement:

| Request | Result |
| --- | --- |
| Full `GET` | `200` with the complete object |
| `HEAD` | `200` with object length and no body |
| `Range: bytes=start-end` | `206`; the inclusive HTTP end is translated to an exclusive Zarr end |
| `Range: bytes=start-` | `206` from the offset through the last byte |
| `Range: bytes=-suffix` | `206` with up to the requested trailing bytes |
| Missing key | `404` |
| Malformed, multiple, or unsatisfiable range | `416` with `Content-Range: bytes */size` |

Successful responses advertise `Accept-Ranges: bytes`. CORS exposes
`Accept-Ranges`, `Content-Length`, and `Content-Range`. Partial reads are sent
to the copick-owned Zarr Store and are never implemented by fetching a full
shard and slicing it in the FastAPI process.

Authentication, credentials, retries, reconnection, and filesystem creation
remain owned by copick, Zarr, and fsspec. The web layer does not reconstruct
backend URLs. Local behavior is exercised directly in this repository; S3,
SSH, and ML Croissant deployments use the same Store boundary and remain
release-environment validation gates. SMB is optional until it is promoted by
copick core.

## Releases and images

Server and client versions are linked and released together. The `v2.0` branch
uses `2.0.0-alpha.N` GitHub prereleases and publishes:

- `ghcr.io/copick/copick-web-server:2.0.0-alpha.N`;
- `ghcr.io/copick/copick-web-client:2.0.0-alpha.N`;
- matching immutable `sha-<commit>` tags;
- the moving `alpha` tag for prereleases.

Alpha publication never moves `latest`. Stable publication adds the exact
stable version and moves `latest` only after the stable release is created.
Set one `COPICK_WEB_VERSION` in `compose-prod.yml` to pin both images. No PyPI
or npm package is published by this release path.
