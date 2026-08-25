import { vi } from "vitest";

export interface ContractClock {
  drain(run: () => Promise<void>): Promise<void>;
}

export const installContractClock = (): ContractClock => {
  vi.useFakeTimers();
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(now), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) =>
    window.clearTimeout(id),
  );

  return {
    async drain(run) {
      now += 100_000;
      await run();
      await Promise.resolve();
      await run();
    },
  };
};
