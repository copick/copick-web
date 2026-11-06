import { describe, expect, it } from "vitest";
import { hostPaintingRef, strokeBox } from "./annotations";

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
