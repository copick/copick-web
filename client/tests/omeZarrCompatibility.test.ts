import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { OmeZarrImageSource } from "@idetik/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtureRoot = resolve(
  fileURLToPath(new URL("./fixtures/", import.meta.url)),
);
let requests: Request[] = [];
type LoaderChunk = Parameters<OmeZarrImageSource["loader"]["loadChunkData"]>[0];

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
}

function fixturePath(url: URL): string | undefined {
  const relative = decodeURIComponent(url.pathname)
    .replace(/^\/+/, "")
    .replace("v3-truncated.zarr", "v3-floating.zarr");
  const candidate = resolve(fixtureRoot, relative);
  if (
    candidate !== fixtureRoot &&
    !candidate.startsWith(`${fixtureRoot}${sep}`)
  )
    return undefined;
  return candidate;
}

async function fixtureFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const request = new Request(input, init);
  requests.push(request.clone());
  const requestUrl = new URL(request.url);

  if (
    requestUrl.pathname === "/invalid.zarr/zarr.json" &&
    request.method === "GET"
  ) {
    return new Response(
      JSON.stringify({
        zarr_format: 3,
        node_type: "group",
        attributes: { ome: { version: "0.5", multiscales: [] } },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const path = fixturePath(requestUrl);
  if (!path) return new Response(null, { status: 404 });

  let contents: Uint8Array;
  try {
    contents = await readFile(path);
  } catch {
    return new Response(null, { status: 404 });
  }
  if (
    requestUrl.pathname.includes("v3-truncated.zarr") &&
    requestUrl.pathname.endsWith("/0/0/0/0")
  ) {
    contents = contents.slice(0, -16);
  }

  const commonHeaders = {
    "Accept-Ranges": "bytes",
    "Content-Length": String(contents.byteLength),
  };
  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers: commonHeaders });
  }

  const range = request.headers.get("Range");
  if (!range) {
    return new Response(asArrayBuffer(contents), {
      status: 200,
      headers: commonHeaders,
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return new Response(null, { status: 416 });
  const start = match[1]
    ? Number(match[1])
    : Math.max(contents.byteLength - Number(match[2]), 0);
  const end = match[2] ? Number(match[2]) : contents.byteLength - 1;
  const selected = contents.slice(start, Math.min(end + 1, contents.length));
  return new Response(asArrayBuffer(selected), {
    status: 206,
    headers: {
      ...commonHeaders,
      "Content-Length": String(selected.byteLength),
      "Content-Range": `bytes ${start}-${start + selected.byteLength - 1}/${contents.byteLength}`,
    },
  });
}

function createFirstChunk(source: OmeZarrImageSource): LoaderChunk {
  const dimensions = source.getDimensions();
  return {
    state: "unloaded" as const,
    lod: 0,
    shape: {
      x: dimensions.x.lods[0].chunkSize,
      y: dimensions.y.lods[0].chunkSize,
      z: dimensions.z?.lods[0].chunkSize ?? 1,
      c: 1,
    },
    rowAlignmentBytes: 1 as const,
    chunkIndex: { x: 0, y: 0, z: 0, c: 0, t: 0 },
    scale: { x: 1, y: 1, z: 1 },
    offset: { x: 0, y: 0, z: 0 },
    visible: true,
    prefetch: false,
    priority: null,
    orderKey: null,
  };
}

async function loadFirstChunk(fixture: string) {
  const source = await OmeZarrImageSource.fromHttp({
    url: `http://fixtures.test/${fixture}`,
  });
  const chunk = createFirstChunk(source);
  await source.loader.loadChunkData(chunk, new AbortController().signal);
  return { source, chunk };
}

const firstIntegerChunk = [
  0, 1, 2, 3, 6, 7, 8, 9, 12, 13, 14, 15, 30, 31, 32, 33, 36, 37, 38, 39, 42,
  43, 44, 45,
];

beforeEach(() => {
  requests = [];
  vi.stubGlobal("fetch", fixtureFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OME-Zarr format compatibility", () => {
  it.each(["v2-numeric.zarr", "v2-nonnumeric.zarr"])(
    "discovers and decodes legacy OME-Zarr 0.4 / Zarr v2 paths from %s",
    async (fixture) => {
      const { source, chunk } = await loadFirstChunk(fixture);

      expect(source.getDimensions()).toMatchObject({
        numLods: 1,
        x: { lods: [{ size: 6, chunkSize: 4, scale: 10 }] },
        y: { lods: [{ size: 5, chunkSize: 3, scale: 10 }] },
        z: { lods: [{ size: 4, chunkSize: 2, scale: 10 }] },
      });
      expect(Array.from(chunk.data ?? [])).toEqual(firstIntegerChunk);
    },
  );

  it("decodes an unsharded OME-Zarr 0.5 / Zarr v3 chunk", async () => {
    const { chunk } = await loadFirstChunk("v3-unsharded.zarr");
    expect(Array.from(chunk.data ?? [])).toEqual(firstIntegerChunk);
  });

  it("decodes a canonical sharded integer OME-Zarr 0.5 / Zarr v3 chunk", async () => {
    const { source, chunk } = await loadFirstChunk("v3-integer.zarr");

    expect(source.getDimensions()).toMatchObject({
      numLods: 1,
      x: { lods: [{ size: 6, chunkSize: 4, scale: 10 }] },
      y: { lods: [{ size: 5, chunkSize: 3, scale: 10 }] },
      z: { lods: [{ size: 4, chunkSize: 2, scale: 10 }] },
    });
    expect(Array.from(chunk.data ?? [])).toEqual(firstIntegerChunk);
  });

  it("decodes shuffled floating-point chunks and uses bounded shard reads", async () => {
    const { chunk } = await loadFirstChunk("v3-floating.zarr");

    expect(Array.from(chunk.data ?? [])).toEqual([
      0, 0.125, 0.25, 0.375, -0.25, -0.125, 0, 0.125, -0.5, -0.375, -0.25,
      -0.125, 0.5, 0.625, 0.75, 0.875, 0.25, 0.375, 0.5, 0.625, 0, 0.125, 0.25,
      0.375,
    ]);

    const shardRequests = requests.filter((request) =>
      new URL(request.url).pathname.endsWith("/0/0/0/0"),
    );
    expect(shardRequests.some((request) => request.method === "HEAD")).toBe(
      true,
    );
    const shardGets = shardRequests.filter(
      (request) => request.method === "GET",
    );
    expect(shardGets.length).toBeGreaterThan(0);
    expect(shardGets.every((request) => request.headers.has("Range"))).toBe(
      true,
    );
  });

  it("rejects invalid metadata and truncated shards", async () => {
    await expect(
      OmeZarrImageSource.fromHttp({ url: "http://fixtures.test/invalid.zarr" }),
    ).rejects.toThrow("Failed to parse OME-Zarr image");
    await expect(loadFirstChunk("v3-truncated.zarr")).rejects.toThrow();
  });
});
