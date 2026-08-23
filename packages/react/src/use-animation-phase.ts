import {
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";
import { browserClock } from "./clock";

const PHASE_SELECTOR = "[data-smoothstream-animation-start]";
const PHASE_PROPERTY = "--smoothstream-animation-delay";
const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Keep CSS entrance animations aligned with their reveal schedule. */
export const useAnimationPhase = (
  rootRef: RefObject<HTMLDivElement | null>,
): void => {
  const synchronizedPhasesRef = useRef(
    new WeakMap<HTMLElement, { duration: number; startAt: number }>(),
  );
  const phasedElementsRef = useRef(new Set<HTMLElement>());

  useBrowserLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const now = browserClock.now();
    const phasedElements = new Set<HTMLElement>();
    for (const element of root.querySelectorAll<HTMLElement>(PHASE_SELECTOR)) {
      phasedElements.add(element);
      const startAt = Number(element.dataset.smoothstreamAnimationStart);
      const duration = Number(element.dataset.smoothstreamAnimationDuration);
      if (!Number.isFinite(startAt) || !Number.isFinite(duration)) {
        continue;
      }

      const synchronizedPhase = synchronizedPhasesRef.current.get(element);
      if (
        synchronizedPhase?.startAt === startAt &&
        synchronizedPhase.duration === duration
      ) {
        continue;
      }

      const currentTime = Math.max(0, Math.min(duration, now - startAt));
      element.style.setProperty(PHASE_PROPERTY, `${-currentTime}ms`);
      synchronizedPhasesRef.current.set(element, { duration, startAt });
    }

    for (const element of phasedElementsRef.current) {
      if (phasedElements.has(element)) {
        continue;
      }
      element.style.removeProperty(PHASE_PROPERTY);
      if (element.style.length === 0) {
        element.removeAttribute("style");
      }
    }
    phasedElementsRef.current = phasedElements;
  });
};
