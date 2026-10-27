import { describe, expect, test } from "vitest";
import type {
  FilamentsSummaryResponse,
  MeshSummaryResponse,
  PicksSummaryResponse,
  SegmentationSummaryResponse,
} from "@/api/types";
import { focusedLayers, parseSessions } from "./sessionFocus";

describe("sessions of the ?session= parameter", () => {
  test("are comma-separated", () => {
    expect(parseSessions("?session=job007,job008")).toEqual([
      "job007",
      "job008",
    ]);
  });

  test("may repeat, and mix with commas, in the order given", () => {
    expect(parseSessions("?session=b&session=a")).toEqual(["b", "a"]);
    expect(parseSessions("?session=a,b&session=c")).toEqual(["a", "b", "c"]);
  });

  test("are read with or without the leading ?, beside other parameters", () => {
    expect(parseSessions("session=job007")).toEqual(["job007"]);
    expect(parseSessions("?x=1&session=job007&y=2")).toEqual(["job007"]);
  });

  test("are trimmed, without empties and duplicates", () => {
    expect(parseSessions("?session= a , b,,a &session=b&session=c")).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(parseSessions("?session=%20job007%2Cjob008")).toEqual([
      "job007",
      "job008",
    ]);
  });

  test("are none when the parameter is absent, empty or junk", () => {
    expect(parseSessions("")).toEqual([]);
    expect(parseSessions("?")).toEqual([]);
    expect(parseSessions("?run=TS_001")).toEqual([]);
    expect(parseSessions("?session=")).toEqual([]);
    expect(parseSessions("?session")).toEqual([]);
    expect(parseSessions("?session=&session=,,")).toEqual([]);
    expect(parseSessions("?session=%20,%20")).toEqual([]);
  });
});

const color: [number, number, number, number] = [255, 0, 0, 255];

const picks: PicksSummaryResponse[] = [
  {
    object_name: "ribosome",
    user_id: "apex",
    session_id: "job007",
    point_count: 12,
    color,
  },
  {
    object_name: "ribosome",
    user_id: "curator",
    session_id: "1",
    point_count: 3,
    color,
  },
];

const segmentations: SegmentationSummaryResponse[] = [
  {
    name: "membrane",
    user_id: "apex",
    session_id: "job007",
    voxel_size: 10,
    is_multilabel: false,
    zarr_url: "seg.zarr",
    color: null,
  },
  {
    name: "cells",
    user_id: "apex",
    session_id: "job008",
    voxel_size: 10,
    is_multilabel: false,
    zarr_url: "cells.zarr",
    color: null,
    segmentation_type: "instance",
  },
];

const filaments: FilamentsSummaryResponse[] = [
  {
    object_name: "microtubule",
    user_id: "apex",
    session_id: "job008",
    filament_count: 4,
    color,
    instance_ids: [1, 2, 3, 4],
  },
];

const meshes: MeshSummaryResponse[] = [
  { object_name: "ribosome", user_id: "apex", session_id: "job007", color },
  { object_name: "membrane", user_id: "apex", session_id: "2", color },
];

describe("a run's layers of the focused sessions", () => {
  test("are those of every kind whose session is named", () => {
    expect(
      focusedLayers(
        ["job007", "job008"],
        picks,
        segmentations,
        filaments,
        meshes,
      ),
    ).toEqual({
      picks: [{ objectName: "ribosome", userId: "apex", sessionId: "job007" }],
      segmentations: [
        {
          name: "membrane",
          userId: "apex",
          sessionId: "job007",
          voxelSize: 10,
          segmentationType: "binary",
        },
        {
          name: "cells",
          userId: "apex",
          sessionId: "job008",
          voxelSize: 10,
          segmentationType: "instance",
        },
      ],
      filaments: [
        { objectName: "microtubule", userId: "apex", sessionId: "job008" },
      ],
      meshes: [{ objectName: "ribosome", userId: "apex", sessionId: "job007" }],
    });
  });

  test("are none for a session the run does not have", () => {
    expect(
      focusedLayers(["job009"], picks, segmentations, filaments, meshes),
    ).toEqual({ picks: [], segmentations: [], filaments: [], meshes: [] });
  });

  test("are none without sessions, or for a list not loaded yet", () => {
    expect(focusedLayers([], picks, segmentations, filaments, meshes)).toEqual({
      picks: [],
      segmentations: [],
      filaments: [],
      meshes: [],
    });
    expect(
      focusedLayers(["job007"], undefined, undefined, undefined, meshes),
    ).toEqual({
      picks: [],
      segmentations: [],
      filaments: [],
      meshes: [{ objectName: "ribosome", userId: "apex", sessionId: "job007" }],
    });
  });
});
