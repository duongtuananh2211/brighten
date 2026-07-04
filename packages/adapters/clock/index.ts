import type { ClockPort } from "@brighten/decision-core/ports";

export const systemClockAdapterScaffold: ClockPort = {
  nowEpochMillis: () => Date.now()
};
