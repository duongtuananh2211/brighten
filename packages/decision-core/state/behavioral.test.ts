import { describe, expect, it } from "vitest";
import type { BehavioralState } from "../types/index.js";
import { applyMarketTick, applyRiskOutcome, applyAttributedOutcome } from "./behavioral.js";

function cleanState(overrides: Partial<BehavioralState> = {}): BehavioralState {
  return {
    winStreak: 0,
    dailyLoss: "0",
    tradeCountToday: 0,
    ...overrides,
  };
}

const MOCK_NOW = 1_700_000_300_000;

// ─── applyMarketTick ─────────────────────────────────────────────────────────

describe("applyMarketTick", () => {
  const boundary = "UTC 00:00";

  it("does not reset when still in the same trading day", () => {
    const dayStart = MOCK_NOW - 3_600_000;
    const state = cleanState({
      winStreak: 2,
      dailyLoss: "10",
      lastLossEpochMillis: MOCK_NOW - 7_200_000,
      tradeCountToday: 3,
      tradingDayStartEpochMillis: dayStart,
    });

    const result = applyMarketTick(state, {
      nowEpochMillis: MOCK_NOW,
      tradingDayBoundary: boundary,
      tradingDayStartEpochMillis: dayStart,
    });

    expect(result.state).toEqual(state);
    expect(result.tradingDayStartEpochMillis).toBe(dayStart);
  });

  it("resets daily counters when crossing into a new trading day", () => {
    const yesterdayStart = MOCK_NOW - 86_400_000;
    const state = cleanState({
      winStreak: 3,
      dailyLoss: "45.75",
      lastLossEpochMillis: MOCK_NOW - 3_600_000,
      tradeCountToday: 4,
      tradingDayStartEpochMillis: yesterdayStart,
    });

    const result = applyMarketTick(state, {
      nowEpochMillis: MOCK_NOW,
      tradingDayBoundary: boundary,
      tradingDayStartEpochMillis: yesterdayStart,
    });

    expect(result.state.tradeCountToday).toBe(0);
    expect(result.state.dailyLoss).toBe("0");
    expect(result.state.winStreak).toBe(3);
    expect(result.state.lastLossEpochMillis).toBe(state.lastLossEpochMillis);
    expect(result.tradingDayStartEpochMillis).toBeGreaterThan(yesterdayStart);
  });

  it("initialises tradingDayStartEpochMillis on first tick (undefined previous)", () => {
    const state = cleanState();
    const result = applyMarketTick(state, {
      nowEpochMillis: MOCK_NOW,
      tradingDayBoundary: boundary,
    });
    expect(result.state).toEqual(state);
    expect(result.tradingDayStartEpochMillis).toBeGreaterThan(0);
    expect(result.tradingDayStartEpochMillis).toBeLessThanOrEqual(MOCK_NOW);
  });

  it("is pure: does not mutate input state", () => {
    const state = cleanState({ winStreak: 2, dailyLoss: "10", tradeCountToday: 3, tradingDayStartEpochMillis: MOCK_NOW - 86_400_000 });
    const clone = structuredClone(state);
    applyMarketTick(state, { nowEpochMillis: MOCK_NOW, tradingDayBoundary: boundary, tradingDayStartEpochMillis: state.tradingDayStartEpochMillis });
    expect(state).toEqual(clone);
  });

  it("is deterministic: same inputs ⇒ same outputs", () => {
    const state = cleanState({ winStreak: 2, dailyLoss: "10", tradeCountToday: 3, tradingDayStartEpochMillis: MOCK_NOW - 86_400_000 });
    const ctx = { nowEpochMillis: MOCK_NOW, tradingDayBoundary: boundary, tradingDayStartEpochMillis: state.tradingDayStartEpochMillis };
    expect(applyMarketTick(state, ctx)).toEqual(applyMarketTick(state, ctx));
  });

  it("resets dailyLoss to string '0' (not number)", () => {
    const yesterdayStart = MOCK_NOW - 86_400_000;
    const state = cleanState({ dailyLoss: "99.5", tradingDayStartEpochMillis: yesterdayStart });
    const result = applyMarketTick(state, { nowEpochMillis: MOCK_NOW, tradingDayBoundary: boundary, tradingDayStartEpochMillis: yesterdayStart });
    expect(typeof result.state.dailyLoss).toBe("string");
    expect(result.state.dailyLoss).toBe("0");
  });
});

// ─── applyRiskOutcome ────────────────────────────────────────────────────────

describe("applyRiskOutcome", () => {
  it("accumulates dailyLoss on negative PnL (absolute value)", () => {
    const state = cleanState({ dailyLoss: "10", winStreak: 3, tradeCountToday: 2 });
    const next = applyRiskOutcome(state, { realizedPnl: "-30.5", atEpochMillis: MOCK_NOW });
    expect(next.dailyLoss).toBe("40.5");
    // Streak/count untouched — risk probe does not affect system edge metrics
    expect(next.winStreak).toBe(3);
    expect(next.tradeCountToday).toBe(2);
    expect(next.lastLossEpochMillis).toBe(MOCK_NOW);
  });

  it("no-ops on zero PnL", () => {
    const state = cleanState({ dailyLoss: "10", winStreak: 1, tradeCountToday: 1 });
    const next = applyRiskOutcome(state, { realizedPnl: "0", atEpochMillis: MOCK_NOW });
    expect(next).toEqual(state);
  });

  it("no-ops on positive PnL (profit does not reduce daily loss)", () => {
    const state = cleanState({ dailyLoss: "10", winStreak: 1, tradeCountToday: 1 });
    const next = applyRiskOutcome(state, { realizedPnl: "25", atEpochMillis: MOCK_NOW });
    expect(next).toEqual(state);
  });

  it("dailyLoss is always a string", () => {
    const state = cleanState({ dailyLoss: "0" });
    const next = applyRiskOutcome(state, { realizedPnl: "-5", atEpochMillis: MOCK_NOW });
    expect(typeof next.dailyLoss).toBe("string");
  });

  it("is pure: does not mutate input state", () => {
    const state = cleanState({ winStreak: 3, dailyLoss: "10", tradeCountToday: 2 });
    const clone = structuredClone(state);
    applyRiskOutcome(state, { realizedPnl: "-5", atEpochMillis: MOCK_NOW });
    expect(state).toEqual(clone);
  });

  it("is deterministic: same inputs ⇒ same outputs", () => {
    const state = cleanState({ dailyLoss: "5" });
    const input = { realizedPnl: "-2.5", atEpochMillis: MOCK_NOW };
    expect(applyRiskOutcome(state, input)).toEqual(applyRiskOutcome(state, input));
  });
});

// ─── applyAttributedOutcome ─────────────────────────────────────────────────

describe("applyAttributedOutcome", () => {
  it("win increments winStreak and tradeCountToday (dailyLoss unchanged)", () => {
    const state = cleanState({ winStreak: 2, dailyLoss: "10", tradeCountToday: 3 });
    const next = applyAttributedOutcome(state, { result: "win", atEpochMillis: MOCK_NOW });
    expect(next.winStreak).toBe(3);
    expect(next.tradeCountToday).toBe(4);
    expect(next.dailyLoss).toBe("10");
    expect(next.lastLossEpochMillis).toBeUndefined();
  });

  it("loss resets winStreak to 0, increments count, keeps dailyLoss unchanged", () => {
    const state = cleanState({ winStreak: 3, dailyLoss: "10.25", tradeCountToday: 2 });
    const next = applyAttributedOutcome(state, { result: "loss", atEpochMillis: MOCK_NOW });
    expect(next.winStreak).toBe(0);
    expect(next.dailyLoss).toBe("10.25"); // unchanged — risk is probe's domain
    expect(next.lastLossEpochMillis).toBe(MOCK_NOW);
    expect(next.tradeCountToday).toBe(3);
  });

  it("dailyLoss is always a string", () => {
    const state = cleanState({ dailyLoss: "0" });
    const winResult = applyAttributedOutcome(state, { result: "win", atEpochMillis: MOCK_NOW });
    expect(typeof winResult.dailyLoss).toBe("string");
    const lossResult = applyAttributedOutcome(state, { result: "loss", atEpochMillis: MOCK_NOW });
    expect(typeof lossResult.dailyLoss).toBe("string");
  });

  it("accumulates tradeCountToday across outcomes", () => {
    let state = cleanState();
    state = applyAttributedOutcome(state, { result: "win", atEpochMillis: MOCK_NOW });
    state = applyAttributedOutcome(state, { result: "loss", atEpochMillis: MOCK_NOW + 60_000 });
    state = applyAttributedOutcome(state, { result: "win", atEpochMillis: MOCK_NOW + 120_000 });
    expect(state.tradeCountToday).toBe(3);
    expect(state.winStreak).toBe(1); // loss reset to 0, then 1 win
    expect(state.dailyLoss).toBe("0"); // never touched by attributed
  });

  it("is pure: does not mutate input state", () => {
    const state = cleanState({ winStreak: 3, dailyLoss: "10", tradeCountToday: 2 });
    const clone = structuredClone(state);
    applyAttributedOutcome(state, { result: "loss", atEpochMillis: MOCK_NOW });
    expect(state).toEqual(clone);
  });

  it("is deterministic: same inputs ⇒ same outputs (2× toEqual)", () => {
    const state = cleanState({ winStreak: 1, dailyLoss: "5", tradeCountToday: 1 });
    const input = { result: "loss" as const, atEpochMillis: MOCK_NOW };
    expect(applyAttributedOutcome(state, input)).toEqual(applyAttributedOutcome(state, input));
  });
});
