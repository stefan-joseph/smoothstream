import { parseMarkdown } from "./markdown/parse";
import type {
  MarkdownPlan,
  MarkdownReveal,
  MarkdownRevealUnit,
} from "./markdown/types";
import { createMarkdownPlan } from "./markdown/unitize";
import {
  collectCodeBlockRequests,
  type CodeBlockRequest,
} from "./code-highlighting";
import {
  collectImageDescriptors,
  type ImageDescriptor,
} from "./images";
import { RevealScheduler } from "./scheduler";
import type { Clock, ScheduledUnit, SchedulerOptions } from "./types";

export interface StreamingInputSnapshot {
  readonly codeBlocks: ReadonlyArray<CodeBlockRequest>;
  readonly images: ReadonlyArray<ImageDescriptor>;
  readonly inputOpen: boolean;
  readonly plan: MarkdownPlan;
  readonly reveal: MarkdownReveal;
  readonly source: string;
  readonly unitSignature: string;
}

export interface StreamingPlaybackSnapshot {
  readonly animationComplete: boolean;
  readonly immediate: boolean;
  readonly now: number;
  readonly schedules: ReadonlyMap<string, ScheduledUnit>;
  readonly visibleUnitCount: number;
}

export interface StreamingPresentationOptions {
  readonly now?: number;
}

export interface StreamingPresentationSnapshot
  extends StreamingPlaybackSnapshot {
  readonly allPlannedUnitsCompacted: boolean;
  readonly compactedBlockIds: ReadonlySet<string>;
  readonly compactedUnitIds: ReadonlySet<string>;
}

interface SemanticBlockTiming {
  readonly lastEndAt: number;
  readonly scheduledCount: number;
}

interface InputMetadata {
  readonly blockIdByUnitId: ReadonlyMap<string, string>;
  readonly scheduleTimings: WeakMap<
    ReadonlyMap<string, ScheduledUnit>,
    ReadonlyMap<string, SemanticBlockTiming>
  >;
  readonly unitIds: ReadonlySet<string>;
  readonly unitsByBlock: ReadonlyMap<
    string,
    ReadonlyArray<MarkdownRevealUnit>
  >;
}

const inputMetadata = new WeakMap<StreamingInputSnapshot, InputMetadata>();

const metadataFor = (input: StreamingInputSnapshot): InputMetadata => {
  const metadata = inputMetadata.get(input);
  if (!metadata) {
    throw new TypeError(
      "Streaming input snapshots must be created by StreamingSession.",
    );
  }
  return metadata;
};

const assertTime = (value: number): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      "presentation time must be a finite, non-negative number.",
    );
  }
};

const mapSchedules = (
  units: ReadonlyArray<ScheduledUnit>,
): ReadonlyMap<string, ScheduledUnit> =>
  new Map(units.map((unit) => [unit.id, unit]));

const visibleUnitCount = (
  units: ReadonlyArray<ScheduledUnit>,
  now: number,
): number => {
  let low = 0;
  let high = units.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const unit = units[middle];
    if (unit && unit.startAt <= now) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};

const semanticBlockTimings = (
  metadata: InputMetadata,
  schedules: ReadonlyMap<string, ScheduledUnit>,
): ReadonlyMap<string, SemanticBlockTiming> => {
  const cached = metadata.scheduleTimings.get(schedules);
  if (cached) {
    return cached;
  }

  const mutable = new Map<
    string,
    { lastEndAt: number; scheduledCount: number }
  >();
  for (const [unitId, schedule] of schedules) {
    const blockId = metadata.blockIdByUnitId.get(unitId);
    if (!blockId) {
      continue;
    }
    const timing = mutable.get(blockId);
    if (timing) {
      timing.lastEndAt = Math.max(timing.lastEndAt, schedule.endAt);
      timing.scheduledCount += 1;
    } else {
      mutable.set(blockId, {
        lastEndAt: schedule.endAt,
        scheduledCount: 1,
      });
    }
  }

  metadata.scheduleTimings.set(schedules, mutable);
  return mutable;
};

const compactedBlocksAt = (
  input: StreamingInputSnapshot,
  schedules: ReadonlyMap<string, ScheduledUnit>,
  now: number,
  compactAll: boolean,
): ReadonlySet<string> => {
  const metadata = metadataFor(input);
  if (compactAll) {
    return new Set(metadata.unitsByBlock.keys());
  }

  const timings = semanticBlockTimings(metadata, schedules);
  const result = new Set<string>();
  for (const blockId of input.plan.confirmedBlockIds) {
    const units = metadata.unitsByBlock.get(blockId);
    const timing = timings.get(blockId);
    if (
      units &&
      units.length > 0 &&
      timing?.scheduledCount === units.length &&
      now >= timing.lastEndAt
    ) {
      result.add(blockId);
    }
  }
  return result;
};

const buildInputSnapshot = (
  source: string,
  inputOpen: boolean,
  reveal: MarkdownReveal,
): StreamingInputSnapshot => {
  const plan = createMarkdownPlan(parseMarkdown(source), source, {
    inputOpen,
    reveal,
  });
  const blockIdByUnitId = new Map<string, string>();
  const unitsByBlock = new Map<string, MarkdownRevealUnit[]>();
  for (const unit of plan.units) {
    blockIdByUnitId.set(unit.id, unit.blockId);
    const units = unitsByBlock.get(unit.blockId);
    if (units) {
      units.push(unit);
    } else {
      unitsByBlock.set(unit.blockId, [unit]);
    }
  }

  const input = Object.freeze({
    codeBlocks: collectCodeBlockRequests(plan.tree, plan.units),
    images: collectImageDescriptors(plan.tree),
    inputOpen,
    plan,
    reveal,
    source,
    unitSignature: plan.units.map((unit) => unit.id).join("|"),
  });
  inputMetadata.set(input, {
    blockIdByUnitId,
    scheduleTimings: new WeakMap(),
    unitIds: new Set(plan.units.map((unit) => unit.id)),
    unitsByBlock,
  });
  return input;
};

/**
 * Framework-neutral state machine for one append-only Markdown response.
 *
 * Adapters prepare snapshots during rendering, commit accepted input after
 * their own render commits, and drive playback using an injected clock.
 */
export class StreamingSession {
  readonly #clock: Clock;
  readonly #scheduler: RevealScheduler;
  #committedSource = "";
  #lastEndAt: number | null = null;
  #scheduledUnits: ReadonlyArray<ScheduledUnit> = [];
  #schedules: ReadonlyMap<string, ScheduledUnit> = new Map();

  constructor(clock: Clock, options: SchedulerOptions) {
    this.#clock = clock;
    this.#scheduler = new RevealScheduler(clock, options);
  }

  prepareInput(
    source: string,
    inputOpen: boolean,
    reveal: MarkdownReveal = "character",
  ): StreamingInputSnapshot {
    this.#assertAppendOnly(source);
    return buildInputSnapshot(source, inputOpen, reveal);
  }

  commitInput(input: StreamingInputSnapshot): void {
    metadataFor(input);
    this.#assertAppendOnly(input.source);
    this.#committedSource = input.source;
  }

  schedule(
    input: StreamingInputSnapshot,
    units: ReadonlyArray<MarkdownRevealUnit> = input.plan.units,
  ): StreamingPlaybackSnapshot {
    this.#assertUnitsBelongToInput(input, units);
    this.#scheduler.enqueue(units);
    const snapshot = this.#scheduler.snapshot();
    this.#lastEndAt = snapshot.lastEndAt;
    this.#scheduledUnits = snapshot.units;
    this.#schedules = mapSchedules(snapshot.units);
    return this.#playbackAt(this.#clock.now(), false);
  }

  advance(now: number = this.#clock.now()): StreamingPlaybackSnapshot {
    return this.#playbackAt(now, false);
  }

  immediate(
    input: StreamingInputSnapshot,
    units: ReadonlyArray<MarkdownRevealUnit> = input.plan.units,
  ): StreamingPlaybackSnapshot {
    this.#assertUnitsBelongToInput(input, units);
    const now = this.#clock.now();
    assertTime(now);
    const schedules = new Map<string, ScheduledUnit>();
    for (const unit of units) {
      schedules.set(unit.id, Object.freeze({
        ...unit,
        duration: 0,
        endAt: now,
        startAt: now,
      }));
    }
    return Object.freeze({
      animationComplete: true,
      immediate: true,
      now,
      schedules,
      visibleUnitCount: units.length,
    });
  }

  present(
    input: StreamingInputSnapshot,
    playback: StreamingPlaybackSnapshot,
    options: StreamingPresentationOptions = {},
  ): StreamingPresentationSnapshot {
    const now = options.now ?? playback.now;
    assertTime(now);
    const metadata = metadataFor(input);
    const compactedBlockIds = compactedBlocksAt(
      input,
      playback.schedules,
      now,
      playback.immediate,
    );
    const compactedUnitIds = new Set<string>();
    for (const unit of input.plan.units) {
      if (compactedBlockIds.has(unit.blockId)) {
        compactedUnitIds.add(unit.id);
      }
    }
    const allPlannedUnitsCompacted = input.plan.units.length > 0 &&
      [...metadata.unitsByBlock.keys()].every((blockId) =>
        compactedBlockIds.has(blockId)
      );
    return Object.freeze({
      ...playback,
      allPlannedUnitsCompacted,
      compactedBlockIds,
      compactedUnitIds,
      now,
    });
  }

  #assertAppendOnly(source: string): void {
    if (!source.startsWith(this.#committedSource)) {
      throw new Error(
        "Streaming source must be append-only. Create a new session to render a different response.",
      );
    }
  }

  #assertUnitsBelongToInput(
    input: StreamingInputSnapshot,
    units: ReadonlyArray<MarkdownRevealUnit>,
  ): void {
    const unitIds = metadataFor(input).unitIds;
    const foreign = units.find((unit) => !unitIds.has(unit.id));
    if (foreign) {
      throw new Error(
        `Reveal unit "${foreign.id}" does not belong to the supplied input snapshot.`,
      );
    }
  }

  #playbackAt(now: number, immediate: boolean): StreamingPlaybackSnapshot {
    assertTime(now);
    return Object.freeze({
      animationComplete:
        this.#scheduledUnits.length === 0 || now >= (this.#lastEndAt ?? now),
      immediate,
      now,
      schedules: this.#schedules,
      visibleUnitCount: visibleUnitCount(this.#scheduledUnits, now),
    });
  }
}
