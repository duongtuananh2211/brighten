import { describe, expect, it, vi } from "vitest";

import type { FxCalendarFetchLike } from "./index.js";
import { createFxCalendarAdapter } from "./index.js";

const request = {
  fromEpochMillis: 1_699_999_000_000,
  toEpochMillis: 1_700_001_000_000,
  pairs: ["EURUSD", "USDJPY", "EURGBP"],
  blackoutBufferBeforeMs: 1_800_000,
  blackoutBufferAfterMs: 1_800_000
};

function response(payload: unknown, ok = true, status = 200): Awaited<ReturnType<FxCalendarFetchLike>> {
  return {
    ok,
    status,
    json: async () => payload
  };
}

describe("createFxCalendarAdapter", () => {
  it("fetches, normalizes, filters high-impact events, and builds scoped blackout windows", async () => {
    const fetchFn = vi.fn<FxCalendarFetchLike>(async () =>
      response([
        { timestamp: 1_700_000_000_000, currency: "USD", impact: "high", title: "USD CPI" },
        { timestamp: 1_700_000_060_000, currency: "EUR", impact: "low", title: "EUR Low Impact" },
        { timestamp: 1_700_000_120_000, currency: "CHF", impact: "high", title: "CHF Rate Decision" }
      ])
    );

    const result = await createFxCalendarAdapter({ fetchFn, baseUrl: "https://calendar.test/events" }).getNewsBlackout(request);

    expect(fetchFn).toHaveBeenCalledWith(
      "https://calendar.test/events?from=1699999000000&to=1700001000000"
    );
    expect(result).toEqual({
      windows: [
        {
          startsAt: 1_699_998_200_000,
          endsAt: 1_700_001_800_000,
          reason: "USD CPI",
          pairs: ["EURUSD", "USDJPY"]
        }
      ],
      warnings: []
    });
  });

  it("soft-degrades and logs when fetch throws", async () => {
    const logger = vi.fn();
    const fetchFn = vi.fn<FxCalendarFetchLike>(async () => {
      throw new Error("timeout");
    });

    const result = await createFxCalendarAdapter({ fetchFn, logger }).getNewsBlackout(request);

    expect(result).toMatchObject({
      windows: [],
      warnings: [
        {
          code: "network_error",
          source: "adapter.fx_calendar"
        }
      ]
    });
    expect(logger).toHaveBeenCalledWith(expect.objectContaining({ code: "network_error" }));
  });

  it("soft-degrades and logs HTTP and JSON payload failures", async () => {
    const httpLogger = vi.fn();
    const httpResult = await createFxCalendarAdapter({
      fetchFn: vi.fn<FxCalendarFetchLike>(async () => response({ message: "bad" }, false, 500)),
      logger: httpLogger
    }).getNewsBlackout(request);

    expect(httpResult).toMatchObject({
      windows: [],
      warnings: [{ code: "http_error", source: "adapter.fx_calendar" }]
    });
    expect(httpLogger).toHaveBeenCalledWith(expect.objectContaining({ code: "http_error" }));

    const jsonLogger = vi.fn();
    const jsonResult = await createFxCalendarAdapter({
      fetchFn: vi.fn<FxCalendarFetchLike>(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("bad json");
        }
      })),
      logger: jsonLogger
    }).getNewsBlackout(request);

    expect(jsonResult).toMatchObject({
      windows: [],
      warnings: [{ code: "invalid_payload", source: "adapter.fx_calendar" }]
    });
    expect(jsonLogger).toHaveBeenCalledWith(expect.objectContaining({ code: "invalid_payload" }));
  });

  it("keeps valid items when part of the payload is invalid", async () => {
    const logger = vi.fn();
    const fetchFn = vi.fn<FxCalendarFetchLike>(async () =>
      response([
        { timestamp: 1_700_000_000_000, currency: "USD", impact: "high", title: "NFP" },
        { timestamp: "bad", currency: "USD", impact: "high", title: "Bad" }
      ])
    );

    const result = await createFxCalendarAdapter({ fetchFn, logger }).getNewsBlackout(request);

    expect(result.windows).toEqual([
      {
        startsAt: 1_699_998_200_000,
        endsAt: 1_700_001_800_000,
        reason: "NFP",
        pairs: ["EURUSD", "USDJPY"]
      }
    ]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "invalid_calendar_item",
        source: "adapter.fx_calendar"
      })
    ]);
    expect(logger).toHaveBeenCalledWith(expect.objectContaining({ code: "invalid_calendar_item" }));
  });
});
