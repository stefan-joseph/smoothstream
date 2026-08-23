import {
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { SmoothstreamMotion } from "./types";

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
  motion: SmoothstreamMotion,
): ResolvedMotion => {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    hydratedClientSnapshot,
    unhydratedServerSnapshot,
  );
  const [motionDisabled, setMotionDisabled] = useState(
    () => motion === "none" || (
      motion === "system" && systemPrefersReducedMotion()
    ),
  );

  useEffect(() => {
    if (motion === "none") {
      setMotionDisabled(true);
      return;
    }
    if (
      motion === "animate" ||
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
  }, [motion, motionDisabled]);

  if (motion === "system" && !hydrated) {
    return "pending";
  }
  if (motion === "none" || motionDisabled) {
    return "none";
  }
  if (motion === "animate") {
    return "animate";
  }
  return "animate";
};
