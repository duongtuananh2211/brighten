import type { DecisionCoreScaffold } from "@brighten/decision-core";

function main(): void {
  const scaffold: DecisionCoreScaffold = { name: "decision-core" };
  console.log(`backtest-cli scaffold ok: ${scaffold.name}`);
}

main();
