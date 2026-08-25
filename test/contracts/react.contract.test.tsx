// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { Smoothstream } from "@smoothstream/react";
import {
  type AdapterContractDriver,
  type AdapterContractOptions,
  runAdapterContract,
} from "./adapter-contract";
import { installContractClock } from "./test-clock";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

runAdapterContract({
  name: "React",
  async mount(source, options: AdapterContractOptions = {}) {
    const clock = installContractClock();
    let currentSource = source;
    let receiving = options.receiving ?? false;
    const view = render(
      <Smoothstream {...options} receiving={receiving}>
        {currentSource}
      </Smoothstream>,
    );

    const flush = async (): Promise<void> => {
      await clock.drain(async () => {
        await act(async () => {
          await vi.runAllTimersAsync();
        });
      });
    };
    await flush();

    return {
      get element() {
        const element = view.container.querySelector<HTMLElement>(
          "[data-smoothstream]",
        );
        if (!element) throw new Error("React adapter did not render its root.");
        return element;
      },
      destroy() {
        view.unmount();
      },
      flush,
      async update(nextSource, updateOptions = {}) {
        currentSource = nextSource;
        receiving = updateOptions.receiving ?? receiving;
        view.rerender(
          <Smoothstream {...options} receiving={receiving}>
            {currentSource}
          </Smoothstream>,
        );
        await flush();
      },
    } satisfies AdapterContractDriver;
  },
});
