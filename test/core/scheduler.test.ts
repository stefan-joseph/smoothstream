import { describe, expect, it } from "vitest";
import { RevealScheduler } from "../../packages/core/src/scheduler";
import type { Clock, RevealUnit } from "../../packages/core/src/types";

class ManualClock implements Clock {
  constructor(public time = 0) {}

  now(): number {
    return this.time;
  }
}

const units = (...ids: string[]): RevealUnit[] =>
  ids.map((id, order) => ({ id, order }));

describe("RevealScheduler", () => {
  it("creates overlapping schedules with monotonic starts and finishes", () => {
    const scheduler = new RevealScheduler(new ManualClock(), {
      duration: 180,
      interval: 25,
    });

    expect(scheduler.enqueue(units("one", "two", "three"))).toMatchObject([
      { id: "one", startAt: 0, endAt: 180 },
      { id: "two", startAt: 25, endAt: 205 },
      { id: "three", startAt: 50, endAt: 230 },
    ]);
  });

  it("continues an existing timeline when a later batch arrives", () => {
    const clock = new ManualClock();
    const scheduler = new RevealScheduler(clock, {
      duration: 180,
      interval: 25,
    });

    scheduler.enqueue(units("one", "two"));
    clock.time = 10;
    const [three] = scheduler.enqueue([{ id: "three", order: 2 }]);

    expect(three).toMatchObject({ startAt: 50, endAt: 230 });
  });

  it("lets semantic units choose the pause before the next unit", () => {
    const scheduler = new RevealScheduler(new ManualClock(), {
      duration: 180,
      interval: 25,
    });

    const [heading, firstWord] = scheduler.enqueue([
      { delayAfter: 140, id: "heading", order: 0 },
      { id: "first-word", order: 1 },
    ]);

    expect(heading?.startAt).toBe(0);
    expect(firstWord?.startAt).toBe(140);
  });

  it("scales semantic pauses from the configured interval", () => {
    const scheduler = new RevealScheduler(new ManualClock(), {
      duration: 180,
      interval: 25,
    });

    const [row, firstCharacter] = scheduler.enqueue([
      { id: "row", intervalsAfter: 2, order: 0 },
      { id: "first-character", order: 1 },
    ]);

    expect(row?.startAt).toBe(0);
    expect(firstCharacter?.startAt).toBe(50);
  });

  it("lets an incoming unit require a minimum interval-relative gap", () => {
    const scheduler = new RevealScheduler(new ManualClock(), {
      duration: 180,
      interval: 25,
    });

    const [first, second] = scheduler.enqueue([
      { id: "first", intervalsAfter: 2, order: 0 },
      { id: "second", intervalsBefore: 4, order: 1 },
    ]);

    expect(first?.startAt).toBe(0);
    expect(second?.startAt).toBe(100);
  });

  it("does not add an incoming semantic pause after the timeline is idle", () => {
    const clock = new ManualClock();
    const scheduler = new RevealScheduler(clock, {
      duration: 180,
      interval: 25,
    });

    scheduler.enqueue([{ id: "first", order: 0 }]);
    clock.time = 500;
    const [second] = scheduler.enqueue([
      { id: "second", intervalsBefore: 4, order: 1 },
    ]);

    expect(second?.startAt).toBe(500);
  });

  it("rejects ambiguous absolute and interval-relative pauses", () => {
    const scheduler = new RevealScheduler(new ManualClock(), {
      duration: 180,
      interval: 25,
    });

    expect(() =>
      scheduler.enqueue([
        { delayAfter: 40, id: "ambiguous", intervalsAfter: 2, order: 0 },
      ]),
    ).toThrow(/cannot define both/);
  });

  it("resumes from the current time after the scheduled timeline is idle", () => {
    const clock = new ManualClock();
    const scheduler = new RevealScheduler(clock, {
      duration: 180,
      interval: 25,
    });

    scheduler.enqueue(units("one"));
    clock.time = 500;
    const [two] = scheduler.enqueue([{ id: "two", order: 1 }]);

    expect(two).toMatchObject({ startAt: 500, endAt: 680 });
  });

  it("keeps finish order when units have different durations", () => {
    const scheduler = new RevealScheduler(new ManualClock(), {
      duration: 180,
      interval: 25,
      minimumFinishGap: 1,
    });

    const [first, second] = scheduler.enqueue([
      { id: "first", order: 0, duration: 300 },
      { id: "second", order: 1, duration: 50 },
    ]);

    expect(first?.endAt).toBe(300);
    expect(second?.startAt).toBe(251);
    expect(second?.endAt).toBe(301);
  });

  it("allows an explicit long unit to overlap followers and tracks its end", () => {
    const scheduler = new RevealScheduler(new ManualClock(), {
      duration: 100,
      interval: 10,
    });

    const [rule, following, next] = scheduler.enqueue([
      {
        allowFollowingFinishOverlap: true,
        durationMultiplier: 3,
        id: "rule",
        intervalsAfter: 2,
        order: 0,
      },
      { id: "following", order: 1 },
      { id: "next", order: 2 },
    ]);

    expect(rule).toMatchObject({ duration: 300, endAt: 300, startAt: 0 });
    expect(following).toMatchObject({ endAt: 120, startAt: 20 });
    expect(next).toMatchObject({ endAt: 130, startAt: 30 });
    expect(scheduler.snapshot().lastEndAt).toBe(300);
  });

  it("rejects ambiguous absolute and relative durations", () => {
    const scheduler = new RevealScheduler(new ManualClock(), {
      duration: 100,
      interval: 10,
    });

    expect(() => scheduler.enqueue([{
      duration: 200,
      durationMultiplier: 3,
      id: "ambiguous-duration",
      order: 0,
    }])).toThrow(/cannot define both duration and durationMultiplier/);
  });

  it("is idempotent when a parsed revision submits known units again", () => {
    const scheduler = new RevealScheduler(new ManualClock(), {
      duration: 180,
      interval: 25,
    });
    const [first] = scheduler.enqueue(units("one"));
    const [again] = scheduler.enqueue(units("one"));

    expect(again).toBe(first);
    expect(scheduler.snapshot().units).toHaveLength(1);
  });

  it("does not mutate earlier schedules when later units are added", () => {
    const scheduler = new RevealScheduler(new ManualClock(), {
      duration: 180,
      interval: 25,
    });
    const [first] = scheduler.enqueue(units("one"));
    const original = { ...first };

    scheduler.enqueue([{ id: "two", order: 1 }]);

    expect(first).toEqual(original);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(scheduler.snapshot().units)).toBe(true);
  });

  it("rejects newly discovered units that would move behind the timeline", () => {
    const scheduler = new RevealScheduler(new ManualClock(), {
      duration: 180,
      interval: 25,
    });
    scheduler.enqueue([{ id: "later", order: 2 }]);

    expect(() => scheduler.enqueue([{ id: "earlier", order: 1 }])).toThrow(
      /not after/,
    );
  });

  it("rejects an invalid batch without partially advancing the timeline", () => {
    const scheduler = new RevealScheduler(new ManualClock(), {
      duration: 180,
      interval: 25,
    });

    expect(() =>
      scheduler.enqueue([
        { id: "valid", order: 0 },
        { id: "invalid", order: 0 },
      ]),
    ).toThrow(/not after/);
    expect(scheduler.snapshot().units).toHaveLength(0);
  });
});
