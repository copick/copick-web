import { describe, expect, test } from "vitest";
import { API_BASE, api, appBaseOf, appUrl } from "./client";

describe("app URLs under a URL prefix", () => {
  test.each([
    ["http://localhost:8000/", "http://localhost:8000/"],
    [
      "https://ood.example.org/rnode/gpu-17/8123/",
      "https://ood.example.org/rnode/gpu-17/8123/",
    ],
    [
      "https://ood.example.org/node/gpu-17/8123/index.html?x=1#y",
      "https://ood.example.org/node/gpu-17/8123/",
    ],
  ])("the page %s is served from %s", (page, base) => {
    expect(appBaseOf(page).href).toBe(base);
  });

  test("API, store and asset URLs keep the prefix", () => {
    const base = appBaseOf("https://ood.example.org/rnode/gpu-17/8123/");
    expect(appUrl("api", base)).toBe(
      "https://ood.example.org/rnode/gpu-17/8123/api",
    );
    expect(appUrl("zarr/tomo/TS_001/10/wbp", base)).toBe(
      "https://ood.example.org/rnode/gpu-17/8123/zarr/tomo/TS_001/10/wbp",
    );
    // an absolute path from an older server stays under the prefix too
    expect(appUrl("/zarr/tomo/TS_001/10/wbp", base)).toBe(
      "https://ood.example.org/rnode/gpu-17/8123/zarr/tomo/TS_001/10/wbp",
    );
  });
});

describe("mesh URLs", () => {
  test("end in .glb (idetik's mesh loader needs it) and encode names", () => {
    const url = api.meshUrl(
      "p1",
      "TS 001",
      "valid-sample",
      "boundary-clean",
      "0",
    );
    expect(url).toBe(
      `${API_BASE}/projects/p1/runs/TS%20001/meshes/valid-sample/boundary-clean/0.glb`,
    );
    expect(new URL(url, "http://localhost/").pathname.endsWith(".glb")).toBe(
      true,
    );
  });
});
