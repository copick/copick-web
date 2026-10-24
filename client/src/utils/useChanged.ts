import { useState } from "react";

/**
 * Whether any of `values` changed since the previous render (true on the first, like an effect's first run).
 * The values are kept in state, so the caller can adjust its own state in response while rendering instead of
 * in an effect that would render again: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
 */
export function useChanged(values: readonly unknown[]): boolean {
  const [previous, setPrevious] = useState<readonly unknown[] | null>(null);
  const changed =
    previous === null ||
    previous.length !== values.length ||
    values.some((value, i) => !Object.is(value, previous[i]));
  if (changed) setPrevious(values);
  return changed;
}
