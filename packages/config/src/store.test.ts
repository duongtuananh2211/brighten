import { describe, expect, it } from "vitest";

import { DEFAULT_PARAMS, InMemoryConfigStore } from "./index.js";

describe("in-memory config store", () => {
  it("assigns version 1 and reads back exact saved values by version", () => {
    const store = new InMemoryConfigStore({ now: () => 1_700_000_000_000 });
    const params = {
      ...DEFAULT_PARAMS,
      risk_pct: "1.25",
      min_rr: "2.5"
    };

    const saved = store.save(params);

    expect(saved).toEqual({
      ok: true,
      value: {
        version: 1,
        params,
        createdAt: 1_700_000_000_000
      }
    });
    expect(store.getByVersion(1)?.params).toEqual(params);
  });

  it("is append-only and keeps old versions intact", () => {
    let clock = 1_700_000_000_000;
    const store = new InMemoryConfigStore({ now: () => clock });
    const firstParams = { ...DEFAULT_PARAMS, risk_pct: "1" };
    const secondParams = { ...DEFAULT_PARAMS, risk_pct: "2" };

    const first = store.save(firstParams);
    clock += 1_000;
    const second = store.save(secondParams);

    expect(first.ok && first.value.version).toBe(1);
    expect(second.ok && second.value.version).toBe(2);
    expect(store.getByVersion(1)?.params).toEqual(firstParams);
    expect(store.getLatest()?.params).toEqual(secondParams);

    const storedFirst = store.getByVersion(1);
    expect(storedFirst?.params.risk_pct).toBe("1");
    expect(() => {
      (storedFirst?.params as { risk_pct: string }).risk_pct = "99";
    }).toThrow(TypeError);
    expect(store.getByVersion(1)?.params.risk_pct).toBe("1");
  });
});
