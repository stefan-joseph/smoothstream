import type {
  StreamingInputSnapshot,
  StreamingPresentationSnapshot,
} from "@smoothstream/core";

/** Every unit has entered the presentation, though its entrance may still run. */
export const revealComplete = (
  input: StreamingInputSnapshot,
  presentation: StreamingPresentationSnapshot,
  element: Element,
): boolean => {
  if (input.inputOpen) return false;
  if (presentation.immediate) return true;

  const lastUnit = input.plan.units.at(-1);
  if (!lastUnit) return true;
  const schedule = presentation.schedules.get(lastUnit.id);
  if (!schedule || presentation.now < schedule.startAt) return false;

  const rendered = [...element.querySelectorAll("[data-smoothstream-unit]")]
    .find((node) => node.getAttribute("data-smoothstream-unit") === lastUnit.id);
  return rendered
    ? rendered.getAttribute("data-smoothstream-state") !== "pending"
    : presentation.compactedUnitIds.has(lastUnit.id);
};

/** Entrance work has ended and the committed DOM contains no reveal nodes. */
export const presentationComplete = (
  input: StreamingInputSnapshot,
  presentation: StreamingPresentationSnapshot,
  element: Element,
): boolean =>
  !input.inputOpen &&
  (input.plan.units.length === 0 || presentation.allPlannedUnitsCompacted) &&
  element.querySelector("[data-smoothstream-unit]") === null;
