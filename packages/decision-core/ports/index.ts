export interface ClockPort {
  readonly nowEpochMillis: () => number;
}
