import type {
  Clock,
  RevealUnit,
  ScheduledUnit,
  SchedulerOptions,
  SchedulerSnapshot,
} from "./types";

const assertFiniteNonNegative = (name: string, value: number): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite, non-negative number.`);
  }
};

const assertOrder = (id: string, order: number): void => {
  if (!Number.isSafeInteger(order) || order < 0) {
    throw new RangeError(
      `order for reveal unit "${id}" must be a non-negative safe integer.`,
    );
  }
};

const resolveDelayAfter = (
  unit: RevealUnit,
  interval: number,
): number => {
  if (unit.delayAfter !== undefined && unit.intervalsAfter !== undefined) {
    throw new TypeError(
      `reveal unit "${unit.id}" cannot define both delayAfter and intervalsAfter.`,
    );
  }
  return unit.delayAfter ?? (unit.intervalsAfter ?? 1) * interval;
};

const resolveDuration = (
  unit: RevealUnit,
  duration: number,
): number => {
  if (unit.duration !== undefined && unit.durationMultiplier !== undefined) {
    throw new TypeError(
      `reveal unit "${unit.id}" cannot define both duration and durationMultiplier.`,
    );
  }
  return unit.duration ?? (unit.durationMultiplier ?? 1) * duration;
};

const validateOptions = (options: SchedulerOptions): Required<SchedulerOptions> => {
  assertFiniteNonNegative("duration", options.duration);
  assertFiniteNonNegative("interval", options.interval);
  assertFiniteNonNegative(
    "minimumFinishGap",
    options.minimumFinishGap ?? 0,
  );

  return {
    duration: options.duration,
    interval: options.interval,
    minimumFinishGap: options.minimumFinishGap ?? 0,
  };
};

/**
 * Assigns immutable times to ordered reveal units.
 *
 * The scheduler is deliberately unaware of Markdown, React, and browser APIs.
 * Re-enqueuing a known unit is idempotent, which lets a renderer submit units
 * again after parsing a newer source revision without replaying them.
 */
export class RevealScheduler {
  readonly #clock: Clock;
  readonly #options: Required<SchedulerOptions>;
  readonly #scheduledById = new Map<string, ScheduledUnit>();
  readonly #units: ScheduledUnit[] = [];
  #lastEndAt: number | null = null;
  #lastOrder: number | null = null;
  #lastStartAt: number | null = null;
  #nextStartAt: number | null = null;
  #previousAllowsFinishOverlap = false;
  #previousEndAt: number | null = null;

  constructor(clock: Clock, options: SchedulerOptions) {
    this.#clock = clock;
    this.#options = Object.freeze(validateOptions(options));
  }

  enqueue(units: ReadonlyArray<RevealUnit>): ReadonlyArray<ScheduledUnit> {
    let prospectiveLastOrder = this.#lastOrder;
    const newIds = new Map<string, number>();

    // Validate the complete batch before assigning any times. A malformed
    // revision must not leave a partially advanced scheduler behind.
    for (const unit of units) {
      if (unit.id.length === 0) {
        throw new TypeError("Reveal unit id must not be empty.");
      }
      assertOrder(unit.id, unit.order);

      const existing = this.#scheduledById.get(unit.id);
      if (existing) {
        if (existing.order !== unit.order) {
          throw new Error(
            `Reveal unit "${unit.id}" changed order from ${existing.order} to ${unit.order}.`,
          );
        }
        continue;
      }

      const duplicateOrder = newIds.get(unit.id);
      if (duplicateOrder !== undefined) {
        if (duplicateOrder !== unit.order) {
          throw new Error(
            `Reveal unit "${unit.id}" has conflicting orders ${duplicateOrder} and ${unit.order}.`,
          );
        }
        continue;
      }

      if (prospectiveLastOrder !== null && unit.order <= prospectiveLastOrder) {
        throw new Error(
          `New reveal unit "${unit.id}" has order ${unit.order}, which is not after ${prospectiveLastOrder}.`,
        );
      }

      assertFiniteNonNegative(
        `duration for reveal unit "${unit.id}"`,
        resolveDuration(unit, this.#options.duration),
      );
      assertFiniteNonNegative(
        `delayAfter for reveal unit "${unit.id}"`,
        resolveDelayAfter(unit, this.#options.interval),
      );
      assertFiniteNonNegative(
        `intervalsBefore for reveal unit "${unit.id}"`,
        unit.intervalsBefore ?? 0,
      );
      newIds.set(unit.id, unit.order);
      prospectiveLastOrder = unit.order;
    }

    const now = this.#clock.now();
    assertFiniteNonNegative("clock.now()", now);

    const result: ScheduledUnit[] = [];

    for (const unit of units) {
      const existing = this.#scheduledById.get(unit.id);
      if (existing) {
        if (existing.order !== unit.order) {
          throw new Error(
            `Reveal unit "${unit.id}" changed order from ${existing.order} to ${unit.order}.`,
          );
        }
        result.push(existing);
        continue;
      }

      const duration = resolveDuration(unit, this.#options.duration);

      const intervalsBeforeStart =
        this.#lastStartAt === null
          ? now
          : this.#lastStartAt +
            (unit.intervalsBefore ?? 0) * this.#options.interval;
      const candidateStart = Math.max(
        now,
        this.#nextStartAt ?? now,
        intervalsBeforeStart,
      );
      const finishOrderedStart =
        this.#previousEndAt === null || this.#previousAllowsFinishOverlap
          ? candidateStart
          : this.#previousEndAt + this.#options.minimumFinishGap - duration;
      const startAt = Math.max(candidateStart, finishOrderedStart);
      const endAt = startAt + duration;

      const scheduled: ScheduledUnit = Object.freeze({
        ...unit,
        duration,
        endAt,
        startAt,
      });

      this.#scheduledById.set(unit.id, scheduled);
      this.#units.push(scheduled);
      this.#lastEndAt = Math.max(this.#lastEndAt ?? endAt, endAt);
      this.#lastOrder = unit.order;
      this.#lastStartAt = startAt;
      this.#previousAllowsFinishOverlap =
        unit.allowFollowingFinishOverlap ?? false;
      this.#previousEndAt = endAt;
      this.#nextStartAt =
        startAt + resolveDelayAfter(unit, this.#options.interval);
      result.push(scheduled);
    }

    return Object.freeze(result);
  }

  get(id: string): ScheduledUnit | undefined {
    return this.#scheduledById.get(id);
  }

  snapshot(): SchedulerSnapshot {
    return Object.freeze({
      lastEndAt: this.#lastEndAt,
      lastOrder: this.#lastOrder,
      nextStartAt: this.#nextStartAt,
      units: Object.freeze([...this.#units]),
    });
  }
}
