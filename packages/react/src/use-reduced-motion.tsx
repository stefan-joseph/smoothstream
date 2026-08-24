import {
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { SmoothstreamReducedMotion } from "./types";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const subscribeToHydration = (): (() => void) => () => undefined;
const hydratedClientSnapshot = (): true => true;
const unhydratedServerSnapshot = (): false => false;

export type ResolvedMotion = "pending" | "animate" | "none";

const systemPrefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(REDUCED_MOTION_QUERY).matches;

/**
 * Once reduced motion is observed, keep it for this mounted response. Turning
 * animation back on mid-playback would replay content that is already visible.
 */
export const useReducedMotion = (
  reducedMotion: SmoothstreamReducedMotion,
): ResolvedMotion => {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    hydratedClientSnapshot,
    unhydratedServerSnapshot,
  );
  const [motionDisabled, setMotionDisabled] = useState(
    () => reducedMotion === "always" || (
      reducedMotion === "system" && systemPrefersReducedMotion()
    ),
  );

  useEffect(() => {
    if (reducedMotion === "always") {
      setMotionDisabled(true);
      return;
    }
    if (
      reducedMotion === "never" ||
      motionDisabled ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    if (query.matches) {
      setMotionDisabled(true);
      return;
    }

    const handleChange = (event: MediaQueryListEvent): void => {
      if (event.matches) {
        setMotionDisabled(true);
      }
    };

    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", handleChange);
      return () => query.removeEventListener("change", handleChange);
    }

    query.addListener(handleChange);
    return () => query.removeListener(handleChange);
  }, [motionDisabled, reducedMotion]);

  if (reducedMotion === "system" && !hydrated) {
    return "pending";
  }
  if (reducedMotion === "always" || motionDisabled) {
    return "none";
  }
  if (reducedMotion === "never") {
    return "animate";
  }
  return "animate";
};
