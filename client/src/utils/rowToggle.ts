/**
 * Double-click on a table row toggles its entity, like its eye button. Double-clicks that land on a button (the eye
 * button itself, expand toggles) are left to that button, so they don't toggle twice.
 */
import type { MouseEvent } from "react";

export function rowDoubleClick(toggle: () => void) {
  return (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button, input, a")) return;
    toggle();
  };
}

/** Row styling for double-click toggling: no text selection on double-click. */
export const toggleRowSx = { cursor: "pointer", userSelect: "none" } as const;
