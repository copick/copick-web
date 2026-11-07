"""Prompted segmentation through a copick-aware nnInteractive server.

The server (``nninteractive-server`` of napari-nninteractive-remote) reads the tomogram from the same copick project,
so no image crosses this connection. Its URL is server configuration (``NNINTERACTIVE_URL`` or
``create_app(nninteractive_url=...)``); the browser only names sessions this app opened.

Each prompt is followed by publication of the session's current object into a *proposal* segmentation, never into a
painting: the object is written with the nnInteractive server's own revision check, read back here, and only then
recorded as a completed proposal (``attrs["proposal"]``), which is what painting acceptance requires. A request that
fails or dies mid-write leaves no matching record, so the partial object cannot be accepted.

Coordinates here are voxel indices ``(x, y, z)`` on the reconstruction grid, like brush strokes; the session runs at
resolution level 0 and must have exactly that grid. nnInteractive's own axes are ``(z, y, x)``.
"""

from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass
from typing import Optional

import httpx

from .annotations import AnnotationError, Painting, SegmentationRef, record_proposal, target_lock

logger = logging.getLogger(__name__)

PRODUCER = "nninteractive"


@dataclass
class Opened:
    project_id: str
    run: str
    voxel_size: float
    tomo_type: str
    shape: list[int]  # z, y, x
    supports_undo: bool


def _zyx(box_xyz: list[list[int]]) -> list[list[int]]:
    return [list(map(int, b)) for b in box_xyz[::-1]]


def _xyz_region(header: Optional[str]):
    region = json.loads(header) if header else None
    return None if region is None else region[::-1]


class NNInteractive:
    def __init__(self, url: str, client_factory=None):
        self.url = url.rstrip("/")
        self._client_factory = client_factory or (lambda: httpx.Client(timeout=600))
        self._sessions: dict[str, Opened] = {}
        self._guard = threading.Lock()

    def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        try:
            with self._client_factory() as client:
                response = client.request(method, f"{self.url}{path}", **kwargs)
        except httpx.HTTPError as error:
            raise AnnotationError(f"nnInteractive server unreachable: {error}", "backend_unavailable", 502) from None
        if response.status_code >= 400:
            try:
                detail = response.json().get("detail", response.text)
            except ValueError:
                detail = response.text
            code = {404: "session_lost", 409: "refused"}.get(response.status_code, "backend_error")
            raise AnnotationError(str(detail), code, response.status_code if response.status_code < 500 else 502)
        return response

    def available(self) -> dict:
        try:
            self._request("GET", "/health")
            return {"available": True}
        except AnnotationError as error:
            logger.warning("nnInteractive server unavailable (code=%s): %s", error.code, error)
            return {"available": False, "code": error.code}

    # sessions -------------------------------------------------------------------------------------------------

    def open(self, project_id: str, config_path: Optional[str], painting: Painting) -> dict:
        """Start a session on the painting's reconstruction; its grid must equal the reconstruction grid."""
        if config_path is None:
            raise AnnotationError("nnInteractive needs a local copick project config.", "unsupported_project", 501)
        shape = painting.shape()
        info = self._request(
            "POST",
            "/sessions",
            json={
                "copick_config": config_path,
                "run_name": painting.run,
                "voxel_spacing": painting.voxel_size,
                "tomo_type": painting.tomo_type,
                "resolution_level": 0,
            },
        ).json()
        if list(info["image_shape"]) != shape:
            self._request("DELETE", f"/sessions/{info['session_id']}")
            raise AnnotationError(
                f"nnInteractive session grid {info['image_shape']} differs from the reconstruction {shape}.",
                "geometry_mismatch",
            )
        opened = Opened(project_id, painting.run, painting.voxel_size, painting.tomo_type, shape, info["supports_undo"])
        with self._guard:
            self._sessions[info["session_id"]] = opened
        return {"session_id": info["session_id"], "shape": shape[::-1], "supports_undo": opened.supports_undo}

    def _opened(self, session_id: str, project_id: str, painting: Painting) -> Opened:
        opened = self._sessions.get(session_id)
        if opened is None or opened.project_id != project_id:
            raise AnnotationError("Unknown nnInteractive session; start a new one.", "session_lost", 404)
        if (opened.run, round(opened.voxel_size, 3), opened.tomo_type) != (
            painting.run,
            round(painting.voxel_size, 3),
            painting.tomo_type,
        ):
            raise AnnotationError("This session belongs to another reconstruction.", "invalid_request", 400)
        return opened

    def close(self, session_id: str, project_id: str) -> None:
        with self._guard:
            opened = self._sessions.get(session_id)
            if opened is None or opened.project_id != project_id:
                return
            del self._sessions[session_id]
        try:
            self._request("DELETE", f"/sessions/{session_id}")
        except AnnotationError:
            pass  # already evicted by the server

    # prompts --------------------------------------------------------------------------------------------------

    def prompt(
        self,
        session_id: str,
        project_id: str,
        painting: Painting,
        proposal: SegmentationRef,
        proposal_label: int,
        *,
        label: Optional[int] = None,
        box: Optional[list[list[int]]] = None,
        point: Optional[list[int]] = None,
        include: bool = True,
    ) -> dict:
        """One prompt, then publication of the current object as a completed proposal.

        ``label`` + ``box``: the painting's ``label`` voxels inside ``box`` are positive and its other painted labels
        (explicit background included) negative for this object; unknown voxels are not prompts. ``point``: one
        positive or negative click.
        """
        self._opened(session_id, project_id, painting)
        if point is not None:
            response = self._request(
                "POST",
                f"/sessions/{session_id}/point",
                params={"region_only": "true"},
                json={"coordinates": [float(v) for v in point[::-1]], "include": bool(include)},
            )
            prompt = {"kind": "point", "point": list(point), "include": bool(include)}
        elif label is not None and box is not None:
            response = self._request(
                "POST",
                f"/sessions/{session_id}/copick/scribbles",
                params={"region_only": "true"},
                json={"segmentation": painting.ref.__dict__, "label": int(label), "region": _zyx(box)},
            )
            prompt = {
                "kind": "painting",
                "painting": painting.ref.__dict__,
                "painting_revision": painting.state()["revision"],
                "label": int(label),
                "box": box,
                "voxels": json.loads(response.headers.get("X-Prompt-Voxels") or "null"),
            }
        else:
            raise AnnotationError("Give a point, or a painted label and box.", "invalid_request", 400)
        region = _xyz_region(response.headers.get("X-Region"))
        return {"changed_region": region, **self.publish(session_id, painting, proposal, proposal_label, prompt)}

    def undo(self, session_id: str, project_id: str, painting: Painting, proposal: SegmentationRef, label: int):
        """nnInteractive's single-level undo (409 when it cannot revert the last prompt), then republication."""
        opened = self._opened(session_id, project_id, painting)
        if not opened.supports_undo:
            raise AnnotationError("This nnInteractive backend has no undo.", "refused")
        response = self._request("POST", f"/sessions/{session_id}/undo", params={"region_only": "true"})
        region = _xyz_region(response.headers.get("X-Region"))
        return {"changed_region": region, **self.publish(session_id, painting, proposal, label, {"kind": "undo"})}

    def publish(self, session_id: str, painting: Painting, proposal: SegmentationRef, label: int, prompt: dict):
        if proposal == painting.ref:
            raise AnnotationError(
                "Model output goes to a proposal segmentation, not the painting.", "invalid_request", 400
            )
        if not 0 < int(label) < 256:
            raise AnnotationError("Proposal label must be 1-255.", "invalid_request", 400)
        lock = target_lock(id(painting.service), painting.run, round(painting.voxel_size, 3), proposal)
        if not lock.acquire(timeout=60):
            raise AnnotationError("Another publication to this proposal is in progress.", "busy")
        try:
            query = {"name": proposal.name, "user_id": proposal.user_id, "seg_session_id": proposal.session_id}
            expected = self._request("GET", f"/sessions/{session_id}/copick/revision", params=query).json()["revision"]
            written = self._request(
                "POST",
                f"/sessions/{session_id}/copick/publish",
                json={"segmentation": proposal.__dict__, "label": int(label), "expected_revision": expected},
            ).json()
            # Completed on the server; confirm that what is stored now is that write before recording it.
            now = self._request("GET", f"/sessions/{session_id}/copick/revision", params=query).json()["revision"]
            if now != written["revision"]:
                raise AnnotationError("Proposal changed during publication; prompt again.", "revision_conflict")
            painting.service.clear_stores()
            group = painting._open(proposal)
            if group is None or list(group["0"].shape) != painting.shape():
                raise AnnotationError("Published proposal is not on the reconstruction grid.", "geometry_mismatch")
            record = record_proposal(
                group,
                PRODUCER,
                label=int(label),
                backend_revision=written["revision"],
                prompt=prompt,
            )
            return {"proposal": {"ref": proposal.__dict__, **record}, "written_voxels": written["written_voxels"]}
        finally:
            lock.release()
