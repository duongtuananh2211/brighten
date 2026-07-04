import { describe, expect, it } from "vitest";
import type { TradeCandidate } from "@brighten/decision-core";

import { runBacktest } from "./run.js";
import {
  failingIngestion,
  fakeIngestion,
  makeConfigSnapshot,
  makeKline,
  makeSnapshot
} from "./test-support.js";
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
  toEpochMillis: 200_000
};

function winningSnapshot() {
  return makeSnapshot({
    klines: [makeKline(0), makeKline(1, { high: "116", low: "99", close: "115" })]
  });
}

function strategyInput(): BacktestStrategyInput {
  return {
    state: { winStreak: 0, dailyLoss: "0", tradeCountToday: 0 },
    account: { equity: "10000" },
    signals: [{ tickIndex: 0, candidate: longCandidate }]
  };
}

describe("runBacktest", () => {
  it("produces a reproducible run embedding the config snapshot and data range", async () => {
    const config = makeConfigSnapshot();
    const result = await runBacktest({
      ingestion: fakeIngestion(winningSnapshot()),
      request,
      strategyInput: strategyInput(),
      configSnapshot: config
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.metrics).toMatchObject({ tradeCount: 1, expectancy: "2.972" });
    expect(result.value.configSnapshot).toBe(config);
    expect(result.value.snapshotSchemaVersion).toBe(1);
    expect(result.value.dataRange).toEqual({
      pair: "BTCUSDT",
      timeframe: "1m",
      fromEpochMillis: 1_000,
      toEpochMillis: 200_000,
      klineCount: 2
    });
  });

  it("is 100% reproducible across runs (deep-equal)", async () => {
    const deps = {
      ingestion: fakeIngestion(winningSnapshot()),
      request,
      strategyInput: strategyInput(),
      configSnapshot: makeConfigSnapshot()
    };

    const first = await runBacktest(deps);
    const second = await runBacktest(deps);

    expect(first).toEqual(second);
  });

  it("does not mutate the input market snapshot", async () => {
    const snapshot = winningSnapshot();
    const before = structuredClone(snapshot);

    await runBacktest({
      ingestion: fakeIngestion(snapshot),
      request,
      strategyInput: strategyInput(),
      configSnapshot: makeConfigSnapshot()
    });

    expect(snapshot).toEqual(before);
  });

  it("surfaces ingestion failures", async () => {
    const result = await runBacktest({
      ingestion: failingIngestion(),
      request,
      strategyInput: strategyInput(),
      configSnapshot: makeConfigSnapshot()
    });

    expect(result.ok).toBe(false);
  });

  it("emits decimal-string metrics (no number leak)", async () => {
    const result = await runBacktest({
      ingestion: fakeIngestion(winningSnapshot()),
      request,
      strategyInput: strategyInput(),
      configSnapshot: makeConfigSnapshot()
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.value.metrics.expectancy).toBe("string");
      expect(typeof result.value.metrics.winRateReference).toBe("string");
    }
  });
});
