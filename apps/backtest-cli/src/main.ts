import { createBinanceRestIngestion } from "@brighten/adapters";
import { DEFAULT_PARAMS, createConfigVersion, snapshot } from "@brighten/config";
import type { Tier1AssetClass } from "@brighten/decision-core";

import { runBacktest } from "./run.js";
import { runValidation } from "./validate.js";
import type { BacktestStrategyInput, ValidationMode, WalkForwardSpec } from "./types.js";

interface CliArgs {
  readonly command: "backtest" | "validate";
  readonly pair: string;
  readonly timeframe: string;
  readonly fromEpochMillis: number;
  readonly toEpochMillis: number;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const [first, second, third, fourth, fifth] = argv;
  const command = first === "validate" ? "validate" : "backtest";
  const [pair, timeframe, from, to] =
    command === "validate" ? [second, third, fourth, fifth] : [first, second, third, fourth];

  if (pair === undefined || timeframe === undefined || from === undefined || to === undefined) {
    throw new Error(
      "Usage: backtest-cli <pair> <timeframe> <fromEpochMillis> <toEpochMillis> | backtest-cli validate <pair> <timeframe> <fromEpochMillis> <toEpochMillis>"
    );
  }

  const fromEpochMillis = Number(from);
  const toEpochMillis = Number(to);
  if (!Number.isFinite(fromEpochMillis) || !Number.isFinite(toEpochMillis)) {
    throw new Error("fromEpochMillis and toEpochMillis must be numeric epoch milliseconds");
  }

  return { command, pair, timeframe, fromEpochMillis, toEpochMillis };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const ingestion = createBinanceRestIngestion();
  const configSnapshot = snapshot(createConfigVersion(DEFAULT_PARAMS, undefined, Date.now()));

  // State/account are still fed through this seam until the live feedback loop
  // and balance feed exist; decisions are produced inside decision-core.
  const strategyInput: BacktestStrategyInput = {
    state: { winStreak: 0, dailyLoss: "0", tradeCountToday: 0 },
    account: { equity: "10000" },
    signals: []
  };

  const request = {
    pair: args.pair,
    timeframe: args.timeframe,
    fromEpochMillis: args.fromEpochMillis,
    toEpochMillis: args.toEpochMillis
  };
  const validationSpec: WalkForwardSpec = {
    folds: 3,
    inSampleRatio: "0.5",
    holdoutRatio: "0.2"
  };
  const mode: ValidationMode = args.command === "validate" ? "backtest" : "backtest";
  const assetClass: Tier1AssetClass = "crypto";

  const result =
    args.command === "validate"
      ? await runValidation({
          ingestion,
          request,
          strategyInput,
          configSnapshot,
          assetClass,
          spec: validationSpec,
          bootstrap: { resamples: 100, seed: 1 },
          tunedParamNames: [],
          paperTradeCompleted: false,
          mode
        })
      : await runBacktest({
          ingestion,
          request,
          strategyInput,
          configSnapshot,
          assetClass
        });

  if (!result.ok) {
    console.error(JSON.stringify(result.error, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(result.value, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
