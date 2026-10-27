import { describe, expect, test } from "vitest";
import { SHORTCUT_GROUPS } from "@/components/viewer/ShortcutsHelp";
import { canEdit, withoutEditing } from "./readOnly";

describe("editing tools on a read-only server", () => {
  test("are hidden when the config says read_only", () => {
    expect(canEdit({ read_only: true })).toBe(false);
  });

  test("are shown on a writable server, and on one older than the flag", () => {
    expect(canEdit({ read_only: false })).toBe(true);
    expect(canEdit({})).toBe(true);
  });

  test("stay hidden until the config has arrived", () => {
    expect(canEdit(undefined)).toBe(false);
  });

  test("leave the shortcuts help without the editing bindings", () => {
    const titles = (editable: boolean) =>
      withoutEditing(SHORTCUT_GROUPS, editable).map((g) => g.title);
    expect(titles(true)).toEqual(SHORTCUT_GROUPS.map((g) => g.title));
    expect(titles(false)).not.toContain("Editing picks");
    expect(titles(false)).not.toContain("Editing filaments");
    expect(titles(false)).toContain("Slice views (XY, XZ, YZ)");
  });
});
