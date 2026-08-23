import type { Clock } from "@smoothstream/core";

export const browserClock: Clock = {
  now: () =>
    typeof performance === "undefined" ? Date.now() : performance.now(),
};
