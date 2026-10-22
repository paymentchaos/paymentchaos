import { defineCommand, runMain } from "citty";
import { createFlowsCommand } from "./commands/flows.ts";
import { createPlanCommand } from "./commands/plan.ts";
import { createRunCommand } from "./commands/run.ts";
import { ExitCode, exitCodeFor } from "./exit.ts";

const main = defineCommand({
  meta: {
    name: "paymentchaos",
    description: "Deterministic failure testing for payment and subscription integrations.",
  },
  subCommands: {
    run: createRunCommand(),
    plan: createPlanCommand(),
    flows: createFlowsCommand(),
  },
});

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  try {
    await runMain(main, { rawArgs: argv });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(exitCodeFor(error));
  }
  process.exit(ExitCode.Ok);
}
