import { describe, expect, it } from "vitest";

import { defaultTiers, runBacktest } from "./run.js";
import {
  failingIngestion,
  fakeIngestion,
  makeFxPipelineSnapshot,
  makeRealPipelineConfig
} from "./test-support.js";
import type { BacktestStrategyInput } from "./types.js";

const request = {
  pair: "EURUSD",
  timeframe: "1m",
  fromEpochMillis: 1_000,
  toEpochMillis: 300_000
};

function strategyInput(): BacktestStrategyInput {
  return {
    state: { winStreak: 0, dailyLoss: "0", tradeCountToday: 0 },
    account: { equity: "10000" },
    signals: [{ tickIndex: 3 }]
  };
}

describe("runBacktest", () => {
  it("wires the real four-tier stack by asset class", () => {
    expect(defaultTiers("fx").map((tier) => tier.id)).toEqual(["tier0", "tier1", "tier2", "tier3"]);
  });

  it("produces a reproducible run embedding the config snapshot and data range", async () => {
    const config = makeRealPipelineConfig();
    const result = await runBacktest({
      ingestion: fakeIngestion(makeFxPipelineSnapshot()),
      request,
      strategyInput: strategyInput(),
      configSnapshot: config,
      assetClass: "fx"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.metrics).toMatchObject({
      tradeCount: 1,
      expectancy: "8.274888888888888888888888888888888888889"
    });
    expect(result.value.configSnapshot).toBe(config);
    expect(result.value.snapshotSchemaVersion).toBe(1);
    expect(result.value.dataRange).toEqual({
      pair: "EURUSD",
      timeframe: "1m",
      fromEpochMillis: 1_000,
      toEpochMillis: 300_000,
      klineCount: 5
    });
  });

  it("is 100% reproducible across runs (deep-equal)", async () => {
    const deps = {
      ingestion: fakeIngestion(makeFxPipelineSnapshot()),
      request,
      strategyInput: strategyInput(),
      configSnapshot: makeRealPipelineConfig(),
      assetClass: "fx" as const
    };

    const first = await runBacktest(deps);
    const second = await runBacktest(deps);

    expect(first).toEqual(second);
  });

  it("does not mutate the input market snapshot", async () => {
    const snapshot = makeFxPipelineSnapshot();
    const before = structuredClone(snapshot);

    await runBacktest({
      ingestion: fakeIngestion(snapshot),
      request,
      strategyInput: strategyInput(),
      configSnapshot: makeRealPipelineConfig(),
      assetClass: "fx"
    });

    expect(snapshot).toEqual(before);
  });

  it("surfaces ingestion failures", async () => {
    const result = await runBacktest({
      ingestion: failingIngestion(),
      request,
      strategyInput: strategyInput(),
      configSnapshot: makeRealPipelineConfig(),
      assetClass: "fx"
    });

    expect(result.ok).toBe(false);
  });

  it("emits decimal-string metrics (no number leak)", async () => {
    const result = await runBacktest({
      ingestion: fakeIngestion(makeFxPipelineSnapshot()),
      request,
      strategyInput: strategyInput(),
      configSnapshot: makeRealPipelineConfig(),
      assetClass: "fx"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.value.metrics.expectancy).toBe("string");
      expect(typeof result.value.metrics.winRateReference).toBe("string");
    }
  });

  it("changes results when a config version changes the real tier gating", async () => {
    const baseDeps = {
      ingestion: fakeIngestion(makeFxPipelineSnapshot()),
      request,
      strategyInput: strategyInput(),
      assetClass: "fx" as const
    };

    const passed = await runBacktest({
      ...baseDeps,
      configSnapshot: makeRealPipelineConfig()
    });
    const vetoed = await runBacktest({
      ...baseDeps,
      configSnapshot: makeRealPipelineConfig({ min_rr: "20" }, 1)
    });

    expect(passed.ok).toBe(true);
    expect(vetoed.ok).toBe(true);
    if (passed.ok && vetoed.ok) {
      expect(passed.value.metrics.tradeCount).toBe(1);
      expect(vetoed.value.metrics.tradeCount).toBe(0);
      expect(passed.value.configSnapshot.version).not.toBe(vetoed.value.configSnapshot.version);
    }
  });
});
