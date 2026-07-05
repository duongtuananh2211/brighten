import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "@brighten/config";
import type { Suggestion } from "@brighten/decision-core";

import { createPostgresPersistence } from "./index.js";
import type { SqlClient } from "./index.js";

function client(rowsByQuery: readonly unknown[][], calls: { text: string; values?: readonly unknown[] }[] = []): SqlClient {
  let index = 0;
  return {
    async query<T>(text: string, values?: readonly unknown[]) {
      calls.push(values === undefined ? { text } : { text, values });
      const rows = rowsByQuery[index] ?? [];
      index += 1;
      return { rows: rows as readonly T[] };
    }
  };
}

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
    configVersion: 1,
    snapshotSchemaVersion: 1
  };
}

describe("createPostgresPersistence", () => {
  it("reads the latest config row into a validated immutable snapshot", async () => {
    const persistence = createPostgresPersistence({
      sql: client([[{ version: 3, params: JSON.stringify(DEFAULT_PARAMS), created_at: "2026-07-04T00:00:00.000Z" }]])
    });

    const result = await persistence.readConfigSnapshot();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.version).toBe(3);
      expect(result.value.params).toEqual(DEFAULT_PARAMS);
      expect(Object.isFrozen(result.value.params)).toBe(true);
    }
  });

  it("reads a specific config version with a parameterized query", async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const persistence = createPostgresPersistence({
      sql: client([[{ version: 2, params: DEFAULT_PARAMS }]], calls)
    });

    const result = await persistence.readConfigSnapshot(2);

    expect(result.ok).toBe(true);
    expect(calls[0]?.values).toEqual([2]);
  });

  it("returns ok:false for invalid config rows", async () => {
    const persistence = createPostgresPersistence({
      sql: client([[{ version: 1, params: { ...DEFAULT_PARAMS, min_rr: "-1" } }]])
    });

    const result = await persistence.readConfigSnapshot();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.source).toBe("adapter.postgres");
    }
  });

  it("reads behavioral state from the seed row", async () => {
    const persistence = createPostgresPersistence({
      sql: client([[
        {
          win_streak: 2,
          daily_loss: "10",
          last_loss_epoch_millis: "1700000000000",
          trade_count_today: 1,
          trading_day_start_epoch_millis: "1700000000000"
        }
      ]])
    });

    const result = await persistence.readBehavioralState();

    expect(result).toEqual({
      ok: true,
      value: {
        winStreak: 2,
        dailyLoss: "10",
        lastLossEpochMillis: 1_700_000_000_000,
        tradeCountToday: 1,
        tradingDayStartEpochMillis: 1_700_000_000_000
      }
    });
  });

  it("maps null trading_day_start_epoch_millis to undefined", async () => {
    const persistence = createPostgresPersistence({
      sql: client([[
        {
          win_streak: 2,
          daily_loss: "10",
          last_loss_epoch_millis: "1700000000000",
          trade_count_today: 1,
          trading_day_start_epoch_millis: null
        }
      ]])
    });

    const result = await persistence.readBehavioralState();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tradingDayStartEpochMillis).toBeUndefined();
    }
  });

  it("writes behavioral state with correct UPDATE parameters", async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const persistence = createPostgresPersistence({ sql: client([[]], calls) });

    const result = await persistence.writeBehavioralState({
      winStreak: 3,
      dailyLoss: "25.5",
      lastLossEpochMillis: 1_700_000_000_000,
      tradeCountToday: 2,
      tradingDayStartEpochMillis: 1_700_000_000_000
    });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(calls[0]?.text).toContain("update behavioral_state");
    expect(calls[0]?.values).toEqual([
      3,                        // win_streak
      "25.5",                   // daily_loss
      1_700_000_000_000,        // last_loss_epoch_millis
      2,                        // trade_count_today
      1_700_000_000_000,        // trading_day_start_epoch_millis
    ]);
  });

  it("writeBehavioralState maps undefined fields to null", async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const persistence = createPostgresPersistence({ sql: client([[]], calls) });

    const result = await persistence.writeBehavioralState({
      winStreak: 0,
      dailyLoss: "0",
      tradeCountToday: 0
    });

    expect(result.ok).toBe(true);
    expect(calls[0]?.values).toEqual([0, "0", null, 0, null]);
  });

  it("soft-degrades writeBehavioralState database exceptions into Result errors", async () => {
    const persistence = createPostgresPersistence({
      sql: {
        async query() {
          throw new Error("db unavailable");
        }
      }
    });

    const result = await persistence.writeBehavioralState({
      winStreak: 0,
      dailyLoss: "0",
      tradeCountToday: 0
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: "db_error",
        source: "adapter.postgres",
        context: { operation: "writeBehavioralState", detail: "db unavailable" }
      });
    }
  });

  it("inserts suggestions as payload jsonb", async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const persistence = createPostgresPersistence({ sql: client([[]], calls) });
    const payload = suggestion();

    const result = await persistence.saveSuggestion(payload);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(calls[0]?.text).toContain("insert into suggestions");
    expect(calls[0]?.values).toEqual([payload]);
  });

  it("appendAuditEvent inserts into audit_events with correct parameters", async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const persistence = createPostgresPersistence({ sql: client([[]], calls) });

    const event = {
      type: "suggestion-emitted" as const,
      atEpochMillis: 1_700_000_000_000,
      payload: { pair: "EURUSD", direction: "short" }
    };

    const result = await persistence.appendAuditEvent(event);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(calls[0]?.text).toContain("insert into audit_events");
    expect(calls[0]?.values).toEqual([
      "suggestion-emitted",
      1_700_000_000_000,
      { pair: "EURUSD", direction: "short" }
    ]);
  });

  it("appendAuditEvent soft-degrades on DB error without throwing", async () => {
    const persistence = createPostgresPersistence({
      sql: {
        async query() {
          throw new Error("db unavailable");
        }
      }
    });

    const result = await persistence.appendAuditEvent({
      type: "suggestion-blocked",
      atEpochMillis: 1_700_000_000_000,
      payload: { vetoedBy: "tier0" }
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: "db_error",
        source: "adapter.postgres",
        context: { operation: "appendAuditEvent", detail: "db unavailable" }
      });
    }
  });

  it("soft-degrades database exceptions into Result errors", async () => {
    const persistence = createPostgresPersistence({
      sql: {
        async query() {
          throw new Error("db unavailable");
        }
      }
    });

    const result = await persistence.readBehavioralState();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: "db_error",
        source: "adapter.postgres",
        context: { operation: "readBehavioralState", detail: "db unavailable" }
      });
    }
  });

  // ── Feedback methods (3.4) ──────────────────────────────────────────────

  it("hasProcessedFill returns true when fill exists", async () => {
    const persistence = createPostgresPersistence({
      sql: client([[{ exists: true }]])
    });

    const result = await persistence.hasProcessedFill("f1");

    expect(result).toEqual({ ok: true, value: true });
  });

  it("hasProcessedFill returns false when fill does not exist", async () => {
    const persistence = createPostgresPersistence({
      sql: client([[{ exists: false }]])
    });

    const result = await persistence.hasProcessedFill("f99");

    expect(result).toEqual({ ok: true, value: false });
  });

  it("recordProcessedFill inserts into account_fills on conflict do nothing", async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const persistence = createPostgresPersistence({ sql: client([[]], calls) });

    const result = await persistence.recordProcessedFill({
      fillId: "f1", symbol: "BTCUSDT", realizedPnl: "-30.5", closedEpochMillis: 1_700_000_000_000,
    });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(calls[0]?.text).toContain("insert into account_fills");
    expect(calls[0]?.text).toContain("on conflict");
  });

  it("recordAttribution inserts into trade_attributions on conflict do nothing", async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const persistence = createPostgresPersistence({ sql: client([[]], calls) });

    const result = await persistence.recordAttribution({
      fillId: "f1", suggestionId: "s1", result: "win",
    });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(calls[0]?.text).toContain("insert into trade_attributions");
    expect(calls[0]?.text).toContain("on conflict");
    expect(calls[0]?.values).toEqual(["f1", "s1", "win"]);
  });
});
