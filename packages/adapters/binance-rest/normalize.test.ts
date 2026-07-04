import { describe, expect, it } from "vitest";

import {
  normalizeFunding,
  normalizeKlines,
  normalizeLongShort,
  normalizeOpenInterest
} from "./normalize.js";

const rawKline = [
  1_700_000_000_000,
  "100.1",
  "101.2",
  "99.9",
  "100.5",
  "12.34",
  1_700_000_059_999,
  "1234.56",
  42,
  "7.89",
  "789.01",
  "0"
] as const;

describe("binance-rest normalizers", () => {
  it("normalizes klines by Binance array index without numeric conversion", () => {
    expect(normalizeKlines([rawKline])).toEqual({
      ok: true,
      value: [
        {
          openTime: 1_700_000_000_000,
          open: "100.1",
          high: "101.2",
          low: "99.9",
          close: "100.5",
          volume: "12.34",
          closeTime: 1_700_000_059_999,
          quoteVolume: "1234.56",
          numberOfTrades: 42,
          takerBuyBaseVolume: "7.89",
          takerBuyQuoteVolume: "789.01"
        }
      ]
    });
  });

  it("normalizes funding, open interest, and long-short ratio payloads", () => {
    expect(normalizeFunding([{ fundingTime: 1, fundingRate: "0.0001", markPrice: "100" }])).toEqual({
      ok: true,
      value: [{ fundingTime: 1, fundingRate: "0.0001" }]
    });
    expect(
      normalizeOpenInterest([{ timestamp: 2, sumOpenInterest: "10.5", sumOpenInterestValue: "1050" }])
    ).toEqual({
      ok: true,
      value: [{ timestamp: 2, sumOpenInterest: "10.5", sumOpenInterestValue: "1050" }]
    });
    expect(
      normalizeLongShort([{ timestamp: 3, longShortRatio: "1.2", longAccount: "0.55", shortAccount: "0.45" }])
    ).toEqual({
      ok: true,
      value: [{ timestamp: 3, longShortRatio: "1.2", longAccount: "0.55", shortAccount: "0.45" }]
    });
  });

  it("rejects invalid payload shape", () => {
    expect(normalizeKlines([{ bad: true }])).toMatchObject({
      ok: false,
      error: {
        code: "invalid_payload",
        source: "adapter.binance_rest"
      }
    });
  });

  it("is deterministic and does not mutate raw payload", () => {
    const payload = [structuredClone(rawKline)];
    const before = structuredClone(payload);

    const first = normalizeKlines(payload);
    const second = normalizeKlines(payload);

    expect(first).toEqual(second);
    expect(payload).toEqual(before);
  });

  it("keeps all decimal fields as strings", () => {
    const result = normalizeKlines([rawKline]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const [kline] = result.value;
      if (kline === undefined) {
        throw new Error("Expected one normalized kline");
      }

      for (const field of [
        "open",
        "high",
        "low",
        "close",
        "volume",
        "quoteVolume",
        "takerBuyBaseVolume",
        "takerBuyQuoteVolume"
      ] as const) {
        expect(typeof kline[field]).toBe("string");
      }
    }
  });
});
