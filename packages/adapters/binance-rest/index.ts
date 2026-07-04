import type { ClockPort } from "@brighten/decision-core/ports";

export interface BinanceRestAdapterScaffold {
  readonly clock?: ClockPort;
}
