/**
 * Read-only servers: a server started with `--read-only` (or embedded read-only in another application) refuses
 * every change to project data, and says so in the project config (`read_only`). The client then hides its editing
 * tools: the picking toolbar and pick create, edit and delete, filament editing, and the object type editor. Viewing
 * stays as it is.
 */

import type { ConfigResponse } from "@/api/types";

/**
 * Whether the project may be changed from this page. Unknown until the config has arrived, so the editing tools stay
 * hidden while it loads rather than flash up on a read-only server; a server older than the flag is writable.
 */
export function canEdit(
  config: Pick<ConfigResponse, "read_only"> | undefined,
): boolean {
  return config !== undefined && !config.read_only;
}

/** The items to show: all of them where the project may be changed, otherwise those not marked `editing`. */
export function withoutEditing<T extends { editing?: boolean }>(
  items: T[],
  editable: boolean,
): T[] {
  return editable ? items : items.filter((item) => !item.editing);
}
