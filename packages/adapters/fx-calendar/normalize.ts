import type { FxCalendarResult, SnapshotWarning } from "@brighten/decision-core";

const source = "adapter.fx_calendar";
type NewsBlackoutWindow = FxCalendarResult["windows"][number];

export interface CalendarEvent {
  readonly timestamp: number;
  readonly currency: string;
  readonly impact: string;
  readonly title: string;
}

export interface CalendarNormalizeResult {
  readonly events: readonly CalendarEvent[];
  readonly warnings: readonly SnapshotWarning[];
}

export function normalizeCalendar(raw: unknown): CalendarNormalizeResult {
  if (!Array.isArray(raw)) {
    return {
      events: [],
      warnings: [warning("invalid_payload", "Expected FX calendar payload to be an array")]
    };
  }

  const events: CalendarEvent[] = [];
  const warnings: SnapshotWarning[] = [];

  for (const [index, item] of raw.entries()) {
    if (!isRecord(item)) {
      warnings.push(warning("invalid_calendar_item", "Expected FX calendar item to be an object", { index }));
      continue;
    }

    const timestamp = readEpochMillis(item.timestamp);
    const currency = readString(item.currency);
    const impact = readString(item.impact);
    const title = readString(item.title);
    if (timestamp === undefined || currency === undefined || impact === undefined || title === undefined) {
      warnings.push(warning("invalid_calendar_item", "FX calendar item contains invalid field types", { index }));
      continue;
    }

    events.push({ timestamp, currency, impact, title });
  }

  return { events, warnings };
}

export function isHighImpact(impact: string): boolean {
  const normalized = impact.trim().toLowerCase();
  return normalized === "high" || normalized === "3";
}

export function buildWindow(
  event: CalendarEvent,
  pairs: readonly string[],
  beforeMs: number,
  afterMs: number
): NewsBlackoutWindow | undefined {
  const scopedPairs = pairs.filter((pair) => pair.includes(event.currency));
  if (scopedPairs.length === 0) {
    return undefined;
  }

  return {
    startsAt: event.timestamp - beforeMs,
    endsAt: event.timestamp + afterMs,
    reason: event.title,
    pairs: scopedPairs
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readEpochMillis(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function warning(
  code: string,
  message: string,
  context: Readonly<Record<string, unknown>> = {}
): SnapshotWarning {
  return {
    code,
    source,
    context: {
      ...context,
      message
    }
  };
}
