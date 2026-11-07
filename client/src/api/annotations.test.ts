import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  call,
  hostPaintingRef,
  refusalMessage,
  strokeBox,
} from "./annotations";

describe("strokeBox", () => {
  it("grows in-plane by margin + radius and across the plane by depth, clipped to the volume", () => {
    const box = strokeBox(
      {
        label: 2,
        radius: 1.5,
        plane: "XY",
        points: [
          [10, 4, 7],
          [14, 6, 7],
        ],
      },
      [32, 32, 16],
      4,
      2,
    );
    expect(box).toEqual([
      [4, 21],
      [0, 13],
      [5, 10],
    ]);
  });
});

describe("hostPaintingRef", () => {
  it("is set only when the host names segmentation, user and session", () => {
    expect(
      hostPaintingRef(
        "?paint_name=membrane-edit&paint_user=annotator7&paint_session=task42",
      ),
    ).toEqual({
      name: "membrane-edit",
      user_id: "annotator7",
      session_id: "task42",
    });
    expect(hostPaintingRef("?paint_name=x&paint_user=y")).toBeNull();
  });
});

describe("refusals", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("are worded from the server's code rather than its generic detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { detail: "Annotation operation refused", code: "geometry_mismatch" },
          { status: 409 },
        ),
      ),
    );
    const error = (await call("/x", {}).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.code).toBe("geometry_mismatch");
    expect(error.message).toMatch(/different voxel grid/);
  });

  it("name stale revisions and incomplete proposals, and fall back to detail for unknown codes", () => {
    expect(refusalMessage("revision_conflict", "x")).toMatch(/changed since/);
    expect(refusalMessage("not_complete", "x")).toMatch(
      /not a completed proposal/,
    );
    expect(refusalMessage("something_new", "Detail")).toBe("Detail");
    expect(refusalMessage(undefined, "Detail")).toBe("Detail");
  });
});
