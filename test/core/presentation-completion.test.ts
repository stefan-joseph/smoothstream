// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { StreamingSession } from "../../packages/core/src";
import {
  presentationComplete,
  revealComplete,
} from "../../packages/shared/presentation-completion";

describe("presentation completion", () => {
  it("recognizes the final entrance before its animation has finished", () => {
    let now = 0;
    const session = new StreamingSession({ now: () => now }, {
      duration: 400,
      interval: 5,
    });
    const input = session.prepareInput("Hello", false);
    session.commitInput(input);
    session.schedule(input);
    const lastStart = Math.max(
      ...[...session.advance().schedules.values()].map((unit) => unit.startAt),
    );
    now = lastStart;
    const presentation = session.present(input, session.advance());
    const element = document.createElement("div");
    const lastUnit = input.plan.units.at(-1);
    expect(lastUnit).toBeDefined();
    if (!lastUnit) return;
    const last = document.createElement("span");
    last.setAttribute("data-smoothstream-unit", lastUnit.id);
    last.textContent = "o";
    element.append(last);

    expect(revealComplete(input, presentation, element)).toBe(true);
    expect(presentationComplete(input, presentation, element)).toBe(false);
  });

  it("waits for a final image to enter but not an earlier image", () => {
    let now = 0;
    const session = new StreamingSession({ now: () => now }, {
      duration: 400,
      interval: 5,
    });
    const input = session.prepareInput("![Preview](https://example.com/a.png)", false);
    session.commitInput(input);
    session.schedule(input);
    const image = input.plan.units.find((unit) => unit.kind === "image");
    expect(image).toBeDefined();
    if (!image) return;
    const schedule = session.advance().schedules.get(image.id);
    expect(schedule).toBeDefined();
    if (!schedule) return;

    now = schedule.startAt;
    const waiting = session.present(input, session.advance());
    const element = document.createElement("div");
    const marker = document.createElement("img");
    marker.setAttribute("data-smoothstream-unit", image.id);
    marker.setAttribute("data-smoothstream-state", "pending");
    element.append(marker);
    expect(revealComplete(input, waiting, element)).toBe(false);

    marker.setAttribute("data-smoothstream-state", "active");
    expect(revealComplete(input, waiting, element)).toBe(true);

    const laterText = session.prepareInput(
      "![Preview](https://example.com/a.png)\n\nFinal text.",
      false,
    );
    session.commitInput(laterText);
    session.schedule(laterText);
    const finalUnit = laterText.plan.units.at(-1);
    expect(finalUnit?.kind).toBe("text");
    if (!finalUnit) return;
    const finalSchedule = session.advance().schedules.get(finalUnit.id);
    expect(finalSchedule).toBeDefined();
    if (!finalSchedule) return;
    now = finalSchedule.startAt;
    const final = document.createElement("span");
    final.setAttribute("data-smoothstream-unit", finalUnit.id);
    element.append(final);
    marker.setAttribute("data-smoothstream-state", "pending");
    expect(revealComplete(
      laterText,
      session.present(laterText, session.advance()),
      element,
    )).toBe(true);
  });
});
