import { sizeTrade } from "@brighten/decision-core";
import type { SizingResult, TradeCandidate } from "@brighten/decision-core";
import { describe, expect, it } from "vitest";

import { simulate } from "./simulate.js";
import { makeConfigSnapshot, makeKline, makeSnapshot } from "./test-support.js";
import type { EmittedTrade } from "./types.js";

const longCandidate: TradeCandidate = {
  direction: "long",
  entry: "100",
  stop: "95",
  target: "115"
};

// sizeTrade(equity 10000, risk 1%, stop distance 5) ⇒ riskAmount 100, volume 20.
function longSizing(): SizingResult {
  const sizing = sizeTrade({ equity: "10000", candidate: longCandidate, riskPct: "1", minRr: "1.5" });
  if (!sizing.ok) {
    throw new Error("fixture sizing must succeed");
  }
  return sizing;
}

function emittedAtTickZero(): EmittedTrade {
  return { entryTickIndex: 0, entryEpochMillis: makeKline(0).openTime, sizing: longSizing() };
}

describe("simulate", () => {
  it("computes net R after real cost when the target is hit", () => {
    // notional = 20 × 100 = 2000 ; roundTrip = 0.0007 × 2000 × 2 = 2.8
    // grossR = 3 ; netR = 3 − 2.8/100 = 2.972
    const snapshot = makeSnapshot({
      klines: [makeKline(0), makeKline(1, { high: "116", low: "99", close: "115" })]
    });

    const [trade] = simulate([emittedAtTickZero()], snapshot, makeConfigSnapshot());

    expect(trade).toMatchObject({
      exitReason: "target",
      grossR: "3",
      realizedCost: "2.8",
      netR: "2.972",
      exitTickIndex: 1
    });
  });

  it("computes a losing net R when the stop is hit (both levels ⇒ stop wins)", () => {
    const snapshot = makeSnapshot({
      klines: [makeKline(0), makeKline(1, { high: "116", low: "94", close: "96" })]
    });

    const [trade] = simulate([emittedAtTickZero()], snapshot, makeConfigSnapshot());

    // grossR = -1 ; netR = -1 − 0.028 = -1.028 ; stop wins over target in the same candle.
    expect(trade).toMatchObject({ exitReason: "stop", grossR: "-1", netR: "-1.028" });
  });

  it("closes at the last candle's close when no level is touched", () => {
    const snapshot = makeSnapshot({
      klines: [makeKline(0), makeKline(1, { high: "110", low: "98", close: "108" })]
    });

    const [trade] = simulate([emittedAtTickZero()], snapshot, makeConfigSnapshot());

    // grossR = (108 − 100)/5 = 1.6 ; netR = 1.6 − 0.028 = 1.572
    expect(trade).toMatchObject({ exitReason: "close", grossR: "1.6", netR: "1.572" });
  });

  it("adds funding held within the window for perp crypto", () => {
    const snapshot = makeSnapshot({
      klines: [makeKline(0), makeKline(1, { high: "116", low: "99", close: "115" })],
      funding: [
        { fundingTime: 61_000, fundingRate: "0.0001" }, // inside [1000, exitClose]
        { fundingTime: 9_000_000, fundingRate: "0.5" } // far outside the window
      ]
    });

    const [trade] = simulate([emittedAtTickZero()], snapshot, makeConfigSnapshot());

    // funding = 0.0001 × 2000 = 0.2 ⇒ cost = 3.0 ⇒ netR = 3 − 0.03 = 2.97
    expect(trade).toMatchObject({ realizedCost: "3", netR: "2.97" });
  });

  it("emits only decimal-string amounts (no number leak)", () => {
    const snapshot = makeSnapshot({
      klines: [makeKline(0), makeKline(1, { high: "116", low: "99", close: "115" })]
    });

    const [trade] = simulate([emittedAtTickZero()], snapshot, makeConfigSnapshot());

    expect(trade).toBeDefined();
    if (trade !== undefined) {
      expect(typeof trade.netR).toBe("string");
      expect(typeof trade.grossR).toBe("string");
      expect(typeof trade.realizedCost).toBe("string");
    }
  });
});
