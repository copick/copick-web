"""A host application that embeds copick-web as the painting editor of one annotation task.

The host (for example a campaign service such as BioNotate) owns identity and task assignment. It mounts copick-web,
fixes the painted segmentation in the iframe URL (``paint_name``, ``paint_user``, ``paint_session``), and on submission
records the painting revision it accepts. copick-web owns the edit checks: grid, classes, revisions, undo, and
accepting only completed proposals into unknown voxels.

    python examples/annotation_task.py /abs/copick_config.json TS_001 10.0 wbp --user annotator7 --task task42 \
        [--nninteractive http://127.0.0.1:8537] [--port 8600]

Open the printed URL, paint, then ``GET /tasks/task42`` returns the submitted revision.
"""

import argparse
from contextlib import asynccontextmanager
from urllib.parse import urlencode

import httpx
import uvicorn
from fastapi import FastAPI

from copick_web.app.main import create_app


def build_host(config: str, run: str, voxel_size: float, tomo_type: str, user: str, task: str, nninteractive=None):
    copick_app = create_app(allow_empty=True, nninteractive_url=nninteractive)
    project_id = copick_app.state.registry.register_local(config)
    painting = {"name": "painting", "user_id": user, "session_id": task}

    @asynccontextmanager
    async def lifespan(host: FastAPI):
        async with copick_app.router.lifespan_context(copick_app):
            yield

    host = FastAPI(lifespan=lifespan)
    host.mount("/copick-web", copick_app)

    @host.get("/tasks/{task_id}")
    async def task_state(task_id: str):
        """What the host would record on submission: the exact painting revision (or None if never painted)."""
        query = {"run": run, "voxel_size": voxel_size, "tomo_type": tomo_type, **painting}
        transport = httpx.ASGITransport(app=copick_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://copick-web") as client:
            state = (await client.get(f"/api/projects/{project_id}/painting", params=query)).json()
        return {"task": task_id, "painting": painting, "revision": state["revision"], "exists": state["exists"]}

    editor = f"/copick-web/projects/{project_id}/?" + urlencode(
        {"paint_name": painting["name"], "paint_user": user, "paint_session": task}
    )
    return host, editor


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("config")
    parser.add_argument("run")
    parser.add_argument("voxel_size", type=float)
    parser.add_argument("tomo_type")
    parser.add_argument("--user", required=True)
    parser.add_argument("--task", required=True)
    parser.add_argument("--nninteractive")
    parser.add_argument("--port", type=int, default=8600)
    args = parser.parse_args()
    host, editor = build_host(
        args.config, args.run, args.voxel_size, args.tomo_type, args.user, args.task, args.nninteractive
    )
    print(f"editor: http://127.0.0.1:{args.port}{editor}")
    uvicorn.run(host, host="127.0.0.1", port=args.port)
