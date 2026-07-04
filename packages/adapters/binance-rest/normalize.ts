import type {
  FundingPoint,
  Kline,
  LongShortRatioPoint,
  OpenInterestPoint,
  Result
} from "@brighten/decision-core";

const source = "adapter.binance_rest";

export function normalizeKlines(raw: unknown): Result<Kline[]> {
  if (!Array.isArray(raw)) {
    return invalidPayload("Expected klines payload to be an array");
  }

  const klines: Kline[] = [];
  for (const [index, item] of raw.entries()) {
    if (!Array.isArray(item) || item.length < 11) {
      return invalidPayload("Expected kline to be an array with Binance kline indexes", { index });
    }

    const openTime = readNumber(item[0]);
    const open = readString(item[1]);
    const high = readString(item[2]);
    const low = readString(item[3]);
    const close = readString(item[4]);
    const volume = readString(item[5]);
    const closeTime = readNumber(item[6]);
    const quoteVolume = readString(item[7]);
    const numberOfTrades = readNumber(item[8]);
    const takerBuyBaseVolume = readString(item[9]);
    const takerBuyQuoteVolume = readString(item[10]);

    if (
      openTime === undefined ||
      open === undefined ||
      high === undefined ||
      low === undefined ||
      close === undefined ||
      volume === undefined ||
      closeTime === undefined ||
      quoteVolume === undefined ||
      numberOfTrades === undefined ||
      takerBuyBaseVolume === undefined ||
      takerBuyQuoteVolume === undefined
    ) {
      return invalidPayload("Kline contains invalid field types", { index });
    }

    klines.push({
      openTime,
      open,
      high,
      low,
      close,
      volume,
      closeTime,
      quoteVolume,
      numberOfTrades,
      takerBuyBaseVolume,
      takerBuyQuoteVolume
    });
  }

  return { ok: true, value: klines };
}

export function normalizeFunding(raw: unknown): Result<FundingPoint[]> {
  return normalizeObjectArray<FundingPoint>(raw, "funding", (item, index) => {
    const fundingTime = readNumber(item.fundingTime);
    const fundingRate = readString(item.fundingRate);
    if (fundingTime === undefined || fundingRate === undefined) {
      return invalidPayload("Funding item contains invalid field types", { index });
    }

    return { ok: true, value: { fundingTime, fundingRate } };
  });
}

export function normalizeOpenInterest(raw: unknown): Result<OpenInterestPoint[]> {
  return normalizeObjectArray<OpenInterestPoint>(raw, "open interest", (item, index) => {
    const timestamp = readNumber(item.timestamp);
    const sumOpenInterest = readString(item.sumOpenInterest);
    const sumOpenInterestValue = readString(item.sumOpenInterestValue);
    if (timestamp === undefined || sumOpenInterest === undefined || sumOpenInterestValue === undefined) {
      return invalidPayload("Open interest item contains invalid field types", { index });
    }

    return { ok: true, value: { timestamp, sumOpenInterest, sumOpenInterestValue } };
  });
}

export function normalizeLongShort(raw: unknown): Result<LongShortRatioPoint[]> {
  return normalizeObjectArray<LongShortRatioPoint>(raw, "long-short ratio", (item, index) => {
    const timestamp = readNumber(item.timestamp);
    const longShortRatio = readString(item.longShortRatio);
    const longAccount = readString(item.longAccount);
    const shortAccount = readString(item.shortAccount);
    if (
      timestamp === undefined ||
      longShortRatio === undefined ||
      longAccount === undefined ||
      shortAccount === undefined
    ) {
      return invalidPayload("Long-short ratio item contains invalid field types", { index });
    }

    return { ok: true, value: { timestamp, longShortRatio, longAccount, shortAccount } };
  });
}

function normalizeObjectArray<T>(
  raw: unknown,
  name: string,
  normalize: (item: Record<string, unknown>, index: number) => Result<T>
): Result<T[]> {
  if (!Array.isArray(raw)) {
    return invalidPayload(`Expected ${name} payload to be an array`);
  }

  const output: T[] = [];
  for (const [index, item] of raw.entries()) {
    if (!isRecord(item)) {
      return invalidPayload(`Expected ${name} item to be an object`, { index });
    }

    const result = normalize(item, index);
    if (!result.ok) {
      return result;
    }
    output.push(result.value);
  }

  return { ok: true, value: output };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidPayload(message: string, context: Readonly<Record<string, unknown>> = {}): Result<never> {
  return {
    ok: false,
    error: {
      code: "invalid_payload",
      source,
      context: {
        ...context,
        message
      }
    }
  };
}
