import type { PipelineResult } from "@brighten/decision-core";

function main(): void {
  const scaffoldResult: PipelineResult = { outcome: "silent" };
  console.log(`backtest-cli scaffold ok: ${scaffoldResult.outcome}`);
}

main();
