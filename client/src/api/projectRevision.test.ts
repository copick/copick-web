import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import {
  refreshProjectData,
  revisionKey,
  segmentationSourceUrl,
} from "./projectRevision";

afterEach(() => vi.unstubAllGlobals());

test("reload isolates projects and does not recompute meshes using stale loaders", async () => {
  const client = new QueryClient();
  const staleMesh = vi.fn(() => "old pixels");
  await client.fetchQuery({
    queryKey: ["isosurface", "a", "run", "initial"],
    queryFn: staleMesh,
  });
  client.setQueryData(["runs", "a"], ["run"]);
  client.setQueryData(["runs", "b"], ["other"]);
  await refreshProjectData(client, "a");
  expect(client.getQueryData(revisionKey("a"))).toEqual(expect.any(String));
  expect(client.getQueryData(revisionKey("b"))).toBeUndefined();
  expect(client.getQueryState(["runs", "a"])?.isInvalidated).toBe(true);
  expect(client.getQueryState(["runs", "b"])?.isInvalidated).toBe(false);
  expect(staleMesh).toHaveBeenCalledTimes(1);
  const first = client.getQueryData(revisionKey("a"));
  await refreshProjectData(client, "a");
  expect(client.getQueryData(revisionKey("a"))).not.toBe(first);
  client.clear();
});

test("proxy refresh retains mount prefixes; external signed URLs stay unchanged", () => {
  vi.stubGlobal("window", {
    location: {
      origin: "https://viewer.test",
      href: "https://viewer.test/mount/projects/a/",
    },
  });
  const url =
    "https://viewer.test/mount/zarr/a/segmentation/binary/run/mask/user/session/10";
  expect(segmentationSourceUrl(url, "initial")).toBe(url);
  expect(segmentationSourceUrl(url, "next")).toBe(
    url + "?copick_revision=next",
  );
  const signed = "https://data.test/seg.zarr?signature=secret";
  expect(segmentationSourceUrl(signed, "next")).toBe(signed);
  expect(
    segmentationSourceUrl(
      "https://viewer.test/other-store?signature=x",
      "next",
    ),
  ).toContain("signature=x");
});
