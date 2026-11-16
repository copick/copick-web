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

## Learning slice: paint, train, predict, publish, refresh

A server-side binding file (`CELLCANVAS_BINDINGS`, or `create_app(cellcanvas_bindings=...)`) names, for one copick run, voxel spacing and reconstruction, a dataset of a loopback CellCanvas core service, its classes, the copick segmentations used for painting and predictions, and the feature provenance. The browser names a binding only by its ID; it cannot choose service URLs or paths. Bindings match a project by its ID or its local config file.

- **Two environments, one HTTP contract.** copick-web (copick, Zarr 2) is the adapter; the core service (cellcanvas-core, Zarr 3) holds the image copy, features, its painting copy and its prediction store. `python -m cellcanvas_service.prepare` registers a copick tomogram with saved features, copying the image with its scale, origin and units and refusing feature manifests that do not declare a public model or that are not on the reconstruction grid.
- **Geometry binding.** The panel's status compares the core dataset's painting, prediction and feature spatial shapes, voxel size, origin and units (converted to Å) with the copick reconstruction, and the client additionally compares the opened volume's grid. Painting, Train and Predict are disabled on any mismatch.
- **Semantic painting.** Paint/Erase on any ortho pane paints discs of a chosen radius in that plane, interpolated along the drag. Each stroke is saved to a copick multilabel segmentation (`uint8`), with an optimistic revision check. Zero is unannotated; erase returns voxels to it; classes are the binding's positive IDs, and a background class is explicit. Painting written by another tool is accepted if its labels are bound classes.
- **Train and Predict with receipts.** The client chooses an operation ID and remembers it; the server persists it beside the binding file before submitting. Training first copies the painting sparsely into the core with its revision, and the model records the revision it was trained on (the panel flags painting changed since training). A retry or page reload reconciles the same operation; a different operation is refused while one is pending; a core restart reports the receipt lost.
- **Success-only publication.** The core serves a prediction only when its status is ready and its version is current. The adapter writes it to a staging directory and swaps it into the copick prediction segmentation, with metadata (operation, version, painting revision, features). A failed or interrupted prediction is not published, and the previous publication remains. The client refreshes label sources (the increment above) only for a new complete publication.

Run a local preview with a real core service:

```bash
cd server
PYTHONPATH=src python scripts/cellcanvas_preview.py /tmp/cc-preview \
  --core-python /path/to/cellcanvas/.venv/bin/python --serve   # add --check for the HTTP roundtrip
```

It builds the 32³ demo project and *synthetic* fixture features. For a real reconstruction with saved public-model features, add `--copick-config CONFIG --run RUN --voxel-size VS --tomo-type TYPE --features F --manifest M`. On a real volume, `--check` paints placement-only strokes (it tests storage and plumbing, not annotation) into the bound painting segmentation.

### Limits

- Fixture validation shows that the parts are connected correctly; it is not evidence of segmentation quality. No public-model features have been demonstrated yet: core needs per-voxel features on the reconstruction grid, so a patch model's (for example DINO) features must be resampled by their producer and the resampling recorded in the manifest.
- Strokes appear after each save and refresh, with no optimistic local overlay. Brushes are 2D discs in one plane, and there is no undo.
- Training reads the whole painting volume, and publication reads the whole prediction into memory. That is appropriate for one volume, not for large batches.
- Publication needs a local copick overlay filesystem (atomic directory swap). Remote overlays are refused (501).
- Core receipts are memory-only: a restart loses the model, and the panel asks the user to train again. The core is single-user and loopback-only. Hosted authentication and training eligibility remain host (BioNotate) concerns.
- napari compatibility is checked by reading through a freshly opened copick root, which is napari-copick's read path. The napari GUI was not run.
