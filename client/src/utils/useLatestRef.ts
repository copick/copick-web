import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * A ref that holds the latest `value`, for callbacks registered once (event handlers, scene loaders) that must
 * not re-subscribe when it changes. It is updated after each commit, before any effect or event reads it, so
 * render stays pure.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
