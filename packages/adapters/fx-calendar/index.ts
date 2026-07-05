import type { FxCalendarPort, SnapshotWarning } from "@brighten/decision-core";
import { buildWindow, isHighImpact, normalizeCalendar } from "./normalize.js";
export { buildWindow, isHighImpact, normalizeCalendar } from "./normalize.js";
export type { CalendarEvent, CalendarNormalizeResult } from "./normalize.js";

const source = "adapter.fx_calendar";
const defaultBaseUrl = "https://example.invalid/fx-calendar";

export type FxCalendarFetchResponseLike = {
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
};

export type FxCalendarFetchLike = (url: string) => Promise<FxCalendarFetchResponseLike>;

export interface FxCalendarDeps {
  readonly fetchFn?: FxCalendarFetchLike;
  readonly baseUrl?: string;
  readonly logger?: (warning: SnapshotWarning) => void;
}

export function createFxCalendarAdapter(deps: FxCalendarDeps = {}): FxCalendarPort {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const baseUrl = deps.baseUrl ?? defaultBaseUrl;
  const logger = deps.logger ?? (() => undefined);

  return {
    async getNewsBlackout(request) {
      const payload = await fetchJson(fetchFn, buildUrl(baseUrl, {
        from: request.fromEpochMillis,
        to: request.toEpochMillis
      }));
      if (!payload.ok) {
        logger(payload.warning);
        return { windows: [], warnings: [payload.warning] };
      }

      const normalized = normalizeCalendar(payload.value);
      const warnings = [...normalized.warnings];
      const windows = normalized.events
        .filter((event) => isHighImpact(event.impact))
        .map((event) =>
          buildWindow(event, request.pairs, request.blackoutBufferBeforeMs, request.blackoutBufferAfterMs)
        )
        .filter((window): window is NonNullable<typeof window> => window !== undefined);

      for (const warning of warnings) {
        logger(warning);
      }

      return { windows, warnings };
    }
  };
}

type FetchJsonResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly warning: SnapshotWarning };

async function fetchJson(fetchFn: FxCalendarFetchLike, url: string): Promise<FetchJsonResult> {
  let response: FxCalendarFetchResponseLike;
  try {
    response = await fetchFn(url);
  } catch (error) {
    return {
      ok: false,
      warning: warning("network_error", "Fetch failed", {
        url,
        detail: error instanceof Error ? error.message : String(error)
      })
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      warning: warning("http_error", "FX calendar endpoint returned non-2xx status", {
        url,
        status: response.status
      })
    };
  }

  try {
    return { ok: true, value: await response.json() };
  } catch (error) {
    return {
      ok: false,
      warning: warning("invalid_payload", "Failed to parse JSON payload", {
        url,
        detail: error instanceof Error ? error.message : String(error)
      })
    };
  }
}

function buildUrl(endpoint: string, params: Readonly<Record<string, number>>): string {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function warning(
  code: string,
  message: string,
  context: Readonly<Record<string, unknown>>
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
