import type { ClockPort } from "@brighten/decision-core";

// Deterministic clock for the accounting path: each tick feeds the core its own
// fixed timestamp (kline openTime), never Date.now() — preserves NFR-1 replay.
export function fixedClock(atEpochMillis: number): ClockPort {
  return {
    nowEpochMillis: () => atEpochMillis
  };
}
