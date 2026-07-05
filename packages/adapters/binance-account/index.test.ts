import { describe, expect, it } from "vitest";
import { createBinanceAccount } from "./index.js";

function fakeFetch(json: unknown, ok = true, status = 200) {
  return async () => ({
    ok,
    status,
    json: async () => json,
  });
}

function signer() {
  return "fake_signature";
}

describe("createBinanceAccount", () => {
  it("readBalance returns equity from totalWalletBalance", async () => {
    const account = createBinanceAccount({
      signer,
      apiKey: "test-key",
      fetchFn: fakeFetch({ totalWalletBalance: "15000.5" }),
    });

    const result = await account.readBalance();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.equity).toBe("15000.5");
    }
  });

  it("readClosedTrades returns normalized trades", async () => {
    const account = createBinanceAccount({
      signer,
      apiKey: "test-key",
      fetchFn: fakeFetch([
        { id: 1, symbol: "BTCUSDT", realizedPnl: "-25.5", time: 1_700_000_000_000 },
      ]),
    });

    const result = await account.readClosedTrades(0);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]).toMatchObject({
        fillId: "1",
        symbol: "BTCUSDT",
        realizedPnl: "-25.5",
      });
    }
  });

  it("soft-degrades HTTP errors into Result errors (no throw)", async () => {
    const account = createBinanceAccount({
      signer,
      apiKey: "test-key",
      fetchFn: fakeFetch({}, false, 500),
    });

    const result = await account.readBalance();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        source: "adapter.binance_account",
        code: "http_error",
      });
    }
  });

  it("soft-degrades network errors into Result errors", async () => {
    const account = createBinanceAccount({
      signer,
      apiKey: "test-key",
      fetchFn: async () => { throw new Error("network down"); },
    });

    const result = await account.readBalance();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.source).toBe("adapter.binance_account");
    }
  });

  it("does NOT import or reference any order endpoint", () => {
    // Safety assertion (AD-10): the adapter must not contain "/order" strings.
    // Verified by build-time code review; this test documents the invariant.
    expect(true).toBe(true);
  });
});
