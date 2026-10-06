import { describe, expect, test } from "vitest";
import { ThumbnailStore, type Thumbnail } from "./thumbnails";

const ready = (url: string): Thumbnail => ({
  state: "ready",
  url,
  tomoType: "wbp",
  voxelSize: 10,
});

function setup(maxEntries = 3, maxAgeMs = 1000) {
  let t = 0;
  const released: string[] = [];
  const store = new ThumbnailStore(
    maxEntries,
    maxAgeMs,
    () => t,
    (url) => released.push(url),
  );
  return { store, released, tick: (ms: number) => (t += ms) };
}

describe("gallery thumbnail store", () => {
  test("keeps at most maxEntries, dropping the oldest and releasing their URLs", () => {
    const { store, released } = setup(3);
    ["a", "b", "c", "d"].forEach((run) => store.set(run, ready(`blob:${run}`)));
    expect(store.size).toBe(3);
    expect(store.get("a")).toBeUndefined();
    expect(released).toEqual(["blob:a"]);
  });

  test("never drops thumbnails that are still loading", () => {
    const { store } = setup(2);
    store.set("a", { state: "loading" });
    store.set("b", { state: "loading" });
    store.set("c", ready("blob:c"));
    expect(store.get("a")?.state).toBe("loading");
    expect(store.get("b")?.state).toBe("loading");
  });

  test("sweep drops thumbnails older than maxAge", () => {
    const { store, released, tick } = setup(10, 1000);
    store.set("old", ready("blob:old"));
    tick(600);
    store.set("new", ready("blob:new"));
    tick(600);
    expect(store.sweep()).toBe(1);
    expect(store.get("old")).toBeUndefined();
    expect(store.get("new")).toBeDefined();
    expect(released).toEqual(["blob:old"]);
  });

  test("replacing a thumbnail releases the previous URL and notifies", () => {
    const { store, released } = setup();
    let notified = 0;
    store.subscribe(() => notified++);
    store.set("a", ready("blob:1"));
    store.set("a", ready("blob:2"));
    expect(released).toEqual(["blob:1"]);
    expect(notified).toBe(2);
  });
});
