import type { ParamCapOutcome } from "./types.js";

export function enforceParamCap(
  tunedParamNames: readonly string[],
  maxTunableParams: number
): ParamCapOutcome {
  const count = tunedParamNames.length;
  if (count > maxTunableParams) {
    return {
      ok: false,
      error: {
        code: "param_cap_exceeded",
        source: "validation.param_cap",
        context: { count, cap: maxTunableParams }
      }
    };
  }

  return { ok: true, count, cap: maxTunableParams };
}
