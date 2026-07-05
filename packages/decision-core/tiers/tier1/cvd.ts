import { add, sub, toDecimal } from "../../math/decimal.js";
import type { CoreError, Kline } from "../../types/index.js";

export interface CvdResult {
  readonly ok: true;
  readonly cvd: string;
  readonly klineCount: number;
}

export interface CvdRejection {
  readonly ok: false;
  readonly error: CoreError;
}

export type CvdOutcome = CvdResult | CvdRejection;

type DecimalParseOutcome = { readonly ok: true; readonly value: string } | CvdRejection;

export function accumulateCvd(klines: readonly Kline[]): CvdOutcome {
  let cvd = "0";

  for (const [index, kline] of klines.entries()) {
    const volume = parseKlineDecimal(kline.volume, "volume", index);
    if (!volume.ok) {
      return volume;
    }

    const takerBuyBaseVolume = parseKlineDecimal(kline.takerBuyBaseVolume, "takerBuyBaseVolume", index);
    if (!takerBuyBaseVolume.ok) {
      return takerBuyBaseVolume;
    }

    const takerSellBase = sub(volume.value, takerBuyBaseVolume.value);
    const delta = sub(takerBuyBaseVolume.value, takerSellBase);
    cvd = add(cvd, delta);
  }

  return {
    ok: true,
    cvd,
    klineCount: klines.length
  };
}

function parseKlineDecimal(value: string, field: string, index: number): DecimalParseOutcome {
  try {
    return { ok: true, value: toDecimal(value) };
  } catch {
    return {
      ok: false,
      error: {
        code: "invalid_decimal_string",
        source: "tier1.cvd",
        context: {
          field,
          index,
          message: "Expected finite decimal string"
        }
      }
    };
  }
}
