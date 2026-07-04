import { describe, expect, it } from "vitest";
import type { TradeCandidate } from "@brighten/decision-core";

import {
  fakeIngestion,
  makeConfigSnapshot,
  makeKline,
  makeSnapshot
} from "./test-support.js";
import { runValidation } from "./validate.js";
import type { BacktestStrategyInput } from "./types.js";

const longCandidate: TradeCandidate = {
  direction: "long",
  entry: "100",
  stop: "95",
  target: "115"
};

const request = {
  pair: "BTCUSDT",
  timeframe: "1m",
  fromEpochMillis: 1_000,
  toEpochMillis: 720_000
};

function validationSnapshot() {
  return makeSnapshot({
    klines: Array.from({ length: 12 }, (_, index) =>
      makeKline(index, [2, 5, 8, 10].includes(index) ? { high: "116", low: "99", close: "115" } : {})
    )
  });
}

function strategyInput(): BacktestStrategyInput {
  return {
    state: { winStreak: 0, dailyLoss: "0", tradeCountToday: 0 },
    account: { equity: "10000" },
    signals: [1, 4, 7, 9].map((tickIndex) => ({ tickIndex, candidate: longCandidate }))
  };
}

describe("runValidation", () => {
  it("is reproducible, does not mutate inputs, and embeds validation evidence", async () => {
    const snapshot = validationSnapshot();
    const beforeSnapshot = structuredClone(snapshot);
    const configSnapshot = makeConfigSnapshot();
    const input = strategyInput();
    const beforeInput = structuredClone(input);
    const deps = {
      ingestion: fakeIngestion(snapshot),
      request,
      strategyInput: input,
      configSnapshot,
      spec: { folds: 3, inSampleRatio: "0.5", holdoutRatio: "0.25" },
      bootstrap: { resamples: 10, seed: 7 },
      tunedParamNames: ["risk_pct"],
      paperTradeCompleted: true,
      mode: "paper-trade" as const
    };

    const first = await runValidation(deps);
    const second = await runValidation(deps);

    expect(first).toEqual(second);
    expect(snapshot).toEqual(beforeSnapshot);
    expect(input).toEqual(beforeInput);
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }

    expect(first.value.configSnapshot).toBe(configSnapshot);
    expect(first.value.walkForward).toHaveLength(3);
    expect(first.value.holdout.range).toEqual({ fromIndex: 9, toIndex: 12 });
    expect(first.value.holdout.metrics.tradeCount).toBe(1);
    expect(first.value.expectancyCI).toMatchObject({ resamples: 10, seed: 7 });
    expect(first.value.paramCap).toEqual({ ok: true, count: 1, cap: 5 });
    expect(first.value.liveEligibility).toEqual({ eligible: true, reasons: [] });
    expect(typeof first.value.holdout.metrics.expectancy).toBe("string");
    expect(typeof first.value.expectancyCI.lower).toBe("string");
  });
});
