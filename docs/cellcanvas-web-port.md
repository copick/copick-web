# CellCanvas web interface: reuse and first integration

The web interface will reuse copick-web's run browser and idetik viewer, with CellCanvas learning controls alongside them. BioNotate can embed the same interface and retain campaign, review and authentication ownership. Public CellCanvas must run with public models (DINO or another selected public model); proprietary models belong in private adapters. No public model checkpoint is selected or downloaded by this change.

## Inspected sources

This map was checked against copick-web main `c6c3443`, napari-cellcanvas main `0958281`, CellCanvas main `08cda46`, and cellcanvas-core `e794717`. The copick-web v2.0 tree was also checked for a separate painting/training implementation; none was found. Existing BioNotate review worktrees were left unchanged.

- [napari widget and solution runner](https://github.com/cellcanvas/napari-cellcanvas/blob/0958281fea74d56f292dc0a5d5ce4a41b8a47fa8/src/napari_cellcanvas/widget.py)
- [napari core-service client](https://github.com/cellcanvas/napari-cellcanvas/blob/0958281fea74d56f292dc0a5d5ce4a41b8a47fa8/src/napari_cellcanvas/_core_client.py)
- [napari local learning controls](https://github.com/cellcanvas/napari-cellcanvas/blob/0958281fea74d56f292dc0a5d5ce4a41b8a47fa8/src/napari_cellcanvas/_local.py)
- [current headless core service](https://github.com/cellcanvas/cellcanvas/blob/08cda46f3f7dc22f3c0f2d309a168bd2d037013b/cellcanvas_service/app.py)
- [legacy copick painting service](https://github.com/cellcanvas/cellcanvas/blob/08cda46f3f7dc22f3c0f2d309a168bd2d037013b/workflows/cellcanvas-server/server.py)

## Port map

| User workflow | What copick-web already supplies | Remaining work / disposition |
|---|---|---|
| Browse datasets, runs, voxel spacings and reconstruction types | Project registry, run gallery/tree, run details and `useOpenTomogram` | Reuse. Do not port Qt selectors or another copick browser. |
| Navigate volumes and inspect predictions | idetik orthoslices/3D, channels, contrast, physical geometry, label layers, instance browser | Reuse. Keep existing selection and camera state while results refresh. |
| See results written by another tool | Server project reload and metadata-query invalidation | First implemented increment below: reopen label sources and revision derived caches. Zarr storage alone does not notify a viewer. |
| Edit semantic labels | Point/filament editors exist; voxel painting does not | Build a brush/erase interaction with physical-to-array transforms. Picking an object is not painting a semantic class. Zero remains unannotated; a background class must be explicit. |
| Persist painting | copick overlay storage; legacy CellCanvas has a coordinate-update endpoint | Adapt the storage operation, with bounded strokes, source/geometry identity, edit revision, validation and dataset-operation locking. Do not directly expose arbitrary filesystem paths. Qt layers cannot be ported into React. |
| Train and predict | No CellCanvas training controls in copick-web | Port the behavior of `_local.py`/`_core_client.py`, not the Python UI: train, predict, pending/error state, explicit reconciliation, success-only refresh. Reuse existing core execution. |
| Choose image, features, labels and prediction stores | copick browsing identifies the tomogram; core service accepts server-registered datasets | Add an explicit binding between copick project/run/voxel size/reconstruction and a registered core dataset. Verify shape, transform, feature geometry and label meaning; matching names are insufficient. |
| Feature extraction / models | napari has an Album solution selector; core currently consumes precomputed features | Start with public-model precomputed features and a provenance manifest. Model extraction is a separate capability; do not recreate the entire solution launcher or imply it already exists in core. |
| Fine-tune an encoder | Not part of the inspected core classifier service | Later model-specific capability. Keep public backends independent of private model code/configuration/weights. |
| Embed in BioNotate | `create_app`, per-app registries, subpath support, same-origin iframe and read-only mode | Reuse. Campaign identity, hosted authentication and training eligibility remain host concerns. |

## Two service paths, not one interchangeable backend

Napari currently exposes a copick/Album workflow and a newer headless core workflow. The legacy painting server uses Zarr 2 and copick. The core service uses Zarr 3 arrays, registered `DataSet` objects, and a feature classifier. Its HTTP operations serialize train/predict per dataset, identify a service instance, and retain receipts in memory. It is not a durable Slurm queue or a remote multi-user annotation service. Napari currently restricts its client to loopback and identical local stores.

Build on the core service API for learning. Use a separate adapter process/environment for copick integration so incompatible Zarr dependencies are not forced into one Python environment. Decide the explicit copy/view/publication contract before connecting writes: preserve source reconstruction, axes, units, origin, scales, label IDs and unannotated voxels. Core currently has no network painting endpoint, and external writers do not participate in its lock. Concurrent editing must be solved rather than merely disabling one browser button. The core's prediction store may be partially written on failure: publish/refresh only after a successful ready receipt, with a complete output marker/version.

## First implemented increment: refreshed predictions

The existing **Reload project** action now refreshes label pixels as well as metadata:

1. The server reload clears copick and derived-data caches.
2. Client requests from the old generation are cancelled.
3. A project-scoped revision changes; visible label sources reopen, so idetik cannot retain old chunks.
4. Instance, surface-point and isosurface queries use the new revision. Isosurfaces wait for new loaders instead of recomputing from old cached pixels.
5. Mutable segmentation proxy responses use `Cache-Control: no-store`; fresh source URLs also carry the revision to bypass already-cached responses from older servers.

Image sources and camera/selection state are retained. The same refresh function can be called after a future successful CellCanvas prediction publication. This is explicit refresh, not polling or automatic job notification. Do not refresh midway through an in-place model write.

External registry URLs are not modified: they may be signed. Their hosts must require revalidation or publish a new immutable URL when content changes. This increment guarantees fresh HTTP keys for copick-web's own segmentation proxy, not arbitrary external caches.

## Next coherent implementation

The first full learning slice should bind one copick reconstruction to a registered core dataset with saved public-model features, add semantic painting and a CellCanvas panel, then execute **paint → train → predict → publish → refresh**. Preserve the core service's operation ID on uncertain responses; a timeout must not become a new training submission. A service restart invalidates the old receipt and requires explicit reconciliation.

Acceptance: browser and napari read back the same signed class annotations with unknown regions intact; the shared backend produces equivalent saved labels; a failed/interrupted prediction is never displayed as a completed release; the UI works under a BioNotate-style mount prefix. Public tests/examples require no private-model access. This is an engineering acceptance gate, not evidence of segmentation accuracy.

The port map and refresh increment are delivered locally. Painting, dataset binding, public-model feature production and the full learning loop remain subsequent implementation work, not capabilities claimed by this patch.
