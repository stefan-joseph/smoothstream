// @vitest-environment jsdom

import {
  createApp,
  defineComponent,
  h,
  nextTick,
  reactive,
} from "vue";
import { Smoothstream } from "@smoothstream/vue";
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
  name: "Vue",
  async mount(source, options: AdapterContractOptions = {}) {
    const clock = installContractClock();
    const state = reactive({
      receiving: options.receiving ?? false,
      source,
    });
    const container = document.createElement("div");
    document.body.append(container);
    const {
      className,
      ...componentOptions
    } = options;
    const app = createApp(defineComponent({
      name: "SmoothstreamContractHost",
      setup: () => () => h(Smoothstream, {
        ...componentOptions,
        class: className,
        markdown: state.source,
        receiving: state.receiving,
      }),
    }));
    app.mount(container);

    const flush = async (): Promise<void> => {
      await clock.drain(async () => {
        await vi.runAllTimersAsync();
        await nextTick();
      });
      await nextTick();
    };
    await flush();

    return {
      get element() {
        const element = container.querySelector<HTMLElement>(
          "[data-smoothstream]",
        );
        if (!element) throw new Error("Vue adapter did not render its root.");
        return element;
      },
      destroy() {
        app.unmount();
        container.remove();
      },
      flush,
      async update(nextSource, updateOptions = {}) {
        state.source = nextSource;
        state.receiving = updateOptions.receiving ?? state.receiving;
        await nextTick();
        await flush();
      },
    } satisfies AdapterContractDriver;
  },
});
