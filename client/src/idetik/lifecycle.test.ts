import { afterEach, describe, expect, test, vi } from "vitest";
import {
  readVisiblePanels,
  saveVisiblePanels,
  withSceneSignal,
} from "./lifecycle";

function stubStorage(value: string | null) {
  const setItem = vi.fn();
  vi.stubGlobal("localStorage", { getItem: () => value, setItem });
  return setItem;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lifecycle", () => {
  test("leaving a tomogram aborts its in-flight chunk and rejects queued loads before network work", async () => {
    const scene = new AbortController();
    const request = new AbortController();
    let calls = 0;
    const pending = withSceneSignal(
      scene.signal,
      request.signal,
      (signal) =>
        new Promise((_, reject) => {
          calls++;
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            {
              once: true,
            },
          );
        }),
    );
    scene.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      withSceneSignal(scene.signal, new AbortController().signal, async () => {
        calls++;
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });

  test("ordinary Idetik per-chunk cancellation remains effective", async () => {
    const scene = new AbortController();
    const request = new AbortController();
    const pending = withSceneSignal(
      scene.signal,
      request.signal,
      (signal) =>
        new Promise((_, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            {
              once: true,
            },
          ),
        ),
    );
    request.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(scene.signal.aborted).toBe(false);
  });

  test("new browsers default to XY + 3D, invalid all-hidden preferences do not trap the viewer", () => {
    expect(readVisiblePanels()).toEqual([true, false, false, true]);
    stubStorage("[false,false,false,false]");
    expect(readVisiblePanels()).toEqual([true, false, false, true]);
    stubStorage("[true,false,false,false]");
    expect(readVisiblePanels()).toEqual([true, false, false, false]);
    stubStorage("not json");
    expect(readVisiblePanels()).toEqual([true, false, false, true]);
  });

  test("saving is best effort", () => {
    const setItem = stubStorage(null);
    saveVisiblePanels([true, false, true, false]);
    expect(setItem).toHaveBeenCalledWith(
      "copick-web.viewer.visiblePanes.v2",
      "[true,false,true,false]",
    );
  });
});
