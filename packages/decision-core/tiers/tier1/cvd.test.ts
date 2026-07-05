import { describe, expect, it } from "vitest";
import type { Kline } from "../../types/index.js";
import { accumulateCvd } from "./cvd.js";

const baseKline: Kline = {
  openTime: 1,
  open: "1",
  high: "1",
  low: "1",
  close: "1",
  volume: "10",
  closeTime: 2,
  quoteVolume: "10",
  numberOfTrades: 1,
  takerBuyBaseVolume: "7",
  takerBuyQuoteVolume: "7"
};

describe("accumulateCvd", () => {
  it("accumulates net CVD from taker buy volume using decimal strings", () => {
    const result = accumulateCvd([
      baseKline,
      {
        ...baseKline,
        takerBuyBaseVolume: "3"
      }
    ]);

    expect(result).toEqual({
      ok: true,
      cvd: "0",
      klineCount: 2
    });
    if (result.ok) {
      expect(typeof result.cvd).toBe("string");
    }
  });

  it("rejects invalid kline decimal strings without throwing", () => {
    expect(accumulateCvd([{ ...baseKline, volume: "x" }])).toEqual({
      ok: false,
      error: {
        code: "invalid_decimal_string",
        source: "tier1.cvd",
        context: {
          field: "volume",
          index: 0,
          message: "Expected finite decimal string"
        }
      }
    });
  });

  it("is deterministic and does not mutate klines", () => {
    const klines = [baseKline, { ...baseKline, takerBuyBaseVolume: "8" }];
    const before = structuredClone(klines);

    const first = accumulateCvd(klines);
    const second = accumulateCvd(klines);

    expect(first).toEqual(second);
    expect(klines).toEqual(before);
  });
});
