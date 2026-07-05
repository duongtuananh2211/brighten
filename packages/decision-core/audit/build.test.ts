import { describe, expect, it } from "vitest";
import type { Suggestion } from "../types/index.js";
import { buildSuggestionEmittedEvent, buildSuggestionBlockedEvent, buildTradeOutcomeEvent } from "./build.js";

function suggestion(): Suggestion {
  return {
    kind: "trade",
    pair: "EURUSD",
    timeframe: "1m",
    atEpochMillis: 1_700_000_000_000,
    direction: "short",
    candidate: { direction: "short", entry: "1.109", stop: "1.1099", target: "1.1" },
    sizing: {
      ok: true,
      direction: "short",
      entry: "1.109",
      stop: "1.1099",
      target: "1.1",
      stopDistance: "0.0009",
      riskAmount: "100",
      volume: "111111.1111111111111111111111111111111111",
      rr: "10"
    },
    configVersion: 3,
    snapshotSchemaVersion: 1
  };
}

describe("buildSuggestionEmittedEvent", () => {
  it("produces type suggestion-emitted with full suggestion payload", () => {
    const s = suggestion();
    const event = buildSuggestionEmittedEvent({ suggestion: s, atEpochMillis: s.atEpochMillis });

    expect(event.type).toBe("suggestion-emitted");
    expect(event.atEpochMillis).toBe(s.atEpochMillis);
    expect(event.payload).toEqual({
      pair: "EURUSD",
      timeframe: "1m",
      direction: "short",
      candidate: s.candidate,
      sizing: s.sizing,
      configVersion: 3,
      snapshotSchemaVersion: 1,
    });
  });

  it("is deterministic: same inputs ⇒ same outputs (2× toEqual)", () => {
    const s = suggestion();
    const a = buildSuggestionEmittedEvent({ suggestion: s, atEpochMillis: 1_700_000_000_000 });
    const b = buildSuggestionEmittedEvent({ suggestion: s, atEpochMillis: 1_700_000_000_000 });
    expect(a).toEqual(b);
  });

  it("does not mutate its input", () => {
    const s = suggestion();
    const clone = structuredClone(s);
    buildSuggestionEmittedEvent({ suggestion: s, atEpochMillis: 1_700_000_000_000 });
    expect(s).toEqual(clone);
  });
});

describe("buildSuggestionBlockedEvent", () => {
  it("produces type suggestion-blocked with veto context payload", () => {
    const event = buildSuggestionBlockedEvent({
      pair: "EURUSD",
      timeframe: "1m",
      atEpochMillis: 1_700_000_000_000,
      vetoedBy: "tier0",
      reason: "max_trades_reached: 5/5 trades today",
      configVersion: 3,
      snapshotSchemaVersion: 1,
    });

    expect(event.type).toBe("suggestion-blocked");
    expect(event.atEpochMillis).toBe(1_700_000_000_000);
    expect(event.payload).toEqual({
      pair: "EURUSD",
      timeframe: "1m",
      vetoedBy: "tier0",
      reason: "max_trades_reached: 5/5 trades today",
      configVersion: 3,
      snapshotSchemaVersion: 1,
    });
  });

  it("handles tier3 veto with cost hurdle reason", () => {
    const event = buildSuggestionBlockedEvent({
      pair: "BTCUSDT",
      timeframe: "5m",
      atEpochMillis: 1_700_000_000_000,
      vetoedBy: "tier3",
      reason: "cost_hurdle: cost 2.40 > edge 1.80, would lose on average",
      configVersion: 5,
      snapshotSchemaVersion: 1,
    });

    expect(event.type).toBe("suggestion-blocked");
    expect(event.payload.vetoedBy).toBe("tier3");
    expect(typeof event.payload.reason).toBe("string");
    expect(event.payload.configVersion).toBe(5);
  });

  it("is deterministic: same inputs ⇒ same outputs", () => {
    const input = {
      pair: "EURUSD",
      timeframe: "1m",
      atEpochMillis: 1_700_000_000_000,
      vetoedBy: "tier0" as const,
      reason: "cooldown_active",
      configVersion: 1,
      snapshotSchemaVersion: 1,
    };
    const a = buildSuggestionBlockedEvent(input);
    const b = buildSuggestionBlockedEvent(input);
    expect(a).toEqual(b);
  });

  it("does not mutate its input", () => {
    const input = {
      pair: "EURUSD",
      timeframe: "1m",
      atEpochMillis: 1_700_000_000_000,
      vetoedBy: "tier0" as const,
      reason: "cooldown_active",
      configVersion: 1,
      snapshotSchemaVersion: 1,
    };
    const clone = structuredClone(input);
    buildSuggestionBlockedEvent(input);
    expect(input).toEqual(clone);
  });
});

// ─── buildTradeOutcomeEvent ────────────────────────────────────────────────

describe("buildTradeOutcomeEvent", () => {
  it("produces type trade-outcome with risk (probe) payload", () => {
    const event = buildTradeOutcomeEvent({
      fillId: "f1",
      realizedPnl: "-30.5",
      atEpochMillis: 1_700_000_000_000,
    });

    expect(event.type).toBe("trade-outcome");
    expect(event.atEpochMillis).toBe(1_700_000_000_000);
    expect(event.payload).toEqual({ fillId: "f1", realizedPnl: "-30.5" });
  });

  it("produces type trade-outcome with attributed (user confirm) payload", () => {
    const event = buildTradeOutcomeEvent({
      fillId: "f2",
      result: "win",
      suggestionId: "s1",
      atEpochMillis: 1_700_000_100_000,
    });

    expect(event.type).toBe("trade-outcome");
    expect(event.payload).toEqual({
      fillId: "f2",
      result: "win",
      suggestionId: "s1",
    });
  });

  it("omits undefined optional fields from payload", () => {
    const event = buildTradeOutcomeEvent({
      fillId: "f3",
      atEpochMillis: 1_700_000_200_000,
    });

    expect(event.payload).toEqual({ fillId: "f3" });
    expect("realizedPnl" in event.payload).toBe(false);
    expect("result" in event.payload).toBe(false);
    expect("suggestionId" in event.payload).toBe(false);
  });

  it("is deterministic", () => {
    const input = { fillId: "f1", realizedPnl: "-5", result: "loss" as const, suggestionId: "s1", atEpochMillis: 1_700_000_000_000 };
    expect(buildTradeOutcomeEvent(input)).toEqual(buildTradeOutcomeEvent(input));
  });
});
