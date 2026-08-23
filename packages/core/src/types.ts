export interface Clock {
  now(): number;
}

export interface RevealUnit {
  /** Stable identity supplied by the semantic unit planner. */
  readonly id: string;
  /** Monotonic document order supplied by the semantic unit planner. */
  readonly order: number;
  /** Whether the next unit may finish before this unit. */
  readonly allowFollowingFinishOverlap?: boolean;
  /** Optional unit-specific duration override. */
  readonly duration?: number;
  /** Optional multiple of the configured duration. */
  readonly durationMultiplier?: number;
  /** Optional distance from this unit's start to the next unit's start. */
  readonly delayAfter?: number;
  /** Optional multiple of the configured interval before the next unit starts. */
  readonly intervalsAfter?: number;
  /** Optional minimum interval distance from the previous unit's start. */
  readonly intervalsBefore?: number;
}

export interface ScheduledUnit extends RevealUnit {
  readonly duration: number;
  readonly endAt: number;
  readonly startAt: number;
}

export interface SchedulerOptions {
  /** Duration of an individual unit's visual transition, in milliseconds. */
  duration: number;
  /** Distance between successive unit start times, in milliseconds. */
  interval: number;
  /** Minimum distance between successive finish times, in milliseconds. */
  minimumFinishGap?: number;
}

export interface SchedulerSnapshot {
  readonly lastEndAt: number | null;
  readonly lastOrder: number | null;
  readonly nextStartAt: number | null;
  readonly units: ReadonlyArray<ScheduledUnit>;
}
