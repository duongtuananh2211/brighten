import { describe, expect, it } from "vitest";
import { tradingDayStart } from "./trading-day.js";

// Helper: hand-computed epoch-ms for known UTC midnights.
// 2023-11-15T00:00:00.000Z = 1700006400000
// 2023-11-15T07:00:00.000Z = 1700031600000
// 2023-11-16T00:00:00.000Z = 1700092800000
// 2023-11-14T17:00:00.000Z = 1699977600000

describe("tradingDayStart", () => {
  describe('boundary "UTC 00:00"', () => {
    const boundary = "UTC 00:00";

    it("returns midnight UTC of the same day when now is after midnight", () => {
      // 2023-11-15T12:00:00.000Z
      const now = 1_700_044_800_000;
      const start = tradingDayStart(now, boundary);
      // Expected: 2023-11-15T00:00:00.000Z = 1700006400000
      expect(start).toBe(1_700_006_400_000);
    });

    it("returns midnight UTC of the same day when now is before noon", () => {
      // 2023-11-15T01:30:00.000Z
      const now = 1_700_011_800_000;
      const start = tradingDayStart(now, boundary);
      expect(start).toBe(1_700_006_400_000);
    });

    it("returns the next midnight when now is exactly midnight", () => {
      // 2023-11-15T00:00:00.000Z
      const now = 1_700_006_400_000;
      const start = tradingDayStart(now, boundary);
      expect(start).toBe(1_700_006_400_000);
    });

    it("crosses midnight correctly", () => {
      // 2023-11-15T23:59:59.999Z
      const before = 1_700_092_799_999;
      const startBefore = tradingDayStart(before, boundary);
      expect(startBefore).toBe(1_700_006_400_000); // Nov 15 00:00

      // 2023-11-16T00:00:00.001Z
      const after = 1_700_092_800_001;
      const startAfter = tradingDayStart(after, boundary);
      expect(startAfter).toBe(1_700_092_800_000); // Nov 16 00:00
    });
  });

  describe('boundary "UTC 07:00" (absolute UTC wall-clock)', () => {
    const boundary = "UTC 07:00";

    it("returns 07:00 UTC of the same day when now is after 07:00", () => {
      // 2023-11-15T12:00:00.000Z
      const now = 1_700_044_800_000;
      const start = tradingDayStart(now, boundary);
      // Expected: 2023-11-15T07:00:00.000Z = 1700031600000
      expect(start).toBe(1_700_031_600_000);
    });

    it("returns 07:00 UTC of the previous day when now is before 07:00", () => {
      // 2023-11-15T03:00:00.000Z
      const now = 1_700_017_200_000;
      const start = tradingDayStart(now, boundary);
      // Expected: 2023-11-14T07:00:00.000Z = 1699945200000
      expect(start).toBe(1_699_945_200_000);
    });

    it("at exactly 07:00 returns that moment", () => {
      // 2023-11-15T07:00:00.000Z
      const now = 1_700_031_600_000;
      const start = tradingDayStart(now, boundary);
      expect(start).toBe(1_700_031_600_000);
    });
  });

  describe('boundary "UTC+07:00" (timezone-offset form)', () => {
    const boundary = "UTC+07:00";

    it("returns 17:00 UTC of the previous day when now is after UTC+7 midnight (17:00 UTC)", () => {
      // 2023-11-15T18:00:00.000Z (01:00 Nov 16 UTC+7)
      const now = 1_700_071_200_000;
      const start = tradingDayStart(now, boundary);
      // UTC+7 midnight Nov 16 = 17:00 UTC Nov 15 = 1700067600000
      expect(start).toBe(1_700_067_600_000);
    });

    it("returns 17:00 UTC of the previous day when now is before 17:00 UTC", () => {
      // 2023-11-15T10:00:00.000Z (17:00 UTC+7 on Nov 15)
      // At 10:00 UTC, UTC+7 time is 17:00 — same day, boundary not crossed.
      const now = 1_700_042_400_000;
      const start = tradingDayStart(now, boundary);
      // floor((now + 7h) / DAY_MS) * DAY_MS - 7h
      // = floor(1700067600000 / 86400000) * 86400000 - 25200000
      // = 19676 * 86400000 - 25200000 = 1700006400000 - 25200000 = 1699981200000
      // = 2023-11-14T17:00:00.000Z
      expect(start).toBe(1_699_981_200_000);
    });
  });

  describe("pure / deterministic", () => {
    it("returns the same result for the same inputs (deterministic)", () => {
      const now = 1_700_044_800_000;
      const a = tradingDayStart(now, "UTC 00:00");
      const b = tradingDayStart(now, "UTC 00:00");
      expect(a).toBe(b);
    });

    it("works correctly for large epoch values", () => {
      // Should not overflow — uses integer math within safe range
      const now = 1_800_000_000_000;
      const start = tradingDayStart(now, "UTC 00:00");
      expect(start).toBeLessThanOrEqual(now);
      expect((now - start) % 86_400_000).toBe(now % 86_400_000);
    });
  });
});
