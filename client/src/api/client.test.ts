import { describe, expect, test } from "vitest";
import { appBaseOf, appUrl } from "./client";

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
