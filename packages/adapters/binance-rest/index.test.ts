import { describe, expect, it, vi } from "vitest";

import type { FetchLike } from "./index.js";
import { createBinanceRestIngestion, mapTimeframeToInterval, mapTimeframeToPeriod } from "./index.js";

const request = {
  pair: "BTCUSDT",
  timeframe: "1m",
  fromEpochMillis: 1_700_000_000_000,
  toEpochMillis: 1_700_000_120_000
};

const kline = (openTime: number, closeTime: number) => [
  openTime,
  "100",
  "101",
  "99",
  "100.5",
  "12",
  closeTime,
  "1200",
  10,
  "7",
  "700",
  "0"
];

function response(payload: unknown, ok = true, status = 200): Awaited<ReturnType<FetchLike>> {
  return {
    ok,
    status,
    json: async () => payload
  };
}

describe("createBinanceRestIngestion", () => {
  it("maps timeframe for Binance kline interval and futures data period", () => {
    expect(mapTimeframeToInterval("1m")).toBe("1m");
    expect(mapTimeframeToPeriod("1m")).toBeUndefined();
    expect(mapTimeframeToPeriod("15m")).toBe("15m");
  });

  it("returns a complete normalized market snapshot on happy path", async () => {
    const fetchFn = vi.fn<FetchLike>(async (url) => {
      if (url.includes("/fapi/v1/klines")) {
        return response([kline(1_700_000_000_000, 1_700_000_059_999)]);
      }
      if (url.includes("/fapi/v1/fundingRate")) {
        return response([{ fundingTime: 1_700_000_000_000, fundingRate: "0.0001" }]);
      }
      if (url.includes("/futures/data/openInterestHist")) {
        return response([{ timestamp: 1_700_000_000_000, sumOpenInterest: "10", sumOpenInterestValue: "1000" }]);
      }
      if (url.includes("/futures/data/globalLongShortAccountRatio")) {
        return response([{ timestamp: 1_700_000_000_000, longShortRatio: "1.1", longAccount: "0.52", shortAccount: "0.48" }]);
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const adapter = createBinanceRestIngestion({ fetchFn });
    const result = await adapter.getMarketSnapshot({ ...request, timeframe: "15m" });

    expect(result).toEqual({
      ok: true,
      value: {
        pair: "BTCUSDT",
        timeframe: "15m",
        atEpochMillis: request.toEpochMillis,
        klines: [
          {
            openTime: 1_700_000_000_000,
            open: "100",
            high: "101",
            low: "99",
            close: "100.5",
            volume: "12",
            closeTime: 1_700_000_059_999,
            quoteVolume: "1200",
            numberOfTrades: 10,
            takerBuyBaseVolume: "7",
            takerBuyQuoteVolume: "700"
          }
        ],
        funding: [{ fundingTime: 1_700_000_000_000, fundingRate: "0.0001" }],
        openInterest: [{ timestamp: 1_700_000_000_000, sumOpenInterest: "10", sumOpenInterestValue: "1000" }],
        longShortRatio: [{ timestamp: 1_700_000_000_000, longShortRatio: "1.1", longAccount: "0.52", shortAccount: "0.48" }],
        warnings: []
      }
    });
  });

  it("paginates klines when a page reaches the Binance limit", async () => {
    const firstPage = Array.from({ length: 1500 }, (_, index) =>
      kline(request.fromEpochMillis + index * 60_000, request.fromEpochMillis + index * 60_000 + 59_999)
    );
    const secondPage = [kline(request.fromEpochMillis + 1500 * 60_000, request.fromEpochMillis + 1500 * 60_000 + 59_999)];
    let klinePage = 0;
    const fetchFn = vi.fn<FetchLike>(async (url) => {
      if (url.includes("/fapi/v1/klines")) {
        klinePage += 1;
        return response(klinePage === 1 ? firstPage : secondPage);
      }
      return response([]);
    });

    const result = await createBinanceRestIngestion({ fetchFn }).getMarketSnapshot({
      ...request,
      toEpochMillis: request.fromEpochMillis + 1501 * 60_000
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.klines).toHaveLength(1501);
      expect(result.value.klines[0]?.openTime).toBe(request.fromEpochMillis);
      expect(result.value.klines[1500]?.openTime).toBe(request.fromEpochMillis + 1500 * 60_000);
    }
  });

  it("soft-degrades optional feeds and logs warnings", async () => {
    const logger = vi.fn();
    const fetchFn = vi.fn<FetchLike>(async (url) => {
      if (url.includes("/fapi/v1/klines")) {
        return response([kline(1_700_000_000_000, 1_700_000_059_999)]);
      }
      if (url.includes("/futures/data/openInterestHist")) {
        return response({ msg: "nope" }, false, 500);
      }
      return response([]);
    });

    const result = await createBinanceRestIngestion({ fetchFn, logger }).getMarketSnapshot({
      ...request,
      timeframe: "15m"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.openInterest).toBeUndefined();
      expect(result.value.longShortRatio).toBeUndefined();
      expect(result.value.warnings).toEqual([
        expect.objectContaining({ source: "adapter.binance_rest", code: "empty_optional_feed" }),
        expect.objectContaining({ source: "adapter.binance_rest", code: "http_error" }),
        expect.objectContaining({ source: "adapter.binance_rest", code: "unavailable_out_of_retention" })
      ]);
      expect(logger).toHaveBeenCalledTimes(3);
    }
  });

  it("fails hard when required klines cannot be fetched", async () => {
    const fetchFn = vi.fn<FetchLike>(async () => response({ msg: "bad" }, false, 500));

    const result = await createBinanceRestIngestion({ fetchFn }).getMarketSnapshot(request);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "http_error",
        source: "adapter.binance_rest"
      }
    });
  });
});
