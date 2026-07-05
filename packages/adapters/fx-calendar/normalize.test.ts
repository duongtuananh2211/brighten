import { describe, expect, it } from "vitest";

import { buildWindow, isHighImpact, normalizeCalendar } from "./normalize.js";

const timestamp = 1_700_000_000_000;

describe("fx-calendar normalize", () => {
  it("normalizes calendar items and classifies high impact severities", () => {
    const result = normalizeCalendar([
      { timestamp, currency: "USD", impact: "High", title: "USD CPI" },
      { timestamp: timestamp + 1, currency: "EUR", impact: "medium", title: "EUR PMI" },
      { timestamp: timestamp + 2, currency: "JPY", impact: "3", title: "JPY Rate Decision" }
    ]);

    expect(result.warnings).toEqual([]);
    expect(result.events.filter((event) => isHighImpact(event.impact))).toEqual([
      { timestamp, currency: "USD", impact: "High", title: "USD CPI" },
      { timestamp: timestamp + 2, currency: "JPY", impact: "3", title: "JPY Rate Decision" }
    ]);
    expect(isHighImpact("low")).toBe(false);
  });

  it("soft-rejects invalid payloads and invalid items with warnings", () => {
    expect(normalizeCalendar({ nope: true })).toEqual({
      events: [],
      warnings: [
        {
          code: "invalid_payload",
          source: "adapter.fx_calendar",
          context: {
            message: "Expected FX calendar payload to be an array"
          }
        }
      ]
    });

    expect(normalizeCalendar([{ timestamp, currency: "USD", impact: "high", title: "NFP" }, { currency: "USD" }])).toEqual({
      events: [{ timestamp, currency: "USD", impact: "high", title: "NFP" }],
      warnings: [
        {
          code: "invalid_calendar_item",
          source: "adapter.fx_calendar",
          context: {
            index: 1,
            message: "FX calendar item contains invalid field types"
          }
        }
      ]
    });
  });

  it("builds deterministic scoped blackout windows from high-impact events", () => {
    const event = { timestamp, currency: "USD", impact: "high", title: "USD CPI" };
    const pairs = ["EURUSD", "USDJPY", "EURGBP"];
    const beforeMs = 1_800_000;
    const afterMs = 1_800_000;

    const first = buildWindow(event, pairs, beforeMs, afterMs);
    const second = buildWindow(event, pairs, beforeMs, afterMs);

    expect(first).toEqual(second);
    expect(first).toEqual({
      startsAt: 1_699_998_200_000,
      endsAt: 1_700_001_800_000,
      reason: "USD CPI",
      pairs: ["EURUSD", "USDJPY"]
    });
    expect(typeof first?.startsAt).toBe("number");
    expect(buildWindow({ ...event, currency: "CHF" }, pairs, beforeMs, afterMs)).toBeUndefined();
  });
});
