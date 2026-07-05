const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

// Parse trading_day_boundary into offset milliseconds from UTC midnight.
//
// Formats accepted (validated by @brighten/config schema):
//   "UTC HH:mm"   – absolute UTC wall-clock time (e.g. "UTC 00:00")
//   "UTC±HH:mm"   – timezone-offset form (e.g. "UTC+07:00", "UTC-05:00")
//
// Returns the offset used by the standard day-start formula:
//   dayStart = floor((now − offsetMs) / DAY_MS) × DAY_MS + offsetMs
function parseBoundaryOffset(boundary: string): number {
  // "UTC HH:mm" – absolute time at UTC
  const absMatch = /^UTC (\d{2}):(\d{2})$/.exec(boundary);
  if (absMatch !== null) {
    const [, hh, mm] = absMatch;
    const hours = Number(hh);
    const minutes = Number(mm);
    return (hours * 60 + minutes) * MINUTE_MS;
  }

  // "UTC±HH:mm" – timezone-offset form; ∓ maps + → −, − → +
  const tzMatch = /^UTC([+-])(\d{2}):(\d{2})$/.exec(boundary);
  if (tzMatch !== null) {
    const [, sign, hh, mm] = tzMatch;
    const hours = Number(hh);
    const minutes = Number(mm);
    const magnitude = (hours * 60 + minutes) * MINUTE_MS;
    // ∓ (minus-plus): "+" → negative offset, "−" → positive offset
    return sign === "+" ? -magnitude : magnitude;
  }

  // Should never reach here — config validation rejects unknown formats.
  throw new Error(`Unsupported trading_day_boundary: ${boundary}`);
}

/**
 * Return the UTC epoch-millis of the trading-day start that contains `nowEpochMillis`.
 *
 * Pure: no Date, no IO, no random. Same (now, boundary) ⇒ same result.
 */
export function tradingDayStart(nowEpochMillis: number, boundary: string): number {
  const offsetMs = parseBoundaryOffset(boundary);
  return Math.floor((nowEpochMillis - offsetMs) / DAY_MS) * DAY_MS + offsetMs;
}
