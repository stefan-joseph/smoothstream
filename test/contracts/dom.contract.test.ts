// @vitest-environment jsdom

import { createSmoothstream } from "@smoothstream/dom";
import { afterEach, vi } from "vitest";
import {
  type AdapterContractDriver,
  type AdapterContractOptions,
  runAdapterContract,
} from "./adapter-contract";
import { installContractClock } from "./test-clock";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

runAdapterContract({
  name: "DOM",
  async mount(source, options: AdapterContractOptions = {}) {
    const clock = installContractClock();
    const container = document.createElement("div");
    document.body.append(container);
    const controller = createSmoothstream(container, options);
    controller.update(
      source,
      options.receiving === undefined ? {} : { receiving: options.receiving },
    );

    const flush = async (): Promise<void> => {
      await clock.drain(async () => {
        await vi.runAllTimersAsync();
      });
    };
    await flush();

    return {
      destroy() {
        controller.destroy();
        container.remove();
      },
      element: controller.element,
      flush,
      async update(nextSource, updateOptions = {}) {
        controller.update(nextSource, updateOptions);
        await flush();
      },
    } satisfies AdapterContractDriver;
  },
});
