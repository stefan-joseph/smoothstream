import { useEffect, useRef, useState } from "react";
import type { ImageDescriptor, ImageReadiness } from "@smoothstream/core";
import { browserClock } from "./clock";

interface ImageReadinessSnapshot {
  readonly images: ReadonlyMap<string, ImageReadiness>;
  readonly now: number;
}

export const useImageReadiness = (
  descriptors: ReadonlyArray<ImageDescriptor>,
  duration: number,
): ImageReadinessSnapshot => {
  const signature = descriptors
    .map(({ id, src }) => `${id}:${src}`)
    .join("|");
  const imagesRef = useRef(new Map<string, ImageReadiness>());
  const loadingRef = useRef(new Map<string, HTMLImageElement>());
  const timersRef = useRef(new Set<number>());
  const [snapshot, setSnapshot] = useState({ now: 0, revision: 0 });

  useEffect(() => {
    const publish = (): void => {
      setSnapshot((current) => ({
        now: browserClock.now(),
        revision: current.revision + 1,
      }));
    };

    for (const { id, src } of descriptors) {
      if (imagesRef.current.has(id) || loadingRef.current.has(id)) {
        continue;
      }

      let finished = false;
      const finish = (
        status: ImageReadiness["status"],
        image?: HTMLImageElement,
      ): void => {
        if (finished) {
          return;
        }
        finished = true;
        loadingRef.current.delete(id);

        const readyAt = browserClock.now();
        const width = image?.naturalWidth ?? 0;
        const height = image?.naturalHeight ?? 0;
        imagesRef.current.set(
          id,
          status === "ready" && width > 0 && height > 0
            ? { height, readyAt, status, width }
            : { readyAt, status },
        );
        publish();

        const timerId = window.setTimeout(() => {
          timersRef.current.delete(timerId);
          publish();
        }, duration);
        timersRef.current.add(timerId);
      };

      if (src.length === 0) {
        finish("error");
        continue;
      }

      const image = new window.Image();
      loadingRef.current.set(id, image);
      image.decoding = "async";
      image.onerror = () => finish("error");
      let decodeStarted = false;
      const handleLoad = (): void => {
        if (decodeStarted || finished) {
          return;
        }
        decodeStarted = true;
        const decoded = typeof image.decode === "function"
          ? image.decode().catch(() => undefined)
          : Promise.resolve();
        void decoded.then(() => finish("ready", image));
      };
      image.onload = handleLoad;
      image.src = src;

      if (image.complete && image.naturalWidth > 0) {
        handleLoad();
      }
    }
  }, [descriptors, duration, signature]);

  useEffect(
    () => () => {
      for (const image of loadingRef.current.values()) {
        image.onload = null;
        image.onerror = null;
      }
      loadingRef.current.clear();
      for (const timerId of timersRef.current) {
        window.clearTimeout(timerId);
      }
      timersRef.current.clear();
    },
    [],
  );

  return {
    images: imagesRef.current,
    now: snapshot.now,
  };
};
