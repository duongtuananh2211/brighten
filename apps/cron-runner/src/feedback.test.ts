import { describe, expect, it } from "vitest";
import type { AccountPort, BehavioralState, ClosedTrade, PersistencePort } from "@brighten/decision-core";
import { runFeedback, confirmFill } from "./feedback.js";

const MOCK_NOW = 1_700_000_300_000;

function clock() {
  return { nowEpochMillis: () => MOCK_NOW };
}

function cleanState(): BehavioralState {
  return { winStreak: 0, dailyLoss: "0", tradeCountToday: 0 };
}

function accountPort(trades: readonly ClosedTrade[] = [], balanceError = false): AccountPort {
  return {
    readBalance: async () => {
      if (balanceError) return { ok: false, error: { code: "network_error", source: "adapter.binance_account", context: {} } };
      return { ok: true, value: { equity: "10000" } };
    },
    readClosedTrades: async () => ({ ok: true, value: trades }),
  };
}

interface FakePersistenceExtras {
  state?: BehavioralState;
  processedFills?: Set<string>;
  attributions?: { fillId: string; suggestionId: string; result: "win" | "loss" }[];
  auditEvents?: { type: string; payload: Record<string, unknown> }[];
  writeError?: boolean;
}

function fakePersistence(extras: FakePersistenceExtras = {}): PersistencePort {
  const processed = extras.processedFills ?? new Set<string>();
  const auditEvents = extras.auditEvents ?? [];
  let state = extras.state ?? cleanState();
  return {
    readConfigSnapshot: async () => ({ ok: true, value: { version: 1, params: { trading_day_boundary: "UTC 00:00" } as never, previousVersion: 0, createdAtEpochMillis: 0 } }),
    readBehavioralState: async () => ({ ok: true, value: state }),
    appendAuditEvent: async (event) => { auditEvents.push(event as { type: string; payload: Record<string, unknown> }); return { ok: true, value: undefined }; },
    writeBehavioralState: async (s) => { if (!extras.writeError) state = s; return extras.writeError ? { ok: false, error: { code: "db_error", source: "adapter.postgres", context: {} } } : { ok: true, value: undefined }; },
    saveSuggestion: async () => ({ ok: true, value: undefined }),
    hasProcessedFill: async (fillId) => ({ ok: true, value: processed.has(fillId) }),
    recordProcessedFill: async (trade) => { processed.add(trade.fillId); return { ok: true, value: undefined }; },
    recordAttribution: async () => ({ ok: true, value: undefined }),
    readDriftBaseline: async () => ({ ok: true, value: null }),
    setDriftBaseline: async () => ({ ok: true, value: undefined }),
    readLiveRSeries: async () => ({ ok: true, value: [] }),
    writeDriftMetric: async () => ({ ok: true, value: undefined }),
    recordOverrideGrant: async () => ({ ok: true, value: undefined }),
    readActiveOverrideGrants: async () => ({ ok: true, value: [] }),
  };
}

describe("runFeedback", () => {
  it("processes a new losing fill: applies risk outcome, audits, records", async () => {
    const auditEvents: { type: string; payload: Record<string, unknown> }[] = [];
    const p = fakePersistence({ auditEvents });
    const trades: ClosedTrade[] = [{ fillId: "f1", symbol: "BTCUSDT", realizedPnl: "-30.5", closedEpochMillis: MOCK_NOW - 60_000 }];

    const result = await runFeedback({
      account: accountPort(trades),
      persistence: p,
      clock: clock(),
      sinceLookbackMs: 600_000,
    });

    expect(result.status).toBe("processed");
    if (result.status === "processed") expect(result.fillCount).toBe(1);

    // Check state updated
    const stateResult = await p.readBehavioralState();
    if (stateResult.ok) {
      expect(stateResult.value.dailyLoss).toBe("30.5");
    }

    // Check audit event emitted
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]?.type).toBe("trade-outcome");
    expect(auditEvents[0]?.payload).toMatchObject({ fillId: "f1", realizedPnl: "-30.5" });
  });

  it("skips already-processed fills (idempotent)", async () => {
    const processed = new Set<string>(["f1"]);
    const auditEvents: { type: string; payload: Record<string, unknown> }[] = [];
    const p = fakePersistence({ processedFills: processed, auditEvents });
    const trades: ClosedTrade[] = [{ fillId: "f1", symbol: "BTCUSDT", realizedPnl: "-30.5", closedEpochMillis: MOCK_NOW - 60_000 }];

    const result = await runFeedback({
      account: accountPort(trades),
      persistence: p,
      clock: clock(),
      sinceLookbackMs: 600_000,
    });

    expect(result.status).toBe("processed");
    if (result.status === "processed") expect(result.fillCount).toBe(0);
    expect(auditEvents).toHaveLength(0);
  });

  it("skips when readClosedTrades fails", async () => {
    const p = fakePersistence();
    const badAccount: AccountPort = {
      readBalance: async () => ({ ok: true, value: { equity: "10000" } }),
      readClosedTrades: async () => ({ ok: false, error: { code: "network_error", source: "adapter.binance_account", context: {} } }),
    };

    const result = await runFeedback({
      account: badAccount,
      persistence: p,
      clock: clock(),
      sinceLookbackMs: 600_000,
    });

    expect(result).toEqual({ status: "skipped", reason: "trades_read_failed" });
  });

  it("returns processed with fillCount 0 when no new trades", async () => {
    const result = await runFeedback({
      account: accountPort([]),
      persistence: fakePersistence(),
      clock: clock(),
      sinceLookbackMs: 600_000,
    });

    expect(result).toEqual({ status: "processed", fillCount: 0 });
  });
});

describe("confirmFill", () => {
  it("records attribution and applies win outcome to state", async () => {
    const auditEvents: { type: string; payload: Record<string, unknown> }[] = [];
    const p = fakePersistence({ state: { winStreak: 2, dailyLoss: "0", tradeCountToday: 3 }, auditEvents });

    const result = await confirmFill(
      { persistence: p, clock: clock() },
      { fillId: "f1", suggestionId: "s1", result: "win" },
    );

    expect(result.ok).toBe(true);

    const stateResult = await p.readBehavioralState();
    if (stateResult.ok) {
      expect(stateResult.value.winStreak).toBe(3);
      expect(stateResult.value.tradeCountToday).toBe(4);
      expect(stateResult.value.dailyLoss).toBe("0"); // dailyLoss untouched by attributed
    }

    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]?.type).toBe("trade-outcome");
    expect(auditEvents[0]?.payload).toMatchObject({ fillId: "f1", result: "win", suggestionId: "s1" });
  });

  it("applies loss outcome: resets winStreak, increments count, keeps dailyLoss", async () => {
    const p = fakePersistence({ state: { winStreak: 3, dailyLoss: "10", tradeCountToday: 2 } });

    const result = await confirmFill(
      { persistence: p, clock: clock() },
      { fillId: "f2", suggestionId: "s2", result: "loss" },
    );

    expect(result.ok).toBe(true);

    const stateResult = await p.readBehavioralState();
    if (stateResult.ok) {
      expect(stateResult.value.winStreak).toBe(0);
      expect(stateResult.value.tradeCountToday).toBe(3);
      expect(stateResult.value.dailyLoss).toBe("10"); // loss from probe only
    }
  });
});
