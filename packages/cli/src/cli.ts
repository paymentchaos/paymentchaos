import { type CommandDef, defineCommand, runCommand, showUsage } from "citty";
import { createFlowsCommand } from "./commands/flows.ts";
import { createInitCommand } from "./commands/init.ts";
import { createPlanCommand } from "./commands/plan.ts";
import { createRunCommand } from "./commands/run.ts";
import { ExitCode, exitCodeFor } from "./exit.ts";

const main = defineCommand({
  meta: {
    name: "paymentchaos",
    description: "Deterministic failure testing for payment and subscription integrations.",
  },
  subCommands: {
    init: createInitCommand(),
    run: createRunCommand(),
    plan: createPlanCommand(),
    flows: createFlowsCommand(),
  },
});

/** The subcommand named on the command line, for help output. Mirrors citty's own lookup. */
function usageTarget(argv: readonly string[]): [CommandDef, CommandDef | undefined] {
  const name = argv.find((arg) => !arg.startsWith("-"));
  const subCommands = main.subCommands as Record<string, CommandDef>;
  const sub = name === undefined ? undefined : subCommands[name];
  return sub === undefined ? [main, undefined] : [sub, main];
}

/** citty's argument errors (unknown command, missing required argument) are usage errors. */
function isUsageError(error: unknown): boolean {
  return error instanceof Error && error.name === "CLIError";
}

/**
 * The CLI's only error boundary. It reports errors and sets `process.exitCode` but never
 * calls `process.exit()`, so output written to a pipe is flushed before the process ends.
 * Commands set `process.exitCode` themselves for a finished run (0 pass, 1 assertion failure).
 */
export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  try {
    // citty's runMain swallows errors and exits 1, so call runCommand and map errors here.
    if (argv.includes("--help") || argv.includes("-h")) {
      await showUsage(...usageTarget(argv));
      return;
    }
    await runCommand(main, { rawArgs: [...argv] });
  } catch (error) {
    if (isUsageError(error)) {
      await showUsage(...usageTarget(argv));
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = isUsageError(error) ? ExitCode.Config : exitCodeFor(error);
  }
}
