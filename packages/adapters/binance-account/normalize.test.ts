import { describe, expect, it } from "vitest";
import { normalizeBalance, normalizeClosedTrades } from "./normalize.js";

describe("normalizeClosedTrades", () => {
  it("maps valid trades to ClosedTrade shape with decimal-string PnL", () => {
    const raw = [
      { id: 123, symbol: "BTCUSDT", realizedPnl: "-30.5", time: 1_700_000_000_000 },
      { id: 456, symbol: "ETHUSDT", realizedPnl: "12.75", time: 1_700_000_100_000 },
    ];

    const result = normalizeClosedTrades(raw);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      fillId: "123",
      symbol: "BTCUSDT",
      realizedPnl: "-30.5",
      closedEpochMillis: 1_700_000_000_000,
    });
    expect(result[1]).toEqual({
      fillId: "456",
      symbol: "ETHUSDT",
      realizedPnl: "12.75",
      closedEpochMillis: 1_700_000_100_000,
    });
  });

  it("returns empty array for non-array input", () => {
    expect(normalizeClosedTrades(null)).toEqual([]);
    expect(normalizeClosedTrades({})).toEqual([]);
    expect(normalizeClosedTrades("string")).toEqual([]);
  });

  it("filters out invalid trades (missing fields)", () => {
    const raw = [
      { id: 123, symbol: "BTCUSDT", realizedPnl: "-30.5", time: 1_700_000_000_000 },
      { id: "not_a_number", symbol: "ETHUSDT", realizedPnl: "12", time: 100 },
      { id: 789, symbol: null, realizedPnl: "12", time: 100 },
      {},
    ];

    expect(normalizeClosedTrades(raw)).toHaveLength(1);
  });
});

describe("normalizeBalance", () => {
  it("extracts equity from totalWalletBalance", () => {
    const raw = { totalWalletBalance: "12345.6789" };
    expect(normalizeBalance(raw)).toEqual({ equity: "12345.6789" });
  });

  it("returns zero equity for unrecognised shape", () => {
    expect(normalizeBalance(null)).toEqual({ equity: "0" });
    expect(normalizeBalance({})).toEqual({ equity: "0" });
    expect(normalizeBalance([])).toEqual({ equity: "0" });
  });
});
